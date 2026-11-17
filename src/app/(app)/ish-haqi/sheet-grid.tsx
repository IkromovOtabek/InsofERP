"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Eye, EyeOff, Loader2, Minus, Plus, Undo2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtNum, numText } from "@/lib/format";
import { Book, addrOf, colName, displayVal, isErr, parseInput, rawText, type Cell, type SheetData, type SheetStyle, type Val } from "@/lib/sheet-calc";
import { saveCellsAction } from "./varaq-actions";

/**
 * Oylik varaqlari — Excel kabi jadval: varaq tablari (pastda), formula satri, katak/blok tanlash, tahrir.
 *
 * Tahrir: katakka yozish yoki F2 / ikki marta bosish, Enter ↓, Tab →, Esc — bekor, Delete — tozalash,
 * Ctrl+Z — orqaga, Ctrl+C / Ctrl+V (Excel'dan blok ham). Formula yozilayotganda katak bosilsa — manzili qo'shiladi.
 * Saqlash darhol (`saveCellsAction`), formulalar shu zahoti brauzerda qayta hisoblanadi (`lib/sheet-calc.ts`).
 */

export type GridSheet = { id: string; name: string; hidden: boolean; data: SheetData };

const HEAD_H = 22, NUM_W = 44, DEF_W = 64, DEF_H = 20, PAD = 3;
const EXTRA_R = 15, EXTRA_C = 3; // tahrirda varaq oxiridan keyin bo'sh qator/ustunlar
const BASE_PT = 11; // kitobda asosiy shrift ko'rsatilmagan bo'lsa (Calibri 11)
const UNDO_MAX = 50;

type Pos = { r: number; c: number };
type Edit = { at: Pos; text: string; mode: "enter" | "edit"; bar?: boolean };
type Span = { rs: number; cs: number; r2: number; c2: number };

type Model = {
  rows: number[]; cols: number[];
  rPos: Map<number, number>; cPos: Map<number, number>;
  w: number[]; h: number[];
  span: Map<string, Span>; covered: Map<string, Pos>;
  frR: number; frC: number; top: number[]; left: number[];
  width: number;
};

const key = (r: number, c: number) => `${r}:${c}`;

function buildModel(d: SheetData, extra: boolean, z: number, showHidden: boolean): Model {
  const nr = Math.max(1, d.nr + (extra ? EXTRA_R : 0)), nc = Math.max(1, d.nc + (extra ? EXTRA_C : 0));
  const hr = new Set(showHidden ? [] : d.hr ?? []), hc = new Set(showHidden ? [] : d.hc ?? []);
  const rows: number[] = [], cols: number[] = [];
  for (let r = 0; r < nr; r++) if (!hr.has(r)) rows.push(r);
  for (let c = 0; c < nc; c++) if (!hc.has(c)) cols.push(c);
  const rPos = new Map(rows.map((r, i) => [r, i])), cPos = new Map(cols.map((c, i) => [c, i]));
  const w = cols.map((c) => Math.max(2, Math.round((d.cw[c] ?? d.dcw ?? DEF_W) * z))), h = rows.map((r) => Math.max(2, Math.round((d.rh[r] ?? d.drh ?? DEF_H) * z)));
  const span = new Map<string, Span>(), covered = new Map<string, Pos>();
  for (const [r1, c1, r2, c2] of d.mg) {
    if (hr.has(r1) || hc.has(c1)) continue;
    let rs = 0, cs = 0;
    for (let r = r1; r <= r2; r++) if (!hr.has(r)) rs++;
    for (let c = c1; c <= c2; c++) if (!hc.has(c)) cs++;
    span.set(key(r1, c1), { rs, cs, r2, c2 });
    for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) if (r !== r1 || c !== c1) covered.set(key(r, c), { r: r1, c: c1 });
  }
  const frR = rows.filter((r) => r < (d.frz?.[0] ?? 0)).length, frC = cols.filter((c) => c < (d.frz?.[1] ?? 0)).length;
  const top: number[] = [], left: number[] = [];
  for (let i = 0, t = HEAD_H; i < frR; i++) { top.push(t); t += h[i]; }
  for (let j = 0, l = NUM_W; j < frC; j++) { left.push(l); l += w[j]; }
  return { rows, cols, rPos, cPos, w, h, span, covered, frR, frC, top, left, width: NUM_W + w.reduce((x, y) => x + y, 0) };
}

/** Varaq uslublari → CSS sinflari (har katakka uzun `style` yozilmasin). Fon karta rangiga aralashadi (tunda to'q). */
function styleCss(st: SheetStyle[]): string {
  return st.map((s, i) => {
    const p: string[] = [];
    if (s.bg) p.push(`background:color-mix(in srgb,#${s.bg} var(--xl-mix),var(--color-white))`);
    if (s.b) p.push("font-weight:700");
    if (s.i) p.push("font-style:italic");
    if (s.fs) p.push(`font-size:${s.fs}em`);
    if (s.fc) p.push(`color:#${s.fc}`);
    if (s.ha) p.push(`text-align:${s.ha}`);
    if (s.va) p.push(`vertical-align:${s.va === "center" ? "middle" : s.va}`);
    return p.length ? `.xg .xs${i}{${p.join(";")}}` : "";
  }).join("");
}

