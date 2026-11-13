import { db } from "@/lib/db";
import type { CashAccountType, OrderStatus, PayMethod } from "@/generated/prisma";
import { loadRevenue, REALIZATION_PREFIX, safeDiv, sum, type SaleRow } from "@/lib/bi/core";
import { receivablesReport } from "@/lib/receivables";
import { SALES_INCOME } from "@/lib/cash-tx";
import { payReqWhere } from "@/lib/payment-requests";
import { unitTotals, type UnitTotal } from "@/lib/unit";

/**
 * Sotuv — umumiy ko'rinish (`/sales/umumiy`): bo'limning asosiy raqamlari bitta joyda. Har blok boshqa sahifalar
 * bilan bitta manbadan, raqamlar mos tushsin:
 *  · sotuv (realizatsiya) — `loadRevenue`: yetkazilgan reyslar + reyssiz yopilgan zayavkalar + Realizatsiya reestri
 *    qatorlari, QQS bilan (Tahlil «Sotuvlar», Egasi va Boshqaruv paneli bilan bir xil); sotuvchi — `sellerOf`;
 *  · zayavkalar holati — zayavka sanasi bo'yicha, summa = Σ miqdor × narx (Sotuv sahifasi, «Sotuv holatlari»);
 *  · tushgan pul — mijoz to'lovlari + kassaga «Savdo» kirimi (`SALES_INCOME`), hisob turi bo'yicha (naqd / bank);
 *  · debitorka — `receivablesReport` va ochiq bosh to'lov so'rovlari (`payReqWhere`) — joriy holat, davrga bog'liq emas.
 * Davr: `from` kiradi, `to` kirmaydi.
 */
const TOP = 8;
const METHODS: PayMethod[] = ["CASH", "BANK"];

function groupBy<K>(rows: SaleRow[], key: (r: SaleRow) => K) {
  const m = new Map<K, SaleRow[]>();
  for (const r of rows) { const k = key(r); const a = m.get(k); if (a) a.push(r); else m.set(k, [r]); }
  return m;
}
const unitsOf = (rows: SaleRow[]) => unitTotals(rows.map((r) => ({ unit: r.unit, qty: r.qty })));
const distinct = (rows: SaleRow[], key: (r: SaleRow) => string) => new Set(rows.map(key)).size;

export type StatusRow = { n: number; units: UnitTotal[]; total: number };
export type MoneyRow = { payments: number; sales: number; n: number };
export type ReqRow = { open: number; left: number; overdue: number; overdueLeft: number };

