"use server";

import { revalidatePath } from "next/cache";
import { requireAction } from "@/lib/auth";
import { applyTabelImport, previewTabelImport, saveTabel, type ImportPreview, type TabelItem } from "@/lib/hr/tabel";
import { SHEETS_MAX_BYTES, SheetImportError } from "@/lib/payroll-sheets";

/* Tabel (Ish haqi → Tabel) — qoidalar `lib/hr/tabel.ts` da. Ruxsat: payroll.tabel (Sekretar). */

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Jadvaldan kataklarni saqlash (sahifa yangilanmaydi — jadval o'zi ko'rsatib turadi). */
export async function saveTabelAction(month: string, items: TabelItem[]): Promise<{ error?: string; saved?: number; skipped?: string[] }> {
  const s = await requireAction("payroll", "tabel");
  if (!MONTH_RE.test(month) || !Array.isArray(items)) return { error: "So'rov noto'g'ri" };
  const clean = items.filter((x) => x && typeof x.employeeId === "string" && Number.isInteger(x.day) && typeof x.value === "string");
  const r = await saveTabel(s, month, clean);
  if (r.error) return { error: r.error };
  if (r.saved) revalidatePath("/ish-haqi");
  return { saved: r.saved, skipped: r.skipped };
}

export type PreviewState = { error?: string; preview?: ImportPreview; fileName?: string } | undefined;

/** Excel'dan import — 1-qadam: fayldagi tabel varaqlari va ismlarning ERP xodimlariga mosligi (hali hech narsa yozilmaydi). */
export async function previewTabelImportAction(_prev: PreviewState, fd: FormData): Promise<PreviewState> {
  await requireAction("payroll", "tabel");
  const month = String(fd.get("month") ?? "");
  const file = fd.get("file");
  if (!MONTH_RE.test(month)) return { error: "Oyni tanlang" };
  if (!(file instanceof File) || !file.size) return { error: "Excel faylini tanlang" };
  if (!/\.xlsx$/i.test(file.name)) return { error: "Faqat .xlsx fayl (Excel 2007 va yangi)" };
  if (file.size > SHEETS_MAX_BYTES) return { error: "Fayl 15 MB dan katta" };
  try {
    return { preview: await previewTabelImport(Buffer.from(await file.arrayBuffer()), month), fileName: file.name };
  } catch (e) {
    if (e instanceof SheetImportError) return { error: e.message };
    throw e;
  }
}

/** Excel'dan import — 2-qadam: tanlangan moslik bo'yicha soatlar tabelga yoziladi. */
export async function applyTabelImportAction(month: string, people: { key: string; employeeId: string; hours: (number | null)[]; remember?: boolean }[]): Promise<{ error?: string; saved?: number; skipped?: string[] }> {
  const s = await requireAction("payroll", "tabel");
  if (!MONTH_RE.test(month) || !Array.isArray(people)) return { error: "So'rov noto'g'ri" };
  const clean = people.filter((p) => p && typeof p.employeeId === "string" && p.employeeId && Array.isArray(p.hours))
    .map((p) => ({ key: String(p.key ?? ""), employeeId: p.employeeId, remember: !!p.remember, hours: p.hours.slice(0, 31).map((h) => (typeof h === "number" && Number.isFinite(h) ? h : null)) }));
  // Bir xodimga bir nechta Excel ismi tanlangan (ismi turlicha yozilgan) — soatlari kunma-kun qo'shiladi (24 dan oshmaydi)
  const byEmp = new Map<string, (typeof clean)[number]>();
  for (const p of clean) {
    const cur = byEmp.get(p.employeeId);
    if (!cur) { byEmp.set(p.employeeId, { ...p, hours: [...p.hours] }); continue; }
    cur.hours = cur.hours.map((h, i) => (h == null && p.hours[i] == null ? null : Math.min(24, (h ?? 0) + (p.hours[i] ?? 0))));
  }
  const aliases = clean.filter((p) => p.remember && p.key).map((p) => ({ key: p.key, employeeId: p.employeeId, hours: [], remember: true }));
  const r = await applyTabelImport(s, month, [...[...byEmp.values()].map((p) => ({ ...p, remember: false })), ...aliases]);
  if (r.error) return { error: r.error };
  revalidatePath("/ish-haqi");
  return { saved: r.saved, skipped: r.skipped };
}
