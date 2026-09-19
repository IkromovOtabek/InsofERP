"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { parseForm, zStr, zOpt, type ActionState } from "@/lib/action";

const schema = z.object({
  type: z.enum(["INCOME", "EXPENSE"]),
  date: zStr("Sana kerak"),
  cashAccountId: zStr("Kassa/hisob tanlanmagan"),
  amount: z.coerce.number().positive("summa 0 dan katta bo'lsin"),
  category: zStr("Kategoriya tanlanmagan"),
  counterparty: zOpt,
  supplierId: zOpt,
  note: zOpt,
});

export async function createCashTx(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireSession(["CASHIER", "ACCOUNTING", "FINANCE"]);
  const r = parseForm(schema, fd);
  if ("error" in r) return { error: r.error };
  const d = r.data;
  await db.$transaction(async (tx) => {
    const t = await tx.cashTransaction.create({ data: { ...d, date: new Date(d.date), createdById: s.userId } });
    await audit(tx, s.userId, "CREATE", "CashTransaction", t.id, undefined, t);
  });
  revalidatePath("/cashflow"); revalidatePath("/payments"); revalidatePath("/");
  return { ok: true };
}

export async function deleteCashTx(id: string) {
  const s = await requireSession(["ACCOUNTING", "FINANCE"]);
  const t = await db.cashTransaction.findUniqueOrThrow({ where: { id } });
  await db.$transaction(async (tx) => {
    await tx.cashTransaction.delete({ where: { id } });
    await audit(tx, s.userId, "DELETE", "CashTransaction", id, t, undefined);
  });
  revalidatePath("/cashflow"); revalidatePath("/payments");
}
