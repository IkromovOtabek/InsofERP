import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { nextNo } from "@/lib/numbering";
import { haversineMeters } from "@/lib/geo";
import { notifyAfter, notifyEmployees, notifyRoles, notifyUsers } from "@/lib/notify";
import { soleUnit, unitLabel } from "@/lib/unit";

/**
 * Reys (nakladnoy) holat o'tishlari — yagona joy. Server action'lar (logist tugma bosganda) ham,
 * Insof ECO webhook'i (haydovchi ilovada bosganda) ham shu funksiyalarni chaqiradi.
 * Sessiya/ruxsat tekshiruvi va revalidate — chaqiruvchida.
 */
export type TripResult = { changed: boolean; error?: string; orderId: string };

/** Bosqichlarning o'zbekcha nomi — veb ham, ilova ham shu ro'yxatdan oladi. */
export const TRIP_STEP: Record<string, string> = {
  PLANNED: "Rejalashtirildi", LOADED: "Yuklandi", ON_ROAD: "Yo'lga chiqdi", DELIVERED: "Yetkazildi", CANCELLED: "Bekor qilindi",
};
export type TripStep = { id: string; status: string; label: string; by: string; at: Date };

/**
 * Reys bosqichlari tarixi: qaysi holat, qachon va KIM tomonidan belgilangani.
 *
 * Manba — audit jurnali: holat o'zgarishi allaqachon shu yerga yoziladi (yuqoridagi
 * `audit(...)` chaqiruvlari), ya'ni haydovchi ilovadan bosgani ham, logist vebdan
 * bosgani ham, ECO webhook'i keltirgani ham bir xil joyda. Alohida ustun qo'shish
 * o'sha ma'lumotni ikkinchi marta saqlash bo'lardi.
 */
export async function tripSteps(id: string): Promise<TripStep[]> {
  const log = await db.auditLog.findMany({
    where: { entity: "Trip", entityId: id, action: { in: ["CREATE", "STATUS_CHANGE"] } },
    orderBy: { createdAt: "asc" },
    include: { user: { select: { fullName: true } } },
  });
  return log.map((l) => {
    // CREATE — reys ochilgan payt: holat o'shanda PLANNED bo'ladi
    const status = l.action === "CREATE" ? "PLANNED" : String((l.after as { status?: string } | null)?.status ?? "");
    return { id: l.id, status, label: TRIP_STEP[status] ?? status, by: l.user.fullName, at: l.createdAt };
  });
}

const tripWithOrder = (id: string) => db.trip.findUniqueOrThrow({ where: { id }, include: { order: { include: { items: true, trips: true } } } });

/** PLANNED → LOADED: tayyor beton skladdan chiqadi (SHIPMENT). */
export async function tripLoaded(id: string, userId: string, note?: string): Promise<TripResult> {
  const t = await tripWithOrder(id);
  if (t.status !== "PLANNED") return { changed: false, orderId: t.orderId, error: t.status === "CANCELLED" ? "Reys bekor qilingan" : undefined };
  const productId = t.order.items[0]?.productId;
  const wh = await db.warehouse.findFirstOrThrow({ where: { isActive: true } });
  await db.$transaction(async (tx) => {
    await tx.trip.update({ where: { id }, data: { status: "LOADED", loadedAt: new Date() } });
    if (productId) {
      await tx.stockMove.create({ data: { type: "SHIPMENT", warehouseId: wh.id, productId, qty: -Number(t.qtyM3), refType: "Trip", refId: id, note, createdById: userId } });
    }
    await audit(tx, userId, "STATUS_CHANGE", "Trip", id, { status: "PLANNED" }, { status: "LOADED", note });
  });
  return { changed: true, orderId: t.orderId };
}

/** LOADED → ON_ROAD. PLANNED bo'lsa avval yuklanadi (ECO'dan "yo'lda" kelganda). */
export async function tripOnRoad(id: string, userId: string, note?: string): Promise<TripResult> {
  let t = await db.trip.findUniqueOrThrow({ where: { id } });
  if (t.status === "PLANNED") { await tripLoaded(id, userId, note); t = await db.trip.findUniqueOrThrow({ where: { id } }); }
  if (t.status !== "LOADED") return { changed: false, orderId: t.orderId };
  await db.trip.update({ where: { id }, data: { status: "ON_ROAD" } });
  await audit(db, userId, "STATUS_CHANGE", "Trip", id, { status: "LOADED" }, { status: "ON_ROAD", note });
  return { changed: true, orderId: t.orderId };
}

