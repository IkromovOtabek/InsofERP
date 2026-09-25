import { db } from "@/lib/db";
import { unitLabel } from "@/lib/unit";
import type { CatalogProduct, CatalogGroup } from "@/components/product-picker";

/**
 * Mahsulot spravochnigining YAGONA yuklovchisi. Mahsulot tanlanadigan har bir joy
 * (zayavka, sklad, ishlab chiqarish, retsept, mobil ilova) ro'yxatni shu yerdan oladi —
 * shunda hammasida bir xil mahsulotlar, bir xil tartib (nomi bo'yicha) va bir xil papkalar
 * ko'rinadi; bir joyda qo'shilgan mahsulot qolganlarida ham darhol chiqadi.
 *
 * Farq faqat filtrda: `pieceOnly` — hovlida saqlanadigan dona mahsulot (beton m³ saqlanmaydi),
 * `exclude` — retseptda mahsulot o'zini o'ziga ingredient qilmasin, `withRecipe` — zames uchun
 * faol retsepti bormi degan belgi.
 */
export type CatalogRow = CatalogProduct & { rawUnit: string; hasRecipe: boolean };

export async function productCatalog(opts: { pieceOnly?: boolean; exclude?: string } = {}): Promise<{ products: CatalogRow[]; groups: CatalogGroup[] }> {
  const [rows, groups] = await Promise.all([
    db.product.findMany({
      where: { isActive: true, ...(opts.pieceOnly ? { unit: { not: "m3" } } : {}), ...(opts.exclude ? { id: { not: opts.exclude } } : {}) },
      orderBy: [{ name: "asc" }, { code: "asc" }],
      include: { recipes: { where: { isActive: true }, select: { id: true } } },
    }),
    db.productGroup.findMany({ where: { isActive: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, code: true, name: true, parentId: true } }),
  ]);
  return {
    products: rows.map((p) => ({
      id: p.id, code: p.code, name: p.name, kind: p.kind, groupId: p.groupId,
      price: p.price.toString(), unit: unitLabel(p.unit), rawUnit: p.unit, hasRecipe: p.recipes.length > 0,
    })),
    groups,
  };
}

/** "Plita › PK" — papkasiz (tekis) ro'yxatlarda, masalan mobil ilovada, mahsulot qaysi papkada ekani ko'rinsin. */
export function groupPath(groups: CatalogGroup[], groupId: string | null): string {
  const by = new Map(groups.map((g) => [g.id, g]));
  const parts: string[] = [];
  let cur = groupId ? by.get(groupId) : undefined;
  while (cur) { parts.unshift(cur.name); cur = cur.parentId ? by.get(cur.parentId) : undefined; }
  return parts.join(" › ");
}
