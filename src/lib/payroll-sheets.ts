import * as XLSX from "xlsx";
import type { Prisma } from "@/generated/prisma";
import { db } from "@/lib/db";
import { audit, auditMany } from "@/lib/audit";
import { Book, colName, isErr, parseInput, type Cell, type SheetData, type SheetStyle, type Val } from "@/lib/sheet-calc";
import { fmtNum, numText } from "@/lib/format";

/**
 * Oylik varaqlari (Sekretar, «Ish haqi» → «Oylik varaqlari»): korxonaning oylik Excel kitobi ERP ichida.
 * Import — qiymat, formula, raqam formati, birlashgan kataklar, fon, qalin/kursiv, chegaralar, tekislash,
 * ustun eni / satr balandligi, yashirin varaq/ustun/satr, muzlatilgan qator-ustunlar. Formulalar `lib/sheet-calc.ts` da.
 * ERP vedomostlariga (PayrollRun) bog'lanmaydi — bu Excel'ning o'zi, ERP ichida.
 */

export const SHEETS_MAX_BYTES = 15 * 1024 * 1024;
const MAX_CELLS = 300_000;
const MAX_ROWS = 5000, MAX_COLS = 300;

export class SheetImportError extends Error {}

type ParsedSheet = { name: string; hidden: boolean; data: SheetData };

// ─────────────────────────── XML yordamchilari ───────────────────────────

