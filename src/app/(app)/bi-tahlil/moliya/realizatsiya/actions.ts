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
