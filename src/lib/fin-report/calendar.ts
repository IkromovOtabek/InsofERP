import { db } from "@/lib/db";
import { txSign } from "@/lib/cash-tx";
import { goLiveDate } from "@/lib/bi/core";
import { unpaidReceipts } from "@/lib/receipt-payables";
import { supplierOpeningDues } from "@/lib/opening-balances";
import type { PnlLine } from "@/generated/prisma";
import { loadCategories, makeResolver } from "./categories";
import { pnlReport } from "./pnl";
import { addMonths, monthKeyOf, monthLabel } from "./period";
import { r2 } from "./rows";

/**
 * To'lov kalendari — bugundan 30 kun oldinga har kun pul qoldig'i prognozi («Insof 2026» → «To'lov kalendari»):
 *
 *   KIRIM   odatiy tushum = oxirgi 30 kun (yoki tizimga o'tgandan beri) o'rtacha kunlik tushum × reja koeffitsiyenti
 *           (mijoz to'lovlari + joriy faoliyat kirimlari; kredit olish kabi moliyaviy kirim kirmaydi)
 *           va'da qilingan = zayavka bosh to'lovi so'rovlari (PaymentRequest, muddati bo'yicha) + qo'lda kiritilgan kirimlar
 *   CHIQIM  ta'minotchilar = to'lanmagan kirim hujjati (kirim sanasi + to'lov muddati), boshlang'ich qarz,
 *           moliya tasdig'ini kutayotgan ta'minot zayavkalari (kerak bo'lgan sana)
 *           majburiy = doimiy oylik to'lovlar (o'z kunida) + qo'lda kiritilgan bir martalik chiqimlar
 *           kundalik = oxirgi 30 kun o'rtacha kunlik xarajat (zavod, transport, ofis…): xom-ashyo, soliq, kredit,
 *           divident, loyiha va doimiy to'lovlar kategoriyalari kirmaydi (ular yuqorida alohida)
 * Muddati o'tgan narsa bugungi kunga tushadi. Bugungi kun prognozidan bugun allaqachon tushgan/chiqqani ayiriladi.
 */
export const CAL_DAYS = 30;
const DAY = 86_400_000;

export type CalKind = "SUPPLIER" | "SUPPLY" | "RECURRING" | "PLANNED_OUT" | "PLANNED_IN" | "PREPAY";
export const CAL_KIND_LABEL: Record<CalKind, string> = {
  SUPPLIER: "Ta'minotchi", SUPPLY: "Ta'minot zayavkasi", RECURRING: "Majburiy", PLANNED_OUT: "Rejalashtirilgan", PLANNED_IN: "Va'da qilingan", PREPAY: "Zayavka avansi",
};
const OUT_KINDS: CalKind[] = ["SUPPLIER", "SUPPLY", "RECURRING", "PLANNED_OUT"];

export type CalItem = { day: number; date: Date; kind: CalKind; who: string; what: string; amount: number; overdue: boolean; href?: string };
export type CalDay = { date: Date; inForecast: number; inPromised: number; outSupplier: number; outMandatory: number; outDaily: number; net: number; balance: number };
export type SupplierDue = { supplierId: string; name: string; termDays: number; debt: number; overdue: number; due30: number; later: number };
export type DailyRow = { category: string; sum: number; perDay: number };

export type CashCalendar = {
  today: Date; start: number; days: CalDay[]; items: CalItem[];
  min: { balance: number; date: Date }; totals: { inForecast: number; inPromised: number; outSupplier: number; outMandatory: number; outDaily: number; net: number };
  perDayIn: number; perDayOut: number; histDays: number; factor: number; dailyRows: DailyRow[]; suppliers: SupplierDue[];
  dividend: { month: string; profit: number; pct: number; limit: number; taken: number; left: number; prevTaken: number };
};

export const startOfDay = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY);
const daysInMonth = (y: number, m: number) => new Date(y, m + 1, 0).getDate();

