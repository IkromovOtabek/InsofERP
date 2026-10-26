"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireAction } from "@/lib/auth";
import { parseForm, zStr, zOpt, MAX_AMOUNT, validDate, type ActionState } from "@/lib/action";
import { cancelCashEntry, createCashEntry, payReceiptEntry } from "@/lib/cash-entry";
import { createTransfer } from "@/lib/cash-transfer";
import { PEREKIT_CATEGORY } from "@/lib/cash-categories";

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
  // Kategoriya daraxti: sub manba, loyiha, kredit (`lib/fin-report/categories`)
  subCategory: zOpt,
  projectId: zOpt,
  loanId: zOpt,
  // «Perekit» tanlanganda: pul qaysi o'z hisobimizga o'tadi
  toAccountId: zOpt,
  clientToken: zOpt,
});

export async function createCashTx(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(schema, fd);
  if ("error" in r) return { error: r.error };
  // «Perekit» — chiqim emas: o'z hisoblararo o'tkazma hujjati (ikkala hisob tarixida ±, P&L ga kirmaydi)
  if (r.data.type === "EXPENSE" && r.data.category === PEREKIT_CATEGORY) {
    const s = await requireAction("cashflow", "transfer");
    if (!r.data.toAccountId) return { error: "Perekit: pul qaysi hisobga o'tishini tanlang («Qayerga»)" };
    const t = r.data.clientToken && /^[A-Za-z0-9-]{16,64}$/.test(r.data.clientToken) ? r.data.clientToken : null;
    const res = await createTransfer({ date: new Date(r.data.date), fromAccountId: r.data.cashAccountId, toAccountId: r.data.toAccountId, amount: r.data.amount, note: r.data.note, clientToken: t }, s.userId);
    if (res.error) return { error: res.error };
    revalidatePath("/cashflow"); revalidatePath("/payments"); revalidatePath("/");
    return { ok: true, note: res.duplicate ? `${res.docNo} allaqachon saqlangan (qayta bosildi)` : `Perekit ${res.docNo} saqlandi` };
  }
  const s = await requireAction("cashflow", "create");
  // Qoida `lib/cash-entry.ts` da — mobil ilovadagi kassa ham shuni chaqiradi
  const res = await createCashEntry({ ...r.data, date: new Date(r.data.date) }, s.userId);
  if (res.error) return { error: res.error };
  revalidatePath("/cashflow"); revalidatePath("/payments"); revalidatePath("/"); revalidatePath("/moliya", "layout");
  return { ok: true, note: r.data.category === ASSET_PURCHASE_CATEGORY ? "Saqlandi. Endi Moliya → Asosiy vositalar sahifasida shu xarid uchun kartochka oching (amortizatsiya shundan hisoblanadi)" : undefined };
}

/** Asosiy vosita xaridi — saqlangach kartochka ochishni eslatamiz (migratsiyadagi tizim kategoriyasi nomi). */
const ASSET_PURCHASE_CATEGORY = "Asosiy vosita xaridi";

/**
 * Qo'lda yozilgan kirim/chiqimni bekor qilish — sabab bilan (`ConfirmButton reason="required"`). Yozuv o'chirilmaydi,
 * «Bekor qilingan» bo'lib qoladi. Qoida `lib/cash-entry.ts` da (mobil ham). Ruxsat — avvalgi `cashflow.delete` amali.
 */
export async function cancelCashTx(id: string, reason: string): Promise<ActionState> {
  const s = await requireAction("cashflow", "delete");
  const res = await cancelCashEntry(id, String(reason ?? ""), s.userId);
  if (res.error) return { error: res.error };
  revalidatePath("/cashflow"); revalidatePath("/payments"); revalidatePath("/receipts", "layout"); revalidatePath("/");
  return { ok: true, note: "Bekor qilindi" };
}

/**
 * To'lanmagan kirimni to'lash: moliya hisobni tanlaydi, kirimning QOLGAN summasi (yoki kiritilgan qismi)
 * chiqim bo'lib yoziladi. Qoida `lib/cash-entry.ts` → `payReceiptEntry` da (mobil kirim kartochkasi ham).
 */
export async function payReceipt(receiptId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("cashflow", "pay");
  const cashAccountId = String(fd.get("cashAccountId") ?? "");
  // Bo'sh — qolgan summaning hammasi; kiritilsa — qisman to'lov
  const rawAmount = String(fd.get("amount") ?? "").replace(/[\s,]/g, "");
  const res = await payReceiptEntry(receiptId, { cashAccountId, amount: rawAmount ? Number(rawAmount) : null }, s.userId);
  if (res.error) return { error: res.error };
  revalidatePath("/cashflow"); revalidatePath("/payments"); revalidatePath(`/receipts/${receiptId}`); revalidatePath("/");
  return { ok: true };
}
