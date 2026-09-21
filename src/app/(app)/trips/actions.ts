"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { parseForm, zStr, zOpt, type ActionState } from "@/lib/action";
import { createTrip as createTripDomain, tripCancelled, tripDelivered, tripLoaded, tripOnRoad } from "@/lib/trips";
import { pushTripStatus, pushTripToEco, pullTripFromEco } from "@/lib/eco/sync";
import { ecoEnabled } from "@/lib/eco/client";

const schema = z.object({
  orderId: zStr("Zayavka tanlanmagan"),
  vehicleId: zStr("Mikser tanlanmagan"),
  driverId: zStr("Haydovchi tanlanmagan"),
  qtyM3: z.coerce.number().positive("miqdor 0 dan katta bo'lsin"),
  note: zOpt,
});

function refresh(id: string, orderId: string) {
  revalidatePath(`/trips/${id}`); revalidatePath("/trips"); revalidatePath(`/orders/${orderId}`); revalidatePath("/drivers");
}

export async function createTrip(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireSession(["LOGISTICS", "PRODUCTION"]);
  const r = parseForm(schema, fd);
  if ("error" in r) return { error: r.error };
  const d = r.data;

  let created;
  try {
    // Qoida `lib/trips.ts` da — mobil ilovadagi "Yangi reys" ham shuni chaqiradi
    created = await createTripDomain({ orderId: d.orderId, vehicleId: d.vehicleId, driverId: d.driverId, qtyM3: d.qtyM3, note: d.note }, s.userId);
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
  const r = await tripDelivered(id, s.userId, receiverName);
  if (r.error) return { error: r.error };
  if (r.changed && ecoEnabled()) after(() => pushTripStatus(id, "COMPLETED", { note: `Qabul qildi: ${receiverName}` }));
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
