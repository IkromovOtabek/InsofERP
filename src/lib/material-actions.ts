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
import type { Prisma, Role } from "@/generated/prisma";
import { lockStock, STOCK_EPS } from "@/lib/stock-lock";
import { fmtNum } from "@/lib/format";

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
  await db.$transaction(async (tx) => {
    const all = await tx.material.findMany({ select: { id: true, code: true, name: true } });
    const found = all.find((m) => flatName(m.name) === flatName(d.name))
      ?? (d.code ? all.find((m) => m.code.toUpperCase() === d.code!.toUpperCase()) : undefined);
    if (found) {
      const before = await tx.material.findUniqueOrThrow({ where: { id: found.id } });
      const after = await tx.material.update({
        where: { id: found.id },
        data: { name: d.name, isActive: true, minStock: d.minStock, ...(d.groupId ? { groupId: d.groupId } : {}) },
      });
      await audit(tx, s.userId, "UPDATE", "Material", found.id, before, after);
      merged = true;
      return;
    }
    const m = await tx.material.create({
      data: { code: await freeCode(tx, d.code ?? "", d.name), name: d.name, unit, minStock: d.minStock, groupId: d.groupId },
    });
    await audit(tx, s.userId, "CREATE", "Material", m.id, undefined, m);
  });
  refresh();
  return merged
    ? { ok: true, note: `«${d.name}» ro'yxatda bor edi — yangisi ochilmadi, mavjudi yangilandi.` }
    : { ok: true };
}


/* ───────── Ro'yxatdan o'chirish ───────── */

type Actor = { userId: string; role: Role };
type RemoveOutcome =
  | { kind: "deleted"; name: string; opening: number }
  | { kind: "archived"; name: string; why: string }
  | { kind: "kept"; name: string; why: string }
  | { kind: "missing" };

/**
 * Bitta xomashyoni o'chirish qoidasi (bitta tugma ham, belgilanganlarni birdan o'chirish ham shu yerdan):
 *  1. Hech qayerda ishlatilmagan — butunlay o'chiriladi.
 *  2. Faqat «Sklad → Xomashyo qo'shish» dagi boshlang'ich qoldig'i bor (StockMove ADJUSTMENT, refType "StockIn"),
 *     boshqa hech bir hujjatda (retsept, kirim, ta'minot, brigada, sarf/zames va boshqa sklad harakati) yo'q —
 *     xato kiritilgan xomashyo: boshlang'ich qoldig'i bilan birga butunlay o'chiriladi (AuditLog'da to'liq nusxasi).
 *     Shartlar: o'chiruvchi — direktor yoki o'sha qoldiqni kiritgan xodimning o'zi (sklad qoldig'i hujjatsiz
 *     yo'qolmasin); qo'shish summasi Kirim-Chiqimga chiqim bo'lib yozilmagan (pul yozuvi buzilmasin).
 *  3. Hujjatlarda ishlatilgan — o'chirilmaydi, arxivga olinadi (`isActive = false`): ro'yxatlarda ko'rinmaydi,
 *     eski hujjatlar buzilmaydi. Lekin skladda qoldig'i bor xomashyo arxivga ham olinmaydi: aks holda bor tovar
 *     qoldiq jadvali va dashborddan jimgina yo'qolardi («Hammasini belgilash» bilan — butun sklad). Avval
 *     Inventarizatsiya yoki Hisobdan chiqarish bilan qoldiqni 0 qilish kerak.
 * Sklad qulfi va xomashyo qatori qulfi ostida: shu payt sarf, import, retsept yoki ta'minot qatori qo'shilib
 * qolmasin (StockMove/RecipeItem/SupplyRequestItem FK'si ON DELETE SET NULL — poygada jimgina bo'shab qolardi).
 */
async function removeMaterial(id: string, actor: Actor): Promise<RemoveOutcome> {
  return db.$transaction(async (tx) => {
    await lockStock(tx);
    // FOR UPDATE: parallel FK yozuvi (import, retsept, ta'minot) shu tranzaksiya tugaguncha kutadi
    const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Material" WHERE id = ${id} FOR UPDATE`;
    if (!locked.length) return { kind: "missing" as const };
    const m = await tx.material.findUnique({ where: { id } });
    if (!m) return { kind: "missing" as const };
    const recipeItems = await tx.recipeItem.count({ where: { materialId: id } });
    const receipts = await tx.goodsReceiptItem.count({ where: { materialId: id } });
    const supply = await tx.supplyRequestItem.count({ where: { materialId: id } });
    const brigade = await tx.brigadeMove.count({ where: { materialId: id } });
    const moves = await tx.stockMove.findMany({ where: { materialId: id }, select: { id: true, type: true, refType: true, refId: true, qty: true, unitCost: true, warehouseId: true, createdById: true, date: true } });
    const opening = moves.filter((x) => x.refType === "StockIn" && x.type === "ADJUSTMENT");
    const otherMoves = moves.length - opening.length;
    const used = recipeItems + receipts + supply + brigade + otherMoves;

    const balance = moves.reduce((a, x) => a + Number(x.qty), 0);
    const archive = async (why: string) => {
      if (Math.abs(balance) > STOCK_EPS) {
        return { kind: "kept" as const, name: m.name, why: `${why}; skladda qoldig'i bor (${fmtNum(balance, 3)} ${m.unit}) — avval Inventarizatsiya yoki Hisobdan chiqarish bilan qoldiqni 0 qiling` };
      }
      if (!m.isActive) return { kind: "kept" as const, name: m.name, why: `${why}; allaqachon arxivda` };
      const after = await tx.material.update({ where: { id }, data: { isActive: false } });
      await audit(tx, actor.userId, "UPDATE", "Material", id, m, { ...after, reason: `ro'yxatdan olib tashlandi (arxiv): ${why}` });
      return { kind: "archived" as const, name: m.name, why };
    };

    if (used > 0) {
      const parts = [
        recipeItems && `retseptda ${recipeItems}`, receipts && `kirimda ${receipts}`, supply && `ta'minotda ${supply}`,
        brigade && `brigada harakatida ${brigade}`, otherMoves && `sklad harakatida ${otherMoves}`,
      ].filter(Boolean);
      return archive(`hujjatlarda ishlatilgan (${parts.join(", ")})`);
    }
    if (opening.length) {
      if (actor.role !== "DIRECTOR" && opening.some((x) => x.createdById !== actor.userId)) {
        return archive("boshlang'ich qoldig'ini boshqa xodim kiritgan — qoldiq bilan butunlay o'chirishni direktor yoki kiritgan xodim qiladi");
      }
      const batches = [...new Set(opening.map((x) => x.refId).filter((x): x is string => !!x))];
      const paid = batches.length ? await tx.cashTransaction.count({ where: { refType: "StockIn", refId: { in: batches } } }) : 0;
      if (paid) return archive("qo'shish summasi Kirim-Chiqimga chiqim bo'lib yozilgan — pul yozuvi buzilmasin");
      await tx.stockMove.deleteMany({ where: { id: { in: opening.map((x) => x.id) } } });
    }
    await tx.material.delete({ where: { id } });
    await audit(tx, actor.userId, "DELETE", "Material", id, { ...m, openingMoves: opening }, undefined);
    return { kind: "deleted" as const, name: m.name, opening: opening.length };
  });
}

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
