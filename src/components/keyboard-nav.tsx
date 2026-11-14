"use client";

import { useEffect } from "react";

/**
 * Butun ilova bo'yicha «joystik» navigatsiyasi: ↑ ↓ ← → bosilgan tomondagi qo'shni katakka / maydonga o'tadi (Excel'dagidek
 * katakma-katak), Tab — brauzerning o'zi (keyingi maydon). Ilova qobig'ida bir marta ulanadi (`app-shell.tsx`).
 *
 * Qoidalar:
 *  · Jadvalda: ←→ — shu qatorda yonidagi katak, ↑↓ — yuqori/pastki qatorda eng yaqin ustundagi katak (avval shu katak ichidagi
 *    ustma-ust maydonlar). Jadval chetidan chiqilsa — jadvaldan tashqaridagi eng yaqin maydon (forma, oyna ichida).
 *  · Jadvalsiz formada: bosilgan tomondagi eng yaqin maydon (to'g'ri ostidagi/yonidagi afzal).
 *  · Matn maydonida ←→ faqat kursor chetida (yoki matn butunlay belgilangan) bo'lsa o'tadi — yozuvni tahrirlash buzilmaydi;
 *    o'tilgan maydondagi matn belgilanadi (Excel'dagidek: darrov yozish yoki yana o'tish mumkin).
 *  · Tegilmaydi: sana/vaqt, radio, slider maydonlari; ochiq ro'yxat (`aria-expanded="true"`); `data-nav="off"` ichidagi joy
 *    (o'z navigatsiyasi bor varaqlar, masalan zayavka «Excel ko'rinish»); boshqa komponent hodisani o'zi ishlatgan bo'lsa.
 *  · Faqat ko'rish uchun jadval (Sheet) kataklari ham bosib tanlanadi va strelka bilan yuriladi (`data-nav-cell`).
 */

type Dir = "up" | "down" | "left" | "right";
const DIRS: Record<string, Dir> = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" };
const SKIP_TYPES = new Set(["date", "time", "datetime-local", "month", "week", "range", "color", "radio", "file", "hidden"]);
const TEXT_TYPES = new Set(["text", "search", "tel", "url", "password", "email", ""]);
const FOCUSABLE = [
  "input:not([type=hidden]):not([disabled])", "select:not([disabled])", "textarea:not([disabled])", "button:not([disabled])",
  "a[href]", "[tabindex]:not([tabindex='-1'])", "[data-nav-cell]",
].join(",");
const OFF = "[data-nav='off'],[contenteditable=''],[contenteditable='true'],[role=menu],[role=menubar],[role=tree],[role=grid],[role=slider],[role=listbox]";

/** Strelka bilan kelingan va hali tegilmagan maydon — ←→ kursor qayerda ekanidan qat'i nazar keyingi katakka o'tadi */
let fresh: HTMLElement | null = null;

function visible(el: HTMLElement): boolean {
  if (el.closest("[inert],[aria-hidden='true']")) return false;
  // `checkVisibility` — tez (katta jadvalda minglab katak); eski brauzerda — o'lcham va uslub bo'yicha
  if (typeof el.checkVisibility === "function") return el.checkVisibility({ visibilityProperty: true });
  if (!el.getClientRects().length) return false;
  return getComputedStyle(el).visibility !== "hidden";
}

/** Shu element ichida (o'zidan tashqari) fokuslanadigan narsa bormi — bor bo'lsa katakning o'zi emas, ichidagisi tanlanadi */
const hasInner = (el: HTMLElement) => el.matches("[data-nav-cell]") && !!el.querySelector(FOCUSABLE.replace(",[data-nav-cell]", ""));

function candidates(scope: ParentNode, self: HTMLElement, skip?: Element | null): HTMLElement[] {
  const out: HTMLElement[] = [];
  scope.querySelectorAll<HTMLElement>(FOCUSABLE).forEach((el) => {
    if (el === self || el.contains(self) || (skip && skip.contains(el)) || el.closest(OFF)) return;
    if (el.tabIndex < 0 && !el.matches("[data-nav-cell]")) return; // ataylab Tab tartibidan olingan (ro'yxat qatori, yordamchi tugma)
    if (hasInner(el) || !visible(el)) return;
    out.push(el);
  });
  return out;
}

/** Matn maydonida kursor bo'yicha: ←→ — chetda bo'lsa; ↑↓ — bir qatorli maydonda doim, textarea'da birinchi/oxirgi qatorda */
function allows(el: HTMLElement, dir: Dir): boolean {
  if (el instanceof HTMLInputElement) {
    if (SKIP_TYPES.has(el.type)) return false;
    if (el.type === "checkbox" || el.type === "button" || el.type === "submit" || el.type === "reset") return true;
    if (el.list && (dir === "up" || dir === "down")) return false; // datalist takliflari — strelka ularga
    if (dir === "up" || dir === "down") return true;
    if (fresh === el || el.value === "") return true;
    if (!TEXT_TYPES.has(el.type)) return false; // number va h.k. — kursor joyi noma'lum: faqat bo'sh yoki strelka bilan kelingan bo'lsa
    const a = el.selectionStart ?? 0, b = el.selectionEnd ?? 0, n = el.value.length;
    if (a === 0 && b === n) return true;
    return dir === "left" ? a === 0 && b === 0 : a === n && b === n;
  }
  if (el instanceof HTMLTextAreaElement) {
    if (fresh === el || el.value === "") return true;
    const a = el.selectionStart, b = el.selectionEnd, n = el.value.length;
    if (dir === "left") return a === 0 && b === 0;
    if (dir === "right") return a === n && b === n;
    if (dir === "up") return a === b && !el.value.slice(0, a).includes("\n");
    return a === b && !el.value.slice(a).includes("\n");
  }
  return true;
}

