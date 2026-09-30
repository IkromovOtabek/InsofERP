import { db } from "@/lib/db";
import { loadSales } from "@/lib/bi/core";
import { myBrigades } from "@/lib/brigades";
import { ISSUE_KIND } from "@/lib/logistics";
import { SUPPLY_LABEL, totalPlanned } from "@/lib/supply";
import { unitLabel, unitTotals, soleUnit, type UnitRow } from "@/lib/unit";
import { day, inUnit, num, pctText, short, shortSigned, sum, totalsText } from "./fmt";
import type { MobileUser } from "./auth";
import type { CardFilter, HomeCard, HomeRow, HomeSection, SectionChart, Tone } from "./home";

/**
 * Rol dashboardi — mobil bosh ekranning "raqamlar va diagrammalar" qismi.
 *
 * Har rol uchun: davr filtri (Bugun · Hafta · Oy · Yil · Kalendar), bosh ko'rsatkich (hero),
 * kichik KPI kartalari va diagrammali bo'limlar (`bars` — davr bo'yicha ustunlar, `donut` — ulushlar,
 * `progress` — plan/fakt). Hisob shu yerda, ilova faqat chizadi (`features/erp/charts.tsx`).
 *
 * Eski ilova `bars`/`donut` ni bilmaydi — shuning uchun har diagramma bo'limida `rows` ham to'ldiriladi.
 */

// ───────────────────────── Davr ─────────────────────────

export type PeriodKey = "day" | "week" | "month" | "year" | "custom";
const PERIODS: { key: Exclude<PeriodKey, "custom">; label: string }[] = [
  { key: "day", label: "Bugun" }, { key: "week", label: "Hafta" }, { key: "month", label: "Oy" }, { key: "year", label: "Yil" },
];
type Gran = "hour" | "day" | "week" | "month";
export type DashRange = {
  key: PeriodKey; from: Date; to: Date; prevFrom: Date; prevTo: Date; days: number; gran: Gran;
  /** "oy", "12.09 — 28.09" — karta sarlavhasi uchun. */
  label: string;
  /** "o'tgan oydan" — taqqoslash izohi uchun. */
  prevName: string;
  filters: CardFilter[];
  range: { from: string; to: string } | null;
};
export const PERIOD_PARAM = "period";

const ymdRe = /^\d{4}-\d{2}-\d{2}$/;
const parseYmd = (v?: string) => (v && ymdRe.test(v) ? new Date(`${v}T00:00:00`) : null);
const fmtYmd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const DAY_MS = 86_400_000;

/** `?period=week` yoki `?period=custom&from=…&to=…` → davr, oldingi teng davr, filtr tugmalari. */
export function dashRange(opts: { period?: string; from?: string; to?: string }): DashRange {
  const t = new Date(); t.setHours(0, 0, 0, 0);
  const cFrom = parseYmd(opts.from), cToIn = parseYmd(opts.to);
  const customOk = opts.period === "custom" && cFrom && cToIn && cToIn >= cFrom && (cToIn.getTime() - cFrom.getTime()) / DAY_MS <= 400;
  const key: PeriodKey = customOk ? "custom" : PERIODS.some((p) => p.key === opts.period) ? (opts.period as PeriodKey) : "month";
  let from: Date, to: Date, prevFrom: Date, prevTo: Date, gran: Gran, label: string, prevName: string;
  if (key === "custom") {
    from = cFrom!; to = addDays(cToIn!, 1);
    const days = Math.round((to.getTime() - from.getTime()) / DAY_MS);
    prevFrom = addDays(from, -days); prevTo = from;
    gran = days <= 1 ? "hour" : days <= 62 ? "day" : days <= 400 ? "week" : "month";
    label = `${day(from)} — ${day(cToIn!)}`; prevName = `oldingi ${days} kundan`;
  } else if (key === "day") {
    from = t; to = addDays(t, 1); prevFrom = addDays(t, -1); prevTo = t; gran = "hour"; label = "bugun"; prevName = "kechagidan";
  } else if (key === "week") {
    from = addDays(t, -((t.getDay() + 6) % 7)); to = addDays(from, 7);
    prevFrom = addDays(from, -7); prevTo = from; gran = "day"; label = "hafta"; prevName = "o'tgan haftadan";
  } else if (key === "year") {
    from = new Date(t.getFullYear(), 0, 1); to = new Date(t.getFullYear() + 1, 0, 1);
    prevFrom = new Date(t.getFullYear() - 1, 0, 1); prevTo = from; gran = "month"; label = "yil"; prevName = "o'tgan yildan";
  } else {
    from = new Date(t.getFullYear(), t.getMonth(), 1); to = new Date(t.getFullYear(), t.getMonth() + 1, 1);
    prevFrom = new Date(t.getFullYear(), t.getMonth() - 1, 1); prevTo = from; gran = "day"; label = "oy"; prevName = "o'tgan oydan";
  }
  const days = Math.max(1, Math.round((to.getTime() - from.getTime()) / DAY_MS));
  return {
    key, from, to, prevFrom, prevTo, days, gran, label, prevName,
    filters: [
      ...PERIODS.map((p) => ({ key: p.key, label: p.label, active: p.key === key })),
      { key: "custom", label: key === "custom" ? label : "Kalendar", active: key === "custom" },
    ],
    range: key === "custom" ? { from: fmtYmd(from), to: fmtYmd(cToIn!) } : null,
  };
}

/** "o'tgan oydan ▲ 12%" — oldingi davr bilan taqqoslash; oldingi davr bo'sh bo'lsa null. */
const deltaText = (cur: number, prev: number, r: DashRange) =>
  prev > 0 ? `${r.prevName} ${cur >= prev ? "▲" : "▼"} ${Math.abs(((cur - prev) / prev) * 100).toFixed(0)}%` : null;
const joinHint = (...parts: (string | null | undefined | false)[]) => parts.filter(Boolean).join(" · ");

// ───────────────────────── Vaqt savatlari (bars) ─────────────────────────

const WEEKDAYS = ["Ya", "Du", "Se", "Ch", "Pa", "Ju", "Sh"];
const MONTHS = ["Yan", "Fev", "Mar", "Apr", "May", "Iyn", "Iyl", "Avg", "Sen", "Okt", "Noy", "Dek"];

