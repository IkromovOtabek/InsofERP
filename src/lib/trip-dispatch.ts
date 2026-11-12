import { db } from "@/lib/db";
import { reportTripIssue, tripArrived, tripDelivered, tripLoaded, tripOnRoad, tripReturned, tripUnloading, type DeliveryQty } from "@/lib/trips";
import { addFuelLog, addTransportExpense } from "@/lib/logistics-costs";
import type { FuelType, TransportExpenseKind } from "@/generated/prisma";

/**
 * Dispetcher reys bosqichini haydovchi o'rniga belgilaydi (haydovchi ilovasi ishlamaganda —
 * telefon o'chgan, pudratchi) va reysga xarajat yozadi. Veb reys kartasi (`app/(app)/trips/actions.ts`)
 * ham, mobil ilova ham shu funksiyalarni chaqiradi. Ruxsat (`trips` → `move` / `cost`) va ECO'ga
 * xabar berish — chaqiruvchida.
 */

export type DispatchResult = { error: string } | { ok: true; orderId: string; changed: boolean };

/** Auditda "dispetcher belgiladi" — haydovchining o'z bosgani bilan aralashmasin. */
export const DISPATCH_NOTE = "Dispetcher belgiladi (veb)";

/** LOADED → ON_ROAD — faqat yuklangan reys. */
export async function dispatchOnRoad(id: string, userId: string, note = DISPATCH_NOTE): Promise<DispatchResult> {
  const cur = await db.trip.findUnique({ where: { id }, select: { status: true } });
  if (!cur) return { error: "Reys topilmadi" };
  if (cur.status !== "LOADED") return { error: "Faqat yuklangan reys yo'lga chiqariladi" };
  const r = await tripOnRoad(id, userId, note);
  if (r.error) return { error: r.error };
  return { ok: true, orderId: r.orderId, changed: r.changed };
}

/**
 * LOADED / ON_ROAD → DELIVERED: qabul qilgan kishi va miqdorlar bilan (haydovchi o'rniga).
 * Haydovchi telefoni shu reysda ilova bilan aloqada bo'lgan bo'lsa (`lastSeenAt` — GPS nuqta yoki «tirikman»), u o'zi
 * belgilashi kerak edi — dispetcher bosgani reysga muammo bo'lib tushadi va hal qilinmaguncha reys yopilmaydi.
 * Ilovasiz haydovchi (hozircha hammasi) va ko'chadan mashinada muammo yozilmaydi — kim belgilagani auditda qoladi.
 */
export async function dispatchDelivered(id: string, userId: string, receiverName: string, q: DeliveryQty, note = DISPATCH_NOTE): Promise<DispatchResult & { issue?: boolean }> {
  const name = receiverName.trim();
  if (!name) return { error: "Obyektda kim qabul qilganini yozing" };
  const cur = await db.trip.findUnique({ where: { id }, select: { status: true, lastSeenAt: true, vehicle: { select: { external: true } } } });
  if (!cur) return { error: "Reys topilmadi" };
  if (!["LOADED", "ON_ROAD"].includes(cur.status)) return { error: "Faqat yuklangan yoki yo'ldagi reys yetkazildi deb belgilanadi" };
  const r = await tripDelivered(id, userId, name, note, q);
  if (r.error) return { error: r.error };
  if (!r.changed) return { error: "Holat o'zgargan — sahifani yangilang" };
  const issue = !cur.vehicle.external && !!cur.lastSeenAt;
  if (issue) await reportTripIssue(id, userId, { kind: "OTHER", source: "LOGISTICS", note: `Haydovchi ilovasi ulangan, lekin yetkazildi dispetcher tomonidan belgilandi (GPS tasdig'isiz) — qabul qildi: ${name}` }).catch(() => undefined);
  return { ok: true, orderId: r.orderId, changed: true, issue };
}

/** Haydovchi ilovasidagi qolgan tugmalar — dispetcher haydovchi o'rniga bosadi (veb reys kartasi). */
export const DRIVER_STEPS = ["loaded", "arrived", "unloading", "returned"] as const;
export type DriverStep = (typeof DRIVER_STEPS)[number];

/**
 * «Yukladim» (PLANNED → LOADED, skladdan chiqim), «Yetib keldim», «Tushirishni boshladim» (ON_ROAD ichida),
 * «Zavodga qaytdim» (yetkazilgandan keyin). Holat qoidalari — `lib/trips.ts`, bu yerda faqat qaysi holatda ruxsat.
 */
export async function dispatchStep(id: string, userId: string, step: DriverStep, note = DISPATCH_NOTE): Promise<DispatchResult> {
  const cur = await db.trip.findUnique({ where: { id }, select: { status: true } });
  if (!cur) return { error: "Reys topilmadi" };
  const need = step === "loaded" ? "PLANNED" : step === "returned" ? "DELIVERED" : "ON_ROAD";
  if (cur.status !== need) {
    return { error: step === "loaded" ? "Reys allaqachon yuklangan" : step === "returned" ? "Avval «Yetkazdim» ni belgilang" : "Avval «Yo'lga chiqdim» ni belgilang" };
  }
  const r = step === "loaded" ? await tripLoaded(id, userId, note)
    : step === "arrived" ? await tripArrived(id, userId, note)
    : step === "unloading" ? await tripUnloading(id, userId, note)
    : await tripReturned(id, userId, note);
  if (r.error) return { error: r.error };
  return { ok: true, orderId: r.orderId, changed: r.changed };
}

export const TRIP_FUEL_TYPES = ["DIESEL", "PETROL", "METHANE", "PROPANE"] as const;
export const TRIP_EXPENSE_KINDS = ["DRIVER_PAY", "ROAD", "REPAIR", "PARTS", "PARKING", "FINE", "WASH", "OTHER"] as const;

export type TripCostInput = {
  /** "FUEL" — zapravka, boshqasi — xarajat turi (`TransportExpenseKind`). */
  what: string;
  fuelType?: string | null; liters?: number | null; pricePerL?: number | null; odometerKm?: number | null; station?: string | null;
  amount?: number | null; note?: string | null;
};

/** Reys kartasidan yoqilg'i yoki xarajat — transport va haydovchi reysdan olinadi. */
export async function addTripCostRecord(tripId: string, input: TripCostInput, userId: string): Promise<DispatchResult> {
  const t = await db.trip.findUnique({ where: { id: tripId }, select: { vehicleId: true, driverId: true, orderId: true } });
  if (!t) return { error: "Reys topilmadi" };
  try {
    if (input.what === "FUEL") {
      const fuelType = (TRIP_FUEL_TYPES as readonly string[]).includes(input.fuelType ?? "") ? (input.fuelType as FuelType) : null;
      await addFuelLog({
        vehicleId: t.vehicleId, driverId: t.driverId, tripId, fuelType,
        liters: input.liters ?? 0, pricePerL: input.pricePerL ?? 0,
        odometerKm: input.odometerKm ?? null, station: input.station ?? "", note: input.note ?? "",
      }, userId);
    } else {
      if (!(TRIP_EXPENSE_KINDS as readonly string[]).includes(input.what)) return { error: "Xarajat turini tanlang" };
      await addTransportExpense({ kind: input.what as TransportExpenseKind, amount: input.amount ?? 0, tripId, note: input.note ?? "" }, userId);
    }
  } catch (e) { return { error: (e as Error).message }; }
  return { ok: true, orderId: t.orderId, changed: true };
}