const attr = (tag: string, name: string) => {
  const m = new RegExp(`\\s${name}="([^"]*)"`).exec(tag);
  return m ? m[1] : undefined;
};
const unxml = (s: string) => s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const blocks = (xml: string, tag: string, inner: string) => {
  const m = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`).exec(xml);
  if (!m) return [] as string[];
  return m[1].match(new RegExp(`<${inner}\\b[^>]*?(?:/>|>[\\s\\S]*?</${inner}>)`, "g")) ?? [];
};

type Xf = { b?: 1; i?: 1; fs?: number; fc?: string; bd?: number; ha?: SheetStyle["ha"]; va?: SheetStyle["va"]; w?: 1 };

/** styles.xml → har cellXfs indeksiga shrift / chegara / tekislash (fon va raqam formati SheetJS'dan). */
function parseXfs(stylesXml: string | null): { xfs: Xf[]; baseSz: number } {
  if (!stylesXml) return { xfs: [], baseSz: 11 };
  const fonts = blocks(stylesXml, "fonts", "font").map((f) => {
    const sz = /<sz val="([\d.]+)"/.exec(f);
    const rgb = /<color rgb="(?:FF)?([0-9A-Fa-f]{6})"/.exec(f);
    return { b: /<b\/>|<b val="(1|true)"\/>/.test(f), i: /<i\/>|<i val="(1|true)"\/>/.test(f), sz: sz ? Number(sz[1]) : 11, fc: rgb ? rgb[1].toUpperCase() : undefined };
  });
  const borders = blocks(stylesXml, "borders", "border").map((b) => {
    const side = (s: string) => new RegExp(`<${s} style="[a-zA-Z]+"`).test(b);
    return (side("top") ? 1 : 0) | (side("right") ? 2 : 0) | (side("bottom") ? 4 : 0) | (side("left") ? 8 : 0);
  });
  const baseSz = fonts[0]?.sz ?? 11;
  const xfs = blocks(stylesXml, "cellXfs", "xf").map((xf): Xf => {
    const head = /^<xf\b[^>]*>/.exec(xf)?.[0] ?? xf;
    const font = fonts[Number(attr(head, "fontId") ?? 0)];
    const bd = borders[Number(attr(head, "borderId") ?? 0)] ?? 0;
    const al = /<alignment\b[^>]*>/.exec(xf)?.[0] ?? "";
    const h = attr(al, "horizontal"), v = attr(al, "vertical");
    const o: Xf = {};
    if (font?.b) o.b = 1;
    if (font?.i) o.i = 1;
    if (font && font.sz !== baseSz) o.fs = font.sz;
    if (font?.fc && font.fc !== "000000") o.fc = font.fc;
    if (bd) o.bd = bd;
    if (h === "left" || h === "right") o.ha = h;
    else if (h === "center" || h === "centerContinuous") o.ha = "center";
    if (v === "top") o.va = "top"; else if (v === "center") o.va = "center";
    if (attr(al, "wrapText") === "1" || attr(al, "wrapText") === "true") o.w = 1;
    return o;
  });
  return { xfs, baseSz };
}

type SheetXml = { styleOf: Map<string, number>; frz?: [number, number]; defRowPx?: number; defColPx?: number; zoom?: number };

/** Varaq XML'i: katak → xf indeksi, muzlatilgan panel, sukut satr balandligi / ustun eni. */
function parseSheetXml(xml: string | null): SheetXml {
  const styleOf = new Map<string, number>();
  if (!xml) return { styleOf };
  for (const m of xml.matchAll(/<c r="([A-Z]{1,3}\d+)"([^>]*?)\/?>/g)) {
    const s = /\bs="(\d+)"/.exec(m[2]);
    if (s) styleOf.set(m[1], Number(s[1]));
  }
  const pane = /<pane\b[^>]*>/.exec(xml)?.[0];
  let frz: [number, number] | undefined;
  if (pane && /state="frozen/.test(pane)) frz = [Math.round(Number(attr(pane, "ySplit") ?? 0)), Math.round(Number(attr(pane, "xSplit") ?? 0))];
  const view = /<sheetView\b[^>]*>/.exec(xml)?.[0] ?? "";
  const zoom = Number(attr(view, "zoomScaleNormal") ?? attr(view, "zoomScale") ?? 100);
  const fmt = /<sheetFormatPr\b[^>]*>/.exec(xml)?.[0] ?? "";
  const drh = attr(fmt, "defaultRowHeight"), dcw = attr(fmt, "defaultColWidth"), bcw = attr(fmt, "baseColWidth");
  return {
    styleOf, frz: frz && (frz[0] || frz[1]) ? frz : undefined,
    zoom: zoom >= 10 && zoom <= 400 && zoom !== 100 ? zoom : undefined,
    defRowPx: drh ? Math.round(Number(drh) * 4 / 3) : undefined,
    defColPx: dcw ? Math.round(Number(dcw) * 7 + 5) : bcw ? Math.round((Number(bcw) + 0.71) * 7 + 5) : undefined,
  };
}

/** SheetJS ichidagi ZIP o'quvchi (CFB) — styles.xml va varaq XML'ini xom o'qish uchun (tiplari eksport qilinmagan). */
type Zip = { FullPaths: string[]; FileIndex: { content?: Uint8Array | number[] | null }[] };

const ERR_CODE: Record<number, string> = { 0x00: "#NULL!", 0x07: "#DIV/0!", 0x0f: "#VALUE!", 0x17: "#REF!", 0x1d: "#NAME?", 0x24: "#NUM!", 0x2a: "#N/A" };
const ERR_NUM = Object.fromEntries(Object.entries(ERR_CODE).map(([k, v]) => [v, Number(k)])) as Record<string, number>;

// ─────────────────────────── Import ───────────────────────────

/** Excel fayli → varaqlar (barchasi, yashirinlari ham, Excel tartibida). */
export function parseWorkbook(buf: Buffer): ParsedSheet[] {
  let wb: XLSX.WorkBook, zip: Zip;
  try {
    wb = XLSX.read(buf, { type: "buffer", cellFormula: true, cellStyles: true, cellNF: true, sheetStubs: true, dense: false });
    zip = (XLSX as unknown as { CFB: { read(b: Buffer, o: { type: "buffer" }): Zip } }).CFB.read(buf, { type: "buffer" });
  } catch {
    throw new SheetImportError("Fayl o'qilmadi — .xlsx Excel fayli bo'lishi kerak");
  }
  const file = (p: string) => {
    const i = zip.FullPaths.findIndex((x) => x.toLowerCase().endsWith("/" + p.toLowerCase()));
    return i >= 0 && zip.FileIndex[i].content ? Buffer.from(zip.FileIndex[i].content as Uint8Array).toString("utf8") : null;
  };
  const { xfs, baseSz } = parseXfs(file("xl/styles.xml"));
  // varaq nomi → XML yo'li (workbook.xml r:id → rels Target)
  const rels = new Map<string, string>();
  for (const m of (file("xl/_rels/workbook.xml.rels") ?? "").matchAll(/<Relationship\b[^>]*>/g)) {
    const id = attr(m[0], "Id"), t = attr(m[0], "Target");
    if (id && t) rels.set(id, t.replace(/^\/?xl\//, "").replace(/^\//, ""));
  }
  const pathOf = new Map<string, string>();
  for (const m of (file("xl/workbook.xml") ?? "").matchAll(/<sheet\b[^>]*>/g)) {
    const name = attr(m[0], "name"), rid = attr(m[0], "r:id");
    if (name && rid && rels.has(rid)) pathOf.set(unxml(name), "xl/" + rels.get(rid));
  }
  const hiddenNames = new Set((wb.Workbook?.Sheets ?? []).filter((s) => s.Hidden).map((s) => s.name));

  let total = 0;
  const out: ParsedSheet[] = [];
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    const sx = parseSheetXml(pathOf.has(name) ? file(pathOf.get(name)!) : null);
    const st: SheetStyle[] = [];
    const stKey = new Map<string, number>();
    const styleIdx = (s: SheetStyle) => {
      const k = JSON.stringify(s);
      if (k === "{}") return undefined;
      let i = stKey.get(k);
      if (i === undefined) { i = st.length; st.push(s); stKey.set(k, i); }
      return i;
    };
    const cells: Record<string, Cell> = {};
    let nr = 0, nc = 0;
    for (const a of Object.keys(ws)) {
      if (a[0] === "!") continue;
      const x = ws[a] as XLSX.CellObject & { s?: { patternType?: string; fgColor?: { rgb?: string } } };
      const rc = XLSX.utils.decode_cell(a);
      if (rc.r >= MAX_ROWS || rc.c >= MAX_COLS) continue;
      const style: SheetStyle = { ...(xfs[sx.styleOf.get(a) ?? -1] ?? {}) };
      if (style.fs) style.fs = Math.round((style.fs / baseSz) * 100) / 100; // nisbiy o'lcham (asosiy shriftga)
      const fill = x.s?.patternType && x.s.patternType !== "none" ? x.s.fgColor?.rgb : undefined;
      if (fill && /^[0-9A-Fa-f]{6,8}$/.test(fill)) {
        const hex = fill.slice(-6).toUpperCase();
        if (hex !== "FFFFFF") style.bg = hex;
      }
      if (x.z && x.z !== "General" && x.t !== "s") style.z = String(x.z);
      const c: Cell = {};
      if (x.f) c.f = x.f.replace(/^=/, "");
      if (x.t === "e") c.e = (typeof x.w === "string" && x.w.startsWith("#") ? x.w : ERR_CODE[Number(x.v)]) ?? "#VALUE!";
      else if (x.t === "n" || x.t === "s" || x.t === "b") c.v = x.v as number | string | boolean;
      else if (x.t === "d") c.v = x.v instanceof Date ? (x.v.getTime() / 86400000) + 25569 : String(x.v);
      const s = styleIdx(style);
      if (s !== undefined) c.s = s;
      if (c.v === undefined && !c.f && !c.e && c.s === undefined) continue;
      if (typeof c.v === "string" && c.v === "" && !c.f && c.s === undefined) continue;
      cells[a] = c;
      // varaq chegarasi: qiymat, formula yoki ko'rinadigan uslub (fon/chegara) bor kataklar
      if (c.v !== undefined || c.f || c.e || style.bg || style.bd) { nr = Math.max(nr, rc.r + 1); nc = Math.max(nc, rc.c + 1); }
    }
    total += Object.keys(cells).length;
    if (total > MAX_CELLS) throw new SheetImportError(`Fayl juda katta — ${fmtNum(MAX_CELLS)} katakdan ko'p`);
    const mg: SheetData["mg"] = (ws["!merges"] ?? [])
      .filter((m) => m.s.r < MAX_ROWS && m.s.c < MAX_COLS)
      .map((m) => [m.s.r, m.s.c, Math.min(m.e.r, MAX_ROWS - 1), Math.min(m.e.c, MAX_COLS - 1)]);
    for (const m of mg) { nr = Math.max(nr, m[2] + 1); nc = Math.max(nc, m[3] + 1); }
    // uslubi bor, lekin chegaradan tashqaridagi bo'sh kataklar olinmaydi
    for (const a of Object.keys(cells)) {
      const rc = XLSX.utils.decode_cell(a);
      if (rc.r >= nr || rc.c >= nc) delete cells[a];
    }
    const cw: Record<number, number> = {}, rh: Record<number, number> = {};
    const hc: number[] = [], hr: number[] = [];
    (ws["!cols"] ?? []).forEach((col, i) => {
      if (!col || i >= nc) return;
      if (col.hidden) hc.push(i);
      const px = col.wpx ?? (col.wch != null ? Math.round(col.wch * 7 + 5) : undefined);
      if (px != null) cw[i] = Math.max(2, Math.round(px));
    });
    (ws["!rows"] ?? []).forEach((row, i) => {
      if (!row || i >= nr) return;
      if (row.hidden) hr.push(i);
      // SheetJS `hpx` ni pt bilan bir xil beradi — haqiqiy piksel: pt × 4/3
      const px = row.hpt != null ? row.hpt * 4 / 3 : row.hpx;
      if (px != null) rh[i] = Math.max(2, Math.round(px));
    });
    const data: SheetData = { nr, nc, cw, rh, mg, st, cells };
    if (hc.length) data.hc = hc;
    if (hr.length) data.hr = hr;
    if (sx.frz) data.frz = [Math.min(sx.frz[0], nr), Math.min(sx.frz[1], nc)];
    if (sx.defRowPx) data.drh = sx.defRowPx;
    if (sx.defColPx) data.dcw = sx.defColPx;
    if (sx.zoom) data.zm = sx.zoom;
    data.bf = baseSz;
    out.push({ name, hidden: hiddenNames.has(name), data });
  }
  if (!out.length) throw new SheetImportError("Faylda varaq topilmadi");
  return out;
}