type Buckets = { labels: string[]; index: (d: Date) => number };
function buckets(r: DashRange): Buckets {
  if (r.gran === "hour") return { labels: Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, "0")}`), index: (d) => d.getHours() };
  if (r.gran === "month") {
    const labels: string[] = []; const keys: string[] = [];
    for (let d = new Date(r.from.getFullYear(), r.from.getMonth(), 1); d < r.to; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) { labels.push(MONTHS[d.getMonth()]); keys.push(`${d.getFullYear()}-${d.getMonth()}`); }
    return { labels, index: (d) => keys.indexOf(`${d.getFullYear()}-${d.getMonth()}`) };
  }
  if (r.gran === "week") {
    const n = Math.ceil(r.days / 7);
    return { labels: Array.from({ length: n }, (_, i) => day(addDays(r.from, i * 7))), index: (d) => Math.floor((d.getTime() - r.from.getTime()) / (7 * DAY_MS)) };
  }
  const startMs = r.from.getTime();
  const labels = Array.from({ length: r.days }, (_, i) => { const d = addDays(r.from, i); return r.key === "week" ? WEEKDAYS[d.getDay()] : String(d.getDate()).padStart(2, "0"); });
  return { labels, index: (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return Math.round((x.getTime() - startMs) / DAY_MS); } };
}

type BarsChart = Extract<SectionChart, { kind: "bars" }>;
type DonutChart = Extract<SectionChart, { kind: "donut" }>;
type BarSeries<T> = { label: string; value: (row: T) => number; fmt: (v: number) => string };
/** Davr bo'yicha ustunli diagramma: qatorlar savatlarga taqsimlanadi, har seriya alohida ustun. */
function barsChart<T>(r: DashRange, rows: T[], date: (row: T) => Date, series: BarSeries<T>[], total?: string): BarsChart {
  const b = buckets(r);
  const values = b.labels.map(() => series.map(() => 0));
  for (const row of rows) {
    const i = b.index(date(row));
    if (i < 0 || i >= values.length) continue;
    series.forEach((s, j) => { values[i]![j]! += s.value(row); });
  }
  return {
    kind: "bars",
    series: series.map((s, j) => ({ key: `s${j}`, label: s.label })),
    points: b.labels.map((label, i) => ({ label, values: values[i]!.map((v) => Math.round(v * 100) / 100), texts: values[i]!.map((v, j) => series[j]!.fmt(v)) })),
    total,
  };
}
/** Eski ilova uchun `bars` bo'limining qatorlari — seriya yig'indilari. */
const barsRows = (chart: BarsChart, fmts: ((v: number) => string)[]): HomeRow[] =>
  chart.series.map((s, j) => ({ id: s.key, title: s.label, right: fmts[j]!(chart.points.reduce((a, p) => a + (p.values[j] ?? 0), 0)) }));

/** Ulushlar diagrammasi: eng katta 4 ta + "Boshqa". Nol qiymatlar tashlanadi. */
function donutChart(items: { label: string; value: number }[], fmt: (v: number) => string, totalLabel?: string): DonutChart | null {
  const sorted = items.filter((i) => i.value > 0).sort((a, b) => b.value - a.value);
  if (!sorted.length) return null;
  const top = sorted.slice(0, 4);
  const rest = sorted.slice(4).reduce((s, i) => s + i.value, 0);
  const shown = rest > 0 ? [...top, { label: `Boshqa (${sorted.length - 4})`, value: rest }] : top;
  const total = sorted.reduce((s, i) => s + i.value, 0);
  return { kind: "donut", items: shown.map((i) => ({ label: i.label, value: Math.round(i.value * 100) / 100, text: fmt(i.value) })), total: fmt(total), totalLabel };
}
const donutRows = (chart: DonutChart): HomeRow[] => {
  const total = chart.items.reduce((s, i) => s + i.value, 0) || 1;
  return chart.items.map((i, n) => ({ id: `d${n}`, title: i.label, subtitle: `${Math.round((i.value / total) * 100)}%`, right: i.text }));
};
/** Guruhlab yig'ish: label → qiymat. */
function groupSum<T>(rows: T[], label: (r: T) => string, value: (r: T) => number) {
  const m = new Map<string, number>();
  for (const r of rows) { const k = label(r); m.set(k, (m.get(k) ?? 0) + value(r)); }
  return [...m].map(([label, value]) => ({ label, value }));
}
const count = () => 1;

type ProgressItem = Extract<SectionChart, { kind: "progress" }>["items"][number];
/** Plan/fakt qatori — foiz va rang (norma ≥ 90 %, e'tibor ≥ 60 %, kritik past). `invert` — oshishi yomon (xarajat). */
function progressItem(label: string, fact: number, plan: number | null, fmt: (v: number) => string, invert = false, open?: string): ProgressItem {
  const pct = plan && plan > 0 ? Math.round((fact / plan) * 100) : null;
  const tone: Tone = pct == null ? "info" : invert ? (pct > 100 ? "danger" : pct > 90 ? "warning" : "success") : pct >= 90 ? "success" : pct >= 60 ? "warning" : "danger";
  return { label, pct, fact: fmt(fact), plan: plan == null ? null : fmt(plan), tone, invert, open };
}
const progressRows = (items: ProgressItem[]): HomeRow[] =>
  items.map((it, i) => ({ id: `p${i}`, title: it.label, subtitle: `fakt ${it.fact}${it.plan ? ` · plan ${it.plan}` : ""}`, right: it.pct == null ? undefined : `${it.pct}%`, tone: it.tone, open: it.open }));

const chartSection = (title: string, chart: SectionChart | null, rows: HomeRow[], icon: string, empty = "Bu davrda ma'lumot yo'q", target?: string): HomeSection | null =>
  chart ? { title, empty, rows, icon, chart, target } : null;

const unitRows = (rows: { qty: unknown; unit: string }[]): UnitRow[] => rows.map((r) => ({ unit: r.unit, qty: sum(r.qty) }));
/** Aralash birlikli qatorlar uchun taqqoslanadigan bitta son: eng ko'p uchraydigan birlik yig'indisi. */
function mainUnit(rows: { qty: unknown; unit: string }[]) {
  const t = unitTotals(unitRows(rows)).sort((a, b) => b.qty - a.qty);
  return t[0] ?? null;
}
const unitSum = (rows: { qty: unknown; unit: string }[], unit: string) => rows.filter((r) => (r.unit || "m3") === unit).reduce((s, r) => s + sum(r.qty), 0);
/** Birlik bo'yicha seriyalar (m³ va dona alohida ustun) — ko'pi bilan ikkita. */
function unitSeries<T extends { qty: unknown; unit: string }>(rows: T[]): BarSeries<T>[] {
  const units = unitTotals(unitRows(rows)).sort((a, b) => b.qty - a.qty).slice(0, 2).map((u) => u.unit);
  if (!units.length) units.push("m3");
  return units.map((u) => ({ label: unitLabel(u), value: (r) => ((r.unit || "m3") === u ? sum(r.qty) : 0), fmt: (v) => inUnit(v, u) }));
}
const cnt = (n: number, word: string) => `${n} ${word}`;
const ORDER_LABEL: Record<string, string> = { DRAFT: "Qoralama", BLOCKED: "Bloklangan", CONFIRMED: "Tasdiqlangan", IN_PRODUCTION: "Ishlab chiqarishda", DELIVERED: "Yetkazildi", CLOSED: "Yopildi", CANCELLED: "Bekor" };
const INVOICE_LABEL: Record<string, string> = { OPEN: "Ochiq", PARTIAL: "Qisman", PAID: "To'langan", CANCELLED: "Bekor" };
const VEHICLE_LABEL: Record<string, string> = { ACTIVE: "Saflda", REPAIR: "Ta'mirda", IDLE: "Bekor turibdi" };
const ATT_LABEL: Record<string, string> = { PRESENT: "Keldi", ABSENT: "Kelmadi", LEAVE: "Ta'til", SICK: "Kasal", DAYOFF: "Dam olish" };
const MOVE_LABEL: Record<string, string> = { RECEIPT: "Kirim", PRODUCTION_CONSUME: "Zames sarfi", PRODUCTION_OUTPUT: "Tayyor mahsulot", SHIPMENT: "Jo'natish", ADJUSTMENT: "Inventarizatsiya", WRITE_OFF: "Hisobdan chiqarish", BRIGADE_ISSUE: "Brigadaga berildi", BRIGADE_RETURN: "Brigadadan qaytdi" };

export type RoleDashboard = { hero: HomeCard; tiles: HomeCard[]; charts: HomeSection[] };
const pick = (...s: (HomeSection | null)[]) => s.filter((x): x is HomeSection => !!x);

// ───────────────────────── Umumiy so'rovlar ─────────────────────────

/** Kirim (mijoz to'lovlari + boshqa tushum) va chiqim — davr bo'yicha; buxgalteriya, moliya, kassa uchun. */
async function moneyFlow(r: DashRange) {
  const [pay, tx, prevPay, prevTx] = await Promise.all([
    db.payment.findMany({ where: { date: { gte: r.from, lt: r.to } }, select: { date: true, amount: true, cashAccountId: true, customerId: true } }),
    db.cashTransaction.findMany({ where: { date: { gte: r.from, lt: r.to } }, select: { date: true, amount: true, type: true, category: true, cashAccountId: true } }),
    db.payment.aggregate({ where: { date: { gte: r.prevFrom, lt: r.prevTo } }, _sum: { amount: true } }),
    db.cashTransaction.groupBy({ by: ["type"], where: { date: { gte: r.prevFrom, lt: r.prevTo } }, _sum: { amount: true } }),
  ]);
  type Flow = { date: Date; amount: number; dir: "in" | "out"; category: string; accountId: string };
  const flows: Flow[] = [
    ...pay.map((p) => ({ date: p.date, amount: sum(p.amount), dir: "in" as const, category: "Mijoz to'lovi", accountId: p.cashAccountId })),
    ...tx.map((t) => ({ date: t.date, amount: sum(t.amount), dir: t.type === "EXPENSE" ? ("out" as const) : ("in" as const), category: t.category, accountId: t.cashAccountId })),
  ];
  const inSum = flows.filter((f) => f.dir === "in").reduce((s, f) => s + f.amount, 0);
  const outSum = flows.filter((f) => f.dir === "out").reduce((s, f) => s + f.amount, 0);
  const prevIn = sum(prevPay._sum.amount) + sum(prevTx.find((t) => t.type === "INCOME")?._sum.amount);
  const prevOut = sum(prevTx.find((t) => t.type === "EXPENSE")?._sum.amount);
  const bars = barsChart(r, flows, (f) => f.date, [
    { label: "Kirim", value: (f) => (f.dir === "in" ? f.amount : 0), fmt: short },
    { label: "Chiqim", value: (f) => (f.dir === "out" ? f.amount : 0), fmt: short },
  ], `Kirim ${short(inSum)} · chiqim ${short(outSum)}`);
  const expenseDonut = donutChart(groupSum(flows.filter((f) => f.dir === "out"), (f) => f.category, (f) => f.amount), short, "chiqim");
  return { flows, pay, inSum, outSum, prevIn, prevOut, bars, expenseDonut };
}

/** Hisoblar bo'yicha hozirgi qoldiq (kassa va bank alohida). */
async function accountBalances() {
  const [accounts, pay, tx] = await Promise.all([
    db.cashAccount.findMany({ where: { isActive: true }, select: { id: true, name: true } }),
    db.payment.groupBy({ by: ["cashAccountId"], _sum: { amount: true } }),
    db.cashTransaction.groupBy({ by: ["cashAccountId", "type"], _sum: { amount: true } }),
  ]);
  return accounts.map((a) => ({
    label: a.name,
    value: sum(pay.find((p) => p.cashAccountId === a.id)?._sum.amount)
      + sum(tx.find((t) => t.cashAccountId === a.id && t.type === "INCOME")?._sum.amount)
      - sum(tx.find((t) => t.cashAccountId === a.id && t.type === "EXPENSE")?._sum.amount),
  }));
}

/** Ochiq schyotlar bo'yicha qarz (debitorka) — mijoz kesimida. */
async function receivables() {
  const open = await db.invoice.findMany({ where: { status: { in: ["OPEN", "PARTIAL"] } }, select: { customerId: true, amount: true, customer: { select: { name: true } }, payments: { select: { amount: true } } } });
  const byCustomer = new Map<string, { id: string; name: string; debt: number; n: number }>();
  for (const i of open) {
    const left = sum(i.amount) - i.payments.reduce((p, x) => p + sum(x.amount), 0);
    const c = byCustomer.get(i.customerId) ?? { id: i.customerId, name: i.customer.name, debt: 0, n: 0 };
    c.debt += left; c.n += 1; byCustomer.set(i.customerId, c);
  }
  const list = [...byCustomer.values()].sort((a, b) => b.debt - a.debt);
  return { total: list.reduce((s, c) => s + c.debt, 0), count: open.length, list };
}

/** Kreditorka — tasdiqlangan, hali qabul qilinmagan ta'minot zayavkalari. */
async function payables() {
  const rows = await db.supplyRequest.findMany({ where: { status: { in: ["APPROVED", "FUNDED"] } }, include: { items: true } });
  return { total: rows.reduce((s, r) => s + totalPlanned(r), 0), count: rows.length };
}

// ───────────────────────── Rollar ─────────────────────────

async function production(r: DashRange): Promise<RoleDashboard> {
  const now = new Date();
  const monthFrom = new Date(now.getFullYear(), now.getMonth(), 1), monthTo = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const [batches, prev, defects, progress, plans, monthBatches] = await Promise.all([
    db.productionBatch.findMany({ where: { date: { gte: r.from, lt: r.to } }, select: { date: true, qtyM3: true, shift: true, productId: true, product: { select: { name: true, unit: true } } } }),
    db.productionBatch.findMany({ where: { date: { gte: r.prevFrom, lt: r.prevTo } }, select: { qtyM3: true, product: { select: { unit: true } } } }),
    db.productDefect.findMany({ where: { date: { gte: r.from, lt: r.to } }, select: { qty: true, reason: true, product: { select: { unit: true } } } }),
    db.taskProgress.findMany({ where: { date: { gte: r.from, lt: r.to } }, select: { qty: true, task: { select: { orderItem: { select: { product: { select: { unit: true } } } } } } } }),
    db.productionPlan.findMany({ where: { year: now.getFullYear(), month: now.getMonth() + 1 }, include: { product: { select: { name: true, unit: true } } } }),
    db.productionBatch.groupBy({ by: ["productId"], where: { date: { gte: monthFrom, lt: monthTo } }, _sum: { qtyM3: true } }),
  ]);
  const rows = batches.map((b) => ({ qty: b.qtyM3, unit: b.product.unit, date: b.date, name: b.product.name, shift: b.shift }));
  const main = mainUnit(rows);
  const prevMain = main ? unitSum(prev.map((b) => ({ qty: b.qtyM3, unit: b.product.unit })), main.unit) : 0;
  const defRows = defects.map((d) => ({ qty: d.qty, unit: d.product.unit, reason: d.reason }));
  const progRows = progress.map((p) => ({ qty: p.qty, unit: p.task.orderItem.product.unit }));
  const planItems = plans.map((p) => progressItem(p.product.name, sum(monthBatches.find((m) => m.productId === p.productId)?._sum.qtyM3), sum(p.monthQty), (v) => inUnit(v, p.product.unit)));
  const planPct = planItems.filter((i) => i.pct != null);
  const avgPlan = planPct.length ? Math.round(planPct.reduce((s, i) => s + i.pct!, 0) / planPct.length) : null;
  const defectMain = main ? unitSum(defRows, main.unit) : 0;
  const defectPct = main && main.qty > 0 ? (defectMain / (main.qty + defectMain)) * 100 : null;
  const series = unitSeries(rows);
  const bars = barsChart(r, rows, (x) => x.date, series, `Jami ${totalsText(unitRows(rows))}`);
  return {
    hero: { key: "produced", label: `Ishlab chiqarildi (${r.label})`, value: totalsText(unitRows(rows)), hint: joinHint(cnt(batches.length, "zames"), main && deltaText(main.qty, prevMain, r)), tone: "brand", icon: "factory" },
    tiles: [
      { key: "plan", label: "Oylik plan", value: pctText(avgPlan), hint: planItems.length ? `${planItems.length} mahsulot bo'yicha` : "plan belgilanmagan", tone: avgPlan == null ? "info" : avgPlan >= 90 ? "success" : avgPlan >= 60 ? "warning" : "danger", icon: "square-check" },
      { key: "defect", label: "Brak", value: totalsText(unitRows(defRows)), hint: joinHint(cnt(defects.length, "qayd"), defectPct != null && `${defectPct.toFixed(1)}%`), tone: defects.length ? (defectPct != null && defectPct > 2 ? "danger" : "warning") : "success", icon: "triangle-alert" },
      { key: "brigades", label: "Brigadalar bajardi", value: totalsText(unitRows(progRows)), hint: cnt(progress.length, "qayd"), tone: "success", icon: "hard-hat" },
      { key: "shifts", label: "Smenalar", value: `${rows.filter((x) => x.shift === 1).length} / ${rows.filter((x) => x.shift !== 1).length}`, hint: "1-smena / 2-smena zames", tone: "info", icon: "clock" },
    ],
    charts: pick(
      chartSection("Ishlab chiqarish dinamikasi", bars, barsRows(bars, series.map((s) => s.fmt)), "chart-column"),
      plans.length ? chartSection("Oylik plan / fakt", { kind: "progress", items: planItems }, progressRows(planItems), "square-check") : null,
      main ? chartSection(`Mahsulotlar ulushi (${unitLabel(main.unit)})`, donutChart(groupSum(rows.filter((x) => (x.unit || "m3") === main.unit), (x) => x.name, (x) => sum(x.qty)), (v) => inUnit(v, main.unit)), [], "chart-pie") : null,
      chartSection("Brak sabablari", donutChart(groupSum(defRows, (x) => x.reason, (x) => sum(x.qty)), (v) => num(v)), [], "triangle-alert"),
    ).map((s) => (s.chart?.kind === "donut" && !s.rows.length ? { ...s, rows: donutRows(s.chart) } : s)),
  };
}

