"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireAction } from "@/lib/auth";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { parseForm, zOpt, zStr, type ActionState } from "@/lib/action";
import { categoryNameTaken, createCashCategory, normCat, resetCategoryCache } from "@/lib/fin-report/categories";

/** Kategoriyalar daraxti va loyihalar — buxgalteriya (`moliya.categories`), direktor doim. */
const writer = () => requireAction("moliya", "categories");
const refresh = () => { resetCategoryCache(); for (const p of ["/moliya/kategoriyalar", "/moliya", "/cashflow", "/moliya/kreditlar", "/moliya/asosiy-vositalar"]) revalidatePath(p); };

const FLOWS = ["OPERATING", "FINANCING", "INVESTING"] as const;
const LINES = ["OTHER_INCOME", "MATERIALS", "PRODUCTION", "PAYROLL", "TRANSPORT", "ADMIN", "COMMERCIAL", "TAX", "INTEREST", "PROJECT", "DIVIDEND", "NONE"] as const;
const NEEDS = ["", "PROJECT", "LOAN", "ASSET"] as const;
const PARTS = ["", "PRINCIPAL", "INTEREST"] as const;

const aliasList = (s: string | null) => [...new Set((s ?? "").split(/[,;\n]/).map(normCat).filter(Boolean))].slice(0, 40);

const nameTaken = categoryNameTaken;

const createSchema = z.object({
  name: zStr("Nomi kerak").pipe(z.string().max(80, "Nomi juda uzun")),
  parentId: zOpt,
  type: z.enum(["INCOME", "EXPENSE"]).optional(),
  flow: z.enum(FLOWS).optional(),
  pnlLine: z.enum(LINES).optional(),
  needs: z.enum(NEEDS).optional(),
  loanPart: z.enum(PARTS).optional(),
});

export async function createCategoryAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const s = await writer();
  const r = parseForm(createSchema, fd);
  if ("error" in r) return { error: r.error };
  const d = r.data;
  const res = await createCashCategory({ name: d.name, parentId: d.parentId, type: d.type, flow: d.flow, pnlLine: d.pnlLine, needs: d.needs || null, loanPart: d.loanPart || null }, s.userId);
  if ("error" in res) return { error: res.error };
  refresh();
  return { ok: true };
}

const updateSchema = z.object({
  id: zStr(),
  name: zOpt,
  flow: z.enum(FLOWS).optional(),
  pnlLine: z.enum(LINES).optional(),
  needs: z.enum(NEEDS).optional(),
  loanPart: z.enum(PARTS).optional(),
  aliases: zOpt,
  isActive: z.enum(["1", "0"]).optional(),
});

/**
 * Kategoriyani tahrirlash. Nomi o'zgarsa eski nom alias'ga qo'shiladi — eski kassa yozuvlari shu kategoriyada qoladi.
 * Tizim kategoriyasining nomi va «nima so'raydi» belgisi o'zgarmaydi (kod ularga nom bo'yicha tayanadi).
 * Manbaning oqim turi / PNL qatori o'zgarsa — sub manbalariga ham o'tadi.
 */
export async function updateCategoryAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const s = await writer();
  const r = parseForm(updateSchema, fd);
  if ("error" in r) return { error: r.error };
  const d = r.data;
  const c = await db.cashCategory.findUnique({ where: { id: d.id } });
  if (!c) return { error: "Kategoriya topilmadi" };
  const rename = d.name && d.name !== c.name ? d.name : null;
  if (rename && c.isSystem) return { error: "Tizim kategoriyasining nomini o'zgartirib bo'lmaydi — kerak bo'lsa yangi alias qo'shing" };
  if (rename && (await nameTaken(rename, c.id))) return { error: "Bunday nom (yoki alias) allaqachon bor" };
  const aliases = aliasList(d.aliases);
  if (rename) aliases.push(normCat(c.name));
  const all = await db.cashCategory.findMany({ where: { id: { not: c.id } }, select: { name: true, aliases: true } });
  const clash = aliases.find((a) => all.some((o) => normCat(o.name) === a || o.aliases.includes(a)));
  if (clash) return { error: `«${clash}» boshqa kategoriyada bor` };
  const top = !c.parentId;
  const data = {
    ...(rename ? { name: rename } : {}),
    aliases: [...new Set(aliases)],
    isActive: d.isActive ? d.isActive === "1" : c.isActive,
    ...(top && d.flow ? { flow: d.flow } : {}),
    ...(top && d.pnlLine ? { pnlLine: d.pnlLine } : {}),
    ...(top && !c.isSystem && d.needs !== undefined ? { needs: d.needs || null, loanPart: d.needs === "LOAN" ? d.loanPart || "PRINCIPAL" : null } : {}),
  };
  await db.$transaction(async (tx) => {
    const u = await tx.cashCategory.update({ where: { id: c.id }, data });
    if (top && (d.flow || d.pnlLine)) await tx.cashCategory.updateMany({ where: { parentId: c.id }, data: { flow: u.flow, pnlLine: u.pnlLine } });
    await audit(tx, s.userId, "UPDATE", "CashCategory", c.id, c, u);
  });
  refresh();
  return { ok: true };
}

const aliasSchema = z.object({ id: zStr("Kategoriya tanlanmagan"), alias: zStr() });

/** «Topilmagan nomlar» ro'yxatidan: eski yozuvdagi nomni tanlangan kategoriyaga alias qilib qo'shish. */
export async function addAliasAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const s = await writer();
  const r = parseForm(aliasSchema, fd);
  if ("error" in r) return { error: r.error };
  const a = normCat(r.data.alias);
  if (await nameTaken(a)) return { error: "Bu nom allaqachon biror kategoriyaga bog'langan" };
  const c = await db.cashCategory.findUnique({ where: { id: r.data.id } });
  if (!c) return { error: "Kategoriya topilmadi" };
  await db.$transaction(async (tx) => {
    const u = await tx.cashCategory.update({ where: { id: c.id }, data: { aliases: [...new Set([...c.aliases, a])] } });
    await audit(tx, s.userId, "UPDATE", "CashCategory", c.id, { aliases: c.aliases }, { aliases: u.aliases });
  });
  refresh();
  return { ok: true };
}

const projectSchema = z.object({ name: zStr("Nomi kerak").pipe(z.string().max(80)), note: zOpt });

export async function createProjectAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const s = await writer();
  const r = parseForm(projectSchema, fd);
  if ("error" in r) return { error: r.error };
  try {
    await db.$transaction(async (tx) => {
      const p = await tx.project.create({ data: { name: r.data.name, note: r.data.note, createdById: s.userId } });
      await audit(tx, s.userId, "CREATE", "Project", p.id, undefined, p);
    });
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") return { error: "Bunday loyiha bor" };
    throw e;
  }
  refresh();
  return { ok: true };
}

const toggleSchema = z.object({ id: zStr(), isActive: z.enum(["1", "0"]) });

export async function toggleProjectAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const s = await writer();
  const r = parseForm(toggleSchema, fd);
  if ("error" in r) return { error: r.error };
  const on = r.data.isActive === "1";
  await db.$transaction(async (tx) => {
    const u = await tx.project.updateMany({ where: { id: r.data.id }, data: { isActive: on } });
    if (u.count) await audit(tx, s.userId, "STATUS_CHANGE", "Project", r.data.id, { isActive: !on }, { isActive: on });
  });
  refresh();
  return { ok: true };
}
