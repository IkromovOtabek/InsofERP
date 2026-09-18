"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { parseForm, zDec, zOpt, zStr, type ActionState } from "@/lib/action";

const optInt = z.coerce.number().int().min(0).optional().or(z.literal("").transform(() => undefined));
const optDec = z.coerce.number().min(0).optional().or(z.literal("").transform(() => undefined));
const schema = z.object({
  year: z.coerce.number().int().min(2020).max(2100), month: z.coerce.number().int().min(1).max(12),
  kind: z.enum(["BUDGET", "PLAN", "FACT"]), channel: zStr("Kanal kerak"), amount: zDec(0),
  leads: optInt, customers: optInt, revenue: optDec, impressions: optInt, clicks: optInt, note: zOpt,
});

function refresh() { for (const p of ["/bi-tahlil/marketing", "/bi-tahlil/marketing/reja", "/bi-tahlil/marketing/malumotlar", "/bi-tahlil/ai"]) revalidatePath(p); }

export async function saveEntry(id: string | null, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireSession(["DIRECTOR", "FINANCE", "ACCOUNTING"]);
  const r = parseForm(schema, fd);
  if ("error" in r) return { error: r.error };
  const d = r.data;
  const data = { year: d.year, month: d.month, kind: d.kind, channel: d.channel, amount: d.amount, leads: d.leads ?? null, customers: d.customers ?? null, revenue: d.revenue ?? null, impressions: d.impressions ?? null, clicks: d.clicks ?? null, note: d.note };
  if (id) {
    const before = await db.marketingEntry.findUnique({ where: { id } });
    const after = await db.marketingEntry.update({ where: { id }, data });
    await audit(db, s.userId, "UPDATE", "MarketingEntry", id, before, after);
  } else {
    const after = await db.marketingEntry.create({ data: { ...data, createdById: s.userId } });
    await audit(db, s.userId, "CREATE", "MarketingEntry", after.id, undefined, after);
  }
  refresh();
  return { ok: true };
}

export async function deleteEntry(id: string): Promise<void> {
  const s = await requireSession(["DIRECTOR", "FINANCE", "ACCOUNTING"]);
  const before = await db.marketingEntry.findUnique({ where: { id } });
  if (!before) return;
  await db.marketingEntry.delete({ where: { id } });
  await audit(db, s.userId, "DELETE", "MarketingEntry", id, before, undefined);
  refresh();
}
