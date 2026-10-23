import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { zStr, zOpt, MAX_AMOUNT } from "@/lib/action";
import { addFuelLog, addTransportExpense } from "@/lib/logistics-costs";
import { pushVehicleSilently } from "@/lib/eco/people";
import type { CapacityUnit, FuelType, Role, TransportExpenseKind, VehicleStatus, VehicleType } from "@/generated/prisma";
import { METHANE_NORM, VEHICLE_FUELS } from "@/lib/logistics";

/**
 * Logistika kabineti yozuvlari: transport kartasi va holati, texnik xizmat jurnali, obyekt,
 * haydovchi kartasi, yoqilg'i va xarajat (qo'shish / xato yozuvni bekor qilish — o'chirilmaydi).
 *
 * Veb (`app/(app)/logistika/actions.ts`, `drivers/vehicle-status.ts`) ham, mobil ilova
 * (`lib/mobile/logistika-extra.ts`) ham shu funksiyalarni chaqiradi — qoida bitta joyda.
 * Sxemalar ham shu yerda: veb `parseForm(schema, fd)`, mobil `schema.safeParse(payload)`.
 * Ruxsat (requireAction / mobil `can`) va sahifani yangilash — chaqiruvchida.
 */

export type AdminResult = { error: string } | { ok: true; id: string };

/** Forma raqami: "12 500", "12,5" yoki bo'sh (null) — oraliq bilan (probeg, sig'im, summa manfiy bo'lmaydi). */
export const numIn = (min: number, max: number) => z.preprocess((v) => {
  const t = String(v ?? "").replace(/\s+/g, "").replace(",", ".");
  return t === "" ? null : Number(t);
}, z.number({ message: "raqam bo'lishi kerak" }).min(min, `kamida ${min}`).max(max, `ko'pi bilan ${max}`).nullable());

/**
 * Sana: veb `yyyy-mm-dd`, mobil matn maydoni `kk.oo.yyyy` ham bo'lishi mumkin. Bo'sh — null.
 * Noto'g'ri yozilgani "Invalid Date" bo'lib bazaga ketmasin — zod sanani o'zi rad etadi.
 */
export const dayField = z.preprocess((v) => {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const ru = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(s);
  if (ru) return new Date(Number(ru[3]), Number(ru[2]) - 1, Number(ru[1]));
  return new Date(`${s}T00:00:00`);
}, z.date({ message: "sana noto'g'ri (kk.oo.yyyy)" }).nullable());

/** Belgi: veb checkbox ("on"), mobil switch (true / "true"). */
export const boolField = z.preprocess((v) => v === true || v === "on" || v === "true" || v === "1", z.boolean());

const optEnum = <T extends [string, ...string[]]>(values: T) => z.enum(values).optional().or(z.literal("").transform(() => undefined));

// ───────────────────────── Transport ─────────────────────────

export const vehicleSchema = z.object({
  plate: zStr("Davlat raqamini kiriting").transform((v) => v.toUpperCase().replace(/\s+/g, " ").trim()),
  type: z.enum(["MIXER", "PUMP", "TRUCK"], { message: "Turini tanlang" }),
  brand: zOpt, model: zOpt, year: numIn(1970, new Date().getFullYear() + 1), capacityM3: numIn(0, 100_000),
  capacityUnit: optEnum(["M3", "TON", "PIECE"]),
  fuelType: optEnum(["DIESEL", "PETROL", "METHANE", "PROPANE"]),
  fuelNormL100: numIn(0, 300), idleNormPerHour: numIn(0, 100), odometerKm: numIn(0, 3_000_000), hasGps: boolField,
  // Probeg kamaytirilsa (xato kiritilgan raqamni tuzatish) — sabab majburiy, auditga yoziladi
  odometerReason: zOpt,
  inspectionUntil: dayField, insuranceCompany: zOpt, insurancePolicy: zOpt, insuranceUntil: dayField,
  isActive: boolField, note: zOpt, driverId: zOpt,
});
export type VehicleInput = z.infer<typeof vehicleSchema>;

