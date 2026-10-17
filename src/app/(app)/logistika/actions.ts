"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireAction } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { parseForm, type ActionState } from "@/lib/action";
import {
  addExpenseRecord, addFuelRecord, addVehicleServiceRecord, deleteExpenseRecord, deleteFuelRecord, deleteVehicleServiceRecord,
  driverCardSchema, expenseSchema, fuelSchema, saveDriverCardRecord, saveSiteRecord, saveVehicleRecord, serviceSchema, siteSchema, vehicleSchema,
} from "@/lib/logistics-admin";

/**
 * Logistika kabineti amallari: transport, obyekt, haydovchi kartasi, yoqilg'i, xarajat, sozlamalar.
 * Qoidalar — `lib/logistics-admin.ts` (mobil ilova ham shuni chaqiradi); bu yerda ruxsat, forma va sahifani yangilash.
 * Reys bosqichlari — `trips/actions.ts` da (mavjud reys oqimi bilan birga).
 */

const refresh = () => { revalidatePath("/logistika", "layout"); revalidatePath("/dashboard"); };

// ───────────────────────── Transport ─────────────────────────

export async function saveVehicle(id: string | null, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("logistika", "vehicle");
  const r = parseForm(vehicleSchema, fd);
  if ("error" in r) return { error: r.error };
  const res = await saveVehicleRecord(id, r.data, s.userId);
  if ("error" in res) return { error: res.error };
  refresh(); revalidatePath("/drivers");
  if (!id) redirect(`/logistika/transport/${res.id}`);
  return { ok: true };
}

// ───────────────────────── Obyekt ─────────────────────────

export async function saveSite(id: string | null, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("logistika", "sites");
  const r = parseForm(siteSchema, fd);
  if ("error" in r) return { error: r.error };
  const res = await saveSiteRecord(id, r.data, s.userId);
  if ("error" in res) return { error: res.error };
  refresh();
  if (!id) redirect(`/logistika/obyektlar/${res.id}`);
  return { ok: true };
}

// ───────────────────────── Haydovchi kartasi ─────────────────────────

/** Logistika to'ldiradigan qism: grafik, guvohnoma, biriktirilgan transport. Shaxsiy ma'lumot — Otdel kadrda. */
export async function saveDriverCard(employeeId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("logistika", "drivers");
  const r = parseForm(driverCardSchema, fd);
  if ("error" in r) return { error: r.error };
  const res = await saveDriverCardRecord(employeeId, r.data, s.userId);
  if ("error" in res) return { error: res.error };
  refresh();
  return { ok: true };
}

// ───────────────────────── Yoqilg'i va xarajat ─────────────────────────

export async function addFuel(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("logistika", "fuel");
  const r = parseForm(fuelSchema, fd);
  if ("error" in r) return { error: r.error };
  const res = await addFuelRecord(r.data, s.userId);
  if ("error" in res) return { error: res.error };
  refresh();
  return { ok: true };
}

export async function addExpense(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("logistika", "expense");
  const r = parseForm(expenseSchema, fd);
  if ("error" in r) return { error: r.error };
  // Mexanik cheklovi (faqat ta'mir / ehtiyot qism / yuvish, transportga) — `addExpenseRecord` ichida
  const res = await addExpenseRecord(s.role, r.data, s.userId);
  if ("error" in res) return { error: res.error };
  refresh();
  if (r.data.vehicleId) revalidatePath(`/logistika/transport/${r.data.vehicleId}`);
  return { ok: true };
}

/** Xato kiritilgan yozuvni o'chirish (audit jurnalida asl yozuv qoladi). */
export async function deleteFuel(id: string): Promise<ActionState> {
  const s = await requireAction("logistika", "fuel");
  const res = await deleteFuelRecord(id, s.userId);
  if ("error" in res) return { error: res.error };
  refresh();
  return { ok: true };
}

export async function deleteExpense(id: string): Promise<ActionState> {
  const s = await requireAction("logistika", "fuel");
  const res = await deleteExpenseRecord(id, s.userId);
  if ("error" in res) return { error: res.error };
  refresh();
  return { ok: true };
}

// ───────────────────────── Texnik xizmat jurnali (mexanik) ─────────────────────────

/** Xizmat yozuvi — qoidalar `addVehicleServiceRecord` da (keyingi xizmat muddati, probeg orqaga ketmaydi). */
export async function addVehicleService(vehicleId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("logistika", "service");
  const r = parseForm(serviceSchema, fd);
  if ("error" in r) return { error: r.error };
  const res = await addVehicleServiceRecord(vehicleId, r.data, s.userId);
  if ("error" in res) return { error: res.error };
  refresh(); revalidatePath(`/logistika/transport/${vehicleId}`);
  return { ok: true };
}

export async function deleteVehicleService(id: string): Promise<ActionState> {
  const s = await requireAction("logistika", "service");
  const res = await deleteVehicleServiceRecord(id, s.userId);
  if ("error" in res) return { error: res.error };
  refresh(); revalidatePath(`/logistika/transport/${res.id}`);
  return { ok: true };
}

// ───────────────────────── Sozlamalar ─────────────────────────

const int = (min: number, max: number) => z.coerce.number().int("butun son").min(min, `kamida ${min}`).max(max, `ko'pi bilan ${max}`);
const settingsSchema = z.object({
  lateWarnMin: int(1, 600), lateCritMin: int(1, 1440), gpsSilentMin: int(3, 240), loadedWarnMin: int(5, 600),
  assignLeadMin: int(10, 1440), shiftStartHour: int(0, 23), shiftEndHour: int(1, 24), avgSpeedKmh: int(5, 120),
  // GPS ogohlantirishlari (lib/gps-watch.ts): 5 daqiqadan kam turish — svetofor/tirbandlik; 100 m dan yaqin — GPS xatosi
  stopAlertMin: z.coerce.number().int("Uzoq turish: butun son").min(5, "Uzoq turish kamida 5 daqiqa").max(240, "Uzoq turish ko'pi bilan 240 daqiqa"),
  offRouteM: z.coerce.number().int("Yo'ldan chiqish: butun son").min(100, "Yo'ldan chiqish kamida 100 m").max(5000, "Yo'ldan chiqish ko'pi bilan 5000 m"),
});

export async function saveLogisticsSettings(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("logistika", "settings");
  const r = parseForm(settingsSchema, fd);
  if ("error" in r) return { error: r.error };
  const d = r.data;
  if (d.lateCritMin <= d.lateWarnMin) return { error: "Kritik kechikish e'tibor chegarasidan katta bo'lsin" };
  if (d.shiftEndHour <= d.shiftStartHour) return { error: "Smena tugashi boshlanishidan keyin bo'lsin" };
  const before = await db.companySettings.findUnique({ where: { id: "main" } });
  await db.companySettings.upsert({ where: { id: "main" }, create: { id: "main", ...d }, update: d });
  await audit(db, s.userId, "UPDATE", "CompanySettings", "main", before ? Object.fromEntries(Object.keys(d).map((k) => [k, before[k as keyof typeof before]])) : undefined, d);
  refresh();
  revalidatePath("/settings"); // forma Sozlamalar → Limitlar da ham turadi
  return { ok: true };
}
