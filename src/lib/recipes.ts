import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import type { Prisma } from "@/generated/prisma";

/**
 * Retsept versiyasi — yagona joy (veb «Retseptlar» → mahsulot sahifasi ham, mobil ilovadagi retsept kartochkasi ham).
 * Sessiya/ruxsat tekshiruvi (`production` → `recipe`) va `revalidatePath` — chaqiruvchida.
 */

/**
 * Retsept versiyasi qulfi (mahsulot bo'yicha). Faol versiya har doim bitta: yangisi yoziladigan tranzaksiyada
 * eskilari nofaol qilinadi. Zames ham, brigada sarfi ham faol versiyalardan eng yangisini (`version desc`) oladi.
 */
export async function lockRecipe(tx: Prisma.TransactionClient, productId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"recipe:" + productId}))`;
}

/**
 * Retsept tsikli: A ga B kiradi, B ning faol retseptiga esa A (yoki A ga olib boradigan zanjir) kiradi.
 * Shunday bo'lsa zames/brigada sarfi bir-birini cheksiz talab qiladi — saqlanmaydi.
 * Faol retseptlar bo'yicha ingredient-mahsulotlardan pastga yuriladi; productId ga yetib borsak — tsikl.
 * Topilsa zanjir nomlari qaytadi (xabar uchun), aks holda null.
 */
async function recipeCycle(productId: string, ingredientProductIds: string[]): Promise<string[] | null> {
  const parent = new Map<string, string>(); // bola → qaysi mahsulot orqali yetildi
  const seen = new Set<string>(ingredientProductIds);
  let frontier = [...ingredientProductIds];
  for (const id of frontier) parent.set(id, productId);
  for (let depth = 0; frontier.length && depth < 50; depth++) {
    const rows = await db.recipeItem.findMany({
      where: { recipe: { productId: { in: frontier }, isActive: true }, productId: { not: null } },
      select: { productId: true, recipe: { select: { productId: true } } },
    });
    const next: string[] = [];
    for (const r of rows) {
      const child = r.productId!;
      if (child === productId) {
        // Zanjirni tiklash: productId → … → r.recipe.productId → productId
        const chain = [r.recipe.productId];
        for (let cur = r.recipe.productId; parent.get(cur) && parent.get(cur) !== productId; ) { cur = parent.get(cur)!; chain.unshift(cur); }
        const ids = [productId, ...chain, productId];
        const names = new Map((await db.product.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })).map((p) => [p.id, p.name]));
        return ids.map((id) => names.get(id) ?? "?");
      }
      if (seen.has(child)) continue;
      seen.add(child); parent.set(child, r.recipe.productId); next.push(child);
    }
    frontier = next;
  }
  return null;
}

/** Retsept qatori: xomashyo YOKI boshqa mahsulot (`kind`), `refId` — o'sha id, `qtyPerM3` — 1 birlikka miqdor. */
export type RecipeRowInput = { kind: string; refId: string; qtyPerM3: number };

/** Yangi versiya yaratadi; eskisi nofaol bo'ladi, lekin o'chirilmaydi (tarix). Mahsulotda retsept bo'lmasa — 1-versiya. */
export async function createRecipeVersion(productId: string, rows: RecipeRowInput[], note: string | null, userId: string): Promise<{ error: string } | { ok: true; id: string; version: number }> {
  const items = rows
    .filter((x) => x.refId && x.qtyPerM3 > 0)
    .map((x) => ({
      materialId: x.kind === "material" ? x.refId : null,
      productId: x.kind === "product" ? x.refId : null,
      qtyPerM3: x.qtyPerM3,
    }));
  if (items.length === 0) return { error: "Kamida bitta xomashyo yoki mahsulot 0 dan katta miqdorda bo'lsin" };
  // Bitta ingredient (xomashyo yoki mahsulot) retseptda faqat bir marta bo'lsin
  const keys = items.map((i) => i.materialId ?? i.productId);
  if (new Set(keys).size !== keys.length) return { error: "Bitta xomashyo/mahsulot ikki marta kiritilgan" };
  if (items.some((i) => i.productId === productId)) return { error: "Mahsulot o'zining retseptiga ingredient bo'la olmaydi" };
  // Mahsulot va ingredientlar haqiqatan mavjudmi (o'chirilgan/soxta id bilan retsept yozilmasin)
  const matIds = items.filter((i) => i.materialId).map((i) => i.materialId!);
  const prodIds = items.filter((i) => i.productId).map((i) => i.productId!);
  const [own, matCount, prodCount] = await Promise.all([
    db.product.findUnique({ where: { id: productId }, select: { id: true } }),
    matIds.length ? db.material.count({ where: { id: { in: matIds } } }) : 0,
    prodIds.length ? db.product.count({ where: { id: { in: prodIds } } }) : 0,
  ]);
  if (!own) return { error: "Mahsulot topilmadi" };
  if (matCount !== matIds.length || prodCount !== prodIds.length) return { error: "Ingredientlardan biri topilmadi — sahifani yangilab, qayta tanlang" };
  // A → B → A: B ning faol retseptida A (yoki A ga olib boruvchi zanjir) bo'lsa — rad
  const cycle = prodIds.length ? await recipeCycle(productId, prodIds) : null;
  if (cycle) return { error: `Retseptlar aylanib qoladi: ${cycle.join(" → ")}. Bir mahsulot ikkinchisiga, u esa birinchisiga ingredient bo'la olmaydi.` };

  const rec = await db.$transaction(async (tx) => {
    // Mahsulot bo'yicha navbat: bir vaqtdagi ikki saqlash ikkita faol versiya qoldirmasin
    await lockRecipe(tx, productId);
    const last = await tx.recipe.findFirst({ where: { productId }, orderBy: { version: "desc" } });
    await tx.recipe.updateMany({ where: { productId, isActive: true }, data: { isActive: false } });
    const r = await tx.recipe.create({
      data: { productId, version: (last?.version ?? 0) + 1, note, items: { create: items } },
    });
    await audit(tx, userId, "CREATE", "Recipe", r.id, undefined, { ...r, items });
    return r;
  });
  return { ok: true, id: rec.id, version: rec.version };
}
