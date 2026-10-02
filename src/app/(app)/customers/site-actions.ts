"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { parseForm, zStr, zOpt, type ActionState } from "@/lib/action";

/** Obyekt (Site) qo'shish/tahrirlash — mijoz kartasidagi kabi rol: SALES, ACCOUNTING, FINANCE (+DIRECTOR). */
const ROLES = ["SALES", "ACCOUNTING", "FINANCE"] as const;

const schema = z.object({
  name: zStr("Obyekt nomi to'ldirilishi shart"),
  address: zStr("Manzil to'ldirilishi shart"),
  contactName: zOpt,
  contactPhone: zOpt,
  deliveryHours: zOpt,
  instructions: zOpt,
  isActive: z.string().optional().transform((v) => v === "on"),
});

export async function saveSite(customerId: string, id: string | null, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireSession([...ROLES]);
  const r = parseForm(schema, fd);
  if ("error" in r) return { error: r.error };
  const d = r.data;

  // Mijoz bor-yo'qligini tekshir; tahrirda obyekt shu mijozniki ekaniga ishonch hosil qil
  const customer = await db.customer.findUnique({ where: { id: customerId }, select: { id: true } });
  if (!customer) return { error: "Mijoz topilmadi" };

  try {
    await db.$transaction(async (tx) => {
      if (id) {
        const before = await tx.site.findUnique({ where: { id } });
        if (!before || before.customerId !== customerId) throw new Error("NOT_OWNER");
        const after = await tx.site.update({ where: { id }, data: d });
        await audit(tx, s.userId, "UPDATE", "Site", id, before, after);
      } else {
        const c = await tx.site.create({ data: { ...d, customerId } });
        await audit(tx, s.userId, "CREATE", "Site", c.id, undefined, c);
      }
    });
  } catch (e) {
    if (String(e).includes("NOT_OWNER")) return { error: "Bu obyekt boshqa mijozga tegishli" };
    throw e;
  }
  revalidatePath(`/customers/${customerId}`);
  return { ok: true };
}

export async function deleteSite(customerId: string, id: string): Promise<ActionState> {
  const s = await requireSession([...ROLES]);
  const site = await db.site.findUnique({ where: { id }, select: { customerId: true } });
  if (!site || site.customerId !== customerId) return { error: "Obyekt topilmadi" };

  // Faqat zayavkasi yo'q obyektni o'chirsa bo'ladi — aks holda tarix uziladi
  const orders = await db.order.count({ where: { siteId: id } });
  if (orders > 0) return { error: `Bu obyektda ${orders} ta zayavka bor — o'chirib bo'lmaydi. O'rniga "Faol emas" qiling.` };

  await db.$transaction(async (tx) => {
    const before = await tx.site.findUnique({ where: { id } });
    await tx.site.delete({ where: { id } });
    await audit(tx, s.userId, "DELETE", "Site", id, before, undefined);
  });
  revalidatePath(`/customers/${customerId}`);
  return { ok: true };
}