type Box = { el: HTMLElement; r: DOMRect };
const boxes = (list: HTMLElement[]): Box[] => list.map((el) => ({ el, r: el.getBoundingClientRect() }));
const cx = (r: DOMRect) => r.left + r.width / 2;
const cy = (r: DOMRect) => r.top + r.height / 2;
/** Ikki oraliq orasidagi masofa (ustma-ust tushsa 0) */
const gap = (a1: number, a2: number, b1: number, b2: number) => Math.max(0, Math.max(a1, b1) - Math.min(a2, b2));

/** Bosilgan tomonda eng yaqini: asosiy o'q bo'yicha masofa + yon tomonga og'ish (to'g'ri ostidagi/yonidagi afzal) */
function nearest(from: DOMRect, list: Box[], dir: Dir): HTMLElement | null {
  let best: { el: HTMLElement; s: number } | null = null;
  for (const { el, r } of list) {
    let main: number, side: number;
    if (dir === "down") { if (cy(r) <= cy(from) + 1 || r.bottom <= from.bottom - 1) continue; main = Math.max(0, r.top - from.bottom); side = gap(r.left, r.right, from.left, from.right); }
    else if (dir === "up") { if (cy(r) >= cy(from) - 1 || r.top >= from.top + 1) continue; main = Math.max(0, from.top - r.bottom); side = gap(r.left, r.right, from.left, from.right); }
    else if (dir === "right") { if (cx(r) <= cx(from) + 1 || r.right <= from.right - 1) continue; main = Math.max(0, r.left - from.right); side = gap(r.top, r.bottom, from.top, from.bottom); }
    else { if (cx(r) >= cx(from) - 1 || r.left >= from.left + 1) continue; main = Math.max(0, from.left - r.right); side = gap(r.top, r.bottom, from.top, from.bottom); }
    // Yon og'ish qimmatroq: ←→ da boshqa qatorga, ↑↓ da boshqa ustunga sakrash oxirgi chora
    const off = dir === "left" || dir === "right" ? Math.abs(cy(r) - cy(from)) : Math.abs(cx(r) - cx(from));
    const s = main + side * (dir === "left" || dir === "right" ? 6 : 3) + off * 0.05;
    if (!best || s < best.s) best = { el, s };
  }
  return best?.el ?? null;
}

/** Jadval ichida: ←→ — shu qatorda; ↑↓ — shu katak ichida ustma-ust, keyin yuqori/pastki qatorlarda eng yaqin ustun */
function inTable(el: HTMLElement, dir: Dir): HTMLElement | null {
  const cell = el.closest<HTMLTableCellElement>("td,th");
  const row = cell?.parentElement as HTMLTableRowElement | null;
  const table = cell?.closest("table");
  if (!cell || !row || !table) return null;
  const from = el.getBoundingClientRect();
  if (dir === "left" || dir === "right") return nearest(from, boxes(candidates(row, el)), dir);
  // Shu katak ichida (masalan mahsulot maydoni ostidagi belgi)
  const own = cell === el ? null : nearest(from, boxes(candidates(cell, el)), dir);
  if (own) return own;
  const rows = Array.from(table.rows);
  let i = rows.indexOf(row);
  const step = dir === "down" ? 1 : -1;
  for (let k = 0; k < 400; k++) {
    i += step;
    const tr = rows[i];
    if (!tr) break;
    if (tr.closest("table") !== table) continue;
    const hit = nearest(from, boxes(candidates(tr, el)), dir);
    if (hit) return hit;
  }
  return null;
}

function find(el: HTMLElement, dir: Dir): HTMLElement | null {
  const t = inTable(el, dir);
  if (t) return t;
  const table = el.closest("table");
  // Jadvaldan chiqish yoki jadvalsiz: forma → oyna (modal ichidan chiqilmaydi) → sahifa
  const dialog = el.closest<HTMLElement>("[role=dialog],[aria-modal='true']");
  const scopes = [el.closest("form"), dialog ?? el.closest("main") ?? document.body].filter((x, i, a): x is HTMLElement => !!x && a.indexOf(x) === i);
  const from = el.getBoundingClientRect();
  for (const scope of scopes) {
    const list = candidates(scope, el, table);
    const hit = nearest(from, boxes(list), dir);
    if (hit) return hit;
  }
  return null;
}

function go(to: HTMLElement) {
  to.focus({ preventScroll: true });
  to.scrollIntoView({ block: "nearest", inline: "nearest" });
  if ((to instanceof HTMLInputElement && !SKIP_TYPES.has(to.type) && to.type !== "checkbox") || to instanceof HTMLTextAreaElement) {
    try { to.select(); } catch { /* ba'zi turlarda select yo'q */ }
    fresh = to;
  } else fresh = null;
}

export function KeyboardNav() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const dir = DIRS[e.key];
      if (!dir) { if (e.key.length === 1 || e.key === "Backspace" || e.key === "Delete") fresh = null; return; }
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.isComposing) return;
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body || el === document.documentElement) return;
      if (el.closest(OFF) || el.getAttribute("aria-expanded") === "true") return;
      if (!allows(el, dir)) return;
      const to = find(el, dir);
      if (!to) return;
      e.preventDefault();
      go(to);
    };
    const onDown = () => { fresh = null; };
    // Bubble bosqichida: komponentlar (ro'yxatlar, o'z varag'i) strelkani avval o'zi ishlatadi va `preventDefault` qiladi
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown, true);
    return () => { document.removeEventListener("keydown", onKey); document.removeEventListener("mousedown", onDown, true); };
  }, []);
  return null;
}
