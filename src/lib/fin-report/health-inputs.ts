import { cashCalendar } from "./calendar";
import { loanBalances } from "./loans";
import { pnlReport, pnlSum } from "./pnl";
import { monthKeyOf } from "./period";

/**
 * «Biznes salomatligi» uchun moliyaviy kirishlar (Sarvar rejasi 3-bosqich, 2026-11-24) — hammasi mavjud hisobotlardan,
 * qayta hisoblamasdan: pul uzilishi — «Bugun» ekranidagi 30 kunlik kassa prognozi (`cashCalendar`, birinchi manfiy kun),
 * sof foyda — joriy oyning hisoblangan PNL'i, qarz yuki — bank krediti va olingan qarzlar + ta'minotchilarga qarz.
 */
export type FinanceHealthInputs = {
  gap: { date: Date; balance: number } | null;
  horizonDays: number;
  net: number;
  income: number;
  loans: number;
  suppliers: number;
};

export async function financeHealthInputs(now: Date = new Date()): Promise<FinanceHealthInputs> {
  const [cal, loans, pnl] = await Promise.all([cashCalendar(now), loanBalances(), pnlReport([monthKeyOf(now)], "accrual")]);
  const neg = cal.days.find((d) => d.balance < 0);
  return {
    gap: neg ? { date: neg.date, balance: neg.balance } : null,
    horizonDays: cal.days.length,
    net: pnlSum(pnl.parts, "net"),
    income: pnlSum(pnl.parts, "income"),
    loans: loans.filter((l) => l.kind !== "LENT" && !l.closedAt).reduce((s, l) => s + l.balance, 0),
    suppliers: cal.suppliers.reduce((s, x) => s + x.debt, 0),
  };
}
