import { db } from "@/lib/db";
import { finishedUnitCosts } from "@/lib/bi/core";
import { materialTurnover } from "@/lib/stock-turnover";
import type { MonthKey } from "./period";

/**
 * «Insof 2026» sklad varaqlari — Tahlil → Ombor:
 *  - «Xom-ashyo balansi (oy bo'yicha)»: haqiqiy sarf = oy boshi + kirim − oy oxiri (sklad aylanmasi, `materialTurnover`);
 *    norma = retsept × (sotilgan beton va buyumlar + omborda ko'paygan buyumlar). Farq — normadan ortiq sarf.
 *  - «Tayyor mahsulot»: dona mahsulot bo'yicha oy boshi, ishlab chiqarildi, jo'natildi, oy oxiri, tannarx va sotuv qiymati.
 * Beton (m³) omborda turmaydi — uning normasi zameslardan (`ProductionBatch`), dona buyumlar — sklad harakatidan.
 */

const r2 = (v: number) => Math.round(v * 100) / 100 || 0;
const r3 = (v: number) => Math.round(v * 1000) / 1000 || 0;

export const monthBounds = (month: MonthKey) => {
  const from = new Date(Number(month.slice(0, 4)), Number(month.slice(5)) - 1, 1);
  return { from, to: new Date(from.getFullYear(), from.getMonth() + 1, 1) };
};

/** Mahsulot → yuqori papka nomi (Bosh sahifa paneli bilan bir xil). */
async function productGroups() {
  const [products, groups] = await Promise.all([
    db.product.findMany({ select: { id: true, name: true, code: true, unit: true, price: true, groupId: true, isActive: true } }),
    db.productGroup.findMany({ select: { id: true, name: true, parentId: true } }),
  ]);
  const byId = new Map(groups.map((g) => [g.id, g]));
  const top = (id: string | null) => { let g = id ? byId.get(id) : undefined; for (let i = 0; g?.parentId && i < 10; i++) g = byId.get(g.parentId) ?? g; return g?.name ?? "Boshqalar"; };
  return new Map(products.map((p) => [p.id, { ...p, price: Number(p.price), group: top(p.groupId) }]));
}

// ───────────────────── Xom-ashyo balansi ─────────────────────

export type RawRow = {
  id: string; name: string; unit: string; group: string;
  open: number; received: number; close: number; fact: number;
  normSold: number; normStock: number; norm: number; shouldRemain: number;
  diff: number; diffPct: number | null; price: number | null; diffSum: number | null;
};
export type RawGroupTotal = Omit<RawRow, "id" | "price"> & { price: null };
export type RawBalance = {
  month: MonthKey; from: Date; to: Date;
  rows: RawRow[];
  groups: { group: string; rows: RawRow[]; total: RawGroupTotal | null }[];
  diffSum: number;
  scrap: { income: number; incomeCount: number };
};

