"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { parseForm, zStr, zOpt, type ActionState } from "@/lib/action";
import { flatName, num, str } from "@/lib/excel";
import { normalizeUnit, PRODUCT_UNITS } from "@/lib/unit";
import { PRODUCT_KINDS } from "@/lib/catalog";
import type { Prisma } from "@/generated/prisma";

/**
 * Mahsulot spravochnigi — zayavkada, skladda va ishlab chiqarishda "..." tugmasidan
 * ochiladigan bir xil tanlagich. Papka va mahsulot shu yerdan qo'shiladi, shuning uchun
 * sotuvchi va sklad xodimiga ham ruxsat bor (Sozlamalardagi "Beton markalari" —
 * avvalgidek faqat direktorda).
 */
const CATALOG_ROLES = ["SALES", "PRODUCTION", "WAREHOUSE", "DIRECTOR"] as const;

/** Kod berilmasa — ro'yxatdagi eng katta raqamli koddan keyingisi (1C dagidek). */
async function nextCatalogCode(tx: Prisma.TransactionClient): Promise<string> {
  const [products, groups] = await Promise.all([
    tx.product.findMany({ select: { code: true } }),
    tx.productGroup.findMany({ select: { code: true } }),
  ]);
  const max = [...products, ...groups]
    .map((x) => Number(x.code))
    .filter((n) => Number.isFinite(n))
    .reduce((a, b) => Math.max(a, b), 0);
  return String(max + 1);
}

const groupSchema = z.object({
  name: zStr("Papka nomi kerak"),
  parentId: zOpt,
  code: zOpt,
});

/** Yangi papka (guruh). `parentId` — ochiq turgan papka. */
export async function createProductGroup(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireSession([...CATALOG_ROLES]);
  const r = parseForm(groupSchema, fd);
  if ("error" in r) return { error: r.error };
  const d = r.data;
  try {
    await db.$transaction(async (tx) => {
      const g = await tx.productGroup.create({
        data: { name: d.name, parentId: d.parentId, code: d.code ?? (await nextCatalogCode(tx)) },
      });
      await audit(tx, s.userId, "CREATE", "ProductGroup", g.id, undefined, g);
    });
  } catch (e) {
    if (String(e).includes("Unique constraint")) return { error: "Bu kod band" };
    throw e;
  }
  refresh();
  return { ok: true };
}

const productSchema = z.object({
  name: zStr("Mahsulot nomi kerak"),
  code: zOpt,
  kind: zOpt,
  unit: zStr("O'lchov birligi kerak"),
  price: z.coerce.number().min(0, "narx manfiy bo'lmasin").default(0),
  groupId: zOpt,
  note: zOpt,
});

/**
 * Yangi mahsulot — tanlagichdagi "Yangi" tugmasi. Ochiq papka ichiga tushadi.
 * Shu nomli (yoki kodli) mahsulot allaqachon bo'lsa dublikat ochilmaydi — mavjudi yangilanadi.
 */
export async function createCatalogProduct(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireSession([...CATALOG_ROLES]);
  const r = parseForm(productSchema, fd);
  if ("error" in r) return { error: r.error };
  const d = r.data;
  let merged = false;
  try {
    await db.$transaction(async (tx) => {
      const w = await catalogWriter(tx, s.userId, d.groupId);
      const res = await w.put({ name: d.name, code: d.code ?? undefined, kind: d.kind, unit: d.unit, price: d.price, note: d.note, groupId: d.groupId });
      merged = res === "updated";
    });
  } catch (e) {
    if (String(e).includes("Unique constraint")) return { error: "Bu kod bilan mahsulot bor" };
    throw e;
  }
  refresh();
  return merged
    ? { ok: true, note: `«${d.name}» ro'yxatda bor edi — yangisi ochilmadi, mavjudi yangilandi.` }
    : { ok: true };
}

/* ───────── Ko'p mahsulotni birdan yozish (Excel va matritsa uchun umumiy) ───────── */