/** Import tekshiruvi: hisoblagich natijasi Excel saqlagan qiymatdan farq qiladigan formula kataklari (ko'pi bilan `limit`). */
export function verifySheets(sheets: { name: string; data: SheetData }[], limit = 20) {
  const book = new Book(sheets.map((s) => ({ name: s.name, cells: s.data.cells })));
  const diffs: { sheet: string; addr: string; f: string; excel: Val; erp: Val }[] = [];
  let formulas = 0, unsupported = 0;
  sheets.forEach((s, si) => {
    for (const [a, c] of Object.entries(s.data.cells)) {
      if (!c.f) continue;
      formulas++;
      if (!Book.supported(c.f)) { unsupported++; continue; }
      const rc = XLSX.utils.decode_cell(a);
      const got = book.value(si, rc.r, rc.c);
      const want: Val = c.e ? { err: c.e } : c.v ?? 0;
      const same = isErr(want) || isErr(got) ? isErr(want) && isErr(got) && want.err === got.err
        : typeof want === "number" && typeof got === "number" ? Math.abs(want - got) <= Math.max(1e-6, Math.abs(want) * 1e-9)
          : (want === "" && got === 0) || String(want) === String(got);
      if (!same && diffs.length < limit) diffs.push({ sheet: s.name, addr: a, f: c.f, excel: want, erp: got });
      else if (!same) diffs.length = limit;
    }
  });
  return { formulas, unsupported, diffs };
}