export async function rawBalance(month: MonthKey): Promise<RawBalance> {
  const { from, to } = monthBounds(month);
  const [turnover, recipes, batches, moves, mats, scrapTx] = await Promise.all([
    materialTurnover({ from, to }),
    db.recipe.findMany({ where: { isActive: true }, orderBy: { version: "desc" }, select: { productId: true, items: { select: { materialId: true, qtyPerM3: true } } } }),
    db.productionBatch.findMany({ where: { cancelledAt: null, date: { gte: from, lt: to }, product: { unit: "m3" } }, select: { productId: true, qtyM3: true } }),
    db.stockMove.groupBy({ by: ["productId", "type"], where: { productId: { not: null }, type: { in: ["PRODUCTION_OUTPUT", "SHIPMENT"] }, date: { gte: from, lt: to }, product: { unit: { not: "m3" } } }, _sum: { qty: true } }),
    db.material.findMany({ select: { id: true, group: { select: { name: true } } } }),
    db.cashTransaction.findMany({ where: { cancelledAt: null, type: "INCOME", date: { gte: from, lt: to }, OR: [{ note: { contains: "metallom", mode: "insensitive" } }, { category: { contains: "metallom", mode: "insensitive" } }, { subCategory: { contains: "metallom", mode: "insensitive" } }] }, select: { amount: true } }),
  ]);

  // Har mahsulotning faol (oxirgi versiya) retsepti
  const recipeOf = new Map<string, { materialId: string; q: number }[]>();
  for (const r of recipes) if (!recipeOf.has(r.productId)) recipeOf.set(r.productId, r.items.filter((i) => i.materialId).map((i) => ({ materialId: i.materialId!, q: Number(i.qtyPerM3) })));

  // Sotilgan va omborda ko'paygan miqdor: beton — zames (hammasi sotiladi); dona — jo'natilgan va (ishlab chiqarilgan − jo'natilgan)
  const sold = new Map<string, number>(), stocked = new Map<string, number>();
  for (const b of batches) sold.set(b.productId, (sold.get(b.productId) ?? 0) + Number(b.qtyM3));
  // Dona: omborda ko'paygan = ishlab chiqarilgan − jo'natilgan (manfiy — eski qoldiqdan sotilgan, norma kamayadi)
  for (const m of moves) {
    const q = Number(m._sum.qty ?? 0), pid = m.productId!;
    if (m.type === "PRODUCTION_OUTPUT") stocked.set(pid, (stocked.get(pid) ?? 0) + q);
    else { sold.set(pid, (sold.get(pid) ?? 0) - q); stocked.set(pid, (stocked.get(pid) ?? 0) + q); }
  }

  const normSold = new Map<string, number>(), normStock = new Map<string, number>();
  const add = (m: Map<string, number>, k: string, v: number) => m.set(k, (m.get(k) ?? 0) + v);
  for (const [pid, q] of sold) for (const i of recipeOf.get(pid) ?? []) add(normSold, i.materialId, i.q * q);
  for (const [pid, q] of stocked) for (const i of recipeOf.get(pid) ?? []) add(normStock, i.materialId, i.q * q);

  const recipeMats = new Set([...recipeOf.values()].flat().map((i) => i.materialId));
  const groupName = new Map(mats.map((m) => [m.id, m.group?.name ?? null]));
  const rows: RawRow[] = turnover
    .filter((t) => recipeMats.has(t.id) && (t.open.q || t.in.q || t.out.q || t.close.q || normSold.get(t.id) || normStock.get(t.id)))
    .map((t) => {
      const ns = r3(normSold.get(t.id) ?? 0), nk = r3(normStock.get(t.id) ?? 0), norm = r3(ns + nk);
      const fact = r3(t.open.q + t.in.q - t.close.q);
      const diff = r3(fact - norm);
      const price = t.avgCost ?? t.unitPrice;
      return {
        id: t.id, name: t.name, unit: t.unit, group: groupName.get(t.id) ?? t.name.split(/\s+/)[0]!,
        open: t.open.q, received: t.in.q, close: t.close.q, fact, normSold: ns, normStock: nk, norm,
        shouldRemain: r3(t.open.q + t.in.q - norm), diff, diffPct: norm > 0 ? (diff / norm) * 100 : null,
        price, diffSum: price != null ? r2(diff * price) : null,
      };
    });

  // Guruh: bir xil birlikdagi ≥2 material («Armatura 12, 14, 16») — jami qatori bilan
  const byGroup = new Map<string, RawRow[]>();
  for (const r of rows) { const l = byGroup.get(r.group) ?? []; l.push(r); byGroup.set(r.group, l); }
  const groups = [...byGroup.entries()].map(([group, list]) => {
    list.sort((a, b) => a.name.localeCompare(b.name, "uz", { numeric: true }));
    if (list.length < 2 || new Set(list.map((r) => r.unit)).size > 1) return { group, rows: list, total: null };
    const s = (f: (r: RawRow) => number) => r3(list.reduce((a, r) => a + f(r), 0));
    const norm = s((r) => r.norm), diff = s((r) => r.diff);
    const sums = list.map((r) => r.diffSum);
    return {
      group, rows: list,
      total: {
        name: `${group} jami`, unit: list[0]!.unit, group, open: s((r) => r.open), received: s((r) => r.received), close: s((r) => r.close), fact: s((r) => r.fact),
        normSold: s((r) => r.normSold), normStock: s((r) => r.normStock), norm, shouldRemain: s((r) => r.shouldRemain), diff,
        diffPct: norm > 0 ? (diff / norm) * 100 : null, price: null, diffSum: sums.every((x) => x != null) ? r2(sums.reduce((a, b) => a! + b!, 0)!) : null,
      },
    };
  }).sort((a, b) => (b.total ? 1 : 0) - (a.total ? 1 : 0) || Math.abs(b.rows.reduce((s, r) => s + (r.diffSum ?? 0), 0)) - Math.abs(a.rows.reduce((s, r) => s + (r.diffSum ?? 0), 0)));

  return {
    month, from, to, rows, groups,
    diffSum: r2(rows.reduce((s, r) => s + (r.diffSum ?? 0), 0)),
    scrap: { income: r2(scrapTx.reduce((s, t) => s + Number(t.amount), 0)), incomeCount: scrapTx.length },
  };
}

