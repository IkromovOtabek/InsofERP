import { db } from "./db";
import { getCompany } from "./company";
import { Prisma } from "@/generated/prisma";
import { debtSales } from "./debt-sales";

/**
 * Debitorka (mijoz qarzi) — YAGONA hisob manbai. Mijoz kartasi, dashboard, BI, /sales, mobil ilova, AI
 * vositalari va kredit limiti (src/lib/finance.ts) shu moduldan oladi — raqamlar hamma joyda bir xil.
 *
 * Qoida (onlayn to'lov yo'q: pul ofisga naqd, bank o'tkazmasi yoki terminal orqali keladi, mijoz ko'pincha
 * schyotga bog'lanmagan avans to'laydi):
 *
 *   balans = Σ schyotlar (boshlang'ich qoldiq schyotlari ham, bekor qilinganlarsiz)
 *          + Σ qarzga sotuv — Realizatsiya reestrining «Qarz» turidagi qatorlari, schyotsiz zayavkalar (`debt-sales.ts`)
 *          − Σ mijoz to'lovlari (schyotga bog'langan yoki bog'lanmagan; storno qilingan to'lov bazadan o'chadi)
 *          − Σ kassa «Savdo» kirimi shu mijoz qarziga yozilgani (`CashTransaction.customerId`); chiqim (mijozga qaytarilgan
 *            pul) — qarzga qo'shiladi
 *          ± qarz o'tkazmalari (`CustomerDebtTransfer`): qarzdordan ayiriladi, to'lovchiga qo'shiladi
 *
 *   musbat balans — debitorka (mijoz qarzi), manfiy — avans (mijoz oldidagi bizning qarzimiz).
 *
 * Istisno: Realizatsiya jurnali (Excel importi) to'lovlari — ular jurnaldagi sotuvning o'zini yopadi,
 * ERP schyotlariga tegmaydi (akt sverka bilan bir xil qoida, `invoices.ts → customerStatement`).
 *
 * Aging va "muddati o'tgan" (CompanySettings.overdueDays): mijozning BARCHA to'lovlari (va manfiy boshlang'ich
 * qoldiq — avans) FIFO tartibida eng eski schyotlarga taqsimlanadi; qolgan to'lanmagan qismlar schyot sanasi
 * bo'yicha qariydi. Shuning uchun aging yig'indisi har doim balansdagi qarzga teng.
 *
 * Schyotning o'z holati (OPEN/PARTIAL/PAID, "to'langan/qoldiq" ustunlari) bog'langan to'lovlardan hisoblanadi —
 * bu hujjat holati, qarz summasi emas. Jami qarz faqat shu moduldan olinadi.
 *
 * Hisob Decimal'da, natija tiyinga yaxlitlangan number.
 */

const D = Prisma.Decimal;
type Dec = Prisma.Decimal;
const ZERO = new D(0);
const DAY = 86_400_000;

/** Decimal → tiyinga yaxlitlangan number. */
const toNum = (d: Dec) => d.toDecimalPlaces(2, D.ROUND_HALF_UP).toNumber();
const dec = (v: unknown) => (v == null ? ZERO : new D(v as Prisma.Decimal.Value));
const startOfDay = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
/** Ikki sana orasidagi kunlar (kun boshlari bo'yicha). */
export const ageDays = (from: Date, to: Date) => Math.max(0, Math.round((startOfDay(to).getTime() - startOfDay(from).getTime()) / DAY));

export type BalanceOpts = {
  /** Faqat shu mijozlar (berilmasa — hammasi). */
  ids?: string[];
  /** Ichki "Sklad" kartochkasi ham (sukut: yo'q — u mijoz emas). */
  includeInternal?: boolean;
  /** Shu paytgacha (date < asOf) — o'tgan davr oxiridagi holat; berilmasa hozirgi. */
  asOf?: Date | null;
  /** Faqat schyot − to'lov (2026-11-14 gacha qoida): reestr, kassa va o'tkazmasiz — eski qoldiqlarni tenglash skripti uchun. */
  legacy?: boolean;
  /** Shu paytdan (date >= since) — davr aylanmasi (`customerTurnover`) uchun */
  since?: Date | null;
};

