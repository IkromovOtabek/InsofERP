import { db } from "@/lib/db";
import { audit } from "@/lib/audit";

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
