import { cache } from "react";
import { db } from "@/lib/db";
import { isoDate } from "@/lib/format";
import { avgUnitCosts } from "@/lib/stock";
import { companyVatPayer } from "@/lib/receipt-vat";
import { withoutNds } from "@/lib/nds";
import { normalizeUnit } from "@/lib/unit";
import { productNameKey } from "@/lib/product-name";
import { countWorkDays, monthWorkDays, type WorkCalendar } from "@/lib/work-calendar";

/* ───────────── Davr ───────────── */

export type Period = "day" | "month" | "year" | "custom";
export type Range = { period: Period; from: Date; to: Date; prevFrom: Date; prevTo: Date; days: number; label: string; prevLabel: string };
export type Gran = "day" | "week" | "month";

const DAY = 86400000;
export const startOfDay = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
export const addDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY);
const fmt = (d: Date) => `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;

/**
 * Taqqoslanadigan davr (Sarvar rejasi 3-bosqich, 2026-11-24): oy — o'tgan oyning SHU kunlari (01.11–23.11 ↔ 01.10–23.10;
 * o'tgan oy qisqa bo'lsa oy oxirida kesiladi: 31.12 ↔ 01.11–30.11), yil — o'tgan yilning shu kunlari, kun — kecha,
 * erkin oraliq — undan oldingi teng uzunlikdagi oraliq. Ilgari oy uchun «oldingi N kun» olinardi (01.11–23.11 ↔ 09.10–31.10).
 * `to` — eksklyuziv (ertangi kun boshi).
 */
export function comparisonWindow(period: Period, from: Date, to: Date): { prevFrom: Date; prevTo: Date } {
  const days = Math.max(1, Math.round((to.getTime() - from.getTime()) / DAY));
  if (period === "month") {
    const prevFrom = new Date(from.getFullYear(), from.getMonth() - 1, 1);
    const prevTo = new Date(Math.min(addDays(prevFrom, days).getTime(), from.getTime()));
    return { prevFrom, prevTo };
  }
  if (period === "year") {
    const prevFrom = new Date(from.getFullYear() - 1, 0, 1);
    const last = addDays(to, -1); // davrning oxirgi kuni
    // 29-fevral → o'tgan yilda 28-fevral (Date 1-martga o'tkazib yubormasin)
    const sameDay = new Date(from.getFullYear() - 1, last.getMonth(), Math.min(last.getDate(), new Date(from.getFullYear() - 1, last.getMonth() + 1, 0).getDate()));
    return { prevFrom, prevTo: new Date(Math.min(addDays(sameDay, 1).getTime(), from.getTime())) };
  }
  return { prevFrom: addDays(from, -days), prevTo: from };
}

/** `now` — sinov uchun (standart: hozir). */
export function parseRange(sp: { period?: string; from?: string; to?: string }, now: Date = new Date()): Range {
  const today = startOfDay(now), tomorrow = addDays(today, 1);
  let period: Period = sp.period === "day" || sp.period === "year" ? sp.period : "month";
  let from: Date, to: Date;
  if (sp.from && sp.to && !Number.isNaN(Date.parse(sp.from)) && !Number.isNaN(Date.parse(sp.to))) {
    period = "custom"; from = startOfDay(new Date(sp.from)); to = addDays(startOfDay(new Date(sp.to)), 1);
    if (to <= from) to = addDays(from, 1);
  } else if (period === "day") { from = today; to = tomorrow; }
  else if (period === "year") { from = new Date(today.getFullYear(), 0, 1); to = tomorrow; }
  else { from = new Date(today.getFullYear(), today.getMonth(), 1); to = tomorrow; }
  const days = Math.max(1, Math.round((to.getTime() - from.getTime()) / DAY));
  const { prevFrom, prevTo } = comparisonWindow(period, from, to);
  const prevDays = Math.max(1, Math.round((prevTo.getTime() - prevFrom.getTime()) / DAY));
  const label = days === 1 ? fmt(from) : `${fmt(from)} — ${fmt(addDays(to, -1))}`;
  const prevLabel = prevDays === 1 ? fmt(prevFrom) : `${fmt(prevFrom)} — ${fmt(addDays(prevTo, -1))}`;
  return { period, from, to, prevFrom, prevTo, days, label, prevLabel };
}

/**
 * Taqqoslash davri uchun ma'lumot bormi: tizim ishga tushgan sanadan (`goLiveDate`) oldin tugagan davr — «ma'lumot yo'q»
 * (0 emas: aks holda «−100%» / «o'tgan oy jami 0» chiqib, yolg'on pasayish ko'rinadi). Ishga tushish sanasi noma'lum — bor deb olinadi.
 */
export const hasPrevData = (r: Pick<Range, "prevTo">, goLive: Date | null) => !goLive || r.prevTo.getTime() > startOfDay(goLive).getTime();

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
  /**
   * Taxminiy tannarx — faqat `costKnown` yo'q qatorda (`estimateCosts`): retseptsiz mahsulot tushumi foydadan tushib qolmasin
   * va 100% foyda bo'lib ham ko'rinmasin. Yalpi foyda/marja (`grossOf`, `marginOf`) va PNL — ikkalasi shuni oladi.
   */
  estCost?: number;
  /** Faqat Realizatsiya reestri qatorida: zayavka yo'q — to'lov turi, dastavka (QQS'siz) va uning QQS'i, guruh va manzil qatorning o'zidan */
  rz?: { payGroup: "BANK" | "CASH" | "DEBT"; delivery: number; deliveryVat: number; group: string; address: string };
};

/*
 * ───────────── Yalpi foyda: bitta qoida (Sarvar rejasi 1.2) ─────────────
 * Yalpi foyda = QQS'siz tushum − sotilgan mahsulot tannarxi. Tannarx retsept bo'yicha; retsepti yo'q mahsulotda — taxminiy
 * (`estCost`, shu birlikdagi retseptli sotuv ulushi). PNL (`lib/fin-report/pnl.ts`) ham aynan shu `cogsOf` bilan hisoblaydi —
 * Bugun (PNL) va Tahlil bir xil raqam ko'rsatadi. Ilgari Tahlil faqat retseptli qatorlarni olardi: 329 mln ↔ PNL 2,24 mlrd.
 * Hech qanday tannarxi yo'q (taxmin ham) tushum `uncostedRevenue` — ogohlantirish uchun.
 */
/** Qatorning sotilgan mahsulot tannarxi: retsept bo'yicha, bo'lmasa taxminiy, u ham bo'lmasa 0 */
export const cogsOf = (r: SaleRow) => (r.costKnown ? r.cost : r.estCost ?? 0);
/** Tannarxi retsept bo'yicha ma'lum qatorlar (mahsulot kesimidagi aniq marja jadvallari uchun) */
export const costedRows = (rows: SaleRow[]) => rows.filter((r) => r.costKnown);
/** Yalpi foyda (QQS'siz tushum − tannarx) — PNL «YALPI FOYDA» bilan bir qoida */
export const grossOf = (rows: SaleRow[]) => sum(rows.map((r) => r.net - cogsOf(r)));
/** Marja %: yalpi foyda / QQS'siz tushum */
export const marginOf = (rows: SaleRow[]) => safeDiv(grossOf(rows), sum(rows.map((r) => r.net))) * 100;
/** Tannarxi umuman noma'lum (retsept ham, taxmin uchun asos ham yo'q) tushum, QQS bilan — foyda oshib ko'rinadi, ogohlantirish */
export const uncostedRevenue = (rows: SaleRow[]) => sum(rows.filter((r) => !r.costKnown && r.estCost === undefined).map((r) => r.revenue));
/** Tannarxi taxminiy (retseptsiz) tushum, QQS bilan — «taxminiy» izohi uchun */
export const estimatedRevenue = (rows: SaleRow[]) => sum(rows.filter((r) => !r.costKnown && r.estCost !== undefined).map((r) => r.revenue));

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
 * Bitta sahifa chizilishi ichida bir marta (`cache`): har `loadRevenue`/`loadOrders` uni qayta so'rardi. Natija o'zgartirilmaydi.
 */
export const productCosts = cache(async () => {
  const [products, costs] = await Promise.all([
    db.product.findMany({ include: { recipes: { where: { isActive: true }, orderBy: { version: "desc" }, take: 1, include: { items: true } } } }),
    materialCosts(),
  ]);
  const priceOf = new Map(products.map((p) => [p.id, Number(p.price)]));
  const out = new Map<string, { cost: number | null; price: number; name: string; aliases: string[]; code: string; unit: string; isActive: boolean }>();
  for (const p of products) {
    const items = p.recipes[0]?.items ?? [];
    // Retsept yo'q yoki biror xomashyoning narxi hali kiritilmagan bo'lsa — tannarx noma'lum (0 emas: aks holda marja 100% chiqadi)
    const known = items.length > 0 && items.every((i) => (i.materialId ? costs.has(i.materialId) : true));
    const cost = known
      ? sum(items.map((i) => Number(i.qtyPerM3) * (i.materialId ? (costs.get(i.materialId) ?? 0) : (priceOf.get(i.productId!) ?? 0))))
      : null;
    out.set(p.id, { cost, price: Number(p.price), name: p.name, aliases: p.aliases, code: p.code, unit: p.unit, isActive: p.isActive });
  }
  return out;
});

/**
 * Tayyor (dona) mahsulotning 1 birlik tannarxi — ombordagi qiymati uchun (Ombor va Mahsulotlar tablari bir xil).
 * Avval narx bilan kiritilgan kirim/boshlang'ich qoldiq (musbat ADJUSTMENT / PRODUCTION_OUTPUT, miqdorga tortilgan),
 * bo'lmasa retsept tannarxi (> 0). Sotuv narxi tannarx o'rniga olinmaydi — topilmasa `null`.
 */
export const finishedUnitCosts = cache(async (): Promise<Map<string, number | null>> => {
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
});

/**
 * Sotuvchi (reyting, reja, "mening sotuvim"): mijozga biriktirilgan agent; agent yo'q bo'lsa — zayavkani kiritgan xodim.
 * Ofis menejeri agentning mijoziga zayavka kiritsa ham sotuv agentniki.
 */
const SELLER_SELECT = { customer: { select: { name: true, agentId: true, agent: { select: { fullName: true } } } }, createdById: true, createdBy: { select: { fullName: true } } } as const;
type SellerSrc = { customer: { name: string; agentId: string | null; agent: { fullName: string } | null }; createdById: string; createdBy: { fullName: string } };
export const sellerOf = (o: SellerSrc) => (o.customer.agentId && o.customer.agent ? { sellerId: o.customer.agentId, seller: o.customer.agent.fullName } : { sellerId: o.createdById, seller: o.createdBy.fullName });

/**
 * Sotuv = YETKAZILGAN mahsulot (`loadRevenue`, yetkazilgan sana bo'yicha) — Tahlil, Egasi paneli, mobil va AI'da
 * bitta raqam chiqishi uchun. Holatlar berilsa (BLOCKED, CANCELLED…) — zayavka sanasi bo'yicha zayavkalar (`loadOrders`):
 * bloklangan/bekor qilingan hech qachon yetkazilmaydi.
 */
export async function loadSales(from: Date, to: Date, statuses?: string[]): Promise<SaleRow[]> {
  return statuses ? loadOrders(from, to, statuses) : loadRevenue(from, to);
}

/**
 * Zayavka pozitsiyalari — zayavka sanasi bo'yicha, berilgan holatlarda.
 * Faqat SALE: sklad zaxirasi zayavkasi (STOCK, narxi 0) sotuv emas — u tushumni, tannarxni,
 * "chegirma"ni va otgruzka rejasini buzardi.
 */
export async function loadOrders(from: Date, to: Date, statuses: string[] = ACTIVE_ORDER): Promise<SaleRow[]> {
  const [items, costs, vatPayer] = await Promise.all([
    db.orderItem.findMany({
      where: { order: { kind: "SALE", date: { gte: from, lt: to }, status: { in: statuses as never } } },
      include: { order: { select: { id: true, orderNo: true, date: true, status: true, customerId: true, ...SELLER_SELECT } }, product: { select: { name: true, code: true, unit: true, price: true } } },
    }),
    productCosts(),
    companyVatPayer(),
  ]);
  const out: SaleRow[] = items.map((i) => {
    const qty = Number(i.qtyM3), price = Number(i.price), c = costs.get(i.productId)?.cost ?? null;
    const netPrice = vatPayer && i.nds ? withoutNds(price) : price;
    return {
      date: i.order.date, orderId: i.order.id, orderNo: i.order.orderNo, status: i.order.status, customerId: i.order.customerId, customer: i.order.customer.name, ...sellerOf(i.order),
      productId: i.productId, product: i.product.name, code: i.product.code, unit: i.product.unit, qty, price, basePrice: Number(i.product.price), revenue: qty * price, cost: qty * (c ?? 0),
      net: qty * netPrice, costKnown: c !== null,
    };
  });
  // Yalpi foyda/marja bitta qoida bilan (`grossOf`) — retseptsiz pozitsiyaga ham taxminiy tannarx
  estimateCosts(out, costs);
  return out;
}

/**
 * Tushum (sotuv) qatorlari — Sotuv → «Realizatsiya» reestrining o'zi (`realizationLog`, 2026-11-27 qaror: Tahlil «Jami sotuv»
 * = Realizatsiya «Jami»). Bekor qilinmagan har reys (yuklangan kun, bo'lmasa ochilgan kun), reyssiz yopilgan zayavka
 * (yetkazish sanasi) va qo'lda / Excel qatorlar; dispetcher tuzatishlari (sana, miqdor, narx, dastavka) bilan.
 *
 *   revenue = reestr «Jami» (mahsulot + dastavka, QQS bilan) — Tahlil, Egasi paneli, mobil va AI'dagi sotuv
 *   net     = mahsulot qismi QQS'siz, dastavkasiz — marja va PNL (logistika dastavkasi zavod daromadi emas)
 *   rz      = har qatorda: to'lov turi, dastavka va uning QQS'i, guruh, manzil
 *
 * Reysdan qatorda `orderId` — zayavka (sotuvchi, holat shundan); qo'lda qatorda `rz:` kalit.
 */
export async function loadRevenue(from: Date, to: Date): Promise<SaleRow[]> {
  // Nusxa: chaqiruvchi massivni joyida saralasa, keshdagi boshqa chaqiruvchiga ta'sir qilmasin (qatorlar o'zgartirilmaydi)
  return [...(await revenueOnce(from.getTime(), to.getTime()))];
}
/** Bir xil davr bitta sahifada bir necha marta so'raladi (direktor bosh sahifasi: «Bugun», panel) — bir marta (`cache`). */
const revenueOnce = cache((from: number, to: number) => queryRevenue(new Date(from), new Date(to)));

async function queryRevenue(from: Date, to: Date): Promise<SaleRow[]> {
  // Sotuv → «Realizatsiya» reestri bilan bitta manba: o'sha qatorlar, o'sha sana va o'sha «Jami» (dinamik import — halqali bog'lanish)
  const { realizationLog } = await import("@/lib/realization-log");
  const last = new Date(to.getTime() - 1);
  if (last < from) return [];
  const [log, costs, vatPayer] = await Promise.all([realizationLog(from, last), productCosts(), companyVatPayer()]);
  const orderIds = [...new Set(log.flatMap((r) => (r.source === "AUTO" && r.orderId ? [r.orderId] : [])))];
  const manual = log.filter((r) => r.source === "MANUAL");
  const custIds = [...new Set(manual.flatMap((r) => (r.customerId ? [r.customerId] : [])))];
  const [orders, customers, users] = await Promise.all([
    orderIds.length ? db.order.findMany({ where: { id: { in: orderIds } }, select: { id: true, orderNo: true, status: true, customerId: true, ...SELLER_SELECT } }) : [],
    custIds.length ? db.customer.findMany({ where: { id: { in: custIds } }, select: { id: true, agentId: true, agent: { select: { fullName: true } } } }) : [],
    manual.some((r) => r.seller) ? db.user.findMany({ select: { id: true, fullName: true } }) : [],
  ]);
  const orderOf = new Map(orders.map((o) => [o.id, o]));
  const agentOf = new Map(customers.map((c) => [c.id, c]));
  const userByName = new Map(users.map((u) => [nameKey(u.fullName), u]));
  // Bir xil nomli mahsulotlardan: tannarxi ma'lumi, keyin faoli. Nom kaliti (`productNameKey`: kirill/lotin, «3,5»/«3.5»)
  // va boshqa nomlari bilan — «ПК 59-12-8» yoki eski «PK 59-12-8» qatori birlashtirilgan «PK 59-12-8 A 400» ga tushadi
  const productByName = new Map<string, string>();
  const rank = (id: string) => { const p = costs.get(id)!; return (p.cost !== null ? 2 : 0) + (p.isActive ? 1 : 0); };
  for (const [id, p] of costs) {
    const k = productNameKey(p.name), cur = productByName.get(k);
    if (k && (!cur || rank(id) > rank(cur))) productByName.set(k, id);
  }
  for (const [id, p] of costs) for (const a of p.aliases) { const k = productNameKey(a); if (k && !productByName.has(k)) productByName.set(k, id); }

  const out: SaleRow[] = [];
  for (const r of log) {
    const o = r.source === "AUTO" && r.orderId ? orderOf.get(r.orderId) : undefined;
    // Katalogga bog'lanmagan (yoki nomi tuzatilgan) qator — mahsulot nomi bo'yicha (faqat hisobda, reestr o'zgarmaydi)
    const pid = (r.productId && costs.has(r.productId) ? r.productId : null) ?? productByName.get(productNameKey(r.product)) ?? null;
    const lp = pid ? costs.get(pid) : undefined;
    const c = lp?.cost ?? null;
    // «Jami» = mahsulot (QQS bilan) + dastavka (QQS bilan); marja va PNL uchun mahsulot qismi dastavkasiz
    const goods = r.total - r.delivery - r.deliveryVat;
    const goodsNet = vatPayer ? r.net - r.delivery : goods;
    const unitPrice = r.qty > 0 ? goods / r.qty : r.price;
    let head: Pick<SaleRow, "orderId" | "orderNo" | "status" | "customerId" | "customer" | "sellerId" | "seller">;
    if (o) head = { orderId: o.id, orderNo: o.orderNo, status: o.status, customerId: r.customerId ?? o.customerId, customer: r.customer, ...sellerOf(o) };
    else {
      const customerId = r.customerId ?? `${REALIZATION_PREFIX}c:${nameKey(r.customer)}`;
      const ag = r.customerId ? agentOf.get(r.customerId) : undefined;
      const u = r.seller ? userByName.get(nameKey(r.seller)) : undefined;
      const seller = ag?.agentId && ag.agent ? { sellerId: ag.agentId, seller: ag.agent.fullName }
        : u ? { sellerId: u.id, seller: u.fullName }
        : { sellerId: `${REALIZATION_PREFIX}s:${nameKey(r.seller)}`, seller: r.seller.trim() || "Ko'rsatilmagan" };
      head = { orderId: `${REALIZATION_PREFIX}${isoDate(r.date)}:${customerId}`, orderNo: r.ttn ? `TTN ${r.ttn}` : "Realizatsiya", status: "DELIVERED", customerId, customer: r.customer, ...seller };
    }
    out.push({
      date: r.date, ...head,
      productId: pid ?? `${REALIZATION_PREFIX}p:${nameKey(r.product)}`, product: lp?.name ?? r.product, code: lp?.code ?? "", unit: lp?.unit ?? r.unitKey,
      qty: r.qty, price: unitPrice, basePrice: o && lp ? lp.price : unitPrice, revenue: r.total, cost: r.qty * (c ?? 0),
      net: goodsNet, costKnown: c !== null,
      rz: { payGroup: r.pay, delivery: r.delivery, deliveryVat: r.deliveryVat, group: r.group, address: r.destination },
    });
  }
  estimateCosts(out, costs);
  return out;
}

/** Birlik kaliti (m3 / dona / t …): reestrda birlik qo'lda yozilgan bo'ladi ("М3", "шт"). */
const unitKey = (u: string) => normalizeUnit(u) ?? u.trim().toLowerCase();

/**
 * Tannarxi noma'lum qatorga taxminiy tannarx (`estCost`). Ulush — shu birlikdagi (m³, dona…) tannarxi ma'lum qatorlarning
 * tannarx ÷ QQS'siz tushumi (shu davr sotuvi); davrda bunday sotuv bo'lmasa — katalogdagi retseptli faol mahsulotlar
 * (retsept tannarxi ÷ narx), u ham bo'lmasa — barcha birliklar bo'yicha. Hech qanday asos bo'lmasa taxmin qo'yilmaydi.
 */
function estimateCosts(rows: SaleRow[], costs: Awaited<ReturnType<typeof productCosts>>) {
  if (!rows.some((r) => !r.costKnown)) return;
  const acc = (m: Map<string, { c: number; n: number }>, k: string, c: number, n: number) => {
    const cur = m.get(k) ?? { c: 0, n: 0 };
    m.set(k, { c: cur.c + c, n: cur.n + n });
  };
  const sold = new Map<string, { c: number; n: number }>(), catalog = new Map<string, { c: number; n: number }>();
  for (const r of rows) if (r.costKnown && r.net > 0) acc(sold, unitKey(r.unit), r.cost, r.net);
  for (const p of costs.values()) {
    if (p.cost === null || !(p.price > 0) || !p.isActive) continue;
    acc(catalog, unitKey(p.unit), p.cost, p.price);
    acc(catalog, "*", p.cost, p.price);
  }
  const share = (s?: { c: number; n: number }) => (s && s.n > 0 ? Math.min(1, Math.max(0, s.c / s.n)) : null);
  for (const r of rows) {
    if (r.costKnown) continue;
    const u = unitKey(r.unit);
    const k = share(sold.get(u)) ?? share(catalog.get(u)) ?? share(catalog.get("*"));
    if (k !== null) r.estCost = r.net * k;
  }
}

/** Realizatsiya reestri qatori (`RealizationEntry`) — `SaleRow.orderId` shu prefiks bilan boshlanadi (zayavka emas, havola reestrga). */
export const REALIZATION_PREFIX = "rz:";
export const isRealizationRow = (r: { orderId: string }) => r.orderId.startsWith(REALIZATION_PREFIX);
const nameKey = (v: string) => v.trim().toLowerCase().replace(/[ʻʼ’‘`']/g, "").replace(/\s+/g, " ");

