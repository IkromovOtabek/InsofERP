"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { createOrder } from "@/lib/orders";
import { parseForm, zStr, zOpt, MAX_AMOUNT, type ActionState } from "@/lib/action";

/**
 * Sotuv agenti kabineti — zayavka ochish.
 *
 * Agent faqat O'Z mijoziga (Customer.agentId == agent userId) zayavka ocha oladi: boshqa mijoz tanlansa
 * (id qo'lda yuborilsa ham) rad etiladi. Zayavka SALES oqimidagidek `lib/orders.ts createOrder` orqali
 * yaratiladi (qoralama bo'lib tushadi, sotuv bo'limi qabul qiladi). `viaAgent` — "orders" moduli yozish
 * tekshiruvi o'tkazib yuboriladi (agent "orders" roliga kirmaydi, ruxsatni shu action o'zi tekshiradi).
 */
const schema = z.object({
  customerId: zStr("Mijoz tanlanmagan"),
  deliveryDate: zStr("Yetkazish sanasi kerak").refine((v) => Number.isFinite(new Date(v).getTime()), "Yetkazish sanasi noto'g'ri"),
  deliveryAddress: zStr("Obyekt manzili kerak"),
  needsPump: z.string().optional().transform((v) => v === "on"),
  isUrgent: z.string().optional().transform((v) => v === "on"),
  note: zOpt,
  productId: z.array(z.string()).min(1, "Kamida bitta mahsulot"),
  qtyM3: z.array(z.coerce.number({ message: "Miqdor raqam bo'lsin" }).positive("Miqdor 0 dan katta bo'lsin").max(100_000, "Miqdor juda katta")),
  price: z.array(z.coerce.number({ message: "Narx raqam bo'lsin" }).min(0, "Narx manfiy bo'lmasin").max(MAX_AMOUNT, "Narx juda katta")),
});

function userError(e: unknown): string {
  const err = e as Error;
  if (err?.name?.startsWith("PrismaClient") || /prisma|invocation/i.test(err?.message ?? "")) {
    console.error("[agent]", e);
    return "Zayavka saqlanmadi: ma'lumotlarni tekshirib, qayta urinib ko'ring";
  }
  return err?.message || "Zayavka saqlanmadi";
}

export async function createAgentOrder(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireSession(["AGENT"]);
  const r = parseForm(schema, fd);
  if ("error" in r) return { error: r.error };
  const d = r.data;

  // Egalik: tanlangan mijoz aynan shu agentniki bo'lishi shart
  const customer = await db.customer.findUnique({ where: { id: d.customerId }, select: { agentId: true, isActive: true, name: true } });
  if (!customer || !customer.isActive) return { error: "Mijoz topilmadi yoki nofaol" };
  if (customer.agentId !== s.userId) return { error: "Bu mijoz sizga biriktirilmagan — faqat o'z mijozingizga zayavka ocha olasiz" };

  try {
    await createOrder(
      {
        customerId: d.customerId,
        deliveryDate: new Date(d.deliveryDate),
        deliveryAddress: d.deliveryAddress,
        items: d.productId.map((productId, i) => ({ productId, qtyM3: d.qtyM3[i]!, price: d.price[i]! })).filter((i) => i.productId),
        needsPump: d.needsPump,
        isUrgent: d.isUrgent,
        note: d.note,
      },
      s.userId,
      { viaAgent: true },
    );
  } catch (e) {
    return { error: userError(e) };
  }

  revalidatePath("/agent"); revalidatePath("/orders"); revalidatePath("/customers");
  return { ok: true, note: "Zayavka ochildi — qoralama holatida, sotuv bo'limi qabul qiladi." };
}
