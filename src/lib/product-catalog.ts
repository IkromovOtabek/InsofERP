import { db } from "@/lib/db";
import { unitLabel } from "@/lib/unit";
import { fmtNum } from "@/lib/format";
import { fmtVolume, unitVolume } from "@/lib/volume";
import { productionCapacity } from "@/lib/production-capacity";
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
  const [rows, groups, capacity] = await Promise.all([
    db.product.findMany({
      where: { isActive: true, ...(opts.pieceOnly ? { unit: { not: "m3" } } : {}), ...(opts.exclude ? { id: { not: opts.exclude } } : {}) },
      orderBy: [{ name: "asc" }, { code: "asc" }],
      include: { recipes: { where: { isActive: true }, select: { id: true } } },
    }),
    db.productGroup.findMany({ where: { isActive: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, code: true, name: true, parentId: true } }),
    // Retsept bo'yicha skladdagi xomashyodan necha birlik chiqadi (faol retseptli mahsulotlar)
    productionCapacity(),
  ]);
  const canMake = new Map(capacity.map((c) => [c.productId, c.canMake]));
  return {
    products: rows.map((p) => ({
      id: p.id, code: p.code, name: p.name, kind: p.kind, groupId: p.groupId,
      price: p.price.toString(), unit: unitLabel(p.unit), rawUnit: p.unit, hasRecipe: p.recipes.length > 0,
      weightKg: p.weightKg != null ? Number(p.weightKg) : null, perTrip: p.perTrip,
      m3: fmtVolume(unitVolume(p)), volumeM3: p.volumeM3 != null ? Number(p.volumeM3) : null,
      fromStockM3: stockM3(canMake.get(p.id), unitVolume(p)),
    })),
    groups,
  };
}

/**
 * Skladdagi xomashyodan necha kub beton chiqadi: retsept bo'yicha chiqadigan birlik × 1 birlik hajmi.
 * Retsepti yo'q yoki hajmi noma'lum mahsulot — null; hajm taxminiy bo'lsa «≈».
 */
function stockM3(units: number | undefined, vol: ReturnType<typeof unitVolume>): string | null {
  if (units == null || !vol) return null;
  return `${vol.approx ? "≈" : ""}${fmtNum(units * vol.m3, 1)}`;
}

/** "Plita › PK" — papkasiz (tekis) ro'yxatlarda, masalan mobil ilovada, mahsulot qaysi papkada ekani ko'rinsin. */
export function groupPath(groups: CatalogGroup[], groupId: string | null): string {
  const by = new Map(groups.map((g) => [g.id, g]));
  const parts: string[] = [];
  let cur = groupId ? by.get(groupId) : undefined;
  while (cur) { parts.unshift(cur.name); cur = cur.parentId ? by.get(cur.parentId) : undefined; }
  return parts.join(" › ");
}