/** Transport qo'shish (id = null) yoki tahrirlash. Biriktirilgan haydovchi — `Employee.vehicleId`. */
export async function saveVehicleRecord(id: string | null, d: VehicleInput, userId: string): Promise<AdminResult> {
  if (d.type === "MIXER" && !(d.capacityM3 && d.capacityM3 > 0)) return { error: "Mikser sig'imini (m³) kiriting" };
  if (d.type !== "TRUCK" && d.capacityM3 != null && d.capacityM3 > 100) return { error: "Sig'im 100 m³ dan oshmaydi" };
  // Benzin/propan endi tanlanmaydi — eski kartada turgani saqlanadi, yangisiga yoki boshqa turdan o'tishga ruxsat yo'q
  if (d.fuelType && !(VEHICLE_FUELS as readonly string[]).includes(d.fuelType)) {
    const cur = id ? await db.vehicle.findUnique({ where: { id }, select: { fuelType: true } }) : null;
    if (cur?.fuelType !== d.fuelType) return { error: "Yoqilg'i turi: dizel yoki metan" };
  }
  // Metan: norma kiritilmagan bo'lsa — odatiy (100 km ga 50 m³, soatiga 5 m³)
  const methane = d.fuelType === "METHANE";
  const fuelNorm = d.fuelNormL100 ?? (methane ? METHANE_NORM.per100km : null);
  const idleNorm = d.idleNormPerHour ?? (methane ? METHANE_NORM.perHour : null);
  // Probeg orqaga ketmaydi: kamaytirish faqat xato tuzatish sifatida, sababi bilan (yoqilg'i sarfi va xizmat muddati shunga tayanadi)
  let odoFix: { from: number; to: number | null; reason: string } | null = null;
  if (id) {
    const cur = await db.vehicle.findUnique({ where: { id }, select: { odometerKm: true } });
    if (!cur) return { error: "Transport topilmadi" };
    const next = d.odometerKm != null ? Math.round(d.odometerKm) : null;
    if (cur.odometerKm != null && (next == null || next < cur.odometerKm)) {
      if (!d.odometerReason) return { error: `Probeg ${cur.odometerKm} km dan kam bo'lolmaydi. Xato raqamni tuzatayotgan bo'lsangiz — "Probegni kamaytirish sababi"ni yozing` };
      odoFix = { from: cur.odometerKm, to: next, reason: d.odometerReason };
    }
  }
  const data = {
    plate: d.plate, type: d.type as VehicleType, brand: d.brand, model: d.model, year: d.year ? Math.round(d.year) : null,
    capacityM3: d.capacityM3, capacityUnit: (d.type === "TRUCK" ? d.capacityUnit ?? "TON" : "M3") as CapacityUnit,
    fuelType: (d.fuelType ?? null) as FuelType | null, fuelNormL100: fuelNorm, idleNormPerHour: idleNorm,
    odometerKm: d.odometerKm != null ? Math.round(d.odometerKm) : null, hasGps: d.hasGps,
    inspectionUntil: d.inspectionUntil, insuranceCompany: d.insuranceCompany, insurancePolicy: d.insurancePolicy, insuranceUntil: d.insuranceUntil,
    isActive: id ? d.isActive : true, note: d.note,
  };
  let vid = id;
  try {
    if (id) {
      const before = await db.vehicle.findUniqueOrThrow({ where: { id } });
      const after = await db.vehicle.update({ where: { id }, data });
      await audit(db, userId, "UPDATE", "Vehicle", id, before, odoFix ? { ...after, odometerFix: odoFix } : after);
    } else {
      const v = await db.vehicle.create({ data });
      await audit(db, userId, "CREATE", "Vehicle", v.id, undefined, v);
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
  return { ok: true, id: vid! };
}

export const VEHICLE_STATUSES = ["ACTIVE", "REPAIR", "IDLE"] as const;

/** Texnika holati — logistika va mexanik belgilaydi; egasi dashbordidagi "Transport" bloki shundan o'qiydi. */
export async function setVehicleStatusRecord(vehicleId: string, status: string, rawNote: string | null | undefined, userId: string): Promise<AdminResult> {
  if (!(VEHICLE_STATUSES as readonly string[]).includes(status)) return { error: "Holat noto'g'ri" };
  const note = rawNote?.trim() || null;
  const before = await db.vehicle.findUnique({ where: { id: vehicleId } });
  if (!before) return { error: "Texnika topilmadi" };
  if (status !== "ACTIVE" && !note) return { error: "Sababini yozing (ta'mir turi / nega bekor turibdi)" };
  const after = await db.vehicle.update({
    where: { id: vehicleId },
    data: { status: status as VehicleStatus, statusNote: status === "ACTIVE" ? null : note, statusSince: status === before.status ? before.statusSince : new Date() },
  });
  await audit(db, userId, "UPDATE", "Vehicle", vehicleId, { status: before.status, note: before.statusNote }, { status: after.status, note: after.statusNote });
  return { ok: true, id: vehicleId };
}

// ───────────────────────── Texnik xizmat jurnali (mexanik) ─────────────────────────

export const serviceSchema = z.object({
  kind: zStr("Xizmat turini tanlang").pipe(z.string().max(80, "ko'pi bilan 80 belgi")),
  date: dayField, odometerKm: numIn(0, 3_000_000), cost: numIn(0, MAX_AMOUNT), note: zOpt,
  nextDueAt: dayField, nextDueKm: numIn(0, 3_000_000),
});
export type ServiceInput = z.infer<typeof serviceSchema>;

/**
 * Xizmat yozuvi: moy almashtirish, ta'mir, shina, ko'rik — keyingi xizmat sanasi/probegi bilan.
 * Probeg transport kartasidagidan katta bo'lsa — karta ham yangilanadi (probeg orqaga ketmaydi).
 * Narx bu yerda faqat jurnal uchun: pul xarajati "Boshqa xarajatlar"ga alohida yoziladi (ikki marta sanalmasin).
 */
export async function addVehicleServiceRecord(vehicleId: string, d: ServiceInput, userId: string): Promise<AdminResult> {
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
      data: { vehicleId, kind: d.kind, date, odometerKm: odo, cost: d.cost ?? null, note: d.note, nextDueAt: d.nextDueAt, nextDueKm: nextKm, createdById: userId },
    });
    if (odo != null && (v.odometerKm == null || odo > v.odometerKm)) await tx.vehicle.update({ where: { id: vehicleId }, data: { odometerKm: odo } });
    await audit(tx, userId, "CREATE", "VehicleService", x.id, undefined, x);
    return x;
  });
  return row ? { ok: true, id: row.id } : { error: "Saqlanmadi" };
}

