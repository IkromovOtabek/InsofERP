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
 * Mahsulot spravochnigi — zayavka ochayotganda "..." tugmasidan ochiladigan tanlagich.
 * Papka va mahsulot shu yerdan qo'shiladi, shuning uchun sotuvchiga ham ruxsat bor
 * (Sozlamalardagi "Beton markalari" avvalgidek faqat direktorda).
 */
const CATALOG_ROLES = ["SALES", "PRODUCTION", "DIRECTOR"] as const;

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

/** Yangi mahsulot — tanlagichdagi "Yangi" tugmasi. Ochiq papka ichiga tushadi. */
export async function createCatalogProduct(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireSession([...CATALOG_ROLES]);
  const r = parseForm(productSchema, fd);
  if ("error" in r) return { error: r.error };
  const d = r.data;
  try {
    await db.$transaction(async (tx) => {
      const p = await tx.product.create({
        data: {
          name: d.name, kind: d.kind, unit: d.unit, price: d.price, groupId: d.groupId, note: d.note,
          code: (d.code ?? (await nextCatalogCode(tx))).toUpperCase(),
        },
      });
      await audit(tx, s.userId, "CREATE", "Product", p.id, undefined, p);
    });
  } catch (e) {
    if (String(e).includes("Unique constraint")) return { error: "Bu kod bilan mahsulot bor" };
    throw e;
  }
  refresh();
  return { ok: true };
}

/* ───────── Excel orqali qo'shish ───────── */

const importSchema = z.object({ groupId: zOpt, rows: z.string() });
type ImportRow = { name?: unknown; code?: unknown; kind?: unknown; unit?: unknown; price?: unknown; note?: unknown };

/** Excel'dan kelgan manfiy bo'lmagan raqam; bo'sh yoki xato bo'lsa `null` (mavjud qiymat o'zgarmaydi). */
const dec = (v: unknown) => { const n = num(v); return Number.isFinite(n) && n >= 0 ? n : null; };

/** Mahsulot birligi: "metir" → "m", "ТН" → "t". Xomashyo birligi (kg, l) mahsulotga to'g'ri kelmaydi — tanilmagan deb olinadi. */
const PRODUCT_UNIT_KEYS: string[] = PRODUCT_UNITS.map(([v]) => v);
const productUnit = (v: unknown) => { const u = normalizeUnit(v); return u && PRODUCT_UNIT_KEYS.includes(u) ? u : null; };

/** "tayyor mahsulot", "ТОВАР" kabi yozuvlarni ro'yxatdagi tovar turiga keltiradi; tanilmasa `null`. */
const productKind = (v: unknown) => { const k = flatName(str(v)); return k ? (PRODUCT_KINDS.find((x) => flatName(x) === k) ?? null) : null; };

/**
 * Mahsulot spravochnigi → Excel orqali qo'shish: bitta fayldan ko'p mahsulot birdan.
 * Har qator: nomi (majburiy), kodi, tovar turi, birligi, narxi, izoh — hammasi ochiq turgan papkaga tushadi.
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
    const [all, groups] = await Promise.all([
      tx.product.findMany({ select: { id: true, code: true, name: true } }),
      tx.productGroup.findMany({ select: { code: true } }),
    ]);
    // Kod ham mahsulot, ham papka bo'ylab yagona bo'lishi kerak
    const codes = new Set([...all, ...groups].map((x) => x.code.toUpperCase()));
    let seq = [...codes].map(Number).filter((n) => Number.isFinite(n)).reduce((a, b) => Math.max(a, b), 0);
    const idOf = new Map<string, string>();
    for (const p of all) { idOf.set(p.code.toUpperCase(), p.id); idOf.set(flatName(p.name), p.id); }

    let created = 0, updated = 0, guessed = 0;
    for (const x of rows) {
      const name = str(x.name);
      const code = str(x.code).toUpperCase();
      const unit = productUnit(x.unit);
      if (!unit && str(x.unit) !== "") guessed++; // birlik tanilmadi — "dona" qo'yiladi
      const price = dec(x.price);
      const kind = productKind(x.kind);
      const note = str(x.note) || null;

      const found = (code ? idOf.get(code) : undefined) ?? idOf.get(flatName(name));
      if (found) {
        const before = await tx.product.findUniqueOrThrow({ where: { id: found } });
        // Faylda bo'sh qolgan katak mavjud qiymatni o'chirmaydi
        const after = await tx.product.update({
          where: { id: found },
          data: { name, isActive: true, ...(unit ? { unit } : {}), ...(price != null ? { price } : {}), ...(kind ? { kind } : {}), ...(note ? { note } : {}), ...(groupId ? { groupId } : {}) },
        });
        await audit(tx, s.userId, "UPDATE", "Product", found, before, after);
        idOf.set(flatName(name), found);
        updated++;
        continue;
      }

      let c = code;
      while (!c || codes.has(c)) { seq++; c = String(seq); }
      codes.add(c);
      const p = await tx.product.create({ data: { code: c, name, unit: unit ?? "dona", price: price ?? 0, kind, note, groupId } });
      idOf.set(c, p.id); idOf.set(flatName(name), p.id);
      await audit(tx, s.userId, "CREATE", "Product", p.id, undefined, p);
      created++;
    }
    return { created, updated, guessed };
  }, { timeout: 120_000, maxWait: 20_000 });

  refresh();
  return {
    ok: true,
    note: `${out.created} ta yangi mahsulot qo'shildi${out.updated ? `, ${out.updated} tasi yangilandi` : ""}.`
      + (out.guessed ? ` ${out.guessed} ta qatorda birlik tanilmadi — "dona" qo'yildi.` : ""),
  };
}

function refresh() {
  revalidatePath("/orders/new");
  revalidatePath("/settings");
  revalidatePath("/stock");
  revalidatePath("/recipes");
}
