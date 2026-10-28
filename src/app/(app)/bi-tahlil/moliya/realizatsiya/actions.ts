"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireAction } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { parseForm, zDec, zStr, type ActionState } from "@/lib/action";

/** Guruh rekord oyi — sotuv rejasi bilan bir mas'ul (`bi-tahlil.plan`: moliya, direktor doim). Hammasi AuditLog'da. */
const schema = z.object({
  group: zStr(),
  qty: z.preprocess((v) => (typeof v === "string" ? v.replace(/[\s\u00a0]/g, "").replace(",", ".") : v), zDec(0)).refine((v) => v > 0, "Rekord hajmi 0 dan katta bo'lsin"),
  ym: z.string().regex(/^\d{4}-\d{2}$/, "Oyni tanlang"),
  workDays: z.coerce.number().int().min(1, "Ish kuni 1–31 oralig'ida bo'lsin").max(31, "Ish kuni 1–31 oralig'ida bo'lsin").optional().or(z.literal("").transform(() => undefined)),
});

export async function saveSalesRecord(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("bi-tahlil", "plan");
  const r = parseForm(schema, fd);
  if ("error" in r) return { error: r.error };
  const { group, qty, ym, workDays } = r.data;
  const [year, month] = ym.split("-").map(Number) as [number, number];
  if (month < 1 || month > 12) return { error: "Oy noto'g'ri" };
  const data = { qty, year, month, workDays: workDays ?? null };
  await db.$transaction(async (tx) => {
    const before = await tx.salesRecord.findUnique({ where: { group } });
    const after = await tx.salesRecord.upsert({ where: { group }, update: data, create: { group, ...data } });
    await audit(tx, s.userId, before ? "UPDATE" : "CREATE", "SalesRecord", after.id, before ?? undefined, after);
  });
  revalidatePath("/bi-tahlil/moliya/realizatsiya");
  return { ok: true };
}

const num = (v: FormDataEntryValue | null) => {
  const t = typeof v === "string" ? v.replace(/[\s ]/g, "").replace(",", ".") : "";
  return t ? Number(t) : null;
};

/**
 * «Reja» bo'limi: oylik reja summasi (zavod rejasi — `SalesPlan`, sellerId = null; faqat summa, hajm va izohga tegilmaydi)
 * va oydagi ish kuni (`WorkMonth`; bo'sh — kalendardan, dam olish va bayramlarsiz). Mas'ul — sotuv rejasi egasi.
 */
export async function saveMonthPlanAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("bi-tahlil", "plan");
  const year = Number(fd.get("year")), month = Number(fd.get("month"));
  if (!Number.isInteger(year) || year < 2020 || year > 2100 || !Number.isInteger(month) || month < 1 || month > 12) return { error: "Oy noto'g'ri" };
  const amount = num(fd.get("amount")), workDays = num(fd.get("workDays"));
  if (amount !== null && (!Number.isFinite(amount) || amount < 0 || amount > 1e15)) return { error: "Reja summasi noto'g'ri" };
  if (workDays !== null && (!Number.isInteger(workDays) || workDays < 1 || workDays > 31)) return { error: "Oydagi ish kuni 1–31 oralig'ida butun son bo'lsin" };
  await db.$transaction(async (tx) => {
    if (amount !== null) {
      // Kompaniya rejasida sellerId = NULL — unique tekshirmaydi; Reja nazorati bilan bir xil qulf ostida topib-yozamiz
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`plan:${year}:${month}:all`}))`;
      const before = await tx.salesPlan.findFirst({ where: { year, month, sellerId: null }, orderBy: { createdAt: "asc" } });
      if (!before || Number(before.amount) !== amount) {
        const after = before ? await tx.salesPlan.update({ where: { id: before.id }, data: { amount } }) : await tx.salesPlan.create({ data: { year, month, sellerId: null, amount } });
        await audit(tx, s.userId, before ? "UPDATE" : "CREATE", "SalesPlan", after.id, before ?? undefined, after);
      }
    }
    const before = await tx.workMonth.findUnique({ where: { year_month: { year, month } } });
    if (workDays === null) {
      if (before) { await tx.workMonth.delete({ where: { id: before.id } }); await audit(tx, s.userId, "DELETE", "WorkMonth", before.id, before, undefined); }
    } else if (before?.workDays !== workDays) {
      const after = await tx.workMonth.upsert({ where: { year_month: { year, month } }, update: { workDays }, create: { year, month, workDays } });
      await audit(tx, s.userId, before ? "UPDATE" : "CREATE", "WorkMonth", after.id, before ?? undefined, after);
    }
  });
  for (const p of ["/bi-tahlil/moliya/realizatsiya", "/bi-tahlil/reja", "/bi-tahlil", "/dashboard", "/settings/ish-tartibi"]) revalidatePath(p);
  return { ok: true };
}