async function sales(user: MobileUser, r: DashRange): Promise<RoleDashboard> {
  const now = new Date();
  const monthFrom = new Date(now.getFullYear(), now.getMonth(), 1), monthTo = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const [cur, prev, orders, leads, newCustomers, plans, month] = await Promise.all([
    loadSales(r.from, r.to), loadSales(r.prevFrom, r.prevTo),
    db.order.findMany({ where: { date: { gte: r.from, lt: r.to }, kind: "SALE" }, select: { status: true, createdById: true } }),
    db.lead.findMany({ where: { createdAt: { gte: r.from, lt: r.to } }, select: { status: true } }),
    db.customer.count({ where: { createdAt: { gte: r.from, lt: r.to }, isInternal: false } }),
    db.salesPlan.findMany({ where: { year: now.getFullYear(), month: now.getMonth() + 1 } }),
    r.key === "month" ? Promise.resolve(null) : loadSales(monthFrom, monthTo),
  ]);
  const revenue = cur.reduce((s, x) => s + x.revenue, 0), prevRevenue = prev.reduce((s, x) => s + x.revenue, 0);
  const mine = cur.filter((x) => x.sellerId === user.id).reduce((s, x) => s + x.revenue, 0);
  const monthRows = month ?? cur;
  const monthRevenue = monthRows.reduce((s, x) => s + x.revenue, 0), monthMine = monthRows.filter((x) => x.sellerId === user.id).reduce((s, x) => s + x.revenue, 0);
  const planAll = plans.find((p) => !p.sellerId), planMine = plans.find((p) => p.sellerId === user.id);
  const planItems = [
    ...(planAll ? [progressItem("Umumiy plan (oy)", monthRevenue, sum(planAll.amount), short)] : []),
    ...(planMine ? [progressItem("Mening planim (oy)", monthMine, sum(planMine.amount), short)] : []),
  ];
  const converted = leads.filter((l) => l.status === "CONVERTED").length;
  const bars = barsChart(r, cur, (x) => x.date, [
    { label: "Jami", value: (x) => x.revenue, fmt: short },
    { label: "Mening", value: (x) => (x.sellerId === user.id ? x.revenue : 0), fmt: short },
  ], `Jami ${short(revenue)}`);
  return {
    hero: { key: "revenue", label: `Sotuv (${r.label})`, value: short(revenue), hint: joinHint(cnt(new Set(cur.map((x) => x.orderId)).size, "zayavka"), deltaText(revenue, prevRevenue, r)), tone: prevRevenue > 0 && revenue < prevRevenue ? "warning" : "success", icon: "trending-up" },
    tiles: [
      { key: "mine", label: "Mening sotuvim", value: short(mine), hint: revenue > 0 ? `jamining ${pctText((mine / revenue) * 100)}` : undefined, tone: "brand", icon: "user" },
      { key: "volume", label: "Hajm", value: totalsText(cur.map((x) => ({ unit: x.unit, qty: x.qty }))), tone: "info", icon: "cube" },
      { key: "leads", label: "Arizalar", value: String(leads.length), hint: leads.length ? `${converted} mijozga aylandi · ${pctText((converted / leads.length) * 100)}` : "ariza kelmadi", tone: leads.length && !converted ? "warning" : "success", icon: "inbox" },
      { key: "customers", label: "Yangi mijozlar", value: String(newCustomers), tone: "success", icon: "user-plus" },
    ],
    charts: pick(
      chartSection("Sotuv dinamikasi", bars, barsRows(bars, [short, short]), "chart-column"),
      planItems.length ? chartSection("Sotuv plani — oy", { kind: "progress", items: planItems }, progressRows(planItems), "square-check") : null,
      chartSection("Mahsulotlar bo'yicha", donutChart(groupSum(cur, (x) => x.product, (x) => x.revenue), short, "sotuv"), [], "chart-pie"),
      chartSection("Mijozlar bo'yicha", donutChart(groupSum(cur, (x) => x.customer, (x) => x.revenue), short, "sotuv"), [], "users"),
      chartSection("Zayavkalar holati", donutChart(groupSum(orders, (o) => ORDER_LABEL[o.status] ?? o.status, count), (v) => cnt(v, "ta"), "zayavka"), [], "file-text"),
    ).map((s) => (s.chart?.kind === "donut" && !s.rows.length ? { ...s, rows: donutRows(s.chart) } : s)),
  };
}

