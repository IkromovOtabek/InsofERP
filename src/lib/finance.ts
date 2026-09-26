import { db } from "./db";
import type { Prisma } from "@/generated/prisma";

/** Har bir yangi mijozga ajratiladigan standart kredit limiti (so'm). */
export const DEFAULT_CREDIT_LIMIT = 100_000_000;

/** Mijozning joriy qarzi: ochiq schyotlar − ularga to'langan summa. */
export async function customerDebt(customerId: string) {
  const [inv, pay] = await Promise.all([
    db.invoice.aggregate({ where: { customerId, status: { in: ["OPEN", "PARTIAL"] } }, _sum: { amount: true } }),
    db.payment.aggregate({ where: { customerId, invoice: { status: { in: ["OPEN", "PARTIAL"] } } }, _sum: { amount: true } }),
  ]);
  return Number(inv._sum.amount ?? 0) - Number(pay._sum.amount ?? 0);
}

/** Tasdiqlangan, lekin hali schyot yozilmagan zayavkalar summasi (limitga kiradi). */
export async function customerOpenOrdersTotal(customerId: string, excludeOrderId?: string) {
  // Sklad zaxirasi zayavkasi (kind = STOCK) limitga kirmaydi — unda mijoz ham, summa ham yo'q
  const orderWhere: Prisma.OrderWhereInput = { customerId, kind: "SALE", status: { in: ["CONFIRMED", "IN_PRODUCTION", "DELIVERED"] }, invoices: { none: {} }, ...(excludeOrderId ? { id: { not: excludeOrderId } } : {}) };
  const [items, adv] = await Promise.all([
    db.orderItem.findMany({ where: { order: orderWhere }, select: { qtyM3: true, price: true } }),
    // zayavka ochilganda olingan avans ochiq summani kamaytiradi
    db.payment.aggregate({ where: { invoiceId: null, order: orderWhere }, _sum: { amount: true } }),
  ]);
  return Math.max(0, items.reduce((s, i) => s + Number(i.qtyM3) * Number(i.price), 0) - Number(adv._sum?.amount ?? 0));
}

export type CustomerCredit = {
  limit: number;
  debt: number; // ochiq schyotlar bo'yicha qarz
  open: number; // schyot yozilmagan tasdiqlangan zayavkalar
  used: number; // debt + open — limitdan ayiriladi
  free: number; // limit − used
  blacklisted: boolean; // limit to'liq ishlatilgan (free ≤ 0)
};

function creditOf(limit: number, debt: number, open: number): CustomerCredit {
  const used = debt + open;
  const free = limit - used;
  return { limit, debt, open, used, free, blacklisted: free <= 0 };
}

/**
 * Bitta mijozning limit holati. Qora ro'yxat saqlanmaydi — har safar hisoblanadi:
 * qarz to'lansa mijoz avtomatik ro'yxatdan chiqadi.
 */
export async function customerCredit(customerId: string): Promise<CustomerCredit> {
  const [c, debt, open] = await Promise.all([
    db.customer.findUniqueOrThrow({ where: { id: customerId }, select: { creditLimit: true } }),
    customerDebt(customerId),
    customerOpenOrdersTotal(customerId),
  ]);
  return creditOf(Number(c.creditLimit), debt, open);
}