/** → DELIVERED. Zayavkaning hamma hajmi yetkazilgan bo'lsa — zayavka DELIVERED. */
export async function tripDelivered(id: string, userId: string, receiverName: string, note?: string): Promise<TripResult> {
  let t = await tripWithOrder(id);
  if (t.status === "PLANNED") { await tripLoaded(id, userId, note); t = await tripWithOrder(id); }
  if (!["LOADED", "ON_ROAD"].includes(t.status)) return { changed: false, orderId: t.orderId, error: t.status === "DELIVERED" ? undefined : "Holat mos emas" };

  const total = t.order.items.reduce((s, i) => s + Number(i.qtyM3), 0);
  const delivered = t.order.trips.filter((x) => x.status === "DELIVERED" || x.id === id).reduce((s, x) => s + Number(x.qtyM3), 0);
  await db.$transaction(async (tx) => {
    await tx.trip.update({ where: { id }, data: { status: "DELIVERED", deliveredAt: new Date(), receiverName } });
    if (delivered >= total - 0.001) await tx.order.update({ where: { id: t.orderId }, data: { status: "DELIVERED" } });
    await audit(tx, userId, "STATUS_CHANGE", "Trip", id, { status: t.status }, { status: "DELIVERED", receiverName, note });
  });

  // Zayavkani kiritgan sotuvchi mijozga javob beradi; logistika keyingi reysni rejalashtiradi
  const done = delivered >= total - 0.001;
  notifyAfter(async () => {
    await notifyUsers([t.order.createdById], {
      type: done ? "ORDER_DELIVERED" : "TRIP_DELIVERED",
      title: done ? `Zayavka yopildi — ${t.order.orderNo}` : `Reys yetkazildi — ${t.deliveryNoteNo}`,
      body: `Qabul qildi: ${receiverName}`,
      link: { key: done ? "orders" : "trips", id: done ? t.orderId : id },
    });
    await notifyRoles(["LOGISTICS"], {
      type: "TRIP_DELIVERED",
      title: `Reys yetkazildi — ${t.deliveryNoteNo}`,
      body: `${t.order.orderNo} · qabul qildi: ${receiverName}`,
      link: { key: "trips", id },
      channel: "oddiy",
    }, { except: userId });
  });
  return { changed: true, orderId: t.orderId };
}

/**
 * Yukni olgan joyi — "Yuklandi" bosqichida logist belgilaydi.
 *
 * Nega alohida: mikser betonni doim zavoddan olmaydi (ikkinchi maydon, boshqa sklad,
 * pudratchi tuguni). Nuqta haydovchi ilovasida marshrutning boshlanishi bo'lib xizmat
 * qiladi va nakladnoyda "qayerdan chiqdi" savoliga javob bo'ladi.
 */
export async function tripPickup(
  id: string,
  userId: string,
  pickup: { address: string; lat?: number | null; lng?: number | null },
): Promise<TripResult> {
  const address = pickup.address.trim();
  if (!address) return { changed: false, orderId: "", error: "Yuk olingan joy manzilini yozing" };
  const t = await db.trip.findUniqueOrThrow({ where: { id } });
  if (t.status === "CANCELLED") return { changed: false, orderId: t.orderId, error: "Reys bekor qilingan" };
  const data = { pickupAddress: address, pickupLat: pickup.lat ?? null, pickupLng: pickup.lng ?? null };
  await db.trip.update({ where: { id }, data });
  await audit(db, userId, "UPDATE", "Trip", id, { pickupAddress: t.pickupAddress, pickupLat: t.pickupLat, pickupLng: t.pickupLng }, data);
  return { changed: true, orderId: t.orderId };
}

/** PLANNED → CANCELLED. */
export async function tripCancelled(id: string, userId: string, note?: string): Promise<TripResult> {
  const t = await db.trip.findUniqueOrThrow({ where: { id } });
  if (t.status !== "PLANNED") return { changed: false, orderId: t.orderId, error: "Faqat rejalashtirilgan reys bekor qilinadi" };
  await db.trip.update({ where: { id }, data: { status: "CANCELLED" } });
  await audit(db, userId, "STATUS_CHANGE", "Trip", id, { status: "PLANNED" }, { status: "CANCELLED", note });
  return { changed: true, orderId: t.orderId };
}

