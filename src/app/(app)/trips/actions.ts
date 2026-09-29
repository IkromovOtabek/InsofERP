"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { parseForm, zStr, zOpt, type ActionState } from "@/lib/action";
import { createTrip as createTripDomain, reportTripIssue, resolveTripIssue, tripArrived, tripCancelled, tripClosed, tripDelivered, tripLoaded, tripOnRoad, tripPickup, tripReturned, tripUnloading, type DeliveryQty } from "@/lib/trips";
import { addFuelLog, addTransportExpense } from "@/lib/logistics-costs";
import type { FuelType, TransportExpenseKind, TripIssueKind } from "@/generated/prisma";
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
  const s = await requireSession(["LOGISTICS", "PRODUCTION"]);
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

/** PLANNED → LOADED: tayyor beton skladdan chiqadi (SHIPMENT). */
export async function markLoaded(id: string) {
  const s = await requireSession(["LOGISTICS", "PRODUCTION"]);
  const r = await tripLoaded(id, s.userId);
  if (r.changed && ecoEnabled()) after(() => pushTripStatus(id, "LOADING"));
  refresh(id, r.orderId); revalidatePath("/stock");
}

const pickupSchema = z.object({
  pickupAddress: zStr("Yuk olingan joy manzilini yozing"),
  // Xaritadan belgilangan nuqta — bo'sh bo'lishi mumkin, manzil matni baribir saqlanadi
  pickupLat: z.coerce.number().optional().catch(undefined),
  pickupLng: z.coerce.number().optional().catch(undefined),
});

