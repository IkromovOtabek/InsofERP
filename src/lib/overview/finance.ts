import { db } from "@/lib/db";
import type { CashAccountType, PayrollKind, PayrollStatus } from "@/generated/prisma";
import { balanceFromGroups } from "@/lib/cash-tx";
import { customerBalances } from "@/lib/receivables";
import { unpaidReceipts } from "@/lib/receipt-payables";
import { mechanicCounts } from "@/lib/mechanic-requests";
import { loanBalances, type LoanBalance } from "@/lib/fin-report/loans";
import { supplierPositions } from "@/lib/fin-report/balance";
import { cashCalendar, isOutKind, type CalItem } from "@/lib/fin-report/calendar";
import { pnlReport } from "@/lib/fin-report/pnl";
import { type MonthKey, addMonths, monthDiff, monthKeyOf } from "@/lib/fin-report/period";
import { r2 } from "@/lib/fin-report/rows";

/**
 * Moliya — umumiy ko'rinish (`/moliya/umumiy`): bo'limning asosiy raqamlari bitta joyda, har biri o'z sahifasi bilan bir manbadan:
 *  · hisoblar — Kassa/bank va Kirim-Chiqim qoidasi (`txSign`: mijoz to'lovlari + kirim − chiqim ± o'tkazma), davr boshi/oxiri;
 *  · kirim/chiqim — Kirim-Chiqim sahifasidagidek: kirim = mijoz to'lovlari + INCOME, chiqim = EXPENSE (bekor qilinganlarsiz);
 *  · debitorka — `customerBalances`, kreditorka — `supplierPositions` (Balans va Bosh sahifa «Qarzlar» bloki bilan bir xil);
 *  · kreditlar — `loanBalances`, yaqin to'lovlar — `cashCalendar` (To'lov kalendari), ish haqi — `PayrollRun`,
 *    mexanik so'rovlari — faqat zavod so'rovlari (`mechanicCounts(…, true)`), foyda — `pnlReport` (hisoblangan).
 * Logistika moliyasi (LogisticsAccount / LogisticsTx) — alohida hisob, bu yerga kirmaydi.
 */

export type OverviewAccount = { id: string; name: string; type: CashAccountType; open: number; income: number; expense: number; other: number; close: number };
export type OverviewRun = { id: string; docNo: string; month: string; kind: PayrollKind; status: PayrollStatus; gross: number; net: number; paid: number; left: number };
export type NamedSum = { id: string; name: string; sum: number };

export type FinanceOverview = {
  months: MonthKey[];
  accounts: OverviewAccount[];
  cash: { open: number; close: number; cashClose: number; bankClose: number };
  flow: { payments: number; otherIncome: number; income: number; expense: number; net: number };
  expenseByCat: { category: string; sum: number }[];
  debts: { receivable: number; debtors: number; customerAdvance: number; supplierDebt: number; supplierAdvance: number; topCustomers: NamedSum[]; topSuppliers: NamedSum[] };
  loans: { rows: LoanBalance[]; bank: number; borrowed: number; lent: number };
  calendar: { overdueOut: number; next7Out: number; min: { balance: number; date: Date }; items: CalItem[] };
  payroll: { runs: OverviewRun[]; gross: number; net: number; approved: number; paid: number; toPay: number; waiting: { n: number; net: number }; drafts: number };
  toPay: { mechApproved: { n: number; sum: number }; mechNew: { n: number; sum: number }; receipts: { n: number; sum: number } };
  pnl: { income: number; gross: number; operating: number; net: number };
};

const TOP = 5;
const EXPENSE_TOP = 8;
const num = (v: unknown) => Number(v ?? 0);

/** Davr oylari (`to` — kirmaydi): PNL va ish haqi oylik; eng ko'pi oxirgi 12 oy (PNL sahifasidagi cheklov). */
export function periodMonths(from: Date, to: Date): MonthKey[] {
  const a = monthKeyOf(from), b = monthKeyOf(new Date(to.getTime() - 1));
  const n = Math.min(12, Math.max(1, monthDiff(a, b) + 1));
  return Array.from({ length: n }, (_, i) => addMonths(b, i - n + 1));
}

