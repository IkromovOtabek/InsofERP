import { db } from "@/lib/db";
import { isoDate } from "@/lib/format";
import { avgUnitCosts } from "@/lib/stock";
import { companyVatPayer } from "@/lib/receipt-vat";
import { withoutNds } from "@/lib/nds";

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
  /** QQS'siz tushum (QQS to'lovchisi korxonada NDS qatorlar uchun) — marja va chegirma shu bilan, tannarx ham QQS'siz */
  net: number;
  /** Tannarx ma'lummi (faol retsept bor va har xomashyoning narxi bor). Bilinmasa marjaga kirmaydi — 100% foyda bo'lib ko'rinmasin */
  costKnown: boolean;
};

/* ───────────── Yalpi foyda: faqat tannarxi ma'lum qatorlar bo'yicha ───────────── */
export const costedRows = (rows: SaleRow[]) => rows.filter((r) => r.costKnown);
/** Yalpi foyda (QQS'siz tushum − tannarx), tannarxi ma'lum qatorlar bo'yicha */
export const grossOf = (rows: SaleRow[]) => sum(costedRows(rows).map((r) => r.net - r.cost));
/** Marja %: yalpi foyda / shu qatorlarning QQS'siz tushumi */
export const marginOf = (rows: SaleRow[]) => safeDiv(grossOf(rows), sum(costedRows(rows).map((r) => r.net))) * 100;
/** Tannarxi noma'lum (retsepti yo'q yoki xomashyo narxi kiritilmagan) mahsulotlar tushumi */
export const uncostedRevenue = (rows: SaleRow[]) => sum(rows.filter((r) => !r.costKnown).map((r) => r.revenue));

/**
 * Tizimga o'tish sanasi — eng erta faol boshlang'ich qoldiq sanasi (yo'q bo'lsa `null`).
 * Undan oldingi kunlar "ish bo'lmagan" emas, shunchaki ERP'da yozilmagan: o'rtacha va prognozlar shu sanadan boshlanadi.
 */
export async function goLiveDate(): Promise<Date | null> {
  const r = await db.openingBalance.aggregate({ where: { cancelledAt: null }, _min: { date: true } });
  return r._min.date ? startOfDay(r._min.date) : null;
}

/**
 * Xomashyo o'rtacha kirim narxi — miqdorga tortilgan Σ(qty × unitCost) / Σqty. Bitta manba: `avgUnitCosts`
 * (`lib/stock.ts` — sklad, brigada qoldig'i va kirim formalari ham shundan oladi). Ilgari bu yerda oddiy
 * `AVG(unitCost)` olinardi: 1 kg lik namunaviy kirim 30 t lik partiya bilan bir xil og'irlikda hisoblanib,
 * tannarxni (masalan suvda ~28%) buzardi.
 */
export async function materialCosts() {
  return avgUnitCosts();
}

/**
 * Har mahsulot uchun 1 birlik tannarx (faol retsept × xomashyo o'rtacha narxi). Retsept yo'q → null.
 * Retsept qatorida boshqa mahsulot bo'lsa (masalan FBS blok) — ko'p bosqichli (rekursiv) tannarx
 * hisoblanmaydi, o'sha mahsulotning o'z sotuv narxi taxminiy tannarx sifatida olinadi.
 */
export async function productCosts() {
  const [products, costs] = await Promise.all([
    db.product.findMany({ include: { recipes: { where: { isActive: true }, orderBy: { version: "desc" }, take: 1, include: { items: true } } } }),
    materialCosts(),
  ]);
  const priceOf = new Map(products.map((p) => [p.id, Number(p.price)]));
  const out = new Map<string, { cost: number | null; price: number; name: string; code: string; unit: string; isActive: boolean }>();
  for (const p of products) {
    const items = p.recipes[0]?.items ?? [];
    // Retsept yo'q yoki biror xomashyoning narxi hali kiritilmagan bo'lsa — tannarx noma'lum (0 emas: aks holda marja 100% chiqadi)
    const known = items.length > 0 && items.every((i) => (i.materialId ? costs.has(i.materialId) : true));
    const cost = known
      ? sum(items.map((i) => Number(i.qtyPerM3) * (i.materialId ? (costs.get(i.materialId) ?? 0) : (priceOf.get(i.productId!) ?? 0))))
      : null;
    out.set(p.id, { cost, price: Number(p.price), name: p.name, code: p.code, unit: p.unit, isActive: p.isActive });
  }
  return out;
}