// ───────────────────── Tayyor mahsulot ─────────────────────

export type FinishedRow = {
  id: string; name: string; group: string; brigades: { name: string; qty: number }[];
  open: number; produced: number; shipped: number; other: number; close: number;
  cost: number | null; price: number; valueCost: number; valuePrice: number;
};
export type FinishedReport = {
  month: MonthKey; rows: FinishedRow[]; groups: string[]; brigades: string[];
  total: { open: number; produced: number; shipped: number; other: number; close: number; valueCost: number; valuePrice: number };
};

export async function finishedReport(month: MonthKey): Promise<FinishedReport> {
  const { from, to } = monthBounds(month);
  const [prods, before, during, costs, progress] = await Promise.all([
    productGroups(),
    db.stockMove.groupBy({ by: ["productId"], where: { productId: { not: null }, date: { lt: from }, product: { unit: { not: "m3" } } }, _sum: { qty: true } }),
    db.stockMove.groupBy({ by: ["productId", "type"], where: { productId: { not: null }, date: { gte: from, lt: to }, product: { unit: { not: "m3" } } }, _sum: { qty: true } }),
    finishedUnitCosts(),
    db.taskProgress.findMany({ where: { date: { gte: from, lt: to } }, select: { qty: true, task: { select: { brigade: { select: { name: true } }, orderItem: { select: { productId: true } } } } } }),
  ]);
  const rows = new Map<string, FinishedRow>();
  const row = (id: string) => {
    let r = rows.get(id);
    if (!r) {
      const p = prods.get(id)!;
      r = { id, name: p.name, group: p.group, brigades: [], open: 0, produced: 0, shipped: 0, other: 0, close: 0, cost: costs.get(id) ?? null, price: p.price, valueCost: 0, valuePrice: 0 };
      rows.set(id, r);
    }
    return r;
  };
  for (const b of before) if (prods.has(b.productId!)) row(b.productId!).open += Number(b._sum.qty ?? 0);
  for (const m of during) {
    if (!prods.has(m.productId!)) continue;
    const r = row(m.productId!), q = Number(m._sum.qty ?? 0);
    if (m.type === "PRODUCTION_OUTPUT") r.produced += q;
    else if (m.type === "SHIPMENT") r.shipped += -q;
    else r.other += q;
  }
  const brig = new Map<string, Map<string, number>>();
  for (const p of progress) {
    const pid = p.task.orderItem.productId;
    if (!rows.has(pid) && !prods.has(pid)) continue;
    const m = brig.get(pid) ?? new Map<string, number>();
    m.set(p.task.brigade.name, (m.get(p.task.brigade.name) ?? 0) + Number(p.qty));
    brig.set(pid, m);
  }
  const list = [...rows.values()].map((r) => {
    const close = r3(r.open + r.produced - r.shipped + r.other);
    return {
      ...r, open: r3(r.open), produced: r3(r.produced), shipped: r3(r.shipped), other: r3(r.other), close,
      brigades: [...(brig.get(r.id) ?? new Map()).entries()].map(([name, qty]) => ({ name, qty: r3(qty) })).sort((a, b) => b.qty - a.qty),
      valueCost: r.cost != null && close > 0 ? r2(close * r.cost) : 0, valuePrice: close > 0 ? r2(close * r.price) : 0,
    };
  }).filter((r) => r.open || r.produced || r.shipped || r.other || r.close)
    .sort((a, b) => a.group.localeCompare(b.group, "uz") || a.name.localeCompare(b.name, "uz", { numeric: true }));
  const s = (f: (r: FinishedRow) => number) => r2(list.reduce((a, r) => a + f(r), 0));
  return {
    month, rows: list,
    groups: [...new Set(list.map((r) => r.group))],
    brigades: [...new Set(list.flatMap((r) => r.brigades.map((b) => b.name)))].sort((a, b) => a.localeCompare(b, "uz", { numeric: true })),
    total: { open: s((r) => r.open), produced: s((r) => r.produced), shipped: s((r) => r.shipped), other: s((r) => r.other), close: s((r) => r.close), valueCost: s((r) => r.valueCost), valuePrice: s((r) => r.valuePrice) },
  };
}
