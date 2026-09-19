import { db } from "./db";

export type Capacity = {
  productId: string; product: string; unit: string; version: number;
  canMake: number; // hozirgi xomashyo qoldig'i bilan necha birlik ishlab chiqarish mumkin
  limiting: { name: string; unit: string; balance: number; perUnit: number } | null; // eng avval tugaydigan xomashyo
  remaining: number; // qabul qilingan zayavkalarda hali ishlab chiqarilmagan hajm
  items: { name: string; unit: string; perUnit: number; balance: number; enoughFor: number; short: number }[]; // short — zayavkalar uchun yetishmaydigan miqdor
};

/**
 * Xomashyoga qarab ishlab chiqarish imkoni: har mahsulot (faol retsepti bor) uchun
 * canMake = min(qoldiq_i / norma_i). Zayavkalar ehtiyoji bilan solishtiriladi — qaysi xomashyo qancha yetishmasligi ko'rinadi.
 */
export async function productionCapacity(): Promise<Capacity[]> {
  const [products, sums, orders] = await Promise.all([
    db.product.findMany({ where: { isActive: true }, orderBy: { code: "asc" }, include: { recipes: { where: { isActive: true }, include: { items: { include: { material: true } } } } } }),
    db.stockMove.groupBy({ by: ["materialId"], where: { materialId: { not: null } }, _sum: { qty: true } }),
    db.order.findMany({ where: { status: { in: ["CONFIRMED", "IN_PRODUCTION"] } }, include: { items: true, batches: true } }),
  ]);
  const bal = new Map(sums.map((x) => [x.materialId, Number(x._sum.qty ?? 0)]));
  // Mahsulot bo'yicha ishlab chiqarilmagan qoldiq (zayavka ulushi bo'yicha)
  const remaining = new Map<string, number>();
  for (const o of orders) {
    const total = o.items.reduce((s, i) => s + Number(i.qtyM3), 0);
    const done = o.batches.reduce((s, b) => s + Number(b.qtyM3), 0);
    const left = Math.max(0, total - done);
    if (!left || !total) continue;
    for (const i of o.items) remaining.set(i.productId, (remaining.get(i.productId) ?? 0) + left * (Number(i.qtyM3) / total));
  }
  return products.filter((p) => p.recipes[0]?.items.length).map((p) => {
    const r = p.recipes[0];
    const need = remaining.get(p.id) ?? 0;
    const items = r.items.map((i) => {
      const perUnit = Number(i.qtyPerM3), balance = bal.get(i.materialId) ?? 0;
      return { name: i.material.name, unit: i.material.unit, perUnit, balance, enoughFor: perUnit > 0 ? balance / perUnit : Infinity, short: Math.max(0, need * perUnit - balance) };
    });
    const lim = items.reduce<(typeof items)[number] | null>((m, x) => (m == null || x.enoughFor < m.enoughFor ? x : m), null);
    return {
      productId: p.id, product: p.name, unit: p.unit, version: r.version,
      canMake: Math.max(0, Math.floor((lim?.enoughFor ?? 0) * 100) / 100),
      limiting: lim && Number.isFinite(lim.enoughFor) ? { name: lim.name, unit: lim.unit, balance: lim.balance, perUnit: lim.perUnit } : null,
      remaining: need, items,
    };
  });
}