/* ───────────── Oy prognozi (bitta formula: Owner dashboard, BI, AI chat) ───────────── */

/** Ish kunlari — zavod ish kalendari bo'yicha (haftalik dam olish + bayramlar, `lib/work-calendar.ts`). */
export function workingDays(from: Date, to: Date, cal: WorkCalendar) { return countWorkDays(cal, from, to); }

/**
 * Joriy oy oxirigacha prognoz: shu kungacha bo'lgan fakt / o'tgan ish kunlari × oydagi ish kunlari.
 * `today` — hisob kuni (bugun kiradi). O'tgan oy uchun fakt o'zi qaytadi.
 */
export function monthForecast(fact: number, cal: WorkCalendar, today: Date = startOfDay(new Date()), since: Date | null = null) {
  const mStart = new Date(today.getFullYear(), today.getMonth(), 1), mEnd = new Date(today.getFullYear(), today.getMonth() + 1, 1);
  // Oy o'rtasida tizimga o'tilgan bo'lsa (`since` — goLiveDate) sur'at o'tish sanasidan beri hisoblanadi:
  // aks holda 10-sanada boshlangan sotuv 9 ta "bo'sh" ish kuniga bo'linib, prognoz uch baravar past chiqardi.
  // Prognoz esa faqat qolgan oy uchun — o'tishdan oldingi kunlar sotuvi ERP'da yo'q.
  const from = since && since > mStart && since < mEnd ? startOfDay(since) : mStart;
  // Butun oy bo'lsa — oydagi ish kuni (qo'lda kiritilgan bo'lishi mumkin), aks holda o'tish sanasidan kalendar bo'yicha
  const wdTotal = from.getTime() === mStart.getTime() ? monthWorkDays(cal, mStart.getFullYear(), mStart.getMonth() + 1) : workingDays(from, mEnd, cal);
  const wdPassed = workingDays(from, addDays(startOfDay(today), 1), cal);
  return wdPassed > 0 ? (fact / wdPassed) * wdTotal : 0;
}

export type Kpi = { cur: number; prev: number; delta: number | null };
export const kpi = (cur: number, prev: number): Kpi => ({ cur, prev, delta: delta(cur, prev) });

/** Kapital narxi — muzlagan pul kuniga qancha turadi (yillik 24%). */
export const CAPITAL_RATE_DAY = 0.24 / 365;