export type CustomerBalance = {
  customerId: string;
  invoiced: number; // Σ schyotlar (boshlang'ich qoldiq bilan)
  paid: number; // Σ to'lovlar
  balance: number; // invoiced − paid
  debt: number; // max(0, balance) — debitorka
  advance: number; // max(0, −balance) — avans
};

export const zeroBalance = (customerId: string): CustomerBalance => ({ customerId, invoiced: 0, paid: 0, balance: 0, debt: 0, advance: 0 });

function where(opts: BalanceOpts) {
  const customer = opts.includeInternal ? {} : { customer: { isInternal: false } };
  const ids = opts.ids ? { customerId: { in: opts.ids } } : {};
  const date = opts.asOf || opts.since ? { date: { ...(opts.since ? { gte: opts.since } : {}), ...(opts.asOf ? { lt: opts.asOf } : {}) } } : {};
  const party = (k: "debtor" | "payer", idKey: "debtorId" | "payerId") => ({
    cancelledAt: null, ...(opts.includeInternal ? {} : { [k]: { isInternal: false } }), ...(opts.ids ? { [idKey]: { in: opts.ids } } : {}), ...date,
  });
  return {
    invoice: { status: { not: "CANCELLED" }, ...customer, ...ids, ...date } satisfies Prisma.InvoiceWhereInput,
    payment: { register: { is: null }, ...customer, ...ids, ...date } satisfies Prisma.PaymentWhereInput,
    cash: { cancelledAt: null, type: { in: ["INCOME", "EXPENSE"] }, customerId: opts.ids ? { in: opts.ids } : { not: null }, ...customer, ...date } satisfies Prisma.CashTransactionWhereInput,
    debtor: party("debtor", "debtorId") as Prisma.CustomerDebtTransferWhereInput,
    payer: party("payer", "payerId") as Prisma.CustomerDebtTransferWhereInput,
  };
}

/** Ichki «Sklad» kartochkasi — qo'lda realizatsiya qatori unga bog'lanib qolsa ham mijoz qarziga kirmaydi. */
async function internalIds(): Promise<Set<string>> {
  return new Set((await db.customer.findMany({ where: { isInternal: true }, select: { id: true } })).map((c) => c.id));
}

type RawBalance = { customerId: string; inv: Dec; pay: Dec };

async function rawBalances(opts: BalanceOpts): Promise<Map<string, RawBalance>> {
  if (opts.ids && opts.ids.length === 0) return new Map();
  const w = where(opts);
  const none = Promise.resolve([] as never[]);
  const [inv, pay, sales, cash, asDebtor, asPayer, internal] = await Promise.all([
    db.invoice.groupBy({ by: ["customerId"], where: w.invoice, _sum: { amount: true } }),
    db.payment.groupBy({ by: ["customerId"], where: w.payment, _sum: { amount: true } }),
    opts.legacy ? none : debtSales({ ids: opts.ids, asOf: opts.asOf }),
    opts.legacy ? none : db.cashTransaction.groupBy({ by: ["customerId", "type"], where: w.cash, _sum: { amount: true } }),
    opts.legacy ? none : db.customerDebtTransfer.groupBy({ by: ["debtorId"], where: w.debtor, _sum: { amount: true } }),
    opts.legacy ? none : db.customerDebtTransfer.groupBy({ by: ["payerId"], where: w.payer, _sum: { amount: true } }),
    opts.legacy || opts.includeInternal ? Promise.resolve(new Set<string>()) : internalIds(),
  ]);
  const m = new Map<string, RawBalance>();
  const get = (id: string) => { let r = m.get(id); if (!r) { r = { customerId: id, inv: ZERO, pay: ZERO }; m.set(id, r); } return r; };
  for (const x of inv) get(x.customerId).inv = dec(x._sum.amount);
  for (const x of pay) get(x.customerId).pay = dec(x._sum.amount);
  // Qarzga sotuv, mijozga qaytarilgan pul, boshqaning qarzini to'lagani — debet; kassa qarz to'lovi, uning qarzini boshqa to'lagani — kredit
  for (const x of sales) if (!internal.has(x.customerId)) { const r = get(x.customerId); r.inv = r.inv.plus(new D(x.total)); }
  for (const x of cash) {
    if (!x.customerId) continue;
    const r = get(x.customerId);
    if (x.type === "EXPENSE") r.inv = r.inv.plus(dec(x._sum.amount));
    else r.pay = r.pay.plus(dec(x._sum.amount));
  }
  for (const x of asDebtor) { const r = get(x.debtorId); r.pay = r.pay.plus(dec(x._sum.amount)); }
  for (const x of asPayer) { const r = get(x.payerId); r.inv = r.inv.plus(dec(x._sum.amount)); }
  return m;
}

