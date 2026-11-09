"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAction } from "@/lib/auth";
import { db } from "@/lib/db";
import { addPayment, linkPaymentToInvoice, reversePayment, updatePaymentEntry } from "@/lib/payments";
import { updateTransfer } from "@/lib/cash-transfer";
import type { ValueMaps } from "@/lib/excel";
import { isoDate } from "@/lib/format";
import { importCashEntries, type CashImportRow } from "@/lib/cash-import";
import { monthEndDate, setCashBalanceAt } from "@/lib/opening-balances";
import { deleteRegisterBatch, updateRegisterRow } from "@/lib/sales-register";
import { parseForm, zStr, zOpt, zDec, MAX_AMOUNT, validDate, type ActionState } from "@/lib/action";

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
  const s = await requireAction("payments", "create");
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
  const s = await requireAction("payments", "create");
  const invoiceId = String(fd.get("invoiceId") ?? "");
  if (!invoiceId) return { error: "Schyot tanlanmagan" };
  const r = await linkPaymentToInvoice(paymentId, invoiceId, s.userId);
  if (r.error) return { error: r.error };
  revalidatePath("/payments"); revalidatePath("/invoices"); revalidatePath("/orders"); revalidatePath("/sales"); revalidatePath("/customers");
  return { ok: true, note: r.rest && r.rest > 0 ? `Bog'landi; ortgan ${r.rest.toLocaleString("ru-RU")} so'm taqsimlanmagan qoldi` : "Schyotga bog'landi" };
}

/** To'lov stornosi — faqat buxgalteriya va direktor; sabab majburiy, oldingi holat auditda. */
export async function stornoPayment(paymentId: string, reason: string): Promise<ActionState> {
  const s = await requireAction("payments", "storno");
  const r = await reversePayment(paymentId, String(reason ?? "").slice(0, 300), s.userId);
  if (r.error) return { error: r.error };
  revalidatePath("/payments"); revalidatePath("/invoices"); revalidatePath("/orders"); revalidatePath("/sales"); revalidatePath("/cashflow"); revalidatePath("/customers"); revalidatePath("/");
  return { ok: true, note: "Bekor qilindi" };
}

/* ───────── Tahrirlash (Kassa jurnali, To'lovlar, Realizatsiya jurnali) ─────────
 * Ruxsat — `cashflow.edit` («Yozuvni tahrirlash (Kassa / bank)»): Kassa jurnalidagi kirim/chiqim qalami bilan bir amal. */

const revalidateCash = () => {
  revalidatePath("/payments", "layout"); revalidatePath("/cashflow"); revalidatePath("/invoices"); revalidatePath("/orders");
  revalidatePath("/customers"); revalidatePath("/pul-qabul"); revalidatePath("/"); revalidatePath("/moliya", "layout");
};

const payEditSchema = z.object({
  date: zStr("Sana kerak").refine(validDate, "sana noto'g'ri"),
  cashAccountId: zStr("Kassa/hisob tanlanmagan"),
  amount: z.coerce.number().positive("summa 0 dan katta bo'lsin").max(MAX_AMOUNT, "summa juda katta"),
  customerId: zStr("Mijoz tanlanmagan"),
  note: zOpt,
  sig: z.string().max(5000),
});

/** Mijoz to'lovini tuzatish (sana, hisob, summa, mijoz, izoh). Qoida — `lib/payments.ts` → `updatePaymentEntry`. */
export async function updatePaymentRow(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("cashflow", "edit");
  const r = parseForm(payEditSchema, fd);
  if ("error" in r) return { error: r.error };
  const res = await updatePaymentEntry(id, { ...r.data, date: new Date(r.data.date) }, s.userId);
  if (res.error) return { error: res.error };
  revalidateCash();
  return { ok: true, note: "Saqlandi" };
}

