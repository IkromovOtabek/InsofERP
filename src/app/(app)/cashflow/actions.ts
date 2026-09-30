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

/**
 * To'lanmagan kirimni to'lash: moliya hisobni tanlaydi, kirim summasi chiqim bo'lib yoziladi.
 * Kirim bo'yicha qulf — ikki marta bosilsa ikkinchi chiqim yozilmaydi.
 */
export async function payReceipt(receiptId: string, fd: FormData) {
  const s = await requireSession(["FINANCE", "ACCOUNTING"]);
  const cashAccountId = String(fd.get("cashAccountId") ?? "");
  const acc = await db.cashAccount.findFirst({ where: { id: cashAccountId, isActive: true } });
  if (!acc) throw new Error("Kassa/hisob tanlanmagan");
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${receiptId}))`;
    const already = await tx.cashTransaction.count({ where: { refType: "GoodsReceipt", refId: receiptId } });
    if (already) return;
    const rec = await tx.goodsReceipt.findUniqueOrThrow({ where: { id: receiptId }, include: { supplier: true, items: true } });
    const total = rec.items.reduce((x, i) => x + Number(i.qty) * Number(i.price), 0);
    if (!(total > 0)) return;
    const t = await tx.cashTransaction.create({
      data: {
        type: "EXPENSE", date: new Date(), cashAccountId: acc.id, amount: total, category: "Xomashyo",
        supplierId: rec.supplierId, counterparty: rec.supplier.name,
        note: `Kirim ${rec.docNo} · ${rec.items.length} qator (moliya to'ladi)`,
        refType: "GoodsReceipt", refId: rec.id, createdById: s.userId,
      },
    });
    await audit(tx, s.userId, "CREATE", "CashTransaction", t.id, undefined, t);
  });
  revalidatePath("/cashflow"); revalidatePath("/payments"); revalidatePath(`/receipts/${receiptId}`); revalidatePath("/");
}
