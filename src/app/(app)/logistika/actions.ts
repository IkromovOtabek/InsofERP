"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireAction } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { parseForm, zStr, zOpt, MAX_AMOUNT, type ActionState } from "@/lib/action";
import { addFuelLog, addTransportExpense } from "@/lib/logistics-costs";
import { pushVehicleSilently } from "@/lib/eco/people";
import type { FuelType, TransportExpenseKind, VehicleType } from "@/generated/prisma";

/**
 * Logistika kabineti amallari: transport, obyekt, haydovchi kartasi, yoqilg'i, xarajat, sozlamalar.
 * Reys bosqichlari — `trips/actions.ts` da (mavjud reys oqimi bilan birga).
 */

const refresh = () => { revalidatePath("/logistika", "layout"); revalidatePath("/dashboard"); };

/** Forma raqami: "12 500", "12,5" yoki bo'sh (null) — oraliq bilan (probeg, sig'im, summa manfiy bo'lmaydi). */
const numIn = (min: number, max: number) => z.preprocess((v) => {
  const t = String(v ?? "").replace(/\s+/g, "").replace(",", ".");
  return t === "" ? null : Number(t);
}, z.number({ message: "raqam bo'lishi kerak" }).min(min, `kamida ${min}`).max(max, `ko'pi bilan ${max}`).nullable());
const day = z.preprocess((v) => (v ? new Date(`${String(v)}T00:00:00`) : null), z.date().nullable());
const bool = z.preprocess((v) => v === "on" || v === "true" || v === "1", z.boolean());

// ───────────────────────── Transport ─────────────────────────

const vehicleSchema = z.object({
  plate: zStr("Davlat raqamini kiriting").transform((v) => v.toUpperCase().replace(/\s+/g, " ").trim()),
  type: z.enum(["MIXER", "PUMP", "TRUCK"], { message: "Turini tanlang" }),
  brand: zOpt, model: zOpt, year: numIn(1970, new Date().getFullYear() + 1), capacityM3: numIn(0, 100),
  fuelType: z.enum(["DIESEL", "PETROL", "METHANE", "PROPANE"]).optional().or(z.literal("").transform(() => undefined)),
  fuelNormL100: numIn(0, 300), odometerKm: numIn(0, 3_000_000), hasGps: bool,
  // Probeg kamaytirilsa (xato kiritilgan raqamni tuzatish) — sabab majburiy, auditga yoziladi
  odometerReason: zOpt,
  inspectionUntil: day, insuranceCompany: zOpt, insurancePolicy: zOpt, insuranceUntil: day,
  isActive: bool, note: zOpt, driverId: zOpt,
});

