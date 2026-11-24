import type { Prisma } from "@/generated/prisma";
import { audit } from "@/lib/audit";
import { normalizeProductName, productNameKey } from "@/lib/product-name";

/**
 * Takror mahsulotni asosiysiga birlashtirish — UI («Dublikat» paneli) va katalog tozalash skripti uchun bitta yadro
 * (Sarvar rejasi 1.1, 2026-11-24). Qoida: hech narsa o'chib ketmaydi.
 *  · nusxaga bog'langan hamma yozuv (13 bog'lanish: zayavka qatori, sklad harakati, zames, brak, reja, retsept, retsept
 *    qatori, realizatsiya, boshlang'ich qoldiq, taklif, lid, banner, do'kon) va brigada oylik varag'idagi `productId`
 *    asosiy mahsulotga ko'chadi — miqdor va sanalar o'zgarmaydi;
 *  · nusxa o'chirilmaydi: arxivlanadi, nomiga «(takror)» qo'shiladi; uning nomi va boshqa nomlari asosiy mahsulotning
 *    boshqa nomlariga (`aliases`) o'tadi — keyingi Excel/reestr importi eski nom bilan ham to'g'ri mahsulotga tushadi;
 *  · asosiyda bo'sh bo'lgan xususiyat (papka, og'irlik, hajm, sdelka narxi…) nusxadan olinadi, narx 0 bo'lsa — ham;
 *  · `name` berilsa asosiy mahsulot shu nomni oladi (eski nomi ham boshqa nom bo'lib qoladi).
 * Yagonalik to'qnashuvi: bir oyga ikkalasida reja — qo'shiladi; bitta retseptda ikkalasi ingredient — normasi qo'shiladi;
 * ikkalasida do'kon kartasi — asosiyniki qoladi, nusxaniki auditga yozilib o'chiriladi; ikkalasida bir skladga faol
 * boshlang'ich qoldiq yoki birligi har xil — `MergeConflict` (hech narsa yozilmaydi).
 * Chaqiruvchi sklad qulfini (`lockStock`) oladi va AuditLog'ga kim qilganini beradi.
 */
export class MergeConflict extends Error {}

const FILL = ["strengthClass", "pieceRate", "weightKg", "perTrip", "volumeM3", "kind", "groupId", "note"] as const;

export type MergeResult = { moved: Record<string, number>; name: string };