/**
 * Xato yozilgan xizmat yozuvini bekor qilish (o'chirilmaydi): yozuv «Bekor qilingan» bo'lib jurnalda qoladi,
 * keyingi xizmat muddati va hisob-kitoblarga kirmaydi. `id` — yozuvning transporti (sahifani yangilash uchun).
 */
export async function cancelVehicleServiceRecord(id: string, reason: string, userId: string): Promise<AdminResult> {
  const r = await cancelLogisticsRow("VehicleService", id, reason, userId);
  return "error" in r ? r : { ok: true, id: r.vehicleId ?? id };
}

// ───────────────────────── Obyekt ─────────────────────────

export const siteSchema = z.object({
  customerId: zStr("Mijozni tanlang"), name: zStr("Obyekt nomini kiriting"), address: zStr("Manzilni kiriting"),
  lat: numIn(-90, 90), lng: numIn(-180, 180), contactName: zOpt, contactPhone: zOpt, deliveryHours: zOpt, instructions: zOpt, isActive: boolField,
});
export type SiteInput = z.infer<typeof siteSchema>;

/** Obyekt qo'shish (id = null) yoki tahrirlash. Nuqta yangi qo'yilsa — nuqtasiz ochiq zayavkalar ham to'ldiriladi. */
export async function saveSiteRecord(id: string | null, d: SiteInput, userId: string): Promise<AdminResult> {
  const data = { ...d, isActive: id ? d.isActive : true };
  if (id) {
    const before = await db.site.findUnique({ where: { id } });
    if (!before) return { error: "Obyekt topilmadi" };
    const after = await db.site.update({ where: { id }, data });
    await audit(db, userId, "UPDATE", "Site", id, before, after);
    // Nuqta yangi qo'yilgan bo'lsa — shu obyektning nuqtasiz ochiq zayavkalari ham to'ldiriladi (haydovchi navigatsiyasi)
    if (d.lat != null && d.lng != null) {
      await db.order.updateMany({ where: { siteId: id, lat: null, status: { in: ["DRAFT", "BLOCKED", "CONFIRMED", "IN_PRODUCTION"] } }, data: { lat: d.lat, lng: d.lng } });
    }
    return { ok: true, id };
  }
  const x = await db.site.create({ data });
  await audit(db, userId, "CREATE", "Site", x.id, undefined, x);
  return { ok: true, id: x.id };
}