export async function saveVehicle(id: string | null, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("logistika", "vehicle");
  const r = parseForm(vehicleSchema, fd);
  if ("error" in r) return { error: r.error };
  const d = r.data;
  if (d.type === "MIXER" && !(d.capacityM3 && d.capacityM3 > 0)) return { error: "Mikser sig'imini (m³) kiriting" };
  // Probeg orqaga ketmaydi: kamaytirish faqat xato tuzatish sifatida, sababi bilan (yoqilg'i sarfi va xizmat muddati shunga tayanadi)
  let odoFix: { from: number; to: number | null; reason: string } | null = null;
  if (id) {
    const cur = await db.vehicle.findUnique({ where: { id }, select: { odometerKm: true } });
    const next = d.odometerKm != null ? Math.round(d.odometerKm) : null;
    if (cur?.odometerKm != null && (next == null || next < cur.odometerKm)) {
      if (!d.odometerReason) return { error: `Probeg ${cur.odometerKm} km dan kam bo'lolmaydi. Xato raqamni tuzatayotgan bo'lsangiz — "Probegni kamaytirish sababi"ni yozing` };
      odoFix = { from: cur.odometerKm, to: next, reason: d.odometerReason };
    }
  }
  const data = {
    plate: d.plate, type: d.type as VehicleType, brand: d.brand, model: d.model, year: d.year ? Math.round(d.year) : null,
    capacityM3: d.capacityM3, fuelType: (d.fuelType ?? null) as FuelType | null, fuelNormL100: d.fuelNormL100,
    odometerKm: d.odometerKm != null ? Math.round(d.odometerKm) : null, hasGps: d.hasGps,
    inspectionUntil: d.inspectionUntil, insuranceCompany: d.insuranceCompany, insurancePolicy: d.insurancePolicy, insuranceUntil: d.insuranceUntil,
    isActive: id ? d.isActive : true, note: d.note,
  };
  let vid = id;
  try {
    if (id) {
      const before = await db.vehicle.findUniqueOrThrow({ where: { id } });
      const after = await db.vehicle.update({ where: { id }, data });
      await audit(db, s.userId, "UPDATE", "Vehicle", id, before, odoFix ? { ...after, odometerFix: odoFix } : after);
    } else {
      const v = await db.vehicle.create({ data });
      await audit(db, s.userId, "CREATE", "Vehicle", v.id, undefined, v);
      vid = v.id;
    }
  } catch (e) {
    if (String(e).includes("Unique constraint")) return { error: `${d.plate} raqamli transport allaqachon bor` };
    throw e;
  }
  // Biriktirilgan haydovchi — Employee.vehicleId (reys formasida haydovchi texnikasi bilan birga tanlanadi)
  if (d.driverId !== undefined) {
    await db.employee.updateMany({ where: { vehicleId: vid!, NOT: d.driverId ? { id: d.driverId } : undefined }, data: { vehicleId: null } });
    if (d.driverId) await db.employee.update({ where: { id: d.driverId }, data: { vehicleId: vid } });
  }
  pushVehicleSilently(vid!);
  refresh(); revalidatePath("/drivers");
  if (!id) redirect(`/logistika/transport/${vid}`);
  return { ok: true };
}

// ───────────────────────── Obyekt ─────────────────────────

const siteSchema = z.object({
  customerId: zStr("Mijozni tanlang"), name: zStr("Obyekt nomini kiriting"), address: zStr("Manzilni kiriting"),
  lat: numIn(-90, 90), lng: numIn(-180, 180), contactName: zOpt, contactPhone: zOpt, deliveryHours: zOpt, instructions: zOpt, isActive: bool,
});

export async function saveSite(id: string | null, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("logistika", "sites");
  const r = parseForm(siteSchema, fd);
  if ("error" in r) return { error: r.error };
  const d = r.data;
  const data = { ...d, isActive: id ? d.isActive : true };
  let sid = id;
  if (id) {
    const before = await db.site.findUniqueOrThrow({ where: { id } });
    const after = await db.site.update({ where: { id }, data });
    await audit(db, s.userId, "UPDATE", "Site", id, before, after);
    // Nuqta yangi qo'yilgan bo'lsa — shu obyektning nuqtasiz ochiq zayavkalari ham to'ldiriladi (haydovchi navigatsiyasi)
    if (d.lat != null && d.lng != null) {
      await db.order.updateMany({ where: { siteId: id, lat: null, status: { in: ["DRAFT", "BLOCKED", "CONFIRMED", "IN_PRODUCTION"] } }, data: { lat: d.lat, lng: d.lng } });
    }
  } else {
    const x = await db.site.create({ data });
    await audit(db, s.userId, "CREATE", "Site", x.id, undefined, x);
    sid = x.id;
  }
  refresh();
  if (!id) redirect(`/logistika/obyektlar/${sid}`);
  return { ok: true };
}

// ───────────────────────── Haydovchi kartasi ─────────────────────────

const driverSchema = z.object({ workSchedule: zOpt, licenseNo: zOpt, licenseCategory: zOpt, licenseExpiry: day, vehicleId: zOpt });

