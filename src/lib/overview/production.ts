import { db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma";
import { productionDay } from "@/lib/production-day";
import { productionMatrix } from "@/lib/production-matrix";
import { brigadeDefectSums, brigadeOutput } from "@/lib/brigade-pay";
import { COMMON_KEY, ownerOverview } from "@/lib/brigade-products";
import { stockStatus } from "@/lib/production-report";
import { unitVolume } from "@/lib/volume";
import { today } from "@/lib/davomat";

/**
 * Ishlab chiqarish — umumiy ko'rinish (`/production/umumiy`): bo'limning muhim raqamlari bir joyda.
 * Raqamlar qayta hisoblanmaydi — boshqa sahifalar o'qiydigan manbalar:
 *  · bugun va oy plani — `productionDay` (bosh sahifa va kunlik hisobot bilan bir xil);
 *  · ishlab chiqarish kerak, muddati o'tgan zayavkalar — `productionMatrix`;
 *  · brigada bajargani, fond va brak summasi — `brigade-pay` (Brigadalar → «Oylik» bilan bir xil formula, faqat davr boshqa);
 *  · hovlidagi tayyor mahsulot — `ownerOverview`; xomashyo xavfi — `stockStatus` (kunlik hisobot qoidasi).
 * Davr [from, to) faqat davr ko'rsatkichlariga ta'sir qiladi (mahsulot, brigada, brak, xomashyo sarfi); qolgani — hozirgi holat.
 */
const OPEN: Prisma.BrigadeTaskWhereInput = { status: { in: ["NEW", "IN_PROGRESS"] } };
const r3 = (n: number) => Math.round(n * 1000) / 1000;

export async function productionOverview(from: Date, to: Date) {
  const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
  const late: Prisma.BrigadeTaskWhereInput = { ...OPEN, dueDate: { lt: dayStart } };
  const [day, matrix, pools, brakByBrigade, yard, stock, products, brigades, outputs, defects, consumed, openBy, lateBy, lateTasks] = await Promise.all([
    productionDay(today()),
    productionMatrix(),
    brigadeOutput(from, to),
    brigadeDefectSums(from, to),
    ownerOverview(),
    stockStatus(),
    db.product.findMany({ select: { id: true, code: true, name: true, unit: true, volumeM3: true, weightKg: true } }),
    db.brigade.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, isActive: true } }),
    db.stockMove.groupBy({ by: ["productId"], where: { type: "PRODUCTION_OUTPUT", productId: { not: null }, date: { gte: from, lt: to } }, _sum: { qty: true } }),
    db.productDefect.groupBy({ by: ["productId"], where: { date: { gte: from, lt: to } }, _sum: { qty: true, amount: true }, _count: true }),
    db.stockMove.groupBy({ by: ["materialId"], where: { type: "PRODUCTION_CONSUME", materialId: { not: null }, date: { gte: from, lt: to } }, _sum: { qty: true } }),
    db.brigadeTask.groupBy({ by: ["brigadeId"], where: OPEN, _count: true }),
    db.brigadeTask.groupBy({ by: ["brigadeId"], where: late, _count: true }),
    db.brigadeTask.findMany({
      where: late, orderBy: { dueDate: "asc" }, take: 8,
      select: { id: true, taskNo: true, qty: true, doneQty: true, dueDate: true, brigade: { select: { name: true } }, order: { select: { id: true, orderNo: true } }, orderItem: { select: { product: { select: { name: true, unit: true } } } } },
    }),
  ]);

  // ── Davrdagi ishlab chiqarish mahsulot bo'yicha (PRODUCTION_OUTPUT — bosh sahifa bilan bir manba) + brak ──
  const meta = new Map(products.map((p) => [p.id, p]));
  const out = new Map(outputs.map((o) => [o.productId!, Number(o._sum.qty ?? 0)]));
  const def = new Map(defects.map((d) => [d.productId, { qty: Number(d._sum.qty ?? 0), amount: Number(d._sum.amount ?? 0), count: d._count }]));
  const byProduct = [...new Set([...out.keys(), ...def.keys()])]
    .map((id) => {
      const p = meta.get(id);
      if (!p) return null;
      const q = r3(out.get(id) ?? 0), v = unitVolume(p);
      return { id, name: p.name, unit: p.unit, qty: q, m3: v ? r3(q * v.m3) : null, approx: !!v?.approx, defect: r3(def.get(id)?.qty ?? 0) };
    })
    .filter((r): r is NonNullable<typeof r> => !!r && (Math.abs(r.qty) > 0.0005 || r.defect > 0))
    .sort((a, b) => (a.unit === "m3" ? -1 : b.unit === "m3" ? 1 : 0) || (b.m3 ?? 0) - (a.m3 ?? 0) || b.qty - a.qty);
  const brak = {
    count: defects.reduce((s, d) => s + d._count, 0),
    amount: defects.reduce((s, d) => s + Number(d._sum.amount ?? 0), 0),
    rows: byProduct.filter((r) => r.defect > 0).map((r) => ({ unit: r.unit, qty: r.defect })),
  };

  // ── Brigadalar: davrda bajargani, fond − brak (`brigade-pay`), ochiq / kechikkan topshiriqlar (hozir) ──
  const openOf = new Map(openBy.map((g) => [g.brigadeId, g._count]));
  const lateOf = new Map(lateBy.map((g) => [g.brigadeId, g._count]));
  const brigadeRows = brigades
    .map((b) => {
      const pool = pools.get(b.id), d = brakByBrigade.get(b.id);
      const fund = pool?.sum ?? 0, brakSum = d?.sum ?? 0;
      return { id: b.id, name: b.name, isActive: b.isActive, units: pool?.units.map((u) => ({ unit: u.unit, qty: u.qty })) ?? [], open: openOf.get(b.id) ?? 0, late: lateOf.get(b.id) ?? 0, fund, brak: brakSum, net: fund - brakSum };
    })
    .filter((b) => b.isActive || b.units.length || b.brak || b.open);

  // ── Xomashyo: davrdagi sarf va ishlab chiqarishga kerakli xomashyoning yetishmovchilik xavfi ──
  const used = new Map(consumed.map((c) => [c.materialId!, r3(-Number(c._sum.qty ?? 0))]));
  const LEVEL = { short: 0, low: 1, ok: 2 } as const;
  const materials = stock
    .map((m) => ({ ...m, used: used.get(m.id) ?? 0, forProduction: m.planned > 0 || m.perDay > 0 || (used.get(m.id) ?? 0) > 0 }))
    .filter((m) => m.forProduction && (m.used > 0 || m.level !== "ok"))
    .sort((a, b) => LEVEL[a.level] - LEVEL[b.level] || b.used - a.used);

  // ── Hovlidagi tayyor mahsulot (dona): umumiy hovli va brigada omborlari ──
  const yardRows = yard.rows
    .filter((r) => r.total > 0.0005)
    .map((r) => ({ id: r.productId, name: r.name, unit: r.unit, total: r.total, common: r.byOwner[COMMON_KEY] ?? 0 }))
    .sort((a, b) => b.total - a.total);

  return {
    day,
    matrix: {
      need: matrix.summary.need, needKinds: matrix.summary.needKinds, orders: matrix.summary.orders, late: matrix.summary.late,
      needList: matrix.needList,
      // Brigada kutayotgan zayavka — hamma qatori hali to'liq brigadaga berilmagan (ustun emas, zayavka soni)
      unassigned: new Set(matrix.orders.filter((o) => o.assign !== "full").map((o) => o.id)).size,
    },
    tasks: { open: openBy.reduce((s, g) => s + g._count, 0), late: lateBy.reduce((s, g) => s + g._count, 0), lateList: lateTasks.map((t) => ({ ...t, left: r3(Math.max(0, Number(t.qty) - Number(t.doneQty))) })) },
    byProduct, brak, brigades: brigadeRows,
    pay: { fund: brigadeRows.reduce((s, b) => s + b.fund, 0), brak: brigadeRows.reduce((s, b) => s + b.brak, 0), net: brigadeRows.reduce((s, b) => s + b.net, 0) },
    materials, materialRisk: materials.filter((m) => m.level !== "ok").length,
    yard: yardRows,
  };
}

export type ProductionOverview = Awaited<ReturnType<typeof productionOverview>>;
