"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireModuleWrite } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { parseForm, zDec, zStr, zOpt, type ActionState } from "@/lib/action";
import { codeFromName, flatName } from "@/lib/excel";
import { nextMaterialGroupCode } from "@/lib/material-groups";
import { normalizeUnit, unitLabel, UNIT_FALLBACK } from "@/lib/unit";
import { MATERIAL_CATALOG_ROLES } from "@/lib/catalog";
import type { MaterialCategory, Prisma } from "@/generated/prisma";
import { MATERIAL_CATEGORIES, MATERIAL_CATEGORY_LABEL } from "@/lib/material-category";
import { notifyNewAvtoParts } from "@/lib/avto-parts";
// Bitta xomashyoni o'chirish qoidasi — `lib/material-remove.ts` (mobil ilova ham shundan chaqiradi)
import { removeMaterial } from "@/lib/material-remove";

/**
 * Xomashyo spravochnigi — Sklad, ta'minot va retseptlarda "..." tugmasidan ochiladigan
 * ro'yxat oynasi (mahsulot spravochnigining aynan o'zi, faqat xomashyo uchun).
 * Papka va xomashyo shu oynadan qo'shiladi.
 */
const MATERIAL_ROLES = MATERIAL_CATALOG_ROLES;

/** Xomashyo kodi nomdan yasaladi; band bo'lsa oxiriga raqam qo'shiladi. */
async function freeCode(tx: Prisma.TransactionClient, want: string, name: string): Promise<string> {
  const base = (want || codeFromName(name)).toUpperCase();
  let code = base;
  for (let n = 2; await tx.material.findUnique({ where: { code } }); n++) code = `${base.slice(0, 13)}-${n}`;
  return code;
}

const groupSchema = z.object({ name: zStr("Papka nomi kerak"), parentId: zOpt, code: zOpt });

/** Yangi xomashyo papkasi. `parentId` — ochiq turgan papka. */
export async function createMaterialGroup(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireModuleWrite("stock", MATERIAL_ROLES);
  const r = parseForm(groupSchema, fd);
  if ("error" in r) return { error: r.error };
  const d = r.data;
  try {
    await db.$transaction(async (tx) => {
      const g = await tx.materialGroup.create({ data: { name: d.name, parentId: d.parentId, code: d.code ?? (await nextMaterialGroupCode(tx)) } });
      await audit(tx, s.userId, "CREATE", "MaterialGroup", g.id, undefined, g);
    });
  } catch (e) {
    if (String(e).includes("Unique constraint")) return { error: "Bu kod band" };
    throw e;
  }
  refresh();
  return { ok: true };
}

const materialSchema = z.object({
  name: zStr("Xomashyo nomi kerak"),
  code: zOpt,
  unit: zStr("O'lchov birligi kerak"),
  minStock: z.coerce.number().min(0, "manfiy bo'lmasin").default(0),
  groupId: zOpt,
  category: z.enum(MATERIAL_CATEGORIES).default("XOMASHYO"),
});

/**
 * Yangi xomashyo — oynadagi "Yangi" tugmasi. Ochiq papka ichiga tushadi.
 * Shu nomli xomashyo bo'lsa dublikat ochilmaydi: mavjudi yangilanadi (papkasi va minimal qoldiq).
 */