// ─────────────────────────── Baza ───────────────────────────

type Who = { userId: string };

/** Yangi kitob: barcha varaqlar bitta tranzaksiyada. */
export async function createWorkbook(who: Who, month: string, title: string, sheets: ParsedSheet[]) {
  return db.$transaction(async (tx) => {
    const wb = await tx.payrollWorkbook.create({ data: { month, title, createdById: who.userId } });
    await tx.payrollSheet.createMany({
      data: sheets.map((s, i) => ({ workbookId: wb.id, position: i, name: s.name, hidden: s.hidden, data: s.data as unknown as Prisma.InputJsonValue })),
    });
    await audit(tx, who.userId, "CREATE", "PayrollWorkbook", wb.id, undefined, { month, title, sheets: sheets.map((s) => s.name) });
    return wb;
  });
}

export async function listWorkbooks() {
  return db.payrollWorkbook.findMany({
    orderBy: [{ month: "desc" }, { createdAt: "desc" }],
    take: 120,
    select: { id: true, month: true, title: true, createdAt: true, updatedAt: true, cancelledAt: true, cancelReason: true },
  });
}

export async function loadWorkbook(id: string) {
  return db.payrollWorkbook.findUnique({
    where: { id },
    include: { sheets: { orderBy: { position: "asc" }, select: { id: true, position: true, name: true, hidden: true, data: true } } },
  });
}