export async function salesOverview(from: Date, to: Date) {
  const period = { gte: from, lt: to };
  const [revenue, statusCounts, statusItems, pays, saleTx, accounts, recv, reqOpen, reqOverdue, newCustomers] = await Promise.all([
    loadRevenue(from, to),
    db.order.groupBy({ by: ["status"], where: { kind: "SALE", date: period }, _count: { _all: true } }),
    db.$queryRaw<{ status: OrderStatus; unit: string; qty: unknown; total: unknown }[]>`
      SELECT o."status", p."unit", SUM(i."qtyM3") AS qty, SUM(i."qtyM3" * i."price") AS total
      FROM "OrderItem" i JOIN "Order" o ON o."id" = i."orderId" JOIN "Product" p ON p."id" = i."productId"
      WHERE o."kind"::text = 'SALE' AND o."date" >= ${from} AND o."date" < ${to}
      GROUP BY o."status", p."unit"`,
    db.payment.groupBy({ by: ["cashAccountId"], where: { date: period }, _sum: { amount: true }, _count: { _all: true } }),
    db.cashTransaction.groupBy({ by: ["cashAccountId"], where: { ...SALES_INCOME, date: period }, _sum: { amount: true }, _count: { _all: true } }),
    db.cashAccount.findMany({ select: { id: true, type: true } }),
    receivablesReport(),
    db.paymentRequest.groupBy({ by: ["method"], where: payReqWhere("open", METHODS), _count: { _all: true }, _sum: { amount: true, received: true } }),
    db.paymentRequest.groupBy({ by: ["method"], where: payReqWhere("overdue", METHODS), _count: { _all: true }, _sum: { amount: true, received: true } }),
    db.customer.findMany({ where: { isInternal: false, createdAt: period }, select: { id: true, name: true, createdAt: true }, orderBy: { createdAt: "desc" } }),
  ]);

  // ── Zayavkalar holati (zayavka sanasi bo'yicha) ──
  const byStatus = new Map<OrderStatus, StatusRow>();
  const st = (s: OrderStatus) => { let r = byStatus.get(s); if (!r) { r = { n: 0, units: [], total: 0 }; byStatus.set(s, r); } return r; };
  for (const c of statusCounts) st(c.status).n = c._count._all;
  for (const i of statusItems) {
    const r = st(i.status);
    r.units = unitTotals([...r.units, { unit: i.unit, qty: Number(i.qty ?? 0) }]);
    r.total += Number(i.total ?? 0);
  }

  // ── Sotuv (realizatsiya) ──
  const total = sum(revenue.map((r) => r.revenue));
  const m3Rows = revenue.filter((r) => r.unit === "m3");
  const m3 = sum(m3Rows.map((r) => r.qty));
  const products = [...groupBy(revenue, (r) => r.productId).entries()].map(([id, rows]) => ({
    id, name: rows[0]!.product, units: unitsOf(rows), revenue: sum(rows.map((r) => r.revenue)), share: safeDiv(sum(rows.map((r) => r.revenue)), total) * 100,
  })).sort((a, b) => b.revenue - a.revenue);
  const customers = [...groupBy(revenue, (r) => r.customerId).entries()].map(([id, rows]) => ({
    id, name: rows[0]!.customer, real: !id.startsWith(REALIZATION_PREFIX), units: unitsOf(rows), revenue: sum(rows.map((r) => r.revenue)), orders: distinct(rows, (r) => r.orderId),
  })).sort((a, b) => b.revenue - a.revenue);
  const sellers = [...groupBy(revenue, (r) => r.sellerId).entries()].map(([id, rows]) => ({
    id, name: rows[0]!.seller, revenue: sum(rows.map((r) => r.revenue)), customers: distinct(rows, (r) => r.customerId), orders: distinct(rows, (r) => r.orderId),
  })).sort((a, b) => b.revenue - a.revenue);

  // ── Tushgan pul: hisob turi bo'yicha ──
  const typeOf = new Map(accounts.map((a) => [a.id, a.type]));
  const received: Record<CashAccountType, MoneyRow> = { CASH: { payments: 0, sales: 0, n: 0 }, BANK: { payments: 0, sales: 0, n: 0 } };
  for (const p of pays) { const t = typeOf.get(p.cashAccountId); if (t) { received[t].payments += Number(p._sum.amount ?? 0); received[t].n += p._count._all; } }
  for (const x of saleTx) { const t = typeOf.get(x.cashAccountId); if (t) { received[t].sales += Number(x._sum.amount ?? 0); received[t].n += x._count._all; } }

  // ── Pul qabul qilish: ochiq bosh to'lov so'rovlari ──
  const left = (s: { amount: unknown; received: unknown }) => Math.max(0, Number(s.amount ?? 0) - Number(s.received ?? 0));
  const requests: Record<PayMethod, ReqRow> = { CASH: { open: 0, left: 0, overdue: 0, overdueLeft: 0 }, BANK: { open: 0, left: 0, overdue: 0, overdueLeft: 0 } };
  for (const g of reqOpen) { requests[g.method].open = g._count._all; requests[g.method].left = left(g._sum); }
  for (const g of reqOverdue) { requests[g.method].overdue = g._count._all; requests[g.method].overdueLeft = left(g._sum); }

  const revenueOf = new Map(customers.map((c) => [c.id, c.revenue]));
  return {
    sales: {
      total, m3, m3AvgPrice: m3 > 0 ? sum(m3Rows.map((r) => r.revenue)) / m3 : null,
      other: unitsOf(revenue.filter((r) => r.unit !== "m3")),
      orders: distinct(revenue, (r) => r.orderId), customers: customers.length,
    },
    byStatus, products, customers: customers.slice(0, TOP), sellers: sellers.slice(0, TOP), sellerCount: sellers.length,
    received, requests,
    receivables: { total: recv.total, overdue: recv.overdue, overdueDays: recv.overdueDays, debtors: recv.debtors, advance: recv.advance, advanceCustomers: recv.advanceCustomers, top: recv.rows.slice(0, TOP) },
    newCustomers: {
      n: newCustomers.length, bought: newCustomers.filter((c) => revenueOf.has(c.id)).length,
      list: newCustomers.slice(0, TOP).map((c) => ({ ...c, revenue: revenueOf.get(c.id) ?? 0 })),
    },
  };
}
