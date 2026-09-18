import { db } from "@/lib/db";
import { isoDate } from "@/lib/format";

/* ───────────── Davr ───────────── */

export type Period = "day" | "month" | "year" | "custom";
export type Range = { period: Period; from: Date; to: Date; prevFrom: Date; prevTo: Date; days: number; label: string; prevLabel: string };
export type Gran = "day" | "week" | "month";

const DAY = 86400000;
export const startOfDay = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
export const addDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY);
const fmt = (d: Date) => `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;

export function parseRange(sp: { period?: string; from?: string; to?: string }): Range {
  const today = startOfDay(new Date()), tomorrow = addDays(today, 1);
  let period: Period = sp.period === "day" || sp.period === "year" ? sp.period : "month";
  let from: Date, to: Date;
  if (sp.from && sp.to && !Number.isNaN(Date.parse(sp.from)) && !Number.isNaN(Date.parse(sp.to))) {
    period = "custom"; from = startOfDay(new Date(sp.from)); to = addDays(startOfDay(new Date(sp.to)), 1);
    if (to <= from) to = addDays(from, 1);
  } else if (period === "day") { from = today; to = tomorrow; }
  else if (period === "year") { from = new Date(today.getFullYear(), 0, 1); to = tomorrow; }
  else { from = new Date(today.getFullYear(), today.getMonth(), 1); to = tomorrow; }
  const days = Math.max(1, Math.round((to.getTime() - from.getTime()) / DAY));
  const prevTo = from, prevFrom = addDays(from, -days);
  const label = days === 1 ? fmt(from) : `${fmt(from)} — ${fmt(addDays(to, -1))}`;
  const prevLabel = days === 1 ? fmt(prevFrom) : `${fmt(prevFrom)} — ${fmt(addDays(prevTo, -1))}`;
  return { period, from, to, prevFrom, prevTo, days, label, prevLabel };
}

export function rangeQuery(r: Range, extra?: Record<string, string>) {
  const p = new URLSearchParams(extra);
  if (r.period === "custom") { p.set("from", isoDate(r.from)); p.set("to", isoDate(addDays(r.to, -1))); } else p.set("period", r.period);
  return p.toString();
}

export function autoGran(days: number): Gran { return days <= 62 ? "day" : days <= 400 ? "week" : "month"; }

const MONTHS = ["Yan", "Fev", "Mar", "Apr", "May", "Iyn", "Iyl", "Avg", "Sen", "Okt", "Noy", "Dek"];
export const WEEKDAYS = ["Yak", "Dush", "Sesh", "Chor", "Pay", "Jum", "Shan"];
export const WEEKDAYS_FULL = ["Yakshanba", "Dushanba", "Seshanba", "Chorshanba", "Payshanba", "Juma", "Shanba"];

export function bucketKey(d: Date, g: Gran): string {
  if (g === "day") return isoDate(d);
  if (g === "month") return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  const x = startOfDay(d); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return isoDate(x);
}
export function bucketLabel(key: string, g: Gran): string {
  if (g === "month") return MONTHS[Number(key.slice(5, 7)) - 1] + (key.slice(0, 4) !== String(new Date().getFullYear()) ? ` ${key.slice(2, 4)}` : "");
  return `${key.slice(8, 10)}.${key.slice(5, 7)}`;
}
/** Davr ichidagi barcha bucket kalitlari (bo'sh bo'lsa ham). */
export function bucketsFor(from: Date, to: Date, g: Gran): string[] {
  const keys: string[] = []; const seen = new Set<string>();
  for (let d = new Date(from); d < to; d = addDays(d, 1)) { const k = bucketKey(d, g); if (!seen.has(k)) { seen.add(k); keys.push(k); } }
  return keys;
}
export function series<T>(rows: T[], from: Date, to: Date, g: Gran, date: (r: T) => Date, value: (r: T) => number) {
  const keys = bucketsFor(from, to, g); const m = new Map(keys.map((k) => [k, 0]));
  for (const r of rows) { const k = bucketKey(date(r), g); if (m.has(k)) m.set(k, (m.get(k) ?? 0) + value(r)); }
  return keys.map((k) => ({ key: k, label: bucketLabel(k, g), value: m.get(k) ?? 0 }));
}

/* ───────────── Statistika ───────────── */

export const sum = (a: number[]) => a.reduce((s, v) => s + v, 0);
export const mean = (a: number[]) => (a.length ? sum(a) / a.length : 0);
export const std = (a: number[]) => { if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(sum(a.map((v) => (v - m) ** 2)) / (a.length - 1)); };
export const median = (a: number[]) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); const i = Math.floor(s.length / 2); return s.length % 2 ? s[i] : (s[i - 1] + s[i]) / 2; };
export const delta = (cur: number, prev: number) => (prev === 0 ? (cur === 0 ? 0 : null) : ((cur - prev) / Math.abs(prev)) * 100);
export const safeDiv = (a: number, b: number) => (b === 0 ? 0 : a / b);
export function linreg(ys: number[]) {
  const n = ys.length; if (n < 2) return { a: ys[0] ?? 0, b: 0 };
  const xs = ys.map((_, i) => i), mx = mean(xs), my = mean(ys);
  const b = safeDiv(sum(xs.map((x, i) => (x - mx) * (ys[i] - my))), sum(xs.map((x) => (x - mx) ** 2)));
  return { a: my - b * mx, b };
}
/** ABC: kumulyativ ulush ≤80% → A, ≤95% → B, qolgani C. */
export function abc<T>(rows: T[], value: (r: T) => number): Map<T, "A" | "B" | "C"> {
  const sorted = [...rows].sort((x, y) => value(y) - value(x)); const total = sum(sorted.map(value)) || 1;
  let acc = 0; const out = new Map<T, "A" | "B" | "C">();
  for (const r of sorted) { acc += value(r); out.set(r, acc / total <= 0.8 ? "A" : acc / total <= 0.95 ? "B" : "C"); }
  return out;
}
/** XYZ: talab beqarorligi CV = std/mean. ≤0.5 X, ≤1 Y, aks holda Z. N — ma'lumot yetarli emas. */
export const xyz = (vals: number[]): "X" | "Y" | "Z" | "N" => { const nz = vals.filter((v) => v > 0).length; if (nz < 2) return "N"; const cv = safeDiv(std(vals), mean(vals)); return cv <= 0.5 ? "X" : cv <= 1 ? "Y" : "Z"; };

/* ───────────── Yagona ma'lumot manbalari ───────────── */

export const ACTIVE_ORDER: ("CONFIRMED" | "IN_PRODUCTION" | "DELIVERED" | "CLOSED")[] = ["CONFIRMED", "IN_PRODUCTION", "DELIVERED", "CLOSED"];

export type SaleRow = {
  date: Date; orderId: string; orderNo: string; status: string; customerId: string; customer: string; sellerId: string; seller: string;
  productId: string; product: string; code: string; unit: string; qty: number; price: number; basePrice: number; revenue: number; cost: number;
};

/** Xomashyo o'rtacha kirim narxi (RECEIPT). */
export async function materialCosts() {
  const rows = await db.stockMove.groupBy({ by: ["materialId"], where: { type: "RECEIPT", materialId: { not: null } }, _avg: { unitCost: true } });
  return new Map(rows.map((r) => [r.materialId as string, Number(r._avg.unitCost ?? 0)]));
}

/** Har mahsulot uchun 1 birlik tannarx (faol retsept × xomashyo o'rtacha narxi). Retsept yo'q → null. */
export async function productCosts() {
  const [products, costs] = await Promise.all([
    db.product.findMany({ include: { recipes: { where: { isActive: true }, orderBy: { version: "desc" }, take: 1, include: { items: true } } } }),
    materialCosts(),
  ]);
  const out = new Map<string, { cost: number | null; price: number; name: string; code: string; unit: string; isActive: boolean }>();
  for (const p of products) {
    const items = p.recipes[0]?.items ?? [];
    const cost = items.length ? sum(items.map((i) => Number(i.qtyPerM3) * (costs.get(i.materialId) ?? 0))) : null;
    out.set(p.id, { cost, price: Number(p.price), name: p.name, code: p.code, unit: p.unit, isActive: p.isActive });
  }
  return out;
}

/** Sotuv qatorlari (zayavka pozitsiyalari) — davr bo'yicha, bekor/qoralama tashqari. */
export async function loadSales(from: Date, to: Date, statuses: string[] = ACTIVE_ORDER): Promise<SaleRow[]> {
  const [items, costs] = await Promise.all([
    db.orderItem.findMany({
      where: { order: { date: { gte: from, lt: to }, status: { in: statuses as never } } },
      include: { order: { select: { id: true, orderNo: true, date: true, status: true, customerId: true, customer: { select: { name: true } }, createdById: true, createdBy: { select: { fullName: true } } } }, product: { select: { name: true, code: true, unit: true, price: true } } },
    }),
    productCosts(),
  ]);
  return items.map((i) => {
    const qty = Number(i.qtyM3), price = Number(i.price), c = costs.get(i.productId)?.cost ?? 0;
    return {
      date: i.order.date, orderId: i.order.id, orderNo: i.order.orderNo, status: i.order.status, customerId: i.order.customerId, customer: i.order.customer.name, sellerId: i.order.createdById, seller: i.order.createdBy.fullName,
      productId: i.productId, product: i.product.name, code: i.product.code, unit: i.product.unit, qty, price, basePrice: Number(i.product.price), revenue: qty * price, cost: qty * c,
    };
  });
}

export type Kpi = { cur: number; prev: number; delta: number | null };
export const kpi = (cur: number, prev: number): Kpi => ({ cur, prev, delta: delta(cur, prev) });

/** Kapital narxi — muzlagan pul kuniga qancha turadi (yillik 24%). */
export const CAPITAL_RATE_DAY = 0.24 / 365;
