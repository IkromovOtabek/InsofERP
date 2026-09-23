"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Check, GraduationCap, MousePointerClick } from "lucide-react";
import { cn } from "@/lib/utils";
import { TOUR_COOKIE, TOUR_DONE, type TourStep } from "@/lib/tour";

/**
 * Bosqichma-bosqich instruksiya.
 *
 * Ekran qorayadi, faqat ko'rsatilayotgan element ochiq qoladi; qolgan hamma joyga
 * bosish to'sib qo'yiladi. Shuning uchun foydalanuvchi ko'rsatilgan amalni bajarmasdan
 * oldinga o'ta olmaydi. "O'tkazib yuborish" bosilsa instruksiya shu sessiya davomida
 * boshqa chiqmaydi (holat `insof_tour` cookie'sida), tizimdan chiqib qayta kirilsa —
 * cookie o'chirilgani uchun instruksiya yana boshidan boshlanadi.
 */

type Box = { top: number; left: number; width: number; height: number };
type Side = "right" | "left" | "top" | "bottom" | "center";

const PAD = 6;      // nishon atrofidagi bo'shliq
const GAP = 20;     // kartochka bilan nishon orasi — strelka shu oraliqda turadi
const CARD_W = 330;
/** Menyu ichidagi nishonlar: telefonda menyu yopiq bo'lsa, uni o'zimiz ochamiz. */
const IN_MENU = ['[data-tour="nav:', '[data-tour="group:', '[data-tour="logout"]', '[data-tour="apk"]'];

function save(value: string) {
  // Bosqich nomida `?` va `=` bo'lishi mumkin (masalan `nav:/otdel-kadr?tab=lavozimlar`) — kodlaymiz
  // Muddat sessiya cookie'siniki bilan bir xil (12 soat). Brauzer yopilib ochilsa ham
  // "o'tkazib yuborildi" belgisi qoladi; chiqib qayta kirilganda esa cookie o'chiriladi.
  try { document.cookie = `${TOUR_COOKIE}=${encodeURIComponent(value)}; path=/; max-age=${60 * 60 * 12}; samesite=lax`; } catch { /* shaxsiy rejimda cookie yopiq bo'lishi mumkin */ }
}

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/**
 * Element haqiqatan ko'rinyaptimi. Yig'ilgan menyu guruhi ichidagi band o'z o'lchamini
 * saqlaydi (faqat `visibility: hidden` bo'ladi va tashqi blok uni qirqadi), shuning uchun
 * o'lchamning o'zi yetarli emas.
 */
function shown(el: HTMLElement) {
  if (typeof el.checkVisibility === "function") return el.checkVisibility({ visibilityProperty: true });
  return getComputedStyle(el).visibility !== "hidden";
}