function finish(r: RawBalance): CustomerBalance {
  const bal = r.inv.minus(r.pay);
  return {
    customerId: r.customerId, invoiced: toNum(r.inv), paid: toNum(r.pay), balance: toNum(bal),
    debt: bal.gt(0) ? toNum(bal) : 0, advance: bal.lt(0) ? toNum(bal.neg()) : 0,
  };
}

/**
 * Mijozlar balansi — ikkita groupBy so'rovi (N+1 yo'q). Faqat harakati bor mijozlar qaytadi;
 * qolganlari uchun `zeroBalance` (yoki `balanceOf`).
 */
export async function customerBalances(opts: BalanceOpts = {}): Promise<Map<string, CustomerBalance>> {
  const raw = await rawBalances(opts);
  return new Map([...raw.values()].map((r) => [r.customerId, finish(r)]));
}

export const balanceOf = (m: Map<string, CustomerBalance>, id: string) => m.get(id) ?? zeroBalance(id);

/** Bitta mijoz balansi. */
export async function customerBalance(customerId: string, opts: Omit<BalanceOpts, "ids"> = {}): Promise<CustomerBalance> {
  return balanceOf(await customerBalances({ ...opts, ids: [customerId], includeInternal: true }), customerId);
}

/** Davr aylanmasi (qarz varag'i ustunlari): boshlang'ich qoldiq yozuvlari, sotuv (debet) va to'lov (kredit, sof). */
export type Turnover = { opening: number; sold: number; paid: number };

/**
 * `since` ≤ sana < `until` oralig'idagi harakatlar — `rawBalances` bilan bir xil manba va filtrlar:
 *   opening — boshlang'ich qoldiq yozuvlari (BQ-schyotlar), sold — schyotlar + qarzga sotuv,
 *   paid — to'lovlar + kassa qarz to'lovi − mijozga qaytarilgan pul + uning qarzini boshqa to'lagani − u boshqaning qarzini to'lagani.
 * Davr boshidagi balans + opening + sold − paid = davr oxiridagi balans.
 */
export async function customerTurnover(since: Date, until: Date, opts: Pick<BalanceOpts, "ids" | "includeInternal"> = {}): Promise<Map<string, Turnover>> {
  const o: BalanceOpts = { ...opts, since, asOf: until };
  if (o.ids && o.ids.length === 0) return new Map();
  const w = where(o);
  const [inv, pay, sales, cash, asDebtor, asPayer, internal] = await Promise.all([
    db.invoice.groupBy({ by: ["customerId", "isOpening"], where: w.invoice, _sum: { amount: true } }),
    db.payment.groupBy({ by: ["customerId"], where: w.payment, _sum: { amount: true } }),
    debtSales({ ids: o.ids, asOf: until }).then((l) => l.filter((x) => x.date >= since)),
    db.cashTransaction.groupBy({ by: ["customerId", "type"], where: w.cash, _sum: { amount: true } }),
    db.customerDebtTransfer.groupBy({ by: ["debtorId"], where: w.debtor, _sum: { amount: true } }),
    db.customerDebtTransfer.groupBy({ by: ["payerId"], where: w.payer, _sum: { amount: true } }),
    o.includeInternal ? Promise.resolve(new Set<string>()) : internalIds(),
  ]);
  const m = new Map<string, { opening: Dec; sold: Dec; paid: Dec }>();
  const get = (id: string) => { let r = m.get(id); if (!r) { r = { opening: ZERO, sold: ZERO, paid: ZERO }; m.set(id, r); } return r; };
  for (const x of inv) { const r = get(x.customerId); if (x.isOpening) r.opening = r.opening.plus(dec(x._sum.amount)); else r.sold = r.sold.plus(dec(x._sum.amount)); }
  for (const x of sales) if (!internal.has(x.customerId)) { const r = get(x.customerId); r.sold = r.sold.plus(new D(x.total)); }
  for (const x of pay) { const r = get(x.customerId); r.paid = r.paid.plus(dec(x._sum.amount)); }
  for (const x of cash) {
    if (!x.customerId) continue;
    const r = get(x.customerId);
    r.paid = x.type === "EXPENSE" ? r.paid.minus(dec(x._sum.amount)) : r.paid.plus(dec(x._sum.amount));
  }
  for (const x of asDebtor) { const r = get(x.debtorId); r.paid = r.paid.plus(dec(x._sum.amount)); }
  for (const x of asPayer) { const r = get(x.payerId); r.paid = r.paid.minus(dec(x._sum.amount)); }
  return new Map([...m].map(([id, r]) => [id, { opening: toNum(r.opening), sold: toNum(r.sold), paid: toNum(r.paid) }]));
}