/** Ish boshqaruvchi (hamma brigada) va brigadir (o'z brigadalari) — bitta hisob, brigada filtri bilan. */
async function brigadeWork(r: DashRange, brigadeIds: string[] | null, mineLabel: boolean): Promise<RoleDashboard> {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const bw = brigadeIds ? { brigadeId: { in: brigadeIds } } : {};
  const [progress, prev, closed, open, defects, brigades] = await Promise.all([
    db.taskProgress.findMany({ where: { date: { gte: r.from, lt: r.to }, task: bw }, select: { date: true, qty: true, task: { select: { brigade: { select: { name: true } }, orderItem: { select: { product: { select: { name: true, unit: true } } } } } } } }),
    db.taskProgress.findMany({ where: { date: { gte: r.prevFrom, lt: r.prevTo }, task: bw }, select: { qty: true, task: { select: { orderItem: { select: { product: { select: { unit: true } } } } } } } }),
    db.brigadeTask.count({ where: { ...bw, status: "DONE", updatedAt: { gte: r.from, lt: r.to } } }),
    db.brigadeTask.findMany({ where: { ...bw, status: { in: ["NEW", "IN_PROGRESS"] } }, orderBy: { dueDate: "asc" }, select: { id: true, taskNo: true, qty: true, doneQty: true, dueDate: true, brigadeId: true, brigade: { select: { name: true } }, orderItem: { select: { product: { select: { name: true, unit: true } } } } } }),
    db.productDefect.findMany({ where: { date: { gte: r.from, lt: r.to }, ...(brigadeIds ? { brigadeId: { in: brigadeIds } } : {}) }, select: { qty: true, product: { select: { unit: true } } } }),
    db.brigade.findMany({ where: { isActive: true, ...(brigadeIds ? { id: { in: brigadeIds } } : {}) }, select: { id: true, name: true } }),
  ]);
  const rows = progress.map((p) => ({ date: p.date, qty: p.qty, unit: p.task.orderItem.product.unit, brigade: p.task.brigade.name, product: p.task.orderItem.product.name }));
  const main = mainUnit(rows);
  const prevMain = main ? unitSum(prev.map((p) => ({ qty: p.qty, unit: p.task.orderItem.product.unit })), main.unit) : 0;
  const overdue = open.filter((t) => t.dueDate < today).length;
  const series = unitSeries(rows);
  const bars = barsChart(r, rows, (x) => x.date, series, `Jami ${totalsText(unitRows(rows))}`);
  // Brigadalar bo'yicha ochiq topshiriqlarning bajarilishi (ish boshqaruvchi) / topshiriqlar bo'yicha (brigadir)
  const progItems = mineLabel
    ? open.slice(0, 8).map((t) => progressItem(`${t.taskNo} · ${t.orderItem.product.name}`, sum(t.doneQty), sum(t.qty), (v) => inUnit(v, t.orderItem.product.unit), false, "tasks"))
    : brigades.map((b) => {
        const ts = open.filter((t) => t.brigadeId === b.id);
        const u = soleUnit(ts.map((t) => ({ unit: t.orderItem.product.unit, qty: t.qty })));
        return progressItem(b.name, ts.reduce((s, t) => s + sum(t.doneQty), 0), ts.length ? ts.reduce((s, t) => s + sum(t.qty), 0) : null, (v) => inUnit(v, u), false, "tasks");
      }).filter((i) => i.plan != null);
  return {
    hero: { key: "done", label: `${mineLabel ? "Bajardik" : "Bajarildi"} (${r.label})`, value: totalsText(unitRows(rows)), hint: joinHint(cnt(progress.length, "qayd"), main && deltaText(main.qty, prevMain, r)), tone: "brand", icon: "checkmark-done" },
    tiles: [
      { key: "closed", label: "Yopilgan topshiriq", value: String(closed), tone: "success", icon: "circle-check" },
      { key: "open", label: "Ochiq topshiriq", value: String(open.length), hint: totalsText(open.map((t) => ({ unit: t.orderItem.product.unit, qty: sum(t.qty) - sum(t.doneQty) }))) + " qoldi", tone: open.length ? "info" : "success", icon: "list" },
      { key: "overdue", label: "Kechikkan", value: String(overdue), hint: overdue ? "muddati o'tgan" : "kechikish yo'q", tone: overdue ? "danger" : "success", icon: "alarm" },
      mineLabel
        ? { key: "defect", label: "Brak", value: totalsText(defects.map((d) => ({ unit: d.product.unit, qty: d.qty }))), hint: cnt(defects.length, "qayd"), tone: defects.length ? "warning" : "success", icon: "triangle-alert" }
        : { key: "active", label: "Faol brigadalar", value: `${new Set(rows.map((x) => x.brigade)).size} / ${brigades.length}`, hint: "davrda ish qayd qilgan", tone: "info", icon: "hard-hat" },
    ],
    charts: pick(
      chartSection("Kunlik bajarilish", bars, barsRows(bars, series.map((s) => s.fmt)), "chart-column"),
      progItems.length ? chartSection(mineLabel ? "Topshiriqlar bajarilishi" : "Brigadalar — ochiq topshiriqlar", { kind: "progress", items: progItems }, progressRows(progItems), "square-check") : null,
      main && !mineLabel ? chartSection(`Brigadalar ulushi (${unitLabel(main.unit)})`, donutChart(groupSum(rows.filter((x) => (x.unit || "m3") === main.unit), (x) => x.brigade, (x) => sum(x.qty)), (v) => inUnit(v, main.unit)), [], "hard-hat") : null,
      main ? chartSection(`Mahsulot bo'yicha (${unitLabel(main.unit)})`, donutChart(groupSum(rows.filter((x) => (x.unit || "m3") === main.unit), (x) => x.product, (x) => sum(x.qty)), (v) => inUnit(v, main.unit)), [], "package") : null,
    ).map((s) => (s.chart?.kind === "donut" && !s.rows.length ? { ...s, rows: donutRows(s.chart) } : s)),
  };
}

