import { db } from "@/lib/db";
import { type Range, type Gran, materialCosts, productCosts, sum, addDays, startOfDay, series, bucketsFor, bucketLabel, bucketKey, abc } from "./core";

export type MaterialRow = {
  id: string; code: string; name: string; unit: string; minStock: number; balance: number; avgCost: number; value: number;
  perDay: number; days: number | null; planned: number; short: boolean; zone: "Kritik" | "Xavfli" | "Yaxshi" | "Ma'lumot yo'q";
  overstock: boolean; dead: boolean; lastConsume: Date | null; abc: "A" | "B" | "C"; suggestQty: number; suggestCost: number; consumed30: number; received30: number;
};

export async function materialOverview(): Promise<MaterialRow[]> {
  const today = startOfDay(new Date()), since30 = addDays(today, -30), since90 = addDays(today, -90);
  const [materials, sums, consumed, received, lastConsume, orders, costs] = await Promise.all([
    db.material.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
    db.stockMove.groupBy({ by: ["materialId"], where: { materialId: { not: null } }, _sum: { qty: true } }),
    db.stockMove.groupBy({ by: ["materialId"], where: { type: "PRODUCTION_CONSUME", date: { gte: since30 } }, _sum: { qty: true } }),
    db.stockMove.groupBy({ by: ["materialId"], where: { type: "RECEIPT", date: { gte: since30 } }, _sum: { qty: true } }),
    db.stockMove.groupBy({ by: ["materialId"], where: { type: "PRODUCTION_CONSUME", date: { gte: since90 } }, _max: { date: true } }),
    db.order.findMany({ where: { status: { in: ["CONFIRMED", "IN_PRODUCTION"] } }, include: { items: { include: { product: { include: { recipes: { where: { isActive: true }, include: { items: true } } } } } }, batches: true } }),
    materialCosts(),
  ]);
  const bal = new Map(sums.map((x) => [x.materialId, Number(x._sum.qty ?? 0)]));
  const cons = new Map(consumed.map((x) => [x.materialId, -Number(x._sum.qty ?? 0)]));
  const rec = new Map(received.map((x) => [x.materialId, Number(x._sum.qty ?? 0)]));
  const last = new Map(lastConsume.map((x) => [x.materialId, x._max.date]));
  const need = new Map<string, number>();
  for (const o of orders) {
    const total = o.items.reduce((s, i) => s + Number(i.qtyM3), 0), done = o.batches.reduce((s, b) => s + Number(b.qtyM3), 0);
    const remaining = Math.max(0, total - done); if (!remaining) continue;
    for (const i of o.items) { const share = remaining * (Number(i.qtyM3) / total); for (const ri of i.product.recipes[0]?.items ?? []) need.set(ri.materialId, (need.get(ri.materialId) ?? 0) + share * Number(ri.qtyPerM3)); }
  }
  const pre = materials.map((m) => {
    const balance = bal.get(m.id) ?? 0, perDay = (cons.get(m.id) ?? 0) / 30, planned = need.get(m.id) ?? 0, avgCost = costs.get(m.id) ?? 0;
    const days = perDay > 0 ? balance / perDay : null;
    const zone = days === null ? "Ma'lumot yo'q" : days < 7 ? "Kritik" : days <= 20 ? "Xavfli" : "Yaxshi";
    const lc = last.get(m.id) ?? null;
    const dead = balance > 0 && (lc === null) && planned === 0;
    const target = Math.max(planned, perDay * 30, Number(m.minStock));
    const suggestQty = Math.max(0, target - balance);
    return { id: m.id, code: m.code, name: m.name, unit: m.unit, minStock: Number(m.minStock), balance, avgCost, value: balance * avgCost, perDay, days, planned, short: balance < planned, zone, overstock: days !== null && days > 90, dead, lastConsume: lc, suggestQty, suggestCost: suggestQty * avgCost, consumed30: cons.get(m.id) ?? 0, received30: rec.get(m.id) ?? 0 } as Omit<MaterialRow, "abc">;
  });
  const abcMap = abc(pre, (x) => x.consumed30 * x.avgCost);
  return pre.map((x) => ({ ...x, abc: abcMap.get(x) ?? "C" }));
}