type PutInput = { name: string; code?: string; unit?: string | null; price?: number | null; kind?: string | null; note?: string | null; groupId?: string | null };

/**
 * Bitta tranzaksiya ichida spravochnikka ko'p yozuv qo'shadigan yordamchi.
 * Kod (mahsulot va papka bo'ylab yagona) 1C dagidek eng katta raqamdan davom etadi,
 * papka nomi bo'yicha topiladi yoki yaratiladi, mahsulot kodi/nomi mos kelsa yangilanadi.
 * `rootId` — ochiq turgan papka: papkasiz yozuvlar va yangi papkalar shu ichiga tushadi.
 */
async function catalogWriter(tx: Prisma.TransactionClient, userId: string, rootId: string | null) {
  const [products, groups] = await Promise.all([
    tx.product.findMany({ select: { id: true, code: true, name: true } }),
    tx.productGroup.findMany({ select: { id: true, code: true, name: true, parentId: true } }),
  ]);
  // Kod ham mahsulot, ham papka bo'ylab yagona bo'lishi kerak
  const codes = new Set([...products, ...groups].map((x) => x.code.toUpperCase()));
  let seq = [...codes].map(Number).filter((n) => Number.isFinite(n)).reduce((a, b) => Math.max(a, b), 0);
  const nextCode = (want?: string) => {
    let c = (want ?? "").toUpperCase();
    while (!c || codes.has(c)) { seq++; c = String(seq); }
    codes.add(c);
    return c;
  };

  const idOf = new Map<string, string>();
  for (const p of products) { idOf.set(p.code.toUpperCase(), p.id); idOf.set(flatName(p.name), p.id); }
  const groupAt = new Map<string, string>();
  for (const g of groups) groupAt.set(`${g.parentId ?? ""}|${flatName(g.name)}`, g.id);
  let newGroups = 0;

  /** Papka nomi (yoki "Plita / PK" kabi yo'l) → papka id. Topilmasa yaratiladi. */
  const group = async (raw: string, parentId: string | null = rootId) => {
    let parent = parentId;
    for (const seg of raw.split(/[\/>|\\]|→/).map((x) => x.trim()).filter(Boolean)) {
      const key = `${parent ?? ""}|${flatName(seg)}`;
      let id = groupAt.get(key);
      if (!id) {
        const g = await tx.productGroup.create({ data: { name: seg, parentId: parent, code: nextCode() } });
        await audit(tx, userId, "CREATE", "ProductGroup", g.id, undefined, g);
        id = g.id;
        groupAt.set(key, id);
        newGroups++;
      }
      parent = id;
    }
    return parent;
  };

  /** Mahsulotni qo'shadi yoki (kodi/nomi mos kelsa) yangilaydi. Bo'sh maydon mavjud qiymatni o'chirmaydi. */
  const put = async (x: PutInput) => {
    const code = (x.code ?? "").toUpperCase();
    const found = (code ? idOf.get(code) : undefined) ?? idOf.get(flatName(x.name));
    if (found) {
      const before = await tx.product.findUniqueOrThrow({ where: { id: found } });
      const after = await tx.product.update({
        where: { id: found },
        data: {
          name: x.name, isActive: true,
          ...(x.unit ? { unit: x.unit } : {}),
          ...(x.price != null ? { price: x.price } : {}),
          ...(x.kind ? { kind: x.kind } : {}),
          ...(x.note ? { note: x.note } : {}),
          ...(x.groupId ? { groupId: x.groupId } : {}),
        },
      });
      await audit(tx, userId, "UPDATE", "Product", found, before, after);
      idOf.set(flatName(x.name), found);
      return "updated" as const;
    }
    const c = nextCode(code);
    const p = await tx.product.create({
      data: { code: c, name: x.name, unit: x.unit ?? "dona", price: x.price ?? 0, kind: x.kind ?? null, note: x.note ?? null, groupId: x.groupId ?? null },
    });
    idOf.set(c, p.id); idOf.set(flatName(x.name), p.id);
    await audit(tx, userId, "CREATE", "Product", p.id, undefined, p);
    return "created" as const;
  };

  return { put, group, get newGroups() { return newGroups; } };
}

