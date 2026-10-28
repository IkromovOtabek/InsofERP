import { db } from "@/lib/db";
import { EXPENSE_CATEGORIES } from "@/lib/cash-categories";
import { expenseForecast, isOverBudget } from "@/lib/owner-dashboard";
import { monthForecast } from "@/lib/bi/core";
import { workCalendar } from "@/lib/work-calendar";

/** Bitta kategoriya qatori: byudjet, limit, fakt, prognoz, o'tgan 3 oy o'rtachasi. */
export type BudgetRow = { cat: string; amount: number | null; limit: number | null; fact: number; forecast: number; histAvg: number | null; /** fakt byudjetdan yoki limitdan katta (`isOverBudget`) */ over: boolean };

/**
 * Oy xarajat byudjeti (TZ §4, §6) — veb «Xarajat byudjeti» sahifasi va mobil ilova bitta hisob:
 * har kategoriya uchun byudjet/limit, Kirim-Chiqimdagi fakt chiqim, prognoz (Egasi dashbordi qoidasi bilan)
 * va oldingi 3 oy o'rtachasi. `history` — shu oy byudjetini kim va qachon o'zgartirgani (audit).
 */
export async function budgetMonth(ym: string) {
  const [year, month] = ym.split("-").map(Number);
  const mStart = new Date(year, month - 1, 1), mEnd = new Date(year, month, 1), hStart = new Date(year, month - 4, 1);
  const now = new Date();
  const daysPassed = now >= mEnd ? Math.round((mEnd.getTime() - mStart.getTime()) / 86400000) : now < mStart ? 0 : now.getDate();
  const daysInMonth = Math.round((mEnd.getTime() - mStart.getTime()) / 86400000);

  const [budgets, fact, hist, history, cal] = await Promise.all([
    db.expenseBudget.findMany({ where: { year, month } }),
    db.cashTransaction.groupBy({ by: ["category"], where: { type: "EXPENSE", cancelledAt: null, date: { gte: mStart, lt: mEnd } }, _sum: { amount: true } }),
    db.cashTransaction.findMany({ where: { type: "EXPENSE", cancelledAt: null, date: { gte: hStart, lt: mStart } }, select: { category: true, amount: true, date: true } }),
    db.auditLog.findMany({ where: { entity: "ExpenseBudget", entityId: ym }, orderBy: { createdAt: "desc" }, take: 10, include: { user: { select: { fullName: true } } } }),
    workCalendar(),
  ]);
  const factBy = new Map(fact.map((f) => [f.category, Number(f._sum.amount ?? 0)]));
  const histBy = new Map<string, Set<string>>(), histSum = new Map<string, number>();
  for (const h of hist) { histSum.set(h.category, (histSum.get(h.category) ?? 0) + Number(h.amount)); (histBy.get(h.category) ?? histBy.set(h.category, new Set()).get(h.category)!).add(`${h.date.getFullYear()}-${h.date.getMonth()}`); }
  const cats = [...new Set([...EXPENSE_CATEGORIES, ...budgets.map((b) => b.category), ...fact.map((f) => f.category)])];
  const rows: BudgetRow[] = cats.map((cat) => {
    const b = budgets.find((x) => x.category === cat);
    const f = factBy.get(cat) ?? 0, months = histBy.get(cat)?.size ?? 0;
    const amount = b ? Number(b.amount) : null, limit = b?.limit ? Number(b.limit) : null;
    // Prognoz va "oshdi" — Egasi dashbordi bilan bitta qoida: oylik bir martalik toifa (ish haqi, ijara, soliq…) — max(fakt, byudjet),
    // kunlik toifa — joriy oyda ish kunlari sur'ati bo'yicha; o'tgan oyda fakt o'zi, kelajak oyda 0
    const project = (x: number) => (daysPassed === 0 ? 0 : daysPassed >= daysInMonth ? x : monthForecast(x, cal));
    return { cat, amount, limit, fact: f, forecast: daysPassed === 0 ? 0 : expenseForecast(cat, f, amount, project), over: isOverBudget(f, amount, limit), histAvg: months ? (histSum.get(cat) ?? 0) / months : null };
  });
  return { ym, rows, history, daysPassed, daysInMonth };
}
