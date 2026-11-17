"use server";

import { revalidatePath } from "next/cache";
import { requireAction } from "@/lib/auth";
import type { ActionState } from "@/lib/action";
import { numText } from "@/lib/format";
import { cancelWithholding, createOpeningDebt, createWithholding, saveDeductions, saveFundAmount, savePayoutAmounts } from "@/lib/hr/deductions";
import { applyDeductImport, previewDeductImport, type DeductImportPreview } from "@/lib/hr/deduction-import";
import { DEDUCTION_CATS, type DeductionCat } from "@/lib/hr/deduction-cats";
import { SHEETS_MAX_BYTES, SheetImportError } from "@/lib/payroll-sheets";

/* Ushlanmalar (Ish haqi → Ushlanmalar) va ijro/aliment daftari — qoidalar `lib/hr/deductions.ts` da. Ruxsat: payroll.deductions. */

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const refresh = () => { revalidatePath("/ish-haqi"); };
const numOrNull = (v: FormDataEntryValue | null) => { const t = numText(String(v ?? "").trim()); return t ? Number(t) : null; };

export async function saveDeductionsAction(month: string, items: { employeeId: string; category: string; value: string }[]): Promise<{ error?: string; saved?: number }> {
  const s = await requireAction("payroll", "deductions");
  if (!MONTH_RE.test(month) || !Array.isArray(items)) return { error: "So'rov noto'g'ri" };
  const r = await saveDeductions(s, month, items.filter((x) => x && typeof x.employeeId === "string" && typeof x.category === "string" && typeof x.value === "string").slice(0, 5000));
  if (r.error) return { error: r.error };
  refresh();
  return { saved: r.saved };
}

export async function saveFundAmountAction(value: string): Promise<{ error?: string; ok?: boolean }> {
  const s = await requireAction("payroll", "deductions");
  const t = numText(String(value ?? "").trim());
  const r = await saveFundAmount(s, t ? Number(t) : null);
  if ("error" in r) return { error: r.error };
  refresh();
  return { ok: true };
}

export async function createWithholdingAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("payroll", "deductions");
  const kind = String(fd.get("kind") ?? "") === "ALIMENT" ? "ALIMENT" : "MIB";
  const r = await createWithholding(s, {
    employeeId: String(fd.get("employeeId") ?? ""), kind, caseNo: String(fd.get("caseNo") ?? ""), creditor: String(fd.get("creditor") ?? ""),
    amount: numOrNull(fd.get("amount")), percent: numOrNull(fd.get("percent")), monthly: numOrNull(fd.get("monthly")),
    startMonth: String(fd.get("startMonth") ?? ""), heldBefore: numOrNull(fd.get("heldBefore")) ?? 0, note: String(fd.get("note") ?? ""),
  });
  if ("error" in r) return { error: r.error };
  refresh();
  return { ok: true, note: "Ijro/aliment yozildi" };
}

export async function cancelWithholdingAction(id: string, reason: string): Promise<ActionState> {
  const s = await requireAction("payroll", "deductions");
  const r = await cancelWithholding(s, id, reason);
  if ("error" in r) return { error: r.error };
  refresh();
  return { ok: true, note: "Bekor qilindi" };
}

export async function createOpeningDebtAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("payroll", "deductions");
  const r = await createOpeningDebt(s, {
    employeeId: String(fd.get("employeeId") ?? ""), amount: numOrNull(fd.get("amount")) ?? 0, monthly: numOrNull(fd.get("monthly")) ?? 0,
    startMonth: String(fd.get("startMonth") ?? ""), note: String(fd.get("note") ?? ""),
  });
  if ("error" in r) return { error: r.error };
  refresh();
  return { ok: true, note: `Qarz qoldig'i yozildi — ${r.months} oyga` };
}

// ───────────────────────── Excel'dan import (C2026 G–K, «Карз», «Миб») ─────────────────────────

export type DeductPreviewState = { error?: string; preview?: DeductImportPreview; fileName?: string } | undefined;