/** "3 ta yangi mahsulot qo'shildi, 1 tasi yangilandi." — import va matritsa uchun bir xil xabar. */
const doneNote = (created: number, updated: number, newGroups: number) =>
  `${created} ta yangi mahsulot qo'shildi${updated ? `, ${updated} tasi yangilandi` : ""}.`
  + (newGroups ? ` ${newGroups} ta yangi papka yaratildi.` : "");

/* ───────── Excel orqali qo'shish ───────── */

const importSchema = z.object({ groupId: zOpt, rows: z.string() });
type ImportRow = { name?: unknown; code?: unknown; kind?: unknown; unit?: unknown; price?: unknown; group?: unknown; note?: unknown };

/** Excel'dan kelgan manfiy bo'lmagan raqam; bo'sh yoki xato bo'lsa `null` (mavjud qiymat o'zgarmaydi). */
const dec = (v: unknown) => { const n = num(v); return Number.isFinite(n) && n >= 0 ? n : null; };

/** Mahsulot birligi: "metir" → "m", "ТН" → "t". Xomashyo birligi (kg, l) mahsulotga to'g'ri kelmaydi — tanilmagan deb olinadi. */
const PRODUCT_UNIT_KEYS: string[] = PRODUCT_UNITS.map(([v]) => v);
const productUnit = (v: unknown) => { const u = normalizeUnit(v); return u && PRODUCT_UNIT_KEYS.includes(u) ? u : null; };

/** "tayyor mahsulot", "ТОВАР" kabi yozuvlarni ro'yxatdagi tovar turiga keltiradi; tanilmasa `null`. */
const productKind = (v: unknown) => { const k = flatName(str(v)); return k ? (PRODUCT_KINDS.find((x) => flatName(x) === k) ?? null) : null; };

/**
 * Mahsulot spravochnigi → Excel orqali qo'shish: bitta fayldan ko'p mahsulot birdan.
 * Har qator: nomi (majburiy), kodi, tovar turi, birligi, narxi, papkasi, izoh — hammasi ochiq turgan papkaga tushadi.
 * "Papka" ustuni bo'lsa mahsulot shu nomli papka ichiga tushadi (topilmasa yaratiladi;
 * "Plita / PK" deb yozilsa papka ichida papka ochiladi).
 * Kodi yoki nomi bo'yicha mavjud mahsulot topilsa yangilanadi (bo'sh kataklar tegilmaydi), aks holda yangisi yaratiladi.
 * Kod berilmasa — 1C dagidek ro'yxatdagi eng katta raqamdan keyingisi; band bo'lsa keyingisiga o'tadi.
 * Fayl to'xtatmaydi: birlik tanilmasa "dona", narx xato bo'lsa 0 olinadi — faqat nomi bo'sh qatorlar tashlanadi.
 */
export async function importCatalogProducts(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireSession([...CATALOG_ROLES]);
  const r = parseForm(importSchema, fd);
  if ("error" in r) return { error: r.error };
  let rows: ImportRow[];
  try { rows = JSON.parse(r.data.rows); } catch { return { error: "Ma'lumotlar o'qilmadi" }; }
  rows = rows.filter((x) => str(x.name));
  if (!rows.length) return { error: "Faylda mahsulot nomi topilmadi" };
  const groupId = r.data.groupId;

  const out = await db.$transaction(async (tx) => {
    const w = await catalogWriter(tx, s.userId, groupId);
    let created = 0, updated = 0, guessed = 0;
    for (const x of rows) {
      const unit = productUnit(x.unit);
      if (!unit && str(x.unit) !== "") guessed++; // birlik tanilmadi — "dona" qo'yiladi
      const folder = str(x.group);
      const res = await w.put({
        name: str(x.name),
        code: str(x.code),
        unit,
        price: dec(x.price),
        kind: productKind(x.kind),
        note: str(x.note) || null,
        groupId: folder ? await w.group(folder) : groupId,
      });
      if (res === "created") created++; else updated++;
    }
    return { created, updated, guessed, newGroups: w.newGroups };
  }, { timeout: 120_000, maxWait: 20_000 });

  refresh();
  return {
    ok: true,
    note: doneNote(out.created, out.updated, out.newGroups)
      + (out.guessed ? ` ${out.guessed} ta qatorda birlik tanilmadi — "dona" qo'yildi.` : ""),
  };
}

