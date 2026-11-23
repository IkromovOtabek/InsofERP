"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAction } from "@/lib/auth";
import type { ActionState } from "@/lib/action";
import { SHEETS_MAX_BYTES, SheetImportError, cancelWorkbook, createWorkbook, parseWorkbook, saveCells } from "@/lib/payroll-sheets";
import type { Cell } from "@/lib/sheet-calc";
import { saveEmployeeRate } from "@/lib/hr/deductions";

/* Oylik varaqlari (Excel kitobi) — qoidalar `lib/payroll-sheets.ts` da. Ruxsat: payroll.sheets (Sekretar). */

export async function uploadWorkbookAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("payroll", "sheets");
  const month = String(fd.get("month") ?? "");
  const file = fd.get("file");
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return { error: "Oyni tanlang" };
  if (!(file instanceof File) || !file.size) return { error: "Excel faylini tanlang" };
  if (!/\.xlsx$/i.test(file.name)) return { error: "Faqat .xlsx fayl (Excel 2007 va yangi). Eski .xls bo'lsa — Excel'da «Сохранить как → .xlsx»" };
  if (file.size > SHEETS_MAX_BYTES) return { error: "Fayl 15 MB dan katta" };
  let id: string;
  try {
    const sheets = parseWorkbook(Buffer.from(await file.arrayBuffer()));
    const title = String(fd.get("title") ?? "").trim() || file.name.replace(/\.xlsx$/i, "");
    id = (await createWorkbook(s, month, title.slice(0, 120), sheets)).id;
  } catch (e) {
    if (e instanceof SheetImportError) return { error: e.message };
    throw e;
  }
  revalidatePath("/ish-haqi");
  redirect(`/ish-haqi?tab=varaqlar&kitob=${id}`);
}

/** Katak(lar)ni saqlash — jadvaldan to'g'ridan-to'g'ri (sahifa yangilanmaydi, jadval o'zi qayta hisoblaydi). */
export async function saveCellsAction(sheetId: string, items: { addr: string; input: string }[]): Promise<{ error?: string; cells?: Record<string, Cell | null> }> {
  const s = await requireAction("payroll", "sheets");
  if (typeof sheetId !== "string" || !Array.isArray(items)) return { error: "So'rov noto'g'ri" };
  const clean = items.filter((x) => x && typeof x.addr === "string" && typeof x.input === "string");
  return saveCells(s, sheetId, clean);
}

/** ERP kitobidagi «Stavka» qalami — xodim tarif stavkasi. Ruxsat: payroll.rate (Sekretar, direktor). */
export async function saveRateAction(employeeId: string, value: string): Promise<{ error?: string; ok?: boolean }> {
  const s = await requireAction("payroll", "rate");
  if (typeof employeeId !== "string" || typeof value !== "string") return { error: "So'rov noto'g'ri" };
  const r = await saveEmployeeRate(s, employeeId, value);
  if ("error" in r) return { error: r.error };
  revalidatePath("/ish-haqi");
  return { ok: true };
}

export async function cancelWorkbookAction(id: string, reason: string): Promise<ActionState> {
  const s = await requireAction("payroll", "sheets");
  const r = await cancelWorkbook(s, id, reason);
  if (r.error) return { error: r.error };
  revalidatePath("/ish-haqi");
  return { ok: true, note: "Kitob bekor qilindi" };
}