/** Logistika to'ldiradigan qism: grafik, guvohnoma, biriktirilgan transport. Shaxsiy ma'lumot — Otdel kadrda. */
export async function saveDriverCard(employeeId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("logistika", "drivers");
  const r = parseForm(driverSchema, fd);
  if ("error" in r) return { error: r.error };
  const before = await db.employee.findUniqueOrThrow({ where: { id: employeeId } });
  const after = await db.employee.update({ where: { id: employeeId }, data: r.data });
  await audit(db, s.userId, "UPDATE", "Employee", employeeId,
    { workSchedule: before.workSchedule, licenseNo: before.licenseNo, licenseCategory: before.licenseCategory, licenseExpiry: before.licenseExpiry, vehicleId: before.vehicleId },
    { workSchedule: after.workSchedule, licenseNo: after.licenseNo, licenseCategory: after.licenseCategory, licenseExpiry: after.licenseExpiry, vehicleId: after.vehicleId });
  refresh();
  return { ok: true };
}

// ───────────────────────── Yoqilg'i va xarajat ─────────────────────────

const fuelSchema = z.object({
  vehicleId: zStr("Transportni tanlang"), driverId: zOpt, tripId: zOpt, date: day,
  fuelType: z.enum(["DIESEL", "PETROL", "METHANE", "PROPANE"]).optional().or(z.literal("").transform(() => undefined)),
  liters: numIn(0, 1000), pricePerL: numIn(0, MAX_AMOUNT), odometerKm: numIn(0, 3_000_000), station: zOpt, note: zOpt,
});

export async function addFuel(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("logistika", "fuel");
  const r = parseForm(fuelSchema, fd);
  if ("error" in r) return { error: r.error };
  const d = r.data;
  try {
    await addFuelLog({
      vehicleId: d.vehicleId, driverId: d.driverId, tripId: d.tripId, date: d.date, fuelType: (d.fuelType ?? null) as FuelType | null,
      liters: d.liters ?? 0, pricePerL: d.pricePerL ?? 0, odometerKm: d.odometerKm != null ? Math.round(d.odometerKm) : null, station: d.station, note: d.note,
    }, s.userId);
  } catch (e) { return { error: (e as Error).message }; }
  refresh();
  return { ok: true };
}

const expenseSchema = z.object({
  kind: z.enum(["DRIVER_PAY", "ROAD", "REPAIR", "PARTS", "PARKING", "FINE", "WASH", "OTHER"], { message: "Xarajat turini tanlang" }),
  amount: numIn(0, MAX_AMOUNT), date: day, vehicleId: zOpt, driverId: zOpt, tripId: zOpt, note: zOpt,
});

/** Mexanik faqat texnikaga oid xarajatni yozadi: ta'mir, ehtiyot qism / moy, yuvish. */
const MECHANIC_EXPENSE_KINDS = ["REPAIR", "PARTS", "WASH"] as const;

export async function addExpense(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("logistika", "expense");
  const r = parseForm(expenseSchema, fd);
  if ("error" in r) return { error: r.error };
  const d = r.data;
  if (s.role === "MECHANIC") {
    if (!(MECHANIC_EXPENSE_KINDS as readonly string[]).includes(d.kind)) return { error: "Mexanik faqat ta'mir, ehtiyot qism / moy va yuvish xarajatini yozadi" };
    if (!d.vehicleId) return { error: "Transportni tanlang" };
    if (d.tripId || d.driverId) return { error: "Mexanik xarajati transportga yoziladi (reys/haydovchisiz)" };
  }
  try {
    await addTransportExpense({ kind: d.kind as TransportExpenseKind, amount: d.amount ?? 0, date: d.date, vehicleId: d.vehicleId, driverId: d.driverId, tripId: d.tripId, note: d.note }, s.userId);
  } catch (e) { return { error: (e as Error).message }; }
  refresh();
  if (d.vehicleId) revalidatePath(`/logistika/transport/${d.vehicleId}`);
  return { ok: true };
}

/** Xato kiritilgan yozuvni o'chirish (audit jurnalida asl yozuv qoladi). */
export async function deleteFuel(id: string): Promise<ActionState> {
  const s = await requireAction("logistika", "fuel");
  const f = await db.fuelLog.findUnique({ where: { id } });
  if (!f) return { error: "Topilmadi" };
  await db.fuelLog.delete({ where: { id } });
  await audit(db, s.userId, "DELETE", "FuelLog", id, f, undefined);
  refresh();
  return { ok: true };
}