/* ───────── Matritsa ko'rinishida qo'shish ───────── */

const matrixSchema = z.object({
  groupId: zOpt,
  kind: zOpt,
  unit: zStr("O'lchov birligi kerak"),
  price: z.coerce.number().min(0, "narx manfiy bo'lmasin").default(0),
  folderPerRow: zOpt, // "1" — har qator uchun alohida papka
  cells: z.string(),
});
type MatrixCell = { name?: unknown; row?: unknown; price?: unknown };

const MATRIX_MAX = 500; // bir urinishda shuncha katakdan ko'pi yozilmaydi

/**
 * Matritsa ko'rinishida qo'shish: qatorlar (masalan markalar) × ustunlar (masalan o'lchovlar)
 * kesishmasidagi har belgilangan katak — bitta mahsulot. Nomi shablon bo'yicha ekranda yasaladi,
 * narxi katakda ko'rsatilmagan bo'lsa umumiy narx olinadi.
 * `folderPerRow` bo'lsa har qator nomi bilan ochiq papka ichida papka ochiladi va mahsulotlar shunga tushadi.
 * Nomi mavjud mahsulotga to'g'ri kelsa — takror yaratilmaydi, narxi/birligi yangilanadi.
 */
export async function createProductMatrix(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireSession([...CATALOG_ROLES]);
  const r = parseForm(matrixSchema, fd);
  if ("error" in r) return { error: r.error };
  const d = r.data;
  let cells: MatrixCell[];
  try { cells = JSON.parse(d.cells); } catch { return { error: "Matritsa o'qilmadi" }; }
  cells = cells.filter((x) => str(x.name));
  if (!cells.length) return { error: "Belgilangan katak yo'q — qator va ustun nomlarini kiriting" };
  if (cells.length > MATRIX_MAX) return { error: `Bir marta ${MATRIX_MAX} tagacha mahsulot qo'shiladi (hozir ${cells.length} ta)` };
  if (!PRODUCT_UNIT_KEYS.includes(d.unit)) return { error: "O'lchov birligi ro'yxatda yo'q" };
  const perRow = d.folderPerRow === "1";

  const out = await db.$transaction(async (tx) => {
    const w = await catalogWriter(tx, s.userId, d.groupId);
    let created = 0, updated = 0;
    for (const x of cells) {
      const row = str(x.row);
      const price = dec(x.price);
      const res = await w.put({
        name: str(x.name),
        unit: d.unit,
        price: price ?? d.price,
        kind: d.kind,
        groupId: perRow && row ? await w.group(row) : d.groupId,
      });
      if (res === "created") created++; else updated++;
    }
    return { created, updated, newGroups: w.newGroups };
  }, { timeout: 120_000, maxWait: 20_000 });

  refresh();
  return { ok: true, note: doneNote(out.created, out.updated, out.newGroups) };
}


/* ───────── Bir xil nomli mahsulotlarni birlashtirish ───────── */

const mergeSchema = z.object({ pairs: z.string() });
type MergePair = { keepId?: unknown; dropIds?: unknown };

/**
 * Dublikatlarni bitta mahsulotga yig'adi: qaysi yozuv qoladi — foydalanuvchi tanlaydi
 * ("Dublikat" panelidagi nuqta). Qolgan yozuvlardagi hujjatlar (zayavka qatorlari, zameslar,
 * sklad harakatlari, retseptlar, saytdan kelgan so'rovlar) qoladigan mahsulotga ko'chiriladi,
 * keyin ortiqcha yozuvlar o'chiriladi — shuning uchun qaysi birini qoldirsa ham hech narsa yo'qolmaydi.
 * Ko'chirilgan retseptlar arxiv bo'lib qoladi (faol retsept bittaligi buzilmasin).
 */
