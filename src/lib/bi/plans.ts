import { db } from "@/lib/db";
import { loadSales, sum, addDays, startOfDay, series, mean, type SaleRow } from "./core";

export const MONTHS_UZ = ["Yanvar", "Fevral", "Mart", "Aprel", "May", "Iyun", "Iyul", "Avgust", "Sentabr", "Oktabr", "Noyabr", "Dekabr"];
export const MONTHS_SHORT = ["Yan", "Fev", "Mar", "Apr", "May", "Iyn", "Iyl", "Avg", "Sen", "Okt", "Noy", "Dek"];

/** Ish kunlari — Dushanba–Shanba (zavod jadvali). */
export function workingDays(from: Date, to: Date) { let n = 0; for (let d = new Date(from); d < to; d = addDays(d, 1)) if (d.getDay() !== 0) n++; return n; }

export type Signal = "BONUS" | "NORMAL" | "OGOHLANTIRISH" | "XAVF" | "REJA YO'Q";
export const signalOf = (pct: number | null): Signal => pct === null ? "REJA YO'Q" : pct >= 110 ? "BONUS" : pct >= 90 ? "NORMAL" : pct >= 70 ? "OGOHLANTIRISH" : "XAVF";

/** Reja nazorati — Team24 "Reja Nazorati" (plan_actual) ekvivalenti. Filial → sotuvchi. */
export async function plansTab(year: number, month: number) {
  const today = startOfDay(new Date()), tomorrow = addDays(today, 1);
  const mStart = new Date(year, month - 1, 1), mEnd = new Date(year, month, 1);
  const isCurrent = today >= mStart && today < mEnd, isPast = today >= mEnd;
  const factTo = isPast ? mEnd : isCurrent ? tomorrow : mStart;
  const from6 = new Date(year, month - 6, 1);
  const [plans, sales, hist, plans6, users] = await Promise.all([
    db.salesPlan.findMany({ where: { year, month } }),
    loadSales(mStart, factTo),
    loadSales(from6, factTo),
    db.salesPlan.findMany({ where: { OR: Array.from({ length: 6 }, (_, i) => { const d = new Date(year, month - 1 - i, 1); return { year: d.getFullYear(), month: d.getMonth() + 1 }; }) } }),
    db.user.findMany({ where: { isActive: true }, select: { id: true, fullName: true, role: true } }),
  ]);
  const rev = (rows: SaleRow[]) => sum(rows.map((x) => x.revenue));
  const wdTotal = workingDays(mStart, mEnd), wdPassed = isPast ? wdTotal : isCurrent ? workingDays(mStart, tomorrow) : 0, wdLeft = wdTotal - wdPassed;
  const project = (fact: number) => (isPast ? fact : wdPassed > 0 ? (fact / wdPassed) * wdTotal : 0);

  const companyPlanRow = plans.find((p) => p.sellerId === null);
  const sellerPlans = plans.filter((p) => p.sellerId !== null);
  const companyPlan = companyPlanRow ? Number(companyPlanRow.amount) : sum(sellerPlans.map((p) => Number(p.amount)));
  const fact = rev(sales), forecast = project(fact);
  const pct = companyPlan > 0 ? (fact / companyPlan) * 100 : null, fpct = companyPlan > 0 ? (forecast / companyPlan) * 100 : null;

  // Sotuvchilar
  const sellerIds = new Set<string>([...sales.map((x) => x.sellerId), ...sellerPlans.map((p) => p.sellerId as string), ...users.filter((u) => u.role === "SALES").map((u) => u.id)]);
  const nameOf = new Map(users.map((u) => [u.id, u.fullName]));
  const sellers = [...sellerIds].map((id) => {
    const rows = sales.filter((x) => x.sellerId === id); const f = rev(rows); const p = sellerPlans.find((x) => x.sellerId === id); const plan = p ? Number(p.amount) : null;
    const fc = project(f); const pp = plan ? (f / plan) * 100 : null, fp = plan ? (fc / plan) * 100 : null;
    const last7 = rev(rows.filter((x) => x.date >= addDays(today, -7))), prev7 = rev(rows.filter((x) => x.date >= addDays(today, -14) && x.date < addDays(today, -7)));
    const trend = prev7 > 0 ? ((last7 - prev7) / prev7) * 100 : last7 > 0 ? 100 : 0;
    const spark = Array.from({ length: 6 }, (_, i) => { const d = new Date(year, month - 6 + i, 1), e = new Date(year, month - 5 + i, 1); const hf = rev(hist.filter((x) => x.sellerId === id && x.date >= d && x.date < e)); const hp = plans6.find((q) => q.sellerId === id && q.year === d.getFullYear() && q.month === d.getMonth() + 1); return hp && Number(hp.amount) > 0 ? (hf / Number(hp.amount)) * 100 : null; });
    return { id, name: nameOf.get(id) ?? rows[0]?.seller ?? "Noma'lum", plan, fact: f, pct: pp, forecast: fc, fpct: fp, gap: plan ? fc - plan : null, needPerDay: plan && wdLeft > 0 ? Math.max(0, plan - f) / wdLeft : null, signal: signalOf(fp), trend, orders: new Set(rows.map((x) => x.orderId)).size, customers: new Set(rows.map((x) => x.customerId)).size, volume: sum(rows.filter((x) => x.unit === "m3").map((x) => x.qty)), spark };
  }).sort((a, b) => (b.fpct ?? -1) - (a.fpct ?? -1));

  // Mahsulot (marka) kesimi — reja hajm bo'yicha bo'lsa
  const volumePlan = companyPlanRow?.volumeM3 ? Number(companyPlanRow.volumeM3) : null;
  const volumeFact = sum(sales.filter((x) => x.unit === "m3").map((x) => x.qty));

  // Forecast engine: kumulyativ fakt + prognoz chizig'i
  const daily = series(sales, mStart, isPast ? mEnd : tomorrow, "day", (x) => x.date, (x) => x.revenue);
  let acc = 0; const cum = daily.map((d) => (acc += d.value));
  const labels: string[] = [], cumVals: (number | null)[] = [], fcVals: (number | null)[] = [], planVals: number[] = [];
  const perWd = wdPassed > 0 ? fact / wdPassed : 0; let fcAcc = fact, wdCount = 0;
  for (let d = new Date(mStart), i = 0; d < mEnd; d = addDays(d, 1), i++) {
    labels.push(String(d.getDate()).padStart(2, "0"));
    if (d.getDay() !== 0) wdCount++;
    planVals.push(companyPlan * (wdCount / wdTotal));
    if (i < cum.length) { cumVals.push(cum[i]); fcVals.push(i === cum.length - 1 ? cum[i] : null); }
    else { cumVals.push(null); if (d.getDay() !== 0) fcAcc += perWd; fcVals.push(fcAcc); }
  }
  const needPerDay = wdLeft > 0 ? Math.max(0, companyPlan - fact) / wdLeft : null, bonusPerDay = wdLeft > 0 ? Math.max(0, companyPlan * 1.1 - fact) / wdLeft : null;

  // Oylik trend (6 oy): reja vs fakt vs prognoz
  const monthly = Array.from({ length: 6 }, (_, i) => { const d = new Date(year, month - 6 + i, 1), e = new Date(year, month - 5 + i, 1); const hf = rev(hist.filter((x) => x.date >= d && x.date < e)); const rowsP = plans6.filter((q) => q.year === d.getFullYear() && q.month === d.getMonth() + 1); const cp = rowsP.find((q) => q.sellerId === null); const plan = cp ? Number(cp.amount) : sum(rowsP.map((q) => Number(q.amount))); return { label: `${MONTHS_SHORT[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`, plan, fact: hf, forecast: i === 5 ? forecast : hf, pct: plan > 0 ? (hf / plan) * 100 : null }; });

  const risk = sellers.filter((s) => s.signal === "XAVF"), warn = sellers.filter((s) => s.signal === "OGOHLANTIRISH"), bonus = sellers.filter((s) => s.signal === "BONUS"), normal = sellers.filter((s) => s.signal === "NORMAL"), noPlan = sellers.filter((s) => s.plan === null && (s.fact > 0 || true));
  const dist = { bonus: bonus.length, normal: normal.length, warn: warn.length, risk: risk.length, noPlan: noPlan.length };

  return {
    year, month, isCurrent, isPast, wdTotal, wdPassed, wdLeft, companyPlan, hasCompanyPlan: !!companyPlanRow, fact, forecast, pct, fpct, gap: forecast - companyPlan, needPerDay, bonusPerDay, avgPerDay: perWd,
    sellers, dist, risk, warn, bonus, normal, noPlan, engine: { labels, cumVals, fcVals, planVals }, monthly, volumePlan, volumeFact, plans, users: users.filter((u) => u.role === "SALES" || sellerIds.has(u.id)), avgDailyLast7: mean(daily.slice(-7).map((d) => d.value)),
  };
}