const ADDR_RE = /^[A-Z]{1,3}[1-9]\d{0,6}$/;
/** Bir so'rovda ko'pi bilan shuncha katak (Excel'dan blok nusxa joylash). */
export const SAVE_MAX_CELLS = 2000;

/**
 * Kataklarni yozish (bitta yoki Excel'dan joylangan blok). Varaq qatori qulflanadi (FOR UPDATE), har katak `jsonb_set` bilan
 * alohida almashtiriladi — boshqa foydalanuvchining shu varaqdagi boshqa katak tahriri yo'qolmaydi. Uslub (`s`) saqlanadi,
 * AuditLog'ga har katakning eski/yangi qiymati yoziladi. Natija — yozilgan kataklar (o'chirilgani null).
 */
export async function saveCells(who: Who, sheetId: string, items: { addr: string; input: string }[]): Promise<{ error?: string; cells?: Record<string, Cell | null> }> {
  if (!items.length) return { cells: {} };
  if (items.length > SAVE_MAX_CELLS) return { error: `Bir martada ${fmtNum(SAVE_MAX_CELLS)} katakdan ko'p bo'lmasin` };
  const parsed: { addr: string; cell: Pick<Cell, "v" | "f"> }[] = [];
  for (const it of items) {
    if (!ADDR_RE.test(it.addr)) return { error: "Katak manzili noto'g'ri" };
    const rc = XLSX.utils.decode_cell(it.addr);
    if (rc.r >= MAX_ROWS || rc.c >= MAX_COLS) return { error: `${it.addr}: varaq chegarasidan tashqari (${fmtNum(MAX_ROWS)} qator, ${colName(MAX_COLS - 1)} ustun)` };
    if (it.input.length > 5000) return { error: `${it.addr}: matn juda uzun (5000 belgidan ko'p)` };
    const p = parseInput(it.input, numText);
    if (p.error) return { error: items.length > 1 ? `${it.addr}: ${p.error}` : p.error };
    parsed.push({ addr: it.addr, cell: p.cell });
  }
  return db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ cells: Record<string, Cell | null>; cancelled: Date | null; name: string }[]>`
      SELECT (SELECT jsonb_object_agg(k, s.data->'cells'->k) FROM unnest(${parsed.map((p) => p.addr)}::text[]) k) AS cells,
             w."cancelledAt" AS cancelled, s.name
      FROM "PayrollSheet" s JOIN "PayrollWorkbook" w ON w.id = s."workbookId"
      WHERE s.id = ${sheetId} FOR UPDATE OF s`;
    const row = rows[0];
    if (!row) return { error: "Varaq topilmadi" };
    if (row.cancelled) return { error: "Kitob bekor qilingan — tahrirlab bo'lmaydi" };
    const out: Record<string, Cell | null> = {};
    const changes: { addr: string; before: Cell | null; after: Cell | null }[] = [];
    let maxR = 0, maxC = 0;
    for (const p of parsed) {
      const old = row.cells?.[p.addr] ?? null;
      const next: Cell = { ...(old?.s !== undefined ? { s: old.s } : {}), ...p.cell };
      const after = next.v === undefined && !next.f && next.s === undefined ? null : next;
      out[p.addr] = after;
      if (JSON.stringify(old) === JSON.stringify(after)) continue;
      changes.push({ addr: p.addr, before: old, after });
      const rc = XLSX.utils.decode_cell(p.addr);
      maxR = Math.max(maxR, rc.r + 1); maxC = Math.max(maxC, rc.c + 1);
    }
    if (!changes.length) return { cells: out };
    for (const ch of changes) {
      if (ch.after === null) await tx.$executeRaw`UPDATE "PayrollSheet" SET data = data #- ARRAY['cells', ${ch.addr}]::text[] WHERE id = ${sheetId}`;
      else await tx.$executeRaw`UPDATE "PayrollSheet" SET data = jsonb_set(data, ARRAY['cells', ${ch.addr}]::text[], ${JSON.stringify(ch.after)}::jsonb, true) WHERE id = ${sheetId}`;
    }
    await tx.$executeRaw`
      UPDATE "PayrollSheet"
      SET data = jsonb_set(jsonb_set(data, '{nr}', to_jsonb(GREATEST((data->>'nr')::int, ${maxR}::int))), '{nc}', to_jsonb(GREATEST((data->>'nc')::int, ${maxC}::int))),
          "updatedAt" = now()
      WHERE id = ${sheetId}`;
    await tx.$executeRaw`UPDATE "PayrollWorkbook" SET "updatedAt" = now() WHERE id = (SELECT "workbookId" FROM "PayrollSheet" WHERE id = ${sheetId})`;
    await auditMany(tx, who.userId, "UPDATE", "PayrollSheet", changes.map((ch) => ({ id: sheetId, before: { sheet: row.name, addr: ch.addr, cell: ch.before }, after: { sheet: row.name, addr: ch.addr, cell: ch.after } })));
    return { cells: out };
  });
}