/**
 * Tayyor (dona) mahsulotning 1 birlik tannarxi — ombordagi qiymati uchun (Ombor va Mahsulotlar tablari bir xil).
 * Avval narx bilan kiritilgan kirim/boshlang'ich qoldiq (musbat ADJUSTMENT / PRODUCTION_OUTPUT, miqdorga tortilgan),
 * bo'lmasa retsept tannarxi (> 0). Sotuv narxi tannarx o'rniga olinmaydi — topilmasa `null`.
 */
export async function finishedUnitCosts(): Promise<Map<string, number | null>> {
  const [rows, recipe] = await Promise.all([
    db.$queryRaw<{ productId: string; cost: unknown }[]>`
      SELECT "productId", SUM("qty" * "unitCost") / NULLIF(SUM("qty"), 0) AS "cost"
      FROM "StockMove"
      WHERE "productId" IS NOT NULL AND "unitCost" IS NOT NULL AND "qty" > 0 AND "type" IN ('ADJUSTMENT', 'PRODUCTION_OUTPUT')
      GROUP BY "productId"`,
    productCosts(),
  ]);
  const out = new Map<string, number | null>();
  for (const [id, c] of recipe) out.set(id, c.cost !== null && c.cost > 0 ? c.cost : null);
  for (const r of rows) if (r.cost != null && Number(r.cost) > 0) out.set(r.productId, Number(r.cost));
  return out;
}

/**
 * Sotuv qatorlari (zayavka pozitsiyalari) — davr bo'yicha, bekor/qoralama tashqari.
 * Faqat SALE: sklad zaxirasi zayavkasi (STOCK, narxi 0) sotuv emas — u tushumni, tannarxni,
 * "chegirma"ni va otgruzka rejasini buzardi.
 */
export async function loadSales(from: Date, to: Date, statuses: string[] = ACTIVE_ORDER): Promise<SaleRow[]> {
  const [items, costs, vatPayer] = await Promise.all([
    db.orderItem.findMany({
      where: { order: { kind: "SALE", date: { gte: from, lt: to }, status: { in: statuses as never } } },
      include: { order: { select: { id: true, orderNo: true, date: true, status: true, customerId: true, customer: { select: { name: true } }, createdById: true, createdBy: { select: { fullName: true } } } }, product: { select: { name: true, code: true, unit: true, price: true } } },
    }),
    productCosts(),
    companyVatPayer(),
  ]);
  return items.map((i) => {
    const qty = Number(i.qtyM3), price = Number(i.price), c = costs.get(i.productId)?.cost ?? null;
    const netPrice = vatPayer && i.nds ? withoutNds(price) : price;
    return {
      date: i.order.date, orderId: i.order.id, orderNo: i.order.orderNo, status: i.order.status, customerId: i.order.customerId, customer: i.order.customer.name, sellerId: i.order.createdById, seller: i.order.createdBy.fullName,
      productId: i.productId, product: i.product.name, code: i.product.code, unit: i.product.unit, qty, price, basePrice: Number(i.product.price), revenue: qty * price, cost: qty * (c ?? 0),
      net: qty * netPrice, costKnown: c !== null,
    };
  });
}

/**
 * Tushum (realizatsiya) qatorlari — YETKAZILGAN reyslar bo'yicha, `deliveredAt` sanasida.
 * Zayavka qabul qilingani hali tushum emas: pul va tannarx mahsulot mijozga topshirilganda yuzaga keladi.
 *
 *   miqdor = mijoz qabul qilgani (acceptedQty; bo'lmasa yuklangan − qaytarilgan)
 *   narx   = zayavka pozitsiyalari narxi; reys pozitsiyaga bog'lanmagan — zayavka tarkibi ulushida taqsimlanadi
 *
 * Reyssiz yopilgan zayavka (o'zi olib ketish, ЖБИ hovlidan) — DELIVERED/CLOSED va birorta yetkazilgan reysi
 * yo'q bo'lsa, to'liq summasi yetkazish sanasida (deliveryDate) tushum bo'ladi.
 * Qaytadigan qator `SaleRow` bilan bir xil — marja, mahsulot kesimi va trend shu funksiyadan.
 */