export async function createCatalogMaterial(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireModuleWrite("stock", MATERIAL_ROLES);
  const r = parseForm(materialSchema, fd);
  if ("error" in r) return { error: r.error };
  const d = r.data;
  const unit = normalizeUnit(d.unit) ?? UNIT_FALLBACK;
  let merged = false;
  // Avto zapchast bo'lib qo'shilgan (yoki shu kategoriyaga o'tgan) karta — mexaniklarga xabar
  let avtoId: string | null = null;
  await db.$transaction(async (tx) => {
    const all = await tx.material.findMany({ select: { id: true, code: true, name: true } });
    const found = all.find((m) => flatName(m.name) === flatName(d.name))
      ?? (d.code ? all.find((m) => m.code.toUpperCase() === d.code!.toUpperCase()) : undefined);
    if (found) {
      const before = await tx.material.findUniqueOrThrow({ where: { id: found.id } });
      const after = await tx.material.update({
        where: { id: found.id },
        data: { name: d.name, isActive: true, minStock: d.minStock, category: d.category, ...(d.groupId ? { groupId: d.groupId } : {}) },
      });
      await audit(tx, s.userId, "UPDATE", "Material", found.id, before, after);
      if (d.category === "AVTO_ZAPCHAST" && before.category !== "AVTO_ZAPCHAST") avtoId = found.id;
      merged = true;
      return;
    }
    const m = await tx.material.create({
      data: { code: await freeCode(tx, d.code ?? "", d.name), name: d.name, unit, minStock: d.minStock, groupId: d.groupId, category: d.category },
    });
    await audit(tx, s.userId, "CREATE", "Material", m.id, undefined, m);
    if (d.category === "AVTO_ZAPCHAST") avtoId = m.id;
  });
  if (avtoId) notifyNewAvtoParts([avtoId], s.userId);
  refresh();
  return merged
    ? { ok: true, note: `«${d.name}» ro'yxatda bor edi — yangisi ochilmadi, mavjudi yangilandi.` }
    : { ok: true };
}

/* ───────── Tahrirlash va arxivdan tiklash ───────── */

const editSchema = z.object({
  name: zStr("Xomashyo nomi kerak").pipe(z.string().max(200, "Nom juda uzun")),
  unit: zOpt,
  minStock: zDec(0).optional(),
  groupId: zOpt,
});

/**
 * Xomashyo kartasini tuzatish (nomi, birligi, minimal qoldig'i, papkasi) — Sklad → Qoldiqlar qatoridagi va spravochnik
 * oynasidagi qalam. Sozlamalardagi forma faqat direktorda: sklad xodimi xato yozilgan nomni shu yerda tuzatadi.
 * Formada bo'lmagan maydon o'zgarmaydi (`fd.has`): tanlagich minimal qoldiq yoki papkani bilmasa — ular tegilmaydi.
 * Nom ro'yxatda yagona (`flatName`, arxivdagilar ham): bir xil nom bo'lsa rad etiladi — dublikat ochilmasin.
 * Birlik faqat sklad harakati ham, retsept qatori ham yo'q bo'lsa o'zgaradi (Sozlamalardagi qoida): aks holda tarix
 * va normalar boshqa birlikda o'qilib ketadi (kg → t: 1000 barobar). Hujjatlar xomashyoga id bilan bog'langan —
 * yangi nom eski kirim, chiqim va hisobotlarda ham ko'rinadi.
 */
export async function updateCatalogMaterial(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireModuleWrite("stock", MATERIAL_ROLES);
  const r = parseForm(editSchema, fd);
  if ("error" in r) return { error: r.error, field: r.field };
  const d = r.data;
  const name = d.name.replace(/\s+/g, " ");
  const unit = fd.has("unit") ? normalizeUnit(d.unit) : undefined;
  if (unit === null) return { error: "O'lchov birligi ro'yxatda yo'q", field: "unit" };
  const res = await db.$transaction(async (tx): Promise<ActionState> => {
    // FOR UPDATE: birlik tekshiruvi bilan saqlash orasida shu xomashyoga harakat yoki retsept qatori qo'shilib qolmasin
    const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Material" WHERE id = ${id} FOR UPDATE`;
    if (!locked.length) return { error: "Xomashyo topilmadi" };
    const before = await tx.material.findUniqueOrThrow({ where: { id } });
    const data: Prisma.MaterialUncheckedUpdateInput = {};
    if (before.name !== name) {
      const flat = flatName(name);
      const same = flat ? (await tx.material.findMany({ where: { id: { not: id } }, select: { name: true, isActive: true } })).find((m) => flatName(m.name) === flat) : undefined;
      if (same) return { error: `«${same.name}» ro'yxatda bor${same.isActive ? "" : " (arxivda)"} — ikkinchi bir xil nom ochilmaydi`, field: "name" };
      data.name = name;
    }
    if (unit && unit !== before.unit) {
      const [moves, recipes] = await Promise.all([
        tx.stockMove.count({ where: { materialId: id } }),
        tx.recipeItem.count({ where: { materialId: id } }),
      ]);
      if (moves || recipes) {
        return { error: `Birlikni o'zgartirib bo'lmaydi: ${moves} ta sklad harakati va ${recipes} ta retsept qatori «${unitLabel(before.unit)}» da. Yangi birlik bilan alohida xomashyo oching`, field: "unit" };
      }
      data.unit = unit;
    }
    if (fd.has("minStock") && d.minStock !== undefined && Number(before.minStock) !== d.minStock) data.minStock = d.minStock;
    if (fd.has("groupId") && d.groupId !== before.groupId) {
      if (d.groupId && !(await tx.materialGroup.findUnique({ where: { id: d.groupId }, select: { id: true } }))) return { error: "Papka topilmadi — sahifani yangilang", field: "groupId" };
      data.groupId = d.groupId;
    }
    if (Object.keys(data).length === 0) return { ok: true, note: "O'zgarish yo'q" };
    const after = await tx.material.update({ where: { id }, data });
    await audit(tx, s.userId, "UPDATE", "Material", id, before, { ...after, by: "edit" });
    return { ok: true, note: data.name ? `Nomi o'zgardi: «${before.name}» → «${after.name}»` : `«${after.name}» saqlandi` };
  });
  if (res?.ok && res.note !== "O'zgarish yo'q") refresh();
  return res;
}

