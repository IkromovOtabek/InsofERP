import { db } from "@/lib/db";
import type { Role } from "@/generated/prisma";
import type { EcoLiveTrip } from "./client";

/** Veb sessiyasi ham, mobil foydalanuvchi ham shu shaklga keltiriladi. */
export type Viewer = { userId: string; role: Role };

/**
 * Kim qaysi reysni xaritada ko'radi.
 *
 * Qoida bitta joyda turadi, chunki xarita endi bir necha sahifada chiqadi
 * (reyslar, zayavka kartochkasi, bosh sahifa, haydovchi kartochkasi, mobil ilova) —
 * ruxsat har birida qayta yozilsa, bir joyda unutilib qolishi aniq.
 */

/** Yo'ldagi hamma mashinani ko'radigan rollar. DIRECTOR alohida tekshiriladi — u hamma bo'limni ko'radi. */
const FULL_VIEW: Role[] = ["LOGISTICS", "PRODUCTION", "SUPERVISOR"];

export function seesAllTrips(role: Role) {
  return role === "DIRECTOR" || FULL_VIEW.includes(role);
}

/**
 * Sotuvchi faqat **o'zi ochgan** zayavkalarning reyslarini ko'radi — boshqa agentning
 * mijozi unga ko'rinmaydi. Bog'lanish: ECO `orderRef` = ERP `Order.orderNo`.
 */
export async function visibleTrips(s: Viewer, trips: EcoLiveTrip[]): Promise<EcoLiveTrip[]> {
  if (seesAllTrips(s.role)) return trips;
  // Haydovchi — faqat o'ziga biriktirilgan reyslar (ECO `ref` = ERP nakladnoy raqami)
  if (s.role === "DRIVER") {
    const mine = await db.trip.findMany({ where: { driver: { userId: s.userId } }, select: { deliveryNoteNo: true } });
    const notes = new Set(mine.map((t) => t.deliveryNoteNo));
    return trips.filter((t) => notes.has(t.ref));
  }
  if (s.role !== "SALES") return [];
  const refs = [...new Set(trips.map((t) => t.orderRef).filter((r): r is string => !!r))];
  if (refs.length === 0) return [];
  const mine = await db.order.findMany({
    where: { orderNo: { in: refs }, createdById: s.userId },
    select: { orderNo: true },
  });
  const allowed = new Set(mine.map((o) => o.orderNo));
  return trips.filter((t) => t.orderRef && allowed.has(t.orderRef));
}

/** Bitta reysning izini ko'rsa bo'ladimi (nakladnoy raqami bo'yicha). */
export async function canSeeTrack(s: Viewer, deliveryNoteNo: string): Promise<boolean> {
  if (seesAllTrips(s.role)) return true;
  if (s.role === "DRIVER") {
    return !!(await db.trip.findFirst({ where: { deliveryNoteNo, driver: { userId: s.userId } }, select: { id: true } }));
  }
  if (s.role !== "SALES") return false;
  const trip = await db.trip.findFirst({
    where: { deliveryNoteNo, order: { createdById: s.userId } },
    select: { id: true },
  });
  return !!trip;
}
