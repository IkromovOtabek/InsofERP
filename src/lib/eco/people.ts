import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { eco, ecoEnabled, EcoError, normalizePhone, type EcoDriver, type EcoVehicle } from "./client";
import { ecoSystemUserId } from "./system-user";
import type { VehicleType } from "@/generated/prisma";

/**
 * ERP ↔ ECO spravochnik sinxroni (xodimlar va texnika).
 * Reyslar `sync.ts` da; bu yerda faqat "kim" va "nima bilan" — ikkala tizimda bir xil ro'yxat turishi uchun.
 *
 * Qoida: telefon — haydovchi uchun yagona kalit (ERP Employee.phone ↔ ECO User.phone), davlat raqami — texnika uchun.
 * Hech bir funksiya tashlamaydi: natija Employee/Vehicle.ecoError da qoladi va Haydovchilar sahifasida ko'rinadi.
 */
export type SyncResult = { ok: boolean; skipped?: boolean; error?: string };

const errMsg = (e: unknown) => (e instanceof EcoError ? `${e.message} [${e.code}]` : String((e as Error)?.message ?? e));
const DRIVER_POSITION = "Haydovchi";
export const isDriverPosition = (p: string) => p.trim().toLowerCase() === DRIVER_POSITION.toLowerCase();

/** ECO'dagi ism ERP kartasini bosib ketmasligi uchun: "ism yo'q" hisoblanadigan qiymatlar. */
const isPlaceholderName = (name: string, phone: string | null) =>
  !name.trim() || name.trim() === phone?.trim() || /^\+?\d[\d\s-]{6,}$/.test(name.trim());

/** ECO texnika turi → ERP turi (ERP'da DUMP/PICKUP yo'q). */
const toErpType = (t: string): VehicleType => (t === "MIXER" || t === "PUMP" ? t : "TRUCK");

// ───────────────────────── ERP → ECO ─────────────────────────

/**
 * ERP xodimi (Haydovchi) → ECO. Yangi bo'lsa a'zolik ochiladi, ismi o'zgargan bo'lsa yangilanadi,
 * ERP'da o'chirilgan bo'lsa ilovaga kirishi yopiladi.
 */
export async function pushEmployeeToEco(employeeId: string): Promise<SyncResult> {
  if (!ecoEnabled()) return { ok: false, skipped: true };
  const e = await db.employee.findUnique({ where: { id: employeeId } });
  if (!e || !isDriverPosition(e.position)) return { ok: false, skipped: true };

  // ERP'da o'chirilgan xodim — ECO'da ham ilovaga kira olmasin
  if (!e.isActive) {
    if (!e.ecoUserId) return { ok: true, skipped: true };
    try {
      const r = await eco.deactivateDriver(e.ecoUserId);
      await rememberEmployee(e.id, { ecoActive: r.isActive }, null);
      return { ok: true };
    } catch (err) {
      await rememberEmployee(e.id, {}, errMsg(err));
      return { ok: false, error: errMsg(err) };
    }
  }

  const phone = normalizePhone(e.phone);
  if (!phone) {
    const error = `"${e.fullName}" telefoni +998XXXXXXXXX formatida emas — ilovaga ulab bo'lmaydi`;
    await rememberEmployee(e.id, {}, error);
    return { ok: false, error };
  }

  try {
    const r = await eco.upsertDriver(phone, e.fullName); // telefon bo'yicha idempotent: bor bo'lsa a'zolik faollashadi
    if (r.fullName !== e.fullName && !isPlaceholderName(e.fullName, phone)) {
      await eco.patchDriver(r.userId, { fullName: e.fullName }); // ERP kartasi — ism manbai
    }
    await rememberEmployee(e.id, { ecoUserId: r.userId, ecoActive: r.isActive, phone }, null);
    return { ok: true };
  } catch (err) {
    await rememberEmployee(e.id, {}, errMsg(err));
    return { ok: false, error: errMsg(err) };
  }
}

/** ERP texnikasi → ECO mashinalari (davlat raqami bo'yicha). O'chirilgan texnika ECO'da ham nofaol. */
export async function pushVehicleToEco(vehicleId: string): Promise<SyncResult> {
  if (!ecoEnabled()) return { ok: false, skipped: true };
  const v = await db.vehicle.findUnique({ where: { id: vehicleId } });
  if (!v) return { ok: false, skipped: true };
  try {
    const r = await eco.upsertVehicle(v.plate, Number(v.capacityM3 ?? 8), v.type, v.isActive);
    await db.vehicle.update({ where: { id: v.id }, data: { ecoVehicleId: r.id, ecoSyncedAt: new Date(), ecoError: null } });
    return { ok: true };
  } catch (err) {
    await db.vehicle.update({ where: { id: v.id }, data: { ecoError: errMsg(err) } }).catch(() => undefined);
    return { ok: false, error: errMsg(err) };
  }
}

