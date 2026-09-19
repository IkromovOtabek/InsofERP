import { db } from "@/lib/db";
import { eco, ecoEnabled, EcoError, normalizePhone, type EcoDelivery, type EcoStatus } from "./client";
import { ecoSystemUserId } from "./system-user";
import { tripCancelled, tripDelivered, tripLoaded, tripOnRoad } from "@/lib/trips";

/**
 * ERP ↔ ECO sinxron. ERP — nakladnoy manbai (yaratadi, bekor qiladi, sklad chiqimi);
 * ECO — haydovchi ilovasi (qabul, GPS, obyektda imzo). Kalit: Trip.deliveryNoteNo = ECO Delivery.externalRef.
 * Hech bir funksiya tashlamaydi — natija Trip.ecoError/ecoStatus da saqlanadi va ekranda ko'rinadi.
 */
export type SyncResult = { ok: boolean; skipped?: boolean; error?: string };

const errMsg = (e: unknown) => (e instanceof EcoError ? `${e.message} [${e.code}]` : String((e as Error)?.message ?? e));

/** Oldinga yurish tartibi. Webhook'lar parallel kelganda (ACCEPTED va LOADING bir vaqtda) eskisi yangisini bosib qo'ymasligi uchun. */
const RANK: EcoStatus[] = ["ASSIGNED", "ACCEPTED", "LOADING", "EN_ROUTE", "ARRIVED", "UNLOADING", "COMPLETED"];
const isOlder = (incoming: EcoStatus, current: string | null) =>
  !!current && RANK.includes(incoming) && RANK.includes(current as EcoStatus) && RANK.indexOf(incoming) < RANK.indexOf(current as EcoStatus);

/** Trip → ECO ma'lumotlarini bazaga yozish (id'lar, holat, xato). */
async function remember(tripId: string, d: EcoDelivery | null, error: string | null) {
  const cur = d ? await db.trip.findUnique({ where: { id: tripId }, select: { ecoStatus: true } }) : null;
  const status = d && !isOlder(d.status, cur?.ecoStatus ?? null) ? d.status : undefined;
  await db.trip.update({ where: { id: tripId }, data: { ecoError: error, ...(d ? { ecoDeliveryId: d.id, ecoStatus: status, ecoSyncedAt: new Date() } : {}) } });
  if (!d) return;
  const t = await db.trip.findUnique({ where: { id: tripId }, select: { driverId: true, vehicleId: true } });
  if (d.driver && t) await db.employee.updateMany({ where: { id: t.driverId, ecoUserId: null }, data: { ecoUserId: d.driver.userId } }).catch(() => undefined);
  if (d.vehicle && t) await db.vehicle.updateMany({ where: { id: t.vehicleId, ecoVehicleId: null }, data: { ecoVehicleId: d.vehicle.id } }).catch(() => undefined);
}

/** Reysni ECO'ga yuborish (yaratish/yangilash). Haydovchi ilovasida darhol ko'rinadi. */
export async function pushTripToEco(tripId: string): Promise<SyncResult> {
  if (!ecoEnabled()) return { ok: false, skipped: true };
  const t = await db.trip.findUnique({ where: { id: tripId }, include: { order: { include: { customer: true, items: { include: { product: true } } } }, vehicle: true, driver: true } });
  if (!t || t.status === "CANCELLED") return { ok: false, skipped: true };
  const item = t.order.items[0];
  const driverPhone = normalizePhone(t.driver.phone);
  const warn = driverPhone ? null : `Haydovchi "${t.driver.fullName}" telefoni yo'q yoki noto'g'ri — reys ECO'da haydovchisiz turibdi (Xodimlar sahifasida +998… formatida kiriting)`;
  try {
    const r = await eco.upsertTrip(t.deliveryNoteNo, {
      orderRef: t.order.orderNo,
      customer: { name: t.order.customer.name, inn: /^\d{9}$/.test(t.order.customer.inn ?? "") ? t.order.customer.inn! : undefined, phone: normalizePhone(t.order.customer.phone) ?? undefined },
      address: t.order.deliveryAddress,
      scheduledAt: t.order.deliveryDate.toISOString(),
      product: { grade: item?.product.code ?? "BETON", name: item?.product.name ?? "Beton", unitPrice: Number(item?.price ?? 0) },
      plannedM3: Number(t.qtyM3),
      driverPhone: driverPhone ?? undefined,
      driverName: t.driver.fullName,
      vehiclePlate: t.vehicle.plate,
      vehicleCapacityM3: t.vehicle.capacityM3 ? Number(t.vehicle.capacityM3) : undefined,
      note: t.note ?? undefined,
    });
    await remember(tripId, r.delivery, warn);
    return { ok: true, error: warn ?? undefined };
  } catch (e) {
    await remember(tripId, null, errMsg(e));
    return { ok: false, error: errMsg(e) };
  }
}

