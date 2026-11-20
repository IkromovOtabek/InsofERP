import { db } from "@/lib/db";
import { goLiveDate, sellerOf } from "@/lib/bi/core";
import { ageDays, customerBalances, customerTurnover, receivablesReport } from "@/lib/receivables";
import { supplierPositions, supplierTurnover } from "./balance";

/**
 * «Insof 2026» jadvalidagi qarz varaqlari — Tahlil → Mijozlar:
 *  - «Ta'minotchilar oldidagi qarzdorlik» — har yetkazuvchi: davr boshi, olgan (kirim), to'lagan, davr oxiri (`supplierPositions`, `supplierTurnover`);
 *  - «Xaridorlar qarzdorligi» — har mijoz: davr boshi, sotib olgan, to'lagan, davr oxiri (`customerBalances`, `customerTurnover`), Mijoz turi bilan;
 *  - «Mijozlar qarzi — qancha vaqtdan beri turibdi» — FIFO aging 0–15 / 16–30 / 31–60 / 60+ (`receivablesReport`).
 * Raqamlar Balans, Bosh sahifa va debitorka hisobotlari bilan bir manbadan.
 */

const r2 = (v: number) => Math.round(v * 100) / 100;
const startOfDay = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const nextDay = (d: Date) => { const x = startOfDay(d); x.setDate(x.getDate() + 1); return x; };

export type CustomerKind = "CASH" | "BANK";
export const CUSTOMER_KIND_LABEL: Record<CustomerKind, string> = { CASH: "Naqd", BANK: "Perechisleniye" };

/** Kun parametri (YYYY-MM-DD) → kun boshi; noto'g'ri yoki kelajak bo'lsa — bugun. */
export function parseDebtDay(v?: string): Date {
  const today = startOfDay(new Date());
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return today;
  const d = new Date(`${v}T00:00:00`);
  return Number.isNaN(d.getTime()) || d > today ? today : d;
}

/** «Boshidan» — qarz varag'i davri tizimdagi birinchi yozuvdan (sukut, Otabek 2026-11-14): «Sotib olgan» va «To'lagan» shu kungacha jami. */
export const DEBT_EPOCH = new Date(2000, 0, 1);
export const isDebtEpoch = (d: Date) => d.getTime() <= DEBT_EPOCH.getTime();

/** Davr boshi (`dan`, YYYY-MM-DD): sukut — boshidan (`DEBT_EPOCH`); `day` dan keyin bo'lsa ham shunday. */
export function parseDebtStart(v: string | undefined, day: Date): Date {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return DEBT_EPOCH;
  const d = new Date(`${v}T00:00:00`);
  return Number.isNaN(d.getTime()) || d > day ? DEBT_EPOCH : d < DEBT_EPOCH ? DEBT_EPOCH : d;
}

export type DebtSide = { debt: number; advance: number };
/**
 * Varaq qatori — 4 ustun: davr boshidagi qarzdorlik/haqdorlik (`open`, davrdagi boshlang'ich qoldiq yozuvlari bilan),
 * sotib olgan (`sold`: mijozda — schyot + qarzga sotuv, ta'minotchida — kirim), to'lagan (`paid`, sof), davr oxiridagi
 * qarzdorlik/haqdorlik (`now`). open + sold − paid = now. `debt` — musbat qoldiq (mijoz bizga / biz ta'minotchiga qarz).
 */
export type DebtRow = {
  id: string; name: string;
  /** Mijoz turi (amaldagisi) va qo'lda belgilangani (`Customer.payKind`; null — `customerKinds` qoidasi: oxirgi zayavka, bo'lmasa Realizatsiya qatori) */
  kind?: CustomerKind | null; kindSet?: CustomerKind | null;
  open: DebtSide; sold: number; paid: number; now: DebtSide; change: number;
};
export type DebtSheet = {
  /** `monthStart` — davr boshi (sukut boshidan — `allTime`, `dan` bilan o'zgaradi) */
  day: Date; monthStart: Date; allTime: boolean; rows: DebtRow[];
  total: { open: DebtSide; sold: number; paid: number; now: DebtSide };
  /** Mijoz turi bo'yicha soni (faqat xaridorlar) */
  kinds?: Record<"ALL" | CustomerKind, number>;
};

const side = (v: number): DebtSide => ({ debt: v > 0 ? r2(v) : 0, advance: v < 0 ? r2(-v) : 0 });
type Turn = { opening: number; sold: number; paid: number };

function totals(rows: DebtRow[]): DebtSheet["total"] {
  const sum = (f: (r: DebtRow) => number) => r2(rows.reduce((s, r) => s + f(r), 0));
  return { open: { debt: sum((r) => r.open.debt), advance: sum((r) => r.open.advance) }, sold: sum((r) => r.sold), paid: sum((r) => r.paid), now: { debt: sum((r) => r.now.debt), advance: sum((r) => r.now.advance) } };
}

