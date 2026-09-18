"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { nextNo } from "@/lib/numbering";
import { parseForm, zStr, zOpt, type ActionState } from "@/lib/action";

const schema = z.object({
  orderId: zStr("Zayavka tanlanmagan"),
  vehicleId: zStr("Mikser tanlanmagan"),
  driverId: zStr("Haydovchi tanlanmagan"),
  qtyM3: z.coerce.number().positive("miqdor 0 dan katta bo'lsin"),
  note: zOpt,
});

export async function createTrip(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireSession(["LOGISTICS", "PRODUCTION"]);
  const r = parseForm(schema, fd);
  if ("error" in r) return { error: r.error };
  const d = r.data;

  const o = await db.order.findUnique({ where: { id: d.orderId }, include: { items: true, trips: true } });
  if (!o || !["CONFIRMED", "IN_PRODUCTION"].includes(o.status)) return { error: "Zayavka tasdiqlanmagan yoki yopilgan" };
  const total = o.items.reduce((s, i) => s + Number(i.qtyM3), 0);
  const shipped = o.trips.filter((t) => t.status !== "CANCELLED").reduce((s, t) => s + Number(t.qtyM3), 0);
  if (d.qtyM3 > total - shipped + 0.001) return { error: `Zayavkada faqat ${total - shipped} m³ qoldi` };
  const v = await db.vehicle.findUniqueOrThrow({ where: { id: d.vehicleId } });
  if (v.capacityM3 && d.qtyM3 > Number(v.capacityM3)) return { error: `Mikser sig'imi ${v.capacityM3} m³` };

  const id = await db.$transaction(async (tx) => {
    const t = await tx.trip.create({
      data: { deliveryNoteNo: await nextNo(tx, "trip", "N"), orderId: d.orderId, vehicleId: d.vehicleId, driverId: d.driverId, qtyM3: d.qtyM3, note: d.note },
    });
    await audit(tx, s.userId, "CREATE", "Trip", t.id, undefined, t);
    return t.id;
  });
  revalidatePath("/trips"); revalidatePath(`/orders/${d.orderId}`);
  redirect(`/trips/${id}`);
}

/** PLANNED → LOADED: tayyor beton skladdan chiqadi (SHIPMENT). */
export async function markLoaded(id: string) {
  const s = await requireSession(["LOGISTICS", "PRODUCTION"]);
  const t = await db.trip.findUniqueOrThrow({ where: { id }, include: { order: { include: { items: true } } } });
  if (t.status !== "PLANNED") return;
  const productId = t.order.items[0]?.productId;
  const wh = await db.warehouse.findFirstOrThrow({ where: { isActive: true } });
  await db.$transaction(async (tx) => {
    await tx.trip.update({ where: { id }, data: { status: "LOADED", loadedAt: new Date() } });
    if (productId) {
      await tx.stockMove.create({ data: { type: "SHIPMENT", warehouseId: wh.id, productId, qty: -Number(t.qtyM3), refType: "Trip", refId: id, createdById: s.userId } });
    }
    await audit(tx, s.userId, "STATUS_CHANGE", "Trip", id, { status: "PLANNED" }, { status: "LOADED" });
  });
  revalidatePath(`/trips/${id}`); revalidatePath("/trips"); revalidatePath("/stock");
}

export async function markOnRoad(id: string) {
  const s = await requireSession(["LOGISTICS"]);
  const t = await db.trip.findUniqueOrThrow({ where: { id } });
  if (t.status !== "LOADED") return;
  await db.trip.update({ where: { id }, data: { status: "ON_ROAD" } });
  await audit(db, s.userId, "STATUS_CHANGE", "Trip", id, { status: "LOADED" }, { status: "ON_ROAD" });
  revalidatePath(`/trips/${id}`); revalidatePath("/trips");
}

/** → DELIVERED. Zayavkaning hamma hajmi yetkazilgan bo'lsa — zayavka DELIVERED. */
export async function markDelivered(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireSession(["LOGISTICS"]);
  const receiverName = String(fd.get("receiverName") ?? "").trim();
  if (!receiverName) return { error: "Qabul qilgan shaxsni kiriting" };
  const t = await db.trip.findUniqueOrThrow({ where: { id }, include: { order: { include: { items: true, trips: true } } } });
  if (!["LOADED", "ON_ROAD"].includes(t.status)) return { error: "Holat mos emas" };

  const total = t.order.items.reduce((s, i) => s + Number(i.qtyM3), 0);
  const delivered = t.order.trips.filter((x) => x.status === "DELIVERED" || x.id === id).reduce((s, x) => s + Number(x.qtyM3), 0);

  await db.$transaction(async (tx) => {
    await tx.trip.update({ where: { id }, data: { status: "DELIVERED", deliveredAt: new Date(), receiverName } });
    if (delivered >= total - 0.001) await tx.order.update({ where: { id: t.orderId }, data: { status: "DELIVERED" } });
    await audit(tx, s.userId, "STATUS_CHANGE", "Trip", id, { status: t.status }, { status: "DELIVERED", receiverName });
  });
  revalidatePath(`/trips/${id}`); revalidatePath("/trips"); revalidatePath(`/orders/${t.orderId}`);
  return { ok: true };
}

export async function cancelTrip(id: string) {
  const s = await requireSession(["LOGISTICS"]);
  const t = await db.trip.findUniqueOrThrow({ where: { id } });
  if (t.status !== "PLANNED") return;
  await db.trip.update({ where: { id }, data: { status: "CANCELLED" } });
  await audit(db, s.userId, "STATUS_CHANGE", "Trip", id, { status: "PLANNED" }, { status: "CANCELLED" });
  revalidatePath(`/trips/${id}`); revalidatePath("/trips");
}