export async function loadRevenue(from: Date, to: Date): Promise<SaleRow[]> {
  const orderSelect = {
    id: true, orderNo: true, date: true, deliveryDate: true, status: true, customerId: true, customer: { select: { name: true } }, createdById: true, createdBy: { select: { fullName: true } },
    items: { select: { productId: true, qtyM3: true, price: true, nds: true, product: { select: { name: true, code: true, unit: true, price: true } } } },
  } as const;
  const [trips, noTrip, costs, vatPayer] = await Promise.all([
    db.trip.findMany({ where: { status: "DELIVERED", deliveredAt: { gte: from, lt: to }, order: { kind: "SALE" } }, select: { deliveredAt: true, qtyM3: true, acceptedQty: true, returnedQty: true, order: { select: orderSelect } } }),
    db.order.findMany({ where: { kind: "SALE", status: { in: ["DELIVERED", "CLOSED"] }, deliveryDate: { gte: from, lt: to }, trips: { none: { status: "DELIVERED" } } }, select: orderSelect }),
    productCosts(),
    companyVatPayer(),
  ]);
  type O = (typeof noTrip)[number];
  const rowsOf = (o: O, date: Date, share: number): SaleRow[] => o.items.map((i) => {
    const qty = Number(i.qtyM3) * share, price = Number(i.price), c = costs.get(i.productId)?.cost ?? null;
    const netPrice = vatPayer && i.nds ? withoutNds(price) : price;
    return {
      date, orderId: o.id, orderNo: o.orderNo, status: o.status, customerId: o.customerId, customer: o.customer.name, sellerId: o.createdById, seller: o.createdBy.fullName,
      productId: i.productId, product: i.product.name, code: i.product.code, unit: i.product.unit, qty, price, basePrice: Number(i.product.price), revenue: qty * price, cost: qty * (c ?? 0),
      net: qty * netPrice, costKnown: c !== null,
    };
  });
  const out: SaleRow[] = [];
  for (const t of trips) {
    const total = sum(t.order.items.map((i) => Number(i.qtyM3)));
    if (total <= 0) continue;
    const loaded = Number(t.qtyM3);
    const accepted = t.acceptedQty != null ? Math.min(loaded, Number(t.acceptedQty)) : Math.max(0, loaded - Number(t.returnedQty ?? 0));
    out.push(...rowsOf(t.order, t.deliveredAt!, accepted / total));
  }
  for (const o of noTrip) out.push(...rowsOf(o, o.deliveryDate, 1));
  return out;
}

/* ───────────── Oy prognozi (bitta formula: Owner dashboard, BI, AI chat) ───────────── */

/** Ish kunlari — Dushanba–Shanba (zavod jadvali). */
export function workingDays(from: Date, to: Date) { let n = 0; for (let d = new Date(from); d < to; d = addDays(d, 1)) if (d.getDay() !== 0) n++; return n; }

/**
 * Joriy oy oxirigacha prognoz: shu kungacha bo'lgan fakt / o'tgan ish kunlari × oydagi ish kunlari.
 * `today` — hisob kuni (bugun kiradi). O'tgan oy uchun fakt o'zi qaytadi.
 */
export function monthForecast(fact: number, today: Date = startOfDay(new Date()), since: Date | null = null) {
  const mStart = new Date(today.getFullYear(), today.getMonth(), 1), mEnd = new Date(today.getFullYear(), today.getMonth() + 1, 1);
  // Oy o'rtasida tizimga o'tilgan bo'lsa (`since` — goLiveDate) sur'at o'tish sanasidan beri hisoblanadi:
  // aks holda 10-sanada boshlangan sotuv 9 ta "bo'sh" ish kuniga bo'linib, prognoz uch baravar past chiqardi.
  // Prognoz esa faqat qolgan oy uchun — o'tishdan oldingi kunlar sotuvi ERP'da yo'q.
  const from = since && since > mStart && since < mEnd ? startOfDay(since) : mStart;
  const wdTotal = workingDays(from, mEnd), wdPassed = workingDays(from, addDays(startOfDay(today), 1));
  return wdPassed > 0 ? (fact / wdPassed) * wdTotal : 0;
}

export type Kpi = { cur: number; prev: number; delta: number | null };
export const kpi = (cur: number, prev: number): Kpi => ({ cur, prev, delta: delta(cur, prev) });

/** Kapital narxi — muzlagan pul kuniga qancha turadi (yillik 24%). */
export const CAPITAL_RATE_DAY = 0.24 / 365;
