"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { db } from "@/lib/db";
import { requireAction, requireSession } from "@/lib/auth";
import { parseForm, zStr, zOpt, type ActionState } from "@/lib/action";
import { createTrip as createTripDomain, ECO_EDITABLE, hideExternalCar, reportTripIssue, resolveTripIssue, revertTripLoad, setTripTtn, tripCancelled, tripClosed, tripLoaded, tripPickup, updatePlannedTrip, type DeliveryQty, type TripEditInput } from "@/lib/trips";
import { addTripCostRecord, dispatchDelivered, dispatchOnRoad, dispatchStep, DRIVER_STEPS, type DriverStep } from "@/lib/trip-dispatch";
import type { TripIssueKind } from "@/generated/prisma";
import { pushTripStatus, pushTripToEco, pullTripFromEco } from "@/lib/eco/sync";
import { ecoEnabled } from "@/lib/eco/client";
import { ecoLabel } from "@/lib/eco/labels";
import { purgeCancelledTrip } from "@/lib/purge-cancelled";

const schema = z.object({
  orderId: zStr("Zayavka tanlanmagan"),
  // Ko'chadan mashinada (external=1) o'z texnikamiz va haydovchimiz tanlanmaydi
  vehicleId: zOpt,
  driverId: zOpt,
  qtyM3: z.coerce.number().positive("miqdor 0 dan katta bo'lsin"),
  note: zOpt,
  plannedAt: zOpt,
  bru: zOpt,
  ttn: zOpt,
  driverReason: zOpt,
  external: zOpt,
  extType: z.enum(["MIXER", "TRUCK"]).optional().catch(undefined),
  extPlate: zOpt,
  extCapacity: zOpt,
  extDriverName: zOpt,
  extDriverPhone: zOpt,
});

/** Tahrir formasi: zayavka va TTN o'zgarmaydi (TTN — reys sahifasidagi alohida forma). */
const editSchema = schema.omit({ orderId: true, ttn: true });

function refresh(id: string, orderId: string) {
  revalidatePath(`/trips/${id}`); revalidatePath("/trips"); revalidatePath(`/orders/${orderId}`); revalidatePath("/drivers");
  revalidatePath("/dashboard"); revalidatePath("/logistika", "layout");
}

/** Forma raqami: "12,5" ham, bo'sh ham bo'lishi mumkin (bo'sh — berilmagan). */
const numOrNull = (v: FormDataEntryValue | null) => {
  const t = String(v ?? "").replace(/\s+/g, "").replace(",", ".");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};
const qtyFrom = (fd: FormData): DeliveryQty => ({
  acceptedQty: numOrNull(fd.get("acceptedQty")),
  returnedQty: numOrNull(fd.get("returnedQty")),
  comment: String(fd.get("comment") ?? "").trim() || null,
});

/**
 * Forma → reys ma'lumoti: o'z texnikamiz yoki ko'chadan mashina. «Yangi reys» va rejadagi reys tahriri uchun bitta;
 * qolgan qoidalar — `lib/trips.ts` (`checkTrip`).
 */
function tripFields(d: z.infer<typeof editSchema>): TripEditInput | { error: string } {
  const ext = d.external === "1";
  if (ext && !d.extType) return { error: "Ko'chadan mashina: kategoriyasini tanlang" };
  if (!ext && !d.vehicleId) return { error: "Texnika tanlanmagan" };
  if (!ext && !d.driverId) return { error: "Haydovchi tanlanmagan" };
  const extCapacity = numOrNull(d.extCapacity);
  if (ext && d.extCapacity && extCapacity == null) return { error: "Ko'chadan mashina: sig'imi raqam bo'lsin" };
  return {
    vehicleId: d.vehicleId ?? "", driverId: d.driverId ?? "", qtyM3: d.qtyM3, note: d.note, plannedAt: d.plannedAt ? new Date(d.plannedAt) : null, bru: d.bru, driverReason: d.driverReason,
    external: ext ? { type: d.extType!, plate: d.extPlate ?? "", capacity: extCapacity, driverName: d.extDriverName ?? "", driverPhone: d.extDriverPhone ?? "" } : null,
  };
}