export async function stockTab(r: Range, gran: Gran) {
  const today = startOfDay(new Date());
  const [materials, moves, writeOffs, receipts, products, productSums, pCosts] = await Promise.all([
    materialOverview(),
    db.stockMove.findMany({ where: { date: { gte: addDays(today, -180) }, materialId: { not: null } }, select: { date: true, type: true, qty: true, materialId: true } }),
    db.stockMove.findMany({ where: { type: "WRITE_OFF", date: { gte: addDays(today, -180) } }, select: { date: true, qty: true, materialId: true, productId: true, note: true } }),
    db.goodsReceipt.findMany({ where: { date: { gte: r.from, lt: r.to } }, include: { supplier: true, items: true } }),
    db.product.findMany({ where: { isActive: true, unit: { not: "m3" } }, select: { id: true, code: true, name: true, price: true } }),
    db.stockMove.groupBy({ by: ["productId"], where: { productId: { not: null } }, _sum: { qty: true } }),
    productCosts(),
  ]);
  const costOf = new Map(materials.map((m) => [m.id, m.avgCost]));
  const value = sum(materials.map((m) => m.value));
  const consumed30Value = sum(materials.map((m) => m.consumed30 * m.avgCost));
  const turnoverDays = consumed30Value > 0 ? value / (consumed30Value / 30) : null;

  // Tayyor mahsulot (dona) qoldig'i — muzlagan
  const pBal = new Map(productSums.map((s) => [s.productId as string, Number(s._sum.qty ?? 0)]));
  const finished = products.map((p) => ({ id: p.id, code: p.code, name: p.name, qty: pBal.get(p.id) ?? 0, value: (pBal.get(p.id) ?? 0) * (pCosts.get(p.id)?.cost ?? Number(p.price)) })).filter((p) => p.qty > 0);

  // Write-off (davr) va oylik
  const woInRange = writeOffs.filter((w) => w.date >= r.from && w.date < r.to);
  const woValue = sum(woInRange.map((w) => Math.abs(Number(w.qty)) * (w.materialId ? costOf.get(w.materialId) ?? 0 : 0)));
  const months = bucketsFor(new Date(today.getFullYear(), today.getMonth() - 5, 1), addDays(today, 1), "month");
  const woMonthly = months.map((m) => ({ label: bucketLabel(m, "month"), value: writeOffs.filter((w) => bucketKey(w.date, "month") === m).length }));

  // Kirim / chiqim balansi (qiymatda)
  const inRange = moves.filter((m) => m.date >= r.from && m.date < r.to);
  const inflow = series(inRange.filter((m) => m.type === "RECEIPT"), r.from, r.to, gran, (m) => m.date, (m) => Number(m.qty) * (costOf.get(m.materialId!) ?? 0));
  const outflow = series(inRange.filter((m) => m.type === "PRODUCTION_CONSUME" || m.type === "WRITE_OFF"), r.from, r.to, gran, (m) => m.date, (m) => -Number(m.qty) * (costOf.get(m.materialId!) ?? 0));
  const totalIn = sum(inflow.map((x) => x.value)), totalOut = sum(outflow.map((x) => x.value));

  // Zaxira qiymati trendi — 180 kun, haftalik (joriy qiymatdan orqaga hisoblab)
  const weeks = bucketsFor(addDays(today, -180), addDays(today, 1), "week");
  const balNow = new Map(materials.map((m) => [m.id, m.balance]));
  const trend: { label: string; value: number }[] = [];
  const afterWeek = (wk: string) => moves.filter((m) => bucketKey(m.date, "week") > wk);
  for (const wk of weeks) {
    const after = afterWeek(wk); const b = new Map(balNow);
    for (const m of after) b.set(m.materialId!, (b.get(m.materialId!) ?? 0) - Number(m.qty));
    trend.push({ label: bucketLabel(wk, "week"), value: sum([...b.entries()].map(([id, q]) => Math.max(0, q) * (costOf.get(id) ?? 0))) });
  }

  // Yetkazuvchilar
  const bySupplier = new Map<string, { name: string; value: number; docs: number }>();
  for (const g of receipts) { const v = sum(g.items.map((i) => Number(i.qty) * Number(i.price))); const s = bySupplier.get(g.supplierId) ?? { name: g.supplier.name, value: 0, docs: 0 }; s.value += v; s.docs++; bySupplier.set(g.supplierId, s); }
  const suppliers = [...bySupplier.values()].sort((a, b) => b.value - a.value).slice(0, 5);
  const purchases = sum([...bySupplier.values()].map((s) => s.value));

  // Buyurtma navbati — pul bo'yicha
  const queue = materials.filter((m) => m.suggestQty > 0 && (m.zone === "Kritik" || m.zone === "Xavfli" || m.short || m.balance < m.minStock)).sort((a, b) => b.suggestCost - a.suggestCost);
  const dead = materials.filter((m) => m.dead);
  const deadValue = sum(dead.map((m) => m.value)) + sum(finished.map((f) => f.value));

  // ABC × zaxira (kunlarda)
  const abcStock = (["A", "B", "C"] as const).map((a) => ({ abc: a, items: materials.filter((m) => m.abc === a), value: sum(materials.filter((m) => m.abc === a).map((m) => m.value)) }));

  return {
    cards: { value, sku: materials.length, turnoverDays, stockout: materials.filter((m) => m.zone === "Kritik" || m.zone === "Xavfli").length, overstock: materials.filter((m) => m.overstock).length, writeOff: woValue, writeOffCount: woInRange.length, purchases },
    materials, finished, queue, dead, deadValue, inflow, outflow, totalIn, totalOut, trend, suppliers, woMonthly, abcStock,
    zones: { critical: materials.filter((m) => m.zone === "Kritik").length, risky: materials.filter((m) => m.zone === "Xavfli").length, good: materials.filter((m) => m.zone === "Yaxshi").length, unknown: materials.filter((m) => m.zone === "Ma'lumot yo'q").length },
  };
}
