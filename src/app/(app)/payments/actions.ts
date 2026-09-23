"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { addPayment } from "@/lib/payments";
import { num, parseDate, str } from "@/lib/excel";
import { deleteRegisterBatch, importSalesRegister, type RegisterRow } from "@/lib/sales-register";
import { parseForm, zStr, zOpt, type ActionState } from "@/lib/action";

const schema = z.object({
  customerId: zStr("Mijoz tanlanmagan"),
  invoiceId: zOpt,
  cashAccountId: zStr("Kassa/hisob tanlanmagan"),
  amount: z.coerce.number().positive("summa 0 dan katta bo'lsin"),
  date: zStr("Sana kerak"),
  note: zOpt,
});

/** To'lov. Schyot ko'rsatilsa — uning holati yangilanadi; to'liq to'lansa zayavka CLOSED. */
export async function createPayment(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireSession(["CASHIER", "ACCOUNTING"]);
  const r = parseForm(schema, fd);
  if ("error" in r) return { error: r.error };
  const d = r.data;

  // Qoida `lib/payments.ts` da — mobil ilovadagi kassa ham shuni chaqiradi
  await addPayment({ customerId: d.customerId, invoiceId: d.invoiceId, cashAccountId: d.cashAccountId, amount: d.amount, date: new Date(d.date), note: d.note }, s.userId);
  revalidatePath("/payments"); revalidatePath("/invoices"); revalidatePath("/orders"); revalidatePath("/");
  return { ok: true };
}

/* ───────── Realizatsiya jurnali (Excel import) ───────── */

const importSchema = z.object({
  rows: zStr("Excel qatorlari yo'q"),
  cashAccountId: zStr("Naqd kassa tanlanmagan"),
  bankAccountId: zStr("Bank hisobi tanlanmagan"),
  dateOrder: z.enum(["dmy", "mdy"]).default("dmy"),
  toCash: z.string().optional(),
  createMissing: z.string().optional(),
});

/** Fayldagi bitta qator — kalitlar `payments/import` sahifasidagi maydon nomlari bilan bir xil. */
type FileRow = Record<string, unknown>;

/**
 * Kassa/bank → "Excel orqali qo'shish": rasmdagi kunlik jo'natma jadvali jurnalga tushadi,
 * "Деньги" ustuniga qarab pul naqd kassaga yoki bank hisobiga kirim bo'lib yoziladi.
 */
export async function importSalesRegisterFromExcel(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireSession(["CASHIER", "ACCOUNTING", "FINANCE"]);
  const r = parseForm(importSchema, fd);
  if ("error" in r) return { error: r.error };
  const d = r.data;

  let file: FileRow[];
  try { file = JSON.parse(d.rows); } catch { return { error: "Excel ma'lumotlari o'qilmadi" }; }
  file = file.filter((x) => str(x.customer) || str(x.productName));
  if (!file.length) return { error: "Faylda qator yo'q" };

  const monthFirst = d.dateOrder === "mdy";
  const rows: RegisterRow[] = [];
  for (const [i, x] of file.entries()) {
    const no = i + 1;
    const date = parseDate(x.date, monthFirst);
    if (!date) return { error: `${no}-qator: sana o'qilmadi ("${str(x.date)}") — "Sana tartibi"ni tekshiring` };
    const customer = str(x.customer);
    if (!customer) return { error: `${no}-qator: mijoz (Кому) bo'sh` };
    const productName = str(x.productName);
    if (!productName) return { error: `${no}-qator (${customer}): mahsulot nomi bo'sh` };
    const qty = num(x.qty);
    if (!(qty > 0)) return { error: `${no}-qator (${customer}): miqdor 0 dan katta raqam bo'lsin` };
    // Pul ustunlari bo'sh bo'lishi mumkin (hisoblanadi), lekin yozilgani raqam bo'lsin
    const money: Record<string, number | undefined> = {};
    for (const k of ["price", "sum", "nds", "totalSum", "deliverySum"]) {
      if (str(x[k]) === "") continue;
      const v = num(x[k]);
      if (!Number.isFinite(v)) return { error: `${no}-qator (${customer}): "${k}" ustunida raqam emas ("${str(x[k])}")` };
      money[k] = v;
    }
    rows.push({
      date, customer, productName, qty,
      unit: str(x.unit), vehicleNo: str(x.vehicleNo), ttn: str(x.ttn), fromWho: str(x.fromWho), payType: str(x.payType),
      deliveryFee: money.deliverySum, price: money.price, sum: money.sum, nds: money.nds, total: money.totalSum,
      address: str(x.address), contractNo: str(x.contractNo), invoiceNo: str(x.invoiceNo), monthNo: str(x.monthNo), note: str(x.note),
    });
  }

  const out = await importSalesRegister({
    rows,
    cashAccountId: d.cashAccountId,
    bankAccountId: d.bankAccountId,
    createMissing: !!d.createMissing,
    toCash: !!d.toCash,
  }, s.userId).catch((e: Error) => ({ error: e.message }));
  if ("error" in out) return out;

  revalidatePath("/payments"); revalidatePath("/cashflow"); revalidatePath("/customers"); revalidatePath("/");
  redirect(`/payments?tab=jurnal&batch=${out.batch}`);
}

/** Noto'g'ri yuklangan partiyani qaytarish: qatorlar va ular yozgan kirimlar o'chadi. */
export async function deleteImportBatch(batch: string) {
  const s = await requireSession(["ACCOUNTING", "FINANCE"]);
  await deleteRegisterBatch(batch, s.userId);
  revalidatePath("/payments"); revalidatePath("/cashflow"); revalidatePath("/");
}
