import type { Prisma } from "@/generated/prisma";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";

/**
 * Bekor qilingan reys va zayavka bazadan butunlay o'chiriladi (foydalanuvchi qarori, 2026-11-06):
 * ro'yxat, kalendar, hisobot, ilova — hech qayerda qolmasin.
 *
 * Nima o'chadi, nima qoladi:
 *  · reys — nuqtalari, muammolari, ogohlantirishlari bilan o'chadi; yoqilg'i, xarajat va mexanik so'rovi
 *    (haqiqiy pul/yoqilg'i) qoladi, faqat reysga bog'lanishi uziladi;
 *  · zayavka — qatorlari, bekor qilingan topshiriqlari va bosh to'lov so'rovi bilan o'chadi; tushgan avans,
 *    bekor qilingan schyot, storno qilingan zames va tijorat taklifi qoladi (pul/sklad tarixi buzilmasin),
 *    zayavkaga bog'lanishi uziladi — avans mijozning ortiqcha to'lovi bo'lib turadi;
 *  · shu yozuvga olib boradigan bildirishnomalar o'chadi (bosilsa bo'sh sahifa ochilmasin);
 *  · AuditLog qoladi — «kim o'chirdi» shu yerda (DELETE + oxirgi holat nusxasi).
 *
 * Faqat holati CANCELLED bo'lgan yozuv o'chadi — boshqa holatdagini bu funksiya o'chirmaydi.
 */

type Tx = Prisma.TransactionClient;

/** Bildirishnoma havolasi `{key, id}` — shu yozuvga olib boradiganlari. */
const linkTo = (key: string, id: string): Prisma.NotificationWhereInput => ({
  AND: [{ link: { path: ["key"], equals: key } }, { link: { path: ["id"], equals: id } }],
});

/** Bekor qilingan reysni o'chirish (tranzaksiya ichida). O'chmasa (holati boshqa / topilmadi) — false. */
export async function purgeTripTx(tx: Tx, id: string, userId: string): Promise<boolean> {
  const t = await tx.trip.findUnique({ where: { id }, select: { id: true, deliveryNoteNo: true, orderId: true, vehicleId: true, driverId: true, qtyM3: true, status: true, createdAt: true, ecoDeliveryId: true } });
  if (!t || t.status !== "CANCELLED") return false;
  // Sklad harakati bo'lgan reys (yuklangan) bekor qilinmaydi — baribir tekshiramiz: chiqim izsiz qolmasin
  if (await tx.stockMove.count({ where: { refType: "Trip", refId: id } })) return false;
  await tx.fuelLog.updateMany({ where: { tripId: id }, data: { tripId: null } });
  await tx.transportExpense.updateMany({ where: { tripId: id }, data: { tripId: null } });
  await tx.mechanicRequest.updateMany({ where: { tripId: id }, data: { tripId: null } });
  await tx.notification.deleteMany({ where: linkTo("trips", id) });
  // Nuqtalar, muammolar, ogohlantirishlar — onDelete: Cascade
  const r = await tx.trip.deleteMany({ where: { id, status: "CANCELLED" } });
  if (!r.count) return false;
  await audit(tx, userId, "DELETE", "Trip", id, t, undefined);
  return true;
}

export async function purgeCancelledTrip(id: string, userId: string): Promise<boolean> {
  return db.$transaction((tx) => purgeTripTx(tx, id, userId));
}

/**
 * Bekor qilingan zayavkani o'chirish (tranzaksiya ichida). Bekor qilingan reyslari ham o'chadi.
 * Brigada ishlab chiqarishni boshlagan bo'lsa (topshiriq qaydi bor) — o'chirilmaydi: brigada oyligi o'sha qayddan.
 */
export async function purgeOrderTx(tx: Tx, id: string, userId: string): Promise<boolean> {
  const o = await tx.order.findUnique({
    where: { id },
    select: { id: true, orderNo: true, kind: true, status: true, customerId: true, deliveryDate: true, deliveryAddress: true, createdById: true, createdAt: true, items: { select: { productId: true, qtyM3: true, price: true } }, trips: { select: { id: true, status: true } } },
  });
  if (!o || o.status !== "CANCELLED") return false;
  if (o.trips.some((t) => t.status !== "CANCELLED")) return false;
  if (await tx.taskProgress.count({ where: { task: { orderId: id } } })) return false;
  for (const t of o.trips) if (!(await purgeTripTx(tx, t.id, userId))) return false;

  await tx.brigadeTask.deleteMany({ where: { orderId: id } });
  await tx.paymentRequest.deleteMany({ where: { orderId: id } });
  await tx.productionBatch.updateMany({ where: { orderId: id }, data: { orderId: null } });
  await tx.invoice.updateMany({ where: { orderId: id }, data: { orderId: null } });
  await tx.payment.updateMany({ where: { orderId: id }, data: { orderId: null } });
  await tx.commercialOffer.updateMany({ where: { orderId: id }, data: { orderId: null } });
  await tx.notification.deleteMany({ where: linkTo("orders", id) });
  // Qatorlar — onDelete: Cascade
  const r = await tx.order.deleteMany({ where: { id, status: "CANCELLED" } });
  if (!r.count) return false;
  await audit(tx, userId, "DELETE", "Order", id, { ...o, trips: undefined }, undefined);
  return true;
}

export async function purgeCancelledOrder(id: string, userId: string): Promise<boolean> {
  return db.$transaction((tx) => purgeOrderTx(tx, id, userId));
}