export async function createTrip(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("trips", "create");
  const r = parseForm(schema, fd);
  if ("error" in r) return { error: r.error };
  const d = r.data;
  const f = tripFields(d);
  if ("error" in f) return { error: f.error };

  let created;
  try {
    // Qoida `lib/trips.ts` da — mobil ilovadagi "Yangi reys" ham shuni chaqiradi
    created = await createTripDomain({ ...f, orderId: d.orderId, ttn: d.ttn }, s.userId);
  } catch (e) {
    return { error: (e as Error).message };
  }

  // Haydovchi ilovasiga yuborish — reys sahifasi ochilganda ECO holati darhol ko'rinishi uchun kutamiz
  // (klientda 10 s timeout; xato bo'lsa reys baribir yaratiladi, xabar reys sahifasida chiqadi).
  // Ko'chadan mashina haydovchisida ilova yo'q — `pushTripToEco` uni o'zi o'tkazib yuboradi
  if (ecoEnabled()) await pushTripToEco(created.id);
  revalidatePath("/trips"); revalidatePath(`/orders/${d.orderId}`);
  redirect(`/trips/${created.id}`);
}

/**
 * Rejadagi reysni tahrirlash (reys sahifasi → «Tahrirlash»): texnika, haydovchi, miqdor, vaqt, BRU, izoh.
 * Qoidalar — `lib/trips.ts` (`updatePlannedTrip`). Keyin reys haydovchi ilovasiga yaratishdagi kabi qayta yuboriladi.
 */
export async function updateTrip(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("trips", "create");
  const r = parseForm(editSchema, fd);
  if ("error" in r) return { error: r.error };
  const f = tripFields(r.data);
  if ("error" in f) return { error: f.error };
  let res;
  try {
    res = await updatePlannedTrip(id, f, s.userId);
  } catch (e) {
    return { error: (e as Error).message };
  }
  // Yaratishdagi kabi kutamiz — reys sahifasida ECO holati darhol ko'rinsin (ko'chadan mashinani `pushTripToEco` o'tkazib yuboradi)
  if (res.changed && ecoEnabled()) {
    await pushTripToEco(id);
    await flagEcoKept(id);
  }
  refresh(id, res.orderId);
  redirect(`/trips/${id}`);
}

/**
 * ECO reysni haydovchi qabul qilgandan keyin yangilamaydi. Tahrir shu orada qabul qilingan reysga tushgan bo'lsa
 * (ERP'dagi ECO holati eskirgan edi) — ilovada eski ma'lumot qolganini reys kartasida ko'rsatamiz.
 */
async function flagEcoKept(id: string) {
  const t = await db.trip.findUnique({ where: { id }, select: { ecoDeliveryId: true, ecoStatus: true, ecoError: true } });
  if (!t?.ecoDeliveryId || !t.ecoStatus || ECO_EDITABLE.includes(t.ecoStatus) || t.ecoError) return;
  const st = ecoLabel(t.ecoStatus)?.label ?? t.ecoStatus;
  await db.trip.update({ where: { id }, data: { ecoError: `Tahrir haydovchi ilovasiga bormadi: ECO'da reys «${st}». Haydovchiga qo'ng'iroq qiling yoki reysni o'chirib, yangisini oching` } });
}

/**
 * Yuklashni bekor qilish (storno) — faqat direktor: yuklangan, hali yo'lga chiqmagan reys rejaga qaytadi, skladdan chiqim
 * (va yuklashda yozilgan avtomatik zames) teskari yoziladi. Qoidalar — `lib/trips.ts` (`revertTripLoad`).
 *
 * ECO'da orqaga yo'l yo'q (ECO `setStatus` faqat oldinga yuradi, `upsertTrip` boshlangan reysni o'zgartirmaydi) —
 * ilovada reys «Yuklanmoqda» bo'lib qoladi. Buni reys kartasida ko'rsatamiz; haydovchiga bildirishnoma `lib/trips.ts` da.
 */