/** ERP'da logist tugma bosdi → ECO'dagi reys ham shu bosqichga o'tadi (oraliq bosqichlar ECO'da avtomatik). */
export async function pushTripStatus(tripId: string, to: "LOADING" | "EN_ROUTE" | "COMPLETED" | "CANCELLED", extra?: { note?: string; acceptedM3?: number }): Promise<SyncResult> {
  if (!ecoEnabled()) return { ok: false, skipped: true };
  const t = await db.trip.findUnique({ where: { id: tripId }, select: { deliveryNoteNo: true, ecoDeliveryId: true, ecoStatus: true, qtyM3: true } });
  if (!t) return { ok: false, skipped: true };
  if (!t.ecoDeliveryId) {
    if (to === "CANCELLED") return { ok: true, skipped: true }; // ECO'ga yetib bormagan reysni bekor qilish shart emas
    const p = await pushTripToEco(tripId);
    if (!p.ok) return p;
  }
  try {
    const d = await eco.setStatus(t.deliveryNoteNo, to, { at: new Date(), note: extra?.note, acceptedM3: extra?.acceptedM3 ?? (to === "COMPLETED" ? Number(t.qtyM3) : undefined) });
    await remember(tripId, d, null);
    return { ok: true };
  } catch (e) {
    await remember(tripId, null, errMsg(e));
    return { ok: false, error: errMsg(e) };
  }
}

/** ECO'dan hozirgi holatni olib kelish (webhook yetib bormagan bo'lsa). */
export async function pullTripFromEco(tripId: string): Promise<SyncResult> {
  if (!ecoEnabled()) return { ok: false, skipped: true };
  const t = await db.trip.findUnique({ where: { id: tripId }, select: { deliveryNoteNo: true } });
  if (!t) return { ok: false, skipped: true };
  try {
    const d = await eco.trip(t.deliveryNoteNo);
    const last = d.events[d.events.length - 1];
    await applyEcoStatus({ externalRef: d.externalRef ?? t.deliveryNoteNo, deliveryId: d.id, to: d.status, byIntegration: false, note: last?.note ?? null, acceptedM3: d.acceptedM3 ? Number(d.acceptedM3) : null, driver: d.driver ? { fullName: d.driver.user.fullName, phone: d.driver.user.phone } : null });
    return { ok: true };
  } catch (e) {
    if (e instanceof EcoError && e.status === 404) { await remember(tripId, null, "ECO'da bu reys yo'q — qayta yuboring"); return { ok: false, error: "ECO'da yo'q" }; }
    await remember(tripId, null, errMsg(e));
    return { ok: false, error: errMsg(e) };
  }
}

export type EcoEvent = {
  externalRef: string;
  deliveryId: string;
  to: EcoStatus;
  byIntegration: boolean;
  note: string | null;
  acceptedM3: number | null;
  driver: { fullName: string | null; phone: string } | null;
};

/**
 * Haydovchi ilovasidagi holat → ERP nakladnoy holati.
 *   LOADING → LOADED (sklad chiqimi), EN_ROUTE → ON_ROAD, COMPLETED → DELIVERED (zayavka yopiladi),
 *   CANCELLED → CANCELLED (faqat PLANNED bo'lsa). Qolganlari — faqat ECO holati sifatida ko'rsatiladi.
 * ERP o'zi yuborgan o'zgarish (byIntegration) — faqat ecoStatus yangilanadi.
 */
export async function applyEcoStatus(e: EcoEvent): Promise<{ applied: boolean; trip?: string }> {
  const t = await db.trip.findUnique({ where: { deliveryNoteNo: e.externalRef }, include: { driver: true } });
  if (!t) return { applied: false };
  if (isOlder(e.to, t.ecoStatus)) return { applied: false, trip: t.id }; // kechikkan/eski hodisa — ERP allaqachon oldinda
  const userId = await ecoSystemUserId();
  const who = e.driver?.fullName ?? t.driver.fullName;
  const note = `ECO: ${who}${e.note ? ` — ${e.note}` : ""}`;

  if (!e.byIntegration) {
    if (e.to === "LOADING") await tripLoaded(t.id, userId, note);
    else if (e.to === "EN_ROUTE") await tripOnRoad(t.id, userId, note);
    else if (e.to === "COMPLETED") await tripDelivered(t.id, userId, e.note?.trim() || "Haydovchi ilovasi (mijoz imzosi)", note);
    else if (e.to === "CANCELLED") await tripCancelled(t.id, userId, note);
  }
  const problem = e.to === "DECLINED" ? `Haydovchi reysni rad etdi${e.note ? `: ${e.note}` : ""} — boshqa haydovchi bering`
    : e.to === "FAILED" ? `Reys muvaffaqiyatsiz${e.note ? `: ${e.note}` : ""}`
    : e.to === "DISPUTED" ? `Mijoz e'tiroz bildirdi${e.note ? `: ${e.note}` : ""}`
    : null;
  await db.trip.update({ where: { id: t.id }, data: { ecoDeliveryId: e.deliveryId, ecoStatus: e.to, ecoSyncedAt: new Date(), ecoError: problem } });
  return { applied: true, trip: t.id };
}
