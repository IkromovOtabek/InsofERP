import { z } from "zod";
import { db } from "@/lib/db";
import { getCompany } from "@/lib/company";
import { routeLine, type RouteLine } from "@/lib/geo";
import { acceptPlannedRoute, BACK_ON_ROUTE_M, decodePolyline, distanceToPolyline, encodePolyline, simplifyLine, type LatLng } from "@/lib/trip-track";
import { hit } from "@/lib/rate-limit";
import { ARRIVE_RADIUS_M, tripArrival, tripTrackStats } from "@/lib/trips";
import { SITE_RADIUS_M } from "./geofence";
import type { MobileUser } from "./auth";
import { RECEIVER_FORM, type FormField } from "./detail";
import { driverEmployeeId, listAllowed, ListError } from "./list";

/**
 * Haydovchi ilovasidagi marshrut ekrani uchun ma'lumot.
 *
 * Nega alohida so'rov, kartochka ichida emas: bu ma'lumot reys davomida har daqiqada
 * yangilanadi (mashina qayerda, qancha qoldi), kartochka esa kamdan-kam. Ikkalasini
 * qo'shsak, ilova butun kartochkani qayta so'rab turardi.
 *
 * Chiziqni ilova o'zi chizmaydi-yu, o'zi ham hisoblamaydi: qolgan masofa shu chiziq
 * bo'ylab hisoblanadi, ya'ni internetsiz qolganda ham raqam yangilanib turadi.
 */
const Pos = z.object({ lat: z.coerce.number().min(-90).max(90), lng: z.coerce.number().min(-180).max(180) });

export type TripRoute = {
  tripId: string;
  ref: string;
  status: string;
  customer: string;
  address: string;
  /** Obyekt nuqtasi. Zayavkada koordinata bo'lmasa null — ilova xaritani ko'rsatmaydi. */
  destination: { lat: number; lng: number } | null;
  /** Marshrut boshlangan joy: yuk olingan nuqta, bo'lmasa zavod. */
  origin: { lat: number; lng: number } | null;
  /**
   * Chiziq shu javobda bormi. `false` — ilovada allaqachon bor, qayta qurilmadi:
   * `line`, `routeMeters`, `routeSeconds` bo'sh keladi va ilova o'zidagini saqlab qoladi.
   */
  lineIncluded: boolean;
  /** Xaritada chiziladigan yo'l. Obyekt nuqtasi bo'lmasa — bo'sh. */
  line: { lat: number; lng: number }[];
  /** Shu chiziq bo'yicha qolgan yo'l va vaqt (ilova mashina yurgan sayin qayta hisoblaydi). */
  routeMeters: number;
  routeSeconds: number;
  routeSource: "ROUTE" | "LINE";
  /** Reys boshidan beri bosib o'tilgani — veb va ilova bir xil raqamni ko'rsatadi. */
  traveledMeters: number;
  traveledMinutes: number;
  /** "Yetkazdim" shu radius ichida ochiladi, metr. */
  arriveWithinM: number;
  /** Serverning fikri: hozir yopsa bo'ladimi. Ilova buni har soniyada o'zi ham tekshiradi. */
  canDeliver: boolean;
  deliverHint: string | null;
  /** "Yetkazdim" so'raydigan maydonlar — kartochkadagi bilan bitta ro'yxat. */
  deliverForm: FormField[];
};

