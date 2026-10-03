"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireAction } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { parseForm, zStr, zOpt, MAX_AMOUNT, validDate, type ActionState } from "@/lib/action";
import { cashOutflowError } from "@/lib/payments";

class CashError extends Error {}

/** Bir xil yozuv shu oraliqda qayta kelsa — ikki marta bosilgan deb hisoblanadi (to'lovlardagi kabi). */
const DUPLICATE_WINDOW_MS = 60_000;

const schema = z.object({
  type: z.enum(["INCOME", "EXPENSE"]),
  date: zStr("Sana kerak").refine(validDate, "sana noto'g'ri"),
  cashAccountId: zStr("Kassa/hisob tanlanmagan"),
  amount: z.coerce.number().positive("summa 0 dan katta bo'lsin").max(MAX_AMOUNT, "summa juda katta"),
  category: zStr("Kategoriya tanlanmagan"),
  counterparty: zOpt,
  supplierId: zOpt,
  note: zOpt,
});

export async function createCashTx(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("cashflow", "create");
  const r = parseForm(schema, fd);
  if ("error" in r) return { error: r.error };
  const d = r.data;
  const acc = await db.cashAccount.findFirst({ where: { id: d.cashAccountId, isActive: true }, select: { id: true } });
  if (!acc) return { error: "Kassa/hisob topilmadi yoki yopilgan" };
  const res = await db.$transaction(async (tx) => {
    // Hisob bo'yicha navbat: dublikat va qoldiq tekshiruvi parallel so'rovlarda ham to'g'ri ishlasin
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"cashtx:" + d.cashAccountId}))`;
    const dup = await tx.cashTransaction.findFirst({
      where: { type: d.type, cashAccountId: d.cashAccountId, amount: d.amount, category: d.category, createdById: s.userId, createdAt: { gte: new Date(Date.now() - DUPLICATE_WINDOW_MS) } },
      select: { id: true },
    });
    if (dup) throw new CashError("Aynan shu yozuv hozirgina saqlandi — ikki marta bosilgan bo'lishi mumkin. Rostdan ikkinchisi bo'lsa, bir daqiqadan keyin qayta kiriting");
    // Naqd kassa minusga tushmasin
    if (d.type === "EXPENSE") {
      const err = await cashOutflowError(tx, d.cashAccountId, d.amount);
      if (err) throw new CashError(err);
    }
    const t = await tx.cashTransaction.create({ data: { ...d, date: new Date(d.date), createdById: s.userId } });
    await audit(tx, s.userId, "CREATE", "CashTransaction", t.id, undefined, t);
    return { ok: true as const };
  }).catch((e: Error) => { if (e instanceof CashError) return { error: e.message }; throw e; });
  if ("error" in res) return res;
  revalidatePath("/cashflow"); revalidatePath("/payments"); revalidatePath("/");
  return { ok: true };
}

/** Qo'lda yozilgan kirim/chiqimni o'chirish — tasdiq tugmasi (`ConfirmButton`) orqali. */
export async function deleteCashTx(id: string): Promise<ActionState> {
  const s = await requireAction("cashflow", "delete");
  const t = await db.cashTransaction.findUnique({ where: { id } });
  if (!t) return { error: "Yozuv topilmadi (allaqachon o'chirilgan bo'lishi mumkin)" };
  // Hujjatga bog'langan yozuv (kirim to'lovi, ta'minot to'lovi) qo'lda o'chirilmaydi — aks holda hujjat
  // "to'lanmagan" bo'lib qaytadi yoki yo'q yozuvga ishora qilib qoladi. Sahifada tugma ham yashirin.
  if (t.refType) return { error: "Hujjatga bog'langan yozuvni o'chirib bo'lmaydi" };
  const res = await db.$transaction(async (tx) => {
    // Kirimni o'chirish ham naqd kassani minusga tushirishi mumkin
    if (t.type === "INCOME") {
      const err = await cashOutflowError(tx, t.cashAccountId, Number(t.amount));
      if (err) throw new CashError(`Bu kirim o'chirilsa kassa minusga tushadi. ${err}`);
    }
    await tx.cashTransaction.delete({ where: { id } });
    await audit(tx, s.userId, "DELETE", "CashTransaction", id, t, undefined);
    return { ok: true as const };
  }).catch((e: Error) => { if (e instanceof CashError) return { error: e.message }; throw e; });
  if ("error" in res) return res;
  revalidatePath("/cashflow"); revalidatePath("/payments"); revalidatePath("/");
  return { ok: true, note: "O'chirildi" };
}

/**
 * To'lanmagan kirimni to'lash: moliya hisobni tanlaydi, kirim summasi chiqim bo'lib yoziladi.
 * Kirim bo'yicha qulf — ikki marta bosilsa ikkinchi chiqim yozilmaydi.
 */
export async function payReceipt(receiptId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("cashflow", "pay");
  const cashAccountId = String(fd.get("cashAccountId") ?? "");
  const acc = await db.cashAccount.findFirst({ where: { id: cashAccountId, isActive: true } });
  if (!acc) return { error: "Kassa/hisob tanlanmagan" };
  const res = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${receiptId}))`;
    const already = await tx.cashTransaction.count({ where: { refType: "GoodsReceipt", refId: receiptId } });
    if (already) return;
    const rec = await tx.goodsReceipt.findUniqueOrThrow({ where: { id: receiptId }, include: { supplier: true, items: true } });
    const total = rec.items.reduce((x, i) => x + Number(i.qty) * Number(i.price), 0);
    if (!(total > 0)) return;
    // Naqd kassadan to'lov qoldiqdan oshmasin — bankdan to'lash yoki avval kassani to'ldirish kerak
    const err = await cashOutflowError(tx, acc.id, total);
    if (err) throw new CashError(err);
    const t = await tx.cashTransaction.create({
      data: {
        type: "EXPENSE", date: new Date(), cashAccountId: acc.id, amount: total, category: "Xomashyo",
        supplierId: rec.supplierId, counterparty: rec.supplier.name,
        note: `Kirim ${rec.docNo} · ${rec.items.length} qator (moliya to'ladi)`,
        refType: "GoodsReceipt", refId: rec.id, createdById: s.userId,
      },
    });
    await audit(tx, s.userId, "CREATE", "CashTransaction", t.id, undefined, t);
  }).then(() => ({ ok: true as const })).catch((e: Error) => { if (e instanceof CashError) return { error: e.message }; throw e; });
  if ("error" in res) return res;
  revalidatePath("/cashflow"); revalidatePath("/payments"); revalidatePath(`/receipts/${receiptId}`); revalidatePath("/");
  return { ok: true };
}
