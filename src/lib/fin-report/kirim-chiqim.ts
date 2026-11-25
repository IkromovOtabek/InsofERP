import { db } from "@/lib/db";
import { txSign } from "@/lib/cash-tx";
import type { CashAccountType, Prisma } from "@/generated/prisma";
import { type MonthKey, monthDiff, monthKeyOf, monthRange } from "./period";

/**
 * Tahlil → Moliya → «Kirim-chiqim jamlanmasi»: davrdagi pul kirimi va chiqimi manba → sub manba kesimida.
 *  - kirim: kassa kirimlari (`CashTransaction` INCOME) + mijoz to'lovlari (`Payment`) — «Savdo tushumi → Mijoz to'lovlari»;
 *  - chiqim: kassa chiqimlari (EXPENSE);
 *  - hisoblararo o'tkazma (perekit) va boshlang'ich qoldiq kirim ham, chiqim ham emas — faqat hisoblar blokida;
 *  - bekor qilingan yozuvlar kirmaydi.
 * DDS'dan farqi: joriy / moliyaviy / investitsion bo'linmasdan, kassa jurnalidagi manba nomlari bilan oddiy jamlanma.
 */
export type KcFilter = { from: Date; to: Date; prevFrom: Date; prevTo: Date; accountId?: string; method?: CashAccountType };
export type KcLine = { name: string; total: number; count: number; months: number[] };
export type KcGroup = KcLine & { subs: KcLine[] };
export type KcAccount = { id: string; name: string; type: CashAccountType; open: number; inn: number; out: number; other: number; close: number };
export type KcParty = { name: string; total: number; count: number };
export type KirimChiqim = {
  /** Oy ustunlari — davr bir necha oyni (≤ 12) qamrasa; bitta oy bo'lsa bo'sh */
  months: MonthKey[];
  income: KcGroup[];
  expense: KcGroup[];
  totals: { inn: number; out: number; prevIn: number; prevOut: number; count: number };
  accounts: KcAccount[];
  topIn: KcParty[];
  topOut: KcParty[];
  /** Kunlik (yoki oylik) kirim / chiqim — KPI kartasidagi chiziqcha */
  trend: { inn: number[]; out: number[] };
};

export const SALES_LINE = "Savdo tushumi";
export const PAYMENTS_SUB = "Mijoz to'lovlari";
const NO_SUB = "Sub manbasiz";
const NO_PARTY = "Ko'rsatilmagan";
const DAY = 86400000;

type Item = { date: Date; amount: number; category: string; sub: string; party: string };

function accountWhere(f: KcFilter): Prisma.CashAccountWhereInput | undefined {
  if (f.accountId) return { id: f.accountId };
  if (f.method) return { type: f.method };
  return undefined;
}

/** Manba → sub manba daraxti, kamayish tartibida. */
function groupBy(items: Item[], col: (d: Date) => number | undefined, n: number): KcGroup[] {
  const map = new Map<string, KcGroup>();
  for (const it of items) {
    let g = map.get(it.category);
    if (!g) map.set(it.category, (g = { name: it.category, total: 0, count: 0, months: Array(n).fill(0), subs: [] }));
    let s = g.subs.find((x) => x.name === it.sub);
    if (!s) g.subs.push((s = { name: it.sub, total: 0, count: 0, months: Array(n).fill(0) }));
    const i = col(it.date);
    for (const x of [g, s]) {
      x.total += it.amount; x.count += 1;
      if (i !== undefined) x.months[i]! += it.amount;
    }
  }
  const out = [...map.values()].sort((a, b) => b.total - a.total);
  out.forEach((g) => g.subs.sort((a, b) => b.total - a.total));
  return out;
}

function topParties(items: Item[], limit = 10): KcParty[] {
  const map = new Map<string, KcParty>();
  for (const it of items) {
    const p = map.get(it.party) ?? { name: it.party, total: 0, count: 0 };
    p.total += it.amount; p.count += 1;
    map.set(it.party, p);
  }
  return [...map.values()].filter((p) => p.name !== NO_PARTY).sort((a, b) => b.total - a.total).slice(0, limit);
}

