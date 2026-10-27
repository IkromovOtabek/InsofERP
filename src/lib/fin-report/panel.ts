import { db } from "@/lib/db";
import { loadRevenue, finishedUnitCosts } from "@/lib/bi/core";
import { txSign } from "@/lib/cash-tx";
import { customerBalances } from "@/lib/receivables";
import { materialTurnover } from "@/lib/stock-turnover";
import { loanBalances } from "./loans";
import { pnlReport } from "./pnl";
import { supplierPositions } from "./balance";
import { monthKeyOf } from "./period";
import { r2 } from "./rows";

/**
 * «INSOF MCHJ — BOSHQARUV PANELI» («Insof 2026» → Dashboard) — tanlangan kun holatiga:
 * asosiy raqamlar, pul qoldiqlari, sotuv (guruhlar), ishlab chiqarish va tayyor mahsulot ombori, xom-ashyo skladi,
 * qarzlar (haqdorlik / qarzdorlik), oy foyda-zarari va kunlik sotuv / kassaga tushum.
 * Kun — server mahalliy vaqti (Asia/Tashkent, `instrumentation.ts`). Mahsulot guruhi — yuqori `ProductGroup`.
 */
const DAY = 86_400_000;

export type PanelAccount = { id: string; name: string; open: number; inToday: number; outToday: number; inMonth: number; outMonth: number; balance: number };
export type PanelSalesRow = { group: string; qtyToday: number; sumToday: number; qtyMonth: number; sumMonth: number; share: number; avgPrice: number | null };
export type PanelProdRow = { group: string; producedToday: number; producedMonth: number; openQty: number; shippedMonth: number; qty: number; valueCost: number; valuePrice: number };
export type PanelMaterial = { id: string; name: string; unit: string; open: number; received: number; consumed: number; balance: number; price: number | null; value: number; normDevPct: number | null };

export type Panel = {
  day: Date; monthStart: Date; lastEntry: Date | null; isToday: boolean;
  kpi: { cash: number; inToday: number; outToday: number; salesToday: number; salesMonth: number; netMonth: number; receivable: number; payable: number };
  accounts: PanelAccount[]; transfers: { inToday: number; outToday: number; inMonth: number; outMonth: number };
  sales: PanelSalesRow[]; salesTotal: Omit<PanelSalesRow, "group" | "avgPrice">; cashSales: { sales: number; cashIn: number; diff: number };
  production: PanelProdRow[]; concrete: { today: number; month: number }; productionTotal: Omit<PanelProdRow, "group">;
  materials: PanelMaterial[]; materialsTotal: { open: number; balance: number }; spareParts: number;
  debts: { cashCustomers: [number, number]; bankCustomers: [number, number]; suppliers: [number, number]; total: [number, number]; bankLoans: number };
  pnl: { income: number; cogs: number; gross: number; operating: number; net: number; projects: number; dividend: number; retained: number };
  daily: { date: Date; sales: number; cashIn: number }[];
};

/** Mahsulot → yuqori guruh nomi (Plita, Stalba, Beton…); guruhsiz — «Boshqalar». */
async function groupsOf(): Promise<Map<string, { group: string; unit: string; price: number }>> {
  const [products, groups] = await Promise.all([
    db.product.findMany({ select: { id: true, groupId: true, unit: true, price: true } }),
    db.productGroup.findMany({ select: { id: true, name: true, parentId: true } }),
  ]);
  const byId = new Map(groups.map((g) => [g.id, g]));
  const top = (id: string | null) => { let g = id ? byId.get(id) : undefined; for (let i = 0; g?.parentId && i < 10; i++) g = byId.get(g.parentId) ?? g; return g?.name ?? "Boshqalar"; };
  return new Map(products.map((p) => [p.id, { group: top(p.groupId), unit: p.unit, price: Number(p.price) }]));
}