// ───────────────────────── Aging (FIFO) ─────────────────────────

/** Sukut aging chegaralari (kun, ichida): 0–30 / 31–60 / 61–90 / 90+. */
export const DEFAULT_EDGES = [30, 60, 90];
/** Owner dashboard chegaralari: 0–7 / 8–30 / 31–60 / 60+. */
export const OWNER_EDGES = [7, 30, 60];

export function bucketLabels(edges: number[]): string[] {
  return [...edges.map((e, i) => `${i === 0 ? 0 : edges[i - 1]! + 1}–${e}`), `${edges.at(-1)}+`];
}
const bucketIndex = (age: number, edges: number[]) => { const i = edges.findIndex((e) => age <= e); return i < 0 ? edges.length : i; };

/** Schyotning FIFO bo'yicha to'lanmagan qismi. */
export type OpenPart = { invoiceId: string; invoiceNo: string; date: Date; status: string; isOpening: boolean; amount: number; left: number; age: number; overdue: boolean };

export type AgingRow = CustomerBalance & {
  name: string;
  items: OpenPart[]; // eskidan yangiga
  buckets: number[];
  overdue: number; // overdueDays dan eski qismlar
  oldestDays: number | null; // eng eski to'lanmagan qism yoshi
};

export type ReceivablesReport = {
  today: Date; // yosh shu kunga nisbatan (asOf bo'lsa — asOf)
  overdueDays: number;
  edges: number[];
  labels: string[];
  total: number; // Σ debitorka (musbat balanslar)
  advance: number; // Σ avans (manfiy balanslar)
  net: number; // total − advance
  overdue: number;
  buckets: number[];
  debtors: number;
  advanceCustomers: number;
  rows: AgingRow[]; // qarzdorlar, qarz kamayishi tartibida
  byCustomer: Map<string, AgingRow>; // faqat qarzdorlar
  balances: Map<string, CustomerBalance>; // harakati bor barcha mijozlar
};

/**
 * To'liq debitorka hisoboti: balanslar + FIFO aging + muddati o'tgan qism.
 * So'rovlar: 2 ta groupBy + qarzdorlar schyotlari + nomlar (N+1 yo'q).
 */