const r2 = (v: number) => Math.round(v * 100) / 100;

export async function kirimChiqim(f: KcFilter): Promise<KirimChiqim> {
  const acc = accountWhere(f);
  const inRange = { gte: f.from, lt: f.to };
  const flowTypes = { in: ["INCOME", "EXPENSE"] as ("INCOME" | "EXPENSE")[] };

  const [txs, pays, accounts, txBefore, payBefore, txOther, prevTx, prevPay] = await Promise.all([
    db.cashTransaction.findMany({
      where: { cancelledAt: null, date: inRange, type: flowTypes, ...(acc ? { cashAccount: acc } : {}) },
      select: {
        date: true, type: true, amount: true, category: true, subCategory: true, counterparty: true,
        customer: { select: { name: true } }, supplier: { select: { name: true } }, employee: { select: { fullName: true } },
        brigade: { select: { name: true } }, team: { select: { name: true } },
      },
    }),
    db.payment.findMany({
      where: { date: inRange, ...(acc ? { cashAccount: acc } : {}) },
      select: { date: true, amount: true, customer: { select: { name: true } } },
    }),
    db.cashAccount.findMany({ where: { ...(acc ?? {}), isActive: true }, select: { id: true, name: true, type: true }, orderBy: [{ type: "asc" }, { name: "asc" }] }),
    db.cashTransaction.groupBy({ by: ["cashAccountId", "type"], where: { cancelledAt: null, date: { lt: f.from }, ...(acc ? { cashAccount: acc } : {}) }, _sum: { amount: true } }),
    db.payment.groupBy({ by: ["cashAccountId"], where: { date: { lt: f.from }, ...(acc ? { cashAccount: acc } : {}) }, _sum: { amount: true } }),
    // Davr ichidagi o'tkazma va boshlang'ich qoldiq yozuvlari — faqat hisob qoldig'iga
    db.cashTransaction.groupBy({ by: ["cashAccountId", "type"], where: { cancelledAt: null, date: inRange, type: { notIn: ["INCOME", "EXPENSE"] }, ...(acc ? { cashAccount: acc } : {}) }, _sum: { amount: true } }),
    db.cashTransaction.groupBy({ by: ["type"], where: { cancelledAt: null, date: { gte: f.prevFrom, lt: f.prevTo }, type: flowTypes, ...(acc ? { cashAccount: acc } : {}) }, _sum: { amount: true } }),
    db.payment.aggregate({ where: { date: { gte: f.prevFrom, lt: f.prevTo }, ...(acc ? { cashAccount: acc } : {}) }, _sum: { amount: true } }),
  ]);

  // Ustunlar: davr 2–12 oy bo'lsa oyma-oy, aks holda faqat jami
  const lastDay = new Date(f.to.getTime() - 1);
  const span = monthDiff(monthKeyOf(f.from), monthKeyOf(lastDay)) + 1;
  let months = span >= 2 && span <= 12 ? monthRange(monthKeyOf(f.from), span) : [];
  // Boshidagi yozuvsiz oylar ustun bo'lmaydi («Yil boshidan» — tizim kuzda ishga tushgan bo'lsa yanvar–avgust bo'sh)
  if (months.length) {
    const used = new Set([...txs.map((t) => monthKeyOf(t.date)), ...pays.map((p) => monthKeyOf(p.date))]);
    const first = months.findIndex((m) => used.has(m));
    months = first < 0 ? [] : months.slice(first);
    if (months.length < 2) months = [];
  }
  const mIdx = new Map(months.map((m, i) => [m, i]));
  const col = (d: Date) => mIdx.get(monthKeyOf(d));

  const incomeItems: Item[] = [], expenseItems: Item[] = [];
  for (const t of txs) {
    const party = t.customer?.name ?? t.supplier?.name ?? t.employee?.fullName ?? t.brigade?.name ?? t.team?.name ?? (t.counterparty?.trim() || NO_PARTY);
    const it: Item = { date: t.date, amount: Number(t.amount), category: t.category || "Manbasiz", sub: t.subCategory || NO_SUB, party };
    (t.type === "INCOME" ? incomeItems : expenseItems).push(it);
  }
  for (const p of pays) incomeItems.push({ date: p.date, amount: Number(p.amount), category: SALES_LINE, sub: PAYMENTS_SUB, party: p.customer.name });

  const inn = incomeItems.reduce((s, x) => s + x.amount, 0);
  const out = expenseItems.reduce((s, x) => s + x.amount, 0);
  const prevIn = Number(prevTx.find((x) => x.type === "INCOME")?._sum.amount ?? 0) + Number(prevPay._sum.amount ?? 0);
  const prevOut = Number(prevTx.find((x) => x.type === "EXPENSE")?._sum.amount ?? 0);

  // Hisoblar: boshlang'ich qoldiq (davrdan oldingi hamma yozuv), kirim, chiqim, o'tkazma/boshlang'ich, yakuniy
  const accRows: KcAccount[] = accounts.map((a) => {
    const open = txBefore.filter((x) => x.cashAccountId === a.id).reduce((s, x) => s + txSign(x.type) * Number(x._sum.amount ?? 0), 0)
      + Number(payBefore.find((x) => x.cashAccountId === a.id)?._sum.amount ?? 0);
    const other = txOther.filter((x) => x.cashAccountId === a.id).reduce((s, x) => s + txSign(x.type) * Number(x._sum.amount ?? 0), 0);
    return { id: a.id, name: a.name, type: a.type, open: r2(open), inn: 0, out: 0, other: r2(other), close: 0 };
  });
  const accById = new Map(accRows.map((a) => [a.id, a]));
  const flowByAcc = await db.cashTransaction.groupBy({ by: ["cashAccountId", "type"], where: { cancelledAt: null, date: inRange, type: flowTypes, ...(acc ? { cashAccount: acc } : {}) }, _sum: { amount: true } });
  const payByAcc = await db.payment.groupBy({ by: ["cashAccountId"], where: { date: inRange, ...(acc ? { cashAccount: acc } : {}) }, _sum: { amount: true } });
  for (const x of flowByAcc) {
    const a = accById.get(x.cashAccountId); if (!a) continue;
    if (x.type === "INCOME") a.inn += Number(x._sum.amount ?? 0); else a.out += Number(x._sum.amount ?? 0);
  }
  for (const x of payByAcc) { const a = accById.get(x.cashAccountId); if (a) a.inn += Number(x._sum.amount ?? 0); }
  for (const a of accRows) { a.inn = r2(a.inn); a.out = r2(a.out); a.close = r2(a.open + a.inn - a.out + a.other); }

  // Chiziqcha: oyma-oy (ko'p oy) yoki kunma-kun
  const days = Math.max(1, Math.round((f.to.getTime() - f.from.getTime()) / DAY));
  const buckets = months.length ? months.length : Math.min(days, 62);
  const bucket = (d: Date) => months.length ? col(d) : Math.min(buckets - 1, Math.floor((d.getTime() - f.from.getTime()) / DAY));
  const trend = { inn: Array(buckets).fill(0) as number[], out: Array(buckets).fill(0) as number[] };
  for (const x of incomeItems) { const i = bucket(x.date); if (i !== undefined && i >= 0) trend.inn[i]! += x.amount; }
  for (const x of expenseItems) { const i = bucket(x.date); if (i !== undefined && i >= 0) trend.out[i]! += x.amount; }

  return {
    months,
    income: groupBy(incomeItems, col, months.length),
    expense: groupBy(expenseItems, col, months.length),
    totals: { inn: r2(inn), out: r2(out), prevIn: r2(prevIn), prevOut: r2(prevOut), count: incomeItems.length + expenseItems.length },
    accounts: accRows,
    topIn: topParties(incomeItems),
    topOut: topParties(expenseItems),
    trend,
  };
}