// ───────────────────────── Yo'l izi (GPS) ─────────────────────────

export type TrackPoint = { lat: number; lng: number; at: Date };

/**
 * Reysning bosib o'tgan yo'li — vaqt bo'yicha tartiblangan nuqtalar.
 *
 * Bu faqat ZAVOD haydovchilarining izi (ular ERP logini bilan kiradi). Tashqi pudratchi
 * haydovchilar Insof ECO ilovasidan yuradi va ularning izi ECO'da qoladi — xarita
 * ikkala manbani qo'shib ko'rsatadi (`lib/eco/client.ts`).
 */
export async function tripTrack(tripId: string): Promise<TrackPoint[]> {
  return db.tripPosition.findMany({ where: { tripId }, orderBy: { at: "asc" }, select: { lat: true, lng: true, at: true } });
}

/** Bitta reys bo'yicha iz xulosasi — oxirgi joylashuv va bosib o'tilgan yo'l. */
export type TripTrackStat = { last: TrackPoint; meters: number; points: number; minutes: number };

/**
 * GPS "titrashi": turgan mashina ham nuqtadan nuqtaga 2-10 metr sakrab turadi.
 * Shundan kichik siljishni yo'lga qo'shsak, hovlida tunagan mikser ertalabgacha
 * "10 km yurgan" bo'lib chiqardi.
 */
const JITTER_M = 12;
/**
 * Ikki nuqta orasidagi tanaffus shundan uzun bo'lsa — mashina yurmagan, shunchaki
 * ilova yopilgan yoki telefon o'chgan. Bunday tanaffus "yo'lda o'tgan vaqt" ga
 * qo'shilmaydi: aks holda tunab qolgan reys "17 soat yurgan" bo'lib ko'rinardi.
 */
const GAP_MS = 5 * 60_000;

/**
 * Nuqtalar ketma-ketligidan yo'l va harakat vaqti.
 *
 * Bitta joyda: ilovadagi raqam ham, vebdagi raqam ham shu yerdan chiqadi
 * (`lib/live.ts` ham shuni chaqiradi) — ikki joyda ikki xil hisoblansa ajralib ketardi.
 */
export function trackStats(points: TrackPoint[]): { meters: number; movingMs: number } {
  let meters = 0, movingMs = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    if (!a || !b) continue;
    const d = haversineMeters(a.lat, a.lng, b.lat, b.lng);
    if (d < JITTER_M) continue;
    const dt = b.at.getTime() - a.at.getTime();
    if (dt > GAP_MS) continue; // tanaffus — na yo'l, na vaqt
    meters += d;
    movingMs += Math.max(0, dt);
  }
  return { meters: Math.round(meters), movingMs };
}

/**
 * Bir nechta reysning oxirgi nuqtasi VA yurilgan masofasi.
 *
 * Masofa to'g'ri chiziq emas — nuqtadan nuqtaga qo'shib boriladi, ya'ni haqiqiy yo'l.
 * Hisob bu yerda, bitta so'rovda: xaritadagi ro'yxat ham, reys kartochkasi ham, haydovchining
 * o'z ekrani ham bir xil raqamni ko'rsatishi kerak — ikki joyda hisoblansa ular ajralib ketardi.
 */
export async function tripTrackStats(tripIds: string[]): Promise<Map<string, TripTrackStat>> {
  if (tripIds.length === 0) return new Map();
  const rows = await db.tripPosition.findMany({
    where: { tripId: { in: tripIds } },
    orderBy: { at: "asc" },
    select: { tripId: true, lat: true, lng: true, at: true },
  });
  const byTrip = new Map<string, TrackPoint[]>();
  for (const r of rows) byTrip.set(r.tripId, [...(byTrip.get(r.tripId) ?? []), { lat: r.lat, lng: r.lng, at: r.at }]);

  const out = new Map<string, TripTrackStat>();
  for (const [tripId, pts] of byTrip) {
    const last = pts[pts.length - 1];
    if (!last) continue;
    const { meters, movingMs } = trackStats(pts);
    out.set(tripId, { last, meters, points: pts.length, minutes: Math.round(movingMs / 60000) });
  }
  return out;
}