/** Server action ichidan "fon rejimida" chaqirish uchun — ECO o'chiq bo'lsa ham ERP amali to'xtamaydi. */
export function pushEmployeeSilently(employeeId: string) {
  if (!ecoEnabled()) return;
  void pushEmployeeToEco(employeeId).catch((e) => console.error("[eco][employee]", e));
}
export function pushVehicleSilently(vehicleId: string) {
  if (!ecoEnabled()) return;
  void pushVehicleToEco(vehicleId).catch((e) => console.error("[eco][vehicle]", e));
}

async function rememberEmployee(id: string, data: { ecoUserId?: string; ecoActive?: boolean; phone?: string }, error: string | null) {
  await db.employee.update({ where: { id }, data: { ...data, ecoError: error, ...(error ? {} : { ecoSyncedAt: new Date() }) } }).catch(() => undefined);
}

// ───────────────────────── ECO → ERP ─────────────────────────

/** ERP'da telefon erkin formatda saqlanadi (998…, +998…, 90 123 45 67) — solishtirish normalizatsiyadan keyin. */
async function findByPhone(phone: string) {
  const list = await db.employee.findMany({ where: { ecoUserId: null, phone: { not: null } }, orderBy: [{ isActive: "desc" }, { createdAt: "asc" }] });
  return list.find((x) => normalizePhone(x.phone) === phone) ?? null;
}

export type EcoDriverEvent = {
  userId: string;
  fullName: string | null;
  phone: string;
  isActive: boolean;
  /** registered — ilovada o'zi yozildi; invited/approved/removed — tasdiqlash; profile — ismini o'zgartirdi */
  reason: "registered" | "invited" | "approved" | "removed" | "profile";
  byIntegration: boolean;
};

/**
 * Haydovchi ilovada ro'yxatdan o'tdi / tasdiqlandi / ismini o'zgartirdi → ERP xodimlar ro'yxati.
 * Xodim topilmasa — avtomatik yaratiladi (aynan shu holat: "ilovada hisobi bor, ERP'da profili yo'q").
 * ERP'da xodim o'chirilishi ECO'dan boshqarilmaydi — faqat `ecoActive` belgisi qo'yiladi.
 */
export async function applyEcoDriver(e: EcoDriverEvent): Promise<{ applied: boolean; employeeId?: string; created?: boolean }> {
  const phone = normalizePhone(e.phone) ?? e.phone;
  const existing = (await db.employee.findUnique({ where: { ecoUserId: e.userId } })) ?? (await findByPhone(phone));
  const userId = await ecoSystemUserId();

  if (!existing) {
    if (e.reason === "removed") return { applied: false }; // ERP'da yo'q xodimni o'chirishning ma'nosi yo'q
    const created = await db.employee.create({
      data: {
        fullName: e.fullName?.trim() || phone,
        position: DRIVER_POSITION,
        phone,
        ecoUserId: e.userId,
        ecoActive: e.isActive,
        ecoSyncedAt: new Date(),
      },
    });
    await audit(db, userId, "CREATE", "Employee", created.id, undefined, { ...created, source: `eco:${e.reason}` });
    return { applied: true, employeeId: created.id, created: true };
  }

  // Ism: ilovada o'zi kiritgan bo'lsa (profile) yoki ERP kartasida ism o'rniga telefon tursa — ECO'dagisi olinadi
  const takeName = !!e.fullName?.trim() && (e.reason === "profile" || isPlaceholderName(existing.fullName, existing.phone));
  const data = {
    ecoUserId: e.userId,
    ecoActive: e.isActive,
    ecoSyncedAt: new Date(),
    ecoError: null,
    ...(takeName ? { fullName: e.fullName!.trim() } : {}),
    ...(existing.phone ? {} : { phone }),
  };
  const updated = await db.employee.update({ where: { id: existing.id }, data });
  if (takeName || existing.ecoUserId !== e.userId || existing.ecoActive !== e.isActive) {
    await audit(db, userId, "UPDATE", "Employee", existing.id, { fullName: existing.fullName, ecoUserId: existing.ecoUserId, ecoActive: existing.ecoActive }, { fullName: updated.fullName, ecoUserId: updated.ecoUserId, ecoActive: updated.ecoActive, source: `eco:${e.reason}` });
  }
  return { applied: true, employeeId: existing.id };
}

export type EcoVehicleEvent = { vehicleId: string; plateNumber: string; capacityM3: number; type: string; isActive: boolean; byIntegration: boolean };