export async function previewDeductImportAction(_prev: DeductPreviewState, fd: FormData): Promise<DeductPreviewState> {
  await requireAction("payroll", "deductions");
  const month = String(fd.get("month") ?? "");
  const file = fd.get("file");
  if (!MONTH_RE.test(month)) return { error: "Oyni tanlang" };
  if (!(file instanceof File) || !file.size) return { error: "Excel faylini tanlang" };
  if (!/\.xlsx$/i.test(file.name)) return { error: "Faqat .xlsx fayl (Excel 2007 va yangi)" };
  if (file.size > SHEETS_MAX_BYTES) return { error: "Fayl 15 MB dan katta" };
  try {
    return { preview: await previewDeductImport(Buffer.from(await file.arrayBuffer()), month), fileName: file.name };
  } catch (e) {
    if (e instanceof SheetImportError) return { error: e.message };
    throw e;
  }
}

type DeductPersonIn = { key: string; employeeId: string; remember?: boolean; values: Record<string, number>; loan: { balance: number; monthly: number } | null; cases: { caseNo: string | null; percent: number | null; debt: number; held: number }[]; advance?: number | null; card?: number | null };

export async function applyDeductImportAction(month: string, people: DeductPersonIn[]): Promise<{ error?: string; saved?: number; debts?: number; cases?: number; skipped?: string[] }> {
  const s = await requireAction("payroll", "deductions");
  if (!MONTH_RE.test(month) || !Array.isArray(people)) return { error: "So'rov noto'g'ri" };
  const pos = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.round(v) : 0);
  // Bir xodimga bir nechta Excel ismi (kirill/lotin, otasining ismi bilan/siz) — summalar qo'shiladi
  const byEmp = new Map<string, { key: string; employeeId: string; remember: boolean; values: Partial<Record<DeductionCat, number>>; loan: { balance: number; monthly: number } | null; cases: DeductPersonIn["cases"]; advance: number | null; card: number | null }>();
  const aliases: { key: string; employeeId: string }[] = [];
  for (const p of people) {
    if (!p || typeof p.employeeId !== "string" || !p.employeeId) continue;
    if (p.remember && p.key) aliases.push({ key: String(p.key), employeeId: p.employeeId });
    const cur = byEmp.get(p.employeeId) ?? { key: "", employeeId: p.employeeId, remember: false, values: {}, loan: null, cases: [], advance: null, card: null };
    if (pos(p.advance)) cur.advance = (cur.advance ?? 0) + pos(p.advance);
    if (pos(p.card)) cur.card = (cur.card ?? 0) + pos(p.card);
    for (const c of DEDUCTION_CATS) { const v = pos(p.values?.[c.key]); if (v) cur.values[c.key] = (cur.values[c.key] ?? 0) + v; }
    if (p.loan && pos(p.loan.balance)) cur.loan = { balance: (cur.loan?.balance ?? 0) + pos(p.loan.balance), monthly: (cur.loan?.monthly ?? 0) + pos(p.loan.monthly) };
    for (const c of Array.isArray(p.cases) ? p.cases : []) if (pos(c?.debt)) cur.cases.push({ caseNo: typeof c.caseNo === "string" ? c.caseNo.slice(0, 40) : null, percent: typeof c.percent === "number" && c.percent > 0 && c.percent <= 100 ? c.percent : null, debt: pos(c.debt), held: pos(c.held) });
    byEmp.set(p.employeeId, cur);
  }
  const r = await applyDeductImport(s, month, [...byEmp.values(), ...aliases.map((a) => ({ key: a.key, employeeId: a.employeeId, remember: true, values: {}, loan: null, cases: [], advance: null, card: null }))]);
  if ("error" in r && r.error) return { error: r.error };
  refresh();
  return r;
}

/** Avans (qo'lda) va plastik summalari — xodim bo'yicha. */
export async function savePayoutAmountsAction(items: { employeeId: string; field: "advance" | "card"; value: string }[]): Promise<{ error?: string; saved?: number }> {
  const s = await requireAction("payroll", "deductions");
  if (!Array.isArray(items)) return { error: "So'rov noto'g'ri" };
  const r = await savePayoutAmounts(s, items.filter((x) => x && typeof x.employeeId === "string" && (x.field === "advance" || x.field === "card") && typeof x.value === "string").slice(0, 2000));
  if ("error" in r) return { error: r.error };
  refresh();
  return { saved: r.saved };
}
