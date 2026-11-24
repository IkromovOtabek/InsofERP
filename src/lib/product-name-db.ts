import type { Prisma } from "@/generated/prisma";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { flatName } from "@/lib/excel";
import { nextCatalogCode } from "@/lib/numbering";
import { OTHER_PRODUCT_GROUP, guessProductGroup, productMatchesKey, productNameKey } from "@/lib/product-name";

/**
 * Mahsulot katalogi qoidalari (bazali qism) — Sarvar rejasi 1.1, 2026-11-24. Mijozlardagi `lib/customer-name.ts` bilan
 * bir xil usul: nom kaliti (`productNameKey`) bo'yicha takror tekshiruvi + kalit qulfi (bir vaqtda ikki kishi qo'shsa ham
 * bitta mahsulot ochiladi). Mahsulot doim papkada turadi (`resolveProductGroup`).
 */

type Client = Prisma.TransactionClient | typeof db;

export type SameNameProduct = { id: string; name: string; isActive: boolean; viaAlias: boolean };

/** Shu nomli mahsulot — asosiy nomi yoki boshqa nomi (`aliases`) kaliti bir xil. Faoli nofaolidan, nomi aliasdan oldin. */
export async function findSameNameProduct(name: string, exceptId?: string | null, client: Client = db): Promise<SameNameProduct | null> {
  const key = productNameKey(name);
  if (!key) return null;
  const list = await client.product.findMany({
    where: exceptId ? { id: { not: exceptId } } : {},
    orderBy: [{ isActive: "desc" }, { createdAt: "asc" }],
    select: { id: true, name: true, aliases: true, isActive: true },
  });
  const byName = list.find((p) => productNameKey(p.name) === key);
  if (byName) return { id: byName.id, name: byName.name, isActive: byName.isActive, viaAlias: false };
  const byAlias = list.find((p) => productMatchesKey({ name: "", aliases: p.aliases }, key));
  return byAlias ? { id: byAlias.id, name: byAlias.name, isActive: byAlias.isActive, viaAlias: true } : null;
}

/** Bir xil nom kalitli mahsulot ochish / nomini o'zgartirish navbati (tranzaksiya oxirigacha). */
export async function lockProductName(tx: Prisma.TransactionClient, name: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"product-name:" + productNameKey(name)}))`;
}

/** Foydalanuvchiga xato matni: qaysi mahsulot band qilgan (arxivda bo'lsa — shuni ham). */
export function sameProductError(p: SameNameProduct, entered: string): string {
  const what = p.viaAlias ? `«${entered}» — «${p.name}» mahsulotining boshqa nomi` : `«${p.name}» ro'yxatda bor`;
  return `${what}${p.isActive ? "" : " (arxivda)"} — ikkinchi bir xil mahsulot ochilmaydi`;
}

/** Yuqori (ildiz) papka nomi bo'yicha — topilmasa yaratiladi (kodi katalog bo'ylab keyingi raqam). */
export async function ensureRootGroup(tx: Prisma.TransactionClient, name: string, userId: string): Promise<string> {
  const k = flatName(name);
  const roots = await tx.productGroup.findMany({ where: { parentId: null }, select: { id: true, name: true } });
  const hit = roots.find((g) => flatName(g.name) === k);
  if (hit) return hit.id;
  const g = await tx.productGroup.create({ data: { name, parentId: null, code: await nextCatalogCode(tx) } });
  await audit(tx, userId, "CREATE", "ProductGroup", g.id, undefined, g);
  return g.id;
}

/**
 * Yangi mahsulot papkasi — mahsulot papkasiz saqlanmaydi: berilgan papka → nomi berilgan papka (ildiz ustun) →
 * nomdan taxmin (`guessProductGroup`: PK → Plita, Beton…, xomashyo nomi → «Xomashyo sotuvi») → «Boshqalar».
 * Faqat avtomatik ochilgan mahsulot (import) uchun; qo'lda qo'shishda papka foydalanuvchidan so'raladi.
 */
export async function resolveProductGroup(
  tx: Prisma.TransactionClient,
  p: { name: string; groupId?: string | null; groupName?: string | null },
  userId: string,
): Promise<string> {
  if (p.groupId) return p.groupId;
  if (p.groupName?.trim()) {
    const k = flatName(p.groupName);
    const all = await tx.productGroup.findMany({ select: { id: true, name: true, parentId: true } });
    const hit = all.filter((g) => flatName(g.name) === k);
    const g = hit.find((x) => !x.parentId) ?? hit[0];
    if (g) return g.id;
  }
  const materials = await tx.material.findMany({ select: { name: true } });
  return ensureRootGroup(tx, guessProductGroup(p.name, materials.map((m) => m.name)) ?? OTHER_PRODUCT_GROUP, userId);
}
