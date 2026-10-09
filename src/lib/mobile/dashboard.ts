import { db } from "@/lib/db";
import { FLOW_ONLY, balanceFromGroups } from "@/lib/cash-tx";
import { receivablesReport } from "@/lib/receivables";
import { loadSales } from "@/lib/bi/core";
import { myBrigades } from "@/lib/brigades";
import { ISSUE_KIND } from "@/lib/logistics";
import { SUPPLY_LABEL } from "@/lib/supply";
import { payables } from "./payables";
import { procurementHome } from "@/lib/procurement-home";
import { skladLogistika } from "@/lib/sklad-logistika";
import { DELIVERY_LABEL, PRIORITY_LABEL, REQUISITION_LABEL } from "@/lib/procurement-const";
import { unitLabel, unitTotals, soleUnit, type UnitRow } from "@/lib/unit";
import { day, inUnit, num, pctText, short, shortSigned, sum, time, totalsText } from "./fmt";
import { productionStaff } from "@/lib/production-staff";
import { stockStatus } from "@/lib/production-report";
import { periodAttendance, periodPlan } from "@/lib/period-stats";
import { dayUtc } from "@/lib/davomat";
import { periodId } from "./sex";
import { BRIGADE_ISSUE, dayPlan, taskPhase } from "@/lib/brigade-shift";
import { lineTotal } from "@/lib/receipt-vat";
import { tripPayKm } from "@/lib/trip-summary";
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
export const ymd = (d: Date) => fmtYmd(d);
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

/**
 * Oylik ko'rsatkich (sotuv plani, xarajat byudjeti) davrga qanchalik tushadi: davr kesib o'tgan har oy
 * va uning ulushi (kalendar kunlari bo'yicha) — hafta ≈ oylik planning 7/30 qismi, yil — 12 oy yig'indisi.
 */
export function monthShares(r: DashRange): { year: number; month: number; share: number }[] {
  const out: { year: number; month: number; share: number }[] = [];
  for (let d = new Date(r.from.getFullYear(), r.from.getMonth(), 1); d < r.to; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
    const mEnd = new Date(d.getFullYear(), d.getMonth() + 1, 1);
    const a = Math.max(d.getTime(), r.from.getTime()), b = Math.min(mEnd.getTime(), r.to.getTime());
    if (b > a) out.push({ year: d.getFullYear(), month: d.getMonth() + 1, share: (b - a) / (mEnd.getTime() - d.getTime()) });
  }
  return out;
}
const scaled = <T extends { year: number; month: number }>(rows: T[], r: DashRange, value: (x: T) => number) => {
  const sh = monthShares(r);
  return rows.reduce((s, x) => s + value(x) * (sh.find((m) => m.year === x.year && m.month === x.month)?.share ?? 0), 0);
};

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
export const ORDER_LABEL: Record<string, string> = { DRAFT: "Qoralama", BLOCKED: "Bloklangan", CONFIRMED: "Tasdiqlangan", IN_PRODUCTION: "Ishlab chiqarishda", DELIVERED: "Yetkazildi", CLOSED: "Yopildi", CANCELLED: "Bekor" };
export const INVOICE_LABEL: Record<string, string> = { OPEN: "Ochiq", PARTIAL: "Qisman", PAID: "To'langan", CANCELLED: "Bekor" };
const VEHICLE_LABEL: Record<string, string> = { ACTIVE: "Saflda", REPAIR: "Ta'mirda", IDLE: "Bekor turibdi" };
export const ATT_LABEL: Record<string, string> = { PRESENT: "Keldi", ABSENT: "Kelmadi", LEAVE: "Ta'til", SICK: "Kasal", DAYOFF: "Dam olish" };
export const MOVE_LABEL: Record<string, string> = { RECEIPT: "Kirim", PRODUCTION_CONSUME: "Zames sarfi", PRODUCTION_OUTPUT: "Tayyor mahsulot", SHIPMENT: "Jo'natish", ADJUSTMENT: "Inventarizatsiya", WRITE_OFF: "Hisobdan chiqarish", BRIGADE_ISSUE: "Brigadaga berildi", BRIGADE_RETURN: "Brigadadan qaytdi" };

export type RoleDashboard = { hero: HomeCard; tiles: HomeCard[]; charts: HomeSection[] };
const pick = (...s: (HomeSection | null)[]) => s.filter((x): x is HomeSection => !!x);

// ───────────────────────── Umumiy so'rovlar ─────────────────────────

