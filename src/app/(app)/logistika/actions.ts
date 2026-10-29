"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireAction } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { parseForm, type ActionState } from "@/lib/action";
import {
  addExpenseRecord, addFuelRecord, addVehicleServiceRecord, cancelExpenseRecord, cancelFuelRecord, cancelVehicleServiceRecord,
  driverCardSchema, expenseSchema, fuelSchema, saveDriverCardRecord, saveSiteRecord, saveVehicleRecord, serviceSchema, siteSchema, vehicleSchema,
} from "@/lib/logistics-admin";
import { approveTripPays, PAY_TYPES, priceTrip, priceTripsBySuggestion, rejectTripPay } from "@/lib/driver-trip-pay";
import { createMechanicRequest, MASTER_PROBLEMS } from "@/lib/mechanic-requests";

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

/** Xato kiritilgan yozuvni bekor qilish — sabab bilan (`ConfirmButton reason="required"`); yozuv o'chirilmaydi. */
export async function cancelFuel(id: string, reason: string): Promise<ActionState> {
  const s = await requireAction("logistika", "fuel");
  const res = await cancelFuelRecord(id, String(reason ?? ""), s.userId);
  if ("error" in res) return { error: res.error };
  refresh(); revalidatePath("/trips", "layout");
  return { ok: true, note: "Bekor qilindi" };
}

export async function cancelExpense(id: string, reason: string): Promise<ActionState> {
  const s = await requireAction("logistika", "fuel");
  const res = await cancelExpenseRecord(id, String(reason ?? ""), s.userId);
  if ("error" in res) return { error: res.error };
  refresh(); revalidatePath("/trips", "layout");
  return { ok: true, note: "Bekor qilindi" };
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

export async function cancelVehicleService(id: string, reason: string): Promise<ActionState> {
  const s = await requireAction("logistika", "service");
  const res = await cancelVehicleServiceRecord(id, String(reason ?? ""), s.userId);
  if ("error" in res) return { error: res.error };
  refresh(); revalidatePath(`/logistika/transport/${res.id}`);
  return { ok: true, note: "Bekor qilindi" };
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

// ───────────────────────── Haydovchi tabeli: reys narxi va tarif (dispetcher) ─────────────────────────

const priceSchema = z.object({
  amount: z.coerce.number({ message: "Summani kiriting" }).min(0, "Summa manfiy bo'lmaydi").max(100_000_000, "Summa juda katta"),
  note: z.string().trim().max(300).optional().transform((v) => v || null),
  payType: z.enum(PAY_TYPES, { message: "To'lov turini tanlang: naqd yoki oylik" }),
});

/** Reys haqini belgilash / tuzatish — `lib/driver-trip-pay.ts` (narxlangandan keyin oylikka tushadi). */
export async function priceTripAction(tripId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("logistika", "pay");
  const r = parseForm(priceSchema, fd);
  if ("error" in r) return { error: r.error };
  const res = await priceTrip(tripId, r.data.amount, r.data.note, s.userId, r.data.payType);
  if ("error" in res) return { error: res.error };
  refresh();
  return { ok: true };
}

/** Tanlangan narxsiz reyslarga tarif bo'yicha taklifni birdan qo'yish. */
export async function priceSuggestedAction(tripIds: string[], payType: string): Promise<ActionState> {
  const s = await requireAction("logistika", "pay");
  if (!tripIds.length) return { error: "Reys tanlanmagan" };
  if (payType !== "CASH" && payType !== "PAYROLL") return { error: "To'lov turini tanlang" };
  const r = await priceTripsBySuggestion(tripIds.slice(0, 500), s.userId, payType);
  refresh();
  return r.failed ? { error: `${r.done} ta narxlandi, ${r.failed} tasi o'tmadi (vedomost tasdiqlangan yoki reys o'zgargan)` } : { ok: true };
}

/** Ish boshqaruvchi: reys haqini tasdiqlash (naqd — kassaga, oylik — vedomostga). */
export async function approveTripPaysAction(tripIds: string[]): Promise<ActionState> {
  const s = await requireAction("logistika", "pay_approve");
  if (!tripIds.length) return { error: "Reys tanlanmagan" };
  const r = await approveTripPays(tripIds, s.userId);
  refresh();
  return r.failed ? { error: `${r.done} ta tasdiqlandi, ${r.failed} tasi o'tmadi (boshqa joyda o'zgargan) — sahifani yangilang` } : { ok: true };
}

/** Ish boshqaruvchi: rad etish — reys yana narxsizlar ro'yxatiga qaytadi. */
export async function rejectTripPayAction(tripId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("logistika", "pay_approve");
  const res = await rejectTripPay(tripId, String(fd.get("reason") ?? ""), s.userId);
  if ("error" in res) return { error: res.error };
  refresh();
  return { ok: true };
}

const masterSchema = z.object({
  vehicleId: z.string().min(1, "Transportni tanlang"),
  problem: z.enum(MASTER_PROBLEMS, { message: "Turini tanlang" }),
  payee: z.string().trim().min(2, "Usta ismini yozing").max(120),
  amount: z.coerce.number({ message: "Summani kiriting" }).positive("Summa 0 dan katta bo'lsin").max(100_000_000, "Summa juda katta"),
  note: z.string().trim().max(300).optional().transform((v) => v || null),
  mode: z.enum(["now", "later"]),
  days: z.coerce.number().int().min(0).max(365).optional(),
});

/**
 * Dispetcher: remont usta puli (ta'mir, vulkanizatsiya, zapchast). «Joyida berish» — ish boshqaruvchi tasdig'i → kassa;
 * «N kunda berish» — muddat kuni tasdiqqa o'tadi va eslatma keladi (`lib/mechanic-requests.ts`).
 */
export async function createMasterPayAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("logistika", "pay");
  const r = parseForm(masterSchema, fd);
  if ("error" in r) return { error: r.error };
  const d = r.data;
  if (d.mode === "later" && !(d.days && d.days > 0)) return { error: "Necha kunda berilishini kiriting" };
  const res = await createMechanicRequest({
    target: "TRANSPORT", vehicleId: d.vehicleId, problem: d.problem, amount: d.amount, payee: d.payee,
    note: [`Usta: ${d.payee}`, d.note].filter(Boolean).join(" · "), dueDays: d.mode === "later" ? d.days : null,
  }, s.userId);
  if (res.error) return { error: res.error };
  refresh();
  return { ok: true, note: res.note };
}

const money0 = z.coerce.number({ message: "Raqam kiriting" }).min(0, "Manfiy bo'lmaydi").max(100_000_000, "Juda katta");
const tariffSchema = z.object({ drvTripRate: money0, drvKmRate: money0, drvWaitHourRate: money0 });

/** Haydovchi reys haqi tarifi (taklif shu bo'yicha hisoblanadi). Eski reyslardagi taklif o'zgarmaydi. */
export async function saveDriverTariff(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("logistika", "pay");
  const r = parseForm(tariffSchema, fd);
  if ("error" in r) return { error: r.error };
  const before = await db.companySettings.findUnique({ where: { id: "main" }, select: { drvTripRate: true, drvKmRate: true, drvWaitHourRate: true } });
  await db.companySettings.upsert({ where: { id: "main" }, create: { id: "main", ...r.data }, update: r.data });
  await audit(db, s.userId, "UPDATE", "CompanySettings", "main", before ?? undefined, r.data);
  refresh();
  return { ok: true };
}
