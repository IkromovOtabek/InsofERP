"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireAction } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { parseForm, zDec, zStr, zOpt, type ActionState } from "@/lib/action";
import { syncCustomerLater } from "@/lib/eco/customers";
import { DEFAULT_CREDIT_LIMIT } from "@/lib/finance";

const schema = z.object({
  name: zStr("Nomi to'ldirilishi shart"),
  inn: zOpt,
  phone: zOpt,
  address: zOpt,
  creditLimit: zDec(0),
  isActive: z.string().optional().transform((v) => v === "on"),
});

export async function saveCustomer(id: string | null, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("customers", "edit");
  const r = parseForm(schema, fd);
  if ("error" in r) return { error: r.error };
  const d = r.data;

  // Kredit limitni faqat buxgalteriya/finance/direktor o'zgartira oladi. Yangi mijozda ham: aks holda sotuvchi
  // mijozni 10 mlrd limit bilan ochib, qora ro'yxat tekshiruvini chetlab o'tardi.
  if (!["FINANCE", "ACCOUNTING", "DIRECTOR"].includes(s.role)) {
    if (id) {
      const cur = await db.customer.findUniqueOrThrow({ where: { id } });
      if (Number(cur.creditLimit) !== d.creditLimit) return { error: "Kredit limitni faqat Buxgalteriya, Finance yoki Direktor o'zgartira oladi" };
    } else if (d.creditLimit !== DEFAULT_CREDIT_LIMIT) {
      d.creditLimit = DEFAULT_CREDIT_LIMIT;
    }
  }

  let savedId = id;
  try {
    await db.$transaction(async (tx) => {
      if (id) {
        const before = await tx.customer.findUniqueOrThrow({ where: { id } });
        const after = await tx.customer.update({ where: { id }, data: d });
        await audit(tx, s.userId, "UPDATE", "Customer", id, before, after);
        // Limit o'zgarishi alohida yozuv: kim, qachon, qanchadan qanchaga — tekshiruvda tez topilsin
        if (Number(before.creditLimit) !== Number(after.creditLimit)) {
          await audit(tx, s.userId, "UPDATE", "CustomerCreditLimit", id, { creditLimit: before.creditLimit, role: s.role }, { creditLimit: after.creditLimit, role: s.role });
        }
      } else {
        const c = await tx.customer.create({ data: d });
        await audit(tx, s.userId, "CREATE", "Customer", c.id, undefined, c);
        savedId = c.id;
      }
    });
  } catch (e) {
    if (String(e).includes("Unique constraint")) return { error: "Bu INN bilan mijoz allaqachon bor" };
    throw e;
  }
  // Ilovaga ham yetsin (nom/telefon/limit) — telefoni ilovada bo'lsa hisobi o'sha yerda ulanadi
  if (savedId) syncCustomerLater(savedId);
  revalidatePath("/customers");
  redirect("/customers");
}
