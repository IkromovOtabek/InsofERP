import { db } from "./db";
import type { Prisma } from "@/generated/prisma";
import { customerBalances, balanceOf } from "./receivables";
import { orderTotal } from "@/lib/order-total";
import { tripCoveredQty } from "@/lib/trips";

/**
 * Har bir yangi mijozga ajratiladigan standart kredit limiti (so'm) — direktor Sozlamalar → Limitlar'da belgilaydi
 * (`CompanySettings.defaultCreditLimit`). 0 — yangi mijoz qarzga olmaydi, naqd/avans bilan ishlaydi; qarz berish
 * kerak bo'lsa direktor/moliya mijoz kartasida limitni oshiradi. Faqat YANGI mijozga qo'llanadi.
 * Mijoz yaratiladigan har joy (forma, Excel, zayavka/ariza/realizatsiyadan yangi mijoz, mobil) shu yerdan oladi.
 * Ichki "Sklad" kartochkasi (`stock-orders.ts`) bundan mustasno — unga doim 0.
 */
export async function defaultCreditLimit(client: Pick<Prisma.TransactionClient, "companySettings"> = db): Promise<number> {
  const s = await client.companySettings.findUnique({ where: { id: "main" }, select: { defaultCreditLimit: true } });
  return s ? Number(s.defaultCreditLimit) : 0;
}

/**
 * Qarz va limit — hisob qoidasi (bitta joyda):
 *
 *   balans    = `receivables.ts` dagi yagona mijoz balansi: schyotlar (boshlang'ich qoldiq bilan, bekor
 *               qilinganlarsiz) − mijozning BARCHA to'lovlari (schyotga bog'langan-bog'lanmagan, zayavka avansi ham)
 *   qarz      = max(0, balans) — mijoz kartasi, dashboard, BI va mobil ilova bilan bir xil raqam
 *   ochiq     = tasdiqlangan zayavkalarning limitga tushadigan, hali schyot yozilmagan qismi (`orderExposure`):
 *                 · «Qarzga» (onCredit) — butun summa: qabul qilinganda limitdan joy band qiladi;
 *                 · «Naqd» / «Perechisleniye» — pul yetkazilgandan keyin keladi: zayavka ochilganda limitga
 *                   tushmaydi, faqat zavoddan chiqqan (yuklangan / yo'lda / yetkazilgan reys) qismi qarz bo'lib
 *                   kiradi; to'liq yetkazilgan (DELIVERED) zayavka — butun summasi.
 *               mijoz avansi (manfiy balans) avval shuni qoplaydi
 *   ishlatilgan = qarz + ochiq (limitdan ayiriladi)
 *
 * Istisno — Realizatsiya jurnali to'lovlari: ular jurnaldagi sotuvning o'zini yopadi, ERP schyotlariga tegmaydi.
 */

/** Limitga tushishi mumkin bo'lgan zayavka holatlari: qabul qilingan va hali to'liq to'lanmagan (CLOSED emas). */
const OPEN_ORDER_STATUSES = ["CONFIRMED", "IN_PRODUCTION", "DELIVERED"] as const;
/** Zavoddan chiqqan reys holatlari — naqd/perechisleniye zayavkada shu reyslardagi mahsulot qarz bo'ladi. */
const SHIPPED_TRIP_STATUSES = ["LOADED", "ON_ROAD", "DELIVERED"] as const;

/**
 * Zayavkaning limitga tushadigan summasi (schyot ayirilmagan). Naqd/perechisleniyeda jo'natilgan ulush zayavka
 * tarkibi bo'yicha taqsimlanadi (reys qatorga bog'lanmagan — `bi/core.ts` dagi tushum qoidasi bilan bir xil).
 */
export function orderExposure(o: { onCredit: boolean; status: string; total: number; qty: number; shippedQty: number }): number {
  if (o.onCredit || o.status === "DELIVERED") return o.total;
  if (!(o.qty > 0) || !(o.shippedQty > 0)) return 0;
  return o.total * Math.min(1, o.shippedQty / o.qty);
}

/** Mijozning joriy qarzi (manfiy emas; ortiqcha to'lov `customerCredit` da ochiq zayavkani qoplaydi). */
export async function customerDebt(customerId: string) {
  return Math.max(0, (await customerCredit(customerId)).debt);
}

export type CustomerCredit = {
  limit: number;
  /** Yagona mijoz balansi (receivables.ts): musbat — qarz, manfiy — avans. */
  balance: number;
  debt: number; // max(0, balans) — debitorka
  advance: number; // max(0, −balans) — mijoz avansi
  open: number; // schyot yozilmagan, limitga tushadigan zayavka summasi (`orderExposure`; avans ayirilgan)
  used: number; // debt + open — limitdan ayiriladi
  /** Yaxlitlanmagan sof holat (qarz + ochiq − ortiqcha to'lov): to'liq oldindan to'langan zayavka
   *  qabul qilishda limitga urilmasin — `used` 0 dan pastga tushmaydi, ortiqcha avans esa yo'qolardi. */
  net: number;
  free: number; // limit − used
  blacklisted: boolean; // limit to'liq ishlatilgan (free ≤ 0)
};