/** Barcha (yoki berilgan) mijozlar uchun limit holati — ro'yxat va tanlov oynalari uchun bitta so'rovda. */
export async function customersCredit(ids?: string[]): Promise<Map<string, CustomerCredit>> {
  // Ichki "Sklad" kartochkasi mijoz emas — limit ham, reyting ham hisoblanmaydi
  const where: Prisma.CustomerWhereInput = { isInternal: false, ...(ids ? { id: { in: ids } } : {}) };
  const openOrderWhere: Prisma.OrderWhereInput = { kind: "SALE", status: { in: ["CONFIRMED", "IN_PRODUCTION", "DELIVERED"] }, invoices: { none: {} }, ...(ids ? { customerId: { in: ids } } : {}) };
  const [customers, inv, pay, items, adv] = await Promise.all([
    db.customer.findMany({ where, select: { id: true, creditLimit: true } }),
    db.invoice.groupBy({ by: ["customerId"], where: { status: { in: ["OPEN", "PARTIAL"] }, ...(ids ? { customerId: { in: ids } } : {}) }, _sum: { amount: true } }),
    db.payment.groupBy({ by: ["customerId"], where: { invoice: { status: { in: ["OPEN", "PARTIAL"] } }, ...(ids ? { customerId: { in: ids } } : {}) }, _sum: { amount: true } }),
    db.orderItem.findMany({ where: { order: openOrderWhere }, select: { qtyM3: true, price: true, order: { select: { customerId: true } } } }),
    db.payment.groupBy({ by: ["customerId"], where: { invoiceId: null, order: openOrderWhere }, _sum: { amount: true } }),
  ]);
  const debt = new Map<string, number>();
  for (const x of inv) debt.set(x.customerId, (debt.get(x.customerId) ?? 0) + Number(x._sum.amount ?? 0));
  for (const x of pay) debt.set(x.customerId, (debt.get(x.customerId) ?? 0) - Number(x._sum.amount ?? 0));
  const open = new Map<string, number>();
  for (const i of items) open.set(i.order.customerId, (open.get(i.order.customerId) ?? 0) + Number(i.qtyM3) * Number(i.price));
  for (const a of adv) open.set(a.customerId, Math.max(0, (open.get(a.customerId) ?? 0) - Number(a._sum?.amount ?? 0)));
  return new Map(customers.map((c) => [c.id, creditOf(Number(c.creditLimit), debt.get(c.id) ?? 0, open.get(c.id) ?? 0)]));
}

// ───────────────────────── Mijoz tarixi va ishonch reytingi ─────────────────────────

/** Xaridga kiruvchi zayavka holatlari: qabul qilingan va bekor qilinmagan. */
const BOUGHT_STATUSES = ["CONFIRMED", "IN_PRODUCTION", "DELIVERED", "CLOSED"] as const;

export type CustomerHistory = {
  bought: number; // bizdan olgan mahsulot summasi (qabul qilingan zayavkalar)
  orders: number; // shunday zayavkalar soni
  paid: number; // hozirgacha to'lagan summa
  invoiced: number; // yozilgan schyotlar (bekor qilinganlarsiz)
  firstOrderAt: Date | null;
  lastOrderAt: Date | null;
  stars: 0 | 1 | 2 | 3 | 4 | 5; // 0 — yangi mijoz (hali xarid yo'q)
  label: string;
};

export const STAR_LABELS: Record<CustomerHistory["stars"], string> = {
  0: "Yangi mijoz",
  1: "Boshlang'ich",
  2: "O'rtacha",
  3: "Yaxshi",
  4: "Ishonchli",
  5: "A'lo mijoz",
};

/**
 * Yulduzli reyting (1–5). Saqlanmaydi, har safar hisoblanadi:
 *  - asos — xarid hajmi: <50 mln → 1, <200 mln → 2, <500 mln → 3, <1 mlrd → 4, ≥1 mlrd → 5;
 *  - doimiylik — 5+ zayavka bo'lsa +1;
 *  - to'lov intizomi — schyotlarning yarmidan kami to'langan bo'lsa −1;
 *  - qarz limitning yarmidan oshsa −1; qora ro'yxat — eng ko'pi 1 yulduz.
 */
export function customerStars(h: { bought: number; orders: number; paid: number; invoiced: number }, credit: { limit: number; debt: number; blacklisted: boolean }): CustomerHistory["stars"] {
  if (h.orders === 0) return 0;
  let s = h.bought >= 1e9 ? 5 : h.bought >= 500e6 ? 4 : h.bought >= 200e6 ? 3 : h.bought >= 50e6 ? 2 : 1;
  if (h.orders >= 5) s += 1;
  if (h.invoiced > 0 && h.paid / h.invoiced < 0.5) s -= 1;
  if (credit.limit > 0 && credit.debt > credit.limit / 2) s -= 1;
  if (credit.blacklisted) s = Math.min(s, 1);
  return Math.max(1, Math.min(5, s)) as CustomerHistory["stars"];
}

