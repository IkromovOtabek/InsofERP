"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { eco, ecoEnabled, EcoError, normalizePhone } from "@/lib/eco/client";
import { pushTripToEco } from "@/lib/eco/sync";
import type { ActionState } from "@/lib/action";

const msg = (e: unknown) => (e instanceof EcoError ? e.message : String((e as Error)?.message ?? e));
const guard = () => (ecoEnabled() ? null : { error: "ECO ulanmagan — .env da ECO_API_URL va ECO_API_KEY ni bering" });

/** ERP xodimi (Haydovchi) → ECO'da foydalanuvchi + haydovchi a'zoligi. Telefon +998… bo'lishi shart. */
export async function linkDriver(employeeId: string): Promise<ActionState> {
  const s = await requireSession(["LOGISTICS", "HR"]);
  const off = guard(); if (off) return off;
  const e = await db.employee.findUniqueOrThrow({ where: { id: employeeId } });
  const phone = normalizePhone(e.phone);
  if (!phone) return { error: `"${e.fullName}" telefoni +998XXXXXXXXX formatida emas — Xodimlar sahifasida tuzating` };
  try {
    const r = await eco.upsertDriver(phone, e.fullName);
    await db.employee.update({ where: { id: employeeId }, data: { ecoUserId: r.userId, phone } });
    await audit(db, s.userId, "UPDATE", "Employee", employeeId, { ecoUserId: e.ecoUserId }, { ecoUserId: r.userId, eco: "linked" });
  } catch (err) { return { error: msg(err) }; }
  revalidatePath("/drivers"); revalidatePath("/employees");
  return { ok: true };
}

/** Telefoni to'g'ri barcha faol haydovchilarni bir yo'la ulash. */
export async function linkAllDrivers(): Promise<ActionState> {
  await requireSession(["LOGISTICS", "HR"]);
  const off = guard(); if (off) return off;
  const list = await db.employee.findMany({ where: { position: { equals: "Haydovchi", mode: "insensitive" }, isActive: true, ecoUserId: null } });
  let ok = 0; const bad: string[] = [];
  for (const e of list) {
    const r = await linkDriver(e.id);
    if (r?.ok) ok++; else bad.push(e.fullName);
  }
  revalidatePath("/drivers");
  return bad.length ? { error: `${ok} ta ulandi; ulanmadi: ${bad.join(", ")}` } : { ok: true };
}

/** ECO'da ro'yxatdan o'tgan, ERP'da yo'q haydovchini xodim sifatida qo'shish. */
export async function importEcoDriver(userId: string, fullName: string, phone: string): Promise<ActionState> {
  const s = await requireSession(["LOGISTICS", "HR"]);
  const exists = await db.employee.findUnique({ where: { ecoUserId: userId } });
  if (exists) return { error: "Bu haydovchi allaqachon xodimlar ro'yxatida" };
  const e = await db.employee.create({ data: { fullName: fullName || phone, position: "Haydovchi", phone, ecoUserId: userId } });
  await audit(db, s.userId, "CREATE", "Employee", e.id, undefined, { ...e, source: "eco" });
  revalidatePath("/drivers"); revalidatePath("/employees");
  return { ok: true };
}

/** ERP texnikasi (mikser/nasos) → ECO mashinalari (davlat raqami bo'yicha). */
export async function syncVehicles(): Promise<ActionState> {
  await requireSession(["LOGISTICS"]);
  const off = guard(); if (off) return off;
  const list = await db.vehicle.findMany({ where: { isActive: true } });
  const bad: string[] = [];
  for (const v of list) {
    try {
      const r = await eco.upsertVehicle(v.plate, Number(v.capacityM3 ?? 8), v.type);
      await db.vehicle.update({ where: { id: v.id }, data: { ecoVehicleId: r.id } });
    } catch (e) { bad.push(`${v.plate}: ${msg(e)}`); }
  }
  revalidatePath("/drivers"); revalidatePath("/vehicles");
  return bad.length ? { error: bad.join("; ") } : { ok: true };
}

/** ECO'ga yetib bormagan (yoki xatolik bilan qolgan) faol reyslarni qayta yuborish. */
export async function resendPendingTrips(): Promise<ActionState> {
  await requireSession(["LOGISTICS"]);
  const off = guard(); if (off) return off;
  const trips = await db.trip.findMany({ where: { status: { in: ["PLANNED", "LOADED", "ON_ROAD"] }, OR: [{ ecoDeliveryId: null }, { ecoError: { not: null } }] }, select: { id: true, deliveryNoteNo: true } });
  const bad: string[] = [];
  for (const t of trips) { const r = await pushTripToEco(t.id); if (!r.ok) bad.push(`${t.deliveryNoteNo}: ${r.error ?? "?"}`); }
  revalidatePath("/drivers"); revalidatePath("/trips");
  return bad.length ? { error: bad.join("; ") } : { ok: true };
}