const transferEditSchema = z.object({
  date: zStr("Sana kerak").refine(validDate, "sana noto'g'ri"),
  fromAccountId: zStr("Qayerdan — hisob tanlanmagan"),
  toAccountId: zStr("Qayerga — hisob tanlanmagan"),
  amount: z.coerce.number().positive("summa 0 dan katta bo'lsin").max(MAX_AMOUNT, "summa juda katta"),
  note: zOpt,
  sig: z.string().max(5000),
});

/** Perekit (hisoblararo o'tkazma) — hujjat va ikkala oyog'i birga. Qoida — `lib/cash-transfer.ts` → `updateTransfer`. */
export async function updateTransferRow(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("cashflow", "edit");
  const r = parseForm(transferEditSchema, fd);
  if ("error" in r) return { error: r.error };
  const res = await updateTransfer(id, { ...r.data, date: new Date(r.data.date) }, s.userId);
  if (res.error) return { error: res.error };
  revalidateCash();
  return { ok: true, note: "Saqlandi" };
}

const regEditSchema = z.object({
  date: zStr("Sana kerak").refine(validDate, "sana noto'g'ri"),
  customerId: zStr("Mijoz tanlanmagan"),
  vehicleNo: zOpt, ttn: zOpt,
  productName: zStr("Mahsulot nomi kerak"),
  unit: z.string().trim().max(20).default("m3"),
  qty: zDec(0), fromWho: zOpt, payType: zOpt,
  deliveryFee: zDec(0), price: zDec(0), sum: zDec(0), nds: zDec(0), total: zDec(0),
  address: zOpt, contractNo: zOpt, invoiceNo: zOpt, monthNo: zOpt, note: zOpt,
  cashAccountId: zOpt,
  sig: z.string().max(5000),
});

/** Realizatsiya jurnali qatori — barcha ustunlar; kassaga yozilgan kirimi ham birga. Qoida — `lib/sales-register.ts`. */
export async function updateRegisterLine(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("cashflow", "edit");
  const r = parseForm(regEditSchema, fd);
  if ("error" in r) return { error: r.error };
  const res = await updateRegisterRow(id, { ...r.data, date: new Date(r.data.date) }, s.userId);
  if (res.error) return { error: res.error };
  revalidateCash();
  return { ok: true, note: "Saqlandi" };
}

/* ───────── Kassa jurnali (Excel import) ───────── */

/**
 * Kassa / bank → «Excel orqali qo'shish»: Kassa jurnali ustunlaridagi fayl (Sana, Hisob, Kirim, Chiqim, Manba, Sub manba,
 * Kontragent, Izoh) qo'lda kirim/chiqim bo'lib yoziladi — qoidalar `lib/cash-import.ts` da. Tugagach jurnal shu davr bilan ochiladi.
 */
export async function importCashJournalFromExcel(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("payments", "import");
  let rows: unknown;
  const maps: ValueMaps = {};
  try {
    rows = JSON.parse(String(fd.get("rows") ?? "[]"));
    const raw: unknown = JSON.parse(String(fd.get("valueMaps") || "{}"));
    for (const key of ["account", "manba"]) {
      const m = (raw as Record<string, unknown>)?.[key];
      if (m && typeof m === "object") maps[key] = Object.fromEntries(Object.entries(m).filter((e): e is [string, string] => typeof e[1] === "string" && e[1].trim() !== ""));
    }
  } catch { return { error: "Excel ma'lumotlari o'qilmadi" }; }
  if (!Array.isArray(rows)) return { error: "Excel ma'lumotlari o'qilmadi" };
  const list = rows.filter((x): x is CashImportRow => !!x && typeof x === "object" && !Array.isArray(x));

  const res = await importCashEntries(list, { defaultAccountId: String(fd.get("cashAccountId") ?? ""), maps }, s.userId);
  if ("error" in res) return { error: res.error };
  if (!res.added && !res.transfers) return { error: `Yangi qator yo'q: faylning ${res.skipped} ta qatori Kassa jurnalida allaqachon bor` };

  revalidatePath("/payments"); revalidatePath("/cashflow"); revalidatePath("/"); revalidatePath("/moliya", "layout");
  redirect(`/payments?tab=kassa&from=${isoDate(res.from)}&to=${isoDate(res.to)}&import=${res.added}-${res.skipped}-${res.transfers}-${res.newSubs.length}-${res.newTops.length}`);
}

