import { db } from "@/lib/db";
import { loadRevenue } from "@/lib/bi/core";
import { COGS_CATEGORY } from "@/lib/owner-dashboard";
import { periodPlan } from "@/lib/period-stats";
import { asOf, monthShares, receivables, type DashRange } from "./dashboard";

/**
 * Direktor bosh sahifasi kartalari — oydan boshqa davr tanlanganda (bugun / hafta / yil / kalendar).
 * "Oy" da raqamlar vebdagi Egasi dashbordidan (`ownerDashboard`) olinadi; bu yerda xuddi shu formulalar
 * ixtiyoriy davr uchun: sof foyda = tushum − tannarx (retsept) − operatsion xarajat (xomashyodan tashqari).
 */
export async function ownerPeriod(r: DashRange) {
  const until = asOf(r);
  const months = monthShares(r);
  const [sales, tx, budgets, pay, allTx, accounts, recv, batches, trips, pp] = await Promise.all([
    loadRevenue(r.from, r.to), // tushum — yetkazilgan reyslar bo'yicha (vebdagi Egasi dashbordi bilan bir xil)
    db.cashTransaction.groupBy({ by: ["type", "category"], where: { date: { gte: r.from, lt: r.to } }, _sum: { amount: true } }),
    db.expenseBudget.findMany({ where: { OR: months.map(({ year, month }) => ({ year, month })) } }),
    db.payment.groupBy({ by: ["cashAccountId"], where: until ? { date: { lt: until } } : {}, _sum: { amount: true } }),
    db.cashTransaction.groupBy({ by: ["cashAccountId", "type"], where: until ? { date: { lt: until } } : {}, _sum: { amount: true } }),
    db.cashAccount.findMany({ select: { id: true, type: true } }), // nofaol hisobning qoldig'i ham pul
    receivables(until),
    db.productionBatch.findMany({ where: { cancelledAt: null, date: { gte: r.from, lt: r.to } }, select: { qtyM3: true, product: { select: { unit: true } } } }),
    db.trip.findMany({ where: { status: "DELIVERED", deliveredAt: { gte: r.from, lt: r.to } }, select: { qtyM3: true } }),
    periodPlan(r.from, r.to),
  ]);
  const n = (v: unknown) => Number(v ?? 0);
  const revenue = sales.reduce((s, x) => s + x.revenue, 0), cogs = sales.reduce((s, x) => s + x.cost, 0);
  const expense = tx.filter((t) => t.type === "EXPENSE").reduce((s, t) => s + n(t._sum.amount), 0);
  const opex = expense - tx.filter((t) => t.type === "EXPENSE" && t.category === COGS_CATEGORY).reduce((s, t) => s + n(t._sum.amount), 0);
  const share = (b: { year: number; month: number }) => months.find((m) => m.year === b.year && m.month === b.month)?.share ?? 0;
  const expensePlan = budgets.length ? budgets.reduce((s, b) => s + n(b.amount) * share(b), 0) : null;
  const bal = (id: string) => n(pay.find((p) => p.cashAccountId === id)?._sum.amount)
    + n(allTx.find((t) => t.cashAccountId === id && t.type === "INCOME")?._sum.amount)
    - n(allTx.find((t) => t.cashAccountId === id && t.type === "EXPENSE")?._sum.amount);
  const cash = accounts.filter((a) => a.type === "CASH").reduce((s, a) => s + bal(a.id), 0);
  const bank = accounts.filter((a) => a.type !== "CASH").reduce((s, a) => s + bal(a.id), 0);
  const concrete = batches.filter((b) => b.product.unit === "m3").reduce((s, b) => s + n(b.qtyM3), 0);
  const concretePlan = pp.rows.filter((p) => p.product.unit === "m3").reduce((s, p) => s + p.plan, 0) || null;
  return {
    until,
    profit: { revenue, cogs, gross: revenue - cogs, opex, net: revenue - cogs - opex },
    expenses: { total: expense, plan: expensePlan, ratio: revenue > 0 ? (expense / revenue) * 100 : null },
    cash: { total: cash + bank, cash, bank },
    receivable: { total: recv.total, debtors: recv.list.length },
    production: { concrete, plan: concretePlan, planPct: pp.avgPct },
    shipment: { m3: trips.reduce((s, t) => s + n(t.qtyM3), 0), trips: trips.length },
  };
}