/** `start` — davr boshidagi qoldiq, `turn` — davr aylanmasi; davr oxiri shulardan (open + sold − paid). */
function sheet(day: Date, monthStart: Date, start: Map<string, number>, turn: Map<string, Turn>, names: Map<string, string>, kindOf?: Map<string, CustomerKind>): DebtSheet {
  const ids = new Set([...start.keys(), ...turn.keys()]);
  const rows: DebtRow[] = [];
  for (const id of ids) {
    const t = turn.get(id) ?? { opening: 0, sold: 0, paid: 0 };
    const a = r2((start.get(id) ?? 0) + t.opening), b = r2(a + t.sold - t.paid);
    if (Math.abs(a) < 1 && Math.abs(b) < 1 && Math.abs(t.sold) < 1 && Math.abs(t.paid) < 1) continue;
    rows.push({ id, name: names.get(id) ?? "—", kind: kindOf?.get(id) ?? null, open: side(a), sold: r2(t.sold), paid: r2(t.paid), now: side(b), change: r2(b - a) });
  }
  rows.sort((x, y) => x.name.localeCompare(y.name, "uz"));
  return { day, monthStart, allTime: isDebtEpoch(monthStart), rows, total: totals(rows) };
}

/** Ta'minotchilar oldidagi qarzdorlik: `debt` — biz ularga qarzmiz (haqdorligi), `advance` — biz oldindan to'laganmiz (qarzdorligi). */
export async function supplierDebtSheet(day: Date, start?: Date): Promise<DebtSheet> {
  const monthStart = start ?? DEBT_EPOCH;
  const [open, turn] = await Promise.all([supplierPositions(monthStart), supplierTurnover(monthStart, nextDay(day))]);
  const ids = [...new Set([...open.keys(), ...turn.keys()])];
  const names = new Map((await db.supplier.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })).map((s) => [s.id, s.name]));
  return sheet(day, monthStart, open, turn, names);
}

/**
 * Mijoz turi (Moliya panelidagi «Qarzlar» bloki bilan bir xil): qo'lda belgilangani (`Customer.payKind` — qarz varag'idagi
 * qalam, Otabek 2026-11-17), bo'lmasa oxirgi zayavkadagi to'lov usuli, zayavkasi yo'q bo'lsa — Realizatsiyadagi oxirgi
 * qo'lda/Excel qatorining Naqd/Perech. turi (Otabek 2026-11-20: Realizatsiyadan qo'shilgan naqd xaridorlar Perech.ga tushib
 * qolardi). CASH — naqd, BANK — perechisleniye; hech biri yo'q — perechisleniye.
 */
export async function customerKinds(ids: string[]): Promise<Map<string, CustomerKind>> {
  if (!ids.length) return new Map();
  const [set, last] = await Promise.all([
    db.customer.findMany({ where: { id: { in: ids }, payKind: { not: null } }, select: { id: true, payKind: true } }),
    db.order.findMany({ where: { customerId: { in: ids }, payMethod: { not: null } }, orderBy: { date: "desc" }, distinct: ["customerId"], select: { customerId: true, payMethod: true } }),
  ]);
  const manual = new Map(set.map((c) => [c.id, c.payKind as CustomerKind]));
  const m = new Map(last.map((o) => [o.customerId, o.payMethod as CustomerKind]));
  const rest = ids.filter((id) => !manual.has(id) && !m.has(id));
  const entries = rest.length
    ? await db.realizationEntry.findMany({
      where: { customerId: { in: rest }, cancelledAt: null, payGroup: { in: ["CASH", "BANK"] } },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }], distinct: ["customerId"], select: { customerId: true, payGroup: true },
    })
    : [];
  const real = new Map(entries.map((e) => [e.customerId!, e.payGroup as CustomerKind]));
  return new Map(ids.map((id) => [id, manual.get(id) ?? m.get(id) ?? real.get(id) ?? "BANK"]));
}

/** Xaridorlar qarzdorligi: `debt` — mijoz bizga qarz (qarzdorlik), `advance` — mijoz oldindan to'lagan (haqdorlik). `kind` — Mijoz turi filtri. */
export async function customerDebtSheet(day: Date, kind?: CustomerKind | null, start?: Date): Promise<DebtSheet> {
  const monthStart = start ?? DEBT_EPOCH;
  const [openB, turn] = await Promise.all([customerBalances({ asOf: monthStart }), customerTurnover(monthStart, nextDay(day))]);
  const open = new Map([...openB.values()].map((b) => [b.customerId, b.balance]));
  const ids = [...new Set([...open.keys(), ...turn.keys()])];
  const [list, kinds] = await Promise.all([
    db.customer.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, payKind: true } }),
    customerKinds(ids),
  ]);
  const names = new Map(list.map((c) => [c.id, c.name]));
  const kindSet = new Map(list.map((c) => [c.id, (c.payKind as CustomerKind | null) ?? null]));
  const base = sheet(day, monthStart, open, turn, names, kinds);
  const all = { ...base, rows: base.rows.map((r) => ({ ...r, kindSet: kindSet.get(r.id) ?? null })) };
  const kindsCount = { ALL: all.rows.length, CASH: all.rows.filter((r) => r.kind === "CASH").length, BANK: all.rows.filter((r) => r.kind === "BANK").length };
  if (!kind) return { ...all, kinds: kindsCount };
  const rows = all.rows.filter((r) => r.kind === kind);
  return { ...all, rows, kinds: kindsCount, total: totals(rows) };
}