/**
 * «Oy oxiri qoldiqlari» (Exceldan o'tish): `oy` (YYYY-MM) oxiriga har hisob uchun kiritilgan qoldiq hisobning
 * boshlang'ich qoldig'i bo'lib yoziladi yoki tahrirlanadi (`setCashBalanceAt`). Bo'sh maydon — hisobga tegilmaydi.
 * Hisoblar bir-biridan mustaqil: biri xato bersa, qolganlari saqlanadi va xabarda ikkalasi aytiladi.
 */
export async function saveMonthEndBalances(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("payments", "balance");
  const day = monthEndDate(String(fd.get("oy") ?? ""));
  if (!day) return { error: "Oy tanlanmagan yoki hali tugamagan — faqat o'tgan oy oxiriga qoldiq kiritiladi" };
  const accounts = await db.cashAccount.findMany({ where: { isActive: true }, orderBy: [{ type: "asc" }, { name: "asc" }], select: { id: true, name: true } });
  const entries: { id: string; name: string; value: number }[] = [];
  for (const a of accounts) {
    const raw = String(fd.get(`bal_${a.id}`) ?? "").replace(/\s/g, "").replace(",", ".");
    if (!raw) continue;
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0) return { error: `${a.name}: qoldiq raqam bo'lsin (0 yoki musbat)` };
    if (value > MAX_AMOUNT) return { error: `${a.name}: summa juda katta` };
    entries.push({ id: a.id, name: a.name, value });
  }
  if (!entries.length) return { error: "Hech bir hisobga qoldiq yozilmadi" };

  const saved: string[] = [], failed: string[] = [];
  for (const e of entries) {
    const r = await setCashBalanceAt(e.id, day, e.value, s.userId);
    if (r.error) failed.push(`${e.name}: ${r.error}`);
    else saved.push(e.name);
  }
  if (saved.length) {
    revalidatePath("/payments"); revalidatePath("/cashflow"); revalidatePath("/settings/boshlangich-qoldiq"); revalidatePath("/");
  }
  const when = `${String(day.getUTCDate()).padStart(2, "0")}.${String(day.getUTCMonth() + 1).padStart(2, "0")}.${day.getUTCFullYear()}`;
  if (failed.length) return { error: `${failed.join(". ")}${saved.length ? `. Saqlandi: ${saved.join(", ")}` : ""}` };
  return { ok: true, note: `${when} holatiga qoldiq saqlandi: ${saved.join(", ")}` };
}

/**
 * Noto'g'ri yuklangan partiyani qaytarish: qatorlar va ular yozgan kirimlar o'chadi.
 * Buxgalteriya/moliya — har qanday partiyani; kassir — faqat o'zi yuklaganini.
 */
export async function deleteImportBatch(batch: string): Promise<ActionState> {
  const s = await requireAction("payments", "import");
  if (s.role === "CASHIER") {
    const other = await db.salesRegister.count({ where: { batch, createdById: { not: s.userId } } });
    if (other) return { error: "Bu partiyani boshqa xodim yuklagan — buxgalteriya qaytaradi" };
  }
  const r = await deleteRegisterBatch(batch, s.userId);
  if (r.error) return { error: r.error };
  if (!r.rows) return { error: "Partiya topilmadi yoki allaqachon qaytarilgan" };
  revalidatePath("/payments"); revalidatePath("/cashflow"); revalidatePath("/customers"); revalidatePath("/");
  return { ok: true, note: `Qaytarildi: ${r.rows} qator, ${r.payments} kirim` };
}
