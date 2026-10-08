"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { CircleHelp, Lightbulb, X } from "lucide-react";
import { HELP, RISK_LABEL, helpForCheckKey, type HelpRisk, type HelpTopic, type HelpTopicId } from "@/lib/control/help-content";

/**
 * IT panel yordam tugmalari: «?» belgisi → ixcham oyna (kompyuterda tugma yonida, telefonda pastdan chiqadigan
 * varaq). Esc yoki tashqariga bosish yopadi, bir vaqtda faqat bitta oyna ochiq. Matnlar — lib/control/help-content.ts.
 * Oyna panel ildiziga (.sa) chiziladi (jadval/karta overflow'i kesmasin); ichidagi `buyruqlar` <code> da — kirillga o'girilmaydi.
 */

/* Bir vaqtda bitta ochiq oyna: yangisi ochilganda eskisi yopiladi. */
let current: { id: string; close: () => void } | null = null;

const RISK_CLS: Record<HelpRisk, string> = {
  safe: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  low: "bg-blue-50 text-blue-800 ring-blue-200",
  medium: "bg-amber-50 text-amber-900 ring-amber-200",
  high: "bg-red-50 text-red-800 ring-red-200",
};

/** `teskari tirnoq` ichidagi qismlar — kod (monospace, kirillga o'girilmaydi). */
export function Rich({ text }: { text: string }) {
  const parts = text.split(/`([^`]+)`/);
  return <>{parts.map((p, i) => (i % 2 ? <code key={i} data-no-translit className="rounded bg-slate-100 px-1 py-px font-mono text-[12px] text-slate-800 [overflow-wrap:anywhere]">{p}</code> : p))}</>;
}

function H({ children }: { children: React.ReactNode }) {
  return <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500">{children}</h3>;
}

/** Yordam matni (oyna, hodisa tafsiloti va «Yordam» sahifasi uchun umumiy). */
export function HelpBody({ t }: { t: HelpTopic }) {
  const stepsTitle = t.check ? "Qanday tuzatiladi?" : t.action ? "Qadamlar" : "Muammo bo'lsa nima qilish kerak?";
  return (
    <div className="space-y-3 text-sm leading-relaxed text-slate-700">
      <section><H>{t.check ? "Nima bo'ldi?" : "Bu nima?"}</H><p><Rich text={t.what} /></p></section>
      {t.why && <section><H>Nega muhim?</H><p><Rich text={t.why} /></p></section>}
      {t.action && (
        <>
          <section><H>Bu tugma nima qiladi?</H><p><Rich text={t.action.does} /></p></section>
          <section>
            <H>Xavfi</H>
            <p><span className={`mr-1.5 inline-block rounded-full px-2 py-px text-[11px] font-semibold ring-1 ring-inset ${RISK_CLS[t.action.level]}`}>{RISK_LABEL[t.action.level]}</span><Rich text={t.action.risk} /></p>
          </section>
          <section><H>Qancha vaqt oladi?</H><p><Rich text={t.action.duration} /></p></section>
          <section><H>Qachon ishlatish kerak?</H><p><Rich text={t.action.use} /></p></section>
          {t.action.avoid && <section><H>Qachon ishlatmaslik kerak?</H><p><Rich text={t.action.avoid} /></p></section>}
        </>
      )}
      {t.normal && <section><H>Normal holat</H><p><Rich text={t.normal} /></p></section>}
      {t.steps && t.steps.length > 0 && (
        <section>
          <H>{stepsTitle}</H>
          <ol className="ml-5 list-decimal space-y-1 marker:font-semibold marker:text-slate-500">
            {t.steps.map((s, i) => <li key={i}><Rich text={s} /></li>)}
          </ol>
        </section>
      )}
    </div>
  );
}

function useMobile() {
  const [m] = useState(() => typeof window !== "undefined" && window.matchMedia("(max-width: 760px)").matches);
  return m;
}

function Popover({ t, id, titleId, anchor, onClose }: { t: HelpTopic; id: string; titleId: string; anchor: React.RefObject<HTMLButtonElement | null>; onClose: (focusBack: boolean) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const mobile = useMobile();
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  // Kompyuterda: tugma ostida (joy bo'lmasa — ustida), ekran chetidan 8 px ichkarida
  useLayoutEffect(() => {
    if (mobile) return;
    const place = () => {
      const a = anchor.current?.getBoundingClientRect();
      const b = box.current;
      if (!a || !b) return;
      const w = b.offsetWidth, h = b.offsetHeight, vw = window.innerWidth, vh = window.innerHeight;
      let top = a.bottom + 8;
      if (top + h > vh - 8 && a.top - 8 - h >= 8) top = a.top - 8 - h;
      top = Math.max(8, Math.min(top, vh - h - 8));
      const left = Math.max(8, Math.min(a.left + a.width / 2 - w / 2, vw - w - 8));
      setPos({ top, left });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => { window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [anchor, mobile]);

  useEffect(() => {
    // Esc — faqat shu oynani yopadi (ortidagi modal/drawer ochiq qoladi): window capture bosqichida to'xtatamiz
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation(); e.preventDefault();
      onClose(true);
    };
    const onDown = (e: PointerEvent) => {
      const n = e.target as Node;
      if (box.current?.contains(n) || anchor.current?.contains(n)) return;
      onClose(false);
    };
    window.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onDown, true);
    box.current?.focus({ preventScroll: true });
    return () => { window.removeEventListener("keydown", onKey, true); document.removeEventListener("pointerdown", onDown, true); };
  }, [onClose, anchor]);

  const panel = (
    <div ref={box} id={id} role="dialog" aria-labelledby={titleId} tabIndex={-1} data-help-popover
      onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}
      style={mobile ? undefined : { top: pos?.top ?? -9999, left: pos?.left ?? -9999 }}
      className={mobile
        ? "fixed inset-x-0 bottom-0 z-[71] max-h-[82vh] overflow-y-auto rounded-t-2xl border-t border-slate-200 bg-white p-4 pb-6 text-left normal-case tracking-normal shadow-(--shadow-pop) outline-none"
        : "fixed z-[71] max-h-[min(70vh,560px)] w-[min(380px,calc(100vw-16px))] overflow-y-auto rounded-xl border border-slate-200 bg-white p-4 text-left normal-case tracking-normal shadow-(--shadow-pop) outline-none"}>
      {mobile && <div aria-hidden className="mx-auto -mt-1 mb-3 h-1 w-10 rounded-full bg-slate-300" />}
      <div className="mb-3 flex items-start gap-2">
        <CircleHelp size={18} className="mt-0.5 shrink-0 text-violet-600" aria-hidden />
        <h2 id={titleId} className="min-w-0 flex-1 text-[15px] font-semibold text-slate-900"><Rich text={t.title} /></h2>
        <button type="button" onClick={() => onClose(true)} aria-label="Yopish" className="-m-1 rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 pointer-coarse:p-2.5"><X size={16} /></button>
      </div>
      <HelpBody t={t} />
      <div className="mt-4 border-t border-slate-100 pt-2 text-xs">
        <Link href="/superadmin/yordam" onClick={() => onClose(false)} className="font-medium text-violet-700 hover:underline">Barcha tushuntirishlar — «Yordam» sahifasi →</Link>
      </div>
    </div>
  );
  // Panel ildiziga (.sa) — Status Board tokenlari (yorug'/qorong'i mavzu) popover'ga ham o'tsin; ota overflow kesmaydi
  const root = anchor.current?.closest<HTMLElement>(".sa") ?? document.querySelector<HTMLElement>(".sa") ?? document.body;
  return createPortal(
    mobile ? <><div aria-hidden className="fixed inset-0 z-[70] bg-black/40" />{panel}</> : panel,
    root,
  );
}

/**
 * «?» yordam tugmasi. `topic` — lug'atdagi mavzu, `checkKey` — tekshiruv/hodisa kaliti (helpForCheckKey).
 * `label` berilsa — matnli kichik tugma (masalan «Bu sahifa haqida»).
 */
export function HelpButton({ topic, checkKey, label, className }: { topic?: HelpTopicId; checkKey?: string; label?: string; className?: string }) {
  const t = topic ? HELP[topic] : checkKey ? helpForCheckKey(checkKey) : null;
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const uid = useId();
  const popId = `${uid}-help`;

  const close = useCallback((focusBack: boolean) => {
    setOpen(false);
    if (current?.id === uid) current = null;
    if (focusBack) btn.current?.focus();
  }, [uid]);

  useEffect(() => () => { if (current?.id === uid) current = null; }, [uid]);

  if (!t) return null;
  const toggle = (e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    if (open) { close(false); return; }
    if (current && current.id !== uid) current.close();
    current = { id: uid, close: () => close(false) };
    setOpen(true);
  };
  const base = label
    ? "inline-flex items-center gap-1 rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-xs font-medium normal-case tracking-normal text-violet-700 hover:bg-violet-100 pointer-coarse:py-1.5"
    : "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-violet-700 pointer-coarse:h-8 pointer-coarse:w-8";
  return (
    <>
      <button ref={btn} type="button" onClick={toggle} aria-label={`Yordam: ${t.title.replace(/`/g, "")}`} aria-haspopup="dialog" aria-expanded={open}
        aria-controls={open ? popId : undefined} data-help-button
        className={`${base} align-middle focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-violet-500 ${open ? "text-violet-700" : ""} ${className ?? ""}`}>
        <CircleHelp size={label ? 13 : 15} aria-hidden />{label && <span>{label}</span>}
      </button>
      {open && <Popover t={t} id={popId} titleId={`${uid}-title`} anchor={btn} onClose={close} />}
    </>
  );
}

