"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Download, FileSpreadsheet, X } from "lucide-react";
import { Button } from "@/components/ui";
import { uiText } from "@/components/script-provider";
import { cn } from "@/lib/utils";

/* ───────────────────────── Excel eksport: bitta sodda ko'rinish, oldindan ko'rish oynasi ─────────────────────────
 *
 * Har hisobot bir xil qoidada yuklanadi: bitta sarlavha qatori, oddiy ustunlar, birlashtirilgan katak va rang yo'q.
 * Sonlar son bo'lib (Excel'da hisoblasa bo'ladi), sanalar sana bo'lib yoziladi, ustun kengligi avtomatik,
 * sarlavhada filtr, «Jami» qatori oxirida. Yuklashdan oldin oynada Excel ko'rinishi (A, B, C… ustunlar, qator raqamlari,
 * pastda varaqlar) chiqadi.
 *
 *  · `PageExcelButton` — PageHeader'da o'zi turadi: sahifadagi ko'rinib turgan jadvallarni (har biri alohida varaq) o'qiydi.
 *    Sahifada o'z eksporti bo'lsa (`data-excel-own`) — chiqmaydi.
 *  · `ExcelButton` — serverda tayyorlangan qatorlar (sarlavha → qiymat) bilan: katta yoki sahifalangan jadvallar uchun.
 * Fayl nomi: sahifa sarlavhasi + davr (`data-excel-period` belgisi, sana tanlagich qo'yadi) yoki bugungi sana.
 */

export type ExcelCell = string | number | Date | null;
export type ExcelGrid = { name: string; rows: ExcelCell[][] }; // rows[0] — sarlavha qatori
type RowsSheet = { name: string; rows: Record<string, string | number | null>[] };

/* ── Katak matni → qiymat ── */

const UNIT = /\s*(so'm|so‘m|сўм|сум|m³|m3|м³|dona|дона|шт|kg|кг|km|км|t|т|l|л|soat|соат|ta|та)\.?$/i;
/** Ekrandagi son: «1 234 567», «-1 234,5», «1 000 000.000», «12,5 m³», «−300 so'm». Foiz va «mln/mlrd» qisqartmasi — matn bo'lib qoladi. */
export function parseNumberText(raw: string): number | null {
  const s = raw.replace(/[   ]/g, " ").replace(/−/g, "-").trim().replace(UNIT, "").trim();
  if (!/^[-+]?\d{1,3}( \d{3})*([.,]\d+)?$|^[-+]?\d+([.,]\d+)?$/.test(s)) return null;
  const n = Number(s.replace(/ /g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}
/** «17/11/2026», «17.11.2026», «17.11.2026 14:05» → sana (mahalliy vaqt). */
export function parseDateText(raw: string): Date | null {
  const m = /^(\d{2})[./](\d{2})[./](\d{4})(?:[ ,]+(\d{1,2}):(\d{2}))?$/.exec(raw.trim());
  if (!m) return null;
  const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]), Number(m[4] ?? 0), Number(m[5] ?? 0));
  return d.getDate() === Number(m[1]) ? d : null;
}
function toCell(text: string): ExcelCell {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t || t === "—" || t === "–" || t === "-") return null;
  return parseNumberText(t) ?? parseDateText(t) ?? t;
}

/** Katak matni: tugma, ikonka, yashirin yozuvlar tashlanadi; maydon — qiymati, tanlov — tanlangan varianti. */
function cellText(cell: HTMLElement): string {
  const c = cell.cloneNode(true) as HTMLElement;
  c.querySelectorAll("button, svg, script, style, [hidden], .sr-only, [data-excel-skip], [aria-hidden='true']").forEach((n) => n.remove());
  const live = cell.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("input, select, textarea");
  c.querySelectorAll("input, select, textarea").forEach((n, i) => {
    const src = live[i];
    let v = "";
    if (src instanceof HTMLSelectElement) v = src.value ? src.selectedOptions[0]?.text ?? "" : ""; // «Hisob…» kabi tanlanmagan variant — bo'sh
    else if (src && !(src instanceof HTMLInputElement && ["checkbox", "radio", "hidden", "button", "submit"].includes(src.type))) v = src.value;
    n.replaceWith(document.createTextNode(` ${v} `));
  });
  // Blok elementlar orasiga bo'shliq: «Mijoz<div>Obyekt</div>» → «Mijoz Obyekt»
  c.querySelectorAll("div, p, br, li").forEach((n) => n.before(document.createTextNode(" ")));
  return c.textContent ?? "";
}