/** Doimiy to'lov sanalari [from, to) oralig'ida: kun oyning oxiridan katta bo'lsa — oyning oxirgi kuni. */
export function recurringDates(dayOfMonth: number, from: Date, to: Date): Date[] {
  const out: Date[] = [];
  for (let y = from.getFullYear(), m = from.getMonth(); new Date(y, m, 1) < to; m++) {
    if (m > 11) { m = 0; y++; }
    const d = new Date(y, m, Math.min(Math.max(1, dayOfMonth), daysInMonth(y, m)));
    if (d >= from && d < to) out.push(d);
  }
  return out;
}

/** Kundalik xarajatga kiradigan PNL qatorlari — qolganlari (xom-ashyo, soliq, kredit, divident, loyiha) alohida yoki prognozga kirmaydi. */
const DAILY_LINES = new Set<PnlLine>(["PRODUCTION", "PAYROLL", "TRANSPORT", "ADMIN", "COMMERCIAL"]);

export async function cashCalendar(now: Date = new Date()): Promise<CashCalendar> {
  const today = startOfDay(now), end = addDays(today, CAL_DAYS), tomorrow = addDays(today, 1);
  const live = await goLiveDate();
  const histFrom = live && live > addDays(today, -30) ? live : addDays(today, -30);
  const histDays = Math.max(1, Math.round((today.getTime() - histFrom.getTime()) / DAY));
  const curMonth = monthKeyOf(today), prevMonth = addMonths(curMonth, -1);

  const [settings, nodes, txBal, payBal, histTx, histPay, todayTx, todayPay, recurring, planned, prepay, unpaid, openings, supply, suppliers, prevPnl, divTx] = await Promise.all([
    db.companySettings.findUnique({ where: { id: "main" }, select: { supplierPaymentDays: true, cashPlanFactor: true, dividendPct: true } }),
    loadCategories(),
    db.cashTransaction.groupBy({ by: ["cashAccountId", "type"], where: { cancelledAt: null }, _sum: { amount: true } }),
    db.payment.aggregate({ _sum: { amount: true } }),
    db.cashTransaction.findMany({ where: { cancelledAt: null, type: { in: ["INCOME", "EXPENSE"] }, date: { gte: histFrom, lt: today } }, select: { type: true, amount: true, category: true, subCategory: true, refType: true } }),
    db.payment.aggregate({ where: { date: { gte: histFrom, lt: today } }, _sum: { amount: true } }),
    db.cashTransaction.findMany({ where: { cancelledAt: null, type: { in: ["INCOME", "EXPENSE"] }, date: { gte: today, lt: tomorrow } }, select: { type: true, amount: true, category: true, subCategory: true, refType: true } }),
    db.payment.aggregate({ where: { date: { gte: today, lt: tomorrow } }, _sum: { amount: true } }),
    db.recurringPayment.findMany({ where: { isActive: true, cancelledAt: null }, orderBy: { dayOfMonth: "asc" } }),
    db.plannedFlow.findMany({ where: { status: "PLANNED", date: { lt: end } }, orderBy: { date: "asc" } }),
    db.paymentRequest.findMany({ where: { status: { in: ["PENDING", "PARTIAL"] }, dueDate: { lt: end } }, select: { id: true, docNo: true, amount: true, received: true, dueDate: true, customer: { select: { name: true } } } }),
    unpaidReceipts(),
    supplierOpeningDues(),
    db.supplyRequest.findMany({ where: { status: "APPROVED" }, select: { id: true, docNo: true, needBy: true, deliveryCost: true, supplier: { select: { name: true } }, items: { select: { qty: true, price: true } } } }),
    db.supplier.findMany({ select: { id: true, name: true, paymentTermDays: true } }),
    pnlReport([prevMonth], "accrual"),
    db.cashTransaction.findMany({ where: { type: "EXPENSE", cancelledAt: null, date: { gte: new Date(today.getFullYear(), today.getMonth() - 1, 1), lt: tomorrow } }, select: { date: true, amount: true, category: true, subCategory: true } }),
  ]);
  const resolve = makeResolver(nodes);
  const defTerm = settings?.supplierPaymentDays ?? 7;
  const factor = Number(settings?.cashPlanFactor ?? 1);
  const recurringCats = new Set(recurring.map((r) => resolve(r.category)?.top.id).filter(Boolean));

  // ── Hozirgi pul (barcha hisoblar) ──
  const start = r2(txBal.reduce((s, g) => s + txSign(g.type) * Number(g._sum.amount ?? 0), 0) + Number(payBal._sum.amount ?? 0));

  // ── O'rtacha kunlik tushum va kundalik xarajat ──
  const isOperatingIn = (t: { category: string; subCategory: string | null }) => { const r = resolve(t.category, t.subCategory); return !r || r.top.flow === "OPERATING"; };
  const dailyCat = (t: { category: string; subCategory: string | null; refType: string | null }) => {
    if (t.refType === "GoodsReceipt" || t.refType === "SupplyRequest") return null; // ta'minotchi to'lovi — alohida qator
    const r = resolve(t.category, t.subCategory);
    if (!r) return t.category; // aniqlanmagan — ehtiyot uchun kundalikka
    if (!DAILY_LINES.has(r.top.pnlLine) || recurringCats.has(r.top.id)) return null;
    return r.top.name;
  };
  const sumIn = (rows: typeof histTx) => rows.filter((t) => t.type === "INCOME" && isOperatingIn(t)).reduce((s, t) => s + Number(t.amount), 0);
  const perDayIn = r2(((Number(histPay._sum.amount ?? 0) + sumIn(histTx)) / histDays) * factor);
  const dailyMap = new Map<string, number>();
  for (const t of histTx) { if (t.type !== "EXPENSE") continue; const c = dailyCat(t); if (c) dailyMap.set(c, (dailyMap.get(c) ?? 0) + Number(t.amount)); }
  const dailyRows: DailyRow[] = [...dailyMap.entries()].map(([category, s]) => ({ category, sum: r2(s), perDay: r2(s / histDays) })).sort((a, b) => b.sum - a.sum);
  const perDayOut = r2(dailyRows.reduce((s, r) => s + r.perDay, 0));
  const inToday = Number(todayPay._sum.amount ?? 0) + sumIn(todayTx);
  const outTodayDaily = todayTx.filter((t) => t.type === "EXPENSE" && dailyCat(t)).reduce((s, t) => s + Number(t.amount), 0);

  // ── Ro'yxat: kunlarga taqsimlanadigan aniq summalar ──
  const items: CalItem[] = [];
  const dayIdx = (d: Date) => Math.max(0, Math.floor((startOfDay(d).getTime() - today.getTime()) / DAY));
  const push = (date: Date, kind: CalKind, who: string, what: string, amount: number, href?: string) => {
    if (!(amount > 0.004)) return;
    const overdue = startOfDay(date) < today;
    const d = overdue ? today : startOfDay(date);
    if (d >= end) return;
    items.push({ day: dayIdx(d), date: d, kind, who, what, amount: r2(amount), overdue, href });
  };
  const termOf = new Map(suppliers.map((s) => [s.id, s.paymentTermDays ?? defTerm]));
  const supName = new Map(suppliers.map((s) => [s.id, s.name]));
  const supDue = new Map<string, SupplierDue>();
  const sd = (id: string) => {
    let x = supDue.get(id);
    if (!x) supDue.set(id, (x = { supplierId: id, name: supName.get(id) ?? "—", termDays: termOf.get(id) ?? defTerm, debt: 0, overdue: 0, due30: 0, later: 0 }));
    return x;
  };
  for (const r of unpaid) {
    const due = addDays(startOfDay(r.date), termOf.get(r.supplierId) ?? defTerm);
    push(due, "SUPPLIER", r.supplier, `${r.docNo} · ${String(r.date.getDate()).padStart(2, "0")}.${String(r.date.getMonth() + 1).padStart(2, "0")} kelgan mol`, r.left, `/receipts/${r.id}`);
    const x = sd(r.supplierId);
    x.debt += r.left;
    if (due < today) x.overdue += r.left; else if (due < end) x.due30 += r.left; else x.later += r.left;
  }
  for (const o of openings) {
    if (o.left <= 0.004) continue;
    push(today, "SUPPLIER", supName.get(o.supplierId) ?? "—", "Boshlang'ich qarz (tizimga o'tishdagi)", o.left, `/suppliers/${o.supplierId}`);
    const x = sd(o.supplierId);
    x.debt += o.left; x.overdue += o.left;
  }
  for (const s of supply) {
    const amount = s.items.reduce((a, i) => a + Number(i.qty) * Number(i.price), 0) + Number(s.deliveryCost);
    push(s.needBy ?? today, "SUPPLY", s.supplier?.name ?? "—", `${s.docNo} · moliya tasdig'ini kutmoqda`, amount, `/taminot/${s.id}`);
  }
  for (const r of recurring) for (const d of recurringDates(r.dayOfMonth, today, end)) push(d, "RECURRING", r.name, r.category, Number(r.amount));
  for (const p of planned) push(p.date, p.type === "INCOME" ? "PLANNED_IN" : "PLANNED_OUT", p.counterparty, p.note ?? p.category ?? (p.type === "INCOME" ? "Kutilayotgan tushum" : "Rejalashtirilgan to'lov"), Number(p.amount));
  for (const q of prepay) push(q.dueDate, "PREPAY", q.customer.name, `${q.docNo} · zayavka bosh to'lovi`, Number(q.amount) - Number(q.received), "/pul-qabul");
  items.sort((a, b) => a.day - b.day || b.amount - a.amount);

  // ── Kunlar ──
  const days: CalDay[] = [];
  let bal = start;
  for (let i = 0; i < CAL_DAYS; i++) {
    const its = items.filter((x) => x.day === i);
    const sumK = (ks: CalKind[]) => its.filter((x) => ks.includes(x.kind)).reduce((s, x) => s + x.amount, 0);
    const inForecast = i === 0 ? Math.max(0, perDayIn - inToday) : perDayIn;
    const outDaily = i === 0 ? Math.max(0, perDayOut - outTodayDaily) : perDayOut;
    const inPromised = sumK(["PLANNED_IN", "PREPAY"]), outSupplier = sumK(["SUPPLIER", "SUPPLY"]), outMandatory = sumK(["RECURRING", "PLANNED_OUT"]);
    const net = inForecast + inPromised - outSupplier - outMandatory - outDaily;
    bal += net;
    days.push({ date: addDays(today, i), inForecast: r2(inForecast), inPromised: r2(inPromised), outSupplier: r2(outSupplier), outMandatory: r2(outMandatory), outDaily: r2(outDaily), net: r2(net), balance: r2(bal) });
  }
  const minDay = days.reduce((m, d) => (d.balance < m.balance ? d : m), days[0]!);
  const tot = (f: (d: CalDay) => number) => r2(days.reduce((s, d) => s + f(d), 0));

  // ── Divident limiti: o'tgan oy zavod sof foydasi × foiz − shu oy olingan divident ──
  const profit = prevPnl.rows.find((r) => r.key === "net")?.values[0] ?? 0;
  const pct = Number(settings?.dividendPct ?? 100);
  const limit = r2(Math.max(0, profit) * pct / 100);
  const isDiv = (t: { category: string; subCategory: string | null }) => resolve(t.category, t.subCategory)?.top.pnlLine === "DIVIDEND";
  const curStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const taken = r2(divTx.filter((t) => t.date >= curStart && isDiv(t)).reduce((s, t) => s + Number(t.amount), 0));
  const prevTaken = r2(divTx.filter((t) => t.date < curStart && isDiv(t)).reduce((s, t) => s + Number(t.amount), 0));

  return {
    today, start, days, items,
    min: { balance: minDay.balance, date: minDay.date },
    totals: { inForecast: tot((d) => d.inForecast), inPromised: tot((d) => d.inPromised), outSupplier: tot((d) => d.outSupplier), outMandatory: tot((d) => d.outMandatory), outDaily: tot((d) => d.outDaily), net: tot((d) => d.net) },
    perDayIn, perDayOut, histDays, factor, dailyRows,
    suppliers: [...supDue.values()].map((x) => ({ ...x, debt: r2(x.debt), overdue: r2(x.overdue), due30: r2(x.due30), later: r2(x.later) })).sort((a, b) => b.overdue + b.due30 - (a.overdue + a.due30)),
    dividend: { month: monthLabel(prevMonth), profit: r2(profit), pct, limit, taken, left: r2(limit - taken), prevTaken },
  };
}

export const isOutKind = (k: CalKind) => OUT_KINDS.includes(k);
