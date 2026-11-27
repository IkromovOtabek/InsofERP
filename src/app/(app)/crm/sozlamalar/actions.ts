"use server";

import { randomBytes } from "node:crypto";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireAction } from "@/lib/auth";
import { parseForm, zStr, type ActionState } from "@/lib/action";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";

/** CRM sozlamalari (CRM_SPEC 3.5, 4.4, 4.5) — faqat menejer (crm.manage). Yozuvlar o'chirilmaydi, nofaol qilinadi. */

const KINDS = ["SOURCE", "CLIENT_TYPE", "PRODUCT", "CHANNEL"] as const;
const on = z.string().optional().transform((v) => v === "on" || v === "1");
const zInt = (min: number, max: number, msg: string) => z.coerce.number({ message: msg }).int(msg).min(min, msg).max(max, msg);

const optionSchema = z.object({
  kind: z.enum(KINDS),
  label: zStr("Nomini yozing").pipe(z.string().max(120, "Nom juda uzun")),
  sort: zInt(0, 9999, "Tartib 0–9999").default(0),
  isActive: on,
});

export async function saveOption(id: string | null, _p: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("crm", "manage");
  const r = parseForm(optionSchema, fd);
  if ("error" in r) return { error: r.error };
  const d = r.data;
  const same = await db.crmOption.findFirst({ where: { kind: d.kind, label: { equals: d.label, mode: "insensitive" }, ...(id ? { id: { not: id } } : {}) } });
  if (same) return { error: `«${d.label}» ro'yxatda bor` };
  if (id) {
    const before = await db.crmOption.findUnique({ where: { id } });
    if (!before || before.kind !== d.kind) return { error: "Topilmadi" };
    const after = await db.crmOption.update({ where: { id }, data: { label: d.label, sort: d.sort, isActive: d.isActive } });
    await audit(db, s.userId, "UPDATE", "CrmOption", id, before, after);
  } else {
    const row = await db.crmOption.create({ data: { kind: d.kind, label: d.label, sort: d.sort, isActive: true, code: `u_${randomBytes(4).toString("hex")}` } });
    await audit(db, s.userId, "CREATE", "CrmOption", row.id, undefined, row);
  }
  revalidatePath("/crm", "layout");
  return { ok: true, note: "Saqlandi" };
}

const resultSchema = z.object({
  label: zStr("Nomini yozing").pipe(z.string().max(120, "Nom juda uzun")),
  stage: zInt(1, 6, "Bosqich 1–6"),
  group: z.enum(["CONTINUE", "WAITING", "REFUSAL", "NO_ANSWER", "LOSS", "WIN"], { message: "Guruhni tanlang" }),
  nextRule: z.enum(["REQUIRED", "OPTIONAL", "NONE"], { message: "Sana qoidasini tanlang" }),
  defaultDays: z.string().optional().transform((v) => (v && v.trim() ? Number(v) : null)).pipe(z.number().int().min(0).max(365).nullable()),
  sort: zInt(0, 9999, "Tartib 0–9999").default(0),
  isActive: on,
});

export async function saveResult(id: string | null, _p: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("crm", "manage");
  const r = parseForm(resultSchema, fd);
  if ("error" in r) return { error: r.error };
  const d = r.data;
  if (d.group === "WIN" && d.stage !== 6) return { error: "«Yutuq» guruhi faqat 6-bosqich" };
  const same = await db.crmResult.findFirst({ where: { label: { equals: d.label, mode: "insensitive" }, ...(id ? { id: { not: id } } : {}) } });
  if (same) return { error: `«${d.label}» natijasi bor` };
  const data = { label: d.label, stage: d.stage, group: d.group, nextRule: d.nextRule, defaultDays: d.nextRule === "NONE" ? null : d.defaultDays, sort: d.sort };
  if (id) {
    const before = await db.crmResult.findUnique({ where: { id } });
    if (!before) return { error: "Topilmadi" };
    const after = await db.crmResult.update({ where: { id }, data: { ...data, isActive: d.isActive } });
    await audit(db, s.userId, "UPDATE", "CrmResult", id, before, after);
  } else {
    const row = await db.crmResult.create({ data: { ...data, isActive: true, code: `u_${randomBytes(4).toString("hex")}` } });
    await audit(db, s.userId, "CREATE", "CrmResult", row.id, undefined, row);
  }
  revalidatePath("/crm", "layout");
  return { ok: true, note: "Saqlandi" };
}

const activitySchema = z.object({
  crmActiveDays: zInt(1, 365, "«Faol» chegarasi 1–365 kun"),
  crmColdDays: zInt(2, 3650, "«Sovib qoldi» chegarasi 2–3650 kun"),
});

export async function saveActivity(_p: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("crm", "manage");
  const r = parseForm(activitySchema, fd);
  if ("error" in r) return { error: r.error };
  if (r.data.crmColdDays <= r.data.crmActiveDays) return { error: "«Sovib qoldi» chegarasi «Faol»dan katta bo'lsin" };
  const before = await db.companySettings.findUnique({ where: { id: "main" }, select: { crmActiveDays: true, crmColdDays: true } });
  await db.companySettings.upsert({ where: { id: "main" }, update: r.data, create: { id: "main", ...r.data } });
  await audit(db, s.userId, "UPDATE", "CompanySettings", "main", before, r.data);
  revalidatePath("/crm", "layout");
  return { ok: true, note: "Saqlandi" };
}
