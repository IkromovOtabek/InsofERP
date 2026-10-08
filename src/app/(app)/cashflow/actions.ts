"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireAction } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { parseForm, zStr, zOpt, MAX_AMOUNT, validDate, type ActionState } from "@/lib/action";
import { cashOutflowError } from "@/lib/payments";
import { lockReceipt, receiptPayState } from "@/lib/receipt-payables";
import { money } from "@/lib/format";
import { createCashEntry } from "@/lib/cash-entry";

class CashError extends Error {}

const schema = z.object({
  type: z.enum(["INCOME", "EXPENSE"]),
  date: zStr("Sana kerak").refine(validDate, "sana noto'g'ri"),
  cashAccountId: zStr("Kassa/hisob tanlanmagan"),
  amount: z.coerce.number().positive("summa 0 dan katta bo'lsin").max(MAX_AMOUNT, "summa juda katta"),
  category: zStr("Kategoriya tanlanmagan"),
  counterparty: zOpt,
  supplierId: zOpt,
  // Chiqim qaysi kirim hujjati (yetkazuvchidan olingan mol) uchun — bog'lansa kirim "to'langan" summasiga qo'shiladi
  receiptId: zOpt,
  note: zOpt,
});

export async function createCashTx(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("cashflow", "create");
  const r = parseForm(schema, fd);
  if ("error" in r) return { error: r.error };
  // Qoida `lib/cash-entry.ts` da — mobil ilovadagi kassa ham shuni chaqiradi
  const res = await createCashEntry({ ...r.data, date: new Date(r.data.date) }, s.userId);
  if (res.error) return { error: res.error };
  revalidatePath("/cashflow"); revalidatePath("/payments"); revalidatePath("/");
  return { ok: true };
}

/** Qo'lda yozilgan kirim/chiqimni o'chirish — tasdiq tugmasi (`ConfirmButton`) orqali. */
export async function deleteCashTx(id: string): Promise<ActionState> {
  const s = await requireAction("cashflow", "delete");
  const t = await db.cashTransaction.findUnique({ where: { id } });
  if (!t) return { error: "Yozuv topilmadi (allaqachon o'chirilgan bo'lishi mumkin)" };
  // Hujjatga bog'langan yozuv (sklad kirimi, ta'minot to'lovi) qo'lda o'chirilmaydi — aks holda yo'q yozuvga
  // ishora qilib qoladi. Istisno — kirim hujjatiga (GoodsReceipt) to'lov: uni o'chirish to'lovni storno qilish,
  // kirim yana "to'lanmagan" ro'yxatiga qaytadi (kirimni storno qilishdan oldin shu kerak).
  // Ta'minot zanjirining chiqimi esa zanjirda (moliya) boshqariladi.
  if (t.refType && t.refType !== "GoodsReceipt") return { error: "Hujjatga bog'langan yozuvni o'chirib bo'lmaydi" };
  if (t.refType === "GoodsReceipt" && (await db.supplyRequest.count({ where: { cashTxId: t.id } }))) return { error: "Bu chiqim ta'minot zayavkasining puli — Ta'minot bo'limida boshqariladi" };
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
 * To'lanmagan kirimni to'lash: moliya hisobni tanlaydi, kirimning QOLGAN summasi (yoki kiritilgan qismi)
 * chiqim bo'lib yoziladi. To'langan = kirimga bog'langan barcha chiqimlar (qo'lda bog'langan qisman to'lov ham).
 * Kirim bo'yicha qulf — ikki marta bosilsa ikkinchisi qolgan summani 0 ko'radi; ortiqcha to'lov rad etiladi.
 */
export async function payReceipt(receiptId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("cashflow", "pay");
  const cashAccountId = String(fd.get("cashAccountId") ?? "");
  const acc = await db.cashAccount.findFirst({ where: { id: cashAccountId, isActive: true } });
  if (!acc) return { error: "Kassa/hisob tanlanmagan" };
  // Bo'sh — qolgan summaning hammasi; kiritilsa — qisman to'lov
  const rawAmount = String(fd.get("amount") ?? "").replace(/[\s,]/g, "");
  const part = rawAmount ? Number(rawAmount) : null;
  if (part != null && !(Number.isFinite(part) && part > 0 && part <= MAX_AMOUNT)) return { error: "To'lov summasi noto'g'ri" };
  const res = await db.$transaction(async (tx) => {
    await lockReceipt(tx, receiptId);
    const st = await receiptPayState(tx, receiptId);
    if (!st) throw new CashError("Kirim hujjati topilmadi");
    if (st.cancelled) throw new CashError(`${st.docNo} storno qilingan — to'lanmaydi`);
    if (st.left <= 0.005) return; // allaqachon to'liq to'langan (ikki marta bosilgan)
    if (part != null && part > st.left + 0.005) throw new CashError(`${st.docNo} bo'yicha qolgan to'lov ${money(st.left)} — ${money(part)} ortiqcha`);
    const amount = part ?? st.left;
    // Naqd kassadan to'lov qoldiqdan oshmasin — bankdan to'lash yoki avval kassani to'ldirish kerak
    const err = await cashOutflowError(tx, acc.id, amount);
    if (err) throw new CashError(err);
    const t = await tx.cashTransaction.create({
      data: {
        type: "EXPENSE", date: new Date(), cashAccountId: acc.id, amount, category: "Xomashyo",
        supplierId: st.supplierId, counterparty: st.supplierName,
        note: `Kirim ${st.docNo} · ${st.lines} qator (moliya to'ladi${amount < st.left - 0.005 ? `, qisman: ${money(amount)} / ${money(st.left)}` : ""})`,
        refType: "GoodsReceipt", refId: st.id, createdById: s.userId,
      },
    });
    await audit(tx, s.userId, "CREATE", "CashTransaction", t.id, undefined, t);
  }).then(() => ({ ok: true as const })).catch((e: Error) => { if (e instanceof CashError) return { error: e.message }; throw e; });
  if ("error" in res) return res;
  revalidatePath("/cashflow"); revalidatePath("/payments"); revalidatePath(`/receipts/${receiptId}`); revalidatePath("/");
  return { ok: true };
}