export async function mergeProducts(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireSession([...CATALOG_ROLES]);
  const r = parseForm(mergeSchema, fd);
  if ("error" in r) return { error: r.error };
  let pairs: MergePair[];
  try { pairs = JSON.parse(r.data.pairs); } catch { return { error: "Tanlov o'qilmadi" }; }

  const jobs = pairs
    .map((p) => ({ keepId: str(p.keepId), dropIds: Array.isArray(p.dropIds) ? p.dropIds.map((x) => str(x)).filter(Boolean) : [] }))
    .filter((p) => p.keepId && p.dropIds.length && !p.dropIds.includes(p.keepId));
  if (!jobs.length) return { error: "Birlashtirish uchun mahsulot tanlanmadi" };

  const out = await db.$transaction(async (tx) => {
    let merged = 0, moved = 0;
    for (const job of jobs) {
      const keep = await tx.product.findUnique({ where: { id: job.keepId } });
      if (!keep) continue;
      for (const dropId of job.dropIds) {
        const drop = await tx.product.findUnique({ where: { id: dropId } });
        if (!drop || drop.id === keep.id) continue;

        const [items, batches, moves, leads, recipes, keepRecipes] = await Promise.all([
          tx.orderItem.updateMany({ where: { productId: dropId }, data: { productId: keep.id } }),
          tx.productionBatch.updateMany({ where: { productId: dropId }, data: { productId: keep.id } }),
          tx.stockMove.updateMany({ where: { productId: dropId }, data: { productId: keep.id } }),
          tx.lead.updateMany({ where: { productId: dropId }, data: { productId: keep.id } }),
          tx.recipe.findMany({ where: { productId: dropId }, orderBy: { version: "asc" } }),
          tx.recipe.findMany({ where: { productId: keep.id }, select: { version: true, isActive: true } }),
        ]);
        // Retsept versiyasi mahsulot bo'yicha yagona — ko'chirishda keyingi raqam beriladi
        let version = keepRecipes.reduce((a, b) => Math.max(a, b.version), 0);
        let hasActive = keepRecipes.some((x) => x.isActive);
        for (const rec of recipes) {
          version++;
          const keepActive = rec.isActive && !hasActive; // qoladigan mahsulotda faol retsept bo'lmasa — birinchisi faol qoladi
          if (keepActive) hasActive = true;
          await tx.recipe.update({ where: { id: rec.id }, data: { productId: keep.id, version, isActive: keepActive } });
        }
        await tx.product.delete({ where: { id: dropId } });
        await audit(tx, s.userId, "DELETE", "Product", dropId, drop, { mergedInto: keep.id, keepName: keep.name });
        merged++;
        moved += items.count + batches.count + moves.count + leads.count + recipes.length;
      }
      await audit(tx, s.userId, "UPDATE", "Product", keep.id, undefined, { mergedFrom: job.dropIds });
    }
    return { merged, moved };
  }, { timeout: 120_000, maxWait: 20_000 });

  if (!out.merged) return { error: "Birlashtiriladigan mahsulot topilmadi (ehtimol allaqachon birlashtirilgan)" };
  refresh();
  return { ok: true, note: `${out.merged} ta ortiqcha yozuv birlashtirildi, ${out.moved} ta hujjat qatori ko'chirildi.` };
}


/* ───────── Ro'yxatdan o'chirish ───────── */

/**
 * Mahsulotni ro'yxatdan o'chirish.
 * Hujjatlarda ishlatilmagan bo'lsa butunlay o'chadi; zayavka, zames, sklad harakati,
 * retsept yoki saytdan kelgan so'rovda uchrasa — o'chirilmaydi, arxivga olinadi
 * (`isActive = false`): ro'yxatlarda ko'rinmaydi, eski hujjatlar esa joyida qoladi.
 */