/**
 * Ortiqcha to'lov bir tomonda manfiy chiqsa, ikkinchisini qoplaydi: schyotlardan ortgan pul ochiq
 * zayavkani, zayavkadan ortgan avans esa schyot qarzini kamaytiradi.
 */
function creditOf(limit: number, balance: number, rawOpen: number): CustomerCredit {
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const debt = Math.max(0, r2(balance + Math.min(0, rawOpen)));
  const open = Math.max(0, r2(rawOpen + Math.min(0, balance)));
  const used = r2(debt + open);
  const free = r2(limit - used);
  // Qora ro'yxat — limitdan foydalangan va u to'lgan mijoz. Limiti 0 (yangi, naqd) mijoz qarzi bo'lmasa qora ro'yxatda emas
  return { limit, balance, debt, advance: Math.max(0, -balance), open, used, net: r2(balance + rawOpen), free, blacklisted: free <= 0 && (limit > 0 || used > 0.005) };
}

/**
 * Bitta mijozning limit holati. Qora ro'yxat saqlanmaydi — har safar hisoblanadi:
 * qarz to'lansa mijoz avtomatik ro'yxatdan chiqadi.
 */
export async function customerCredit(customerId: string): Promise<CustomerCredit> {
  const m = await customersCredit([customerId], { includeInternal: true });
  const c = m.get(customerId);
  if (!c) throw new Error("Mijoz topilmadi");
  return c;
}

/** Barcha (yoki berilgan) mijozlar uchun limit holati — ro'yxat va tanlov oynalari uchun bitta so'rovda. */
export async function customersCredit(ids?: string[], opts?: { includeInternal?: boolean }): Promise<Map<string, CustomerCredit>> {
  // Ichki "Sklad" kartochkasi mijoz emas — limit ham, reyting ham hisoblanmaydi
  const where: Prisma.CustomerWhereInput = { ...(opts?.includeInternal ? {} : { isInternal: false }), ...(ids ? { id: { in: ids } } : {}) };
  const byCustomer = ids ? { customerId: { in: ids } } : {};
  const [customers, bal, orders, trips] = await Promise.all([
    db.customer.findMany({ where, select: { id: true, creditLimit: true } }),
    // Qarz/avans — yagona balans (schyotlar − barcha to'lovlar); zayavka avansi ham shu yerda ayiriladi
    customerBalances({ ids, includeInternal: true }),
    // Sklad zaxirasi zayavkasi (kind = STOCK) limitga kirmaydi — unda mijoz ham, summa ham yo'q
    db.order.findMany({
      where: { kind: "SALE", status: { in: [...OPEN_ORDER_STATUSES] }, ...byCustomer },
      select: { id: true, customerId: true, onCredit: true, status: true, deliveryFee: true, items: { select: { qtyM3: true, price: true } }, invoices: { where: { status: { not: "CANCELLED" } }, select: { amount: true } } },
    }),
    // Naqd/perechisleniye zayavkaning jo'natilgan qismi — faqat hali yetkazib bo'linmaganlarida kerak (DELIVERED — butun summa)
    db.trip.findMany({
      where: { status: { in: [...SHIPPED_TRIP_STATUSES] }, order: { kind: "SALE", onCredit: false, status: { in: ["CONFIRMED", "IN_PRODUCTION"] }, ...byCustomer } },
      select: { orderId: true, status: true, qtyM3: true, acceptedQty: true, returnedQty: true },
    }),
  ]);
  const shipped = new Map<string, number>();
  for (const t of trips) shipped.set(t.orderId, (shipped.get(t.orderId) ?? 0) + tripCoveredQty(t));
  const openSum = new Map<string, number>();
  for (const o of orders) {
    const exposure = orderExposure({ onCredit: o.onCredit, status: o.status, total: orderTotal(o), qty: o.items.reduce((s, i) => s + Number(i.qtyM3), 0), shippedQty: shipped.get(o.id) ?? 0 });
    // Schyot yozilgan qismi balansda turibdi; schyoti summadan kam yozilgan zayavkaning qoldig'i ham limitga kiradi —
    // aks holda 1 so'mlik schyot butun zayavkani limitdan chiqarib yuborardi
    const rest = exposure - o.invoices.reduce((x, i) => x + Number(i.amount), 0);
    if (rest > 0.005) openSum.set(o.customerId, (openSum.get(o.customerId) ?? 0) + rest);
  }
  return new Map(customers.map((c) => [c.id, creditOf(Number(c.creditLimit), balanceOf(bal, c.id).balance, openSum.get(c.id) ?? 0)]));
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
    db.order.findMany({ where: { kind: "SALE", status: { in: [...BOUGHT_STATUSES] }, ...byId }, select: { customerId: true, date: true, deliveryFee: true, items: { select: { qtyM3: true, price: true } } } }),
    db.payment.groupBy({ by: ["customerId"], where: byId, _sum: { amount: true } }),
    db.invoice.groupBy({ by: ["customerId"], where: { status: { not: "CANCELLED" }, ...byId }, _sum: { amount: true } }),
  ]);
  const acc = new Map<string, { bought: number; orders: number; first: Date | null; last: Date | null }>();
  for (const o of orders) {
    const a = acc.get(o.customerId) ?? { bought: 0, orders: 0, first: null, last: null };
    a.bought += orderTotal(o);
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