export async function receivablesReport(opts: BalanceOpts & { edges?: number[]; overdueDays?: number; today?: Date } = {}): Promise<ReceivablesReport> {
  const edges = opts.edges ?? DEFAULT_EDGES;
  const [raw, overdueDays] = await Promise.all([
    rawBalances(opts),
    opts.overdueDays ?? getCompany().then((c) => c.overdueDays),
  ]);
  const today = startOfDay(opts.asOf ? new Date(opts.asOf.getTime() - 1) : (opts.today ?? new Date()));
  const balances = new Map([...raw.values()].map((r) => [r.customerId, finish(r)]));
  const debtorIds = [...raw.values()].filter((r) => r.inv.gt(r.pay)).map((r) => r.customerId);
  const w = where({ ...opts, ids: debtorIds });
  const [invoices, names] = debtorIds.length
    ? await Promise.all([
      db.invoice.findMany({
        where: w.invoice,
        select: { id: true, invoiceNo: true, customerId: true, date: true, amount: true, status: true, isOpening: true, createdAt: true },
        orderBy: [{ date: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      }),
      db.customer.findMany({ where: { id: { in: debtorIds } }, select: { id: true, name: true } }),
    ])
    : [[], []];
  const nameOf = new Map(names.map((c) => [c.id, c.name]));
  // FIFO hujjatlari: schyotlar + qarzga sotuv (reestr qatori), mijozga qaytarilgan pul, boshqa mijoz qarzini to'lagani
  type Doc = (typeof invoices)[number];
  const extra: Doc[] = [];
  if (debtorIds.length && !opts.legacy) {
    const wd = where({ ...opts, ids: debtorIds });
    const [sales, refunds, paidFor] = await Promise.all([
      debtSales({ ids: debtorIds, asOf: opts.asOf }),
      db.cashTransaction.findMany({ where: { ...wd.cash, type: "EXPENSE" }, select: { id: true, customerId: true, date: true, amount: true, createdAt: true } }),
      db.customerDebtTransfer.findMany({ where: wd.payer, select: { id: true, docNo: true, payerId: true, date: true, amount: true, createdAt: true } }),
    ]);
    for (const x of sales) extra.push({ id: `rz:${x.key}`, invoiceNo: x.row.ttn ? `TTN ${x.row.ttn}` : "Realizatsiya", customerId: x.customerId, date: x.date, amount: new D(x.total), status: "OPEN", isOpening: false, createdAt: x.date });
    for (const x of refunds) if (x.customerId) extra.push({ id: `tx:${x.id}`, invoiceNo: "Qaytarilgan pul", customerId: x.customerId, date: x.date, amount: x.amount, status: "OPEN", isOpening: false, createdAt: x.createdAt });
    for (const x of paidFor) extra.push({ id: `qo:${x.id}`, invoiceNo: x.docNo, customerId: x.payerId, date: x.date, amount: x.amount, status: "OPEN", isOpening: false, createdAt: x.createdAt });
  }
  const invBy = new Map<string, Doc[]>();
  for (const i of [...invoices, ...extra]) { const l = invBy.get(i.customerId) ?? []; l.push(i); invBy.set(i.customerId, l); }
  if (extra.length) for (const l of invBy.values()) l.sort((a, b) => a.date.getTime() - b.date.getTime() || a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));

  const rows: AgingRow[] = [];
  const bucketsDec = Array.from({ length: edges.length + 1 }, () => ZERO);
  let overdueDec = ZERO;
  for (const id of debtorIds) {
    const r = raw.get(id)!;
    const list = invBy.get(id) ?? [];
    // Kredit hovuzi: barcha to'lovlar + manfiy schyotlar (boshlang'ich avans)
    let pool = r.pay;
    for (const i of list) if (dec(i.amount).lt(0)) pool = pool.plus(dec(i.amount).neg());
    const items: OpenPart[] = [];
    const b = Array.from({ length: edges.length + 1 }, () => ZERO);
    let od = ZERO;
    for (const i of list) {
      const amt = dec(i.amount);
      if (!amt.gt(0)) continue;
      const take = D.min(amt, pool);
      pool = pool.minus(take);
      const left = amt.minus(take);
      if (!left.gt(0)) continue;
      const age = ageDays(i.date, today);
      const isOver = age > overdueDays;
      const bi = bucketIndex(age, edges);
      b[bi] = b[bi]!.plus(left);
      if (isOver) od = od.plus(left);
      items.push({ invoiceId: i.id, invoiceNo: i.invoiceNo, date: i.date, status: i.status, isOpening: i.isOpening, amount: toNum(amt), left: toNum(left), age, overdue: isOver });
    }
    b.forEach((v, k) => { bucketsDec[k] = bucketsDec[k]!.plus(v); });
    overdueDec = overdueDec.plus(od);
    rows.push({
      ...balances.get(id)!, name: nameOf.get(id) ?? "—", items, buckets: b.map(toNum), overdue: toNum(od),
      oldestDays: items.length ? Math.max(...items.map((x) => x.age)) : null,
    });
  }
  rows.sort((a, b) => b.debt - a.debt);
  let totalDec = ZERO, advDec = ZERO, advN = 0;
  for (const r of raw.values()) {
    const bal = r.inv.minus(r.pay);
    if (bal.gt(0)) totalDec = totalDec.plus(bal);
    else if (bal.lt(0)) { advDec = advDec.plus(bal.neg()); advN++; }
  }
  return {
    today, overdueDays, edges, labels: bucketLabels(edges),
    total: toNum(totalDec), advance: toNum(advDec), net: toNum(totalDec.minus(advDec)), overdue: toNum(overdueDec),
    buckets: bucketsDec.map(toNum), debtors: rows.length, advanceCustomers: advN,
    rows, byCustomer: new Map(rows.map((x) => [x.customerId, x])), balances,
  };
}
