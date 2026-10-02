"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { addPayment, linkPaymentToInvoice, reversePayment } from "@/lib/payments";
import { num, numMoney, parseDate, str } from "@/lib/excel";
import { deleteRegisterBatch, importSalesRegister, type RegisterRow } from "@/lib/sales-register";
import { parseForm, zStr, zOpt, MAX_AMOUNT, validDate, type ActionState } from "@/lib/action";

const schema = z.object({
  customerId: zStr("Mijoz tanlanmagan"),
  invoiceId: zOpt,
  orderId: zOpt, // avans: schyoti hali yo'q zayavka
  cashAccountId: zStr("Kassa/hisob tanlanmagan"),
  amount: z.coerce.number().positive("summa 0 dan katta bo'lsin").max(MAX_AMOUNT, "summa juda katta"),
  date: zStr("Sana kerak").refine(validDate, "sana noto'g'ri"),
  note: zOpt,
});

/** To'lov. Schyot ko'rsatilsa — uning holati yangilanadi; to'liq to'lansa zayavka CLOSED. */
export async function createPayment(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireSession(["CASHIER", "ACCOUNTING"]);
  const r = parseForm(schema, fd);
  if ("error" in r) return { error: r.error };
  const d = r.data;

  // Qoida `lib/payments.ts` da — mobil ilovadagi kassa ham shuni chaqiradi
  const res = await addPayment({ customerId: d.customerId, invoiceId: d.invoiceId, orderId: d.invoiceId ? null : d.orderId, cashAccountId: d.cashAccountId, amount: d.amount, date: new Date(d.date), note: d.note }, s.userId);
  if (res.error) return { error: res.error };
  revalidatePath("/payments"); revalidatePath("/invoices"); revalidatePath("/orders"); revalidatePath("/sales"); revalidatePath("/cashflow"); revalidatePath("/");
  return { ok: true };
}

/** Taqsimlanmagan to'lovni ochiq schyotga bog'lash (FIFO tavsiya sahifada). */
export async function linkPayment(paymentId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireSession(["CASHIER", "ACCOUNTING"]);
  const invoiceId = String(fd.get("invoiceId") ?? "");
  if (!invoiceId) return { error: "Schyot tanlanmagan" };
  const r = await linkPaymentToInvoice(paymentId, invoiceId, s.userId);
  if (r.error) return { error: r.error };
  revalidatePath("/payments"); revalidatePath("/invoices"); revalidatePath("/orders"); revalidatePath("/sales"); revalidatePath("/customers");
  return { ok: true, note: r.rest && r.rest > 0 ? `Bog'landi; ortgan ${r.rest.toLocaleString("ru-RU")} so'm taqsimlanmagan qoldi` : "Schyotga bog'landi" };
}

/** To'lov stornosi — faqat buxgalteriya va direktor; sabab majburiy, oldingi holat auditda. */
export async function stornoPayment(paymentId: string, reason: string): Promise<ActionState> {
  const s = await requireSession(["ACCOUNTING"]);
  const r = await reversePayment(paymentId, String(reason ?? "").slice(0, 300), s.userId);
  if (r.error) return { error: r.error };
  revalidatePath("/payments"); revalidatePath("/invoices"); revalidatePath("/orders"); revalidatePath("/sales"); revalidatePath("/cashflow"); revalidatePath("/customers"); revalidatePath("/");
  return { ok: true, note: "Storno qilindi" };
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
      const v = numMoney(x[k]);
      if (!Number.isFinite(v)) return { error: `${no}-qator (${customer}): "${k}" ustunida raqam emas ("${str(x[k])}")` };
      if (v < 0) return { error: `${no}-qator (${customer}): "${k}" manfiy (${str(x[k])}) — qaytarish/tuzatish qatorlari importda qabul qilinmaydi` };
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
  const q = new URLSearchParams({ tab: "jurnal", batch: out.batch });
  if (out.skipped) q.set("skipped", String(out.skipped));
  if (out.unknownPayType) q.set("unknown", String(out.unknownPayType));
  if (out.payments) q.set("paid", String(out.payments));
  redirect(`/payments?${q.toString()}`);
}

/**
 * Noto'g'ri yuklangan partiyani qaytarish: qatorlar va ular yozgan kirimlar o'chadi.
 * Buxgalteriya/moliya — har qanday partiyani; kassir — faqat o'zi yuklaganini.
 */
export async function deleteImportBatch(batch: string): Promise<ActionState> {
  const s = await requireSession(["ACCOUNTING", "FINANCE", "CASHIER"]);
  if (s.role === "CASHIER") {
    const other = await db.salesRegister.count({ where: { batch, createdById: { not: s.userId } } });
    if (other) return { error: "Bu partiyani boshqa xodim yuklagan — buxgalteriya qaytaradi" };
  }
  const r = await deleteRegisterBatch(batch, s.userId);
  if (!r.rows) return { error: "Partiya topilmadi yoki allaqachon qaytarilgan" };
  revalidatePath("/payments"); revalidatePath("/cashflow"); revalidatePath("/customers"); revalidatePath("/");
  return { ok: true, note: `Qaytarildi: ${r.rows} qator, ${r.payments} kirim` };
}
