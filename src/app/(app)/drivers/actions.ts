"use server";
import { driverPositionNames } from "@/lib/positions";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireAction } from "@/lib/auth";
import { ecoEnabled, EcoError } from "@/lib/eco/client";
import { approveDriverInEco, linkDriverToEco } from "@/lib/eco/driver-link";
import { pushTripToEco } from "@/lib/eco/sync";
import { applyEcoDriver, pushVehicleToEco, syncDirectories } from "@/lib/eco/people";
import type { ActionState } from "@/lib/action";

const msg = (e: unknown) => (e instanceof EcoError ? e.message : String((e as Error)?.message ?? e));
const guard = () => (ecoEnabled() ? null : { error: "ECO ulanmagan — .env da ECO_API_URL va ECO_API_KEY ni bering" });

/** ERP xodimi (Haydovchi) → ECO'da foydalanuvchi + haydovchi a'zoligi. Qoida — `lib/eco/driver-link.ts` (mobil ham shundan). */
export async function linkDriver(employeeId: string): Promise<ActionState> {
  const s = await requireAction("trips", "drivers");
  const r = await linkDriverToEco(employeeId, s.userId);
  if ("error" in r) return { error: r.error };
  revalidatePath("/drivers"); revalidatePath("/employees");
  return { ok: true };
}

/** Ilovada o'zi ro'yxatdan o'tgan haydovchini ERP'dan tasdiqlash — Tadbirkor telefonisiz. */
export async function approveDriver(employeeId: string): Promise<ActionState> {
  const s = await requireAction("trips", "drivers");
  const r = await approveDriverInEco(employeeId, s.userId);
  if ("error" in r) return { error: r.error };
  revalidatePath("/drivers"); revalidatePath("/employees");
  return { ok: true };
}

/**
 * Ilovada ro'yxatdan o'tgan haydovchini ERP xodimi qilib olish.
 * `approve` — bir vaqtning o'zida ECO a'zoligini ham tasdiqlash (shundan keyin ilovaga kira oladi).
 */
export async function adoptEcoDriver(userId: string, fullName: string, phone: string, isActive: boolean, approve: boolean): Promise<ActionState> {
  await requireAction("trips", "drivers");
  let employeeId: string | undefined;
  try {
    const r = await applyEcoDriver({ userId, fullName: fullName || null, phone, isActive, reason: "invited", byIntegration: true });
    employeeId = r.employeeId;
  } catch (err) { return { error: msg(err) }; }
  if (approve && !isActive && employeeId) {
    const a = await approveDriver(employeeId);
    if (a?.error) return a;
  }
  revalidatePath("/drivers"); revalidatePath("/employees");
  return { ok: true };
}

/** Telefoni to'g'ri barcha faol haydovchilarni bir yo'la ulash. */
export async function linkAllDrivers(): Promise<ActionState> {
  await requireAction("trips", "drivers");
  const off = guard(); if (off) return off;
  const list = await db.employee.findMany({ where: { position: { in: await driverPositionNames() }, isActive: true, ecoUserId: null } });
  let ok = 0; const bad: string[] = [];
  for (const e of list) {
    const r = await linkDriver(e.id);
    if (r?.ok) ok++; else bad.push(e.fullName);
  }
  revalidatePath("/drivers");
  return bad.length ? { error: `${ok} ta ulandi; ulanmadi: ${bad.join(", ")}` } : { ok: true };
}

/** ERP texnikasi (mikser/nasos) → ECO mashinalari (davlat raqami bo'yicha). */
export async function syncVehicles(): Promise<ActionState> {
  await requireAction("trips", "drivers");
  const off = guard(); if (off) return off;
  const list = await db.vehicle.findMany();
  const bad: string[] = [];
  for (const v of list) { const r = await pushVehicleToEco(v.id); if (!r.ok && r.error) bad.push(`${v.plate}: ${r.error}`); }
  revalidatePath("/drivers");
  return bad.length ? { error: bad.join("; ") } : { ok: true };
}

/**
 * Ikki ro'yxatni to'liq tenglashtirish: ECO'dagi haydovchi/mashina ERP'ga tushadi,
 * ERP'dagilari ECO'ga yuboriladi. Webhook yetib bormay qolgan holatlar uchun.
 */
export async function syncAll(): Promise<ActionState> {
  await requireAction("trips", "drivers");
  const off = guard(); if (off) return off;
  const r = await syncDirectories();
  revalidatePath("/drivers"); revalidatePath("/employees");
  const failed = [...r.drivers.failed, ...r.vehicles.failed];
  if (failed.length) return { error: `Qisman: ${failed.join("; ")}` };
  return { ok: true };
}

/** ECO'ga yetib bormagan (yoki xatolik bilan qolgan) faol reyslarni qayta yuborish. */
export async function resendPendingTrips(): Promise<ActionState> {
  await requireAction("trips", "drivers");
  const off = guard(); if (off) return off;
  const trips = await db.trip.findMany({ where: { status: { in: ["PLANNED", "LOADED", "ON_ROAD"] }, OR: [{ ecoDeliveryId: null }, { ecoError: { not: null } }] }, select: { id: true, deliveryNoteNo: true } });
  const bad: string[] = [];
  for (const t of trips) { const r = await pushTripToEco(t.id); if (!r.ok) bad.push(`${t.deliveryNoteNo}: ${r.error ?? "?"}`); }
  revalidatePath("/drivers"); revalidatePath("/trips");
  return bad.length ? { error: bad.join("; ") } : { ok: true };
}