export async function deleteCatalogProduct(id: string): Promise<ActionState> {
  const s = await requireSession([...CATALOG_ROLES]);
  const p = await db.product.findUnique({ where: { id } });
  if (!p) return { error: "Mahsulot topilmadi" };

  const [items, batches, moves, leads, recipes, asIngredient] = await Promise.all([
    db.orderItem.count({ where: { productId: id } }),
    db.productionBatch.count({ where: { productId: id } }),
    db.stockMove.count({ where: { productId: id } }),
    db.lead.count({ where: { productId: id } }),
    db.recipe.count({ where: { productId: id } }),
    // Boshqa mahsulotning retseptiga ingredient bo'lib kirgan bo'lishi mumkin (masalan FBS blok) —
    // shuni hisobga olmasak, o'chirilganda o'sha retsept qatori egasiz (materialId ham, productId ham bo'sh) qolib ketadi
    db.recipeItem.count({ where: { productId: id } }),
  ]);
  const used = items + batches + moves + leads + asIngredient;

  if (used === 0) {
    await db.$transaction(async (tx) => {
      // Retsept faqat shu mahsulotga tegishli — hujjat emas, mahsulot bilan birga ketadi
      const recs = await tx.recipe.findMany({ where: { productId: id }, select: { id: true } });
      if (recs.length) {
        await tx.recipeItem.deleteMany({ where: { recipeId: { in: recs.map((r) => r.id) } } });
        await tx.recipe.deleteMany({ where: { productId: id } });
      }
      await tx.product.delete({ where: { id } });
      await audit(tx, s.userId, "DELETE", "Product", id, p, { recipes: recs.length });
    });
    refresh();
    return { ok: true, note: `«${p.name}» o'chirildi${recipes ? ` (retsepti bilan)` : ""}.` };
  }

  if (!p.isActive) return { error: `«${p.name}» hujjatlarda ishlatilgan (${used} ta) — butunlay o'chirilmaydi, u allaqachon arxivda` };
  await db.$transaction(async (tx) => {
    const after = await tx.product.update({ where: { id }, data: { isActive: false } });
    await audit(tx, s.userId, "UPDATE", "Product", id, p, { ...after, reason: "ro'yxatdan olib tashlandi (arxiv)" });
  });
  refresh();
  return { ok: true, note: `«${p.name}» ${used} ta hujjatda ishlatilgan — o'chirilmadi, ro'yxatdan olib tashlandi (hujjatlar joyida).` };
}

/** Papkani o'chirish — faqat bo'sh papka (ichida papka ham, mahsulot ham bo'lmasa). */
export async function deleteProductGroup(id: string): Promise<ActionState> {
  const s = await requireSession([...CATALOG_ROLES]);
  const g = await db.productGroup.findUnique({ where: { id } });
  if (!g) return { error: "Papka topilmadi" };
  const [children, products] = await Promise.all([
    db.productGroup.count({ where: { parentId: id } }),
    db.product.count({ where: { groupId: id } }),
  ]);
  if (children || products) {
    return { error: `«${g.name}» bo'sh emas: ${products} mahsulot, ${children} papka. Avval ichidagini boshqa papkaga o'tkazing.` };
  }
  await db.$transaction(async (tx) => {
    await tx.productGroup.delete({ where: { id } });
    await audit(tx, s.userId, "DELETE", "ProductGroup", id, g, undefined);
  });
  refresh();
  return { ok: true, note: `«${g.name}» papkasi o'chirildi.` };
}

/** Spravochnik o'zgargach mahsulot ro'yxati ko'rinadigan hamma sahifa yangilanadi. */
function refresh() {
  revalidatePath("/orders/new");
  revalidatePath("/settings");
  revalidatePath("/stock");
  revalidatePath("/stock/products/new");
  revalidatePath("/production/new");
  revalidatePath("/recipes", "layout"); // ro'yxat ham, har mahsulot retsepti ham
}