/** HTML jadval → oddiy to'r: ko'p qatorli sarlavha bitta qatorga («Guruh · Ustun»), colSpan/rowSpan yoyiladi, bo'sh amal ustunlari olinadi. */
export function tableToGrid(table: HTMLTableElement): ExcelCell[][] {
  const place = (rows: HTMLTableRowElement[]) => {
    const grid: string[][] = [];
    rows.forEach((tr, r) => {
      grid[r] ??= [];
      let c = 0;
      for (const cell of Array.from(tr.cells)) {
        while (grid[r][c] !== undefined) c++;
        const text = cellText(cell);
        const cs = Math.max(1, cell.colSpan || 1), rs = Math.max(1, cell.rowSpan || 1);
        for (let i = 0; i < rs; i++) for (let j = 0; j < cs; j++) {
          grid[r + i] ??= [];
          // Birlashtirilgan katakda qiymat faqat birinchi ustunda (summa ikki marta sanalmasin), sarlavhada esa hammasida
          grid[r + i][c + j] = i === 0 && j === 0 ? text : rows === head ? text : "";
        }
        c += cs;
      }
    });
    return grid;
  };
  const head = Array.from(table.tHead?.rows ?? []);
  const bodyRows = Array.from(table.tBodies).flatMap((b) => Array.from(b.rows));
  const foot = Array.from(table.tFoot?.rows ?? []);
  // thead yo'q jadval: birinchi qatori <th> bo'lsa — sarlavha
  if (!head.length && bodyRows[0] && Array.from(bodyRows[0].cells).every((c) => c.tagName === "TH")) head.push(bodyRows.shift()!);

  const hg = place(head);
  const width = Math.max(0, ...hg.map((r) => r.length), ...place(bodyRows.slice(0, 1)).map((r) => r.length));
  const header = Array.from({ length: width }, (_, i) => {
    const parts: string[] = [];
    for (const r of hg) { const t = (r[i] ?? "").replace(/\s+/g, " ").trim(); if (t && parts[parts.length - 1] !== t) parts.push(t); }
    return parts.join(" · ");
  });
  const visible = (tr: HTMLTableRowElement) => tr.offsetParent !== null || tr.getClientRects().length > 0;
  const body = place([...bodyRows, ...foot].filter(visible))
    .map((r) => Array.from({ length: width }, (_, i) => toCell(r[i] ?? "")))
    // «Ma'lumot yo'q» kabi bitta katakli bo'sh holat qatorlari tashlanadi
    .filter((r) => r.some((v) => v !== null) && !(r.filter((v) => v !== null).length === 1 && width > 2 && r[0] === null && typeof r.find((v) => v !== null) === "string" && /yo'q|topilmadi|kiritilmagan/i.test(String(r.find((v) => v !== null)))));
  // Sarlavhasi ham, qiymati ham bo'sh ustun (tahrir qalami, amal tugmalari) — olib tashlanadi
  const keep = header.map((h, i) => !!h || body.some((r) => r[i] !== null));
  return [header.filter((_, i) => keep[i]), ...body.map((r) => r.filter((_, i) => keep[i]))];
}

/* ── Fayl yozish ── */

const sheetName = (s: string, used: Set<string>) => {
  const base = uiText(s).replace(/[[\]:*?/\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 28) || "Varaq";
  let n = base, i = 2;
  while (used.has(n.toLowerCase())) n = `${base.slice(0, 26)} ${i++}`;
  used.add(n.toLowerCase());
  return n;
};
const fileSafe = (s: string) => s.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120) || "Hisobot";

export async function downloadXlsx(file: string, grids: ExcelGrid[]) {
  const XLSX = await import("xlsx");
  XLSX.writeFile(buildWorkbook(XLSX, grids), `${fileSafe(uiText(file))}.xlsx`);
}

/** To'rlardan kitob (brauzersiz ham ishlaydi — QA shu bilan tekshiradi). */
export function buildWorkbook(XLSX: typeof import("xlsx"), grids: ExcelGrid[]) {
  const wb = XLSX.utils.book_new();
  const used = new Set<string>();
  for (const g of grids.length ? grids : [{ name: "Hisobot", rows: [["Ma'lumot yo'q"]] }]) {
    const rows = g.rows.map((r) => r.map((v) => (typeof v === "string" ? uiText(v) : v)));
    const ws = XLSX.utils.aoa_to_sheet(rows, { cellDates: true });
    const cols = Math.max(0, ...rows.map((r) => r.length));
    // Son formati: butun — «# ##0», kasrli — «# ##0.00»; sana — «dd.mm.yyyy» (vaqti bo'lsa «hh:mm» bilan)
    rows.forEach((r, ri) => r.forEach((v, ci) => {
      const cell = ws[XLSX.utils.encode_cell({ r: ri, c: ci })];
      if (!cell) return;
      if (typeof v === "number") cell.z = Number.isInteger(v) ? "#,##0" : "#,##0.00";
      else if (v instanceof Date) cell.z = v.getHours() || v.getMinutes() ? "dd.mm.yyyy hh:mm" : "dd.mm.yyyy";
    }));
    ws["!cols"] = Array.from({ length: cols }, (_, c) => {
      const w = Math.max(...rows.slice(0, 500).map((r) => {
        const v = r[c];
        return v == null ? 0 : v instanceof Date ? 11 : typeof v === "number" ? String(Math.round(v)).length + Math.floor(String(Math.round(v)).length / 3) + 3 : String(v).length;
      }));
      return { wch: Math.min(60, Math.max(8, w + 2)) };
    });
    if (rows.length > 1 && cols > 0) ws["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length - 1, c: cols - 1 } }) };
    XLSX.utils.book_append_sheet(wb, ws, sheetName(g.name, used));
  }
  return wb;
}

/** Server qatorlari (sarlavha → qiymat) → to'r. Ustunlar birinchi qatorlardagi kalitlar tartibida. */
function rowsToGrid(s: RowsSheet): ExcelGrid {
  const keys: string[] = [];
  for (const r of s.rows) for (const k of Object.keys(r)) if (!keys.includes(k)) keys.push(k);
  const cell = (v: string | number | null | undefined): ExcelCell => (v == null || v === "" ? null : typeof v === "number" ? v : parseDateText(v) ?? v);
  return { name: s.name, rows: [keys, ...s.rows.map((r) => keys.map((k) => cell(r[k])))] };
}

/* ── Sahifa ma'lumotlari ── */

function pageTitle(): string {
  return document.querySelector("main h1, h1")?.textContent?.replace(/\s+/g, " ").trim() || "Hisobot";
}
function pagePeriod(): string {
  const p = document.querySelector<HTMLElement>("[data-excel-period]")?.dataset.excelPeriod?.trim();
  if (p) return p;
  const d = new Date();
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;
}
/** Jadval nomi: undan oldingi eng yaqin bo'lim/karta sarlavhasi. */
function tableName(table: HTMLTableElement, i: number): string {
  let el: HTMLElement | null = table.parentElement;
  while (el && el.tagName !== "MAIN" && el !== document.body) {
    const hs = Array.from(el.querySelectorAll<HTMLElement>("h2, h3, h4")).filter((h) => !h.closest("table") && (h.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING));
    const h = hs[hs.length - 1];
    if (h?.textContent?.trim()) return h.textContent.replace(/\s+/g, " ").trim();
    el = el.parentElement;
  }
  return i === 0 ? pageTitle() : `Jadval ${i + 1}`;
}
function pageTables(): HTMLTableElement[] {
  const root = document.querySelector("main") ?? document.body;
  return Array.from(root.querySelectorAll("table")).filter((t) =>
    !t.closest("[role='dialog'], [data-excel-skip], [data-excel-preview]") && (t.offsetParent !== null || t.getClientRects().length > 0) && t.querySelector("tbody tr"));
}

/* ── Tugmalar ── */

/** PageHeader'da: sahifada jadval bo'lsa va o'z eksporti bo'lmasa — «Excel» tugmasi. */
export function PageExcelButton() {
  const [show, setShow] = useState(false);
  const [data, setData] = useState<{ file: string; period: string; grids: ExcelGrid[] } | null>(null);
  useEffect(() => {
    const check = () => setShow(!document.querySelector("[data-excel-own]") && pageTables().length > 0);
    check();
    // Jadval keyinroq chiqishi mumkin (klient filtrlar, tablar) — DOM o'zgarishini kuzatamiz
    const root = document.querySelector("main") ?? document.body;
    let t: ReturnType<typeof setTimeout> | undefined;
    const mo = new MutationObserver(() => { clearTimeout(t); t = setTimeout(check, 250); });
    mo.observe(root, { childList: true, subtree: true });
    return () => { mo.disconnect(); clearTimeout(t); };
  }, []);
  if (!show) return null;
  const open = () => {
    const grids = pageTables().map((t, i) => ({ name: tableName(t, i), rows: tableToGrid(t) })).filter((g) => g.rows.length > 0 && g.rows[0].length > 0);
    setData({ file: pageTitle(), period: pagePeriod(), grids });
  };
  return (
    <>
      <Button type="button" variant="secondary" onClick={open} data-excel-skip><FileSpreadsheet size={16} /> Excel</Button>
      {data && <ExcelPreview file={`${data.file} ${data.period}`} period={data.period} grids={data.grids} onClose={() => setData(null)} />}
    </>
  );
}

/**
 * Serverda tayyorlangan qatorlar bilan eksport (katta yoki sahifalangan jadval, bir nechta varaq).
 * `load` — katta varaq sahifa bilan yuborilmaydi, tugma bosilganda server action'dan olinadi.
 */
export function ExcelButton({ file, sheets, load }: { file: string; sheets?: RowsSheet[]; load?: () => Promise<RowsSheet[]> }) {
  const [busy, setBusy] = useState(false);
  const [grids, setGrids] = useState<ExcelGrid[] | null>(null);
  const run = async () => {
    setBusy(true);
    try { setGrids((load ? await load() : sheets ?? []).map(rowsToGrid)); } finally { setBusy(false); }
  };
  const period = useMemo(() => (typeof document === "undefined" ? "" : pagePeriodSafe()), [grids]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <span data-excel-own className="contents">
      <Button type="button" variant="secondary" onClick={run} disabled={busy}><FileSpreadsheet size={16} /> {busy ? "Tayyorlanmoqda…" : "Excel"}</Button>
      {grids && <ExcelPreview file={file} period={period} grids={grids} onClose={() => setGrids(null)} />}
    </span>
  );
}
function pagePeriodSafe() { try { return document.querySelector<HTMLElement>("[data-excel-period]")?.dataset.excelPeriod?.trim() ?? ""; } catch { return ""; } }

/* ── Oldindan ko'rish oynasi: Excel ko'rinishi ── */

const colLetter = (i: number) => { let s = ""; for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };
const pad2 = (n: number) => String(n).padStart(2, "0");
function showCell(v: ExcelCell): string {
  if (v == null) return "";
  if (typeof v === "number") {
    const [i, f] = Math.abs(v).toFixed(Number.isInteger(v) ? 0 : 2).split(".");
    return (v < 0 ? "-" : "") + i.replace(/\B(?=(\d{3})+(?!\d))/g, " ") + (f ? "," + f : "");
  }
  if (v instanceof Date) return `${pad2(v.getDate())}.${pad2(v.getMonth() + 1)}.${v.getFullYear()}${v.getHours() || v.getMinutes() ? ` ${pad2(v.getHours())}:${pad2(v.getMinutes())}` : ""}`;
  return v;
}
const PREVIEW_ROWS = 1000;

export function ExcelPreview({ file, period, grids, onClose }: { file: string; period?: string; grids: ExcelGrid[]; onClose: () => void }) {
  const [tab, setTab] = useState(0);
  const [busy, setBusy] = useState(false);
  const closeBtn = useRef<HTMLButtonElement>(null);
  const g = grids[tab] ?? grids[0];
  const close = useCallback(() => onClose(), [onClose]);
  useEffect(() => {
    closeBtn.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); close(); } };
    document.addEventListener("keydown", onKey, true);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey, true); document.body.style.overflow = prev; };
  }, [close]);
  const download = async () => { setBusy(true); try { await downloadXlsx(file, grids); } finally { setBusy(false); } };
  const cols = g ? Math.max(0, ...g.rows.map((r) => r.length)) : 0;
  const dataRows = g ? g.rows.length - 1 : 0;

  return createPortal((
    <div data-excel-preview className="fixed inset-0 z-[70] flex items-stretch justify-center bg-slate-900/55 p-2 sm:p-6" onMouseDown={close}>
      <div role="dialog" aria-modal="true" aria-label={`Excel ko'rinishi: ${file}`} onMouseDown={(e) => e.stopPropagation()}
        className="flex w-full max-w-7xl flex-col overflow-hidden rounded-xl border border-slate-300 bg-white shadow-2xl">
        {/* Tepa: fayl nomi, davr, yuklash */}
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-[#217346] px-4 py-2.5 text-white">
          <FileSpreadsheet size={18} aria-hidden />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold">{uiText(file)}.xlsx</div>
            <div className="text-xs text-white/80">{period ? `Davr: ${period} · ` : ""}{grids.length} varaq · {dataRows} qator</div>
          </div>
          <Button type="button" size="sm" onClick={download} disabled={busy} className="bg-white text-[#217346] hover:bg-white/90"><Download size={15} /> {busy ? "Tayyorlanmoqda…" : "Yuklab olish"}</Button>
          <button ref={closeBtn} type="button" onClick={close} aria-label="Yopish" className="rounded-md p-1.5 text-white/90 hover:bg-white/15"><X size={18} /></button>
        </div>
        {/* To'r: ustun harflari, qator raqamlari, birinchi qator — sarlavha */}
        <div className="min-h-0 flex-1 overflow-auto bg-white font-(family-name:--font-inter) text-[12.5px] text-slate-800">
          {g && g.rows.length > 0 ? (
            <table className="border-separate border-spacing-0">
              <thead>
                <tr>
                  <th className="sticky left-0 top-0 z-[3] h-6 w-10 min-w-10 border-b border-r border-slate-300 bg-slate-100" />
                  {Array.from({ length: cols }, (_, c) => (
                    <th key={c} className="sticky top-0 z-[2] h-6 border-b border-r border-slate-300 bg-slate-100 px-2 text-center text-[11px] font-normal text-slate-500">{colLetter(c)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {g.rows.slice(0, PREVIEW_ROWS + 1).map((r, ri) => (
                  <tr key={ri}>
                    <td className={cn("sticky left-0 z-[1] border-b border-r border-slate-300 bg-slate-100 px-1.5 text-right text-[11px] text-slate-500", ri === 0 && "top-6 z-[3]")}>{ri + 1}</td>
                    {Array.from({ length: cols }, (_, c) => {
                      const v = r[c] ?? null;
                      return (
                        <td key={c} className={cn("max-w-[28rem] truncate whitespace-nowrap border-b border-r border-slate-200 px-2 py-1",
                          ri === 0 ? "sticky top-6 z-[1] bg-slate-50 font-semibold text-slate-900" : "",
                          typeof v === "number" && "text-right tabular", v instanceof Date && "text-right")} title={typeof v === "string" && v.length > 40 ? v : undefined}>
                          {showCell(typeof v === "string" ? uiText(v) : v)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <div className="p-10 text-center text-sm text-slate-500">Jadvalda ma&apos;lumot yo&apos;q</div>}
          {dataRows > PREVIEW_ROWS && <div className="p-3 text-center text-xs text-slate-500">Oynada birinchi {PREVIEW_ROWS} qator ko&apos;rsatildi — faylga hammasi ({dataRows}) yoziladi</div>}
        </div>
        {/* Pastda varaqlar */}
        <div className="flex items-center gap-0.5 overflow-x-auto border-t border-slate-300 bg-slate-100 px-2">
          {grids.map((s, i) => (
            <button key={i} type="button" onClick={() => setTab(i)}
              className={cn("whitespace-nowrap border-x border-b-2 px-3 py-1.5 text-xs", i === tab ? "border-x-slate-300 border-b-[#217346] bg-white font-semibold text-[#217346]" : "border-transparent text-slate-600 hover:bg-white/60")}>
              {uiText(s.name)}
            </button>
          ))}
        </div>
      </div>
    </div>
  ), document.body);
}