export async function mergeProductInto(
  tx: Prisma.TransactionClient,
  p: { keepId: string; dropId: string; userId: string; name?: string; via: string },
): Promise<MergeResult> {
  const [keep, drop] = await Promise.all([
    tx.product.findUnique({ where: { id: p.keepId } }),
    tx.product.findUnique({ where: { id: p.dropId } }),
  ]);
  if (!keep || !drop) throw new MergeConflict("Mahsulot topilmadi — ro'yxatni yangilang");
  if (keep.id === drop.id) throw new MergeConflict("Mahsulot o'zi bilan birlashtirilmaydi");
  // m³ beton bilan dona mahsulotni birlashtirsa qoldiqlar bir-biriga qo'shilib ketardi
  if (drop.unit !== keep.unit) throw new MergeConflict(`«${drop.name}» (${drop.unit}) va «${keep.name}» (${keep.unit}) birligi har xil — birlashtirib bo'lmaydi`);
  const from = { productId: drop.id }, to = { productId: keep.id };
  const moved: Record<string, number> = {};
  const note = (k: string, n: number) => { if (n) moved[k] = (moved[k] ?? 0) + n; };

  // ── Retsept tsikli: mahsulot o'ziga ingredient bo'lib qolmasin ──
  const cyc = await tx.recipeItem.count({ where: { OR: [{ productId: keep.id, recipe: { productId: drop.id } }, { productId: drop.id, recipe: { productId: keep.id } }] } });
  if (cyc) throw new MergeConflict(`«${keep.name}» va «${drop.name}» biri ikkinchisining retseptiga ingredient sifatida kiradi — avval retseptni tuzating`);

  // ── Boshlang'ich qoldiq: faol kalit ichida mahsulot id'si bor («STOCK:<productId>:<warehouseId>») ──
  const openings = await tx.openingBalance.findMany({ where: { ...from, activeKey: { not: null } }, select: { id: true, activeKey: true } });
  const keyMoves: { id: string; key: string }[] = [];
  for (const o of openings) {
    const key = o.activeKey!.replace(`:${drop.id}:`, `:${keep.id}:`);
    if (key !== o.activeKey && (await tx.openingBalance.findUnique({ where: { activeKey: key } }))) throw new MergeConflict(`«${keep.name}» va «${drop.name}» ikkalasida bir skladga faol boshlang'ich qoldiq bor — avval bittasini bekor qiling`);
    keyMoves.push({ id: o.id, key });
  }

  // ── Oddiy ko'chirish ──
  note("zayavka qatori", (await tx.orderItem.updateMany({ where: from, data: to })).count);
  note("zames", (await tx.productionBatch.updateMany({ where: from, data: to })).count);
  note("sklad harakati", (await tx.stockMove.updateMany({ where: from, data: to })).count);
  note("lid", (await tx.lead.updateMany({ where: from, data: to })).count);
  note("brak", (await tx.productDefect.updateMany({ where: from, data: to })).count);
  note("banner", (await tx.shopBanner.updateMany({ where: from, data: to })).count);
  note("realizatsiya", (await tx.realizationEntry.updateMany({ where: from, data: to })).count);
  note("taklif", (await tx.commercialOfferItem.updateMany({ where: from, data: to })).count);
  if (keyMoves.length) {
    await tx.openingBalance.updateMany({ where: { id: { in: keyMoves.map((k) => k.id) } }, data: { activeKey: null } });
  }
  note("boshlang'ich qoldiq", (await tx.openingBalance.updateMany({ where: from, data: to })).count);
  for (const k of keyMoves) await tx.openingBalance.update({ where: { id: k.id }, data: { activeKey: k.key } });

  // ── Boshqa retseptlardagi ingredient qatori: bitta retseptda ikkalasi bo'lsa normasi qo'shiladi ──
  for (const row of await tx.recipeItem.findMany({ where: from })) {
    const twin = await tx.recipeItem.findUnique({ where: { recipeId_productId: { recipeId: row.recipeId, productId: keep.id } } });
    if (twin) {
      await tx.recipeItem.update({ where: { id: twin.id }, data: { qtyPerM3: Number(twin.qtyPerM3) + Number(row.qtyPerM3) } });
      await tx.recipeItem.delete({ where: { id: row.id } });
    } else await tx.recipeItem.update({ where: { id: row.id }, data: to });
    note("retsept qatori", 1);
  }

  // ── Retseptlar: versiya mahsulot bo'yicha yagona — keyingi raqam; asosiyda faol retsept bo'lmasa nusxaniki faol qoladi ──
  const keepRecipes = await tx.recipe.findMany({ where: to, select: { version: true, isActive: true } });
  let version = keepRecipes.reduce((a, b) => Math.max(a, b.version), 0);
  let hasActive = keepRecipes.some((x) => x.isActive);
  for (const rec of await tx.recipe.findMany({ where: from, orderBy: { version: "asc" } })) {
    const keepActive = rec.isActive && !hasActive;
    if (keepActive) hasActive = true;
    await tx.recipe.update({ where: { id: rec.id }, data: { productId: keep.id, version: ++version, isActive: keepActive } });
    note("retsept", 1);
  }

  // ── Ishlab chiqarish rejasi: bir oyga ikkalasida bo'lsa — qo'shiladi ──
  for (const pl of await tx.productionPlan.findMany({ where: from })) {
    const twin = await tx.productionPlan.findUnique({ where: { year_month_productId: { year: pl.year, month: pl.month, productId: keep.id } } });
    if (twin) {
      const dayQty = twin.dayQty == null && pl.dayQty == null ? null : Number(twin.dayQty ?? 0) + Number(pl.dayQty ?? 0);
      await tx.productionPlan.update({ where: { id: twin.id }, data: { monthQty: Number(twin.monthQty) + Number(pl.monthQty), dayQty } });
      await tx.productionPlan.delete({ where: { id: pl.id } });
    } else await tx.productionPlan.update({ where: { id: pl.id }, data: to });
    note("reja", 1);
  }

  // ── Do'kon kartasi (mahsulotga bitta) ──
  const dropShop = await tx.shopItem.findUnique({ where: from });
  if (dropShop) {
    if (!(await tx.shopItem.findUnique({ where: to, select: { id: true } }))) await tx.shopItem.update({ where: { id: dropShop.id }, data: to });
    else {
      await tx.shopItem.delete({ where: { id: dropShop.id } });
      await audit(tx, p.userId, "DELETE", "ShopItem", dropShop.id, dropShop, { mergedInto: keep.id, reason: "asosiy mahsulotning o'z do'kon kartasi bor" });
    }
    note("do'kon", 1);
  }

  // ── Brigada oylik varag'i: `lines[].productId` (JSON, bog'lanishsiz) ──
  for (const bm of await tx.brigadeMonth.findMany({ select: { id: true, lines: true } })) {
    if (!Array.isArray(bm.lines) || !JSON.stringify(bm.lines).includes(drop.id)) continue;
    const lines = (bm.lines as Prisma.JsonArray).map((l) => (l && typeof l === "object" && !Array.isArray(l) && (l as Prisma.JsonObject).productId === drop.id ? { ...(l as Prisma.JsonObject), productId: keep.id } : l));
    await tx.brigadeMonth.update({ where: { id: bm.id }, data: { lines } });
    note("brigada varag'i", 1);
  }

  // ── Asosiy mahsulot: nom, boshqa nomlar, bo'sh xususiyatlar nusxadan ──
  const name = p.name ? normalizeProductName(p.name) : keep.name;
  const nameKey = productNameKey(name);
  const aliases: string[] = [];
  for (const a of [...keep.aliases, keep.name, drop.name, ...drop.aliases]) {
    const k = productNameKey(a);
    if (k && k !== nameKey && !aliases.some((x) => productNameKey(x) === k)) aliases.push(a);
  }
  const fill: Record<string, unknown> = {};
  for (const f of FILL) if (keep[f] == null && drop[f] != null) fill[f] = drop[f];
  if (Number(keep.price) === 0 && Number(drop.price) > 0) fill.price = drop.price;
  const after = await tx.product.update({ where: { id: keep.id }, data: { name, aliases, isActive: true, ...fill } });
  await tx.product.update({ where: { id: drop.id }, data: { isActive: false, aliases: [], name: `${drop.name} (takror)`, note: `Birlashtirildi → ${keep.code} «${name}»` } });

  await audit(tx, p.userId, "UPDATE", "Product", keep.id,
    { name: keep.name, aliases: keep.aliases, ...Object.fromEntries(Object.keys(fill).map((k) => [k, keep[k as keyof typeof keep]])) },
    { name: after.name, aliases: after.aliases, ...fill, mergedFrom: drop.id, moved, via: p.via });
  await audit(tx, p.userId, "STATUS_CHANGE", "Product", drop.id,
    { name: drop.name, isActive: drop.isActive, aliases: drop.aliases }, { name: `${drop.name} (takror)`, isActive: false, mergedInto: keep.id, via: p.via });
  return { moved, name };
}