/** Barcha (yoki berilgan) mijozlar uchun xarid tarixi va reyting — zayavka formasi va ro'yxatlar uchun. */
export async function customersHistory(ids?: string[], creditMap?: Map<string, CustomerCredit>): Promise<Map<string, CustomerHistory>> {
  const byId = ids ? { customerId: { in: ids } } : {};
  const [credit, orders, pay, inv] = await Promise.all([
    creditMap ?? customersCredit(ids),
    db.order.findMany({ where: { kind: "SALE", status: { in: [...BOUGHT_STATUSES] }, ...byId }, select: { customerId: true, date: true, items: { select: { qtyM3: true, price: true } } } }),
    db.payment.groupBy({ by: ["customerId"], where: byId, _sum: { amount: true } }),
    db.invoice.groupBy({ by: ["customerId"], where: { status: { not: "CANCELLED" }, ...byId }, _sum: { amount: true } }),
  ]);
  const acc = new Map<string, { bought: number; orders: number; first: Date | null; last: Date | null }>();
  for (const o of orders) {
    const a = acc.get(o.customerId) ?? { bought: 0, orders: 0, first: null, last: null };
    a.bought += o.items.reduce((s, i) => s + Number(i.qtyM3) * Number(i.price), 0);
    a.orders += 1;
    if (!a.first || o.date < a.first) a.first = o.date;
    if (!a.last || o.date > a.last) a.last = o.date;
    acc.set(o.customerId, a);
  }
  const paid = new Map(pay.map((p) => [p.customerId, Number(p._sum.amount ?? 0)]));
  const invoiced = new Map(inv.map((i) => [i.customerId, Number(i._sum.amount ?? 0)]));
  const out = new Map<string, CustomerHistory>();
  for (const id of credit.keys()) {
    const a = acc.get(id) ?? { bought: 0, orders: 0, first: null, last: null };
    const h = { bought: a.bought, orders: a.orders, paid: paid.get(id) ?? 0, invoiced: invoiced.get(id) ?? 0 };
    const stars = customerStars(h, credit.get(id)!);
    out.set(id, { ...h, firstOrderAt: a.first, lastOrderAt: a.last, stars, label: STAR_LABELS[stars] });
  }
  return out;
}

/**
 * Qora ro'yxatdagi mijozlar ID to'plami — ro'yxat sahifalarida har bir qatorga belgi qo'yish uchun.
 * `ids` berilsa faqat shular tekshiriladi (sahifadagi mijozlar), aks holda hammasi.
 */
export async function blacklistedIds(ids?: string[]): Promise<Set<string>> {
  const uniq = ids ? [...new Set(ids)] : undefined;
  if (uniq && uniq.length === 0) return new Set();
  const credit = await customersCredit(uniq);
  return new Set([...credit.entries()].filter(([, c]) => c.blacklisted).map(([id]) => id));
}

/** Tanlov ro'yxatlari (<option>) uchun matnli belgi — JSX ishlatib bo'lmaydigan joylarda. */
export const BLACKLIST_TEXT = "QORA RO'YXAT";
export const CONTRACT_TEXT = "SHARTNOMA";

/**
 * Shartnoma tuzgan mijozlar ID to'plami: bekor qilinmagan, shartnomali zayavkasi bor mijozlar.
 * Mijoz nomi chiqadigan joylarda "Shartnoma" belgisi shu bo'yicha qo'yiladi.
 */
export async function contractedIds(ids?: string[]): Promise<Set<string>> {
  const uniq = ids ? [...new Set(ids)] : undefined;
  if (uniq && uniq.length === 0) return new Set();
  const rows = await db.order.findMany({
    where: { contractAmount: { not: null }, status: { not: "CANCELLED" }, ...(uniq ? { customerId: { in: uniq } } : {}) },
    select: { customerId: true }, distinct: ["customerId"],
  });
  return new Set(rows.map((r) => r.customerId));
}

export type CustomerMarks = { black: Set<string>; contract: Set<string> };

/** Mijoz belgilari bitta chaqiruvda: qora ro'yxat + shartnoma. Ro'yxat sahifalari uchun. */
export async function customerMarks(ids?: string[]): Promise<CustomerMarks> {
  const [black, contract] = await Promise.all([blacklistedIds(ids), contractedIds(ids)]);
  return { black, contract };
}

/** <option> matni: belgilar prefiks sifatida — "QORA RO'YXAT · SHARTNOMA · Nomi". */
export function markedName(name: string, id: string, m: CustomerMarks) {
  return [m.black.has(id) && BLACKLIST_TEXT, m.contract.has(id) && CONTRACT_TEXT, name].filter(Boolean).join(" · ");
}
