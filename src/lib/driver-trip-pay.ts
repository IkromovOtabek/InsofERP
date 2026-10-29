import { db } from "@/lib/db";
import type { Role } from "@/generated/prisma";
import { audit } from "@/lib/audit";
import { notifyAfter, notifyRoles } from "@/lib/notify";
import { tripPayKm } from "@/lib/trip-summary";
import { fmtNum, money } from "@/lib/format";

/**
 * Haydovchi tabeli va reys haqi (dispetcher).
 *
 * Reys yetkazilganda (`tripDelivered`) tabelga o'zi tushadi: haq km (zavod → obyekt → zavod, `tripPayKm`),
 * obyektda kutish (kelgan → tushirish boshlangan, bo'lmasa → yetkazilgan) va tarif bo'yicha taklif yoziladi,
 * dispetcherga «narx belgilanmagan reys» xabari ketadi. Dispetcher taklifni qabul qiladi yoki o'zgartiradi
 * (`pricedAt`) — shundan keyingina reys haqi oylikka (Ish haqi → oy yakuni, «Reyslar» qatori) tushadi.
 * Narxsiz reyslar alohida ro'yxatda turadi va eslatma takrorlanadi (`lib/reminders.ts`).
 *
 * Taklif = reys tarifi + km × km tarifi + (faqat mikser) kutish soati × soat tarifi. Tariflar — `CompanySettings`.
 */

/** Shu sanadan oldin yetkazilgan reyslar narxsiz deb hisoblanmaydi (funksiya ishga tushgan oy). */
export const PAY_SINCE = new Date(2026, 9, 1);
/** Narx belgilaydiganlar (rol bo'yicha; direktor ruxsati bilan boshqalar ham) — `permissions.ts` → logistika.pay. */
export const PRICER_ROLES: Role[] = ["DISPATCHER"];

export type DriverTariff = { trip: number; km: number; waitHour: number };

export async function driverTariff(): Promise<DriverTariff> {
  const s = await db.companySettings.findUnique({ where: { id: "main" }, select: { drvTripRate: true, drvKmRate: true, drvWaitHourRate: true } });
  return { trip: Number(s?.drvTripRate ?? 0), km: Number(s?.drvKmRate ?? 0), waitHour: Number(s?.drvWaitHourRate ?? 0) };
}

export const tariffSet = (t: DriverTariff) => t.trip > 0 || t.km > 0 || t.waitHour > 0;

/** Tarif bo'yicha taklif (1000 so'mga yaxlitlanadi). Kutish faqat mikserga. */
export function suggestPay(t: DriverTariff, km: number, waitMin: number | null, isMixer: boolean): number {
  const wait = isMixer && waitMin ? (waitMin / 60) * t.waitHour : 0;
  return Math.round((t.trip + km * t.km + wait) / 1000) * 1000;
}

/** Taklif tarkibi — dispetcher ko'radi. */
export function suggestText(t: DriverTariff, km: number, waitMin: number | null, isMixer: boolean): string {
  const parts: string[] = [];
  if (t.trip > 0) parts.push(`reys ${money(t.trip)}`);
  if (t.km > 0) parts.push(`${Math.round(km)} km × ${money(t.km)}`);
  if (isMixer && t.waitHour > 0 && waitMin) parts.push(`kutish ${waitMin} daq × ${money(t.waitHour)}/soat`);
  return parts.join(" + ") || "tarif kiritilmagan";
}

/** Kutish vaqti, daqiqa: obyektga kelgandan tushirish boshlanguncha (bo'lmasa — yetkazilguncha). */
export function waitMinutes(t: { arrivedAt: Date | null; unloadingAt: Date | null; deliveredAt: Date | null }): number | null {
  const end = t.unloadingAt ?? t.deliveredAt;
  if (!t.arrivedAt || !end) return null;
  return Math.max(0, Math.round((end.getTime() - t.arrivedAt.getTime()) / 60000));
}