// ───────────────────────── Haydovchi kartasi ─────────────────────────

export const driverCardSchema = z.object({ workSchedule: zOpt, licenseNo: zOpt, licenseCategory: zOpt, licenseExpiry: dayField, vehicleId: zOpt });
export type DriverCardInput = z.infer<typeof driverCardSchema>;

/** Logistika to'ldiradigan qism: grafik, guvohnoma, biriktirilgan transport. Shaxsiy ma'lumot — Otdel kadrda. */
export async function saveDriverCardRecord(employeeId: string, d: DriverCardInput, userId: string): Promise<AdminResult> {
  const before = await db.employee.findUnique({ where: { id: employeeId } });
  if (!before) return { error: "Xodim topilmadi" };
  const after = await db.employee.update({ where: { id: employeeId }, data: d });
  await audit(db, userId, "UPDATE", "Employee", employeeId,
    { workSchedule: before.workSchedule, licenseNo: before.licenseNo, licenseCategory: before.licenseCategory, licenseExpiry: before.licenseExpiry, vehicleId: before.vehicleId },
    { workSchedule: after.workSchedule, licenseNo: after.licenseNo, licenseCategory: after.licenseCategory, licenseExpiry: after.licenseExpiry, vehicleId: after.vehicleId });
  return { ok: true, id: employeeId };
}

// ───────────────────────── Yoqilg'i va xarajat ─────────────────────────

export const fuelSchema = z.object({
  vehicleId: zStr("Transportni tanlang"), driverId: zOpt, tripId: zOpt, date: dayField,
  fuelType: optEnum(["DIESEL", "PETROL", "METHANE", "PROPANE"]),
  liters: numIn(0, 1000), pricePerL: numIn(0, MAX_AMOUNT), odometerKm: numIn(0, 3_000_000), station: zOpt, note: zOpt,
});
export type FuelFormInput = z.infer<typeof fuelSchema>;

/** Zapravka (Logistika → Yoqilg'i formasi). Qoidalar — `addFuelLog`. */
export async function addFuelRecord(d: FuelFormInput, userId: string): Promise<AdminResult> {
  try {
    const r = await addFuelLog({
      vehicleId: d.vehicleId, driverId: d.driverId, tripId: d.tripId, date: d.date, fuelType: (d.fuelType ?? null) as FuelType | null,
      liters: d.liters ?? 0, pricePerL: d.pricePerL ?? 0, odometerKm: d.odometerKm != null ? Math.round(d.odometerKm) : null, station: d.station, note: d.note,
    }, userId);
    return { ok: true, id: r.id };
  } catch (e) { return { error: (e as Error).message }; }
}

export const EXPENSE_KINDS = ["DRIVER_PAY", "ROAD", "REPAIR", "PARTS", "PARKING", "FINE", "WASH", "OTHER"] as const;
export const expenseSchema = z.object({
  kind: z.enum(EXPENSE_KINDS, { message: "Xarajat turini tanlang" }),
  amount: numIn(0, MAX_AMOUNT), date: dayField, vehicleId: zOpt, driverId: zOpt, tripId: zOpt, note: zOpt,
});
export type ExpenseFormInput = z.infer<typeof expenseSchema>;