export function Tour({ steps: all, start }: { steps: TourStep[]; start: string | null }) {
  const pathname = usePathname();
  const router = useRouter();

  const [mounted, setMounted] = useState(false);
  const [desktop, setDesktop] = useState(true);
  const [vp, setVp] = useState({ w: 0, h: 0 });
  const [activeId, setActiveId] = useState<string | null>(
    () => (start === TOUR_DONE ? null : (all.find((s) => s.id === start)?.id ?? all[0]?.id ?? null)),
  );
  const [box, setBox] = useState<Box | null>(null);
  const [ready, setReady] = useState(false);
  const [grace, setGrace] = useState(true);
  const [cardH, setCardH] = useState(200);

  // Kartochka balandligi matn uzunligiga qarab o'zgaradi — joylashuv shunga bog'liq.
  // React 19 da ref funksiyasi tozalovchi qaytarishi mumkin.
  const measure = useCallback((el: HTMLDivElement | null) => {
    if (!el) return;
    const ro = new ResizeObserver(() => setCardH((p) => (Math.abs(p - el.offsetHeight) > 2 ? el.offsetHeight : p)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Faqat shu ekranga mos bosqichlar (ba'zilari telefon yoki ish stoli uchun)
  const steps = useMemo(() => all.filter((s) => !s.only || (s.only === "desktop") === desktop), [all, desktop]);
  const index = activeId ? steps.findIndex((s) => s.id === activeId) : -1;
  const step = index >= 0 ? steps[index] : null;

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const sync = () => { setDesktop(mq.matches); setVp({ w: window.innerWidth, h: window.innerHeight }); };
    sync();
    mq.addEventListener("change", sync);
    window.addEventListener("resize", sync);
    return () => { mq.removeEventListener("change", sync); window.removeEventListener("resize", sync); };
  }, []);

  const go = useCallback((id: string | null) => {
    setActiveId(id);
    setBox(null);
    setReady(false);
    save(id ?? TOUR_DONE);
  }, []);

  const next = useCallback(() => { go(steps[index + 1]?.id ?? null); }, [go, steps, index]);
  const back = useCallback(() => { if (index > 0) go(steps[index - 1].id); }, [go, steps, index]);

  // Ekran o'lchami o'zgarib, joriy bosqich ro'yxatdan chiqib qolsa — keyingisiga o'tamiz
  useEffect(() => {
    if (!activeId || index >= 0) return;
    const pos = all.findIndex((s) => s.id === activeId);
    const fallback = steps.find((s) => all.indexOf(s) > pos) ?? null;
    go(fallback?.id ?? null);
  }, [activeId, index, steps, all, go]);

  // Tepadagi tugma instruksiyani boshidan ishga tushiradi
  useEffect(() => {
    const on = () => go(steps[0]?.id ?? null);
    window.addEventListener("insof-tour", on);
    return () => window.removeEventListener("insof-tour", on);
  }, [steps, go]);

  const target = step?.target ?? null;
  const stepId = step?.id ?? null;

  // Nishonni topish va uning o'lchamini kuzatib borish (sahifa suriladi, menyu ochiladi…)
  useEffect(() => {
    if (!mounted || !step) return;
    if (!target) { setBox(null); setReady(true); return; }
    let raf = 0, miss = 0, menuOpened = false, groupOpened = false;
    const tick = () => {
      // Menyu ikki marta chiziladi (ish stoli paneli + telefon chekka paneli), shuning uchun
      // `display:none` shoxobchadagi nusxalarni chetlab o'tamiz: offsetParent ularda bo'lmaydi.
      const live = Array.from(document.querySelectorAll<HTMLElement>(target)).filter((e) => e.offsetParent !== null);
      const el = live.find((e) => { const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0 && shown(e); }) ?? null;
      if (el) {
        const r = el.getBoundingClientRect();
        miss = 0;
        setBox((b) =>
          b && Math.abs(b.top - r.top) < 0.5 && Math.abs(b.left - r.left) < 0.5
            && Math.abs(b.width - r.width) < 0.5 && Math.abs(b.height - r.height) < 0.5
            ? b : { top: r.top, left: r.left, width: r.width, height: r.height });
        setReady(true);
      } else {
        miss++;
        if (miss > 8) {
          // Band yig'ilgan guruh ichida (sahifa yangilangandan keyin shunday bo'ladi) — guruhni ochamiz
          const body = live.find((e) => e.closest(".sb-gbody"))?.closest<HTMLElement>(".sb-gbody");
          if (!groupOpened && body && body.dataset.open !== "true") {
            const head = body.parentElement?.querySelector<HTMLElement>('[data-tour^="group:"]');
            if (head) { groupOpened = true; head.click(); }
          }
          // Telefonda menyu umuman yopiq — nishon chizilmagan. Menyuni ochib qo'yamiz.
          if (!menuOpened && !live.length && IN_MENU.some((prefix) => target.startsWith(prefix))) {
            const btn = document.querySelector<HTMLElement>('[data-tour="menu"]');
            if (btn && btn.offsetParent !== null) { menuOpened = true; btn.click(); }
          }
        }
        // Element baribir topilmadi — bosqichni ekran markazida tushuntiramiz
        if (miss > 45) { setBox(null); setReady(true); }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [mounted, step, target, pathname]);

  // Nishon ekrandan chiqib qolgan bo'lsa — ko'rinadigan joyga suramiz
  useEffect(() => {
    if (!target) return;
    const t = setTimeout(() => {
      const el = document.querySelector<HTMLElement>(target);
      if (!el) return;
      const r = el.getBoundingClientRect();
      if (r.top < 64 || r.bottom > window.innerHeight - 64) el.scrollIntoView({ block: "center", behavior: "smooth" });
    }, 240);
    return () => clearTimeout(t);
  }, [stepId, target]);

  // "Guruhni oching" bosqichi: guruh allaqachon ochiq bo'lsa, bosish uni yopib qo'yardi
  useEffect(() => {
    if (!step?.skipIfOpen || !target) return;
    const t = setTimeout(() => {
      if (document.querySelector<HTMLElement>(target)?.getAttribute("aria-expanded") === "true") next();
    }, 300);
    return () => clearTimeout(t);
  }, [step, target, next]);

  // Bosish talab qilinadigan bosqich: nishon bosilgach keyingisiga o'tamiz
  useEffect(() => {
    if (!step || step.action !== "click" || !target || !box) return;
    const on = (e: MouseEvent) => {
      const el = document.querySelector<HTMLElement>(target);
      if (el && e.target instanceof Node && el.contains(e.target)) setTimeout(next, 280);
    };
    document.addEventListener("click", on, true);
    return () => document.removeEventListener("click", on, true);
  }, [step, target, box, next]);

  // Sahifa yoki bosqich almashdi — kartochkani birdan sakratmaslik uchun qisqa kutish
  useEffect(() => {
    setGrace(true);
    const t = setTimeout(() => setGrace(false), 800);
    return () => clearTimeout(t);
  }, [stepId, pathname]);

  // Klaviatura: Enter / → keyingi bosqich (bosish talab qilinmaydigan bosqichlarda)
  useEffect(() => {
    if (!step) return;
    const on = (e: KeyboardEvent) => {
      if (step.action === "click") return;
      if (e.key === "Enter" || e.key === "ArrowRight") { e.preventDefault(); next(); }
      if (e.key === "ArrowLeft") { e.preventDefault(); back(); }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [step, next, back]);

  const cardW = Math.min(CARD_W, (vp.w || CARD_W + 24) - 24);

  // Kartochka qaysi tomonga joylashadi: nishonni yopib qo'ymaydigan, joyi kengroq tomonga
  const place = useMemo(() => {
    // Nishonsiz bosqich (kirish/yakun so'zi) — ekran markazida
    const middle = { side: "center" as Side, top: Math.max(12, (vp.h - cardH) / 2), left: Math.max(12, (vp.w - cardW) / 2), arrow: 0 };
    if (!box || !vp.w) return middle;

    const cx = box.left + box.width / 2, cy = box.top + box.height / 2;
    const free = {
      right: vp.w - (box.left + box.width) - PAD - GAP,
      left: box.left - PAD - GAP,
      bottom: vp.h - (box.top + box.height) - PAD - GAP,
      top: box.top - PAD - GAP,
    };
    // Avval yon tomonlar (kartochka balandligi ahamiyatsiz), keyin past/tepa
    let side: Side | null =
      free.right >= cardW + 12 ? "right"
      : free.left >= cardW + 12 ? "left"
      : free.bottom >= cardH + 12 ? "bottom"
      : free.top >= cardH + 12 ? "top"
      : null;
    // Hech qayerga to'liq sig'masa — bo'sh joyi kattaroq tomonni tanlab, ekran ichiga siqamiz
    if (!side) side = free.bottom >= free.top ? "bottom" : "top";

    if (side === "right" || side === "left") {
      const left = side === "right" ? box.left + box.width + PAD + GAP : box.left - PAD - GAP - cardW;
      const top = clamp(cy - cardH / 2, 12, Math.max(12, vp.h - cardH - 12));
      return { side, top, left, arrow: clamp(cy - top, 22, Math.max(22, cardH - 22)) };
    }
    const top = clamp(side === "bottom" ? box.top + box.height + PAD + GAP : box.top - PAD - GAP - cardH, 12, Math.max(12, vp.h - cardH - 12));
    const left = clamp(cx - cardW / 2, 12, Math.max(12, vp.w - cardW - 12));
    return { side, top, left, arrow: clamp(cx - left, 22, Math.max(22, cardW - 22)) };
  }, [box, vp, cardW, cardH]);

  if (!mounted || !vp.w || !step) return null;

  const base = step.path?.split("?")[0];
  const pathOk = !base || pathname === base || pathname.startsWith(base + "/");
  const hole = ready && box ? { top: box.top - PAD, left: box.left - PAD, width: box.width + PAD * 2, height: box.height + PAD * 2 } : null;
  const mask = "fixed z-[70] bg-black/55";
  const last = index === steps.length - 1;
  const mustClick = step.action === "click" && !!hole;

  const card = (
    <div
      ref={measure}
      role="dialog"
      aria-live="polite"
      className="tour-card fixed z-[75] rounded-2xl border border-slate-200/80 bg-white p-4 shadow-(--shadow-pop)"
      style={{ top: place.top, left: place.left, width: cardW }}
    >
      {/* Nishonga qaragan, sakrab turgan strelka */}
      {hole && place.side !== "center" && (
        <span
          className={cn(
            "pointer-events-none absolute flex h-7 w-7 items-center justify-center rounded-full bg-brand-500 text-slate-950 shadow-(--shadow-card)",
            place.side === "right" && "tour-arrow-l",
            place.side === "left" && "tour-arrow-r",
            place.side === "bottom" && "tour-arrow-u",
            place.side === "top" && "tour-arrow-d",
          )}
          style={
            place.side === "right" ? { left: -34, top: place.arrow - 14 }
            : place.side === "left" ? { right: -34, top: place.arrow - 14 }
            : place.side === "bottom" ? { top: -34, left: place.arrow - 14 }
            : { bottom: -34, left: place.arrow - 14 }
          }
        >
          {place.side === "right" ? <ArrowLeft size={16} /> : place.side === "left" ? <ArrowRight size={16} />
            : place.side === "bottom" ? <ArrowUp size={16} /> : <ArrowDown size={16} />}
        </span>
      )}

      <div className="mb-2.5 flex items-center gap-2">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-brand-500 text-slate-950"><GraduationCap size={14} /></span>
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
          <div className="h-full rounded-full bg-brand-500 transition-[width] duration-300" style={{ width: `${((index + 1) / steps.length) * 100}%` }} />
        </div>
        <span className="shrink-0 text-[11px] font-medium tabular-nums text-slate-400">{index + 1} / {steps.length}</span>
      </div>

      <h3 className="text-[15px] font-semibold tracking-tight text-slate-900">{step.title}</h3>
      <p className="mt-1 text-[13px] leading-relaxed text-slate-600">{step.text}</p>

      {mustClick && (
        <div className="tour-blink mt-3 flex items-center gap-1.5 rounded-lg bg-brand-50 px-2.5 py-1.5 text-[12.5px] font-medium text-brand-700">
          <MousePointerClick size={14} className="shrink-0" /> Ko&apos;rsatilgan joyni bosing — shundan keyin davom etamiz
        </div>
      )}

      <div className="mt-4 flex items-center justify-between gap-2">
        <button type="button" onClick={() => go(null)} className="text-[12px] text-slate-400 underline-offset-2 transition hover:text-slate-700 hover:underline">
          O&apos;tkazib yuborish
        </button>
        <div className="flex items-center gap-1.5">
          {index > 0 && (
            <button type="button" onClick={back} className="inline-flex h-8 items-center gap-1 rounded-lg px-2.5 text-[13px] font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900">
              <ArrowLeft size={14} /> Orqaga
            </button>
          )}
          {!mustClick && (
            <button type="button" onClick={next} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-slate-900 px-3 text-[13px] font-medium text-white transition hover:bg-slate-800">
              {last ? <>Tugatish <Check size={14} /></> : <>Keyingi <ArrowRight size={14} /></>}
            </button>
          )}
        </div>
      </div>
    </div>
  );

  // Kerakli sahifada emasmiz — avval o'sha sahifaga o'tishni taklif qilamiz
  if (!pathOk) {
    return (
      <div className="fixed inset-0 z-[70] bg-black/55">
        {!grace && (
          <div className="tour-fade fixed left-1/2 top-1/2 z-[75] w-[min(330px,calc(100vw-24px))] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-slate-200/80 bg-white p-4 shadow-(--shadow-pop)">
            <h3 className="text-[15px] font-semibold tracking-tight text-slate-900">{step.title}</h3>
            <p className="mt-1 text-[13px] leading-relaxed text-slate-600">
              Bu bosqich boshqa sahifada ko&apos;rsatiladi. Davom etish uchun <span className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[12px] text-slate-700">{step.path}</span> sahifasini oching.
            </p>
            <div className="mt-4 flex items-center justify-between gap-2">
              <button type="button" onClick={() => go(null)} className="text-[12px] text-slate-400 transition hover:text-slate-700">O&apos;tkazib yuborish</button>
              <button type="button" onClick={() => router.push(step.path!)} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-slate-900 px-3 text-[13px] font-medium text-white transition hover:bg-slate-800">
                Sahifani ochish <ArrowRight size={14} />
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <>
      {/* Qorong'i qatlam: nishon atrofidagi to'rt bo'lak. O'rtasidagi "teshik" ochiq qoladi. */}
      {hole ? (
        <>
          <div className={mask} style={{ top: 0, left: 0, right: 0, height: Math.max(0, hole.top) }} />
          <div className={mask} style={{ top: hole.top + hole.height, left: 0, right: 0, bottom: 0 }} />
          <div className={mask} style={{ top: hole.top, left: 0, width: Math.max(0, hole.left), height: hole.height }} />
          <div className={mask} style={{ top: hole.top, left: hole.left + hole.width, right: 0, height: hole.height }} />
          {/* Bosish talab qilinmaydigan bosqichda nishon ham bosilmasin (tasodifan chiqib ketmasin) */}
          {!mustClick && <div className="fixed z-[71]" style={{ ...hole }} onClick={(e) => e.preventDefault()} />}
          <div className="tour-ring pointer-events-none fixed z-[72] rounded-xl" style={{ ...hole }} />
          {mustClick && (
            /* "Bosing" belgisi nishonning kartochkadan uzoqroq burchagida — strelka bilan ustma-ust tushmasin */
            <span className="tour-tap pointer-events-none fixed z-[73] flex h-7 w-7 items-center justify-center rounded-full bg-brand-500 text-slate-950 shadow-(--shadow-card)"
              style={{
                top: clamp(place.side === "bottom" ? hole.top - 14 : hole.top + hole.height - 14, 4, vp.h - 32),
                left: clamp(place.side === "right" ? hole.left - 14 : hole.left + hole.width - 14, 4, vp.w - 32),
              }}>
              <MousePointerClick size={15} />
            </span>
          )}
        </>
      ) : (
        <div className={mask} style={{ inset: 0 }} />
      )}
      {(ready || !target) && card}
    </>
  );
}

/** Tepadagi tugma — instruksiyani boshidan ishga tushiradi. */
export function TourTrigger() {
  return (
    <button
      type="button"
      data-tour="tour"
      title="Instruksiyani boshidan ko'rish"
      aria-label="Instruksiyani boshidan ko'rish"
      onClick={() => window.dispatchEvent(new Event("insof-tour"))}
      className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
    >
      <GraduationCap size={17} />
    </button>
  );
}
