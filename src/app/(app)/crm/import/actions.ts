"use server";

import { revalidatePath } from "next/cache";
import { requireAction } from "@/lib/auth";
import { AmoError } from "@/lib/amocrm/client";
import { applyPlan } from "@/lib/crm/import/apply";
import { planFromSheets } from "@/lib/crm/import/sheets";
import { discoverAmo, planFromAmo, type AmoDiscovery, type AmoMapping } from "@/lib/crm/import/amo";
import type { ImportReport } from "@/lib/crm/import/plan";

export type ImportResult = { ok: true; report: ImportReport } | { ok: false; error: string };

const MAX_BYTES = 15 * 1024 * 1024;

const fail = (e: unknown): { ok: false; error: string } => {
  if (e instanceof AmoError) return { ok: false, error: e.status === 401 ? "amoCRM tokeni yaroqsiz yoki muddati tugagan" : e.message };
  console.error("crm import", e);
  return { ok: false, error: `Import xatosi: ${e instanceof Error ? e.message : String(e)}` };
};

/** Google Sheets fayli: `commit` bo'lmasa — faqat hisobot (quruq ishga tushirish). */
export async function importSheets(fd: FormData): Promise<ImportResult> {
  const s = await requireAction("crm", "import");
  const files = fd.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  if (!files.length) return { ok: false, error: "Fayl tanlanmagan" };
  if (files.some((f) => !/\.(xlsx|xls|csv)$/i.test(f.name))) return { ok: false, error: "Faqat .xlsx yoki .csv fayl" };
  if (files.reduce((a, f) => a + f.size, 0) > MAX_BYTES) return { ok: false, error: "Fayl juda katta (15 MB gacha)" };
  try {
    const plan = await planFromSheets(files);
    const commit = fd.get("commit") === "1" && plan.errors.length === 0;
    const report = await applyPlan(plan, s.userId, !commit, `Google Sheets: ${files.map((f) => f.name).join(", ")}`);
    if (commit) revalidatePath("/crm", "layout");
    return { ok: true, report };
  } catch (e) {
    return fail(e);
  }
}

/** amoCRM: bosqichlar va xodimlarni olish (moslash jadvali uchun). Token saqlanmaydi. */
export async function amoDiscover(domain: string, token: string): Promise<{ ok: true; data: AmoDiscovery } | { ok: false; error: string }> {
  await requireAction("crm", "import");
  if (!domain.trim() || !token.trim()) return { ok: false, error: "amoCRM manzili va tokenini kiriting" };
  try {
    return { ok: true, data: await discoverAmo(domain, token) };
  } catch (e) {
    return fail(e);
  }
}

export async function importAmo(domain: string, token: string, map: AmoMapping, commit: boolean): Promise<ImportResult> {
  const s = await requireAction("crm", "import");
  try {
    const plan = await planFromAmo(domain, token, map);
    const go = commit && plan.errors.length === 0;
    const report = await applyPlan(plan, s.userId, !go, `amoCRM: ${domain}`);
    if (go) revalidatePath("/crm", "layout");
    return { ok: true, report };
  } catch (e) {
    return fail(e);
  }
}