/** Tadbirkor ilovada mashina qo'shdi/o'zgartirdi → ERP texnika ro'yxati. */
export async function applyEcoVehicle(e: EcoVehicleEvent): Promise<{ applied: boolean; vehicleId?: string; created?: boolean }> {
  const plate = e.plateNumber.toUpperCase().replace(/\s+/g, "");
  const existing = (await db.vehicle.findUnique({ where: { ecoVehicleId: e.vehicleId } })) ?? (await db.vehicle.findUnique({ where: { plate } }));
  const userId = await ecoSystemUserId();

  if (!existing) {
    if (!e.isActive) return { applied: false }; // ECO'da o'chirilgan, ERP bilmaydigan mashinani yaratishning ma'nosi yo'q
    const created = await db.vehicle.create({
      data: { plate, type: toErpType(e.type), capacityM3: e.capacityM3 || null, isActive: e.isActive, ecoVehicleId: e.vehicleId, ecoSyncedAt: new Date() },
    });
    await audit(db, userId, "CREATE", "Vehicle", created.id, undefined, { ...created, source: "eco" });
    return { applied: true, vehicleId: created.id, created: true };
  }
  const updated = await db.vehicle.update({
    where: { id: existing.id },
    data: { ecoVehicleId: e.vehicleId, ecoSyncedAt: new Date(), ecoError: null, capacityM3: e.capacityM3 || existing.capacityM3, ...(existing.ecoVehicleId ? { isActive: e.isActive } : {}) },
  });
  if (existing.ecoVehicleId !== e.vehicleId || Number(existing.capacityM3 ?? 0) !== e.capacityM3) {
    await audit(db, userId, "UPDATE", "Vehicle", existing.id, existing, { ...updated, source: "eco" });
  }
  return { applied: true, vehicleId: existing.id };
}

// ───────────────────────── To'liq solishtirish ─────────────────────────

export type DirectorySync = {
  drivers: { pulled: number; created: number; pushed: number; failed: string[] };
  vehicles: { pulled: number; created: number; pushed: number; failed: string[] };
};

/**
 * Ikkala ro'yxatni to'liq tenglashtirish: ECO'dagi haydovchi/mashina ERP'ga tushadi,
 * ERP'dagilari ECO'ga yuboriladi. Webhook yetib bormagan holatlar uchun "qo'lda tugma".
 */
export async function syncDirectories(): Promise<DirectorySync> {
  const out: DirectorySync = { drivers: { pulled: 0, created: 0, pushed: 0, failed: [] }, vehicles: { pulled: 0, created: 0, pushed: 0, failed: [] } };
  if (!ecoEnabled()) return out;

  let ecoDrivers: EcoDriver[] = [];
  let ecoVehicles: EcoVehicle[] = [];
  try {
    [ecoDrivers, ecoVehicles] = await Promise.all([eco.drivers(), eco.vehicles()]);
  } catch (e) {
    out.drivers.failed.push(errMsg(e));
    return out;
  }

  // ECO → ERP
  for (const d of ecoDrivers) {
    try {
      const r = await applyEcoDriver({ userId: d.userId, fullName: d.fullName, phone: d.phone, isActive: d.isActive, reason: d.invitedByPhone ? "invited" : "registered", byIntegration: false });
      if (r.applied) out.drivers.pulled++;
      if (r.created) out.drivers.created++;
    } catch (e) { out.drivers.failed.push(`${d.phone}: ${errMsg(e)}`); }
  }
  for (const v of ecoVehicles) {
    try {
      const r = await applyEcoVehicle({ vehicleId: v.id, plateNumber: v.plateNumber, capacityM3: Number(v.capacityM3), type: v.type, isActive: v.isActive, byIntegration: false });
      if (r.applied) out.vehicles.pulled++;
      if (r.created) out.vehicles.created++;
    } catch (e) { out.vehicles.failed.push(`${v.plateNumber}: ${errMsg(e)}`); }
  }

  // ERP → ECO
  const known = new Set(ecoDrivers.map((d) => d.userId));
  const employees = await db.employee.findMany({ where: { position: { equals: DRIVER_POSITION, mode: "insensitive" } } });
  for (const e of employees) {
    const inEco = e.ecoUserId && known.has(e.ecoUserId);
    if (inEco && e.isActive) continue; // allaqachon mos — yuqorida ECO'dan yangilandi
    const r = await pushEmployeeToEco(e.id);
    if (r.ok && !r.skipped) out.drivers.pushed++;
    else if (r.error) out.drivers.failed.push(`${e.fullName}: ${r.error}`);
  }

  const plates = new Set(ecoVehicles.map((v) => v.plateNumber));
  const vehicles = await db.vehicle.findMany();
  for (const v of vehicles) {
    if (plates.has(v.plate) && v.ecoVehicleId && v.isActive) continue;
    const r = await pushVehicleToEco(v.id);
    if (r.ok && !r.skipped) out.vehicles.pushed++;
    else if (r.error) out.vehicles.failed.push(`${v.plate}: ${r.error}`);
  }

  return out;
}