export async function revertLoad(id: string, reason = ""): Promise<ActionState> {
  const s = await requireSession(["DIRECTOR"]);
  const r = await revertTripLoad(id, s.userId, reason);
  if (r.error) return { error: r.error };
  if (r.changed && ecoEnabled()) {
    const t = await db.trip.findUnique({ where: { id }, select: { ecoDeliveryId: true, ecoStatus: true, vehicle: { select: { external: true } } } });
    if (t?.ecoDeliveryId && !t.vehicle.external && t.ecoStatus && !["ASSIGNED", "ACCEPTED", "DECLINED"].includes(t.ecoStatus)) {
      const st = ecoLabel(t.ecoStatus)?.label ?? t.ecoStatus;
      await db.trip.update({ where: { id }, data: { ecoError: `Yuklash bekor qilindi, lekin haydovchi ilovasida reys «${st}» bo'lib qoldi — ECO'da orqaga qaytarib bo'lmaydi. Ilovada keyingi bosqich bosilsa yoki «ECO'dan yangilash» bosilsa, reys qayta yuklanadi (skladdan yana chiqim). Reys kerak bo'lmasa — o'chiring, ECO'da ham yopiladi` } });
    }
  }
  refresh(id, r.orderId); revalidatePath("/stock"); revalidatePath("/production", "layout");
  return { ok: true, note: r.note };
}

/** Reys TTN raqami — reysni ochgan kishi yozadi/tuzatadi (reys sahifasi va Logistika → Realizatsiya katagi). */
export async function saveTripTtn(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("trips", "create");
  const r = await setTripTtn(id, String(fd.get("ttn") ?? ""), s.userId);
  if ("error" in r) return { error: r.error };
  revalidatePath(`/trips/${id}`); revalidatePath("/trips"); revalidatePath("/logistika", "layout");
  return { ok: true };
}

/** «Yangi reys»dagi saqlangan ko'chadan mashinalar ro'yxatidan olish (yozuv va reyslari qoladi). */
export async function hideExternalVehicle(id: string): Promise<ActionState> {
  const s = await requireAction("trips", "create");
  try {
    await hideExternalCar(id, s.userId);
  } catch (e) {
    return { error: (e as Error).message };
  }
  revalidatePath("/trips/new");
  return { ok: true };
}

// Yo'l bosqichlarini odatda haydovchi o'z ilovasidan belgilaydi (`lib/mobile/actions.ts`), ECO webhook'i ham
// shu yo'ldan keladi. Haydovchida ilova bo'lmasa (hozircha — hammasida) dispetcher reys kartasidagi «Haydovchi o'rniga»
// blokidan uning hamma tugmasini bosadi: yukladim → yo'lga chiqdim → yetib keldim → tushirishni boshladim → yetkazdim →
// zavodga qaytdim. Auditda "dispetcher belgiladi" bo'lib qoladi; qoidalar — `lib/trip-dispatch.ts` (mobil ham).

/** Haydovchi o'rniga bosish: `trips → driver` (logistika, dispetcher) yoki eski `move` ruxsati. */
async function requireDriverStand() {
  try { return await requireAction("trips", "driver"); } catch { return requireAction("trips", "move"); }
}

const STEP_ECO = { loaded: "LOADING", arrived: "ARRIVED", unloading: "UNLOADING" } as const;