const BASE_CSS = `.xg td.xl-in{background-image:linear-gradient(var(--xl-sel),var(--xl-sel))}
.xg td.xl-act{outline:2px solid var(--color-brand-600);outline-offset:-2px}
.xg .xl-c{overflow:hidden;white-space:nowrap;line-height:1.15}
.xg .xl-w{white-space:pre-wrap;overflow-wrap:anywhere}`;

type Ctx = {
  m: Model; d: SheetData; cells: Record<string, Cell>; book: Book; si: number;
  val: (r: number, c: number) => Val;
};

/** Katak ko'rinadigan matni va tekislashi. */
function shown(ctx: Ctx, r: number, c: number): { text: string; align: "left" | "right" | "center"; cell?: Cell; st?: SheetStyle } {
  const cell = ctx.cells[addrOf(r, c)];
  const st = cell?.s !== undefined ? ctx.d.st[cell.s] : undefined;
  if (!cell) return { text: "", align: "left" };
  const v = ctx.val(r, c);
  const text = displayVal(v, st?.z);
  const align = st?.ha ?? (typeof v === "number" ? "right" : typeof v === "boolean" || isErr(v) ? "center" : "left");
  return { text, align, cell, st };
}

type RowProps = { ctx: Ctx; vi: number; selC1: number; selC2: number; actC: number; edit: Edit | null; setEditText: (t: string) => void; onEditKey: (e: React.KeyboardEvent<HTMLInputElement>) => void; onEditBlur: () => void };

/** Tahrir maydoni ochilganda fokus va kursor matn oxiriga (Excel'dagidek). */
const focusEnd = (el: HTMLInputElement | null) => {
  if (el && document.activeElement !== el) { el.focus({ preventScroll: true }); el.setSelectionRange(el.value.length, el.value.length); }
};

const GridRow = memo(function GridRow({ ctx, vi, selC1, selC2, actC, edit, setEditText, onEditKey, onEditBlur }: RowProps) {
  const { m, d, cells } = ctx;
  const r = m.rows[vi];
  const frozenRow = vi < m.frR;
  const tds: React.ReactNode[] = [];
  const bdOf = (rr: number, cc: number) => { const c = cells[addrOf(rr, cc)]; return c?.s !== undefined ? d.st[c.s]?.bd ?? 0 : 0; };
  for (let ci = 0; ci < m.cols.length; ci++) {
    const c = m.cols[ci];
    if (m.covered.has(key(r, c))) continue;
    const sp = m.span.get(key(r, c));
    const cs = sp?.cs ?? 1, rs = sp?.rs ?? 1;
    const lastC = sp ? sp.c2 : c, lastR = sp ? sp.r2 : r;
    let width = 0;
    for (let j = ci; j < ci + cs && j < m.w.length; j++) width += m.w[j];
    let height = 0;
    for (let i = vi; i < vi + rs && i < m.h.length; i++) height += m.h[i];
    const { text, align, cell, st } = shown(ctx, r, c);
    // matn bo'sh qo'shni kataklarga chiqadi (Excel'dagidek), faqat chapga tekislangan, ko'chirilmaydigan matn
    let ow = width;
    if (text && !sp && align === "left" && !st?.w && typeof ctx.val(r, c) === "string") {
      for (let j = ci + 1; j < m.cols.length && ow < 1600; j++) {
        const cc = m.cols[j];
        if (m.span.has(key(r, cc)) || m.covered.has(key(r, cc))) break;
        const nc = cells[addrOf(r, cc)];
        if (nc && (nc.f || nc.e || (nc.v !== undefined && nc.v !== ""))) break;
        ow += m.w[j];
      }
    }
    const bd = st?.bd ?? 0;
    const darkR = !!(bd & 2) || !!(bdOf(r, lastC + 1) & 8) || !!(bdOf(r, lastC) & 2);
    const darkB = !!(bd & 4) || !!(bdOf(lastR + 1, c) & 1) || !!(bdOf(lastR, c) & 4);
    const frozenCol = ci < m.frC;
    const inSel = ci + cs - 1 >= selC1 && ci <= selC2;
    const isAct = ci === actC;
    const editing = edit && !edit.bar && edit.at.r === r && edit.at.c === c;
    const style: React.CSSProperties = {};
    if (darkR) style.borderRightColor = "var(--xl-bd)";
    if (darkB) style.borderBottomColor = "var(--xl-bd)";
    if (vi === 0 && bd & 1) style.borderTop = "1px solid var(--xl-bd)";
    if (ci === 0 && bd & 8) style.borderLeft = "1px solid var(--xl-bd)";
    if (!st?.ha) style.textAlign = align;
    if (frozenRow || frozenCol || editing) {
      style.position = "sticky";
      if (frozenRow) style.top = m.top[vi];
      if (frozenCol) style.left = m.left[ci];
      style.zIndex = editing ? 30 : frozenRow && frozenCol ? 12 : 10;
      if (editing && !frozenRow && !frozenCol) style.position = "relative";
    }
    tds.push(
      <td key={c} data-r={r} data-c={c} {...(cs > 1 ? { colSpan: cs } : null)} {...(rs > 1 ? { rowSpan: rs } : null)}
        className={cn("border-r border-b border-(--xl-grid) bg-(--color-white) align-bottom", cell?.s !== undefined && `xs${cell.s}`, inSel && "xl-in", isAct && "xl-act")}
        style={style}>
        {editing ? (
          <input ref={focusEnd} value={edit.text} onChange={(e) => setEditText(e.target.value)} onKeyDown={onEditKey} onBlur={onEditBlur} spellCheck={false}
            className="absolute inset-y-0 left-0 z-30 h-full border-0 bg-(--color-white) px-[3px] text-[length:inherit] text-slate-900 outline-2 outline-brand-600"
            style={{ width: Math.max(width, Math.min(480, edit.text.length * 7 + 24)) }} />
        ) : (
          <div className={cn("xl-c", st?.w && "xl-w")} style={{ width: ow - PAD * 2 - 1, maxHeight: height - 1, paddingInline: PAD, boxSizing: "content-box" }}>{text}</div>
        )}
      </td>,
    );
  }
  return (
    <tr style={{ height: m.h[vi] }}>
      <th scope="row" data-rh={r}
        className={cn("sticky left-0 border-r border-b border-(--xl-grid) bg-slate-50 px-1 text-right text-[11px] font-normal text-slate-500 select-none", selC1 >= 0 && "bg-brand-50 text-brand-700")}
        style={{ zIndex: frozenRow ? 14 : 11, ...(frozenRow ? { top: m.top[vi] } : null) }}>
        {r + 1}
      </th>
      {tds}
    </tr>
  );
});

