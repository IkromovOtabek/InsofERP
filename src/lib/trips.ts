import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { nextNo } from "@/lib/numbering";

/**
 * Reys (nakladnoy) holat o'tishlari — yagona joy. Server action'lar (logist tugma bosganda) ham,
 * Insof ECO webhook'i (haydovchi ilovada bosganda) ham shu funksiyalarni chaqiradi.
 * Sessiya/ruxsat tekshiruvi va revalidate — chaqiruvchida.
 */
export type TripResult = { changed: boolean; error?: string; orderId: string };

const tripWithOrder = (id: string) => db.trip.findUniqueOrThrow({ where: { id }, include: { order: { include: { items: true, trips: true } } } });

/** PLANNED → LOADED: tayyor beton skladdan chiqadi (SHIPMENT). */
export async function tripLoaded(id: string, userId: string, note?: string): Promise<TripResult> {
  const t = await tripWithOrder(id);
  if (t.status !== "PLANNED") return { changed: false, orderId: t.orderId, error: t.status === "CANCELLED" ? "Reys bekor qilingan" : undefined };
  const productId = t.order.items[0]?.productId;
  const wh = await db.warehouse.findFirstOrThrow({ where: { isActive: true } });
  await db.$transaction(async (tx) => {
    await tx.trip.update({ where: { id }, data: { status: "LOADED", loadedAt: new Date() } });
    if (productId) {
      await tx.stockMove.create({ data: { type: "SHIPMENT", warehouseId: wh.id, productId, qty: -Number(t.qtyM3), refType: "Trip", refId: id, note, createdById: userId } });
    }
    await audit(tx, userId, "STATUS_CHANGE", "Trip", id, { status: "PLANNED" }, { status: "LOADED", note });
  });
  return { changed: true, orderId: t.orderId };
}

/** LOADED → ON_ROAD. PLANNED bo'lsa avval yuklanadi (ECO'dan "yo'lda" kelganda). */
export async function tripOnRoad(id: string, userId: string, note?: string): Promise<TripResult> {
  let t = await db.trip.findUniqueOrThrow({ where: { id } });
  if (t.status === "PLANNED") { await tripLoaded(id, userId, note); t = await db.trip.findUniqueOrThrow({ where: { id } }); }
  if (t.status !== "LOADED") return { changed: false, orderId: t.orderId };
  await db.trip.update({ where: { id }, data: { status: "ON_ROAD" } });
  await audit(db, userId, "STATUS_CHANGE", "Trip", id, { status: "LOADED" }, { status: "ON_ROAD", note });
  return { changed: true, orderId: t.orderId };
}

/** → DELIVERED. Zayavkaning hamma hajmi yetkazilgan bo'lsa — zayavka DELIVERED. */
export async function tripDelivered(id: string, userId: string, receiverName: string, note?: string): Promise<TripResult> {
  let t = await tripWithOrder(id);
  if (t.status === "PLANNED") { await tripLoaded(id, userId, note); t = await tripWithOrder(id); }
  if (!["LOADED", "ON_ROAD"].includes(t.status)) return { changed: false, orderId: t.orderId, error: t.status === "DELIVERED" ? undefined : "Holat mos emas" };

  const total = t.order.items.reduce((s, i) => s + Number(i.qtyM3), 0);
  const delivered = t.order.trips.filter((x) => x.status === "DELIVERED" || x.id === id).reduce((s, x) => s + Number(x.qtyM3), 0);
  await db.$transaction(async (tx) => {
    await tx.trip.update({ where: { id }, data: { status: "DELIVERED", deliveredAt: new Date(), receiverName } });
    if (delivered >= total - 0.001) await tx.order.update({ where: { id: t.orderId }, data: { status: "DELIVERED" } });
    await audit(tx, userId, "STATUS_CHANGE", "Trip", id, { status: t.status }, { status: "DELIVERED", receiverName, note });
  });
  return { changed: true, orderId: t.orderId };
}

/** PLANNED → CANCELLED. */
export async function tripCancelled(id: string, userId: string, note?: string): Promise<TripResult> {
  const t = await db.trip.findUniqueOrThrow({ where: { id } });
  if (t.status !== "PLANNED") return { changed: false, orderId: t.orderId, error: "Faqat rejalashtirilgan reys bekor qilinadi" };
  await db.trip.update({ where: { id }, data: { status: "CANCELLED" } });
  await audit(db, userId, "STATUS_CHANGE", "Trip", id, { status: "PLANNED" }, { status: "CANCELLED", note });
  return { changed: true, orderId: t.orderId };
}

// ───────────────────────── Yangi reys ─────────────────────────

export type NewTripInput = { orderId: string; vehicleId: string; driverId: string; qtyM3: number; note?: string | null };

/**
 * Reys (nakladnoy) ochish — veb "Yangi reys" formasi ham, mobil ilova ham shu yerdan.
 * Tekshiruvlar: zayavka tasdiqlanganmi, qoldiq yetadimi, mikser sig'imi oshmaydimi.
 * ECO'ga yuborish chaqiruvchida (u yerda kutish/kutmaslik farq qiladi).
 */
export async function createTrip(input: NewTripInput, userId: string): Promise<{ id: string; deliveryNoteNo: string }> {
  if (!(input.qtyM3 > 0)) throw new Error("Miqdor 0 dan katta bo'lsin");
  const o = await db.order.findUnique({ where: { id: input.orderId }, include: { items: true, trips: true } });
  if (!o || !["CONFIRMED", "IN_PRODUCTION"].includes(o.status)) throw new Error("Zayavka tasdiqlanmagan yoki yopilgan");

  const total = o.items.reduce((s, i) => s + Number(i.qtyM3), 0);
  const shipped = o.trips.filter((t) => t.status !== "CANCELLED").reduce((s, t) => s + Number(t.qtyM3), 0);
  const left = total - shipped;
  if (input.qtyM3 > left + 0.001) throw new Error(`Zayavkada faqat ${left} m³ qoldi`);

  const v = await db.vehicle.findUnique({ where: { id: input.vehicleId } });
  if (!v || !v.isActive) throw new Error("Mikser topilmadi yoki nofaol");
  if (v.capacityM3 && input.qtyM3 > Number(v.capacityM3)) throw new Error(`Mikser sig'imi ${v.capacityM3} m³`);

  const d = await db.employee.findUnique({ where: { id: input.driverId } });
  if (!d || !d.isActive) throw new Error("Haydovchi topilmadi yoki nofaol");

  return db.$transaction(async (tx) => {
    const t = await tx.trip.create({
      data: { deliveryNoteNo: await nextNo(tx, "trip", "N"), orderId: input.orderId, vehicleId: input.vehicleId, driverId: input.driverId, qtyM3: input.qtyM3, note: input.note ?? undefined },
    });
    await audit(tx, userId, "CREATE", "Trip", t.id, undefined, t);
    return { id: t.id, deliveryNoteNo: t.deliveryNoteNo };
  });
}