/** «Yukladim», «Yetib keldim», «Tushirishni boshladim», «Zavodga qaytdim» — haydovchi o'rniga. */
export async function driverStep(id: string, step: DriverStep): Promise<ActionState> {
  const s = await requireDriverStand();
  if (!(DRIVER_STEPS as readonly string[]).includes(step)) return { error: "Bosqich noto'g'ri" };
  const r = await dispatchStep(id, s.userId, step);
  if ("error" in r) return { error: r.error };
  const eco = step === "returned" ? null : STEP_ECO[step];
  if (r.changed && eco && ecoEnabled()) after(() => pushTripStatus(id, eco));
  refresh(id, r.orderId);
  if (step === "loaded") revalidatePath("/stock");
  return { ok: true };
}

/** PLANNED → LOADED: mikser zavodda yuklandi, tayyor beton skladdan chiqadi (SHIPMENT). Ishlab chiqarish tasdiqlaydi. */
export async function markLoaded(id: string): Promise<ActionState> {
  const s = await requireAction("trips", "load");
  const r = await tripLoaded(id, s.userId);
  if (r.changed && ecoEnabled()) after(() => pushTripStatus(id, "LOADING"));
  refresh(id, r.orderId); revalidatePath("/stock");
  if (r.error) return { error: r.error };
  return { ok: true };
}

/** LOADED → ON_ROAD — «Yo'lga chiqdim» haydovchi o'rniga. Qoida — `lib/trip-dispatch.ts` (mobil ham). */
export async function markOnRoad(id: string): Promise<ActionState> {
  const s = await requireDriverStand();
  const r = await dispatchOnRoad(id, s.userId);
  if ("error" in r) return { error: r.error };
  if (r.changed && ecoEnabled()) after(() => pushTripStatus(id, "EN_ROUTE"));
  refresh(id, r.orderId);
  return { ok: true };
}

/**
 * LOADED / ON_ROAD → DELIVERED — «Yetkazdim» haydovchi o'rniga: qabul qilgan kishi, miqdorlar, mikser aylantirish soni.
 * Keyin klient shu mashinaning Hisob varag'ini reys qatori tahriri bilan ochadi (km, baraban soati, zapravka, haq).
 */
export async function markDelivered(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireDriverStand();
  const receiverName = String(fd.get("receiverName") ?? "").trim();
  const q = { ...qtyFrom(fd), drumTurns: numOrNull(fd.get("drumTurns")), workHours: numOrNull(fd.get("workHours")) };
  // Haydovchi ilovasi shu reysda ulangan bo'lsa — reysga muammo yoziladi (`dispatchDelivered`), hal qilinmaguncha yopilmaydi
  const r = await dispatchDelivered(id, s.userId, receiverName, q);
  if ("error" in r) return { error: r.error };
  if (ecoEnabled()) after(() => pushTripStatus(id, "COMPLETED", { note: `Qabul qildi: ${receiverName}`, acceptedM3: q.acceptedQty ?? undefined }));
  refresh(id, r.orderId); revalidatePath("/stock");
  return { ok: true };
}

const pickupSchema = z.object({
  pickupAddress: zStr("Yuk olingan joy manzilini yozing"),
  // Xaritadan belgilangan nuqta — bo'sh bo'lishi mumkin, manzil matni baribir saqlanadi
  pickupLat: z.coerce.number().optional().catch(undefined),
  pickupLng: z.coerce.number().optional().catch(undefined),
});

/** "Yuklandi" bosqichidagi "Yukni olgani joyi" formasi. */
export async function saveTripPickup(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("trips", "create");
  const r = parseForm(pickupSchema, fd);
  if ("error" in r) return { error: r.error };
  const d = r.data;
  const res = await tripPickup(id, s.userId, {
    address: d.pickupAddress,
    lat: Number.isFinite(d.pickupLat) ? d.pickupLat : null,
    lng: Number.isFinite(d.pickupLng) ? d.pickupLng : null,
  });
  if (res.error) return { error: res.error };
  refresh(id, res.orderId);
  return { ok: true };
}



/**
 * Reysni o'chirish (Reyslar ro'yxati va reys sahifasidagi «O'chirish»): faqat rejalashtirilgan — hali
 * yuklanmagan reys. Yuklangandan keyin skladdan chiqim yozilgan, uni o'chirib bo'lmaydi.
 * `reason` haydovchiga boradigan xabarga va auditga yoziladi.
 */
