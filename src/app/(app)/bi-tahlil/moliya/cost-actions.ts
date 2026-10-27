"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireAction } from "@/lib/auth";
import { db } from "@/lib/db";
import { Prisma } from "@/generated/prisma";
import { audit } from "@/lib/audit";
import { parseForm, zStr, type ActionState } from "@/lib/action";
import { COEF_GROUPS } from "@/lib/fin-report/cost";
import { isMonthKey } from "@/lib/fin-report/period";
import { resetCategoryCache } from "@/lib/fin-report/categories";

/** Tannarx sozlamalari — buxgalteriya (`moliya.cost`), direktor doim. Hammasi AuditLog'da. */
const writer = () => requireAction("moliya", "cost");
const refresh = () => { for (const p of ["/bi-tahlil/moliya/tannarx", "/bi-tahlil/moliya/mahsulot-foydasi"]) revalidatePath(p); };
const num = (v: FormDataEntryValue | null) => {
  const s = typeof v === "string" ? v.replace(/[\s ]/g, "").replace(",", ".") : "";
  return s ? Number(s) : null;
};

/** Oy sozlamasi: guruh koeffitsiyentlari (`coef:<guruh>`) va ishlab chiqarish stavkasi (`overheadPct`); bo'sh — avtomatik. */
export async function saveCostMonthAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const s = await writer();
  const month = String(fd.get("month") ?? "");
  if (!isMonthKey(month)) return { error: "Oy noto'g'ri" };
  const coefs: Record<string, number> = {};
  for (const g of COEF_GROUPS) {
    const v = num(fd.get(`coef:${g}`));
    if (v === null) continue;
    if (!Number.isFinite(v) || v <= 0 || v > 10) return { error: `«${g}» koeffitsiyenti 0 dan katta, 10 dan kichik bo'lsin` };
    coefs[g] = v;
  }
  const pct = num(fd.get("overheadPct"));
  if (pct !== null && (!Number.isFinite(pct) || pct < 0 || pct > 500)) return { error: "Stavka 0–500% oralig'ida bo'lsin" };
  await db.$transaction(async (tx) => {
    const before = await tx.costMonth.findUnique({ where: { id: month } });
    const data = { coefs: Object.keys(coefs).length ? coefs : Prisma.DbNull, overheadPct: pct, updatedById: s.userId };
    const after = await tx.costMonth.upsert({ where: { id: month }, update: data, create: { id: month, ...data } });
    await audit(tx, s.userId, before ? "UPDATE" : "CREATE", "CostMonth", month, before ?? undefined, after);
  });
  refresh();
  return { ok: true };
}

const wageSchema = z.object({ groupId: zStr(), pieceRate: z.string().trim().optional() });

/** Mahsulot papkasining brigada ish haqi (1 dona); bo'sh — yo'q (mahsulotning o'z «sdelka» narxi bo'lsa — o'sha). */
export async function saveGroupWageAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const s = await writer();
  const r = parseForm(wageSchema, fd);
  if ("error" in r) return { error: r.error };
  const v = num(r.data.pieceRate ?? "");
  if (v !== null && (!Number.isFinite(v) || v < 0)) return { error: "Ish haqi musbat son bo'lsin" };
  const g = await db.productGroup.findUnique({ where: { id: r.data.groupId }, select: { id: true, pieceRate: true } });
  if (!g) return { error: "Papka topilmadi" };
  await db.$transaction(async (tx) => {
    await tx.productGroup.update({ where: { id: g.id }, data: { pieceRate: v } });
    await audit(tx, s.userId, "UPDATE", "ProductGroup", g.id, { pieceRate: g.pieceRate }, { pieceRate: v });
  });
  refresh();
  return { ok: true };
}

/** Kassa kategoriyasi «Tannarxga kiradi» belgisi (ishlab chiqarish xarajati). */
export async function toggleCostCategoryAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const s = await writer();
  const id = String(fd.get("id") ?? "");
  const c = await db.cashCategory.findUnique({ where: { id }, select: { id: true, inCost: true, type: true } });
  if (!c || c.type !== "EXPENSE") return { error: "Chiqim kategoriyasi topilmadi" };
  const n = await db.$transaction(async (tx) => {
    const u = await tx.cashCategory.updateMany({ where: { id: c.id, inCost: c.inCost }, data: { inCost: !c.inCost } });
    if (u.count) await audit(tx, s.userId, "UPDATE", "CashCategory", c.id, { inCost: c.inCost }, { inCost: !c.inCost });
    return u.count;
  });
  if (!n) return { error: "Kategoriya boshqa joyda o'zgardi — sahifani yangilang" };
  resetCategoryCache();
  refresh();
  return { ok: true };
}
