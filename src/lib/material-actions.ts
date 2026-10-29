"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireModuleWrite } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { parseForm, zStr, zOpt, type ActionState } from "@/lib/action";
import { codeFromName, flatName } from "@/lib/excel";
import { nextMaterialGroupCode } from "@/lib/material-groups";
import { normalizeUnit, UNIT_FALLBACK } from "@/lib/unit";
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

/** Papkani o'chirish — faqat bo'sh papka (ichida papka ham, xomashyo ham bo'lmasa). */
export async function deleteMaterialGroup(id: string): Promise<ActionState> {
  const s = await requireModuleWrite("stock", MATERIAL_ROLES);
  const g = await db.materialGroup.findUnique({ where: { id } });
  if (!g) return { error: "Papka topilmadi" };
  const [children, materials] = await Promise.all([
    db.materialGroup.count({ where: { parentId: id } }),
    db.material.count({ where: { groupId: id } }),
  ]);
  if (children || materials) {
    return { error: `«${g.name}» bo'sh emas: ${materials} xomashyo, ${children} papka. Avval ichidagini boshqa papkaga o'tkazing.` };
  }
  await db.$transaction(async (tx) => {
    await tx.materialGroup.delete({ where: { id } });
    await audit(tx, s.userId, "DELETE", "MaterialGroup", id, g, undefined);
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