/**
 * Mikser baraban soati haydovchi yozmagan bo'lsa (ECO ilovasida bu maydon yo'q) — reys vaqtlaridan:
 * yuklangandan (bo'lmasa yo'lga chiqqandan) yetkazilguncha, 0.1 soatga yaxlitlab. Faqat mikser; 24 soatdan oshsa — null.
 */
export function autoDrumHours(t: { loadedAt: Date | null; departedAt: Date | null; deliveredAt: Date | null }, vehicleType: string): number | null {
  const start = t.loadedAt ?? t.departedAt;
  if (vehicleType !== "MIXER" || !start || !t.deliveredAt) return null;
  const h = (t.deliveredAt.getTime() - start.getTime()) / 3_600_000;
  return h > 0 && h <= 24 ? Math.round(h * 10) / 10 : null;
}

/**
 * Gaz/yoqilg'i normasi bo'yicha reys sarfi: km × norma/100 + ishlagan soat × turib ishlash normasi.
 * Metanda birlik m³, dizelda litr. Norma kiritilmagan bo'lsa — null.
 */
export function tripFuelNorm(v: { fuelNormL100: unknown; idleNormPerHour: unknown }, km: number, workHours: number | null): number | null {
  const per100 = v.fuelNormL100 != null ? Number(v.fuelNormL100) : 0;
  const idle = v.idleNormPerHour != null ? Number(v.idleNormPerHour) : 0;
  if (!per100 && !idle) return null;
  return Math.round(((km * per100) / 100 + (workHours ?? 0) * idle) * 10) / 10;
}

/** Yoqilg'i birligi: metan — m³, qolgani — litr («Dizel + metan» da bu dizel qismi; metan — `gasNorm`). */
export const fuelUnit = (fuelType: string | null | undefined) => (fuelType === "METHANE" ? "m³" : "l");

/** Reys normasi matni: «120 l», «60 m³» yoki «Dizel + metan» transportda «40 l + 50 m³». Norma yo'q — null. */
export function fuelNormText(r: { fuelNorm: number | null; fuelUnit: string; gasNorm: number | null }): string | null {
  const parts = [r.fuelNorm != null ? `${fmtNum(r.fuelNorm, 1)} ${r.fuelUnit}` : null, r.gasNorm != null ? `${fmtNum(r.gasNorm, 1)} m³` : null].filter(Boolean);
  return parts.length ? parts.join(" + ") : null;
}

const TRIP_PAY_SELECT = {
  id: true, deliveryNoteNo: true, status: true, deliveredAt: true, arrivedAt: true, unloadingAt: true, distanceKm: true, summaryAt: true,
  loadedAt: true, departedAt: true, pricedAt: true, driverId: true, vehicle: { select: { type: true } }, order: { select: { distanceKm: true } },
} as const;

/**
 * Yetkazilgan reysni tabelga yozish: km, kutish, taklif; mikser baraban soati yozilmagan bo'lsa — reys vaqtlaridan
 * (`autoDrumHours`, gaz normasi shundan). Narx allaqachon belgilangan bo'lsa tegmaydi.
 * `tripDelivered` dan keyin chaqiriladi (xato yetkazishni buzmaydi).
 */
export async function snapshotTripPay(tripId: string, opts: { notify?: boolean } = {}): Promise<void> {
  const t = await db.trip.findUnique({ where: { id: tripId }, select: { ...TRIP_PAY_SELECT, workHours: true, driver: { select: { fullName: true } } } });
  if (!t || t.status !== "DELIVERED" || t.pricedAt) return;
  const [kmMap, tariff] = await Promise.all([tripPayKm([t]), driverTariff()]);
  const km = Math.round((kmMap.get(t.id) ?? 0) * 10) / 10;
  const wait = waitMinutes(t);
  const isMixer = t.vehicle.type === "MIXER";
  const suggested = suggestPay(tariff, km, wait, isMixer);
  const drum = t.workHours == null ? autoDrumHours(t, t.vehicle.type) : null;
  await db.trip.updateMany({ where: { id: tripId, pricedAt: null }, data: { payKm: km, waitMin: wait, paySuggested: suggested, ...(drum != null ? { workHours: drum } : {}) } });
  if (opts.notify !== false && t.deliveredAt && t.deliveredAt >= PAY_SINCE) {
    notifyAfter(() => notifyRoles(PRICER_ROLES, {
      type: "TRIP_UNPRICED",
      title: `Narx belgilanmagan reys: ${t.deliveryNoteNo}`,
      body: `${t.driver.fullName} · ${Math.round(km)} km${isMixer && wait ? ` · kutish ${wait} daq` : ""} · taklif ${money(suggested)}`,
      link: { key: "trip-pay", id: t.id },
    }));
  }
}

