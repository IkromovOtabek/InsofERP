/**
 * Retsept qatori — xomashyo YOKI boshqa mahsulot bo'lishi mumkin (`RecipeItem.materialId`
 * yoki `.productId`, ikkalasi emas — `StockMove` dagi bilan bir xil qoida). Ko'p bosqichli
 * tayyorlov uchun: masalan katta konstruksiyaga tayyor FBS blok kabi boshqa mahsulot kiradi.
 *
 * Bu yordamchi retsept qatorini bitta umumiy ko'rinishga keltiradi va sklad qoldig'ini
 * to'g'ri Map'dan (xomashyo yoki mahsulot) oladi — xomashyo va mahsulotni ishlatadigan
 * har bir joyda (ishlab chiqarish imkoni, zames, BI) bir xil qoida ishlatilishi uchun.
 */

export type RecipeIngredient = { key: string; kind: "material" | "product"; name: string; unit: string; qtyPerM3: number };

type RawItem = {
  materialId: string | null;
  productId: string | null;
  qtyPerM3: unknown; // Prisma.Decimal | number
  material: { name: string; unit: string } | null;
  product: { name: string; unit: string } | null;
};

/** RecipeItem (material/product bilan include qilingan) dan umumiy ko'rinishga keltiradi. */
export function ingredientOf(i: RawItem): RecipeIngredient {
  if (i.materialId && i.material) return { key: i.materialId, kind: "material", name: i.material.name, unit: i.material.unit, qtyPerM3: Number(i.qtyPerM3) };
  if (i.productId && i.product) return { key: i.productId, kind: "product", name: i.product.name, unit: i.product.unit, qtyPerM3: Number(i.qtyPerM3) };
  // Bo'lishi mumkin emas (schema `NOT NULL` bo'lmasa ham app qatlami har doim bittasini to'ldiradi),
  // lekin xato ma'lumot uchrasa hisob-kitob jimgina noto'g'ri chiqmasin — aniq xato bering.
  throw new Error("Retsept qatorida na xomashyo, na mahsulot ko'rsatilgan");
}

/** Sklad qoldig'i — ingredient turiga qarab to'g'ri Map'dan (materialBal yoki productBal). */
export function balanceOf(ing: Pick<RecipeIngredient, "kind" | "key">, materialBal: Map<string, number>, productBal: Map<string, number>): number {
  return (ing.kind === "material" ? materialBal.get(ing.key) : productBal.get(ing.key)) ?? 0;
}
