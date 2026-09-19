"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { nextNo } from "@/lib/numbering";
import { customerCredit, DEFAULT_CREDIT_LIMIT } from "@/lib/finance";
import { money } from "@/lib/format";
import { parseForm, zStr, zOpt, type ActionState } from "@/lib/action";
import { saveContractFile, removeContractFile } from "@/lib/uploads";

const schema = z.object({
  // Mijoz: mavjudini tanlash ("existing") yoki shu yerning o'zida yangi ochish ("new")
  customerMode: z.enum(["existing", "new"]).default("existing"),
  customerId: z.string().trim().optional(),
  newName: z.string().trim().optional(),
  newPhone: zOpt,
  newInn: zOpt,
  newAddress: zOpt,
  deliveryDate: zStr("Yetkazish sanasi kerak"),
  deliveryTime: z.string().trim().regex(/^\d{2}:\d{2}$/, "Yetkazish soati kerak (masalan 09:30)"),
  deliveryAddress: zStr("Obyekt manzili kerak"),
  needsPump: z.string().optional().transform((v) => v === "on"),
  needsDelivery: z.string().optional().transform((v) => v === "on"),
  isUrgent: z.string().optional().transform((v) => v === "on"),
  payment: z.enum(["prepay", "credit"]).default("prepay"),
  prepayAmount: z.coerce.number().min(0, "summa manfiy bo'lmasin").default(0), // oldindan olingan pul (0 — hali olinmagan)
  prepayAccountId: zOpt, // qayerga tushdi: kassa yoki bank
  hasContract: z.string().optional().transform((v) => v === "on"), // "Shartnoma qilish" belgilangan
  contractAmount: z.coerce.number().min(0, "shartnoma summasi manfiy bo'lmasin").default(0),
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
  const onCredit = d.payment === "credit";
  const total = items.reduce((sum, i) => sum + i.qtyM3 * i.price, 0);

  // ── Shartnoma ──
  if (d.hasContract && d.contractAmount <= 0) return { error: "Shartnoma summasini kiriting" };
  const contractAmount = d.hasContract ? d.contractAmount : null;
  // Didox'da imzolangan shartnoma fayli (ixtiyoriy — keyin zayavka sahifasida ham yuklash mumkin). Tranzaksiyadan oldin saqlanadi.
  const orderId = crypto.randomUUID();
  const saved = contractAmount != null ? await saveContractFile(orderId, fd.get("contractFile")) : null;
  if (saved && "error" in saved) return { error: saved.error };

  // ── Oldindan to'lov ──
  const prepay = !onCredit && d.prepayAmount > 0 ? d.prepayAmount : 0;
  if (prepay > 0) {
    if (!d.prepayAccountId) return { error: "Oldindan to'lov qayerga tushganini tanlang (kassa yoki bank)" };
    if (prepay > total + 0.005) return { error: `Oldindan to'lov ${money(prepay)} zayavka summasidan ${money(total)} katta` };
    const acc = await db.cashAccount.findUnique({ where: { id: d.prepayAccountId } });
    if (!acc || !acc.isActive) return { error: "Kassa/hisob topilmadi" };
  }

  // ── Mijoz ──
  if (d.customerMode === "new") {
    if (!d.newName) return { error: "Yangi mijoz nomi to'ldirilishi shart" };
    if (d.newInn) {
      const dup = await db.customer.findUnique({ where: { inn: d.newInn } });
      if (dup) return { error: `Bu INN bilan mijoz allaqachon bor: ${dup.name}. Uni ro'yxatdan tanlang.` };
    }
  } else {
    if (!d.customerId) return { error: "Mijoz tanlanmagan" };
    const c = await db.customer.findUnique({ where: { id: d.customerId } });
    if (!c || !c.isActive) return { error: "Mijoz topilmadi yoki nofaol" };
    const credit = await customerCredit(c.id);
    if (credit.blacklisted) {
      return { error: `${c.name} qora ro'yxatda: limit ${money(credit.limit)} to'liq ishlatilgan (qarz ${money(credit.debt)}, ochiq zayavkalar ${money(credit.open)}). Qarz to'langach zayavka ochish mumkin.` };
    }
  }

  const id = await db.$transaction(async (tx) => {
    let customerId = d.customerId!;
    if (d.customerMode === "new") {
      const c = await tx.customer.create({ data: { name: d.newName!, phone: d.newPhone, inn: d.newInn, address: d.newAddress, creditLimit: DEFAULT_CREDIT_LIMIT } });
      await audit(tx, s.userId, "CREATE", "Customer", c.id, undefined, { ...c, via: "order-form" });
      customerId = c.id;
    }
    const o = await tx.order.create({
      data: {
        id: orderId,
        orderNo: await nextNo(tx, "order", "Z"),
        customerId,
        deliveryDate: new Date(d.deliveryDate),
        deliveryTime: d.deliveryTime,
        deliveryAddress: d.deliveryAddress,
        needsPump: d.needsPump,
        needsDelivery: d.needsDelivery,
        isUrgent: d.isUrgent,
        onCredit,
        note: d.note,
        createdById: s.userId,
        items: { create: items },
        ...(contractAmount != null ? { contractAmount, contractAt: new Date(), contractNo: await nextNo(tx, "contract", "SH") } : {}),
        ...(saved ? { contractFile: saved.stored, contractFileName: saved.name, contractFileType: saved.type, contractFileAt: new Date() } : {}),
      },
    });
    await audit(tx, s.userId, "CREATE", "Order", o.id, undefined, { ...o, items, prepay, contractAmount });
    if (prepay > 0) {
      const p = await tx.payment.create({ data: { customerId, orderId: o.id, cashAccountId: d.prepayAccountId!, amount: prepay, note: `Oldindan to'lov · ${o.orderNo}` } });
      await audit(tx, s.userId, "CREATE", "Payment", p.id, undefined, { ...p, via: "order-form" });
    }
    return o.id;
  });
  revalidatePath("/orders"); revalidatePath("/customers"); revalidatePath("/production"); revalidatePath("/payments"); revalidatePath("/cashflow");
  const q = [onCredit && "guarantee=1", contractAmount != null && "contract=1"].filter(Boolean).join("&");
  redirect(q ? `/orders/${id}?${q}` : `/orders/${id}`);
}

/**
 * Qabul qilish: DRAFT → CONFIRMED (Sotuv bo'limiga o'tadi) yoki BLOCKED (limit yetmaydi — direktor ochadi).
 * Limit tekshiruvi: qarz + ochiq zayavkalar + shu zayavka ≤ limit.
 */
export async function confirmOrder(id: string) {
  const s = await requireSession(["SALES"]);
  const o = await db.order.findUniqueOrThrow({ where: { id }, include: { items: true, customer: true } });
  if (o.status !== "DRAFT") return;

  const total = o.items.reduce((sum, i) => sum + Number(i.qtyM3) * Number(i.price), 0);
  const credit = await customerCredit(o.customerId);
  const exceeds = credit.used + total > credit.limit;
  const status = exceeds ? "BLOCKED" : "CONFIRMED";

  await db.$transaction(async (tx) => {
    await tx.order.update({ where: { id }, data: { status } });
    await audit(tx, s.userId, "STATUS_CHANGE", "Order", id, { status: o.status }, { status, debt: credit.debt, open: credit.open, total, limit: credit.limit });
  });
  revalidatePath(`/orders/${id}`);
  revalidatePath("/orders"); revalidatePath("/sales"); revalidatePath("/customers"); revalidatePath("/production");
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
  revalidatePath("/orders"); revalidatePath("/sales"); revalidatePath("/customers");
}

export async function cancelOrder(id: string) {
  const s = await requireSession(["SALES"]);
  const o = await db.order.findUniqueOrThrow({ where: { id }, include: { batches: true, trips: true } });
  if (o.batches.length || o.trips.length) throw new Error("Zames yoki reys bor — bekor qilib bo'lmaydi");
  if (!["DRAFT", "BLOCKED", "CONFIRMED"].includes(o.status)) return;
  await db.$transaction(async (tx) => {
    await tx.order.update({ where: { id }, data: { status: "CANCELLED" } });
    await tx.brigadeTask.updateMany({ where: { orderId: id, status: { in: ["NEW", "IN_PROGRESS"] } }, data: { status: "CANCELLED" } });
    await audit(tx, s.userId, "STATUS_CHANGE", "Order", id, { status: o.status }, { status: "CANCELLED" });
  });
  revalidatePath(`/orders/${id}`); revalidatePath("/tasks"); revalidatePath("/brigades");
  revalidatePath("/orders"); revalidatePath("/sales"); revalidatePath("/customers");
}

/** Mijoz imzolagan kafolat xati qabul qilindi / qaytarildi. */
export async function toggleGuarantee(id: string) {
  const s = await requireSession(["SALES", "ACCOUNTING"]);
  const o = await db.order.findUniqueOrThrow({ where: { id } });
  const guaranteeAt = o.guaranteeAt ? null : new Date();
  await db.$transaction(async (tx) => {
    await tx.order.update({ where: { id }, data: { guaranteeAt } });
    await audit(tx, s.userId, "UPDATE", "Order", id, { guaranteeAt: o.guaranteeAt }, { guaranteeAt });
  });
  revalidatePath(`/orders/${id}`);
}

const contractSchema = z.object({ contractAmount: z.coerce.number().positive("Shartnoma summasi 0 dan katta bo'lsin") });

/**
 * Mavjud zayavkaga shartnoma qo'shish / summasini o'zgartirish / Didox'da imzolangan faylni yuklash (almashtirish).
 * Raqam bir marta beriladi. Fayl `uploads/contracts/` ga yoziladi — isbot uchun tizimda saqlanadi.
 */
export async function setContract(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireSession(["SALES", "ACCOUNTING"]);
  const r = parseForm(contractSchema, fd);
  if ("error" in r) return { error: r.error };
  const o = await db.order.findUniqueOrThrow({ where: { id } });
  if (o.status === "CANCELLED") return { error: "Bekor qilingan zayavkaga shartnoma qo'shib bo'lmaydi" };
  const saved = await saveContractFile(id, fd.get("contractFile"));
  if (saved && "error" in saved) return { error: saved.error };
  await db.$transaction(async (tx) => {
    const data = {
      contractAmount: r.data.contractAmount, contractAt: o.contractAt ?? new Date(), contractNo: o.contractNo ?? (await nextNo(tx, "contract", "SH")),
      ...(saved ? { contractFile: saved.stored, contractFileName: saved.name, contractFileType: saved.type, contractFileAt: new Date() } : {}),
    };
    await tx.order.update({ where: { id }, data });
    await audit(tx, s.userId, "UPDATE", "Order", id, { contractAmount: o.contractAmount, contractNo: o.contractNo, contractFile: o.contractFile }, data);
  });
  if (saved && o.contractFile && o.contractFile !== saved.stored) await removeContractFile(o.contractFile); // almashtirilgan eski fayl
  revalidatePath(`/orders/${id}`); revalidatePath("/orders"); revalidatePath("/sales"); revalidatePath("/customers");
  return { ok: true };
}