export function SheetGrid({ sheets, canEdit, initial }: { sheets: GridSheet[]; canEdit: boolean; initial?: string }) {
  const firstVisible = Math.max(0, sheets.findIndex((s) => !s.hidden));
  const [si, setSi] = useState(() => {
    const i = initial ? sheets.findIndex((s) => s.name === initial) : -1;
    return i >= 0 ? i : firstVisible;
  });
  const sheet = sheets[si] ?? sheets[0];
  // Saqlangan (yoki saqlanayotgan) tahrirlar: varaq id → manzil → katak (null — o'chirilgan)
  const [edits, setEdits] = useState<Record<string, Record<string, Cell | null>>>({});
  const editsRef = useRef(edits);
  editsRef.current = edits;
  const pending = useRef(new Map<string, number>());
  const [busy, setBusy] = useState(0);
  const [msg, setMsg] = useState<{ tone: "error" | "ok"; text: string } | null>(null);
  const [act, setAct] = useState<Pos>({ r: 0, c: 0 });
  const [foc, setFoc] = useState<Pos>({ r: 0, c: 0 });
  const [edit, setEditState] = useState<Edit | null>(null);
  const editRef = useRef<Edit | null>(null);
  const setEdit = useCallback((e: Edit | null) => { editRef.current = e; setEditState(e); }, []);
  const undo = useRef<{ sheetId: string; items: { addr: string; input: string }[] }[]>([]);
  const gridRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  // Server yangi ma'lumot yuborsa (sahifa yangilandi) — saqlanib bo'lgan tahrirlar endi props'da; faqat kutilayotganlari qoladi
  useEffect(() => {
    setEdits((prev) => {
      const next: typeof prev = {};
      for (const [sid, m] of Object.entries(prev)) for (const [a, c] of Object.entries(m)) if (pending.current.get(`${sid}!${a}`)) (next[sid] ??= {})[a] = c;
      return next;
    });
  }, [sheets]);

  const effCells = useMemo(() => sheets.map((s) => {
    const e = edits[s.id];
    if (!e) return s.data.cells;
    const out = { ...s.data.cells };
    for (const [a, c] of Object.entries(e)) { if (c) out[a] = c; else delete out[a]; }
    return out;
  }), [sheets, edits]);
  const book = useMemo(() => new Book(sheets.map((s, i) => ({ name: s.name, cells: effCells[i] }))), [sheets, effCells]);

  const data = useMemo<SheetData>(() => {
    const d = sheet.data, e = edits[sheet.id];
    if (!e) return d;
    let nr = d.nr, nc = d.nc;
    for (const a of Object.keys(e)) {
      const m = /^([A-Z]+)(\d+)$/.exec(a);
      if (!m) continue;
      nr = Math.max(nr, Number(m[2]));
      let n = 0;
      for (const ch of m[1]) n = n * 26 + ch.charCodeAt(0) - 64;
      nc = Math.max(nc, n);
    }
    return nr === d.nr && nc === d.nc ? d : { ...d, nr, nc };
  }, [sheet, edits]);
  // Masshtab: Excel'dagi (varaq saqlagan) yoki foydalanuvchi tanlagan
  const [zooms, setZooms] = useState<Record<number, number>>({});
  const zoom = zooms[si] ?? data.zm ?? 100;
  const setZoom = (v: number) => setZooms((p) => ({ ...p, [si]: Math.min(150, Math.max(40, v)) }));
  // Excel'da yashirilgan ustun/satrlar (masalan, kunlik summalar) — tugma bilan ko'rsatiladi
  const [showHidden, setShowHidden] = useState(false);
  const hasHidden = !!(data.hc?.length || data.hr?.length);
  const m = useMemo(() => buildModel(data, canEdit, zoom / 100, showHidden), [data, canEdit, zoom, showHidden]);
  const ctx = useMemo<Ctx>(() => ({ m, d: data, cells: effCells[si], book, si, val: (r, c) => book.value(si, r, c) }), [m, data, effCells, si, book]);
  const css = useMemo(() => BASE_CSS + styleCss(data.st), [data.st]);

  // Varaq almashsa — tanlov boshiga, URL'da varaq nomi (yangilanganda shu varaq ochilsin)
  const pickSheet = (i: number) => {
    if (editRef.current) commit();
    setSi(i);
    const d = sheets[i].data;
    const p = { r: d.frz?.[0] ?? 0, c: d.frz?.[1] ?? 0 };
    setAct(p); setFoc(p); setMsg(null);
    gridRef.current?.scrollTo({ top: 0, left: 0 });
    const u = new URL(window.location.href);
    u.searchParams.set("varaq", sheets[i].name);
    window.history.replaceState(null, "", u.toString());
  };

  const anchorOf = (p: Pos): Pos => m.covered.get(key(p.r, p.c)) ?? p;
  const cellOf = (p: Pos) => ctx.cells[addrOf(p.r, p.c)];

  /** Kataklarni saqlash: darhol ko'rinadi (optimistik), xato bo'lsa qaytariladi. */
  const save = useCallback(async (sheetId: string, items: { addr: string; input: string }[], cellsNow: Record<string, Cell>, record = true) => {
    if (!items.length) return true;
    const opt: Record<string, Cell | null> = {};
    for (const it of items) {
      const p = parseInput(it.input, numText);
      if (p.error) { setMsg({ tone: "error", text: items.length > 1 ? `${it.addr}: ${p.error}` : p.error }); return false; }
      const old = cellsNow[it.addr];
      const next: Cell = { ...(old?.s !== undefined ? { s: old.s } : {}), ...p.cell };
      opt[it.addr] = next.v === undefined && !next.f && next.s === undefined ? null : next;
    }
    const prevOverride = editsRef.current[sheetId] ?? {};
    const restore: Record<string, Cell | null | undefined> = {};
    for (const a of Object.keys(opt)) restore[a] = a in prevOverride ? prevOverride[a] : undefined;
    const before = items.map((it) => ({ addr: it.addr, input: rawText(cellsNow[it.addr]) }));
    setEdits((prev) => ({ ...prev, [sheetId]: { ...prev[sheetId], ...opt } }));
    for (const a of Object.keys(opt)) pending.current.set(`${sheetId}!${a}`, (pending.current.get(`${sheetId}!${a}`) ?? 0) + 1);
    setBusy((n) => n + 1);
    setMsg(null);
    let res: { error?: string; cells?: Record<string, Cell | null> };
    try { res = await saveCellsAction(sheetId, items); } catch { res = { error: "Saqlanmadi — internet yoki sessiyani tekshiring" }; }
    for (const a of Object.keys(opt)) {
      const k = `${sheetId}!${a}`, n = (pending.current.get(k) ?? 1) - 1;
      if (n > 0) pending.current.set(k, n); else pending.current.delete(k);
    }
    setBusy((n) => n - 1);
    if (res.error || !res.cells) {
      setEdits((prev) => {
        const cur = { ...prev[sheetId] };
        for (const [a, v] of Object.entries(restore)) { if (v === undefined) delete cur[a]; else cur[a] = v; }
        return { ...prev, [sheetId]: cur };
      });
      setMsg({ tone: "error", text: res.error ?? "Saqlanmadi" });
      return false;
    }
    const saved = res.cells;
    setEdits((prev) => ({ ...prev, [sheetId]: { ...prev[sheetId], ...saved } }));
    if (record) { undo.current.push({ sheetId, items: before }); if (undo.current.length > UNDO_MAX) undo.current.shift(); }
    return true;
  }, []);

  /** Tahrirni yakunlash: formula xato bo'lsa tahrir ochiq qoladi. */
  function commit(move?: [number, number]) {
    const e = editRef.current;
    if (!e) return true;
    const a = addrOf(e.at.r, e.at.c);
    const cur = rawText(ctx.cells[a]);
    if (e.text !== cur) {
      const p = parseInput(e.text, numText);
      if (p.error) { setMsg({ tone: "error", text: p.error }); return false; }
      void save(sheet.id, [{ addr: a, input: e.text }], ctx.cells);
    }
    setEdit(null);
    if (move) moveBy(move[0], move[1], false, e.at);
    gridRef.current?.focus({ preventScroll: true });
    return true;
  }
  const cancelEdit = () => { setEdit(null); setMsg(null); gridRef.current?.focus({ preventScroll: true }); };

  function scrollTo(p: Pos) {
    requestAnimationFrame(() => {
      const td = gridRef.current?.querySelector<HTMLElement>(`td[data-r="${p.r}"][data-c="${p.c}"]`);
      td?.scrollIntoView({ block: "nearest", inline: "nearest" });
    });
  }

  function moveBy(dr: number, dc: number, extend: boolean, from?: Pos) {
    const base = from ?? (extend ? foc : act);
    const sp = m.span.get(key(base.r, base.c));
    let ri = m.rPos.get(base.r) ?? 0, ci = m.cPos.get(base.c) ?? 0;
    if (dr > 0 && sp && !extend) ri = m.rPos.get(sp.r2) ?? ri;
    if (dc > 0 && sp && !extend) ci = m.cPos.get(sp.c2) ?? ci;
    ri = Math.min(m.rows.length - 1, Math.max(0, ri + dr));
    ci = Math.min(m.cols.length - 1, Math.max(0, ci + dc));
    const p = { r: m.rows[ri], c: m.cols[ci] };
    if (extend) { setFoc(p); scrollTo(p); return; }
    const a = anchorOf(p);
    setAct(a); setFoc(a); scrollTo(a);
  }

  const startEdit = (text: string, mode: Edit["mode"], bar = false) => {
    if (!canEdit) return;
    setMsg(null);
    setEdit({ at: act, text, mode, bar });
  };

  // Tanlangan oraliq (ko'rinadigan pozitsiyalarda)
  const sr1 = Math.min(m.rPos.get(act.r) ?? 0, m.rPos.get(foc.r) ?? 0), sr2 = Math.max(m.rPos.get(act.r) ?? 0, m.rPos.get(foc.r) ?? 0);
  const sc1 = Math.min(m.cPos.get(act.c) ?? 0, m.cPos.get(foc.c) ?? 0), sc2 = Math.max(m.cPos.get(act.c) ?? 0, m.cPos.get(foc.c) ?? 0);
  const actSp = m.span.get(key(act.r, act.c));
  const selR2 = Math.max(sr2, actSp ? m.rPos.get(actSp.r2) ?? sr2 : sr2), selC2 = Math.max(sc2, actSp ? m.cPos.get(actSp.c2) ?? sc2 : sc2);
  const multi = sr1 !== selR2 || sc1 !== selC2;
  const selAddrs = () => {
    const out: string[] = [];
    for (let i = sr1; i <= selR2; i++) for (let j = sc1; j <= selC2; j++) if (!m.covered.has(key(m.rows[i], m.cols[j]))) out.push(addrOf(m.rows[i], m.cols[j]));
    return out;
  };
  const stats = useMemo(() => {
    if (!multi) return null;
    let n = 0, sum = 0, cnt = 0;
    for (let i = sr1; i <= selR2 && cnt < 20000; i++) for (let j = sc1; j <= selC2; j++, cnt++) {
      const v = ctx.val(m.rows[i], m.cols[j]);
      if (typeof v === "number") { n++; sum += v; }
    }
    return n ? { n, sum, avg: sum / n } : null;
  }, [multi, sr1, selR2, sc1, selC2, ctx, m]);

  async function clearSel() {
    if (!canEdit) return;
    const items = selAddrs().filter((a) => { const c = ctx.cells[a]; return c && (c.v !== undefined || c.f || c.e); }).map((addr) => ({ addr, input: "" }));
    await save(sheet.id, items, ctx.cells);
  }

  async function doUndo() {
    const last = undo.current.pop();
    if (!last) { setMsg({ tone: "ok", text: "Orqaga qaytariladigan amal yo'q" }); return; }
    const i = sheets.findIndex((s) => s.id === last.sheetId);
    if (i < 0) return;
    if (i !== si) pickSheet(i);
    await save(last.sheetId, last.items, effCells[i], false);
  }

  function onGridKey(e: React.KeyboardEvent<HTMLDivElement>) {
    if (editRef.current) return; // tahrir maydoni o'zi boshqaradi
    const k = e.key, mod = e.ctrlKey || e.metaKey;
    const moves: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    if (moves[k]) { e.preventDefault(); moveBy(moves[k][0], moves[k][1], e.shiftKey); return; }
    if (k === "Enter") { e.preventDefault(); moveBy(e.shiftKey ? -1 : 1, 0, false); return; }
    if (k === "Tab") { e.preventDefault(); moveBy(0, e.shiftKey ? -1 : 1, false); return; }
    if (k === "Home") { e.preventDefault(); const p = { r: mod ? m.rows[0] : act.r, c: m.cols[0] }; setAct(p); setFoc(p); scrollTo(p); return; }
    if (k === "F2") { e.preventDefault(); startEdit(rawText(cellOf(act)), "edit"); return; }
    if (mod && (k === "z" || k === "Z" || k === "я" || k === "Я")) { e.preventDefault(); if (canEdit) void doUndo(); return; }
    if (mod && (k === "c" || k === "C" || k === "с" || k === "С")) { e.preventDefault(); void copySel(); return; }
    if (mod && (k === "a" || k === "A")) { e.preventDefault(); const a = { r: m.rows[0], c: m.cols[0] }, b = { r: m.rows[m.rows.length - 1], c: m.cols[m.cols.length - 1] }; setAct(a); setFoc(b); return; }
    if (k === "Delete" || k === "Backspace") { e.preventDefault(); void clearSel(); return; }
    if (!mod && !e.altKey && k.length === 1 && canEdit) { e.preventDefault(); setFoc(act); startEdit(k, "enter"); }
  }

  const onEditKey = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    const ed = editRef.current;
    if (!ed) return;
    if (e.key === "Enter") { e.preventDefault(); commitRef.current(e.altKey ? undefined : [e.shiftKey ? -1 : 1, 0]); return; }
    if (e.key === "Tab") { e.preventDefault(); commitRef.current([0, e.shiftKey ? -1 : 1]); return; }
    if (e.key === "Escape") { e.preventDefault(); cancelRef.current(); return; }
    const arrows: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    if (ed.mode === "enter" && arrows[e.key]) { e.preventDefault(); commitRef.current(arrows[e.key]); }
  }, []);
  const commitRef = useRef(commit);
  commitRef.current = commit;
  const cancelRef = useRef(cancelEdit);
  cancelRef.current = cancelEdit;
  const onEditBlur = useCallback(() => { if (editRef.current && !editRef.current.bar) commitRef.current(); }, []);
  const setEditText = useCallback((t: string) => { const e = editRef.current; if (e) setEdit({ ...e, text: t }); }, [setEdit]);

  async function copySel() {
    const lines: string[] = [];
    for (let i = sr1; i <= selR2; i++) {
      const row: string[] = [];
      for (let j = sc1; j <= selC2; j++) row.push(shown(ctx, m.rows[i], m.cols[j]).text.replace(/[\t\n]/g, " "));
      lines.push(row.join("\t"));
    }
    try { await navigator.clipboard.writeText(lines.join("\n")); setMsg({ tone: "ok", text: multi ? "Nusxa olindi" : "Katak nusxasi olindi" }); } catch { setMsg({ tone: "error", text: "Brauzer nusxa olishga ruxsat bermadi" }); }
  }

  function onPaste(e: React.ClipboardEvent<HTMLDivElement>) {
    if (editRef.current || !canEdit) return;
    const text = e.clipboardData.getData("text/plain");
    if (!text) return;
    e.preventDefault();
    const rowsTxt = text.replace(/\r/g, "").replace(/\n$/, "").split("\n").map((l) => l.split("\t"));
    const items: { addr: string; input: string }[] = [];
    const r0 = sr1, c0 = sc1;
    if (rowsTxt.length === 1 && rowsTxt[0].length === 1 && multi) {
      for (const a of selAddrs()) items.push({ addr: a, input: rowsTxt[0][0] });
    } else {
      rowsTxt.forEach((line, i) => line.forEach((v, j) => {
        const r = m.rows[r0 + i], c = m.cols[c0 + j];
        if (r === undefined || c === undefined || m.covered.has(key(r, c))) return;
        items.push({ addr: addrOf(r, c), input: v });
      }));
      const lastR = m.rows[Math.min(m.rows.length - 1, r0 + rowsTxt.length - 1)], lastC = m.cols[Math.min(m.cols.length - 1, c0 + Math.max(...rowsTxt.map((l) => l.length)) - 1)];
      setFoc({ r: lastR, c: lastC });
    }
    void save(sheet.id, items, ctx.cells);
  }

  function posFromEvent(e: React.MouseEvent): Pos | null {
    const td = (e.target as HTMLElement).closest<HTMLElement>("td[data-r]");
    if (!td) return null;
    return { r: Number(td.dataset.r), c: Number(td.dataset.c) };
  }

  function onMouseDown(e: React.MouseEvent) {
    if (e.button !== 0) return;
    const rowHead = (e.target as HTMLElement).closest<HTMLElement>("th[data-rh]");
    const colHead = (e.target as HTMLElement).closest<HTMLElement>("th[data-ch]");
    if (rowHead || colHead) {
      if (editRef.current && !commit()) return;
      e.preventDefault();
      if (rowHead) { const r = Number(rowHead.dataset.rh); setAct({ r, c: m.cols[0] }); setFoc({ r, c: m.cols[m.cols.length - 1] }); }
      else { const c = Number(colHead!.dataset.ch); setAct({ r: m.rows[0], c }); setFoc({ r: m.rows[m.rows.length - 1], c }); }
      gridRef.current?.focus({ preventScroll: true });
      return;
    }
    const p = posFromEvent(e);
    if (!p) return;
    const ed = editRef.current;
    if (ed && ed.at.r === p.r && ed.at.c === p.c && !ed.bar) return; // tahrir qilinayotgan katakning o'zi
    // formula yozilmoqda va operator/qavsdan keyin — bosilgan katak manzili formulaga qo'shiladi
    if (ed && ed.text.startsWith("=") && /[=+\-*/^(,;:&<>]$/.test(ed.text)) {
      e.preventDefault();
      setEdit({ ...ed, text: ed.text + addrOf(p.r, p.c), mode: "edit" });
      return;
    }
    if (ed && !commit()) return;
    e.preventDefault();
    gridRef.current?.focus({ preventScroll: true });
    if (e.shiftKey) { setFoc(p); return; }
    const a = anchorOf(p);
    setAct(a); setFoc(a);
    dragging.current = true;
  }
  function onMouseOver(e: React.MouseEvent) {
    if (!dragging.current || !(e.buttons & 1)) { dragging.current = false; return; }
    const p = posFromEvent(e);
    if (p && (p.r !== foc.r || p.c !== foc.c)) setFoc(p);
  }
  function onDoubleClick(e: React.MouseEvent) {
    const p = posFromEvent(e);
    if (!p || !canEdit) return;
    const a = anchorOf(p);
    setAct(a); setFoc(a);
    setMsg(null);
    setEdit({ at: a, text: rawText(cellOf(a)), mode: "edit" });
  }
  useEffect(() => {
    const up = () => { dragging.current = false; };
    window.addEventListener("mouseup", up);
    return () => window.removeEventListener("mouseup", up);
  }, []);

  const actCell = cellOf(act);
  const barText = edit ? edit.text : rawText(actCell);
  const actSt = actCell?.s !== undefined ? data.st[actCell.s] : undefined;
  const actShown = actCell?.f ? displayVal(ctx.val(act.r, act.c), actSt?.z) : null;
  const refLabel = multi ? `${addrOf(m.rows[sr1], m.cols[sc1])}:${addrOf(m.rows[selR2], m.cols[selC2])}` : addrOf(act.r, act.c);
  const hiddenCols = useMemo(() => new Set(data.hc ?? []), [data.hc]);
  const frozenH = m.top.length ? m.top[m.top.length - 1] + m.h[m.frR - 1] : HEAD_H;
  const frozenW = m.left.length ? m.left[m.left.length - 1] + m.w[m.frC - 1] : NUM_W;

  return (
    <div className="xg flex min-w-0 flex-col overflow-hidden rounded-(--radius-card) border border-slate-300/80 bg-white shadow-(--shadow-card) [--xl-bd:var(--color-slate-500)] [--xl-grid:var(--color-slate-200)] [--xl-mix:88%] [--xl-sel:rgb(37_99_235/0.12)] dark:[--xl-mix:38%] dark:[--xl-sel:rgb(96_165_250/0.18)]">
      <style>{css}</style>
      {/* Formula satri */}
      <div className="flex items-center gap-2 border-b border-slate-200 bg-slate-50 px-2 py-1.5">
        <span className="w-24 shrink-0 truncate rounded border border-slate-200 bg-white px-2 py-1 text-center text-xs font-medium text-slate-700 tabular" title={refLabel}>{refLabel}</span>
        <span className="shrink-0 text-xs font-semibold text-slate-400 italic">fx</span>
        <input
          value={barText} readOnly={!canEdit} spellCheck={false}
          onFocus={() => { if (canEdit && !editRef.current) startEdit(rawText(actCell), "edit", true); }}
          onChange={(e) => { const ed = editRef.current; if (ed) setEdit({ ...ed, text: e.target.value }); }}
          onKeyDown={(e) => {
            if (!editRef.current) return;
            if (e.key === "Enter") { e.preventDefault(); commit([1, 0]); }
            else if (e.key === "Escape") { e.preventDefault(); cancelEdit(); }
            else if (e.key === "Tab") { e.preventDefault(); commit([0, 1]); }
          }}
          onBlur={() => { if (editRef.current?.bar) commit(); }}
          className="h-7 min-w-0 flex-1 rounded border border-slate-200 bg-white px-2 font-(family-name:--font-inter) text-[13px] text-slate-900 focus:border-brand-500 focus:outline-none read-only:bg-slate-50"
          placeholder={canEdit ? "Katakni tanlang va yozing — formula «=» bilan boshlanadi" : ""} />
        {actShown != null && !edit && <span className="hidden shrink-0 text-xs text-slate-500 tabular sm:inline" title="Formula natijasi">= {actShown}</span>}
        <span className="flex w-28 shrink-0 items-center justify-end gap-1 text-xs text-slate-500">
          {busy > 0 ? <><Loader2 size={13} className="animate-spin" /> Saqlanmoqda…</> : canEdit ? <><Check size={13} className="text-emerald-600" /> Saqlangan</> : "Faqat ko'rish"}
        </span>
        {canEdit && <button type="button" onClick={() => void doUndo()} title="Orqaga (Ctrl+Z)" aria-label="Orqaga" className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded text-slate-500 hover:bg-slate-200 hover:text-slate-900"><Undo2 size={15} /></button>}
      </div>
      {msg && (
        <div className={cn("flex items-center justify-between gap-2 border-b px-3 py-1.5 text-xs", msg.tone === "error" ? "border-red-200 bg-red-50 text-red-700" : "border-emerald-200 bg-emerald-50 text-emerald-700")}>
          <span>{msg.text}</span>
          <button type="button" className="opacity-70 hover:underline" onClick={() => setMsg(null)}>Yopish</button>
        </div>
      )}
      {/* Jadval */}
      <div ref={gridRef} tabIndex={0} lang="ru" onKeyDown={onGridKey} onPaste={onPaste} onMouseDown={onMouseDown} onMouseOver={onMouseOver} onDoubleClick={onDoubleClick}
        className="relative h-[calc(100dvh-300px)] min-h-[420px] overflow-auto overscroll-contain outline-none select-none"
        style={{ scrollPaddingTop: frozenH, scrollPaddingLeft: frozenW }}>
        <table className="table-fixed border-separate border-spacing-0 font-(family-name:--font-inter) text-slate-900 tabular" style={{ width: m.width, fontSize: Math.round(((data.bf ?? BASE_PT) * 4 / 3) * zoom) / 100 }}>
          <colgroup>
            <col style={{ width: NUM_W }} />
            {m.w.map((w, i) => <col key={m.cols[i]} style={{ width: w }} />)}
          </colgroup>
          <thead>
            <tr style={{ height: HEAD_H }}>
              <th className="sticky top-0 left-0 z-20 border-r border-b border-(--xl-grid) bg-slate-100" />
              {m.cols.map((c, j) => (
                <th key={c} data-ch={c} scope="col"
                  className={cn("sticky top-0 border-r border-b border-(--xl-grid) bg-slate-100 text-center text-[11px] font-normal text-slate-500 select-none", j >= sc1 && j <= selC2 && "bg-brand-50 text-brand-700", showHidden && hiddenCols.has(c) && "italic text-amber-700")}
                  style={{ zIndex: j < m.frC ? 19 : 15, ...(j < m.frC ? { left: m.left[j] } : null) }}>
                  {colName(c)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {m.rows.map((r, vi) => {
              const inRow = vi >= sr1 && vi <= selR2;
              const editHere = edit && edit.at.r === r ? edit : null;
              return (
                <GridRow key={r} ctx={ctx} vi={vi} selC1={inRow ? sc1 : -1} selC2={inRow ? selC2 : -1}
                  actC={r === act.r ? m.cPos.get(act.c) ?? -1 : -1} edit={editHere} setEditText={setEditText} onEditKey={onEditKey} onEditBlur={onEditBlur} />
              );
            })}
          </tbody>
        </table>
      </div>
      {/* Varaq tablari va holat satri */}
      <div className="flex items-stretch gap-2 border-t border-slate-200 bg-slate-50">
        <nav className="flex min-w-0 flex-1 overflow-x-auto" aria-label="Varaqlar">
          {sheets.map((s, i) => (
            <button key={s.id} type="button" onClick={() => pickSheet(i)} title={s.hidden ? "Excel'da yashirin varaq" : undefined}
              className={cn("inline-flex shrink-0 items-center gap-1 border-r border-slate-200 px-3 py-1.5 text-[13px] whitespace-nowrap transition",
                i === si ? "-mt-px border-t-2 border-t-emerald-600 bg-white font-semibold text-emerald-800" : "text-slate-600 hover:bg-white hover:text-slate-900",
                s.hidden && i !== si && "text-slate-400")}>
              {s.hidden && <EyeOff size={12} />}{s.name.trim() || `Varaq ${i + 1}`}
            </button>
          ))}
        </nav>
        {hasHidden && (
          <button type="button" onClick={() => setShowHidden((v) => !v)} title="Excel'da yashirilgan ustun va satrlar"
            className={cn("inline-flex shrink-0 items-center gap-1 px-2 text-xs hover:bg-slate-200", showHidden ? "text-brand-700" : "text-slate-500")}>
            {showHidden ? <Eye size={13} /> : <EyeOff size={13} />} {showHidden ? "Yashirinlar ko'rinmoqda" : `Yashirin: ${(data.hc?.length ?? 0) + (data.hr?.length ?? 0)}`}
          </button>
        )}
        <span className="flex shrink-0 items-center gap-0.5 px-2 text-xs text-slate-500" aria-label="Masshtab">
          <button type="button" onClick={() => setZoom(zoom - 10)} className="inline-flex h-6 w-6 items-center justify-center rounded hover:bg-slate-200" title="Kichraytirish"><Minus size={13} /></button>
          <button type="button" onClick={() => setZoom(100)} className="w-10 rounded text-center tabular hover:bg-slate-200" title="100% ga qaytarish">{zoom}%</button>
          <button type="button" onClick={() => setZoom(zoom + 10)} className="inline-flex h-6 w-6 items-center justify-center rounded hover:bg-slate-200" title="Kattalashtirish"><Plus size={13} /></button>
        </span>
        {stats && (
          <span className="flex shrink-0 items-center gap-3 px-3 text-xs text-slate-600 tabular">
            <span>Soni: {stats.n}</span>
            <span>Yig&apos;indi: <b className="text-slate-900">{fmtNum(stats.sum, 2)}</b></span>
            <span className="hidden md:inline">O&apos;rtacha: {fmtNum(stats.avg, 2)}</span>
          </span>
        )}
      </div>
    </div>
  );
}