export async function financeOverview(from: Date, to: Date): Promise<FinanceOverview> {
  const months = periodMonths(from, to);
  const [
    accounts, txBefore, payBefore, txIn, payIn, expenseCats, customers, suppliers, loans, cal, runs, mech, receipts, pnl,
  ] = await Promise.all([
    db.cashAccount.findMany({ orderBy: [{ type: "asc" }, { name: "asc" }], select: { id: true, name: true, type: true, isActive: true } }),
    db.cashTransaction.groupBy({ by: ["cashAccountId", "type"], where: { cancelledAt: null, date: { lt: from } }, _sum: { amount: true } }),
    db.payment.groupBy({ by: ["cashAccountId"], where: { date: { lt: from } }, _sum: { amount: true } }),
    db.cashTransaction.groupBy({ by: ["cashAccountId", "type"], where: { cancelledAt: null, date: { gte: from, lt: to } }, _sum: { amount: true } }),
    db.payment.groupBy({ by: ["cashAccountId"], where: { date: { gte: from, lt: to } }, _sum: { amount: true } }),
    db.cashTransaction.groupBy({ by: ["category"], where: { type: "EXPENSE", cancelledAt: null, date: { gte: from, lt: to } }, _sum: { amount: true } }),
    customerBalances({ asOf: to }),
    supplierPositions(to),
    loanBalances(to),
    cashCalendar(),
    db.payrollRun.findMany({
      where: { month: { in: months }, status: { not: "CANCELLED" } },
      orderBy: [{ month: "desc" }, { createdAt: "desc" }],
      select: { id: true, docNo: true, month: true, kind: true, status: true, gross: true, net: true, paid: true },
    }),
    mechanicCounts(null, true),
    unpaidReceipts(),
    pnlReport(months, "accrual"),
  ]);

  // ── Hisoblar: davr boshi + kirim − chiqim ± (o'tkazma, boshlang'ich qoldiq) = davr oxiri ──
  const paySum = (rows: typeof payBefore, id: string) => num(rows.find((p) => p.cashAccountId === id)?._sum.amount);
  const txSum = (id: string, type: string) => num(txIn.find((t) => t.cashAccountId === id && t.type === type)?._sum.amount);
  const accRows: OverviewAccount[] = accounts.map((a) => {
    const open = r2(balanceFromGroups(txBefore, a.id) + paySum(payBefore, a.id));
    const payments = paySum(payIn, a.id);
    const income = r2(payments + txSum(a.id, "INCOME"));
    const expense = r2(txSum(a.id, "EXPENSE"));
    const other = r2(txSum(a.id, "TRANSFER_IN") - txSum(a.id, "TRANSFER_OUT") + txSum(a.id, "OPENING"));
    return { id: a.id, name: a.name, type: a.type, open, income, expense, other, close: r2(open + income - expense + other) };
  }).filter((a, i) => accounts[i]!.isActive || Math.abs(a.open) >= 1 || Math.abs(a.close) >= 1 || a.income || a.expense);
  const sumA = (f: (a: OverviewAccount) => number, type?: CashAccountType) => r2(accRows.filter((a) => !type || a.type === type).reduce((s, a) => s + f(a), 0));
  const payments = r2(payIn.reduce((s, p) => s + num(p._sum.amount), 0));
  const otherIncome = r2(txIn.filter((t) => t.type === "INCOME").reduce((s, t) => s + num(t._sum.amount), 0));
  const expense = r2(txIn.filter((t) => t.type === "EXPENSE").reduce((s, t) => s + num(t._sum.amount), 0));

  // ── Chiqim kategoriyalar bo'yicha (eng kattalari, qolgani «Boshqalar») ──
  const cats = expenseCats.map((c) => ({ category: c.category, sum: r2(num(c._sum.amount)) })).filter((c) => c.sum > 0).sort((a, b) => b.sum - a.sum);
  const rest = r2(cats.slice(EXPENSE_TOP).reduce((s, c) => s + c.sum, 0));
  const expenseByCat = [...cats.slice(0, EXPENSE_TOP), ...(rest > 0 ? [{ category: "", sum: rest }] : [])];

  // ── Qarzlar: debitorka (mijozlar) va kreditorka (ta'minotchilar) ──
  let receivable = 0, customerAdvance = 0, debtors = 0;
  for (const c of customers.values()) { receivable += c.debt; customerAdvance += c.advance; if (c.debt > 0) debtors++; }
  let supplierDebt = 0, supplierAdvance = 0;
  for (const v of suppliers.values()) { if (v > 0) supplierDebt += v; else supplierAdvance += -v; }
  const topC = [...customers.values()].filter((c) => c.debt > 0).sort((a, b) => b.debt - a.debt).slice(0, TOP);
  const topS = [...suppliers.entries()].filter(([, v]) => v > 0.005).sort((a, b) => b[1] - a[1]).slice(0, TOP);
  const [cNames, sNames] = await Promise.all([
    topC.length ? db.customer.findMany({ where: { id: { in: topC.map((c) => c.customerId) } }, select: { id: true, name: true } }) : [],
    topS.length ? db.supplier.findMany({ where: { id: { in: topS.map(([id]) => id) } }, select: { id: true, name: true } }) : [],
  ]);
  const nameOf = (list: { id: string; name: string }[], id: string) => list.find((x) => x.id === id)?.name ?? "—";

  // ── Kreditlar: davr oxirida ochiq bo'lganlari ──
  const activeLoans = loans.filter((l) => !l.closedAt || l.closedAt >= to);
  const loanSum = (k: LoanBalance["kind"]) => r2(activeLoans.filter((l) => l.kind === k).reduce((s, l) => s + l.balance, 0));

  // ── Ish haqi: davr oylaridagi vedomostlar (bekor qilinganlarsiz) ──
  const runRows: OverviewRun[] = runs.map((r) => {
    const net = num(r.net), paid = num(r.paid);
    return { id: r.id, docNo: r.docNo, month: r.month, kind: r.kind, status: r.status, gross: num(r.gross), net, paid, left: r2(Math.max(0, net - paid)) };
  });
  const sumR = (f: (r: OverviewRun) => number, st?: PayrollStatus[]) => r2(runRows.filter((r) => !st || st.includes(r.status)).reduce((s, r) => s + f(r), 0));

  const pv = (k: string) => pnl.rows.find((r) => r.key === k)?.total ?? 0;

  return {
    months,
    accounts: accRows,
    cash: { open: sumA((a) => a.open), close: sumA((a) => a.close), cashClose: sumA((a) => a.close, "CASH"), bankClose: sumA((a) => a.close, "BANK") },
    flow: { payments, otherIncome, income: r2(payments + otherIncome), expense, net: r2(payments + otherIncome - expense) },
    expenseByCat,
    debts: {
      receivable: r2(receivable), debtors, customerAdvance: r2(customerAdvance), supplierDebt: r2(supplierDebt), supplierAdvance: r2(supplierAdvance),
      topCustomers: topC.map((c) => ({ id: c.customerId, name: nameOf(cNames, c.customerId), sum: c.debt })),
      topSuppliers: topS.map(([id, v]) => ({ id, name: nameOf(sNames, id), sum: r2(v) })),
    },
    loans: { rows: activeLoans, bank: loanSum("BANK"), borrowed: loanSum("BORROWED"), lent: loanSum("LENT") },
    calendar: { overdueOut: cal.overdueOut, next7Out: cal.next7Out, min: cal.min, items: cal.items.filter((x) => isOutKind(x.kind) && x.day < 7).slice(0, 8) },
    payroll: {
      runs: runRows,
      gross: sumR((r) => (r.kind === "FINAL" ? r.gross : 0)),
      net: sumR((r) => r.net),
      approved: sumR((r) => r.net, ["APPROVED", "PAID"]),
      paid: sumR((r) => r.paid),
      toPay: sumR((r) => r.left, ["APPROVED"]),
      waiting: { n: runRows.filter((r) => r.status === "SUBMITTED").length, net: sumR((r) => r.net, ["SUBMITTED"]) },
      drafts: runRows.filter((r) => r.status === "DRAFT").length,
    },
    toPay: {
      mechApproved: { n: mech.counts.APPROVED, sum: r2(mech.sums.APPROVED) },
      mechNew: { n: mech.counts.NEW, sum: r2(mech.sums.NEW) },
      receipts: { n: receipts.length, sum: r2(receipts.reduce((s, r) => s + r.left, 0)) },
    },
    pnl: { income: pv("income"), gross: pv("gross"), operating: pv("operating"), net: pv("net") },
  };
}