/** "Yuklandi" bosqichidagi "Yukni olgani joyi" formasi. */
export async function saveTripPickup(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireSession(["LOGISTICS", "PRODUCTION"]);
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

export async function markOnRoad(id: string) {
  const s = await requireSession(["LOGISTICS"]);
  const r = await tripOnRoad(id, s.userId);
  if (r.changed && ecoEnabled()) after(() => pushTripStatus(id, "EN_ROUTE"));
  refresh(id, r.orderId);
}

/** → DELIVERED. Zayavkaning hamma hajmi yetkazilgan bo'lsa — zayavka DELIVERED. */
export async function markDelivered(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireSession(["LOGISTICS"]);
  const receiverName = String(fd.get("receiverName") ?? "").trim();
  if (!receiverName) return { error: "Qabul qilgan shaxsni kiriting" };
  const q = qtyFrom(fd);
  const r = await tripDelivered(id, s.userId, receiverName, undefined, q);
  if (r.error) return { error: r.error };
  if (r.changed && ecoEnabled()) after(() => pushTripStatus(id, "COMPLETED", { note: `Qabul qildi: ${receiverName}`, acceptedM3: q.acceptedQty ?? undefined }));
  refresh(id, r.orderId);
  return { ok: true };
}

export async function cancelTrip(id: string) {
  const s = await requireSession(["LOGISTICS"]);
  const r = await tripCancelled(id, s.userId);
  if (r.changed && ecoEnabled()) after(() => pushTripStatus(id, "CANCELLED"));
  refresh(id, r.orderId);
}

/** Reys sahifasidagi "ECO'ga yuborish / yangilash" tugmasi. */
export async function syncTripWithEco(id: string, mode: "push" | "pull"): Promise<ActionState> {
  await requireSession(["LOGISTICS", "PRODUCTION"]);
  const t = await db.trip.findUniqueOrThrow({ where: { id }, select: { orderId: true } });
  const r = mode === "push" ? await pushTripToEco(id) : await pullTripFromEco(id);
  refresh(id, t.orderId); revalidatePath("/stock");
  if (r.skipped) return { error: "ECO ulanmagan — .env da ECO_API_URL va ECO_API_KEY ni bering" };
  return r.ok ? { ok: true } : { error: r.error };
}

// ───────────────────────── Yo'l bosqichlari (Logistika TZ) ─────────────────────────

export async function markArrived(id: string) {
  const s = await requireSession(["LOGISTICS"]);
  const r = await tripArrived(id, s.userId, "Dispetcher belgiladi");
  if (r.changed && ecoEnabled()) after(() => pushTripStatus(id, "ARRIVED"));
  refresh(id, r.orderId);
}

export async function markUnloading(id: string) {
  const s = await requireSession(["LOGISTICS"]);
  const r = await tripUnloading(id, s.userId, "Dispetcher belgiladi");
  if (r.changed && ecoEnabled()) after(() => pushTripStatus(id, "UNLOADING"));
  refresh(id, r.orderId);
}

export async function markReturned(id: string) {
  const s = await requireSession(["LOGISTICS"]);
  const r = await tripReturned(id, s.userId);
  refresh(id, r.orderId);
}

/** Reysni yopish: qabul qilingan / qaytarilgan miqdor tasdiqlanadi. */
export async function closeTrip(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireSession(["LOGISTICS"]);
  const r = await tripClosed(id, s.userId, qtyFrom(fd));
  if (r.error) return { error: r.error };
  refresh(id, r.orderId);
  return { ok: true };
}

const ISSUE_KINDS = ["BREAKDOWN", "TRAFFIC", "SITE_NOT_READY", "QUALITY", "ACCIDENT", "DECLINED", "OTHER"] as const;

export async function reportIssue(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireSession(["LOGISTICS", "PRODUCTION"]);
  const kind = String(fd.get("kind") ?? "") as TripIssueKind;
  if (!(ISSUE_KINDS as readonly string[]).includes(kind)) return { error: "Muammo turini tanlang" };
  try { await reportTripIssue(id, s.userId, { kind, note: String(fd.get("note") ?? ""), source: "LOGISTICS" }); }
  catch (e) { return { error: (e as Error).message }; }
  const t = await db.trip.findUniqueOrThrow({ where: { id }, select: { orderId: true } });
  refresh(id, t.orderId);
  return { ok: true };
}

export async function resolveIssue(issueId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireSession(["LOGISTICS"]);
  try {
    const r = await resolveTripIssue(issueId, s.userId, String(fd.get("resolution") ?? ""));
    const t = await db.trip.findUniqueOrThrow({ where: { id: r.tripId }, select: { orderId: true } });
    refresh(r.tripId, t.orderId);
  } catch (e) { return { error: (e as Error).message }; }
  return { ok: true };
}

const FUEL_TYPES = ["DIESEL", "PETROL", "METHANE", "PROPANE"] as const;
const EXPENSE_KINDS = ["DRIVER_PAY", "ROAD", "REPAIR", "PARTS", "PARKING", "FINE", "WASH", "OTHER"] as const;

/** Reys kartasidan yoqilg'i yoki xarajat qo'shish — transport/haydovchi reysdan olinadi. */
export async function addTripCost(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireSession(["LOGISTICS", "ACCOUNTING"]);
  const t = await db.trip.findUnique({ where: { id }, select: { vehicleId: true, driverId: true, orderId: true } });
  if (!t) return { error: "Reys topilmadi" };
  const what = String(fd.get("what") ?? "");
  try {
    if (what === "FUEL") {
      const fuelType = String(fd.get("fuelType") ?? "") as FuelType;
      await addFuelLog({
        vehicleId: t.vehicleId, driverId: t.driverId, tripId: id,
        fuelType: (FUEL_TYPES as readonly string[]).includes(fuelType) ? fuelType : null,
        liters: numOrNull(fd.get("liters")) ?? 0, pricePerL: numOrNull(fd.get("pricePerL")) ?? 0,
        odometerKm: numOrNull(fd.get("odometerKm")), station: String(fd.get("station") ?? ""), note: String(fd.get("note") ?? ""),
      }, s.userId);
    } else {
      const kind = what as TransportExpenseKind;
      if (!(EXPENSE_KINDS as readonly string[]).includes(kind)) return { error: "Xarajat turini tanlang" };
      await addTransportExpense({ kind, amount: numOrNull(fd.get("amount")) ?? 0, tripId: id, note: String(fd.get("note") ?? "") }, s.userId);
    }
  } catch (e) { return { error: (e as Error).message }; }
  refresh(id, t.orderId);
  return { ok: true };
}