// ───────────────────── Mijozlar qarzi — qancha vaqtdan beri turibdi ─────────────────────

/** Jadvaldagi chegaralar: 0–15 / 16–30 / 31–60 / 60 kundan ko'p. */
export const AGE_EDGES = [15, 30, 60];
export const AGE_LABELS = ["0–15 kun", "16–30 kun", "31–60 kun", "60 kundan ko'p"];
/** Holat — eng eski to'lanmagan qism qaysi oraliqda (0 — yangi … 3 — 60 kundan eski). */
export const AGE_STATUS = ["0–15 kun", "16–30 kun", "31–60 kun", "60 kundan eski"];

export type AgeRow = {
  id: string; name: string; debt: number; buckets: number[]; level: number;
  lastSale: Date | null; lastPay: Date | null; daysNoPay: number | null; seller: string | null;
};
export type AgeReport = {
  day: Date; since: Date | null;
  total: number; over30: number; over60: number; debtors: number; buckets: number[];
  top: { name: string; debt: number } | null;
  levels: number[]; // har holatdagi mijozlar soni
  rows: AgeRow[];
};

/**
 * Qarz yoshi: mijoz to'lagan pul eng eski qarzini yopadi (FIFO), qolgan qarz — eng oxirgi olingan tovarlar.
 * Tartib — holat (eng eskisi birinchi), so'ng o'sha oraliqdagi summa kamayishi bo'yicha.
 */
export async function debtAgeReport(day: Date): Promise<AgeReport> {
  const asOf = nextDay(day);
  const [rep, since] = await Promise.all([receivablesReport({ asOf, edges: AGE_EDGES }), goLiveDate()]);
  const ids = rep.rows.map((r) => r.customerId);
  const [sales, pays, sellers] = ids.length
    ? await Promise.all([
      db.invoice.groupBy({ by: ["customerId"], where: { customerId: { in: ids }, status: { not: "CANCELLED" }, isOpening: false, date: { lt: asOf } }, _max: { date: true } }),
      db.payment.groupBy({ by: ["customerId"], where: { customerId: { in: ids }, register: { is: null }, date: { lt: asOf } }, _max: { date: true } }),
      db.order.findMany({ where: { customerId: { in: ids }, status: { not: "CANCELLED" }, date: { lt: asOf } }, orderBy: { date: "desc" }, distinct: ["customerId"], select: { customerId: true, createdById: true, createdBy: { select: { fullName: true } }, customer: { select: { name: true, agentId: true, agent: { select: { fullName: true } } } } } }),
    ])
    : [[], [], []];
  const saleOf = new Map(sales.map((s) => [s.customerId, s._max.date]));
  const payOf = new Map(pays.map((p) => [p.customerId, p._max.date]));
  const sellerName = new Map(sellers.map((o) => [o.customerId, sellerOf(o).seller]));

  const rows: AgeRow[] = rep.rows.map((r) => {
    const level = r.buckets.reduce((acc, v, i) => (v > 0 ? i : acc), 0);
    const lastPay = payOf.get(r.customerId) ?? null;
    return {
      id: r.customerId, name: r.name, debt: r.debt, buckets: r.buckets, level,
      lastSale: saleOf.get(r.customerId) ?? null, lastPay,
      daysNoPay: lastPay ? ageDays(lastPay, day) : null, seller: sellerName.get(r.customerId) ?? null,
    };
  });
  rows.sort((a, b) => b.level - a.level || b.buckets[b.level]! - a.buckets[a.level]! || b.debt - a.debt);
  const top = rows.reduce<AgeRow | null>((m, r) => (!m || r.debt > m.debt ? r : m), null);
  return {
    day, since,
    total: rep.total, over30: r2(rep.buckets[2]! + rep.buckets[3]!), over60: rep.buckets[3]!, debtors: rows.length, buckets: rep.buckets,
    top: top ? { name: top.name, debt: top.debt } : null,
    levels: [0, 1, 2, 3].map((l) => rows.filter((r) => r.level === l).length),
    rows,
  };
}
