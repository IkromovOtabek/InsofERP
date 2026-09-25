import { db } from "./db";
import { ingredientOf, balanceOf } from "./recipe";

export type Capacity = {
  productId: string; product: string; unit: string; version: number;
  canMake: number; // hozirgi xomashyo/mahsulot qoldig'i bilan necha birlik ishlab chiqarish mumkin
  limiting: { name: string; unit: string; balance: number; perUnit: number } | null; // eng avval tugaydigan ingredient
  remaining: number; // qabul qilingan zayavkalarda hali ishlab chiqarilmagan hajm
  items: { name: string; unit: string; perUnit: number; balance: number; enoughFor: number; short: number }[]; // short — zayavkalar uchun yetishmaydigan miqdor
};

/**
 * Ingredientga (xomashyo yoki boshqa mahsulot — masalan FBS blok) qarab ishlab chiqarish imkoni:
 * har mahsulot (faol retsepti bor) uchun canMake = min(qoldiq_i / norma_i).
 * Zayavkalar ehtiyoji bilan solishtiriladi — qaysi ingredient qancha yetishmasligi ko'rinadi.
 */
export async function productionCapacity(): Promise<Capacity[]> {
  const [products, matSums, prodSums, orders] = await Promise.all([
    db.product.findMany({ where: { isActive: true }, orderBy: { code: "asc" }, include: { recipes: { where: { isActive: true }, include: { items: { include: { material: true, product: true } } } } } }),
    db.stockMove.groupBy({ by: ["materialId"], where: { materialId: { not: null } }, _sum: { qty: true } }),
    db.stockMove.groupBy({ by: ["productId"], where: { productId: { not: null } }, _sum: { qty: true } }),
    db.order.findMany({ where: { status: { in: ["CONFIRMED", "IN_PRODUCTION"] } }, include: { items: true, batches: true } }),
  ]);
  const matBal = new Map(matSums.map((x) => [x.materialId!, Number(x._sum.qty ?? 0)]));
  const prodBal = new Map(prodSums.map((x) => [x.productId!, Number(x._sum.qty ?? 0)]));
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
      const ing = ingredientOf(i);
      const balance = balanceOf(ing, matBal, prodBal);
      return { name: ing.name, unit: ing.unit, perUnit: ing.qtyPerM3, balance, enoughFor: ing.qtyPerM3 > 0 ? balance / ing.qtyPerM3 : Infinity, short: Math.max(0, need * ing.qtyPerM3 - balance) };
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