/** Mexanik faqat texnikaga oid xarajatni yozadi: ta'mir, ehtiyot qism / moy, yuvish. */
export const MECHANIC_EXPENSE_KINDS = ["REPAIR", "PARTS", "WASH"] as const;

/** Transport xarajati (Logistika → Xarajatlar, mexanik — transport kartasidan). */
export async function addExpenseRecord(role: Role, d: ExpenseFormInput, userId: string): Promise<AdminResult> {
  if (role === "MECHANIC") {
    if (!(MECHANIC_EXPENSE_KINDS as readonly string[]).includes(d.kind)) return { error: "Mexanik faqat ta'mir, ehtiyot qism / moy va yuvish xarajatini yozadi" };
    if (!d.vehicleId) return { error: "Transportni tanlang" };
    if (d.tripId || d.driverId) return { error: "Mexanik xarajati transportga yoziladi (reys/haydovchisiz)" };
  }
  try {
    const r = await addTransportExpense({ kind: d.kind as TransportExpenseKind, amount: d.amount ?? 0, date: d.date, vehicleId: d.vehicleId, driverId: d.driverId, tripId: d.tripId, note: d.note }, userId);
    return { ok: true, id: r.id };
  } catch (e) { return { error: (e as Error).message }; }
}

/** Xato kiritilgan zapravkani bekor qilish (o'chirilmaydi — «Bekor qilingan» bo'lib qoladi, jami va hisobotlarga kirmaydi). */
export async function cancelFuelRecord(id: string, reason: string, userId: string): Promise<AdminResult> {
  const r = await cancelLogisticsRow("FuelLog", id, reason, userId);
  return "error" in r ? r : { ok: true, id };
}

/** Xato kiritilgan xarajatni bekor qilish (o'chirilmaydi — «Bekor qilingan» bo'lib qoladi, jami va hisobotlarga kirmaydi). */
export async function cancelExpenseRecord(id: string, reason: string, userId: string): Promise<AdminResult> {
  const r = await cancelLogisticsRow("TransportExpense", id, reason, userId);
  return "error" in r ? r : { ok: true, id };
}

// ───────────────────────── Bekor qilish (umumiy) ─────────────────────────

/** Bekor qilish sababi: kamida 3 belgi, 300 gacha (veb va mobil bir xil). */
export function cancelReasonOf(reason: unknown): string | null {
  const why = String(reason ?? "").trim();
  return why.length >= 3 ? why.slice(0, 300) : null;
}

/**
 * Zapravka / transport xarajati / xizmat yozuvini bekor qilish: `cancelledAt` shartli `updateMany` bilan
 * (ikki parallel bosish — ikkinchisi "allaqachon bekor qilingan" ni oladi), sababi bilan, auditga STATUS_CHANGE.
 */
async function cancelLogisticsRow(entity: "FuelLog" | "TransportExpense" | "VehicleService", id: string, reason: string, userId: string): Promise<{ error: string } | { vehicleId: string | null }> {
  const why = cancelReasonOf(reason);
  if (!why) return { error: "Bekor qilish sababini yozing (kamida 3 belgi)" };
  return db.$transaction(async (tx) => {
    const data = { cancelledAt: new Date(), cancelledById: userId, cancelReason: why };
    const where = { id, cancelledAt: null };
    const before = entity === "FuelLog" ? await tx.fuelLog.findUnique({ where: { id } })
      : entity === "TransportExpense" ? await tx.transportExpense.findUnique({ where: { id } })
      : await tx.vehicleService.findUnique({ where: { id } });
    if (!before) return { error: "Topilmadi" };
    const r = entity === "FuelLog" ? await tx.fuelLog.updateMany({ where, data })
      : entity === "TransportExpense" ? await tx.transportExpense.updateMany({ where, data })
      : await tx.vehicleService.updateMany({ where, data });
    if (r.count === 0) return { error: "Bu yozuv allaqachon bekor qilingan" };
    await audit(tx, userId, "STATUS_CHANGE", entity, id, { cancelledAt: null, record: before }, { cancelledAt: data.cancelledAt, reason: why });
    return { vehicleId: before.vehicleId };
  });
}