/** Matn + yonida «?» (jadval ustuni, karta sarlavhasi). */
export function WithHelp({ topic, checkKey, children, className }: { topic?: HelpTopicId; checkKey?: string; children: React.ReactNode; className?: string }) {
  return <span className={`inline-flex items-center gap-1 ${className ?? ""}`}>{children}<HelpButton topic={topic} checkKey={checkKey} /></span>;
}

/** Sahifa sarlavhasi yonida «Bu sahifa haqida». */
export function PageHelp({ topic }: { topic: HelpTopicId }) {
  return <HelpButton topic={topic} label="Bu sahifa haqida" />;
}

/** Hodisa tafsilotida: kalit bo'yicha oddiy tildagi yordam — ochiq blok. */
export function CheckHelpInline({ checkKey, collapsed }: { checkKey: string; collapsed?: boolean }) {
  const t = helpForCheckKey(checkKey);
  return (
    <details open={!collapsed} className="group rounded-lg border border-violet-200 bg-violet-50/40 p-3">
      <summary className="flex cursor-pointer select-none items-center gap-1.5 text-sm font-semibold text-violet-800">
        <Lightbulb size={15} aria-hidden /> Oddiy tilda: <Rich text={t.title} />
      </summary>
      <div className="mt-3"><HelpBody t={t} /></div>
    </details>
  );
}