/**
 * Arxivdagi xomashyoni ro'yxatga qaytarish — Sklad → Qoldiqlar jadvalidagi «arxiv» qatorining «Tiklash» tugmasi.
 * Shu nomli faol xomashyo bo'lsa qaytarilmaydi (ro'yxatda ikkita bir xil nom bo'lib qolmasin).
 */
export async function restoreCatalogMaterial(id: string): Promise<ActionState> {
  const s = await requireModuleWrite("stock", MATERIAL_ROLES);
  const res = await db.$transaction(async (tx): Promise<ActionState> => {
    const m = await tx.material.findUnique({ where: { id }, select: { id: true, name: true, isActive: true } });
    if (!m) return { error: "Xomashyo topilmadi" };
    if (m.isActive) return { error: `«${m.name}» arxivda emas — sahifani yangilang` };
    const flat = flatName(m.name);
    const twin = flat ? (await tx.material.findMany({ where: { isActive: true, id: { not: id } }, select: { name: true } })).find((x) => flatName(x.name) === flat) : undefined;
    if (twin) return { error: `Ro'yxatda «${twin.name}» bor — ikkita bir xil nom bo'lmasin. Avval shu xomashyo nomini o'zgartiring` };
    // Shartli yangilash: parallel bosishda ikkinchisi «arxivda emas» deb to'xtaydi
    const u = await tx.material.updateMany({ where: { id, isActive: false }, data: { isActive: true } });
    if (u.count !== 1) return { error: `«${m.name}» arxivda emas — sahifani yangilang` };
    await audit(tx, s.userId, "UPDATE", "Material", id, { isActive: false }, { isActive: true, reason: "arxivdan tiklandi" });
    return { ok: true, note: `«${m.name}» ro'yxatga qaytarildi` };
  });
  if (res?.ok) refresh();
  return res;
}

const groupRenameSchema = z.object({ name: zStr("Papka nomi kerak").pipe(z.string().max(120, "Nom juda uzun")) });

/** Papka nomini tuzatish — spravochnik oynasidagi papka qatorining qalami. Bitta papka ichida bir xil nomli ikki papka bo'lmaydi. */
export async function renameMaterialGroup(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireModuleWrite("stock", MATERIAL_ROLES);
  const r = parseForm(groupRenameSchema, fd);
  if ("error" in r) return { error: r.error, field: r.field };
  const name = r.data.name.replace(/\s+/g, " ");
  const res = await db.$transaction(async (tx): Promise<ActionState> => {
    const g = await tx.materialGroup.findUnique({ where: { id } });
    if (!g) return { error: "Papka topilmadi" };
    if (g.name === name) return { ok: true, note: "O'zgarish yo'q" };
    const flat = flatName(name);
    const twin = flat ? (await tx.materialGroup.findMany({ where: { parentId: g.parentId, id: { not: id } }, select: { name: true } })).find((x) => flatName(x.name) === flat) : undefined;
    if (twin) return { error: `Shu joyda «${twin.name}» papkasi bor — boshqa nom yozing`, field: "name" };
    await tx.materialGroup.update({ where: { id }, data: { name } });
    await audit(tx, s.userId, "UPDATE", "MaterialGroup", id, { name: g.name }, { name });
    return { ok: true, note: `Papka nomi o'zgardi: «${g.name}» → «${name}»` };
  });
  if (res?.ok && res.note !== "O'zgarish yo'q") refresh();
  return res;
}