/** Kitobni bekor qilish (o'chirilmaydi): ro'yxatda «Bekor» bo'lib qoladi, tahrir yopiladi. */
export async function cancelWorkbook(who: Who, id: string, reason: string) {
  const r = reason.trim();
  if (!r) return { error: "Sababni yozing" };
  const n = await db.$transaction(async (tx) => {
    const u = await tx.payrollWorkbook.updateMany({ where: { id, cancelledAt: null }, data: { cancelledAt: new Date(), cancelledById: who.userId, cancelReason: r } });
    if (u.count) await audit(tx, who.userId, "STATUS_CHANGE", "PayrollWorkbook", id, { cancelledAt: null }, { cancelledAt: new Date(), reason: r });
    return u.count;
  });
  return n ? { ok: true as const } : { error: "Kitob topilmadi yoki allaqachon bekor qilingan" };
}

/** Joriy holat (tahrirlar bilan, formulalar qayta hisoblangan) → .xlsx. Uslub (fon, chegara) SheetJS bepul versiyasida yozilmaydi. */
export function workbookXlsx(sheets: { name: string; hidden: boolean; data: SheetData }[]): Buffer {
  const book = new Book(sheets.map((s) => ({ name: s.name, cells: s.data.cells })));
  const wb = XLSX.utils.book_new();
  sheets.forEach((s, si) => {
    const ws: XLSX.WorkSheet = {};
    for (const [a, c] of Object.entries(s.data.cells)) {
      const rc = XLSX.utils.decode_cell(a);
      const v = c.f ? book.value(si, rc.r, rc.c) : c.e ? { err: c.e } : c.v ?? null;
      if (v === null && !c.f) continue;
      const z = c.s !== undefined ? s.data.st[c.s]?.z : undefined;
      const o: XLSX.CellObject = isErr(v) ? { t: "e", v: ERR_NUM[v.err] ?? 0x0f, w: v.err } : typeof v === "number" ? { t: "n", v } : typeof v === "boolean" ? { t: "b", v } : { t: "s", v: v ?? "" };
      if (c.f) o.f = c.f;
      if (z) o.z = z;
      ws[a] = o;
    }
    ws["!ref"] = `A1:${colName(Math.max(0, s.data.nc - 1))}${Math.max(1, s.data.nr)}`;
    ws["!merges"] = s.data.mg.map(([r1, c1, r2, c2]) => ({ s: { r: r1, c: c1 }, e: { r: r2, c: c2 } }));
    ws["!cols"] = Array.from({ length: s.data.nc }, (_, i) => ({ wpx: s.data.cw[i] ?? s.data.dcw ?? 64, hidden: s.data.hc?.includes(i) || undefined }));
    ws["!rows"] = Array.from({ length: s.data.nr }, (_, i) => ({ hpx: s.data.rh[i] ?? s.data.drh ?? 20, hidden: s.data.hr?.includes(i) || undefined }));
    XLSX.utils.book_append_sheet(wb, ws, s.name.slice(0, 31));
  });
  wb.Workbook = { Sheets: sheets.map((s) => ({ name: s.name.slice(0, 31), Hidden: s.hidden ? 1 : 0 })) };
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

