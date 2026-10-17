import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { shopDiff, shopItemSnapshot } from "@/lib/shop-history";
import { MAX_AMOUNT } from "@/lib/action";

/**
 * E-commerce vitrinasi — tez amallar (veb `e-commerce/actions.ts` va mobil `lib/mobile/sotuv-extra.ts` bitta qoidadan).
 * Ruxsat (`sales` → `ecommerce`) chaqiruvchida tekshiriladi. Product'ning o'zi o'zgarmaydi — faqat ShopItem.
 */

/** Ilovada ko'rinadi / yashiriladi. O'zgarmagan bo'lsa hech narsa yozilmaydi. */
export async function setShopItemPublished(productId: string, on: boolean, userId: string): Promise<{ changed: boolean }> {
  const prev = await db.shopItem.findUnique({ where: { productId }, select: { isPublished: true, product: { select: { name: true } } } });
  if (prev?.isPublished === on) return { changed: false };
  const item = await db.shopItem.upsert({ where: { productId }, create: { productId, isPublished: on }, update: { isPublished: on }, include: { product: { select: { name: true } } } });
  await audit(db, userId, "STATUS_CHANGE", "ShopItem", item.id, { product: item.product.name, isPublished: prev?.isPublished ?? false }, { product: item.product.name, isPublished: on });
  return { changed: true };
}

/**
 * Do'kon narxi (ilovada ko'rinadigan narx). `null` — narx olib tashlanadi, ilovada mahsulotning bazaviy narxi ko'rinadi.
 * Tarix: vebdagi «Saqlash» kabi — faqat haqiqatan o'zgarganda audit yoziladi.
 */
export async function setShopItemPrice(productId: string, price: number | null, userId: string): Promise<{ ok: true; changed: boolean } | { ok: false; error: string }> {
  if (price != null && (!Number.isFinite(price) || price < 0 || price > MAX_AMOUNT)) return { ok: false, error: "Narx raqam bo'lishi kerak" };
  const product = await db.product.findUnique({ where: { id: productId }, select: { id: true, name: true } });
  if (!product) return { ok: false, error: "Mahsulot topilmadi" };
  const prev = await db.shopItem.findUnique({ where: { productId } });
  const p = price == null ? null : Math.round(price * 100) / 100;
  if (prev && (prev.price == null ? null : Number(prev.price)) === p) return { ok: true, changed: false };
  const item = await db.shopItem.upsert({ where: { productId }, create: { productId, price: p }, update: { price: p } });
  const before = shopItemSnapshot(prev);
  const after = shopItemSnapshot(item);
  if (!prev || shopDiff("ShopItem", before, after).length) {
    await audit(db, userId, prev ? "UPDATE" : "CREATE", "ShopItem", item.id, before && { product: product.name, ...before }, { product: product.name, ...after });
  }
  return { ok: true, changed: true };
}