/* ───────── Ro'yxatdan o'chirish ───────── */

/** Bitta xomashyoni o'chirish — Sozlamalar, spravochnik oynalari (`DeleteButton`). Qoida — `removeMaterial`. */
export async function deleteCatalogMaterial(id: string): Promise<ActionState> {
  const s = await requireModuleWrite("stock", MATERIAL_ROLES);
  const r = await removeMaterial(id, { userId: s.userId, role: s.role });
  if (r.kind === "missing") return { error: "Xomashyo topilmadi" };
  refresh();
  if (r.kind === "deleted") return { ok: true, note: `«${r.name}» o'chirildi${r.opening ? " (boshlang'ich qoldig'i bilan)" : ""}.` };
  if (r.kind === "kept") return { error: `«${r.name}» o'chirilmadi: ${r.why}` };
  return { ok: true, note: `«${r.name}» o'chirilmadi — ${r.why}. Ro'yxatdan olib tashlandi (hujjatlar joyida).` };
}

const categorySchema = z.object({ category: z.enum(MATERIAL_CATEGORIES, { message: "Kategoriyani tanlang" }) });

/**
 * Belgilangan xomashyolarni boshqa kategoriyaga o'tkazish — Sklad → Qoldiqlar jadvalidagi belgilar.
 * Avto zapchastga o'tganlari mexaniklarga «yangi avto zapchast» bo'lib boradi (bitta xabar).
 */
export async function setMaterialsCategory(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireModuleWrite("stock", MATERIAL_ROLES);
  const ids = idsSchema.safeParse([...new Set(fd.getAll("ids").map(String))]);
  if (!ids.success) return { error: ids.error.issues[0]?.message ?? "Xomashyo belgilanmagan" };
  const c = categorySchema.safeParse({ category: fd.get("category") || undefined });
  if (!c.success) return { error: c.error.issues[0]?.message ?? "Kategoriyani tanlang" };
  const category: MaterialCategory = c.data.category;
  const moved = await db.$transaction(async (tx) => {
    const before = await tx.material.findMany({ where: { id: { in: ids.data }, category: { not: category } }, select: { id: true, name: true, category: true } });
    if (before.length === 0) return [];
    await tx.material.updateMany({ where: { id: { in: before.map((m) => m.id) } }, data: { category } });
    await audit(tx, s.userId, "UPDATE", "Material", before[0].id, { bulk: before.map((m) => ({ id: m.id, category: m.category })) }, { bulk: before.length, category });
    return before.map((m) => m.id);
  });
  if (category === "AVTO_ZAPCHAST") notifyNewAvtoParts(moved, s.userId);
  refresh();
  const same = ids.data.length - moved.length;
  return { ok: true, note: `${moved.length} ta xomashyo «${MATERIAL_CATEGORY_LABEL[category]}» kategoriyasiga o'tkazildi${same ? ` (${same} tasi allaqachon shu kategoriyada edi)` : ""}.` };
}

const idsSchema = z.array(z.string().min(1).max(64)).min(1, "Xomashyo belgilanmagan").max(2000, "Bir martada ko'pi bilan 2000 ta");

/**
 * Belgilangan xomashyolarni birdan o'chirish — Sklad → Xomashyo qoldig'i jadvali. Har xomashyo alohida
 * tranzaksiyada `removeMaterial` qoidasi bilan: o'chirilmaydiganlari arxivga olinadi va nega ekani aytiladi.
 */