async function logistics(r: DashRange): Promise<RoleDashboard> {
  const [delivered, prevDelivered, created, fuel, expenses, issues, vehicles] = await Promise.all([
    db.trip.findMany({ where: { status: "DELIVERED", deliveredAt: { gte: r.from, lt: r.to } }, select: { deliveredAt: true, departedAt: true, loadedAt: true, plannedAt: true, createdAt: true, qtyM3: true, driver: { select: { fullName: true } }, order: { select: { customer: { select: { name: true } }, items: { select: { qtyM3: true, product: { select: { unit: true } } } } } } } }),
    db.trip.findMany({ where: { status: "DELIVERED", deliveredAt: { gte: r.prevFrom, lt: r.prevTo } }, select: { qtyM3: true } }),
    db.trip.groupBy({ by: ["status"], where: { createdAt: { gte: r.from, lt: r.to } }, _count: true }),
    db.fuelLog.aggregate({ where: { date: { gte: r.from, lt: r.to } }, _sum: { amount: true, liters: true } }),
    db.transportExpense.aggregate({ where: { date: { gte: r.from, lt: r.to } }, _sum: { amount: true } }),
    db.tripIssue.findMany({ where: { createdAt: { gte: r.from, lt: r.to } }, select: { kind: true, resolvedAt: true } }),
    db.vehicle.groupBy({ by: ["status"], where: { isActive: true }, _count: true }),
  ]);
  const rows = delivered.map((t) => ({ date: t.deliveredAt!, qty: t.qtyM3, unit: soleUnit(t.order.items.map((i) => ({ unit: i.product.unit, qty: i.qtyM3 }))) ?? "m3", driver: t.driver.fullName, customer: t.order.customer.name,
    minutes: (t.deliveredAt!.getTime() - (t.departedAt ?? t.loadedAt ?? t.createdAt).getTime()) / 60_000,
    late: !!t.plannedAt && t.deliveredAt!.getTime() - t.plannedAt.getTime() > 15 * 60_000 }));
  const qty = rows.reduce((s, x) => s + sum(x.qty), 0), prevQty = prevDelivered.reduce((s, x) => s + sum(x.qtyM3), 0);
  const total = created.reduce((s, c) => s + c._count, 0), cancelled = created.find((c) => c.status === "CANCELLED")?._count ?? 0;
  const avgMin = rows.length ? rows.reduce((s, x) => s + Math.max(0, x.minutes), 0) / rows.length : null;
  const late = rows.filter((x) => x.late).length;
  const bars = barsChart(r, rows, (x) => x.date, [{ label: "Reyslar", value: count, fmt: (v) => cnt(v, "reys") }, { label: "Hajm", value: (x) => sum(x.qty), fmt: (v) => totalsText([{ unit: mainUnit(rows)?.unit ?? "m3", qty: v }]) }], `${cnt(rows.length, "reys")} · ${totalsText(unitRows(rows))}`);
  return {
    hero: { key: "delivered", label: `Yetkazildi (${r.label})`, value: totalsText(unitRows(rows)), hint: joinHint(cnt(rows.length, "reys"), deltaText(qty, prevQty, r)), tone: "brand", icon: "truck" },
    tiles: [
      { key: "trips", label: "Ochilgan reyslar", value: String(total), hint: cancelled ? `${cancelled} bekor qilindi` : undefined, tone: "info", icon: "navigate" },
      { key: "avg", label: "O'rtacha yetkazish", value: avgMin == null ? "—" : `${Math.round(avgMin)} daq`, hint: "yo'lga chiqishdan yetkazishgacha", tone: avgMin != null && avgMin > 120 ? "warning" : "success", icon: "clock" },
      { key: "late", label: "Kechikkan", value: String(late), hint: rows.length ? `${pctText((late / rows.length) * 100)} reys` : undefined, tone: late ? "danger" : "success", icon: "alarm" },
      { key: "fuel", label: "Yoqilg'i", value: short(sum(fuel._sum.amount)), hint: `${num(sum(fuel._sum.liters))} litr`, tone: "info", icon: "droplets" },
      { key: "cost", label: "Transport xarajati", value: short(sum(expenses._sum.amount)), hint: "ta'mir, yo'l, haq…", tone: "warning", icon: "wallet" },
      { key: "issues", label: "Muammolar", value: String(issues.length), hint: issues.length ? `${issues.filter((i) => !i.resolvedAt).length} ochiq` : "muammo qayd qilinmadi", tone: issues.some((i) => !i.resolvedAt) ? "danger" : "success", icon: "triangle-alert" },
    ],
    charts: pick(
      chartSection("Reyslar dinamikasi", bars, barsRows(bars, [(v) => cnt(v, "reys"), (v) => totalsText([{ unit: mainUnit(rows)?.unit ?? "m3", qty: v }])]), "chart-column"),
      chartSection("Haydovchilar bo'yicha", donutChart(groupSum(rows, (x) => x.driver, count), (v) => cnt(v, "reys"), "reys"), [], "id-card"),
      chartSection("Transport holati", donutChart(vehicles.map((v) => ({ label: VEHICLE_LABEL[v.status] ?? v.status, value: v._count })), (v) => cnt(v, "ta"), "texnika"), [], "truck", "Faol texnika yo'q"),
      chartSection("Muammo turlari", donutChart(groupSum(issues, (i) => ISSUE_KIND[i.kind] ?? i.kind, count), (v) => cnt(v, "ta"), "muammo"), [], "triangle-alert"),
    ).map((s) => (s.chart?.kind === "donut" && !s.rows.length ? { ...s, rows: donutRows(s.chart) } : s)),
  };
}