/** Narxsiz reyslar (dispetcher ro'yxati va eslatmasi) — eskisi oldin. */
export function unpricedWhere(driverId?: string) {
  return { status: "DELIVERED" as const, pricedAt: null, deliveredAt: { gte: PAY_SINCE }, ...(driverId ? { driverId } : {}) };
}

export async function unpricedCount(): Promise<number> {
  return db.trip.count({ where: unpricedWhere() });
}

export type PayTripRow = {
  id: string; no: string; deliveredAt: Date; driverId: string; driver: string; plate: string; vehicleType: string;
  customer: string; km: number; waitMin: number | null; drumTurns: number | null; workHours: number | null;
  suggested: number; suggestText: string; amount: number | null; pricedAt: Date | null; note: string | null;
  fuelNorm: number | null; fuelUnit: string;
  /** «Dizel + metan» transportda metan normasi, m³ (boshqalarida null) */
  gasNorm: number | null;
};

/** Reyslar ro'yxati tabel uchun. Taklif yozilmagan (eski yoki ECO orqali yopilgan) reysga hozir hisoblanadi. */
export async function payTrips(where: object, take = 500): Promise<PayTripRow[]> {
  const rows = await db.trip.findMany({
    where, orderBy: { deliveredAt: "asc" }, take,
    select: {
      ...TRIP_PAY_SELECT, payKm: true, waitMin: true, paySuggested: true, payAmount: true, payNote: true, drumTurns: true, workHours: true,
      driver: { select: { fullName: true } },
      vehicle: { select: { plate: true, type: true, fuelType: true, fuelNormL100: true, idleNormPerHour: true, gasNormPer100: true, gasIdlePerHour: true } },
      order: { select: { distanceKm: true, customer: { select: { name: true } } } },
    },
  });
  const missing = rows.filter((r) => r.payKm == null);
  const [kmMap, tariff] = await Promise.all([missing.length ? tripPayKm(missing) : Promise.resolve(new Map<string, number>()), driverTariff()]);
  return rows.map((r) => {
    const km = r.payKm != null ? Number(r.payKm) : Math.round((kmMap.get(r.id) ?? 0) * 10) / 10;
    const wait = r.waitMin ?? waitMinutes(r);
    const isMixer = r.vehicle.type === "MIXER";
    const hours = r.workHours != null ? Number(r.workHours) : autoDrumHours(r, r.vehicle.type);
    return {
      id: r.id, no: r.deliveryNoteNo, deliveredAt: r.deliveredAt!, driverId: r.driverId, driver: r.driver.fullName, plate: r.vehicle.plate, vehicleType: r.vehicle.type,
      customer: r.order.customer.name, km, waitMin: wait, drumTurns: r.drumTurns, workHours: hours,
      suggested: r.paySuggested != null ? Number(r.paySuggested) : suggestPay(tariff, km, wait, isMixer),
      suggestText: suggestText(tariff, km, wait, isMixer),
      amount: r.payAmount != null ? Number(r.payAmount) : null, pricedAt: r.pricedAt, note: r.payNote,
      fuelNorm: tripFuelNorm(r.vehicle, km, hours), fuelUnit: fuelUnit(r.vehicle.fuelType),
      gasNorm: r.vehicle.fuelType === "DIESEL_METHANE" ? tripFuelNorm({ fuelNormL100: r.vehicle.gasNormPer100, idleNormPerHour: r.vehicle.gasIdlePerHour }, km, hours) : null,
    };
  });
}