export async function boshqaruvPaneli(dayIn?: Date): Promise<Panel> {
  const nowDay = new Date(); nowDay.setHours(0, 0, 0, 0);
  const day = dayIn ? new Date(dayIn) : new Date(nowDay); day.setHours(0, 0, 0, 0);
  const next = new Date(day.getTime() + DAY);
  const monthStart = new Date(day.getFullYear(), day.getMonth(), 1);
  const isToday = day.getTime() === nowDay.getTime();

  const [prods, accounts, txGroups, payGroups, txMonth, payMonth, revenueMonth, pnl, customers, loans, sup, stockMoves, batches, turnover, recipes, consumeMonth, lastTx, lastPayment, costs] = await Promise.all([
    groupsOf(),
    db.cashAccount.findMany({ orderBy: [{ type: "asc" }, { name: "asc" }], select: { id: true, name: true, isActive: true } }),
    db.cashTransaction.groupBy({ by: ["cashAccountId", "type"], where: { cancelledAt: null, date: { lt: monthStart } }, _sum: { amount: true } }),
    db.payment.groupBy({ by: ["cashAccountId"], where: { date: { lt: monthStart } }, _sum: { amount: true } }),
    db.cashTransaction.findMany({ where: { cancelledAt: null, date: { gte: monthStart, lt: next } }, select: { date: true, type: true, amount: true, cashAccountId: true } }),
    db.payment.findMany({ where: { date: { gte: monthStart, lt: next } }, select: { date: true, amount: true, cashAccountId: true, cashAccount: { select: { type: true } } } }),
    loadRevenue(monthStart, next),
    pnlReport([monthKeyOf(day)], "accrual"),
    customerBalances({ asOf: next }),
    loanBalances(next),
    supplierPositions(next),
    db.stockMove.findMany({ where: { productId: { not: null }, date: { lt: next } }, select: { productId: true, type: true, qty: true, date: true } }),
    db.productionBatch.findMany({ where: { cancelledAt: null, date: { gte: monthStart, lt: next } }, select: { date: true, qtyM3: true, productId: true, product: { select: { unit: true } } } }),
    materialTurnover({ from: monthStart, to: next }),
    db.recipe.findMany({ where: { isActive: true }, select: { productId: true, items: { select: { materialId: true, qtyPerM3: true } } } }),
    db.stockMove.groupBy({ by: ["materialId"], where: { type: "PRODUCTION_CONSUME", materialId: { not: null }, date: { gte: monthStart, lt: next } }, _sum: { qty: true } }),
    db.cashTransaction.findFirst({ where: { cancelledAt: null, date: { lt: next } }, orderBy: { date: "desc" }, select: { date: true } }),
    db.payment.findFirst({ where: { date: { lt: next } }, orderBy: { date: "desc" }, select: { date: true } }),
    finishedUnitCosts(),
  ]);
  const isDay = (d: Date) => d >= day && d < next;

  // ── Pul qoldiqlari ──
  const openBal = new Map<string, number>();
  for (const g of txGroups) openBal.set(g.cashAccountId, (openBal.get(g.cashAccountId) ?? 0) + txSign(g.type) * Number(g._sum.amount ?? 0));
  for (const g of payGroups) openBal.set(g.cashAccountId, (openBal.get(g.cashAccountId) ?? 0) + Number(g._sum.amount ?? 0));
  const accMap = new Map(accounts.map((a) => [a.id, { id: a.id, name: a.name, open: openBal.get(a.id) ?? 0, inToday: 0, outToday: 0, inMonth: 0, outMonth: 0, balance: 0, isActive: a.isActive }]));
  const transfers = { inToday: 0, outToday: 0, inMonth: 0, outMonth: 0 };
  const moveMonth = new Map<string, number>();
  for (const t of txMonth) {
    const a = accMap.get(t.cashAccountId); if (!a) continue;
    const v = Number(t.amount);
    moveMonth.set(a.id, (moveMonth.get(a.id) ?? 0) + txSign(t.type) * v);
    if (t.type === "OPENING") continue;
    if (t.type === "TRANSFER_IN" || t.type === "TRANSFER_OUT") {
      const k = t.type === "TRANSFER_IN" ? "in" : "out";
      transfers[`${k}Month`] += v; if (isDay(t.date)) transfers[`${k}Today`] += v;
      continue;
    }
    if (t.type === "INCOME") { a.inMonth += v; if (isDay(t.date)) a.inToday += v; } else { a.outMonth += v; if (isDay(t.date)) a.outToday += v; }
  }
  for (const p of payMonth) {
    const a = accMap.get(p.cashAccountId); if (!a) continue;
    const v = Number(p.amount);
    moveMonth.set(a.id, (moveMonth.get(a.id) ?? 0) + v);
    a.inMonth += v; if (isDay(p.date)) a.inToday += v;
  }
  for (const a of accMap.values()) a.balance = r2(a.open + (moveMonth.get(a.id) ?? 0));
  const accRows = [...accMap.values()].filter((a) => a.isActive || Math.abs(a.balance) >= 1 || Math.abs(a.open) >= 1);
  const cash = r2(accRows.reduce((s, a) => s + a.balance, 0));
  const inToday = r2(accRows.reduce((s, a) => s + a.inToday, 0)), outToday = r2(accRows.reduce((s, a) => s + a.outToday, 0));

  // ── Sotuv guruhlar bo'yicha (yetkazilgan, QQS bilan) ──
  const sg = new Map<string, PanelSalesRow>();
  for (const r of revenueMonth) {
    const g = prods.get(r.productId)?.group ?? "Boshqalar";
    const x = sg.get(g) ?? { group: g, qtyToday: 0, sumToday: 0, qtyMonth: 0, sumMonth: 0, share: 0, avgPrice: null };
    x.qtyMonth += r.qty; x.sumMonth += r.revenue;
    if (isDay(r.date)) { x.qtyToday += r.qty; x.sumToday += r.revenue; }
    sg.set(g, x);
  }
  const salesMonth = r2([...sg.values()].reduce((s, x) => s + x.sumMonth, 0));
  const sales = [...sg.values()].map((x) => ({ ...x, qtyToday: r2(x.qtyToday), sumToday: r2(x.sumToday), qtyMonth: r2(x.qtyMonth), sumMonth: r2(x.sumMonth), share: salesMonth ? (x.sumMonth / salesMonth) * 100 : 0, avgPrice: x.qtyMonth ? r2(x.sumMonth / x.qtyMonth) : null })).sort((a, b) => b.sumMonth - a.sumMonth);
  const salesTotal = { qtyToday: r2(sales.reduce((s, x) => s + x.qtyToday, 0)), sumToday: r2(sales.reduce((s, x) => s + x.sumToday, 0)), qtyMonth: r2(sales.reduce((s, x) => s + x.qtyMonth, 0)), sumMonth: salesMonth, share: salesMonth ? 100 : 0 };
  const cashOrders = new Set((await db.order.findMany({ where: { id: { in: [...new Set(revenueMonth.map((r) => r.orderId))] }, payMethod: "CASH" }, select: { id: true } })).map((o) => o.id));
  const cashSalesSum = r2(revenueMonth.filter((r) => cashOrders.has(r.orderId)).reduce((s, r) => s + r.revenue, 0));
  const cashIn = r2(payMonth.filter((p) => p.cashAccount.type === "CASH").reduce((s, p) => s + Number(p.amount), 0));

  // ── Ishlab chiqarish va tayyor mahsulot ombori (dona; beton — alohida qator) ──
  const pg = new Map<string, PanelProdRow>();
  for (const m of stockMoves) {
    const p = prods.get(m.productId!); if (!p || p.unit === "m3") continue;
    const x = pg.get(p.group) ?? { group: p.group, producedToday: 0, producedMonth: 0, openQty: 0, shippedMonth: 0, qty: 0, valueCost: 0, valuePrice: 0 };
    const q = Number(m.qty);
    x.qty += q;
    x.valueCost += q * (costs.get(m.productId!) ?? 0);
    x.valuePrice += q * p.price;
    if (m.date < monthStart) x.openQty += q;
    else {
      if (m.type === "PRODUCTION_OUTPUT") { x.producedMonth += q; if (isDay(m.date)) x.producedToday += q; }
      if (m.type === "SHIPMENT") x.shippedMonth += -q;
    }
    pg.set(p.group, x);
  }
  const production = [...pg.values()].map((x) => ({ ...x, qty: r2(x.qty), valueCost: r2(x.valueCost), valuePrice: r2(x.valuePrice), openQty: r2(x.openQty), producedMonth: r2(x.producedMonth), producedToday: r2(x.producedToday), shippedMonth: r2(x.shippedMonth) })).filter((x) => x.qty || x.producedMonth || x.shippedMonth || x.openQty).sort((a, b) => b.valuePrice - a.valuePrice);
  const concrete = { today: r2(batches.filter((b) => b.product.unit === "m3" && isDay(b.date)).reduce((s, b) => s + Number(b.qtyM3), 0)), month: r2(batches.filter((b) => b.product.unit === "m3").reduce((s, b) => s + Number(b.qtyM3), 0)) };
  const sumP = (k: keyof Omit<PanelProdRow, "group">) => r2(production.reduce((s, x) => s + x[k], 0));
  const productionTotal = { producedToday: sumP("producedToday"), producedMonth: sumP("producedMonth"), openQty: sumP("openQty"), shippedMonth: sumP("shippedMonth"), qty: sumP("qty"), valueCost: sumP("valueCost"), valuePrice: sumP("valuePrice") };

  // ── Xom-ashyo skladi: qoldiq, kirim, sarf, normadan farq (retsept × zames) ──
  const normNeed = new Map<string, number>();
  const recipeOf = new Map(recipes.map((r) => [r.productId, r.items]));
  for (const b of batches) for (const i of recipeOf.get(b.productId) ?? []) if (i.materialId) normNeed.set(i.materialId, (normNeed.get(i.materialId) ?? 0) + Number(i.qtyPerM3) * Number(b.qtyM3));
  const consumed = new Map(consumeMonth.map((c) => [c.materialId as string, -Number(c._sum.qty ?? 0)]));
  const recipeMats = new Set(recipes.flatMap((r) => r.items.map((i) => i.materialId).filter(Boolean) as string[]));
  const matRows = turnover.filter((t) => recipeMats.has(t.id) && (Math.abs(t.close.q) > 0.0005 || t.in.q || t.out.q || t.open.q));
  const materials: PanelMaterial[] = matRows.map((t) => {
    const norm = normNeed.get(t.id) ?? 0, fact = consumed.get(t.id) ?? 0;
    return { id: t.id, name: t.name, unit: t.unit, open: t.open.q, received: t.in.q, consumed: t.out.q, balance: t.close.q, price: t.avgCost, value: r2(t.close.s), normDevPct: norm > 0 ? ((fact - norm) / norm) * 100 : null };
  }).sort((a, b) => b.value - a.value);
  const materialsTotal = { open: r2(matRows.reduce((s, t) => s + t.open.s, 0)), balance: r2(matRows.reduce((s, t) => s + t.close.s, 0)) };
  const spareParts = r2(turnover.filter((t) => !recipeMats.has(t.id)).reduce((s, t) => s + t.in.s, 0));

  // ── Qarzlar: haqdorlik (bizga) va qarzdorlik (bizdan) ──
  const custIds = [...customers.keys()];
  const lastOrders = custIds.length ? await db.order.findMany({ where: { customerId: { in: custIds }, payMethod: { not: null } }, orderBy: { date: "desc" }, distinct: ["customerId"], select: { customerId: true, payMethod: true } }) : [];
  const methodOf = new Map(lastOrders.map((o) => [o.customerId, o.payMethod]));
  const cashCustomers: [number, number] = [0, 0], bankCustomers: [number, number] = [0, 0];
  for (const c of customers.values()) {
    const t = methodOf.get(c.customerId) === "CASH" ? cashCustomers : bankCustomers;
    t[0] += c.debt; t[1] += c.advance;
  }
  let supDebt = 0, supAdv = 0;
  for (const v of sup.values()) { if (v > 0) supDebt += v; else supAdv += -v; }
  const bankLoans = r2(loans.filter((l) => l.kind === "BANK" && !l.closedAt).reduce((s, l) => s + l.balance, 0));
  const borrowed = r2(loans.filter((l) => l.kind === "BORROWED" && !l.closedAt).reduce((s, l) => s + l.balance, 0));
  const lent = r2(loans.filter((l) => l.kind === "LENT" && !l.closedAt).reduce((s, l) => s + l.balance, 0));
  const suppliers: [number, number] = [r2(supAdv + lent), r2(supDebt + bankLoans + borrowed)];
  const round2 = (x: [number, number]): [number, number] => [r2(x[0]), r2(x[1])];
  const total: [number, number] = [r2(cashCustomers[0] + bankCustomers[0] + suppliers[0]), r2(cashCustomers[1] + bankCustomers[1] + suppliers[1])];

  // ── Oy foyda-zarari (hisoblangan PNL) ──
  const pv = (k: string) => pnl.rows.find((r) => r.key === k)?.values[0] ?? 0;

  // ── Kunlik sotuv va kassaga savdo tushumi (oy boshidan) ──
  const days = Math.round((next.getTime() - monthStart.getTime()) / DAY);
  const daily = Array.from({ length: days }, (_, i) => ({ date: new Date(monthStart.getTime() + i * DAY), sales: 0, cashIn: 0 }));
  const dIdx = (d: Date) => Math.floor((new Date(d).setHours(0, 0, 0, 0) - monthStart.getTime()) / DAY);
  for (const r of revenueMonth) { const i = dIdx(r.date); if (daily[i]) daily[i]!.sales += r.revenue; }
  for (const p of payMonth) { const i = dIdx(p.date); if (daily[i]) daily[i]!.cashIn += Number(p.amount); }

  return {
    day, monthStart, isToday,
    lastEntry: [lastTx?.date, lastPayment?.date].filter((d): d is Date => !!d).sort((a, b) => b.getTime() - a.getTime())[0] ?? null,
    kpi: {
      cash, inToday, outToday, salesToday: salesTotal.sumToday, salesMonth, netMonth: r2(pv("net")),
      receivable: r2(cashCustomers[0] + bankCustomers[0]), payable: r2(cashCustomers[1] + bankCustomers[1] + supDebt + bankLoans + borrowed),
    },
    accounts: accRows.map((a) => ({ id: a.id, name: a.name, balance: a.balance, open: r2(a.open), inToday: r2(a.inToday), outToday: r2(a.outToday), inMonth: r2(a.inMonth), outMonth: r2(a.outMonth) })),
    transfers: { inToday: r2(transfers.inToday), outToday: r2(transfers.outToday), inMonth: r2(transfers.inMonth), outMonth: r2(transfers.outMonth) },
    sales, salesTotal, cashSales: { sales: cashSalesSum, cashIn, diff: r2(cashSalesSum - cashIn) },
    production, concrete, productionTotal,
    materials, materialsTotal, spareParts,
    debts: { cashCustomers: round2(cashCustomers), bankCustomers: round2(bankCustomers), suppliers, total, bankLoans },
    pnl: { income: pv("income"), cogs: pv("cogs"), gross: pv("gross"), operating: pv("operating"), net: pv("net"), projects: pv("projects"), dividend: pv("dividend"), retained: pv("retained") },
    daily: daily.map((d) => ({ ...d, sales: r2(d.sales), cashIn: r2(d.cashIn) })),
  };
}
