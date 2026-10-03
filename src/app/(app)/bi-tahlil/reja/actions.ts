"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireAction } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { parseForm, zDec, zOpt, type ActionState } from "@/lib/action";

const schema = z.object({
  year: z.coerce.number().int().min(2020).max(2100), month: z.coerce.number().int().min(1).max(12),
  sellerId: z.string().trim().optional().transform((v) => (v ? v : null)), amount: zDec(0),
  volumeM3: z.coerce.number().min(0).optional().or(z.literal("").transform(() => undefined)), note: zOpt,
});

export async function savePlan(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("bi-tahlil", "plan");
  const r = parseForm(schema, fd);
  if ("error" in r) return { error: r.error };
  const { year, month, sellerId, amount, volumeM3, note } = r.data;
  const where = { year, month, sellerId };
  const data = { amount, volumeM3: volumeM3 ?? null, note };
  // Kompaniya rejasida sellerId = NULL — Postgres unique uni tekshirmaydi, ikki bosishda ikkita reja
  // yozilib, dashboard birinchisini olardi. Qulf ostida topib-yozamiz.
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`plan:${year}:${month}:${sellerId ?? "all"}`}))`;
    const before = await tx.salesPlan.findFirst({ where, orderBy: { createdAt: "asc" } });
    const after = before ? await tx.salesPlan.update({ where: { id: before.id }, data }) : await tx.salesPlan.create({ data: { ...where, ...data } });
    await audit(tx, s.userId, before ? "UPDATE" : "CREATE", "SalesPlan", after.id, before, after);
  });
  revalidatePath("/bi-tahlil/reja"); revalidatePath("/bi-tahlil/agentlar"); revalidatePath("/bi-tahlil");
  return { ok: true };
}

export async function deletePlan(id: string): Promise<void> {
  const s = await requireAction("bi-tahlil", "plan");
  const before = await db.salesPlan.findUnique({ where: { id } });
  if (!before) return;
  await db.salesPlan.delete({ where: { id } });
  await audit(db, s.userId, "DELETE", "SalesPlan", id, before, undefined);
  revalidatePath("/bi-tahlil/reja");
}