async function warehouse(r: DashRange): Promise<RoleDashboard> {
  const [receipts, prevReceipts, moves, materials, balances] = await Promise.all([
    db.goodsReceipt.findMany({ where: { date: { gte: r.from, lt: r.to } }, select: { date: true, supplier: { select: { name: true } }, items: { select: { qty: true, price: true, material: { select: { name: true } } } } } }),
    db.goodsReceiptItem.findMany({ where: { receipt: { date: { gte: r.prevFrom, lt: r.prevTo } } }, select: { qty: true, price: true } }),
    db.stockMove.findMany({ where: { date: { gte: r.from, lt: r.to } }, select: { type: true, qty: true, material: { select: { name: true, unit: true } } } }),
    db.material.findMany({ where: { isActive: true, minStock: { gt: 0 } }, select: { id: true, name: true, unit: true, minStock: true } }),
    db.stockMove.groupBy({ by: ["materialId"], where: { materialId: { not: null } }, _sum: { qty: true } }),
  ]);
  const recRows = receipts.map((x) => ({ date: x.date, supplier: x.supplier.name, amount: x.items.reduce((s, i) => s + sum(i.qty) * sum(i.price), 0), items: x.items }));
  const amount = recRows.reduce((s, x) => s + x.amount, 0), prevAmount = prevReceipts.reduce((s, i) => s + sum(i.qty) * sum(i.price), 0);
  const bal = new Map(balances.map((b) => [b.materialId, sum(b._sum.qty)]));
  const stockItems = materials
    .map((m) => progressItem(m.name, bal.get(m.id) ?? 0, sum(m.minStock), (v) => inUnit(v, m.unit), false, "stock"))
    .map((it) => ({ ...it, tone: (it.pct == null ? "info" : it.pct < 100 ? "danger" : it.pct < 150 ? "warning" : "success") as Tone }))
    .sort((a, b) => (a.pct ?? 0) - (b.pct ?? 0)).slice(0, 8);
  const low = stockItems.filter((i) => (i.pct ?? 0) < 100).length;
  const consume = moves.filter((m) => m.type === "PRODUCTION_CONSUME");
  const topConsumed = groupSum(consume, (m) => m.material?.name ?? "—", (m) => Math.abs(sum(m.qty))).sort((a, b) => b.value - a.value)[0];
  const bars = barsChart(r, recRows, (x) => x.date, [{ label: "Kirim", value: (x) => x.amount, fmt: short }], `Jami ${short(amount)}`);
  return {
    hero: { key: "receipts", label: `Kirim (${r.label})`, value: short(amount), hint: joinHint(cnt(receipts.length, "hujjat"), deltaText(amount, prevAmount, r)), tone: "brand", icon: "download" },
    tiles: [
      { key: "low", label: "Kam qolgan", value: String(low), hint: low ? "minimumdan past" : "hammasi yetarli", tone: low ? "danger" : "success", icon: "alert-circle" },
      { key: "consume", label: "Zames sarfi", value: cnt(consume.length, "harakat"), hint: topConsumed ? `eng ko'p: ${topConsumed.label}` : undefined, tone: "info", icon: "layers" },
      { key: "adjust", label: "Inventarizatsiya", value: String(moves.filter((m) => m.type === "ADJUSTMENT").length), hint: "tuzatish yozuvi", tone: "info", icon: "clipboard-list" },
      { key: "brigade", label: "Brigadaga berildi", value: String(moves.filter((m) => m.type === "BRIGADE_ISSUE").length), hint: `${moves.filter((m) => m.type === "BRIGADE_RETURN").length} qaytdi`, tone: "info", icon: "hard-hat" },
    ],
    charts: pick(
      chartSection("Kirim dinamikasi", bars, barsRows(bars, [short]), "chart-column"),
      stockItems.length ? chartSection("Qoldiq / minimum", { kind: "progress", items: stockItems }, progressRows(stockItems), "layers") : null,
      chartSection("Yetkazuvchilar bo'yicha", donutChart(groupSum(recRows, (x) => x.supplier, (x) => x.amount), short, "kirim"), [], "store"),
      chartSection("Harakat turlari", donutChart(groupSum(moves, (m) => MOVE_LABEL[m.type] ?? m.type, count), (v) => cnt(v, "ta"), "harakat"), [], "arrow-up-down"),
    ).map((s) => (s.chart?.kind === "donut" && !s.rows.length ? { ...s, rows: donutRows(s.chart) } : s)),
  };
}

async function procurement(r: DashRange): Promise<RoleDashboard> {
  const [receipts, prevReceipts, requests, waiting] = await Promise.all([
    db.goodsReceipt.findMany({ where: { date: { gte: r.from, lt: r.to } }, select: { date: true, supplierId: true, supplier: { select: { name: true } }, items: { select: { qty: true, price: true, material: { select: { name: true } } } } } }),
    db.goodsReceiptItem.findMany({ where: { receipt: { date: { gte: r.prevFrom, lt: r.prevTo } } }, select: { qty: true, price: true } }),
    db.supplyRequest.findMany({ where: { createdAt: { gte: r.from, lt: r.to } }, select: { status: true, createdAt: true, receipt: { select: { date: true } } } }),
    db.supplyRequest.groupBy({ by: ["status"], where: { status: { in: ["NEW", "PRICED", "APPROVED", "FUNDED"] } }, _count: true }),
  ]);
  const recRows = receipts.map((x) => ({ date: x.date, supplier: x.supplier.name, amount: x.items.reduce((s, i) => s + sum(i.qty) * sum(i.price), 0), items: x.items }));
  const amount = recRows.reduce((s, x) => s + x.amount, 0), prevAmount = prevReceipts.reduce((s, i) => s + sum(i.qty) * sum(i.price), 0);
  const received = requests.filter((q) => q.receipt);
  const avgDays = received.length ? received.reduce((s, q) => s + (q.receipt!.date.getTime() - q.createdAt.getTime()) / DAY_MS, 0) / received.length : null;
  const waitTotal = waiting.reduce((s, w) => s + w._count, 0);
  const bars = barsChart(r, recRows, (x) => x.date, [{ label: "Xarid", value: (x) => x.amount, fmt: short }], `Jami ${short(amount)}`);
  const byMaterial = groupSum(recRows.flatMap((x) => x.items), (i) => i.material.name, (i) => sum(i.qty) * sum(i.price));
  return {
    hero: { key: "purchases", label: `Xarid (${r.label})`, value: short(amount), hint: joinHint(cnt(receipts.length, "hujjat"), deltaText(amount, prevAmount, r)), tone: "brand", icon: "cart" },
    tiles: [
      { key: "requests", label: "Ta'minot so'rovlari", value: String(requests.length), hint: `${received.length} qabul qilindi`, tone: "info", icon: "clipboard-list" },
      { key: "avg", label: "O'rtacha yetkazish", value: avgDays == null ? "—" : `${avgDays.toFixed(1)} kun`, hint: "so'rovdan kirimgacha", tone: avgDays != null && avgDays > 5 ? "warning" : "success", icon: "clock" },
      { key: "waiting", label: "Navbatda", value: String(waitTotal), hint: waitTotal ? waiting.map((w) => `${w._count} ${SUPPLY_LABEL[w.status].split(" ")[0].toLowerCase()}`).join(" · ") : "navbat bo'sh", tone: waitTotal ? "warning" : "success", icon: "hourglass" },
      { key: "suppliers", label: "Yetkazuvchilar", value: String(new Set(receipts.map((x) => x.supplierId)).size), hint: "davrda kirim bergan", tone: "success", icon: "store" },
    ],
    charts: pick(
      chartSection("Xarid dinamikasi", bars, barsRows(bars, [short]), "chart-column"),
      chartSection("Yetkazuvchilar bo'yicha", donutChart(groupSum(recRows, (x) => x.supplier, (x) => x.amount), short, "xarid"), [], "store"),
      chartSection("Materiallar bo'yicha", donutChart(byMaterial, short, "xarid"), [], "layers"),
      chartSection("So'rovlar holati", donutChart(groupSum(requests, (q) => SUPPLY_LABEL[q.status], count), (v) => cnt(v, "ta"), "so'rov"), [], "clipboard-list"),
    ).map((s) => (s.chart?.kind === "donut" && !s.rows.length ? { ...s, rows: donutRows(s.chart) } : s)),
  };
}

