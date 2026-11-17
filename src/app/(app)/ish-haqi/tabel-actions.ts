"use server";

import { revalidatePath } from "next/cache";
import { requireAction } from "@/lib/auth";
import { applyTabelImport, previewTabelImport, saveTabel, type ImportPreview, type TabelItem } from "@/lib/hr/tabel";
import { SHEETS_MAX_BYTES, SheetImportError } from "@/lib/payroll-sheets";
import { saveBrigadeHours, saveBrigadeMonth, saveBrigadeOutput } from "@/lib/hr/brigade-sheet";

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

type ImportPersonIn = { key: string; employeeId: string; hours: (number | null)[]; bsheets?: { sheet: string; hours: (number | null)[] }[]; remember?: boolean };
type ImportBrigadeIn = { sheet: string; brigadeId: string; newName?: string; remember?: boolean; lines: { name: string; rate: number; qty: (number | null)[] }[]; brak: number };

const hoursArr = (a: unknown) => (Array.isArray(a) ? a.slice(0, 31).map((h) => (typeof h === "number" && Number.isFinite(h) && h > 0 ? h : null)) : []);

/** Excel'dan import — 2-qadam: oddiy tabel soati davomatga, brigada varaqlari brigada varag'iga yoziladi. */
export async function applyTabelImportAction(month: string, people: ImportPersonIn[], brigades: ImportBrigadeIn[] = []): Promise<{ error?: string; saved?: number; skipped?: string[] }> {
  const s = await requireAction("payroll", "tabel");
  if (!MONTH_RE.test(month) || !Array.isArray(people) || !Array.isArray(brigades)) return { error: "So'rov noto'g'ri" };
  const clean = people.filter((p) => p && typeof p.employeeId === "string" && p.employeeId && Array.isArray(p.hours))
    .map((p) => ({
      key: String(p.key ?? ""), employeeId: p.employeeId, remember: !!p.remember, hours: hoursArr(p.hours),
      bsheets: Array.isArray(p.bsheets) ? p.bsheets.filter((b) => b && typeof b.sheet === "string").map((b) => ({ sheet: b.sheet, hours: hoursArr(b.hours) })) : [],
    }));
  // Bir xodimga bir nechta Excel ismi tanlangan (ismi turlicha yozilgan) — oddiy tabel soati kunma-kun qo'shiladi (24 dan oshmaydi)
  const byEmp = new Map<string, (typeof clean)[number]>();
  for (const p of clean) {
    const cur = byEmp.get(p.employeeId);
    if (!cur) { byEmp.set(p.employeeId, { ...p, hours: [...p.hours], bsheets: [...p.bsheets] }); continue; }
    cur.hours = cur.hours.map((h, i) => (h == null && p.hours[i] == null ? null : Math.min(24, (h ?? 0) + (p.hours[i] ?? 0))));
    cur.bsheets.push(...p.bsheets);
  }
  const aliases = clean.filter((p) => p.remember && p.key).map((p) => ({ key: p.key, employeeId: p.employeeId, hours: [], remember: true }));
  const bclean = brigades.filter((b) => b && typeof b.sheet === "string" && typeof b.brigadeId === "string" && b.brigadeId && Array.isArray(b.lines)).slice(0, 30)
    .map((b) => ({
      sheet: b.sheet, brigadeId: b.brigadeId, newName: typeof b.newName === "string" ? b.newName : undefined, remember: !!b.remember,
      brak: typeof b.brak === "number" && Number.isFinite(b.brak) && b.brak > 0 ? b.brak : 0,
      lines: b.lines.slice(0, 30).filter((l) => l && typeof l.name === "string").map((l) => ({ name: l.name.slice(0, 80), rate: typeof l.rate === "number" && Number.isFinite(l.rate) ? l.rate : 0, qty: Array.isArray(l.qty) ? l.qty.slice(0, 31).map((q) => (typeof q === "number" && Number.isFinite(q) && q > 0 ? q : null)) : [] })),
    }));
  const r = await applyTabelImport(s, month, [...[...byEmp.values()].map((p) => ({ ...p, remember: false })), ...aliases], bclean);
  if (r.error) return { error: r.error };
  revalidatePath("/ish-haqi");
  return { saved: r.saved, skipped: r.skipped };
}

// ───────────────────────── Brigada varag'i ─────────────────────────

/** Brigada a'zolari soati (`BrigadeHours`). */
export async function saveBrigadeHoursAction(month: string, brigadeId: string, items: { employeeId: string; day: number; value: string }[]): Promise<{ error?: string; saved?: number; skipped?: string[] }> {
  const s = await requireAction("payroll", "tabel");
  if (!MONTH_RE.test(month) || typeof brigadeId !== "string" || !Array.isArray(items)) return { error: "So'rov noto'g'ri" };
  const r = await saveBrigadeHours(s, month, brigadeId, items.filter((x) => x && typeof x.employeeId === "string" && Number.isInteger(x.day) && typeof x.value === "string"));
  if ("error" in r && r.error) return { error: r.error };
  revalidatePath("/ish-haqi");
  return r;
}

/** Kunlik ishlab chiqarish soni (`BrigadeOutput`). */
export async function saveBrigadeOutputAction(month: string, brigadeId: string, items: { line: string; day: number; value: string }[]): Promise<{ error?: string; saved?: number; skipped?: string[] }> {
  const s = await requireAction("payroll", "tabel");
  if (!MONTH_RE.test(month) || typeof brigadeId !== "string" || !Array.isArray(items)) return { error: "So'rov noto'g'ri" };
  const r = await saveBrigadeOutput(s, month, brigadeId, items.filter((x) => x && typeof x.line === "string" && Number.isInteger(x.day) && typeof x.value === "string"));
  if ("error" in r && r.error) return { error: r.error };
  revalidatePath("/ish-haqi");
  return r;
}

/** Oy qatorlari (mahsulot, narx) va qo'lda brak. */
export async function saveBrigadeMonthAction(month: string, brigadeId: string, input: { lines: { name: string; rate: number; productId?: string | null; was?: string }[]; brak: number | null }): Promise<{ error?: string; ok?: boolean }> {
  const s = await requireAction("payroll", "tabel");
  if (!MONTH_RE.test(month) || typeof brigadeId !== "string" || !input || !Array.isArray(input.lines)) return { error: "So'rov noto'g'ri" };
  const r = await saveBrigadeMonth(s, month, brigadeId, { lines: input.lines.slice(0, 50), brak: typeof input.brak === "number" ? input.brak : null });
  if ("error" in r && r.error) return { error: r.error };
  revalidatePath("/ish-haqi");
  return { ok: true };
}