/** `12437` → `12.4 km`, `840` → `840 m`. Ro'yxatda ham, kartochkada ham bir xil ko'rinsin. */
export const distanceLabel = (meters: number) => (meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(1)} km`);

// ───────────────────────── Obyektga yetib kelish ─────────────────────────

/**
 * "Yetkazdim" shu radius ichida ochiladi.
 *
 * Nega kerak: nakladnoy yo'lda turib yopilsa, hujjatdagi yetkazilgan vaqt ham, obyektdagi
 * qabul qilgan kishi ham haqiqatga to'g'ri kelmaydi. 1 km — obyekt hovlisiga kirishdan
 * oldingi masofa: mashina yetib kelgan, lekin GPS xatosi tugmani bloklab qo'ymaydi.
 */
export const ARRIVE_RADIUS_M = 1000;

/**
 * Joylashuv shuncha vaqtdan eski bo'lsa "hozir shu yerda" deb bo'lmaydi.
 * Ilova nuqtalarni 30 soniyada bir yuboradi, aloqasiz joyda buferda saqlaydi —
 * shuning uchun bir necha daqiqalik kechikish odatiy hol, 15 daqiqalik esa emas.
 */
const FIX_MAX_AGE_MS = 15 * 60_000;

/**
 * Mashina obyektga yetib keldimi — "Yetkazdim" tugmasi shu javobga qarab ochiladi.
 *
 * Masofa to'g'ri chiziq bo'yicha (yo'l bo'yicha emas): "obyektdan 1 km narida" degani
 * fizik yaqinlik, u OSRM ishlayotgan-ishlamaganiga bog'liq bo'lmasligi kerak.
 *
 * Zayavkada koordinata bo'lmasa tekshiradigan narsa yo'q — tugma ochiq qoladi
 * (aks holda nuqtasi qo'yilmagan eski zayavkalarning reysi yopilmay qolardi).
 */
export type TripArrival = {
  destination: { lat: number; lng: number } | null;
  last: (TrackPoint & { ageMs: number }) | null;
  /** Obyektgacha to'g'ri chiziq, metr. Koordinata yoki joylashuv bo'lmasa — null. */
  remainingM: number | null;
  near: boolean;
  /** `near` false bo'lsa — haydovchiga ko'rsatiladigan sabab. */
  reason: string | null;
};

export async function tripArrival(tripId: string): Promise<TripArrival> {
  const t = await db.trip.findUnique({ where: { id: tripId }, select: { order: { select: { lat: true, lng: true } } } });
  const dest = t?.order.lat != null && t.order.lng != null ? { lat: t.order.lat, lng: t.order.lng } : null;
  if (!dest) return { destination: null, last: null, remainingM: null, near: true, reason: null };

  const p = await db.tripPosition.findFirst({ where: { tripId }, orderBy: { at: "desc" }, select: { lat: true, lng: true, at: true } });
  if (!p) return { destination: dest, last: null, remainingM: null, near: false, reason: "Joylashuv aniqlanmadi — GPS yoqilganini tekshiring" };

  const ageMs = Date.now() - p.at.getTime();
  const last = { lat: p.lat, lng: p.lng, at: p.at, ageMs };
  if (ageMs > FIX_MAX_AGE_MS) {
    return { destination: dest, last, remainingM: null, near: false, reason: "Joylashuv eskirgan — GPS yoqilganini tekshiring" };
  }
  const remainingM = Math.round(haversineMeters(p.lat, p.lng, dest.lat, dest.lng));
  if (remainingM > ARRIVE_RADIUS_M) {
    return { destination: dest, last, remainingM, near: false, reason: `Obyektgacha ${distanceLabel(remainingM)} — 1 km qolganda ochiladi` };
  }
  return { destination: dest, last, remainingM, near: true, reason: null };
}

// ───────────────────────── Tayyorlik: nima jo'natish mumkin ─────────────────────────

/**
 * Reys faqat brigada tayyorlab bergan miqdorga ochiladi.
 *
 * Nega: zayavkada 20 dona bo'lsa-yu brigada 10 tasini tayyorlagan bo'lsa, haydovchiga
 * 10 ta beriladi; qolgan 10 tasi hali sexda — nakladnoyga yozib bo'lmaydi. Ilgari qoldiq
 * "zayavka − jo'natilgan" edi va hali chiqmagan mahsulotga reys ochilib ketardi.
 *
 * Qator tayyorligi: brigada topshirig'i bo'lsa — brigadir tasdiqlagan `doneQty`;
 * beton (m³) uchun zames orqali quyilgani ham hisobga olinadi (u brigadaga bermay
 * to'g'ridan-to'g'ri zavodda quyilishi mumkin); topshiriqsiz dona mahsulot — hali 0.
 */
export type OrderReadiness = {
  /** Zayavkadagi jami miqdor */ total: number;
  /** Ishlab chiqarilgani (brigada tasdiqlagan yoki zames) — jamidan oshmaydi */ ready: number;
  /** Bekor qilinmagan reyslarga yozilgani */ shipped: number;
  /** Hozir reysga berish mumkin: tayyor − jo'natilgan */ available: number;
  /** Hali sexda: jami − tayyor */ inProduction: number;
  /** Birorta qatorga brigada tayinlanganmi */ hasTasks: boolean;
  /** Zayavka birligi ("m3", "dona"…); aralash bo'lsa null */ unit: string | null;
};

/** `orderReadiness` uchun kerakli include — veb forma, mobil forma va `createTrip` bir xil yuklaydi. */
export const READINESS_INCLUDE = {
  items: { include: { product: { select: { unit: true } }, task: { select: { doneQty: true, status: true } } } },
  trips: { select: { status: true, qtyM3: true } },
  batches: { select: { productId: true, qtyM3: true } },
} as const;

type ReadinessOrder = {
  items: { productId: string; qtyM3: unknown; product: { unit: string }; task: { doneQty: unknown; status: string } | null }[];
  trips: { status: string; qtyM3: unknown }[];
  batches: { productId: string; qtyM3: unknown }[];
};

const r3 = (n: number) => Math.round(n * 1000) / 1000;

export function orderReadiness(o: ReadinessOrder): OrderReadiness {
  let total = 0, ready = 0, hasTasks = false;
  for (const i of o.items) {
    const q = Number(i.qtyM3);
    total += q;
    let r = 0;
    if (i.task) { hasTasks = true; r = i.task.status === "CANCELLED" ? 0 : Number(i.task.doneQty); }
    // Beton uchun zames ham ishlab chiqarish tasdig'i — brigada qayd qilmagan bo'lsa ham quyilgani jo'natiladi
    if (i.product.unit === "m3") r = Math.max(r, o.batches.filter((b) => b.productId === i.productId).reduce((s, b) => s + Number(b.qtyM3), 0));
    ready += Math.min(q, r);
  }
  const shipped = o.trips.filter((t) => t.status !== "CANCELLED").reduce((s, t) => s + Number(t.qtyM3), 0);
  const unit = soleUnit(o.items.map((i) => ({ unit: i.product.unit, qty: i.qtyM3 as number })));
  return { total: r3(total), ready: r3(ready), shipped: r3(shipped), available: r3(Math.max(0, ready - shipped)), inProduction: r3(Math.max(0, total - ready)), hasTasks, unit };
}

/**
 * So'ralgan miqdor tayyor qoldiqdan ko'p bo'lsa — logistga tushunarli sabab.
 * Veb forma (klientda, yozayotganda) ham, `createTrip` (serverda) ham shu matnni ko'rsatadi.
 */
export function readinessError(rd: OrderReadiness, qty: number): string | null {
  if (qty <= rd.available + 0.001) return null;
  const u = rd.unit ? ` ${unitLabel(rd.unit)}` : "";
  if (rd.total - rd.shipped <= 0.001) return "Zayavka to'liq jo'natilgan";
  if (rd.ready <= 0.001) {
    return rd.hasTasks
      ? `Hali tayyor mahsulot yo'q — ${rd.inProduction}${u} ishlab chiqarilmoqda, brigada tasdiqini kuting`
      : `Zayavkaga brigada tayinlanmagan — avval Ishlab chiqarish bo'limida tayinlang`;
  }
  // Hammasi tayyor, faqat qolgani allaqachon jo'natilgan — sexda kutish gapi o'rinsiz
  if (rd.inProduction <= 0.001) return `Zayavkada faqat ${rd.available}${u} qoldi`;
  const head = rd.available > 0.001 ? `Faqat ${rd.available}${u} tayyor` : `Tayyor bo'lgani jo'natilgan`;
  return `${head}. Qolgan ${rd.inProduction}${u} ishlab chiqarilmoqda — brigada tasdiqini kuting`;
}

