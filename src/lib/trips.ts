import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { nextNo } from "@/lib/numbering";

/**
 * Reys (nakladnoy) holat o'tishlari — yagona joy. Server action'lar (logist tugma bosganda) ham,
 * Insof ECO webhook'i (haydovchi ilovada bosganda) ham shu funksiyalarni chaqiradi.
 * Sessiya/ruxsat tekshiruvi va revalidate — chaqiruvchida.
 */
export type TripResult = { changed: boolean; error?: string; orderId: string };

/** Bosqichlarning o'zbekcha nomi — veb ham, ilova ham shu ro'yxatdan oladi. */
export const TRIP_STEP: Record<string, string> = {
  PLANNED: "Rejalashtirildi", LOADED: "Yuklandi", ON_ROAD: "Yo'lga chiqdi", DELIVERED: "Yetkazildi", CANCELLED: "Bekor qilindi",
};
export type TripStep = { id: string; status: string; label: string; by: string; at: Date };

/**
 * Reys bosqichlari tarixi: qaysi holat, qachon va KIM tomonidan belgilangani.
 *
 * Manba — audit jurnali: holat o'zgarishi allaqachon shu yerga yoziladi (yuqoridagi
 * `audit(...)` chaqiruvlari), ya'ni haydovchi ilovadan bosgani ham, logist vebdan
 * bosgani ham, ECO webhook'i keltirgani ham bir xil joyda. Alohida ustun qo'shish
 * o'sha ma'lumotni ikkinchi marta saqlash bo'lardi.
 */
export async function tripSteps(id: string): Promise<TripStep[]> {
  const log = await db.auditLog.findMany({
    where: { entity: "Trip", entityId: id, action: { in: ["CREATE", "STATUS_CHANGE"] } },
    orderBy: { createdAt: "asc" },
    include: { user: { select: { fullName: true } } },
  });
  return log.map((l) => {
    // CREATE — reys ochilgan payt: holat o'shanda PLANNED bo'ladi
    const status = l.action === "CREATE" ? "PLANNED" : String((l.after as { status?: string } | null)?.status ?? "");
    return { id: l.id, status, label: TRIP_STEP[status] ?? status, by: l.user.fullName, at: l.createdAt };
  });
}

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

/**
 * Yukni olgan joyi — "Yuklandi" bosqichida logist belgilaydi.
 *
 * Nega alohida: mikser betonni doim zavoddan olmaydi (ikkinchi maydon, boshqa sklad,
 * pudratchi tuguni). Nuqta haydovchi ilovasida marshrutning boshlanishi bo'lib xizmat
 * qiladi va nakladnoyda "qayerdan chiqdi" savoliga javob bo'ladi.
 */
export async function tripPickup(
  id: string,
  userId: string,
  pickup: { address: string; lat?: number | null; lng?: number | null },
): Promise<TripResult> {
  const address = pickup.address.trim();
  if (!address) return { changed: false, orderId: "", error: "Yuk olingan joy manzilini yozing" };
  const t = await db.trip.findUniqueOrThrow({ where: { id } });
  if (t.status === "CANCELLED") return { changed: false, orderId: t.orderId, error: "Reys bekor qilingan" };
  const data = { pickupAddress: address, pickupLat: pickup.lat ?? null, pickupLng: pickup.lng ?? null };
  await db.trip.update({ where: { id }, data });
  await audit(db, userId, "UPDATE", "Trip", id, { pickupAddress: t.pickupAddress, pickupLat: t.pickupLat, pickupLng: t.pickupLng }, data);
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

// ───────────────────────── Yo'l izi (GPS) ─────────────────────────

export type TrackPoint = { lat: number; lng: number; at: Date };

/**
 * Reysning bosib o'tgan yo'li — vaqt bo'yicha tartiblangan nuqtalar.
 *
 * Bu faqat ZAVOD haydovchilarining izi (ular ERP logini bilan kiradi). Tashqi pudratchi
 * haydovchilar Insof ECO ilovasidan yuradi va ularning izi ECO'da qoladi — xarita
 * ikkala manbani qo'shib ko'rsatadi (`lib/eco/client.ts`).
 */
export async function tripTrack(tripId: string): Promise<TrackPoint[]> {
  return db.tripPosition.findMany({ where: { tripId }, orderBy: { at: "asc" }, select: { lat: true, lng: true, at: true } });
}

/** Bir nechta reysning OXIRGI nuqtasi — xaritadagi mashina belgilari uchun. */
export async function lastTripPositions(tripIds: string[]): Promise<Map<string, TrackPoint>> {
  if (tripIds.length === 0) return new Map();
  // Har reys uchun alohida so'rov o'rniga bittasi: nuqtalar ko'p emas (reysiga bir necha yuz)
  const rows = await db.tripPosition.findMany({
    where: { tripId: { in: tripIds } },
    orderBy: { at: "desc" },
    select: { tripId: true, lat: true, lng: true, at: true },
  });
  const last = new Map<string, TrackPoint>();
  for (const r of rows) if (!last.has(r.tripId)) last.set(r.tripId, { lat: r.lat, lng: r.lng, at: r.at });
  return last;
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