export async function cancelTrip(id: string, reason = ""): Promise<ActionState> {
  const s = await requireAction("trips", "cancel");
  const r = await tripCancelled(id, s.userId, reason.trim() || undefined);
  if (r.error) return { error: `${r.error}: yuklangan reysda skladdan chiqim yozilgan, uni o'chirib bo'lmaydi` };
  if (r.changed) {
    // ECO o'z yetkazmasini yopsin (reysni bazadan o'qiydi), keyin reys butunlay o'chadi — hech qayerda qolmaydi
    if (ecoEnabled()) await pushTripStatus(id, "CANCELLED").catch(() => undefined);
    await purgeCancelledTrip(id, s.userId);
  }
  refresh(id, r.orderId);
  return { ok: true };
}

/** Reys sahifasidagi "ECO'ga yuborish / yangilash" tugmasi. */
export async function syncTripWithEco(id: string, mode: "push" | "pull"): Promise<ActionState> {
  await requireAction("trips", "create");
  const t = await db.trip.findUniqueOrThrow({ where: { id }, select: { orderId: true } });
  const r = mode === "push" ? await pushTripToEco(id) : await pullTripFromEco(id);
  refresh(id, t.orderId); revalidatePath("/stock");
  if (r.skipped) return { error: "ECO ulanmagan — .env da ECO_API_URL va ECO_API_KEY ni bering" };
  return r.ok ? { ok: true } : { error: r.error };
}




/** Reysni yopish: qabul qilingan / qaytarilgan miqdor tasdiqlanadi. */
export async function closeTrip(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("trips", "move");
  const r = await tripClosed(id, s.userId, qtyFrom(fd));
  if (r.error) return { error: r.error };
  refresh(id, r.orderId);
  return r.warning ? { ok: true, note: r.warning } : { ok: true };
}

const ISSUE_KINDS = ["BREAKDOWN", "TRAFFIC", "SITE_NOT_READY", "QUALITY", "ACCIDENT", "DECLINED", "OTHER"] as const;

export async function reportIssue(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("trips", "issue");
  const kind = String(fd.get("kind") ?? "") as TripIssueKind;
  if (!(ISSUE_KINDS as readonly string[]).includes(kind)) return { error: "Muammo turini tanlang" };
  try { await reportTripIssue(id, s.userId, { kind, note: String(fd.get("note") ?? ""), source: "LOGISTICS" }); }
  catch (e) { return { error: (e as Error).message }; }
  const t = await db.trip.findUniqueOrThrow({ where: { id }, select: { orderId: true } });
  refresh(id, t.orderId);
  return { ok: true };
}

export async function resolveIssue(issueId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("trips", "resolve");
  try {
    const r = await resolveTripIssue(issueId, s.userId, String(fd.get("resolution") ?? ""));
    const t = await db.trip.findUniqueOrThrow({ where: { id: r.tripId }, select: { orderId: true } });
    refresh(r.tripId, t.orderId);
  } catch (e) { return { error: (e as Error).message }; }
  return { ok: true };
}

/** Reys kartasidan yoqilg'i yoki xarajat qo'shish — transport/haydovchi reysdan olinadi. */
export async function addTripCost(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("trips", "cost");
  const r = await addTripCostRecord(id, {
    what: String(fd.get("what") ?? ""), fuelType: String(fd.get("fuelType") ?? ""),
    liters: numOrNull(fd.get("liters")), pricePerL: numOrNull(fd.get("pricePerL")),
    odometerKm: numOrNull(fd.get("odometerKm")), station: String(fd.get("station") ?? ""),
    amount: numOrNull(fd.get("amount")), note: String(fd.get("note") ?? ""),
  }, s.userId);
  if ("error" in r) return { error: r.error };
  refresh(id, r.orderId);
  return { ok: true };
}
