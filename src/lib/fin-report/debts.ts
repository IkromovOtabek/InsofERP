import { db } from "@/lib/db";
import { goLiveDate, sellerOf } from "@/lib/bi/core";
import { ageDays, customerBalances, receivablesReport } from "@/lib/receivables";
import { supplierPositions } from "./balance";

/**
 * «Insof 2026» jadvalidagi qarz varaqlari — Tahlil → Mijozlar:
 *  - «Ta'minotchilar oldidagi qarzdorlik» — har yetkazuvchi: oy boshi va tanlangan kun holatiga Qarz / Avans (`supplierPositions`);
 *  - «Xaridorlar qarzdorligi» — har mijoz: oy boshi va tanlangan kun holatiga Qarz / Avans (`customerBalances`), Mijoz turi bilan;
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

export type DebtSide = { debt: number; advance: number };
export type DebtRow = { id: string; name: string; kind?: CustomerKind | null; open: DebtSide; now: DebtSide; change: number };
export type DebtSheet = {
  day: Date; monthStart: Date; rows: DebtRow[];
  total: { open: DebtSide; now: DebtSide };
  /** Mijoz turi bo'yicha soni (faqat xaridorlar) */
  kinds?: Record<"ALL" | CustomerKind, number>;
};

const side = (v: number): DebtSide => ({ debt: v > 0 ? r2(v) : 0, advance: v < 0 ? r2(-v) : 0 });

function sheet(day: Date, monthStart: Date, open: Map<string, number>, now: Map<string, number>, names: Map<string, string>, kindOf?: Map<string, CustomerKind>): DebtSheet {
  const ids = new Set([...open.keys(), ...now.keys()]);
  const rows: DebtRow[] = [];
  for (const id of ids) {
    const a = r2(open.get(id) ?? 0), b = r2(now.get(id) ?? 0);
    if (Math.abs(a) < 1 && Math.abs(b) < 1) continue;
    rows.push({ id, name: names.get(id) ?? "—", kind: kindOf?.get(id) ?? null, open: side(a), now: side(b), change: r2(b - a) });
  }
  rows.sort((x, y) => x.name.localeCompare(y.name, "uz"));
  const sum = (f: (r: DebtRow) => number) => r2(rows.reduce((s, r) => s + f(r), 0));
  return {
    day, monthStart, rows,
    total: { open: { debt: sum((r) => r.open.debt), advance: sum((r) => r.open.advance) }, now: { debt: sum((r) => r.now.debt), advance: sum((r) => r.now.advance) } },
  };
}

/** Ta'minotchilar oldidagi qarzdorlik: Qarz — biz ularga qarzmiz, Avans — biz oldindan to'laganmiz. */
export async function supplierDebtSheet(day: Date): Promise<DebtSheet> {
  const monthStart = new Date(day.getFullYear(), day.getMonth(), 1);
  const [open, now] = await Promise.all([supplierPositions(monthStart), supplierPositions(nextDay(day))]);
  const ids = [...new Set([...open.keys(), ...now.keys()])];
  const names = new Map((await db.supplier.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })).map((s) => [s.id, s.name]));
  return sheet(day, monthStart, open, now, names);
}

/**
 * Mijoz turi — oxirgi zayavkadagi to'lov usuli (Bosh sahifadagi «Qarzlar» bloki bilan bir xil):
 * CASH — naqd, BANK — perechisleniye; zayavkasi yo'q yoki usuli yozilmagan mijoz — perechisleniye.
 */
async function customerKinds(ids: string[]): Promise<Map<string, CustomerKind>> {
  if (!ids.length) return new Map();
  const last = await db.order.findMany({ where: { customerId: { in: ids }, payMethod: { not: null } }, orderBy: { date: "desc" }, distinct: ["customerId"], select: { customerId: true, payMethod: true } });
  const m = new Map(last.map((o) => [o.customerId, o.payMethod as CustomerKind]));
  return new Map(ids.map((id) => [id, m.get(id) ?? "BANK"]));
}

/** Xaridorlar qarzdorligi: Qarz — mijoz bizga qarz, Avans — mijoz oldindan to'lagan. `kind` — Mijoz turi filtri. */
export async function customerDebtSheet(day: Date, kind?: CustomerKind | null): Promise<DebtSheet> {
  const monthStart = new Date(day.getFullYear(), day.getMonth(), 1);
  const [openB, nowB] = await Promise.all([customerBalances({ asOf: monthStart }), customerBalances({ asOf: nextDay(day) })]);
  const open = new Map([...openB.values()].map((b) => [b.customerId, b.balance]));
  const now = new Map([...nowB.values()].map((b) => [b.customerId, b.balance]));
  const ids = [...new Set([...open.keys(), ...now.keys()])];
  const [names, kinds] = await Promise.all([
    db.customer.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }).then((l) => new Map(l.map((c) => [c.id, c.name]))),
    customerKinds(ids),
  ]);
  const all = sheet(day, monthStart, open, now, names, kinds);
  const kindsCount = { ALL: all.rows.length, CASH: all.rows.filter((r) => r.kind === "CASH").length, BANK: all.rows.filter((r) => r.kind === "BANK").length };
  if (!kind) return { ...all, kinds: kindsCount };
  const rows = all.rows.filter((r) => r.kind === kind);
  const sum = (f: (r: DebtRow) => number) => r2(rows.reduce((s, r) => s + f(r), 0));
  return {
    ...all, rows, kinds: kindsCount,
    total: { open: { debt: sum((r) => r.open.debt), advance: sum((r) => r.open.advance) }, now: { debt: sum((r) => r.now.debt), advance: sum((r) => r.now.advance) } },
  };
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