// ───────────────────────── Yangi reys ─────────────────────────

export type NewTripInput = { orderId: string; vehicleId: string; driverId: string; qtyM3: number; note?: string | null };

/**
 * Reys (nakladnoy) ochish — veb "Yangi reys" formasi ham, mobil ilova ham shu yerdan.
 * Tekshiruvlar: zayavka tasdiqlanganmi, qoldiq yetadimi, mikser sig'imi oshmaydimi.
 * ECO'ga yuborish chaqiruvchida (u yerda kutish/kutmaslik farq qiladi).
 */
export async function createTrip(input: NewTripInput, userId: string): Promise<{ id: string; deliveryNoteNo: string }> {
  if (!(input.qtyM3 > 0)) throw new Error("Miqdor 0 dan katta bo'lsin");
  const o = await db.order.findUnique({ where: { id: input.orderId }, include: READINESS_INCLUDE });
  if (!o || !["CONFIRMED", "IN_PRODUCTION"].includes(o.status)) throw new Error("Zayavka tasdiqlanmagan yoki yopilgan");

  // Faqat brigada tayyorlab bergani jo'natiladi — qolgani hali sexda
  const rd = orderReadiness(o);
  const notReady = readinessError(rd, input.qtyM3);
  if (notReady) throw new Error(notReady);

  const v = await db.vehicle.findUnique({ where: { id: input.vehicleId } });
  if (!v || !v.isActive) throw new Error("Texnika topilmadi yoki nofaol");
  if (v.type === "PUMP") throw new Error("Nasos yuk tashimaydi — mikser yoki yuk mashina tanlang");
  // Beton faqat mikserda ketadi; dona mahsulot (plita, blok) — yuk mashinada. Sig'im (m³) faqat mikserga tegishli.
  const items = o.items;
  const concrete = items.some((i) => i.product.unit === "m3");
  const piece = items.some((i) => i.product.unit !== "m3");
  if (concrete && !piece && v.type !== "MIXER") throw new Error("Beton zayavkasi — mikser tanlang");
  if (piece && !concrete && v.type !== "TRUCK") throw new Error("Dona mahsulot (plita, blok) mikserda ketmaydi — yuk mashina tanlang");
  if (v.type === "MIXER" && v.capacityM3 && input.qtyM3 > Number(v.capacityM3)) throw new Error(`Mikser sig'imi ${v.capacityM3} m³`);

  const d = await db.employee.findUnique({ where: { id: input.driverId } });
  if (!d || !d.isActive) throw new Error("Haydovchi topilmadi yoki nofaol");

  const created = await db.$transaction(async (tx) => {
    const t = await tx.trip.create({
      data: { deliveryNoteNo: await nextNo(tx, "trip", "N"), orderId: input.orderId, vehicleId: input.vehicleId, driverId: input.driverId, qtyM3: input.qtyM3, note: input.note ?? undefined },
    });
    await audit(tx, userId, "CREATE", "Trip", t.id, undefined, t);
    return { id: t.id, deliveryNoteNo: t.deliveryNoteNo };
  });

  // Haydovchi reys biriktirilganini BILISHI kerak — u ro'yxatni kutib o'tirmaydi,
  // mashinada yoki hovlida bo'ladi. Shu sababli bu eng muhim bildirishnoma.
  const unit = soleUnit(items.map((i) => ({ unit: i.product.unit, qty: i.qtyM3 })));
  notifyAfter(() => notifyEmployees([input.driverId], {
    type: "TRIP_ASSIGNED",
    title: `Yangi reys — ${created.deliveryNoteNo}`,
    body: `${input.qtyM3}${unit ? ` ${unitLabel(unit)}` : ""} · ${v.plate} · ${o.deliveryAddress}`,
    link: { key: "trips", id: created.id },
  }));
  return created;
}