const HINT_KEY = "insof-panel-help-hint-v1";

/** Bosh sahifadagi birinchi tashrif maslahati (localStorage'da eslab qolinadi; xato bo'lsa jim). */
export function FirstVisitHint() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    try { if (!window.localStorage.getItem(HINT_KEY)) setShow(true); } catch { setShow(true); }
  }, []);
  if (!show) return null;
  const dismiss = () => {
    setShow(false);
    try { window.localStorage.setItem(HINT_KEY, "1"); } catch { /* saqlab bo'lmadi — keyingi safar yana chiqadi */ }
  };
  return (
    <div role="note" className="flex flex-wrap items-center gap-3 rounded-(--radius-card) border border-violet-200 bg-violet-50 px-4 py-3 text-sm text-violet-900">
      <CircleHelp size={20} className="shrink-0 text-violet-600" aria-hidden />
      <p className="min-w-0 flex-1"><b>Tushunarsiz joy bormi?</b> <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-white align-middle text-violet-700 ring-1 ring-violet-200"><CircleHelp size={13} aria-hidden /></span> belgisini bosing — tushuntirish chiqadi. Har bo&apos;lim, ustun va tugma yonida bor. Barchasi bir joyda — <Link href="/superadmin/yordam" className="font-medium underline">Yordam</Link>.</p>
      <button type="button" onClick={dismiss} className="rounded-lg bg-white px-3 py-1.5 text-sm font-medium text-violet-800 ring-1 ring-violet-200 hover:bg-violet-100">Tushunarli</button>
    </div>
  );
}
