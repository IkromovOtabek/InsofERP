"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { toCyrillic, YOZUV_COOKIE, type Yozuv } from "@/lib/translit";

/**
 * Yozuv (lotin ⇄ kirill) almashtirgich.
 *
 * Tizimdagi barcha matn lotinda yozilgan, shuning uchun kirill tanlanganda DOM'dagi matn
 * tugunlari va ko'rinadigan atributlar (placeholder, title, aria-label, alt) joyida
 * transliteratsiya qilinadi. Asl qiymat WeakMap'da saqlanadi — lotinga qaytishda aynan
 * tiklanadi, sahifa qayta yuklanmaydi. MutationObserver yangi/o'zgargan tugunlarni
 * (React qayta chizishi, sahifa o'tishi, toast, modal) ham o'giradi.
 *
 * Tegilmaydi: input/textarea qiymati, contenteditable, <code>/<pre>/<kbd>, skript/stil,
 * hamda `data-no-translit` atributi yoki `notranslate` sinfi bor element ichi.
 */

const ATTRS = ["placeholder", "title", "aria-label", "alt"];
// Butunlay o'tkazib yuboriladigan teglar (matn ham, atribut ham)
const HARD_SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "IFRAME", "CODE", "PRE", "KBD", "SAMP"]);
const SKIP_SEL = "script,style,noscript,template,iframe,code,pre,kbd,samp,textarea,[data-no-translit],.notranslate,[contenteditable]:not([contenteditable='false'])";

type Rec = { orig: string; out: string };
const textMap = new WeakMap<Text, Rec>();
const attrMap = new WeakMap<Element, Map<string, Rec>>();

function hardSkip(el: Element): boolean {
  if (HARD_SKIP.has(el.tagName)) return true;
  if (el.hasAttribute("data-no-translit") || el.classList.contains("notranslate")) return true;
  const ce = el.getAttribute("contenteditable");
  return ce !== null && ce !== "false";
}

/** Element atributlarini o'girish mumkinmi (textarea'ning o'z placeholder'i — mumkin) */
function attrsAllowed(el: Element): boolean {
  return !hardSkip(el) && !el.parentElement?.closest(SKIP_SEL);
}

function convertText(t: Text) {
  const cur = t.data;
  const r = textMap.get(t);
  if (r && r.out === cur) return; // allaqachon o'girilgan (o'zimizning yozuvimiz)
  const out = toCyrillic(cur);
  if (out === cur) { if (r) textMap.delete(t); return; }
  textMap.set(t, { orig: cur, out });
  t.data = out;
}

function convertAttrs(el: Element) {
  for (const a of ATTRS) {
    const cur = el.getAttribute(a);
    if (cur === null) continue;
    let m = attrMap.get(el);
    const r = m?.get(a);
    if (r && r.out === cur) continue;
    const out = toCyrillic(cur);
    if (out === cur) { m?.delete(a); continue; }
    if (!m) { m = new Map(); attrMap.set(el, m); }
    m.set(a, { orig: cur, out });
    el.setAttribute(a, out);
  }
}

/* ─────────────── Navbat: katta sahifalarda bo'laklab ishlash ─────────────── */

let active = false;
let observer: MutationObserver | null = null;
const queue: Node[] = [];
const attrQueue = new Set<Element>();
let walker: TreeWalker | null = null;
let rafId = 0;
let revealed = false;

function reveal() {
  if (revealed) return;
  revealed = true;
  document.documentElement.classList.remove("yozuv-wait");
}

const FILTER: NodeFilter = {
  acceptNode(n: Node) {
    if (n.nodeType !== 1) return NodeFilter.FILTER_ACCEPT;
    const el = n as Element;
    if (hardSkip(el)) return NodeFilter.FILTER_REJECT;
    convertAttrs(el);
    // textarea ichidagi matn — foydalanuvchi qiymati, faqat placeholder o'giriladi
    return el.tagName === "TEXTAREA" ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_SKIP;
  },
};

/** Navbatdagi tugunni boshlash: matn bo'lsa darhol, element bo'lsa walker ochiladi */
function startNode(n: Node) {
  if (!n.isConnected) return;
  if (n.nodeType === 3) {
    const p = n.parentElement;
    if (p && !p.closest(SKIP_SEL)) convertText(n as Text);
    return;
  }
  if (n.nodeType !== 1) return;
  const el = n as Element;
  if (!attrsAllowed(el)) return;
  convertAttrs(el);
  if (el.tagName === "TEXTAREA") return; // ichidagi matn — foydalanuvchi qiymati
  walker = document.createTreeWalker(el, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, FILTER);
}

