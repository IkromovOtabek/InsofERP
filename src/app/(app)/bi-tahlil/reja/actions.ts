"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { parseForm, zDec, zOpt, type ActionState } from "@/lib/action";

const schema = z.object({
  year: z.coerce.number().int().min(2020).max(2100), month: z.coerce.number().int().min(1).max(12),
  sellerId: z.string().trim().optional().transform((v) => (v ? v : null)), amount: zDec(0),
  volumeM3: z.coerce.number().min(0).optional().or(z.literal("").transform(() => undefined)), note: zOpt,
});

export async function savePlan(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireSession(["DIRECTOR", "FINANCE"]);
  const r = parseForm(schema, fd);
  if ("error" in r) return { error: r.error };
  const { year, month, sellerId, amount, volumeM3, note } = r.data;
  const where = { year, month, sellerId };
  const before = await db.salesPlan.findFirst({ where });
  const data = { amount, volumeM3: volumeM3 ?? null, note };
  const after = before ? await db.salesPlan.update({ where: { id: before.id }, data }) : await db.salesPlan.create({ data: { ...where, ...data } });
  await audit(db, s.userId, before ? "UPDATE" : "CREATE", "SalesPlan", after.id, before, after);
  revalidatePath("/bi-tahlil/reja"); revalidatePath("/bi-tahlil/agentlar"); revalidatePath("/bi-tahlil");
  return { ok: true };
}

export async function deletePlan(id: string): Promise<void> {
  const s = await requireSession(["DIRECTOR", "FINANCE"]);
  const before = await db.salesPlan.findUnique({ where: { id } });
  if (!before) return;
  await db.salesPlan.delete({ where: { id } });
  await audit(db, s.userId, "DELETE", "SalesPlan", id, before, undefined);
  revalidatePath("/bi-tahlil/reja");
}
