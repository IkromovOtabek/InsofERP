"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { nextNo } from "@/lib/numbering";
import { customerDebt, customerOpenOrdersTotal } from "@/lib/finance";
import { parseForm, zStr, zOpt, type ActionState } from "@/lib/action";

const schema = z.object({
  customerId: zStr("Mijoz tanlanmagan"),
  deliveryDate: zStr("Yetkazish sanasi kerak"),
  deliveryAddress: zStr("Obyekt manzili kerak"),
  needsPump: z.string().optional().transform((v) => v === "on"),
  note: zOpt,
  productId: z.array(z.string()).min(1, "Kamida bitta mahsulot"),
  qtyM3: z.array(z.coerce.number().positive("miqdor 0 dan katta bo'lsin")),
  price: z.array(z.coerce.number().min(0)),
});

export async function createOrder(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireSession(["SALES"]);
  const r = parseForm(schema, fd);
  if ("error" in r) return { error: r.error };
  const d = r.data;
  const items = d.productId
    .map((productId, i) => ({ productId, qtyM3: d.qtyM3[i], price: d.price[i] }))
    .filter((i) => i.productId);
  if (items.length === 0) return { error: "Kamida bitta mahsulot qatori kerak" };

  const id = await db.$transaction(async (tx) => {
    const o = await tx.order.create({
      data: {
        orderNo: await nextNo(tx, "order", "Z"),
        customerId: d.customerId,
        deliveryDate: new Date(d.deliveryDate),
        deliveryAddress: d.deliveryAddress,
        needsPump: d.needsPump,
        note: d.note,
        createdById: s.userId,
        items: { create: items },
      },
    });
    await audit(tx, s.userId, "CREATE", "Order", o.id, undefined, { ...o, items });
    return o.id;
  });
  revalidatePath("/orders");
  redirect(`/orders/${id}`);
}

/** DRAFT → CONFIRMED yoki BLOCKED (kredit limit tekshiruvi). */
export async function confirmOrder(id: string) {
  const s = await requireSession(["SALES"]);
  const o = await db.order.findUniqueOrThrow({ where: { id }, include: { items: true, customer: true } });
  if (o.status !== "DRAFT") return;

  const total = o.items.reduce((sum, i) => sum + Number(i.qtyM3) * Number(i.price), 0);
  const [debt, open] = await Promise.all([customerDebt(o.customerId), customerOpenOrdersTotal(o.customerId, id)]);
  const exceeds = debt + open + total > Number(o.customer.creditLimit);
  const status = exceeds ? "BLOCKED" : "CONFIRMED";

  await db.$transaction(async (tx) => {
    await tx.order.update({ where: { id }, data: { status } });
    await audit(tx, s.userId, "STATUS_CHANGE", "Order", id, { status: o.status }, { status, debt, open, total, limit: o.customer.creditLimit });
  });
  revalidatePath(`/orders/${id}`);
  revalidatePath("/orders");
}

/** BLOCKED → CONFIRMED. Faqat direktor. */
export async function unblockOrder(id: string) {
  const s = await requireSession(["DIRECTOR"]);
  const o = await db.order.findUniqueOrThrow({ where: { id } });
  if (o.status !== "BLOCKED") return;
  await db.$transaction(async (tx) => {
    await tx.order.update({ where: { id }, data: { status: "CONFIRMED" } });
    await audit(tx, s.userId, "STATUS_CHANGE", "Order", id, { status: "BLOCKED" }, { status: "CONFIRMED", by: "director" });
  });
  revalidatePath(`/orders/${id}`);
  revalidatePath("/orders");
}

export async function cancelOrder(id: string) {
  const s = await requireSession(["SALES"]);
  const o = await db.order.findUniqueOrThrow({ where: { id }, include: { batches: true, trips: true } });
  if (o.batches.length || o.trips.length) throw new Error("Zames yoki reys bor — bekor qilib bo'lmaydi");
  if (!["DRAFT", "BLOCKED", "CONFIRMED"].includes(o.status)) return;
  await db.$transaction(async (tx) => {
    await tx.order.update({ where: { id }, data: { status: "CANCELLED" } });
    await audit(tx, s.userId, "STATUS_CHANGE", "Order", id, { status: o.status }, { status: "CANCELLED" });
  });
  revalidatePath(`/orders/${id}`);
  revalidatePath("/orders");
}
