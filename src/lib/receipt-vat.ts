import { db } from "./db";
import type { Prisma } from "@/generated/prisma";
import { NDS_RATE } from "./nds";

/**
 * Kirim (xarid) QQS'i — O'zbekiston QQS 12%. Yagona qoida, kirim summasi hisoblanadigan hamma joy shundan oladi.
 *
 * Kelishuv (`GoodsReceiptItem`):
 *  · `price`     — birlik narxi QQS'SIZ;
 *  · `vatRate`   — 0 yoki 12 (yetkazuvchi QQS to'lovchisi bo'lsa 12, aks holda 0);
 *  · `vatAmount` — qator QQS summasi (so'm).
 *  To'lanadigan summa (yetkazuvchi qarzi, to'lov qoldig'i, kreditorka) = Σ(qty × price + vatAmount).
 *
 * Sklad tannarxi (`StockMove.unitCost`) kirim paytida bir marta yoziladi:
 *  · korxona QQS to'lovchisi (`CompanySettings.vatPayer`) — QQS'siz narx (kirim QQS'i byudjetdan qaytariladi);
 *  · QQS to'lovchisi emas — QQS bilan narx (QQS xarajat bo'lib tannarxga kiradi).
 * O'rtacha tannarx, ishlab chiqarish tannarxi va hisobotlar `StockMove.unitCost` dan o'qiydi — alohida qoida kerak emas.
 *
 * Eski kirimlar (20261005120000_kirim_qqs migratsiyasidan oldingi) vatRate = 0, vatAmount = 0 — summalari o'zgarmaydi.
 */

/** Ruxsat etilgan stavkalar, %. */
export const VAT_RATES = [0, 12] as const;
export type VatRate = (typeof VAT_RATES)[number];
/** Standart stavka (QQS to'lovchisi yetkazuvchi uchun), % — `lib/nds.ts` dagi 12% bilan bir xil. */
export const VAT_RATE_DEFAULT: VatRate = Math.round(NDS_RATE * 100) as VatRate;

type Num = Prisma.Decimal | number | string | null | undefined;
type Client = Prisma.TransactionClient | typeof db;

const r2 = (n: number) => Math.round(n * 100) / 100;
const n = (v: Num) => Number(v ?? 0);

export const isVatRate = (v: number): v is VatRate => (VAT_RATES as readonly number[]).includes(v);
/** Yetkazuvchi uchun standart stavka: QQS to'lovchisi — 12, aks holda 0. */
export const supplierVatRate = (supplierVatPayer: boolean): VatRate => (supplierVatPayer ? VAT_RATE_DEFAULT : 0);

/** QQS'siz birlik narxidan qator QQS summasi: 10 × 1 000 000 × 12% = 1 200 000. */
export const vatForLine = (qty: number, price: number, rate: number) => r2((qty * price * rate) / 100);

/**
 * QQS bilan birlik narxini ajratadi (Excel'da "narx QQS bilan", ta'minotdagi to'lanadigan narx):
 * price = brutto / 1.12 (tiyinga yaxlitlab), vatAmount = qty × brutto − qty × price — shunda qator jami
 * fayldagi / to'langan summaga tiyinigacha teng chiqadi.
 */
export function splitGross(qty: number, grossPrice: number, rate: number): { price: number; vatAmount: number } {
  if (!rate) return { price: grossPrice, vatAmount: 0 };
  const price = r2(grossPrice / (1 + rate / 100));
  return { price, vatAmount: Math.max(0, r2(r2(qty * grossPrice) - r2(qty * price))) };
}

export type VatLine = { qty: Num; price: Num; vatAmount?: Num };
/** Qator summasi QQS'siz. */
export const lineBase = (i: VatLine) => n(i.qty) * n(i.price);
/** Qator QQS summasi. */
export const lineVat = (i: VatLine) => n(i.vatAmount);
/** Qator to'lanadigan summasi (QQS bilan). */
export const lineTotal = (i: VatLine) => lineBase(i) + lineVat(i);
/** Qator xarajat (tannarx) summasi: QQS to'lovchisi korxonada QQS'siz, aks holda QQS bilan — xarajat hisobotlari uchun. */
export const lineCost = (i: VatLine, vatPayer: boolean) => (vatPayer ? lineBase(i) : lineTotal(i));

/** Kirim hujjati bo'yicha: QQS'siz, QQS va to'lanadigan jami (tiyinga yaxlitlangan). */
export function receiptAmounts(items: VatLine[]): { base: number; vat: number; total: number } {
  const base = r2(items.reduce((s, i) => s + lineBase(i), 0));
  const vat = r2(items.reduce((s, i) => s + lineVat(i), 0));
  return { base, vat, total: r2(base + vat) };
}
/** Kirim hujjatining to'lanadigan summasi (QQS bilan) — qarz, to'lov qoldig'i, hisobotlar. */
export const receiptTotal = (items: VatLine[]) => receiptAmounts(items).total;

