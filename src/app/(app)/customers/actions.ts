"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { parseForm, zDec, zStr, zOpt, type ActionState } from "@/lib/action";

const schema = z.object({
  name: zStr("Nomi to'ldirilishi shart"),
  inn: zOpt,
  phone: zOpt,
  address: zOpt,
  creditLimit: zDec(0),
  isActive: z.string().optional().transform((v) => v === "on"),
});

export async function saveCustomer(id: string | null, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireSession(["SALES", "ACCOUNTING", "FINANCE"]);
  const r = parseForm(schema, fd);
  if ("error" in r) return { error: r.error };
  const d = r.data;

  // Kredit limitni faqat finance/direktor o'zgartira oladi
  if (id && !["FINANCE", "DIRECTOR"].includes(s.role)) {
    const cur = await db.customer.findUniqueOrThrow({ where: { id } });
    if (Number(cur.creditLimit) !== d.creditLimit) return { error: "Kredit limitni faqat Finance yoki Direktor o'zgartira oladi" };
  }

  try {
    await db.$transaction(async (tx) => {
      if (id) {
        const before = await tx.customer.findUniqueOrThrow({ where: { id } });
        const after = await tx.customer.update({ where: { id }, data: d });
        await audit(tx, s.userId, "UPDATE", "Customer", id, before, after);
      } else {
        const c = await tx.customer.create({ data: d });
        await audit(tx, s.userId, "CREATE", "Customer", c.id, undefined, c);
      }
    });
  } catch (e) {
    if (String(e).includes("Unique constraint")) return { error: "Bu INN bilan mijoz allaqachon bor" };
    throw e;
  }
  revalidatePath("/customers");
  redirect("/customers");
}