async function accounting(r: DashRange): Promise<RoleDashboard> {
  const [flow, invoices, recv, pay] = await Promise.all([
    moneyFlow(r),
    db.invoice.findMany({ where: { date: { gte: r.from, lt: r.to } }, select: { amount: true, status: true } }),
    receivables(), payables(),
  ]);
  const paySum = flow.pay.reduce((s, p) => s + sum(p.amount), 0);
  const invSum = invoices.reduce((s, i) => s + sum(i.amount), 0);
  const debtors: HomeRow[] = recv.list.slice(0, 5).map((c) => ({ id: c.id, title: c.name, subtitle: cnt(c.n, "ochiq schyot"), right: short(c.debt), tone: "danger" }));
  return {
    hero: { key: "payments", label: `To'lovlar (${r.label})`, value: short(paySum), hint: joinHint(cnt(flow.pay.length, "to'lov"), deltaText(paySum, flow.prevIn, r)), tone: "success", icon: "banknote" },
    tiles: [
      { key: "invoiced", label: "Schyot yozildi", value: short(invSum), hint: cnt(invoices.length, "schyot"), tone: "info", icon: "receipt" },
      { key: "receivable", label: "Debitorka", value: short(recv.total), hint: cnt(recv.count, "ochiq schyot"), tone: recv.total > 0 ? "danger" : "success", icon: "warning" },
      { key: "payable", label: "Kreditorka", value: short(pay.total), hint: cnt(pay.count, "ta'minot zayavkasi"), tone: pay.total > 0 ? "warning" : "success", icon: "clipboard-list" },
      { key: "expense", label: "Chiqim", value: short(flow.outSum), hint: deltaText(flow.outSum, flow.prevOut, r) ?? undefined, tone: "warning", icon: "arrow-up-circle" },
    ],
    charts: pick(
      chartSection("Kirim / chiqim", flow.bars, barsRows(flow.bars, [short, short]), "chart-column"),
      chartSection("Chiqim kategoriyalari", flow.expenseDonut, [], "chart-pie"),
      chartSection("Schyotlar holati", donutChart(groupSum(invoices, (i) => INVOICE_LABEL[i.status] ?? i.status, (i) => sum(i.amount)), short, "schyot"), [], "receipt"),
      debtors.length ? { title: "Top qarzdorlar", empty: "", target: "customers", rows: debtors } : null,
    ).map((s) => (s.chart?.kind === "donut" && !s.rows.length ? { ...s, rows: donutRows(s.chart) } : s)),
  };
}

async function finance(r: DashRange): Promise<RoleDashboard> {
  const now = new Date();
  const monthFrom = new Date(now.getFullYear(), now.getMonth(), 1), monthTo = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const [flow, accounts, budgets, monthExpense] = await Promise.all([
    moneyFlow(r), accountBalances(),
    db.expenseBudget.findMany({ where: { year: now.getFullYear(), month: now.getMonth() + 1 } }),
    db.cashTransaction.groupBy({ by: ["category"], where: { type: "EXPENSE", date: { gte: monthFrom, lt: monthTo } }, _sum: { amount: true } }),
  ]);
  const net = flow.inSum - flow.outSum, prevNet = flow.prevIn - flow.prevOut;
  const balance = accounts.reduce((s, a) => s + a.value, 0);
  const budgetItems = budgets.map((b) => progressItem(b.category, sum(monthExpense.find((m) => m.category === b.category)?._sum.amount), sum(b.amount), short, true, "cashflow"));
  const budgetTotal = budgets.reduce((s, b) => s + sum(b.amount), 0);
  const spentTotal = budgets.reduce((s, b) => s + sum(monthExpense.find((m) => m.category === b.category)?._sum.amount), 0);
  const budgetPct = budgetTotal > 0 ? (spentTotal / budgetTotal) * 100 : null;
  return {
    hero: { key: "net", label: `Sof pul oqimi (${r.label})`, value: shortSigned(net), hint: joinHint(`kirim ${short(flow.inSum)} · chiqim ${short(flow.outSum)}`, prevNet !== 0 && deltaText(Math.abs(net), Math.abs(prevNet), r)), tone: net >= 0 ? "success" : "danger", icon: "arrow-up-down" },
    tiles: [
      { key: "in", label: "Kirim", value: short(flow.inSum), hint: deltaText(flow.inSum, flow.prevIn, r) ?? undefined, tone: "success", icon: "arrow-down-circle" },
      { key: "out", label: "Chiqim", value: short(flow.outSum), hint: deltaText(flow.outSum, flow.prevOut, r) ?? undefined, tone: "warning", icon: "arrow-up-circle" },
      { key: "balance", label: "Kassa qoldig'i", value: shortSigned(balance), hint: cnt(accounts.length, "hisob"), tone: balance >= 0 ? "info" : "danger", icon: "wallet" },
      { key: "budget", label: "Byudjet (oy)", value: pctText(budgetPct), hint: budgets.length ? `${short(spentTotal)} / ${short(budgetTotal)}` : "byudjet belgilanmagan", tone: budgetPct == null ? "info" : budgetPct > 100 ? "danger" : budgetPct > 90 ? "warning" : "success", icon: "square-check" },
    ],
    charts: pick(
      chartSection("Pul oqimi", flow.bars, barsRows(flow.bars, [short, short]), "chart-column"),
      budgetItems.length ? chartSection("Byudjet — oy", { kind: "progress", items: budgetItems }, progressRows(budgetItems), "square-check") : null,
      chartSection("Xarajat kategoriyalari", flow.expenseDonut, [], "chart-pie"),
      chartSection("Hisoblar bo'yicha qoldiq", donutChart(accounts, shortSigned, "qoldiq"), [], "landmark", "Hisob yo'q"),
    ).map((s) => (s.chart?.kind === "donut" && !s.rows.length ? { ...s, rows: donutRows(s.chart) } : s)),
  };
}

async function cashier(r: DashRange): Promise<RoleDashboard> {
  const [flow, accounts] = await Promise.all([moneyFlow(r), accountBalances()]);
  const paySum = flow.pay.reduce((s, p) => s + sum(p.amount), 0);
  return {
    hero: { key: "payments", label: `Tushum (${r.label})`, value: short(paySum), hint: joinHint(cnt(flow.pay.length, "to'lov"), deltaText(paySum, flow.prevIn, r)), tone: "success", icon: "banknote" },
    tiles: [
      { key: "out", label: "Chiqim", value: short(flow.outSum), tone: "warning", icon: "arrow-up-circle" },
      { key: "balance", label: "Kassa qoldig'i", value: shortSigned(accounts.reduce((s, a) => s + a.value, 0)), hint: cnt(accounts.length, "hisob"), tone: "info", icon: "wallet" },
    ],
    charts: pick(
      chartSection("Kirim / chiqim", flow.bars, barsRows(flow.bars, [short, short]), "chart-column"),
      chartSection("Hisoblar bo'yicha qoldiq", donutChart(accounts, shortSigned, "qoldiq"), [], "landmark", "Hisob yo'q"),
    ).map((s) => (s.chart?.kind === "donut" && !s.rows.length ? { ...s, rows: donutRows(s.chart) } : s)),
  };
}