/** Korxona QQS to'lovchisimi (Sozlamalar; yozuv bo'lmasa — standart true). */
export async function companyVatPayer(client: Client = db): Promise<boolean> {
  const c = await client.companySettings.findUnique({ where: { id: "main" }, select: { vatPayer: true } });
  return c?.vatPayer ?? true;
}

/**
 * Sklad tannarxi (StockMove.unitCost) — kirim qatoridan: QQS to'lovchisi korxonada QQS'siz,
 * aks holda QQS birlikka bo'lib qo'shiladi.
 */
export function stockUnitCost(line: { qty: number; price: number; vatAmount: number }, vatPayer: boolean): number {
  if (vatPayer || !line.vatAmount || !(line.qty > 0)) return line.price;
  return r2(line.price + line.vatAmount / line.qty);
}

/**
 * Kirim qatorlarini yozishga tayyorlaydi: stavka, QQS summasi va sklad tannarxi.
 * `gross` — narx QQS bilan berilgan (Excel "narx QQS bilan", ta'minot zanjiri): QQS ichidan ajratiladi.
 */
export function vatLine(qty: number, price: number, rate: VatRate, vatPayer: boolean, gross = false) {
  const s = gross ? splitGross(qty, price, rate) : { price: r2(price), vatAmount: vatForLine(qty, r2(price), rate) };
  return { qty, price: s.price, vatRate: rate, vatAmount: s.vatAmount, unitCost: stockUnitCost({ qty, price: s.price, vatAmount: s.vatAmount }, vatPayer) };
}

// ───────────────────────── Kirim QQS reyestri (buxgalteriya) ─────────────────────────

export type InputVatRow = { key: string; label: string; docs: number; base: number; vat: number; total: number };
export type InputVatReport = {
  from: Date; to: Date;
  months: InputVatRow[]; // oy bo'yicha (YYYY-MM)
  suppliers: (InputVatRow & { inn: string | null; vatPayer: boolean })[]; // yetkazuvchi bo'yicha
  docs: { id: string; docNo: string; date: Date; supplier: string; inn: string | null; base: number; vat: number; total: number }[];
  totals: { docs: number; base: number; vat: number; total: number };
};

const TZ_MS = 5 * 3_600_000; // Toshkent (UTC+5) — oy chegarasi mahalliy vaqt bo'yicha
const monthKey = (d: Date) => new Date(d.getTime() + TZ_MS).toISOString().slice(0, 7);

/**
 * Kirim QQS reyestri: davr (sana bo'yicha, `to` kirmaydi) ichidagi storno qilinmagan kirimlar —
 * oy va yetkazuvchi kesimida QQS'siz summa, QQS va jami. Storno qilingan kirim reyestrga kirmaydi
 * (QQS'i ham qaytariladi). Eski (QQS'siz yozilgan) kirimlar QQS = 0 bo'lib ko'rinadi.
 */
export async function inputVatReport(from: Date, to: Date): Promise<InputVatReport> {
  const recs = await db.goodsReceipt.findMany({
    where: { cancelledAt: null, date: { gte: from, lt: to } },
    orderBy: { date: "asc" },
    select: { id: true, docNo: true, date: true, supplierId: true, supplier: { select: { name: true, inn: true, vatPayer: true } }, items: { select: { qty: true, price: true, vatAmount: true } } },
  });
  const months = new Map<string, InputVatRow>();
  const sups = new Map<string, InputVatRow & { inn: string | null; vatPayer: boolean }>();
  const docs: InputVatReport["docs"] = [];
  const add = (row: InputVatRow, a: { base: number; vat: number; total: number }) => { row.docs++; row.base += a.base; row.vat += a.vat; row.total += a.total; };
  for (const r of recs) {
    const a = receiptAmounts(r.items);
    const mk = monthKey(r.date);
    if (!months.has(mk)) months.set(mk, { key: mk, label: mk, docs: 0, base: 0, vat: 0, total: 0 });
    add(months.get(mk)!, a);
    if (!sups.has(r.supplierId)) sups.set(r.supplierId, { key: r.supplierId, label: r.supplier.name, inn: r.supplier.inn, vatPayer: r.supplier.vatPayer, docs: 0, base: 0, vat: 0, total: 0 });
    add(sups.get(r.supplierId)!, a);
    docs.push({ id: r.id, docNo: r.docNo, date: r.date, supplier: r.supplier.name, inn: r.supplier.inn, ...a });
  }
  const fix = <T extends InputVatRow>(x: T): T => ({ ...x, base: r2(x.base), vat: r2(x.vat), total: r2(x.total) });
  return {
    from, to,
    months: [...months.values()].map(fix).sort((a, b) => a.key.localeCompare(b.key)),
    suppliers: [...sups.values()].map(fix).sort((a, b) => b.vat - a.vat || b.total - a.total),
    docs: docs.reverse(),
    totals: { docs: recs.length, base: r2(docs.reduce((s, d) => s + d.base, 0)), vat: r2(docs.reduce((s, d) => s + d.vat, 0)), total: r2(docs.reduce((s, d) => s + d.total, 0)) },
  };
}
