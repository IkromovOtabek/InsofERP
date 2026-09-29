import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import type { FuelType, TransportExpenseKind } from "@/generated/prisma";

/**
 * Yoqilg'i va transport xarajatlari — veb (Logistika → Yoqilg'i / Xarajatlar) ham,
 * haydovchi ilovasi ham shu funksiyalarni chaqiradi.
 *
 * Bu pul harakati emas, logistika tannarxi: reys, transport va haydovchi kesimida yig'iladi.
 * Kassadan chiqim Kirim-Chiqimda alohida yuritiladi (ikki marta sanalmasin).
 */

export type FuelInput = {
  vehicleId: string; driverId?: string | null; tripId?: string | null; date?: Date | null;
  fuelType?: FuelType | null; liters: number; pricePerL: number;
  odometerKm?: number | null; station?: string | null; note?: string | null;
};

export async function addFuelLog(input: FuelInput, userId: string): Promise<{ id: string }> {
  if (!(input.liters > 0)) throw new Error("Litr 0 dan katta bo'lsin");
  if (!(input.pricePerL > 0)) throw new Error("1 litr narxini kiriting");
  const v = await db.vehicle.findUnique({ where: { id: input.vehicleId } });
  if (!v) throw new Error("Transport topilmadi");
  const fuelType = input.fuelType ?? v.fuelType ?? "DIESEL";
  // Probeg orqaga ketmaydi — xato raqam yozilsa sarf hisobi buziladi
  if (input.odometerKm != null && v.odometerKm != null && input.odometerKm < v.odometerKm) {
    throw new Error(`Probeg ${v.odometerKm} km dan kam bo'lmasin (oxirgi yozilgan)`);
  }
  const amount = Math.round(input.liters * input.pricePerL);
  const row = await db.$transaction(async (tx) => {
    const f = await tx.fuelLog.create({
      data: {
        vehicleId: v.id, driverId: input.driverId ?? null, tripId: input.tripId ?? null, date: input.date ?? new Date(),
        fuelType, liters: input.liters, pricePerL: input.pricePerL, amount,
        odometerKm: input.odometerKm ?? null, station: input.station?.trim() || null, note: input.note?.trim() || null, createdById: userId,
      },
    });
    if (input.odometerKm != null) await tx.vehicle.update({ where: { id: v.id }, data: { odometerKm: input.odometerKm } });
    await audit(tx, userId, "CREATE", "FuelLog", f.id, undefined, f);
    return f;
  });
  return { id: row.id };
}

export type ExpenseInput = {
  kind: TransportExpenseKind; amount: number; date?: Date | null;
  vehicleId?: string | null; driverId?: string | null; tripId?: string | null; note?: string | null;
};

export async function addTransportExpense(input: ExpenseInput, userId: string): Promise<{ id: string }> {
  if (!(input.amount > 0)) throw new Error("Summa 0 dan katta bo'lsin");
  if (!input.vehicleId && !input.driverId && !input.tripId) throw new Error("Transport, haydovchi yoki reysdan birini tanlang");
  // Reys tanlangan bo'lsa transport/haydovchi undan olinadi — hisobotda bir-biriga zid bo'lmasin
  let vehicleId = input.vehicleId ?? null, driverId = input.driverId ?? null;
  if (input.tripId) {
    const t = await db.trip.findUnique({ where: { id: input.tripId }, select: { vehicleId: true, driverId: true } });
    if (!t) throw new Error("Reys topilmadi");
    vehicleId = t.vehicleId; driverId = t.driverId;
  }
  const e = await db.transportExpense.create({
    data: { kind: input.kind, amount: input.amount, date: input.date ?? new Date(), vehicleId, driverId, tripId: input.tripId ?? null, note: input.note?.trim() || null, createdById: userId },
  });
  await audit(db, userId, "CREATE", "TransportExpense", e.id, undefined, e);
  return { id: e.id };
}

/** Oxirgi zapravkadagi narx — forma uchun taklif (har safar qo'lda yozmaslik uchun). */
export async function lastFuelPrice(fuelType?: FuelType | null): Promise<number | null> {
  const f = await db.fuelLog.findFirst({ where: fuelType ? { fuelType } : {}, orderBy: { date: "desc" }, select: { pricePerL: true } });
  return f ? Number(f.pricePerL) : null;
}

/** Davr bo'yicha xarajat: yoqilg'i + boshqa, reys/transport/haydovchi kesimida. */
export async function transportCosts(from: Date, to: Date) {
  const [fuel, other] = await Promise.all([
    db.fuelLog.findMany({ where: { date: { gte: from, lt: to } }, select: { amount: true, liters: true, vehicleId: true, driverId: true, tripId: true } }),
    db.transportExpense.findMany({ where: { date: { gte: from, lt: to } }, select: { amount: true, kind: true, vehicleId: true, driverId: true, tripId: true } }),
  ]);
  const fuelSum = fuel.reduce((s, f) => s + Number(f.amount), 0);
  const liters = fuel.reduce((s, f) => s + Number(f.liters), 0);
  const otherSum = other.reduce((s, e) => s + Number(e.amount), 0);
  const byKind = new Map<string, number>();
  for (const e of other) byKind.set(e.kind, (byKind.get(e.kind) ?? 0) + Number(e.amount));
  const byVehicle = new Map<string, { fuel: number; other: number; liters: number }>();
  const addV = (id: string | null, k: "fuel" | "other", a: number, l = 0) => {
    if (!id) return;
    const r = byVehicle.get(id) ?? { fuel: 0, other: 0, liters: 0 };
    r[k] += a; r.liters += l; byVehicle.set(id, r);
  };
  for (const f of fuel) addV(f.vehicleId, "fuel", Number(f.amount), Number(f.liters));
  for (const e of other) addV(e.vehicleId, "other", Number(e.amount));
  const byTrip = new Map<string, number>();
  for (const x of [...fuel, ...other]) if (x.tripId) byTrip.set(x.tripId, (byTrip.get(x.tripId) ?? 0) + Number(x.amount));
  return { fuel: fuelSum, liters, other: otherSum, total: fuelSum + otherSum, byKind, byVehicle, byTrip };
}