/** Shu oy yakuniy vedomosti tasdiqlangan/to'langanmi — unda reys narxi o'zgarmaydi. */
async function monthLocked(d: Date): Promise<boolean> {
  const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  return (await db.payrollRun.count({ where: { month, kind: "FINAL", status: { in: ["APPROVED", "PAID"] } } })) > 0;
}

/** Dispetcher reys haqini belgilaydi (yoki tuzatadi). Birinchi narxdan keyin reys oylikka tushadi. */
export async function priceTrip(tripId: string, amount: number, note: string | null, userId: string): Promise<{ ok: true } | { error: string }> {
  if (!(amount >= 0) || amount > 100_000_000) return { error: "Summa noto'g'ri" };
  const t = await db.trip.findUnique({ where: { id: tripId }, select: { status: true, deliveredAt: true, payAmount: true, pricedAt: true, payNote: true } });
  if (!t) return { error: "Reys topilmadi" };
  if (t.status !== "DELIVERED" || !t.deliveredAt) return { error: "Narx faqat yetkazilgan reysga qo'yiladi" };
  if (await monthLocked(t.deliveredAt)) return { error: "Shu oyning ish haqi vedomosti tasdiqlangan — narxni o'zgartirib bo'lmaydi" };
  if (t.pricedAt && !note) return { error: "Narxni o'zgartirish sababini yozing" };
  const r = await db.trip.updateMany({
    where: { id: tripId, status: "DELIVERED", pricedAt: t.pricedAt },
    data: { payAmount: amount, payNote: note, pricedAt: new Date(), pricedById: userId },
  });
  if (!r.count) return { error: "Reys boshqa joyda o'zgartirildi — sahifani yangilang" };
  await audit(db, userId, "UPDATE", "Trip", tripId, { payAmount: t.payAmount, pricedAt: t.pricedAt, payNote: t.payNote }, { payAmount: amount, payNote: note });
  return { ok: true };
}

/** Bir nechta reysga taklif narxini birdan qo'yish. */
export async function priceTripsBySuggestion(tripIds: string[], userId: string): Promise<{ done: number; failed: number }> {
  const rows = await payTrips({ id: { in: tripIds }, ...unpricedWhere() });
  let done = 0;
  for (const r of rows) if ("ok" in (await priceTrip(r.id, r.suggested, null, userId))) done++;
  return { done, failed: tripIds.length - done };
}

/** Oylik uchun: haydovchi bo'yicha narxlangan reyslar (oy yakuni vedomosti, `lib/hr/payroll.ts`). */
export async function tripPayByDriver(from: Date, to: Date, employeeIds: string[]): Promise<Map<string, { trips: number; km: number; sum: number; unpriced: number }>> {
  const [priced, unpriced] = await Promise.all([
    db.trip.groupBy({ by: ["driverId"], where: { driverId: { in: employeeIds }, status: "DELIVERED", deliveredAt: { gte: from, lt: to }, pricedAt: { not: null } }, _count: true, _sum: { payAmount: true, payKm: true } }),
    db.trip.groupBy({ by: ["driverId"], where: { driverId: { in: employeeIds }, ...unpricedWhere(), deliveredAt: { gte: from > PAY_SINCE ? from : PAY_SINCE, lt: to } }, _count: true }),
  ]);
  const out = new Map<string, { trips: number; km: number; sum: number; unpriced: number }>();
  for (const p of priced) out.set(p.driverId, { trips: p._count, km: Math.round(Number(p._sum.payKm ?? 0)), sum: Number(p._sum.payAmount ?? 0), unpriced: 0 });
  for (const u of unpriced) {
    const cur = out.get(u.driverId) ?? { trips: 0, km: 0, sum: 0, unpriced: 0 };
    out.set(u.driverId, { ...cur, unpriced: u._count });
  }
  return out;
}