/** Kirim (mijoz to'lovlari + boshqa tushum) va chiqim — davr bo'yicha; buxgalteriya, moliya, kassa uchun. */
async function moneyFlow(r: DashRange) {
  const [pay, tx, prevPay, prevTx] = await Promise.all([
    db.payment.findMany({ where: { date: { gte: r.from, lt: r.to } }, select: { date: true, amount: true, cashAccountId: true, customerId: true } }),
    // Boshlang'ich qoldiq va hisoblararo o'tkazma — oqim emas
    db.cashTransaction.findMany({ where: { ...FLOW_ONLY, date: { gte: r.from, lt: r.to } }, select: { date: true, amount: true, type: true, category: true, cashAccountId: true } }),
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

/**
 * Davr oxirida ishlagan xodimlar: joriy davrda — hozir faollar; o'tgan davrda — shu paytgacha ishga kirgan
 * (sana yo'q bo'lsa kartasi ochilgan) va hali bo'shamagan.
 */
export const staffAt = (r: DashRange) => {
  const at = r.to < new Date() ? r.to : null;
  return at
    ? { OR: [{ hiredAt: { lt: at } }, { hiredAt: null, createdAt: { lt: at } }], AND: [{ OR: [{ firedAt: null, isActive: true }, { firedAt: { gte: at } }] }] }
    : { isActive: true };
};

/** Davr oxiri: o'tgan davr tanlansa — o'sha paytdagi holat; joriy davrda — hozir (null). */
export const asOf = (r: DashRange) => (r.to < new Date() ? r.to : null);

/** Hisoblar bo'yicha qoldiq (kassa va bank alohida) — `until` gacha (berilmasa hozirgi). */
async function accountBalances(until: Date | null = null) {
  const d = until ? { date: { lt: until } } : {};
  const [accounts, pay, tx] = await Promise.all([
    db.cashAccount.findMany({ where: { isActive: true }, select: { id: true, name: true } }),
    db.payment.groupBy({ by: ["cashAccountId"], where: d, _sum: { amount: true } }),
    db.cashTransaction.groupBy({ by: ["cashAccountId", "type"], where: d, _sum: { amount: true } }),
  ]);
  return accounts.map((a) => ({
    label: a.name,
    // Kirim + boshlang'ich qoldiq + o'tkazma kirdi − chiqim − o'tkazma chiqdi (ishora — txSign)
    value: sum(pay.find((p) => p.cashAccountId === a.id)?._sum.amount) + balanceFromGroups(tx, a.id),
  }));
}

/**
 * Debitorka — mijoz kesimida, yagona hisob (`lib/receivables.ts`): schyotlar − barcha to'lovlar (avans ham).
 * `until` berilsa — o'sha paytdagi qarz (shu vaqtgacha yozilgan schyotlar va kelgan to'lovlar), aks holda hozirgi.
 * `count` — FIFO bo'yicha to'lanmagan qismi qolgan schyotlar soni.
 */
export async function receivables(until: Date | null = null) {
  const r = await receivablesReport({ asOf: until });
  const list = r.rows.map((c) => ({ id: c.customerId, name: c.name, debt: c.debt, n: c.items.length }));
  return { total: r.total, advance: r.advance, overdue: r.overdue, count: list.reduce((s, c) => s + c.n, 0), list };
}


// ───────────────────────── Rollar ─────────────────────────

async function production(r: DashRange): Promise<RoleDashboard> {
  const isDay = r.key === "day";
  const [batches, prev, defects, progress, pp, staff, stock, reports] = await Promise.all([
    db.productionBatch.findMany({ where: { cancelledAt: null, date: { gte: r.from, lt: r.to } }, select: { date: true, qtyM3: true, shift: true, productId: true, product: { select: { name: true, unit: true } } } }),
    db.productionBatch.findMany({ where: { cancelledAt: null, date: { gte: r.prevFrom, lt: r.prevTo } }, select: { qtyM3: true, product: { select: { unit: true } } } }),
    db.productDefect.findMany({ where: { date: { gte: r.from, lt: r.to } }, select: { qty: true, reason: true, product: { select: { unit: true } } } }),
    db.taskProgress.findMany({ where: { date: { gte: r.from, lt: r.to } }, select: { qty: true, task: { select: { orderItem: { select: { product: { select: { unit: true } } } } } } } }),
    // Plan — tanlangan davrga bo'lingan (oylik plan ÷ ish kunlari × davrdagi ish kunlari)
    periodPlan(r.from, r.to),
    productionStaff(),
    // Sklad — davr oxirigacha yetkazilishi kerak bo'lgan zayavkalarga yetadimi
    stockStatus({ until: r.to }),
    db.productionReport.findMany({ where: { date: { gte: dayUtc(ymd(r.from)), lt: dayUtc(ymd(r.to)) } }, orderBy: { createdAt: "desc" }, select: { date: true, createdAt: true, seenAt: true } }),
  ]);
  // Davomat: "bugun" — jonli (kim keldi), boshqa davr — shu davr bo'yicha yig'indi
  const att = isDay ? null : await periodAttendance(staff.members.map((m) => m.id), r.from, r.to);
  // Karta bosilsa — shu davr bo'yicha batafsil (`lib/mobile/sex.ts`)
  const pid = periodId(r);
  const open = (stat: string, withPeriod = true) => ({ key: "sex", id: withPeriod ? `${stat}.${pid}` : stat });
  const lowStock = stock.filter((m) => m.level !== "ok");
  const shortStock = stock.filter((m) => m.level === "short");
  // Olib kelish kerak bo'lganlar: zayavkaga yetmaganlari birinchi, keyin eng ko'p yetishmagani
  const needList = stock.filter((m) => m.need > 0).sort((a, b) => Number(b.orderGap > 0) - Number(a.orderGap > 0) || (a.days ?? 1e9) - (b.days ?? 1e9));
  const reportDays = new Set(reports.map((x) => x.date.toISOString().slice(0, 10))).size;
  const wdElapsed = pp.elapsed;
  const rows = batches.map((b) => ({ qty: b.qtyM3, unit: b.product.unit, date: b.date, name: b.product.name, shift: b.shift }));
  const main = mainUnit(rows);
  const prevMain = main ? unitSum(prev.map((b) => ({ qty: b.qtyM3, unit: b.product.unit })), main.unit) : 0;
  const defRows = defects.map((d) => ({ qty: d.qty, unit: d.product.unit, reason: d.reason }));
  const progRows = progress.map((p) => ({ qty: p.qty, unit: p.task.orderItem.product.unit }));
  const planItems = pp.rows.map((p) => progressItem(p.product.name, p.fact, p.plan, (v) => inUnit(v, p.product.unit)));
  const avgPlan = pp.avgPct == null ? null : Math.round(pp.avgPct);
  const defectMain = main ? unitSum(defRows, main.unit) : 0;
  const defectPct = main && main.qty > 0 ? (defectMain / (main.qty + defectMain)) * 100 : null;
  const series = unitSeries(rows);
  const bars = barsChart(r, rows, (x) => x.date, series, `Jami ${totalsText(unitRows(rows))}`);
  return {
    hero: { key: "produced", label: `Ishlab chiqarildi (${r.label})`, value: totalsText(unitRows(rows)), hint: joinHint(cnt(batches.length, "zames"), main && deltaText(main.qty, prevMain, r)), tone: "brand", icon: "factory", open: open("produced") },
    tiles: [
      // Sex tarkibi va davomat: "bugun" — jonli; boshqa davr — shu davr bo'yicha yig'indi
      att
        ? { key: "staff", label: `Sex xodimlari (${r.label})`, value: `${num(att.avgPresent)} / ${staff.total}`, hint: joinHint(`kuniga o'rtacha keldi · ${att.days} kun`, staff.unassigned > 0 && `${staff.unassigned} taqsimlanmagan`), tone: "info", icon: "users", open: open("staff") }
        : { key: "staff", label: "Sex xodimlari", value: `${staff.present} / ${staff.total}`, hint: joinHint("ishga keldi (bugun)", staff.unassigned > 0 && `${staff.unassigned} taqsimlanmagan`), tone: staff.total && staff.present === staff.total ? "success" : "info", icon: "users", open: open("staff") },
      att
        ? { key: "attendance", label: `Davomat (${r.label})`, value: pctText(att.pct), hint: att.marked ? joinHint(`keldi ${att.byStatus.PRESENT}`, att.byStatus.ABSENT > 0 && `kelmadi ${att.byStatus.ABSENT}`, att.byStatus.SICK + att.byStatus.LEAVE > 0 && `kasal/ta'til ${att.byStatus.SICK + att.byStatus.LEAVE}`, "kishi-kun") : "davomat belgilanmagan", tone: att.pct == null ? "warning" : att.pct >= 90 ? "success" : att.pct >= 75 ? "warning" : "danger", icon: "user-check", open: open("attendance") }
        : { key: "attendance", label: "Davomat", value: staff.notMarked ? `${staff.notMarked} belgilanmagan` : "Belgilangan", hint: joinHint(`keldi ${staff.present}`, staff.absent > 0 && `kelmadi ${staff.absent}`, staff.sick + staff.leave > 0 && `kasal/ta'til ${staff.sick + staff.leave}`), tone: staff.notMarked ? "warning" : "success", icon: "user-check", open: open("attendance") },
      { key: "plan", label: `Plan (${r.label})`, value: pctText(avgPlan), hint: planItems.length ? `${planItems.length} mahsulot · ${pp.elapsed}/${pp.workDays} ish kuni` : "plan belgilanmagan", tone: avgPlan == null ? "info" : avgPlan >= 90 ? "success" : avgPlan >= 60 ? "warning" : "danger", icon: "square-check", open: open("plan") },
      { key: "defect", label: "Brak", value: totalsText(unitRows(defRows)), hint: joinHint(cnt(defects.length, "qayd"), defectPct != null && `${defectPct.toFixed(1)}%`), tone: defects.length ? (defectPct != null && defectPct > 2 ? "danger" : "warning") : "success", icon: "triangle-alert", open: open("defect") },
      { key: "brigades", label: "Brigadalar bajardi", value: totalsText(unitRows(progRows)), hint: cnt(progress.length, "qayd"), tone: "success", icon: "hard-hat", open: open("brigades") },
      // Son emas — nima va qancha kam: birinchisi qiymatda, qolganlari izohda (zayavkaga yetmaganlari oldin)
      { key: "stock", label: "Sklad holati", value: needList[0] ? `${needList[0].name} −${num(needList[0].need)} ${needList[0].unit}` : "Yetarli", hint: needList.length > 1 ? `yana: ${needList.slice(1, 4).map((m) => `${m.name} ${num(m.need)} ${m.unit}`).join(", ")}${needList.length > 4 ? ` +${needList.length - 4}` : ""}` : needList.length ? (needList[0].orderGap > 0 ? `zayavkalarga yetmaydi` : "minimal qoldiqdan kam") : `${stock.length} xomashyo`, tone: shortStock.length ? "danger" : lowStock.length ? "warning" : "success", icon: "warehouse", open: open("stock") },
      isDay
        ? { key: "report", label: "Kunlik hisobot", value: reports.length ? "Qayd etildi" : "Qayd etilmagan", hint: reports.length ? `${time(reports[0].createdAt)} · ${reports[0].seenAt ? "direktor ko'rdi" : "direktorga yuborildi"}` : "ko'rib, «Qayd etish» ni bosing", tone: reports.length ? "success" : "warning", icon: "file-text", open: open("report", false) }
        // Davrda: nechta ish kunida hisobot qayd etilgan — ro'yxat "Ishlab chiqarish hisobotlari"
        : { key: "report", label: `Hisobotlar (${r.label})`, value: `${reportDays} / ${wdElapsed}`, hint: joinHint("ish kunida qayd etildi", reports.some((x) => !x.seenAt) && `${reports.filter((x) => !x.seenAt).length} tasi direktor ko'rmagan`), tone: reportDays >= wdElapsed ? "success" : "warning", icon: "file-text", open: { key: "prod-report" } },
    ],
    charts: pick(
      chartSection("Ishlab chiqarish dinamikasi", bars, barsRows(bars, series.map((s) => s.fmt)), "chart-column"),
      planItems.length ? chartSection(`Plan / fakt (${r.label})`, { kind: "progress", items: planItems }, progressRows(planItems), "square-check") : null,
      main ? chartSection(`Mahsulotlar ulushi (${unitLabel(main.unit)})`, donutChart(groupSum(rows.filter((x) => (x.unit || "m3") === main.unit), (x) => x.name, (x) => sum(x.qty)), (v) => inUnit(v, main.unit)), [], "chart-pie") : null,
      chartSection("Brak sabablari", donutChart(groupSum(defRows, (x) => x.reason, (x) => sum(x.qty)), (v) => num(v)), [], "triangle-alert"),
      // Sklad: kam qolgan xomashyo va qancha olib kelish kerak — qator bosilsa xomashyo kartochkasi
      lowStock.length ? {
        title: `Sklad — ${r.label} zayavkalariga kam`, empty: "", target: "stock", icon: "warehouse",
        rows: lowStock.slice(0, 6).map((m) => ({
          id: m.id, title: m.name,
          subtitle: `skladda ${num(m.balance)} ${m.unit}${m.planned > 0 ? ` · zayavkalarga ${num(m.planned)} ${m.unit} (${m.orders.length} ta)` : ""}${m.days !== null ? ` · ${m.days > 999 ? ">999" : m.days.toFixed(1)} kunga` : ""}`,
          right: m.need > 0 ? `${num(m.need)} ${m.unit} kam` : "kam", tone: m.level === "short" ? "danger" as Tone : "warning" as Tone,
        })),
      } : null,
    ).map((s) => (s.chart?.kind === "donut" && !s.rows.length ? { ...s, rows: donutRows(s.chart) } : s)),
  };
}

async function sales(user: MobileUser, r: DashRange): Promise<RoleDashboard> {
  const months = monthShares(r).map(({ year, month }) => ({ year, month }));
  const [cur, prev, orders, leads, newCustomers, plans] = await Promise.all([
    loadSales(r.from, r.to), loadSales(r.prevFrom, r.prevTo),
    db.order.findMany({ where: { date: { gte: r.from, lt: r.to }, kind: "SALE" }, select: { status: true, createdById: true } }),
    db.lead.findMany({ where: { createdAt: { gte: r.from, lt: r.to } }, select: { status: true } }),
    db.customer.count({ where: { createdAt: { gte: r.from, lt: r.to }, isInternal: false } }),
    db.salesPlan.findMany({ where: { OR: months } }),
  ]);
  const revenue = cur.reduce((s, x) => s + x.revenue, 0), prevRevenue = prev.reduce((s, x) => s + x.revenue, 0);
  const mine = cur.filter((x) => x.sellerId === user.id).reduce((s, x) => s + x.revenue, 0);
  // Plan — tanlangan davrga bo'lingan oylik plan; fakt — shu davr sotuvi
  const planAll = scaled(plans.filter((p) => !p.sellerId), r, (p) => sum(p.amount));
  const planMine = scaled(plans.filter((p) => p.sellerId === user.id), r, (p) => sum(p.amount));
  const planItems = [
    ...(planAll > 0 ? [progressItem(`Umumiy plan (${r.label})`, revenue, planAll, short)] : []),
    ...(planMine > 0 ? [progressItem(`Mening planim (${r.label})`, mine, planMine, short)] : []),
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
      planItems.length ? chartSection(`Sotuv plani — ${r.label}`, { kind: "progress", items: planItems }, progressRows(planItems), "square-check") : null,
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
    // Ochiq — muddati davr oxirigacha bo'lgan (kechikkanlari ham) hali bajarilmagan topshiriqlar
    db.brigadeTask.findMany({ where: { ...bw, status: { in: ["NEW", "IN_PROGRESS"] }, dueDate: { lt: r.to } }, orderBy: { dueDate: "asc" }, select: { id: true, taskNo: true, qty: true, doneQty: true, dueDate: true, brigadeId: true, brigade: { select: { name: true } }, orderItem: { select: { product: { select: { name: true, unit: true } } } } } }),
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
      { key: "open", label: `Ochiq topshiriq (${r.label})`, value: String(open.length), hint: totalsText(open.map((t) => ({ unit: t.orderItem.product.unit, qty: sum(t.qty) - sum(t.doneQty) }))) + " qoldi · muddati davr oxirigacha", tone: open.length ? "info" : "success", icon: "list" },
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

/**
 * Brigadir dashboardi ("Brigadir Dashboard" hujjati, 1-qator): Reja | Fakt | Bajarilish % | Jarayonda |
 * Kechikkan | Brak, keyin reja/fakt grafigi, topshiriqlar bajarilishi, sifat nazorati, muammo turlari.
 * Reja: "Bugun" — muddati bugungacha bo'lgan topshiriqlarning kun boshidagi qoldig'i (`dayPlan`);
 * boshqa davrda — muddati shu davrga tushgan topshiriqlar hajmi.
 */
async function brigadier(r: DashRange, brigadeIds: string[]): Promise<RoleDashboard> {
  const bw = { brigadeId: { in: brigadeIds } };
  const [progress, prev, due, open, defects, issues, openIssues, dp] = await Promise.all([
    db.taskProgress.findMany({ where: { date: { gte: r.from, lt: r.to }, task: bw }, select: { date: true, qty: true, task: { select: { orderItem: { select: { product: { select: { name: true, unit: true } } } } } } } }),
    db.taskProgress.findMany({ where: { date: { gte: r.prevFrom, lt: r.prevTo }, task: bw }, select: { qty: true, task: { select: { orderItem: { select: { product: { select: { unit: true } } } } } } } }),
    db.brigadeTask.findMany({ where: { ...bw, status: { not: "CANCELLED" }, dueDate: { gte: r.from, lt: r.to } }, select: { dueDate: true, qty: true, orderItem: { select: { product: { select: { unit: true } } } } } }),
    db.brigadeTask.findMany({ where: { ...bw, status: { in: ["NEW", "IN_PROGRESS"] }, dueDate: { lt: r.to } }, orderBy: { dueDate: "asc" }, select: { id: true, taskNo: true, qty: true, doneQty: true, status: true, startedAt: true, dueDate: true, orderItem: { select: { product: { select: { name: true, unit: true } } } }, issues: { where: { resolvedAt: null }, select: { kind: true } } } }),
    db.productDefect.findMany({ where: { ...bw, date: { gte: r.from, lt: r.to } }, select: { qty: true, product: { select: { name: true, unit: true } } } }),
    db.brigadeIssue.findMany({ where: { ...bw, createdAt: { gte: r.from, lt: r.to } }, select: { kind: true, downtimeMin: true } }),
    // Davrda ochilgan va hali hal qilinmagan muammolar
    db.brigadeIssue.count({ where: { ...bw, resolvedAt: null, createdAt: { gte: r.from, lt: r.to } } }),
    r.key === "day" ? dayPlan(brigadeIds) : null,
  ]);
  const facts = progress.map((p) => ({ date: p.date, qty: p.qty, unit: p.task.orderItem.product.unit, product: p.task.orderItem.product.name }));
  const plans: UnitRow[] = dp ? dp.units.map((u) => ({ unit: u.unit, qty: u.plan })) : unitRows(due.map((t) => ({ qty: t.qty, unit: t.orderItem.product.unit })));
  const main = unitTotals(plans).sort((a, b) => b.qty - a.qty)[0] ?? mainUnit(facts);
  const planMain = main ? unitTotals(plans).find((u) => u.unit === main.unit)?.qty ?? 0 : 0;
  const factMain = main ? unitSum(facts, main.unit) : 0;
  const pct = planMain > 0 ? (factMain / planMain) * 100 : null;
  const phases = open.map((t) => ({ t, ph: taskPhase(t, t.issues.map((i) => i.kind)) }));
  const inWork = phases.filter((x) => x.t.startedAt || x.t.status === "IN_PROGRESS").length;
  const fresh = phases.filter((x) => !x.t.startedAt && x.t.status === "NEW").length;
  const overdue = phases.filter((x) => x.ph.late).length;
  const defMain = main ? unitSum(defects.map((d) => ({ qty: d.qty, unit: d.product.unit })), main.unit) : 0;
  const defPct = factMain > 0 ? (defMain / factMain) * 100 : null;
  const downtime = issues.reduce((s, i) => s + (i.downtimeMin ?? 0), 0);

  // Reja / fakt grafigi — asosiy birlikda; "Bugun" da soatlab reja bo'lmaydi, topshiriqlar kesimi qoladi
  const u = main?.unit ?? "m3";
  type PF = { date: Date; plan: number; fact: number };
  const pf: PF[] = [
    ...due.filter((t) => (t.orderItem.product.unit || "m3") === u).map((t) => ({ date: t.dueDate, plan: sum(t.qty), fact: 0 })),
    ...facts.filter((x) => (x.unit || "m3") === u).map((x) => ({ date: x.date, plan: 0, fact: sum(x.qty) })),
  ];
  const bars = r.key === "day" ? null : barsChart(r, pf, (x) => x.date, [
    { label: "Reja", value: (x) => x.plan, fmt: (v) => inUnit(v, u) },
    { label: "Fakt", value: (x) => x.fact, fmt: (v) => inUnit(v, u) },
  ], `Reja ${inUnit(planMain, u)} · fakt ${inUnit(factMain, u)}`);
  const taskItems = dp
    ? dp.rows.map((t) => progressItem(`${t.taskNo} · ${t.product}`, t.fact, t.plan, (v) => inUnit(v, t.unit), false, "tasks"))
    : open.slice(0, 8).map((t) => progressItem(`${t.taskNo} · ${t.orderItem.product.name}`, sum(t.doneQty), sum(t.qty), (v) => inUnit(v, t.orderItem.product.unit), false, "tasks"));

  // Sifat nazorati (E blok): mahsulot bo'yicha ishlab chiqarilgan, qabul qilingan, brak, brak %
  const byProduct = new Map<string, { unit: string; made: number; bad: number }>();
  for (const x of facts) { const k = byProduct.get(x.product) ?? { unit: x.unit, made: 0, bad: 0 }; k.made += sum(x.qty); byProduct.set(x.product, k); }
  for (const d of defects) { const k = byProduct.get(d.product.name) ?? { unit: d.product.unit, made: 0, bad: 0 }; k.bad += sum(d.qty); byProduct.set(d.product.name, k); }
  const quality: HomeRow[] = [...byProduct].sort((a, b) => b[1].made - a[1].made).map(([name, v], i) => {
    const p = v.made > 0 ? (v.bad / v.made) * 100 : v.bad > 0 ? 100 : 0;
    return { id: `q${i}`, title: name, subtitle: `ishlab chiqarildi ${inUnit(v.made, v.unit)} · qabul ${inUnit(Math.max(0, v.made - v.bad), v.unit)}`, right: v.bad ? `brak ${inUnit(v.bad, v.unit)} · ${pctText(p)}` : "brak yo'q", tone: p > 5 ? "danger" : p > 2 ? "warning" : "success" };
  });

  return {
    hero: { key: "fact", label: `Fakt (${r.label})`, value: totalsText(unitRows(facts)), hint: joinHint(planMain ? `reja ${inUnit(planMain, u)} · ${pctText(pct)}` : "reja yo'q", main && deltaText(factMain, unitSum(prev.map((p) => ({ qty: p.qty, unit: p.task.orderItem.product.unit })), main.unit), r)), tone: "brand", icon: "checkmark-done" },
    tiles: [
      { key: "plan", label: r.key === "day" ? "Bugungi reja" : "Reja", value: plans.length ? totalsText(plans) : "0", hint: r.key === "day" ? "muddati bugungacha" : "muddati shu davrda", tone: "info", icon: "target", open: { key: "tasks" } },
      { key: "pct", label: "Bajarilish", value: pctText(pct), hint: planMain ? `${inUnit(factMain, u)} / ${inUnit(planMain, u)}` : "reja yo'q", tone: pct == null ? "info" : pct >= 90 ? "success" : pct >= 60 ? "warning" : "danger", icon: "gauge" },
      { key: "inwork", label: "Jarayonda", value: String(inWork), hint: fresh ? `${fresh} tasi yangi — boshlang` : cnt(open.length, "ochiq topshiriq"), tone: fresh ? "warning" : "brand", icon: "hammer", open: { key: "tasks" } },
      { key: "overdue", label: "Kechikkan", value: String(overdue), hint: overdue ? "muddati o'tgan" : "kechikish yo'q", tone: overdue ? "danger" : "success", icon: "alarm", open: { key: "tasks" } },
      { key: "defect", label: "Brak", value: defects.length ? totalsText(defects.map((d) => ({ unit: d.product.unit, qty: sum(d.qty) }))) : "0", hint: defPct != null && defMain ? `${pctText(defPct)} ishlab chiqarilganidan` : cnt(defects.length, "qayd"), tone: defPct != null && defPct > 5 ? "danger" : defects.length ? "warning" : "success", icon: "triangle-alert" },
      { key: "issues", label: `Muammolar (${r.label})`, value: String(issues.length), hint: joinHint(openIssues ? `${openIssues} tasi ochiq` : issues.length ? "hammasi hal qilindi" : "muammo bo'lmadi", downtime ? `to'xtash ${downtime} daq` : null), tone: openIssues ? "danger" : issues.length ? "warning" : "success", icon: "wrench", open: { key: "brig-issues" } },
    ],
    charts: pick(
      bars ? chartSection(`Reja / fakt (${unitLabel(u)})`, bars, barsRows(bars, [(v) => inUnit(v, u), (v) => inUnit(v, u)]), "chart-column") : null,
      taskItems.length ? chartSection(dp ? "Bugungi reja — topshiriqlar" : "Topshiriqlar bajarilishi", { kind: "progress", items: taskItems }, progressRows(taskItems), "square-check") : null,
      quality.length ? { title: "Sifat nazorati", empty: "Bu davrda ishlab chiqarilmadi", rows: quality, icon: "shield-check" } : null,
      chartSection("Muammo turlari", donutChart(groupSum(issues, (i) => BRIGADE_ISSUE[i.kind].label, count), (v) => cnt(v, "ta"), "muammo"), [], "triangle-alert"),
    ).map((s) => (s.chart?.kind === "donut" && !s.rows.length ? { ...s, rows: donutRows(s.chart) } : s)),
  };
}

async function logistics(r: DashRange): Promise<RoleDashboard> {
  const [delivered, prevDelivered, created, fuel, expenses, issues, vehicles] = await Promise.all([
    db.trip.findMany({ where: { status: "DELIVERED", deliveredAt: { gte: r.from, lt: r.to } }, select: { vehicle: { select: { plate: true } }, deliveredAt: true, departedAt: true, loadedAt: true, plannedAt: true, createdAt: true, qtyM3: true, driver: { select: { fullName: true } }, order: { select: { customer: { select: { name: true } }, items: { select: { qtyM3: true, product: { select: { unit: true } } } } } } } }),
    db.trip.findMany({ where: { status: "DELIVERED", deliveredAt: { gte: r.prevFrom, lt: r.prevTo } }, select: { qtyM3: true } }),
    db.trip.groupBy({ by: ["status"], where: { createdAt: { gte: r.from, lt: r.to } }, _count: true }),
    db.fuelLog.aggregate({ where: { date: { gte: r.from, lt: r.to } }, _sum: { amount: true, liters: true } }),
    db.transportExpense.aggregate({ where: { date: { gte: r.from, lt: r.to } }, _sum: { amount: true } }),
    db.tripIssue.findMany({ where: { createdAt: { gte: r.from, lt: r.to } }, select: { kind: true, resolvedAt: true } }),
    db.vehicle.groupBy({ by: ["status"], where: { isActive: true }, _count: true }),
  ]);
  const rows = delivered.map((t) => ({ plate: t.vehicle.plate, date: t.deliveredAt!, qty: t.qtyM3, unit: soleUnit(t.order.items.map((i) => ({ unit: i.product.unit, qty: i.qtyM3 }))) ?? "m3", driver: t.driver.fullName, customer: t.order.customer.name,
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
      // Davr bo'yicha: qaysi mashina nechta reys qildi (hozirgi holat — "Transport holati" pastda)
      chartSection(`Mashinalar bo'yicha reyslar (${r.label})`, donutChart(groupSum(rows, (x) => x.plate, count), (v) => cnt(v, "reys"), "reys"), [], "truck", "Bu davrda reys yo'q"),
      chartSection("Transport holati (hozir)", donutChart(vehicles.map((v) => ({ label: VEHICLE_LABEL[v.status] ?? v.status, value: v._count })), (v) => cnt(v, "ta"), "texnika"), [], "truck", "Faol texnika yo'q"),
      chartSection("Muammo turlari", donutChart(groupSum(issues, (i) => ISSUE_KIND[i.kind] ?? i.kind, count), (v) => cnt(v, "ta"), "muammo"), [], "triangle-alert"),
    ).map((s) => (s.chart?.kind === "donut" && !s.rows.length ? { ...s, rows: donutRows(s.chart) } : s)),
  };
}

async function warehouse(r: DashRange): Promise<RoleDashboard> {
  const [receipts, prevReceipts, moves, materials, balances] = await Promise.all([
    db.goodsReceipt.findMany({ where: { cancelledAt: null, date: { gte: r.from, lt: r.to } }, select: { date: true, supplier: { select: { name: true } }, items: { select: { qty: true, price: true, vatAmount: true, material: { select: { name: true } } } } } }),
    db.goodsReceiptItem.findMany({ where: { receipt: { cancelledAt: null, date: { gte: r.prevFrom, lt: r.prevTo } } }, select: { qty: true, price: true, vatAmount: true } }),
    db.stockMove.findMany({ where: { date: { gte: r.from, lt: r.to } }, select: { type: true, qty: true, material: { select: { name: true, unit: true } } } }),
    db.material.findMany({ where: { isActive: true, minStock: { gt: 0 } }, select: { id: true, name: true, unit: true, minStock: true } }),
    // Qoldiq — davr oxirida (o'tgan davr tanlansa o'sha paytdagi; joriy davrda — hozirgi)
    db.stockMove.groupBy({ by: ["materialId"], where: { materialId: { not: null }, ...(r.to < new Date() ? { date: { lt: r.to } } : {}) }, _sum: { qty: true } }),
  ]);
  const recRows = receipts.map((x) => ({ date: x.date, supplier: x.supplier.name, amount: x.items.reduce((s, i) => s + lineTotal(i), 0), items: x.items }));
  const amount = recRows.reduce((s, x) => s + x.amount, 0), prevAmount = prevReceipts.reduce((s, i) => s + lineTotal(i), 0);
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
      { key: "low", label: "Kam qolgan", value: String(low), hint: joinHint(low ? "minimumdan past" : "hammasi yetarli", r.to < new Date() && `${r.label} oxirida`), tone: low ? "danger" : "success", icon: "alert-circle" },
      { key: "consume", label: "Zames sarfi", value: cnt(consume.length, "harakat"), hint: topConsumed ? `eng ko'p: ${topConsumed.label}` : undefined, tone: "info", icon: "layers" },
      { key: "adjust", label: "Inventarizatsiya", value: String(moves.filter((m) => m.type === "ADJUSTMENT").length), hint: "tuzatish yozuvi", tone: "info", icon: "clipboard-list" },
      { key: "brigade", label: "Brigadaga berildi", value: String(moves.filter((m) => m.type === "BRIGADE_ISSUE").length), hint: `${moves.filter((m) => m.type === "BRIGADE_RETURN").length} qaytdi`, tone: "info", icon: "hard-hat" },
    ],
    charts: pick(
      chartSection("Kirim dinamikasi", bars, barsRows(bars, [short]), "chart-column"),
      stockItems.length ? chartSection(r.to < new Date() ? `Qoldiq / minimum (${r.label} oxirida)` : "Qoldiq / minimum", { kind: "progress", items: stockItems }, progressRows(stockItems), "layers") : null,
      chartSection("Yetkazuvchilar bo'yicha", donutChart(groupSum(recRows, (x) => x.supplier, (x) => x.amount), short, "kirim"), [], "store"),
      chartSection("Harakat turlari", donutChart(groupSum(moves, (m) => MOVE_LABEL[m.type] ?? m.type, count), (v) => cnt(v, "ta"), "harakat"), [], "arrow-up-down"),
    ).map((s) => (s.chart?.kind === "donut" && !s.rows.length ? { ...s, rows: donutRows(s.chart) } : s)),
  };
}

/** Dashboard davri → `procurementHome` sana filtri (`to` — shu kun ham kiradi). */
export const procRange = (r: DashRange) => ({ from: fmtYmd(r.from), to: fmtYmd(addDays(r.to, -1)) });

/**
 * Snabjeniye — "Biton Snabjenya Dashboard" TZ: 5 KPI (ochiq, shoshilinch, buyurtmalar, yo'lda, kechikkan),
 * bildirishnomalar (alertlar), shoshilinch talablar, yetkazib berish monitoringi, davr bo'yicha xarid grafiklari.
 * Holat raqamlari vebdagi bosh sahifa bilan bir manbadan — `procurementHome()`.
 */
async function procurement(r: DashRange): Promise<RoleDashboard> {
  const [home, receipts, prevReceipts, requests] = await Promise.all([
    // Talablar — shu davrda ochilganlari (vebdagi "sana oralig'i" filtri bilan bir xil)
    procurementHome(procRange(r)),
    db.goodsReceipt.findMany({ where: { cancelledAt: null, date: { gte: r.from, lt: r.to } }, select: { date: true, supplierId: true, supplier: { select: { name: true } }, items: { select: { qty: true, price: true, vatAmount: true, material: { select: { name: true } } } } } }),
    db.goodsReceiptItem.findMany({ where: { receipt: { cancelledAt: null, date: { gte: r.prevFrom, lt: r.prevTo } } }, select: { qty: true, price: true, vatAmount: true } }),
    db.supplyRequest.findMany({ where: { createdAt: { gte: r.from, lt: r.to } }, select: { status: true, createdAt: true, receipt: { select: { date: true } } } }),
  ]);
  const c = home.counts;
  const recRows = receipts.map((x) => ({ date: x.date, supplier: x.supplier.name, amount: x.items.reduce((s, i) => s + lineTotal(i), 0), items: x.items }));
  const amount = recRows.reduce((s, x) => s + x.amount, 0), prevAmount = prevReceipts.reduce((s, i) => s + lineTotal(i), 0);
  // Kirim so'rovdan oldin yozilgan (eski hujjatga bog'langan) bo'lsa — manfiy muddat o'rtachani buzmasin
  const received = requests.filter((q) => q.receipt && q.receipt.date >= q.createdAt);
  const avgDays = received.length ? received.reduce((s, q) => s + (q.receipt!.date.getTime() - q.createdAt.getTime()) / DAY_MS, 0) / received.length : null;
  const bars = barsChart(r, recRows, (x) => x.date, [{ label: "Xarid", value: (x) => x.amount, fmt: short }], `Jami ${short(amount)}`);
  const byMaterial = groupSum(recRows.flatMap((x) => x.items), (i) => i.material.name, (i) => lineTotal(i));

  // Alertlar — bosilsa snabjeniye ro'yxati ochiladi (hujjat raqamlari izohda)
  const alerts: HomeRow[] = home.alerts.map((a) => ({
    id: `alert:${a.key}`, title: a.title,
    subtitle: [a.text, a.docs.map((x) => x.docNo).join(", ")].filter(Boolean).join(" · ") || undefined,
    right: String(a.count), tone: a.tone === "danger" ? "danger" : a.tone === "warning" ? "warning" : "info",
    open: "snabjeniye",
  }));
  const urgent: HomeRow[] = home.urgent.slice(0, 6).map((x) => ({
    id: x.id, title: `${x.docNo} · ${x.department}`,
    subtitle: `${x.what} · ${x.qtyText}${x.needBy ? ` · kerak ${day(x.needBy)}` : ""}${x.waitDirector ? " · direktor tasdig'ida" : ""}`,
    right: PRIORITY_LABEL[x.priority], status: REQUISITION_LABEL[x.status], tone: x.priority === "CRITICAL" ? "danger" : "warning",
  }));
  const deliveries: HomeRow[] = home.deliveries.slice(0, 6).map((x) => ({
    id: x.id, title: `${x.docNo}${x.supplier ? ` · ${x.supplier}` : ""}`,
    subtitle: [x.transport, x.shippedAt ? `jo'natildi ${day(x.shippedAt)}` : null, x.eta ? `ETA ${day(x.eta)}` : x.needBy ? `kerak ${day(x.needBy)}` : null].filter(Boolean).join(" · ") || x.what,
    right: x.late > 0 ? `${x.late} kun kech` : undefined,
    status: x.delivery ? DELIVERY_LABEL[x.delivery] : DELIVERY_LABEL.PLANNED,
    tone: x.late > 0 || x.delivery === "PROBLEM" ? "danger" : x.delivery === "IN_TRANSIT" ? "brand" : x.delivery === "ARRIVED" || x.delivery === "RECEIVING" ? "warning" : "info",
  }));

  return {
    hero: { key: "purchases", label: `Xarid (${r.label})`, value: short(amount), hint: joinHint(cnt(receipts.length, "hujjat"), deltaText(amount, prevAmount, r)), tone: "brand", icon: "cart" },
    tiles: [
      { key: "open", label: "Ochiq talablar", value: String(c.open), hint: `${c.priceWait} narx kutmoqda · ${c.approveWait} tasdiqda`, tone: c.priceWait ? "warning" : "info", icon: "clipboard-list", open: { key: "snabjeniye" } },
      { key: "urgent", label: "Shoshilinch", value: String(c.urgent), hint: c.critical ? `${c.critical} tasi kritik` : "kritik yo'q", tone: c.critical ? "danger" : c.urgent ? "warning" : "success", icon: "warning", open: { key: "snabjeniye" } },
      { key: "orders", label: "Buyurtmalar", value: String(c.orders), hint: c.orders ? short(home.money.ordered) : "ochiq buyurtma yo'q", tone: c.orders ? "brand" : "info", icon: "cart", open: { key: "snabjeniye" } },
      { key: "transit", label: "Yo'ldagi yuklar", value: String(c.inTransit), hint: "yetkazish: yo'lda", tone: c.inTransit ? "info" : "success", icon: "truck", open: { key: "snabjeniye" } },
      { key: "late", label: "Kechikkanlar", value: String(c.delayed), hint: "kerak sana / ETA o'tgan", tone: c.delayed ? "danger" : "success", icon: "clock", open: { key: "snabjeniye" } },
      { key: "avg", label: "O'rtacha yetkazish", value: avgDays == null ? "—" : `${avgDays.toFixed(1)} kun`, hint: "so'rovdan kirimgacha", tone: avgDays != null && avgDays > 5 ? "warning" : "success", icon: "hourglass" },
    ],
    charts: pick(
      alerts.length ? { title: "Bildirishnomalar", empty: "", icon: "bell", rows: alerts } : null,
      { title: "Shoshilinch talablar", empty: "Shoshilinch talab yo'q", target: "supply", rows: urgent },
      { title: "Yetkazib berish monitoringi", empty: "Ochiq buyurtma yo'q", target: "supply", rows: deliveries },
      chartSection("Xarid dinamikasi", bars, barsRows(bars, [short]), "chart-column"),
      chartSection("Yetkazuvchilar bo'yicha", donutChart(groupSum(recRows, (x) => x.supplier, (x) => x.amount), short, "xarid"), [], "store"),
      chartSection("Materiallar bo'yicha", donutChart(byMaterial, short, "xarid"), [], "layers"),
      chartSection("So'rovlar holati", donutChart(groupSum(requests, (q) => SUPPLY_LABEL[q.status], count), (v) => cnt(v, "ta"), "so'rov"), [], "clipboard-list"),
    ).map((s) => (s.chart?.kind === "donut" && !s.rows.length ? { ...s, rows: donutRows(s.chart) } : s)),
  };
}

/**
 * Mexanik — "Sklad & Logistika" nazorati (vebdagi `mechanic-home.tsx` bilan bitta manba — `skladLogistika()`).
 * Bugun/ertaga raqamlari davrga bog'liq emas (PDF: kunlik va ertangi nazorat); davr filtri bosh ko'rsatkich —
 * jo'natilgan hajm va uning dinamikasiga ta'sir qiladi.
 */
async function mechanic(r: DashRange): Promise<RoleDashboard> {
  // Kunda — bugun/ertaga (PDF); hafta/oy/yil — shu davr va keyingi teng davr
  const isDay = r.key === "day";
  const W = isDay ? { cur: "bugun", Cur: "Kunlik", next: "ertaga", Next: "Ertangi" } : { cur: r.label, Cur: `Davr (${r.label})`, next: "keyingi davr", Next: "Keyingi davr" };
  const [d, shipped, prevShipped] = await Promise.all([
    isDay ? skladLogistika() : skladLogistika(undefined, { from: r.from, to: r.to }),
    db.trip.findMany({ where: { status: { in: ["LOADED", "ON_ROAD", "DELIVERED"] }, loadedAt: { gte: r.from, lt: r.to } }, select: { loadedAt: true, qtyM3: true, order: { select: { items: { select: { product: { select: { unit: true } } } } } } } }),
    db.trip.count({ where: { status: { in: ["LOADED", "ON_ROAD", "DELIVERED"] }, loadedAt: { gte: r.prevFrom, lt: r.prevTo } } }),
  ]);
  const t = d.today, n = d.tomorrow;
  const rows = shipped.map((x) => ({ date: x.loadedAt!, qty: x.qtyM3, unit: x.order.items[0]?.product.unit ?? "m3" }));
  const bars = barsChart(r, rows, (x) => x.date, unitSeries(rows), `${cnt(rows.length, "reys")} · ${totalsText(unitRows(rows))}`);
  const fleet = n.vehicles.mixer + n.vehicles.truck;

  const alerts: HomeRow[] = d.alerts.map((a) => ({
    id: `alert:${a.key}`, title: a.title, subtitle: a.text,
    tone: a.tone === "danger" ? "danger" : a.tone === "warning" ? "warning" : "info",
    open: a.href.startsWith("/stock") ? "stock" : "trips",
  }));
  const products: HomeRow[] = d.products.map((p) => {
    const short = p.balance < -0.001;
    return {
      id: `p:${p.id}`, title: `${p.code} · ${p.name}`,
      subtitle: `${W.cur} ${p.today ? inUnit(p.today, p.unit) : "—"} · ${W.next} ${p.tomorrow ? inUnit(p.tomorrow, p.unit) : "—"} · skladda ${inUnit(p.onHand, p.unit)}`,
      right: p.tomorrow === 0 ? "—" : short ? inUnit(p.balance, p.unit) : "Yetarli",
      tone: p.tomorrow === 0 ? "info" : short ? "danger" : "success",
    };
  });
  const flowTotal = Math.max(1, d.flow[0]?.count ?? 0);
  const flow = { kind: "progress" as const, items: d.flow.map((s) => ({
    label: s.label, pct: Math.round((s.count / flowTotal) * 100), fact: `${s.count} ta`, plan: s.key === "orders" ? null : `${d.flow[0]?.count ?? 0} ta`,
    tone: (s.key === "need" ? (s.count ? "danger" : "success") : s.count >= flowTotal ? "success" : s.count ? "warning" : "info") as Tone,
  })) };
  const orders: HomeRow[] = d.orders.filter((o) => !o.done).slice(0, 10).map((o) => ({
    id: o.id, title: `${o.orderNo} · ${o.customer}`,
    subtitle: `${o.time ?? "soatsiz"} · ${o.products}`,
    right: `${num(o.shipped)}/${num(o.total)}${o.unit ? ` ${unitLabel(o.unit)}` : ""}`,
    status: o.statusLabel, tone: o.blocked || o.problem ? "danger" : o.late ? "warning" : "brand",
  }));

  return {
    hero: { key: "shipped", label: `Jo'natildi (${r.label})`, value: totalsText(unitRows(rows)), hint: joinHint(cnt(rows.length, "reys"), deltaText(rows.length, prevShipped, r)), tone: "brand", icon: "send", open: { key: "trips" } },
    tiles: [
      { key: "t-orders", label: isDay ? "Kunlik zayavka" : `Zayavkalar (${r.label})`, value: `${t.orders} ta`, hint: t.drafts ? `${t.drafts} tasi tasdiqlanmagan` : W.cur, tone: "info", icon: "clipboard-list" },
      { key: "t-volume", label: "Zayavka bo'yicha mahsulot", value: t.volume, hint: W.cur, tone: "brand", icon: "package", open: { key: "stock" } },
      { key: "t-shipped", label: `Jo'natilgan (${W.cur})`, value: `${t.shipped} ta`, hint: t.shippedVolume, tone: t.shipped ? "success" : "info", icon: "send", open: { key: "trips" } },
      { key: "t-left", label: "Qolgan zayavka", value: `${t.left} ta`, hint: t.leftVolume, tone: t.left ? "warning" : "success", icon: "hourglass" },
      { key: "t-problem", label: "Muammoli / kechikkan", value: `${t.problem} ta`, hint: t.overdue ? `${t.overdue} tasi ${isDay ? "oldingi kunlardan" : "davrdan oldingi"}` : "kechikish, blok, muammo", tone: t.problem ? "danger" : "success", icon: "warning", open: { key: "trips" } },
      { key: "n-orders", label: `${W.Next} zayavka`, value: `${n.orders} ta`, hint: n.drafts ? `${n.drafts} tasi tasdiqlanmagan` : W.next, tone: "info", icon: "calendar" },
      { key: "n-need", label: "Kerak bo'ladigan mahsulot", value: n.need, hint: W.next, tone: "brand", icon: "package" },
      { key: "n-stock", label: "Skladda mavjud", value: n.available, hint: `${W.cur} jo'natishdan keyin`, tone: "info", icon: "warehouse", open: { key: "stock" } },
      { key: "n-short", label: "Yetishmaydigan mahsulot", value: n.short, hint: n.shortCount ? `${n.shortCount} xil mahsulot` : "hammasi yetarli", tone: n.shortCount ? "danger" : "success", icon: n.shortCount ? "circle-alert" : "package-check" },
      { key: "n-trucks", label: `${W.Next} transport ehtiyoji`, value: `${n.trips} ta mashina`, hint: joinHint(n.mixerTrips > 0 && `${n.mixerTrips} mikser`, n.truckTrips > 0 && `${n.truckTrips} yuk`, n.pumps > 0 && `${n.pumps} nasos`, `saflda ${fleet}`), tone: n.trips > fleet ? "warning" : "info", icon: "truck", open: { key: "trips" } },
    ],
    charts: pick(
      { title: "Avtomatik ogohlantirish", empty: "Hammasi joyida — yetishmovchilik yo'q", icon: "bell", rows: alerts },
      { title: "Mahsulot bo'yicha nazorat", empty: `${isDay ? "Bugun va ertaga" : "Davrda va keyingi davrda"} zayavka yo'q`, icon: "layers", rows: products },
      { title: `Ish jarayoni (${W.cur})`, empty: "", icon: "route", rows: progressRows(flow.items), chart: flow },
      { title: isDay ? "Bugungi va kechikkan zayavkalar" : `${r.label} va kechikkan zayavkalar`, empty: "Qolgan zayavka yo'q", target: "orders", rows: orders },
      chartSection("Jo'natish dinamikasi", bars, barsRows(bars, unitSeries(rows).map((s) => s.fmt)), "chart-column"),
    ),
  };
}

async function accounting(r: DashRange): Promise<RoleDashboard> {
  const [flow, invoices, recv, pay] = await Promise.all([
    moneyFlow(r),
    db.invoice.findMany({ where: { isOpening: false, date: { gte: r.from, lt: r.to } }, select: { amount: true, status: true } }), // boshlang'ich qoldiq — sotuv emas
    // Debitorka — davr oxiridagi qarz (joriy davrda — hozirgi)
    receivables(asOf(r)), payables(),
  ]);
  const paySum = flow.pay.reduce((s, p) => s + sum(p.amount), 0);
  const invSum = invoices.reduce((s, i) => s + sum(i.amount), 0);
  const debtors: HomeRow[] = recv.list.slice(0, 5).map((c) => ({ id: c.id, title: c.name, subtitle: cnt(c.n, "ochiq schyot"), right: short(c.debt), tone: "danger" }));
  return {
    hero: { key: "payments", label: `To'lovlar (${r.label})`, value: short(paySum), hint: joinHint(cnt(flow.pay.length, "to'lov"), deltaText(paySum, flow.prevIn, r)), tone: "success", icon: "banknote" },
    tiles: [
      { key: "invoiced", label: "Schyot yozildi", value: short(invSum), hint: cnt(invoices.length, "schyot"), tone: "info", icon: "receipt" },
      { key: "receivable", label: asOf(r) ? `Debitorka (${r.label} oxirida)` : "Debitorka", value: short(recv.total), hint: joinHint(cnt(recv.count, "ochiq schyot"), `davrda +${short(invSum)} yozildi · −${short(paySum)} to'landi`), tone: recv.total > 0 ? "danger" : "success", icon: "warning" },
      // Kreditorka — hozirgi qarz (to'lanmagan kirimlar + boshlang'ich qoldiq + tasdiqlangan ta'minot), `./payables.ts`
      { key: "payable", label: "Kreditorka", value: short(pay.total), hint: joinHint(cnt(pay.receipts.count, "to'lanmagan kirim"), pay.opening.total > 0 ? `boshl. qoldiq ${short(pay.opening.total)}` : null, pay.supply.count ? cnt(pay.supply.count, "ta'minot zayavkasi") : null), tone: pay.total > 0 ? "warning" : "success", icon: "clipboard-list" },
      { key: "expense", label: "Chiqim", value: short(flow.outSum), hint: deltaText(flow.outSum, flow.prevOut, r) ?? undefined, tone: "warning", icon: "arrow-up-circle" },
    ],
    charts: pick(
      chartSection("Kirim / chiqim", flow.bars, barsRows(flow.bars, [short, short]), "chart-column"),
      chartSection("Chiqim kategoriyalari", flow.expenseDonut, [], "chart-pie"),
      chartSection("Schyotlar holati", donutChart(groupSum(invoices, (i) => INVOICE_LABEL[i.status] ?? i.status, (i) => sum(i.amount)), short, "schyot"), [], "receipt"),
      debtors.length ? { title: asOf(r) ? `Top qarzdorlar (${r.label} oxirida)` : "Top qarzdorlar", empty: "", target: "customers", rows: debtors } : null,
    ).map((s) => (s.chart?.kind === "donut" && !s.rows.length ? { ...s, rows: donutRows(s.chart) } : s)),
  };
}

async function finance(r: DashRange): Promise<RoleDashboard> {
  const months = monthShares(r).map(({ year, month }) => ({ year, month }));
  const [flow, accounts, budgets] = await Promise.all([
    moneyFlow(r), accountBalances(asOf(r)),
    db.expenseBudget.findMany({ where: { OR: months } }),
  ]);
  // Byudjet — oylik byudjet davrga bo'lingan; fakt — shu davr chiqimi (kategoriya bo'yicha)
  const cats = [...new Set(budgets.map((b) => b.category))];
  const spentOf = (cat: string) => flow.flows.filter((x) => x.dir === "out" && x.category === cat).reduce((a, x) => a + x.amount, 0);
  const planOf = (cat: string) => scaled(budgets.filter((b) => b.category === cat), r, (b) => sum(b.amount));
  const net = flow.inSum - flow.outSum, prevNet = flow.prevIn - flow.prevOut;
  const balance = accounts.reduce((s, a) => s + a.value, 0);
  const budgetItems = cats.map((c) => progressItem(c, spentOf(c), planOf(c), short, true, "cashflow"));
  const budgetTotal = cats.reduce((a, c) => a + planOf(c), 0);
  const spentTotal = cats.reduce((a, c) => a + spentOf(c), 0);
  const budgetPct = budgetTotal > 0 ? (spentTotal / budgetTotal) * 100 : null;
  return {
    hero: { key: "net", label: `Sof pul oqimi (${r.label})`, value: shortSigned(net), hint: joinHint(`kirim ${short(flow.inSum)} · chiqim ${short(flow.outSum)}`, prevNet !== 0 && deltaText(Math.abs(net), Math.abs(prevNet), r)), tone: net >= 0 ? "success" : "danger", icon: "arrow-up-down" },
    tiles: [
      { key: "in", label: "Kirim", value: short(flow.inSum), hint: deltaText(flow.inSum, flow.prevIn, r) ?? undefined, tone: "success", icon: "arrow-down-circle" },
      { key: "out", label: "Chiqim", value: short(flow.outSum), hint: deltaText(flow.outSum, flow.prevOut, r) ?? undefined, tone: "warning", icon: "arrow-up-circle" },
      { key: "balance", label: asOf(r) ? `Kassa qoldig'i (${r.label} oxirida)` : "Kassa qoldig'i", value: shortSigned(balance), hint: cnt(accounts.length, "hisob"), tone: balance >= 0 ? "info" : "danger", icon: "wallet" },
      { key: "budget", label: `Byudjet (${r.label})`, value: pctText(budgetPct), hint: budgets.length ? `${short(spentTotal)} / ${short(budgetTotal)}` : "byudjet belgilanmagan", tone: budgetPct == null ? "info" : budgetPct > 100 ? "danger" : budgetPct > 90 ? "warning" : "success", icon: "square-check" },
    ],
    charts: pick(
      chartSection("Pul oqimi", flow.bars, barsRows(flow.bars, [short, short]), "chart-column"),
      budgetItems.length ? chartSection(`Byudjet — ${r.label}`, { kind: "progress", items: budgetItems }, progressRows(budgetItems), "square-check") : null,
      chartSection("Xarajat kategoriyalari", flow.expenseDonut, [], "chart-pie"),
      chartSection(asOf(r) ? `Hisoblar bo'yicha qoldiq (${r.label} oxirida)` : "Hisoblar bo'yicha qoldiq", donutChart(accounts, shortSigned, "qoldiq"), [], "landmark", "Hisob yo'q"),
    ).map((s) => (s.chart?.kind === "donut" && !s.rows.length ? { ...s, rows: donutRows(s.chart) } : s)),
  };
}

async function cashier(r: DashRange): Promise<RoleDashboard> {
  const [flow, accounts] = await Promise.all([moneyFlow(r), accountBalances(asOf(r))]);
  const paySum = flow.pay.reduce((s, p) => s + sum(p.amount), 0);
  return {
    hero: { key: "payments", label: `Tushum (${r.label})`, value: short(paySum), hint: joinHint(cnt(flow.pay.length, "to'lov"), deltaText(paySum, flow.prevIn, r)), tone: "success", icon: "banknote" },
    tiles: [
      { key: "out", label: "Chiqim", value: short(flow.outSum), tone: "warning", icon: "arrow-up-circle" },
      { key: "balance", label: asOf(r) ? `Kassa qoldig'i (${r.label} oxirida)` : "Kassa qoldig'i", value: shortSigned(accounts.reduce((s, a) => s + a.value, 0)), hint: cnt(accounts.length, "hisob"), tone: "info", icon: "wallet" },
    ],
    charts: pick(
      chartSection("Kirim / chiqim", flow.bars, barsRows(flow.bars, [short, short]), "chart-column"),
      chartSection(asOf(r) ? `Hisoblar bo'yicha qoldiq (${r.label} oxirida)` : "Hisoblar bo'yicha qoldiq", donutChart(accounts, shortSigned, "qoldiq"), [], "landmark", "Hisob yo'q"),
    ).map((s) => (s.chart?.kind === "donut" && !s.rows.length ? { ...s, rows: donutRows(s.chart) } : s)),
  };
}

async function hr(r: DashRange): Promise<RoleDashboard> {
  const [att, prevAtt, hired, fired, active, positions] = await Promise.all([
    db.attendance.findMany({ where: { date: { gte: r.from, lt: r.to } }, select: { date: true, status: true } }),
    db.attendance.groupBy({ by: ["status"], where: { date: { gte: r.prevFrom, lt: r.prevTo } }, _count: true }),
    db.employee.count({ where: { hiredAt: { gte: r.from, lt: r.to } } }),
    db.employee.count({ where: { firedAt: { gte: r.from, lt: r.to } } }),
    db.employee.count({ where: staffAt(r) }),
    db.employee.groupBy({ by: ["position"], where: staffAt(r), _count: true }),
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
      { key: "active", label: asOf(r) ? `Xodimlar (${r.label} oxirida)` : "Faol xodim", value: String(active), hint: cnt(positions.length, "lavozim"), tone: "brand", icon: "people" },
    ],
    charts: pick(
      bars ? chartSection("Davomat dinamikasi", bars, barsRows(bars, [(v) => cnt(v, "kishi"), (v) => cnt(v, "kishi")]), "chart-column") : null,
      chartSection("Davomat tarkibi", donutChart(groupSum(att, (a) => ATT_LABEL[a.status] ?? a.status, count), (v) => cnt(v, "belgi"), "belgi"), [], "calendar"),
      chartSection(asOf(r) ? `Lavozimlar bo'yicha (${r.label} oxirida)` : "Lavozimlar bo'yicha", donutChart(positions.map((p) => ({ label: p.position, value: p._count })), (v) => cnt(v, "kishi"), "xodim"), [], "id-card", "Faol xodim yo'q"),
    ).map((s) => (s.chart?.kind === "donut" && !s.rows.length ? { ...s, rows: donutRows(s.chart) } : s)),
  };
}

async function driver(user: MobileUser, r: DashRange): Promise<RoleDashboard | null> {
  const me = await db.employee.findFirst({ where: { userId: user.id }, select: { id: true } });
  if (!me) return null;
  const [delivered, prev, created, fuel, issues] = await Promise.all([
    db.trip.findMany({ where: { driverId: me.id, status: "DELIVERED", deliveredAt: { gte: r.from, lt: r.to } }, select: { id: true, deliveredAt: true, qtyM3: true, distanceKm: true, summaryAt: true, order: { select: { distanceKm: true, customer: { select: { name: true } }, items: { select: { qtyM3: true, product: { select: { unit: true } } } } } } } }),
    db.trip.aggregate({ where: { driverId: me.id, status: "DELIVERED", deliveredAt: { gte: r.prevFrom, lt: r.prevTo } }, _sum: { qtyM3: true } }),
    db.trip.groupBy({ by: ["status"], where: { driverId: me.id, createdAt: { gte: r.from, lt: r.to } }, _count: true }),
    db.fuelLog.aggregate({ where: { driverId: me.id, date: { gte: r.from, lt: r.to } }, _sum: { amount: true, liters: true } }),
    db.tripIssue.count({ where: { createdAt: { gte: r.from, lt: r.to }, trip: { driverId: me.id } } }),
  ]);
  // Km — GPS izi bo'yicha (bir tomon × 2), iz yo'q bo'lsa zayavkadagi taxminiy masofa (`tripPayKm`)
  const kms = await tripPayKm(delivered);
  const rows = delivered.map((t) => ({ date: t.deliveredAt!, qty: t.qtyM3, unit: soleUnit(t.order.items.map((i) => ({ unit: i.product.unit, qty: i.qtyM3 }))) ?? "m3", customer: t.order.customer.name, km: kms.get(t.id) ?? 0 }));
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
/** Amal raqamni o'zgartirsa (davomat belgilandi) — bosh ekran eski keshdan emas, darhol yangi raqam bilan chiqsin. */
export const clearDashCache = () => cache.clear();

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
      return mine.length ? brigadier(r, mine.map((b) => b.id)) : null;
    }
    case "LOGISTICS": return logistics(r);
    case "WAREHOUSE": return warehouse(r);
    case "PROCUREMENT": return procurement(r);
    case "MECHANIC": return mechanic(r);
    case "ACCOUNTING": return accounting(r);
    case "FINANCE": return finance(r);
    case "CASHIER": return cashier(r);
    case "HR": return hr(r);
    case "DRIVER": return driver(user, r);
    default: return null;
  }
}