async function hr(r: DashRange): Promise<RoleDashboard> {
  const [att, prevAtt, hired, fired, active, positions] = await Promise.all([
    db.attendance.findMany({ where: { date: { gte: r.from, lt: r.to } }, select: { date: true, status: true } }),
    db.attendance.groupBy({ by: ["status"], where: { date: { gte: r.prevFrom, lt: r.prevTo } }, _count: true }),
    db.employee.count({ where: { hiredAt: { gte: r.from, lt: r.to } } }),
    db.employee.count({ where: { firedAt: { gte: r.from, lt: r.to } } }),
    db.employee.count({ where: { isActive: true } }),
    db.employee.groupBy({ by: ["position"], where: { isActive: true }, _count: true }),
  ]);
  const by = (s: string) => att.filter((a) => a.status === s).length;
  const present = by("PRESENT"), absent = by("ABSENT"), sick = by("SICK"), leave = by("LEAVE");
  const marked = present + absent + sick + leave;
  const pct = marked ? (present / marked) * 100 : null;
  const prevMarked = prevAtt.filter((p) => p.status !== "DAYOFF").reduce((s, p) => s + p._count, 0);
  const prevPct = prevMarked ? ((prevAtt.find((p) => p.status === "PRESENT")?._count ?? 0) / prevMarked) * 100 : 0;
  const bars = r.gran === "hour" ? null : barsChart(r, att, (a) => a.date, [
    { label: "Keldi", value: (a) => (a.status === "PRESENT" ? 1 : 0), fmt: (v) => cnt(v, "kishi") },
    { label: "Kelmadi", value: (a) => (a.status === "ABSENT" ? 1 : 0), fmt: (v) => cnt(v, "kishi") },
  ], `${present} keldi · ${absent} kelmadi`);
  return {
    hero: { key: "attendance", label: `Davomat (${r.label})`, value: pctText(pct), hint: joinHint(marked ? `${present} keldi · ${absent} kelmadi` : "davomat belgilanmagan", pct != null && deltaText(pct, prevPct, r)), tone: pct == null ? "info" : pct >= 90 ? "success" : pct >= 75 ? "warning" : "danger", icon: "calendar" },
    tiles: [
      { key: "absent", label: "Kelmadi", value: String(absent), hint: "sababsiz", tone: absent ? "danger" : "success", icon: "user-x" },
      { key: "sick", label: "Kasal / ta'til", value: `${sick} / ${leave}`, tone: "info", icon: "heart-pulse" },
      { key: "hired", label: "Yangi xodim", value: String(hired), hint: fired ? `${fired} bo'shadi` : undefined, tone: "success", icon: "user-plus" },
      { key: "active", label: "Faol xodim", value: String(active), hint: cnt(positions.length, "lavozim"), tone: "brand", icon: "people" },
    ],
    charts: pick(
      bars ? chartSection("Davomat dinamikasi", bars, barsRows(bars, [(v) => cnt(v, "kishi"), (v) => cnt(v, "kishi")]), "chart-column") : null,
      chartSection("Davomat tarkibi", donutChart(groupSum(att, (a) => ATT_LABEL[a.status] ?? a.status, count), (v) => cnt(v, "belgi"), "belgi"), [], "calendar"),
      chartSection("Lavozimlar bo'yicha", donutChart(positions.map((p) => ({ label: p.position, value: p._count })), (v) => cnt(v, "kishi"), "xodim"), [], "id-card", "Faol xodim yo'q"),
    ).map((s) => (s.chart?.kind === "donut" && !s.rows.length ? { ...s, rows: donutRows(s.chart) } : s)),
  };
}

async function driver(user: MobileUser, r: DashRange): Promise<RoleDashboard | null> {
  const me = await db.employee.findFirst({ where: { userId: user.id }, select: { id: true } });
  if (!me) return null;
  const [delivered, prev, created, fuel, issues] = await Promise.all([
    db.trip.findMany({ where: { driverId: me.id, status: "DELIVERED", deliveredAt: { gte: r.from, lt: r.to } }, select: { deliveredAt: true, qtyM3: true, order: { select: { distanceKm: true, customer: { select: { name: true } }, items: { select: { qtyM3: true, product: { select: { unit: true } } } } } } } }),
    db.trip.aggregate({ where: { driverId: me.id, status: "DELIVERED", deliveredAt: { gte: r.prevFrom, lt: r.prevTo } }, _sum: { qtyM3: true } }),
    db.trip.groupBy({ by: ["status"], where: { driverId: me.id, createdAt: { gte: r.from, lt: r.to } }, _count: true }),
    db.fuelLog.aggregate({ where: { driverId: me.id, date: { gte: r.from, lt: r.to } }, _sum: { amount: true, liters: true } }),
    db.tripIssue.count({ where: { createdAt: { gte: r.from, lt: r.to }, trip: { driverId: me.id } } }),
  ]);
  const rows = delivered.map((t) => ({ date: t.deliveredAt!, qty: t.qtyM3, unit: soleUnit(t.order.items.map((i) => ({ unit: i.product.unit, qty: i.qtyM3 }))) ?? "m3", customer: t.order.customer.name, km: sum(t.order.distanceKm) * 2 }));
  const qty = rows.reduce((s, x) => s + sum(x.qty), 0);
  const km = rows.reduce((s, x) => s + x.km, 0);
  const total = created.reduce((s, c) => s + c._count, 0), cancelled = created.find((c) => c.status === "CANCELLED")?._count ?? 0;
  const u = mainUnit(rows)?.unit ?? "m3";
  const bars = barsChart(r, rows, (x) => x.date, [{ label: "Reyslar", value: count, fmt: (v) => cnt(v, "reys") }, { label: "Hajm", value: (x) => sum(x.qty), fmt: (v) => inUnit(v, u) }], `${cnt(rows.length, "reys")} · ${totalsText(unitRows(rows))}`);
  return {
    hero: { key: "delivered", label: `Yetkazdim (${r.label})`, value: totalsText(unitRows(rows)), hint: joinHint(cnt(rows.length, "reys"), deltaText(qty, sum(prev._sum.qtyM3), r)), tone: "brand", icon: "truck" },
    tiles: [
      { key: "trips", label: "Reyslar", value: String(total), hint: cancelled ? `${cancelled} bekor` : "biriktirilgan", tone: "info", icon: "navigate" },
      { key: "km", label: "Yo'l (taxminan)", value: `${Math.round(km)} km`, hint: "zavod → obyekt → zavod", tone: "info", icon: "map-pin" },
      { key: "fuel", label: "Yoqilg'i", value: `${num(sum(fuel._sum.liters))} l`, hint: short(sum(fuel._sum.amount)) + " so'm", tone: "warning", icon: "droplets" },
      { key: "issues", label: "Muammolar", value: String(issues), hint: issues ? "qayd qilingan" : "muammo bo'lmadi", tone: issues ? "warning" : "success", icon: "triangle-alert" },
    ],
    charts: pick(
      chartSection("Reyslar dinamikasi", bars, barsRows(bars, [(v) => cnt(v, "reys"), (v) => inUnit(v, u)]), "chart-column"),
      chartSection("Mijozlar bo'yicha", donutChart(groupSum(rows.filter((x) => x.unit === u), (x) => x.customer, (x) => sum(x.qty)), (v) => inUnit(v, u), "hajm"), [], "users"),
    ).map((s) => (s.chart?.kind === "donut" && !s.rows.length ? { ...s, rows: donutRows(s.chart) } : s)),
  };
}

// ───────────────────────── Kirish nuqtasi ─────────────────────────

/** Bir xil so'rov 20 soniya keshda — ilova bosh ekranni 30 s da yangilaydi, bir bo'limda bir necha xodim bo'lishi mumkin. */
const cache = new Map<string, { at: number; data: Promise<RoleDashboard | null> }>();
const TTL = 20_000;

export async function roleDashboard(user: MobileUser, r: DashRange): Promise<RoleDashboard | null> {
  const personal = user.role === "SALES" || user.role === "DRIVER" || user.role === "BRIGADIER";
  const key = `${user.role}:${personal ? user.id : "*"}:${r.key}:${r.from.getTime()}:${r.to.getTime()}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.data;
  const data = build(user, r).then((d) => {
    if (!d) return d;
    // Bosh ko'rsatkichda davr filtri — ilova tugmalarni shu yerdan oladi
    d.hero.filterParam = PERIOD_PARAM; d.hero.filters = r.filters; d.hero.range = r.range;
    return d;
  });
  cache.set(key, { at: Date.now(), data });
  data.catch(() => cache.delete(key));
  if (cache.size > 200) for (const [k, v] of cache) if (Date.now() - v.at > TTL) cache.delete(k);
  return data;
}

async function build(user: MobileUser, r: DashRange): Promise<RoleDashboard | null> {
  switch (user.role) {
    case "PRODUCTION": return production(r);
    case "SALES": return sales(user, r);
    case "SUPERVISOR": return brigadeWork(r, null, false);
    case "BRIGADIER": {
      const mine = await myBrigades(user.id);
      return mine.length ? brigadeWork(r, mine.map((b) => b.id), true) : null;
    }
    case "LOGISTICS": return logistics(r);
    case "WAREHOUSE": return warehouse(r);
    case "PROCUREMENT": return procurement(r);
    case "ACCOUNTING": return accounting(r);
    case "FINANCE": return finance(r);
    case "CASHIER": return cashier(r);
    case "HR": return hr(r);
    case "DRIVER": return driver(user, r);
    default: return null;
  }
}

