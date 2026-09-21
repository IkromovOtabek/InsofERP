"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { nextNo } from "@/lib/numbering";
import { createOrder as createOrderDomain, orderCancel, orderConfirm, orderUnblock } from "@/lib/orders";
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

  if (d.hasContract && d.contractAmount <= 0) return { error: "Shartnoma summasini kiriting" };
  const contractAmount = d.hasContract ? d.contractAmount : undefined;

  // Didox'da imzolangan shartnoma fayli zayavka id'si bo'yicha saqlanadi — shuning uchun id oldindan beriladi
  const orderId = crypto.randomUUID();
  const saved = contractAmount != null ? await saveContractFile(orderId, fd.get("contractFile")) : null;
  if (saved && "error" in saved) return { error: saved.error };

  let res;
  try {
    // Qoida `lib/orders.ts` da — mobil ilovadagi "Yangi zayavka" ham shuni chaqiradi
    res = await createOrderDomain(
      {
        customerId: d.customerMode === "existing" ? d.customerId : undefined,
        newCustomer: d.customerMode === "new" ? { name: d.newName ?? "", phone: d.newPhone, inn: d.newInn, address: d.newAddress } : undefined,
        deliveryDate: new Date(d.deliveryDate),
        deliveryTime: d.deliveryTime,
        deliveryAddress: d.deliveryAddress,
        items: d.productId.map((productId, i) => ({ productId, qtyM3: d.qtyM3[i]!, price: d.price[i]! })).filter((i) => i.productId),
        needsPump: d.needsPump,
        needsDelivery: d.needsDelivery,
        isUrgent: d.isUrgent,
        onCredit: d.payment === "credit",
        prepay: d.prepayAmount > 0 ? { amount: d.prepayAmount, cashAccountId: d.prepayAccountId ?? "" } : undefined,
        contractAmount,
        note: d.note,
      },
      s.userId,
      { id: orderId, contractFile: saved ?? undefined },
    );
  } catch (e) {
    return { error: (e as Error).message };
  }

  revalidatePath("/orders"); revalidatePath("/customers"); revalidatePath("/production"); revalidatePath("/payments"); revalidatePath("/cashflow");
  const q = [res.onCredit && "guarantee=1", res.contractNo && "contract=1"].filter(Boolean).join("&");
  redirect(q ? `/orders/${res.id}?${q}` : `/orders/${res.id}`);
}

/**
 * Qabul qilish: DRAFT → CONFIRMED (Sotuv bo'limiga o'tadi) yoki BLOCKED (limit yetmaydi — direktor ochadi).
 * Limit tekshiruvi: qarz + ochiq zayavkalar + shu zayavka ≤ limit.
 */
export async function confirmOrder(id: string) {
  const s = await requireSession(["SALES"]);
  await orderConfirm(id, s.userId); // qoida `lib/orders.ts` da — mobil ilova ham shuni chaqiradi
  revalidatePath(`/orders/${id}`);
  revalidatePath("/orders"); revalidatePath("/sales"); revalidatePath("/customers"); revalidatePath("/production");
}

/** BLOCKED → CONFIRMED. Faqat direktor. */
export async function unblockOrder(id: string) {
  const s = await requireSession(["DIRECTOR"]);
  await orderUnblock(id, s.userId);
  revalidatePath(`/orders/${id}`);
  revalidatePath("/orders"); revalidatePath("/sales"); revalidatePath("/customers");
}

export async function cancelOrder(id: string) {
  const s = await requireSession(["SALES"]);
  const r = await orderCancel(id, s.userId);
  if (r.error) throw new Error(r.error);
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
