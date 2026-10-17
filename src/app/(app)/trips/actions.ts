"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { db } from "@/lib/db";
import { requireAction } from "@/lib/auth";
import { parseForm, zStr, zOpt, type ActionState } from "@/lib/action";
import { createTrip as createTripDomain, reportTripIssue, resolveTripIssue, tripCancelled, tripClosed, tripLoaded, tripPickup, type DeliveryQty } from "@/lib/trips";
import { addTripCostRecord, dispatchDelivered, dispatchOnRoad } from "@/lib/trip-dispatch";
import type { TripIssueKind } from "@/generated/prisma";
import { pushTripStatus, pushTripToEco, pullTripFromEco } from "@/lib/eco/sync";
import { ecoEnabled } from "@/lib/eco/client";

const schema = z.object({
  orderId: zStr("Zayavka tanlanmagan"),
  vehicleId: zStr("Mikser tanlanmagan"),
  driverId: zStr("Haydovchi tanlanmagan"),
  qtyM3: z.coerce.number().positive("miqdor 0 dan katta bo'lsin"),
  note: zOpt,
  plannedAt: zOpt,
});

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

export async function createTrip(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("trips", "create");
  const r = parseForm(schema, fd);
  if ("error" in r) return { error: r.error };
  const d = r.data;

  let created;
  try {
    // Qoida `lib/trips.ts` da — mobil ilovadagi "Yangi reys" ham shuni chaqiradi
    created = await createTripDomain({ orderId: d.orderId, vehicleId: d.vehicleId, driverId: d.driverId, qtyM3: d.qtyM3, note: d.note, plannedAt: d.plannedAt ? new Date(d.plannedAt) : null }, s.userId);
  } catch (e) {
    return { error: (e as Error).message };
  }

  // Haydovchi ilovasiga yuborish — reys sahifasi ochilganda ECO holati darhol ko'rinishi uchun kutamiz
  // (klientda 10 s timeout; xato bo'lsa reys baribir yaratiladi, xabar reys sahifasida chiqadi)
  if (ecoEnabled()) await pushTripToEco(created.id);
  revalidatePath("/trips"); revalidatePath(`/orders/${d.orderId}`);
  redirect(`/trips/${created.id}`);
}

// Yo'l bosqichlarini odatda haydovchi o'z ilovasidan belgilaydi (`lib/mobile/actions.ts`), ECO webhook'i ham
// shu yo'ldan keladi. Haydovchida ilova bo'lmasa (telefon o'chgan, pudratchi) dispetcher vebdan
// "Yo'lga chiqdi" va "Yetkazildi"ni belgilaydi — bu audit jurnaliga "dispetcher belgiladi" deb yoziladi,
// yetkazish esa GPS tasdig'isiz bo'lgani uchun reysga muammo sifatida tushadi (yopishdan oldin ko'riladi).

/** PLANNED → LOADED: mikser zavodda yuklandi, tayyor beton skladdan chiqadi (SHIPMENT). Ishlab chiqarish tasdiqlaydi. */
export async function markLoaded(id: string): Promise<ActionState> {
  const s = await requireAction("trips", "load");
  const r = await tripLoaded(id, s.userId);
  if (r.changed && ecoEnabled()) after(() => pushTripStatus(id, "LOADING"));
  refresh(id, r.orderId); revalidatePath("/stock");
  if (r.error) return { error: r.error };
  return { ok: true };
}

/** LOADED → ON_ROAD — dispetcher vebdan (haydovchi ilovasi ishlamaganda). Qoida — `lib/trip-dispatch.ts` (mobil ham). */
export async function markOnRoad(id: string): Promise<ActionState> {
  const s = await requireAction("trips", "move");
  const r = await dispatchOnRoad(id, s.userId);
  if ("error" in r) return { error: r.error };
  if (r.changed && ecoEnabled()) after(() => pushTripStatus(id, "EN_ROUTE"));
  refresh(id, r.orderId);
  return { ok: true };
}

/** LOADED / ON_ROAD → DELIVERED — dispetcher vebdan: qabul qilgan kishi va miqdorlar bilan. */
export async function markDelivered(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("trips", "move");
  const receiverName = String(fd.get("receiverName") ?? "").trim();
  const q = qtyFrom(fd);
  // Haydovchi tasdig'i ham, GPS ham yo'q — reysga muammo yoziladi (`dispatchDelivered`), hal qilinmaguncha yopilmaydi
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



export async function cancelTrip(id: string) {
  const s = await requireAction("trips", "cancel");
  const r = await tripCancelled(id, s.userId);
  if (r.changed && ecoEnabled()) after(() => pushTripStatus(id, "CANCELLED"));
  refresh(id, r.orderId);
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
  const s = await requireAction("trips", "move");
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