export async function deleteExpense(id: string): Promise<ActionState> {
  const s = await requireAction("logistika", "fuel");
  const e = await db.transportExpense.findUnique({ where: { id } });
  if (!e) return { error: "Topilmadi" };
  await db.transportExpense.delete({ where: { id } });
  await audit(db, s.userId, "DELETE", "TransportExpense", id, e, undefined);
  refresh();
  return { ok: true };
}

// ───────────────────────── Texnik xizmat jurnali (mexanik) ─────────────────────────

const serviceSchema = z.object({
  kind: zStr("Xizmat turini tanlang").pipe(z.string().max(80, "ko'pi bilan 80 belgi")),
  date: day, odometerKm: numIn(0, 3_000_000), cost: numIn(0, MAX_AMOUNT), note: zOpt,
  nextDueAt: day, nextDueKm: numIn(0, 3_000_000),
});

/**
 * Xizmat yozuvi: moy almashtirish, ta'mir, shina, ko'rik — keyingi xizmat sanasi/probegi bilan.
 * Probeg transport kartasidagidan katta bo'lsa — karta ham yangilanadi (probeg orqaga ketmaydi).
 * Narx bu yerda faqat jurnal uchun: pul xarajati "Boshqa xarajatlar"ga alohida yoziladi (ikki marta sanalmasin).
 */
export async function addVehicleService(vehicleId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("logistika", "service");
  const r = parseForm(serviceSchema, fd);
  if ("error" in r) return { error: r.error };
  const d = r.data;
  const v = await db.vehicle.findUnique({ where: { id: vehicleId }, select: { id: true, odometerKm: true } });
  if (!v) return { error: "Transport topilmadi" };
  const date = d.date ?? new Date();
  if (date.getTime() > Date.now() + 86_400_000) return { error: "Xizmat sanasi kelajakda bo'lolmaydi" };
  if (d.nextDueAt && d.nextDueAt <= date) return { error: "Keyingi xizmat sanasi xizmat sanasidan keyin bo'lsin" };
  const odo = d.odometerKm != null ? Math.round(d.odometerKm) : null;
  const nextKm = d.nextDueKm != null ? Math.round(d.nextDueKm) : null;
  if (nextKm != null && nextKm <= (odo ?? v.odometerKm ?? 0)) return { error: "Keyingi xizmat probegi hozirgisidan katta bo'lsin" };
  const row = await db.$transaction(async (tx) => {
    const x = await tx.vehicleService.create({
      data: { vehicleId, kind: d.kind, date, odometerKm: odo, cost: d.cost ?? null, note: d.note, nextDueAt: d.nextDueAt, nextDueKm: nextKm, createdById: s.userId },
    });
    if (odo != null && (v.odometerKm == null || odo > v.odometerKm)) await tx.vehicle.update({ where: { id: vehicleId }, data: { odometerKm: odo } });
    await audit(tx, s.userId, "CREATE", "VehicleService", x.id, undefined, x);
    return x;
  });
  refresh(); revalidatePath(`/logistika/transport/${vehicleId}`);
  return row ? { ok: true } : { error: "Saqlanmadi" };
}

export async function deleteVehicleService(id: string): Promise<ActionState> {
  const s = await requireAction("logistika", "service");
  const x = await db.vehicleService.findUnique({ where: { id } });
  if (!x) return { error: "Topilmadi" };
  await db.vehicleService.delete({ where: { id } });
  await audit(db, s.userId, "DELETE", "VehicleService", id, x, undefined);
  refresh(); revalidatePath(`/logistika/transport/${x.vehicleId}`);
  return { ok: true };
}

// ───────────────────────── Sozlamalar ─────────────────────────

const int = (min: number, max: number) => z.coerce.number().int("butun son").min(min, `kamida ${min}`).max(max, `ko'pi bilan ${max}`);
const settingsSchema = z.object({
  lateWarnMin: int(1, 600), lateCritMin: int(1, 1440), gpsSilentMin: int(3, 240), loadedWarnMin: int(5, 600),
  assignLeadMin: int(10, 1440), shiftStartHour: int(0, 23), shiftEndHour: int(1, 24), avgSpeedKmh: int(5, 120),
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
  return { ok: true };
}