export async function tripRoute(
  user: MobileUser,
  tripId: string,
  raw: { lat?: string | null; lng?: string | null; line?: string | null },
): Promise<TripRoute> {
  if (!tripId) throw new ListError("BAD_REQUEST", "Reys tanlanmagan", 400);
  // Reyslarni ko'radigan rollar (`list.ts` ACCESS.trips) — aks holda kassir/brigadir ham istalgan reysning
  // mijoz manzili va koordinatasini olar, pullik marshrut xizmatini ham chaqira olardi
  if (!listAllowed(user, "trips")) throw new ListError("FORBIDDEN", "Bu bo'limga ruxsat yo'q", 403);
  const t = await db.trip.findUnique({
    where: { id: tripId },
    include: { order: { select: { lat: true, lng: true, deliveryAddress: true, customer: { select: { name: true } } } } },
  });
  // Kartochkadagi qoida bilan bir xil: begona reys "topilmadi" deb qaytadi (`lib/mobile/detail.ts`)
  if (!t) throw new ListError("NOT_FOUND", "Reys topilmadi", 404);
  if (user.role === "DRIVER" && t.driverId !== (await driverEmployeeId(user.id))) throw new ListError("NOT_FOUND", "Reys topilmadi", 404);

  const dest = t.order.lat != null && t.order.lng != null ? { lat: t.order.lat, lng: t.order.lng } : null;

  // Marshrut mashinaning HOZIRGI joyidan boshlanadi — ilova o'z koordinatasini yuboradi.
  // Yubormasa (GPS hali tutmagan): yuk olingan joy, u ham bo'lmasa zavod nuqtasi.
  const here = Pos.safeParse(raw);
  const pickup = t.pickupLat != null && t.pickupLng != null ? { lat: t.pickupLat, lng: t.pickupLng } : null;
  const company = pickup ? null : await getCompany();
  const plant = company?.lat != null && company?.lng != null ? { lat: company.lat, lng: company.lng } : null;
  const origin = here.success ? here.data : (pickup ?? plant);

  /**
   * Chiziqni qayta qurish shartmi.
   *
   * Ilova ko'rsatkichlarni yangilab turish uchun har daqiqa-yarimda so'raydi, lekin yo'lning
   * o'zi kamdan-kam o'zgaradi (faqat boshqa ko'chaga burilganda). Har safar qayta qursak,
   * marshrut xizmatiga (Yandex/OSRM) keraksiz yuk tushardi va telefonga o'sha 17 KB qayta-qayta kelardi —
   * shuning uchun ilova "menda bor" deb aytsa (`line=skip`), qurilmaydi.
   */
  // Pullik marshrut xizmati (Yandex) — foydalanuvchiga daqiqasiga 20 ta qurish; oshsa chiziqsiz javob (ilova eski chiziqni ko'rsatadi)
  const keep = raw.line === "skip" || !hit(`route:line:${user.id}`, 20, 60_000);
  const [line, stats, arrival] = await Promise.all([
    dest && origin && !keep ? routeLine(origin, dest) : Promise.resolve(null),
    tripTrackStats([t.id]),
    tripArrival(t.id),
  ]);
  const st = stats.get(t.id);
  if (line && dest) await savePlannedRoute(t, line, here.success ? here.data : null).catch((e) => console.error("[trip-route] reja", e));

  return {
    tripId: t.id,
    ref: t.deliveryNoteNo,
    status: t.status,
    customer: t.order.customer.name,
    address: t.order.deliveryAddress,
    destination: dest,
    origin: origin ?? null,
    lineIncluded: !!line,
    line: line?.points ?? [],
    routeMeters: line?.meters ?? 0,
    routeSeconds: line?.seconds ?? 0,
    routeSource: line?.source ?? "LINE",
    traveledMeters: Math.round(st?.meters ?? 0),
    traveledMinutes: st?.minutes ?? 0,
    // Server amalda 300 m talab qiladi (`./geofence.ts`) — ilova tugmani shu radiusda ochsin
    arriveWithinM: Math.min(ARRIVE_RADIUS_M, SITE_RADIUS_M),
    canDeliver: arrival.near,
    deliverHint: arrival.reason,
    deliverForm: RECEIVER_FORM,
  };
}

/**
 * Rejadagi yo'lni reysga saqlash — "yo'ldan chiqdi" tekshiruvi (`lib/gps-watch.ts`) va reja km/vaqti uchun.
 *
 * Faqat haqiqiy yo'l (Yandex/OSRM) saqlanadi: to'g'ri chiziq shahar ichida doim "yo'ldan chiqdi" berardi.
 * Ilova yo'ldan chiqqanda yo'lni yangi joydan qayta quradi — u darhol saqlansa chetlashish hech qachon
 * aniqlanmasdi, shuning uchun ECO qoidasi (`acceptPlannedRoute`): mashina eski yo'lda bo'lsa yoki
 * dispetcher allaqachon xabar olgan bo'lsa — yangisi qabul qilinadi. `plannedKm`/`plannedMin` —
 * birinchi qurilgan yo'ldan (reja), keyin o'zgarmaydi.
 */
export async function savePlannedRoute(
  t: { id: string; status: string; plannedRoute: string | null; plannedKm: number | null; lastLat: number | null; lastLng: number | null },
  line: RouteLine, here: LatLng | null,
) {
  if (line.source !== "ROUTE" || !["LOADED", "ON_ROAD"].includes(t.status) || line.points.length < 2) return;
  const pos = here ?? (t.lastLat != null && t.lastLng != null ? { lat: t.lastLat, lng: t.lastLng } : null);
  const alert = await db.tripAlert.findFirst({ where: { tripId: t.id, kind: "OFF_ROUTE", closedAt: null }, select: { id: true } });
  if (!acceptPlannedRoute({ stored: decodePolyline(t.plannedRoute), pos, offRouteOpen: !!alert })) return;
  const pts = simplifyLine(line.points, 10);
  await db.trip.update({
    where: { id: t.id },
    data: {
      plannedRoute: encodePolyline(pts), plannedRouteAt: new Date(),
      ...(t.plannedKm == null ? { plannedKm: Math.round(line.meters / 100) / 10, plannedMin: Math.round(line.seconds / 60) } : {}),
    },
  });
  // Yangi yo'l endi asos: mashina shu yo'lda bo'lsa "yo'ldan chiqdi" holati tugadi
  if (alert && (!pos || distanceToPolyline(pos, pts) <= BACK_ON_ROUTE_M)) await db.tripAlert.update({ where: { id: alert.id }, data: { closedAt: new Date() } });
}