/** Vaqt byudjeti tugaguncha ishlaydi; qolgani keyingi kadrga */
function drain(budgetMs: number) {
  const end = performance.now() + budgetMs;
  let k = 0;
  for (const el of attrQueue) {
    if (el.isConnected && attrsAllowed(el)) convertAttrs(el);
  }
  attrQueue.clear();
  while (true) {
    if (walker) {
      const n = walker.nextNode();
      if (!n) { walker = null; continue; }
      if (n.nodeType === 3) convertText(n as Text);
    } else {
      const n = queue.shift();
      if (!n) break;
      startNode(n);
    }
    if (++k % 256 === 0 && performance.now() > end) break;
  }
  // O'zimiz yozgan o'zgarishlar kuzatuvchiga qaytib kelmasin (cheksiz aylanish bo'lmaydi)
  observer?.takeRecords();
  if (walker || queue.length) schedule();
  else reveal();
}

function schedule() {
  if (rafId) return;
  // Ko'rinib turgan tabda kadr boshiga 12 ms (silliq), yashirinda kattaroq bo'lak
  const run = () => { rafId = 0; if (active) drain(document.hidden ? 150 : 12); };
  // Yashirin tabda requestAnimationFrame to'xtaydi — u holda setTimeout
  rafId = document.hidden ? -(window.setTimeout(run, 0)) : requestAnimationFrame(run);
}

function onMutations(records: MutationRecord[]) {
  for (const r of records) {
    if (r.type === "childList") r.addedNodes.forEach((n) => queue.push(n));
    else if (r.type === "characterData") queue.push(r.target);
    else if (r.type === "attributes") attrQueue.add(r.target as Element);
  }
  // Mikrotopshiriq ichida — bo'yoqdan oldin; katta qism keyingi kadrlarga bo'linadi
  drain(30);
}

function enable() {
  if (active) return;
  active = true;
  queue.length = 0;
  walker = null;
  queue.push(document.documentElement);
  observer = new MutationObserver(onMutations);
  observer.observe(document.documentElement, {
    subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS,
  });
  drain(200); // birinchi o'tish — sahifa yashirin turgan paytda
}

function disable() {
  active = false;
  observer?.disconnect();
  observer = null;
  queue.length = 0;
  attrQueue.clear();
  walker = null;
  if (rafId > 0) cancelAnimationFrame(rafId);
  else if (rafId < 0) clearTimeout(-rafId);
  rafId = 0;
  // Asl lotin matnni tiklash
  const w = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  for (let n: Node | null = w.currentNode; n; n = w.nextNode()) {
    if (n.nodeType === 3) {
      const r = textMap.get(n as Text);
      if (r) { if ((n as Text).data === r.out) (n as Text).data = r.orig; textMap.delete(n as Text); }
    } else if (n.nodeType === 1) {
      const m = attrMap.get(n as Element);
      if (!m) continue;
      for (const [a, r] of m) if ((n as Element).getAttribute(a) === r.out) (n as Element).setAttribute(a, r.orig);
      attrMap.delete(n as Element);
    }
  }
}

/* ─────────────── React konteksti ─────────────── */

const Ctx = createContext<{ yozuv: Yozuv; setYozuv: (y: Yozuv) => void }>({ yozuv: "lotin", setYozuv: () => {} });
export const useYozuv = () => useContext(Ctx);

/** Ildiz layout'da: hidratsiyadan keyin (useEffect) ishga tushadi — mismatch bo'lmaydi */
export function ScriptProvider({ children }: { children: React.ReactNode }) {
  const [yozuv, setState] = useState<Yozuv>("lotin");

  useEffect(() => {
    const d = document.documentElement;
    if (d.dataset.yozuv === "kiril") { setState("kiril"); enable(); }
    else reveal();
    return () => { if (active) disable(); };
  }, []);

  const setYozuv = useCallback((y: Yozuv) => {
    const d = document.documentElement;
    document.cookie = `${YOZUV_COOKIE}=${y}; path=/; max-age=31536000; samesite=lax`;
    d.dataset.yozuv = y;
    d.lang = y === "kiril" ? "uz-Cyrl" : "uz";
    if (y === "kiril") enable(); else disable();
    setState(y);
  }, []);

  const value = useMemo(() => ({ yozuv, setYozuv }), [yozuv, setYozuv]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