export async function deleteMaterials(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireModuleWrite("stock", MATERIAL_ROLES);
  const r = idsSchema.safeParse([...new Set(fd.getAll("ids").map(String))]);
  if (!r.success) return { error: r.error.issues[0]?.message ?? "Xomashyo belgilanmagan" };
  const deleted: string[] = [], archived: string[] = [], kept: string[] = [];
  let withOpening = 0, missing = 0;
  let failed = 0;
  for (const id of r.data) {
    // Bittasi xato bersa (masalan, parallel hujjat bilan FK to'qnashuvi) — qolganlari davom etadi
    const x = await removeMaterial(id, { userId: s.userId, role: s.role }).catch((e) => { console.error("[material] o'chirish", id, e); return null; });
    if (!x) failed++;
    else if (x.kind === "deleted") { deleted.push(x.name); if (x.opening) withOpening++; }
    else if (x.kind === "archived") archived.push(`${x.name} — ${x.why}`);
    else if (x.kind === "kept") kept.push(`${x.name} — ${x.why}`);
    else missing++;
  }
  refresh();
  const list = (a: string[]) => a.slice(0, 5).join("; ") + (a.length > 5 ? ` va yana ${a.length - 5} ta` : "");
  const parts = [
    deleted.length ? `${deleted.length} ta xomashyo o'chirildi${withOpening ? ` (${withOpening} tasi boshlang'ich qoldig'i bilan)` : ""}.` : "",
    archived.length ? `${archived.length} tasi o'chirilmadi, ro'yxatdan olib tashlandi: ${list(archived)}.` : "",
    kept.length ? `${kept.length} tasi o'zgarmadi: ${list(kept)}.` : "",
    missing ? `${missing} tasi topilmadi (allaqachon o'chirilgan).` : "",
    failed ? `${failed} tasida xato — qayta urinib ko'ring.` : "",
  ].filter(Boolean);
  if (!deleted.length && !archived.length) return { error: parts.join(" ") || "Hech narsa o'chirilmadi" };
  return { ok: true, note: parts.join(" ") };
}

/**
 * Papkani o'chirish — faqat bo'sh papka (ichida papka ham, faol xomashyo ham bo'lmasa). Ichida faqat arxivdagi
 * xomashyo qolgan bo'lsa (ro'yxatda ko'rinmaydi, foydalanuvchi ularni ko'chira olmaydi) — ular yuqori papkaga o'tadi.
 */
export async function deleteMaterialGroup(id: string): Promise<ActionState> {
  const s = await requireModuleWrite("stock", MATERIAL_ROLES);
  const g = await db.materialGroup.findUnique({ where: { id } });
  if (!g) return { error: "Papka topilmadi" };
  const [children, materials, archived] = await Promise.all([
    db.materialGroup.count({ where: { parentId: id } }),
    db.material.count({ where: { groupId: id, isActive: true } }),
    db.material.findMany({ where: { groupId: id, isActive: false }, select: { id: true } }),
  ]);
  if (children || materials) {
    return { error: `«${g.name}» bo'sh emas: ${materials} xomashyo, ${children} papka. Xomashyoni qatoridagi qalam (Tahrirlash → Papka) bilan boshqa papkaga o'tkazing yoki o'chiring, ichki papkalarni ham avval bo'shatib o'chiring.` };
  }
  await db.$transaction(async (tx) => {
    if (archived.length) await tx.material.updateMany({ where: { id: { in: archived.map((m) => m.id) }, groupId: id }, data: { groupId: g.parentId } });
    await tx.materialGroup.delete({ where: { id } });
    await audit(tx, s.userId, "DELETE", "MaterialGroup", id, g, archived.length ? { archivedMovedTo: g.parentId, materials: archived.map((m) => m.id) } : undefined);
  });
  refresh();
  return { ok: true, note: `«${g.name}» papkasi o'chirildi.` };
}

/** Xomashyo ro'yxati ko'rinadigan sahifalar. */
function refresh() {
  revalidatePath("/stock");
  revalidatePath("/stock/materials/new");
  revalidatePath("/stock/supply/new");
  revalidatePath("/receipts/new");
  revalidatePath("/recipes", "layout"); // ro'yxat ham, har mahsulot retsepti ham (ingredient tanlagich)
  revalidatePath("/settings");
}
