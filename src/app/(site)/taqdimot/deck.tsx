"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import {
  ChevronLeft, ChevronRight, Home, LayoutGrid, Maximize2, Minimize2,
  Pause, Play, StickyNote, X,
} from "lucide-react";
import { buildSlides, type DeckCompany } from "./slides";

/**
 * Taqdimot ko'rgichi — PPT ning veb ko'rinishi.
 *
 *  · Slayd almashganda React uni `key` bo'yicha qaytadan yaratadi, shuning
 *    uchun ichidagi bloklar har safar ketma-ket "chiqadi" (globals.css dagi
 *    deck-* animatsiyalari).
 *  · Boshqaruv: ← → (yoki Space), 1-2 barmoq bilan surish, g'ildirak,
 *    O — slaydlar ro'yxati, N — ma'ruzachi izohi, F — to'liq ekran,
 *    P — avtomatik o'ynatish, Home/End — boshi va oxiri.
 *  · Manzilda `#slayd-7` turadi: havolani ochgan odam o'sha slayddan boshlaydi.
 */

const AUTOPLAY_MS = 14000;

export function Deck({ company }: { company: DeckCompany }) {
  const slides = useMemo(() => buildSlides(company), [company]);
  const last = slides.length - 1;

  const [i, setI] = useState(0);
  const [dir, setDir] = useState<1 | -1>(1);
  const [overview, setOverview] = useState(false);
  const [notes, setNotes] = useState(false);
  const [full, setFull] = useState(false);
  const [auto, setAuto] = useState(false);
  const stage = useRef<HTMLDivElement>(null);
  const lockUntil = useRef(0);

  const go = useCallback((next: number, how: 1 | -1 = 1) => {
    setI((cur) => {
      const n = Math.max(0, Math.min(last, next));
      if (n !== cur) setDir(how);
      return n;
    });
  }, [last]);

  const prev = useCallback(() => go(i - 1, -1), [go, i]);
  const next = useCallback(() => go(i + 1, 1), [go, i]);

  /* Manzildagi #slayd-N — ochilishda o'qiladi, keyin har almashuvda yangilanadi */
  useEffect(() => {
    const fromHash = () => {
      const m = /^#slayd-(\d+)$/.exec(window.location.hash);
      if (m) setI(Math.max(0, Math.min(last, Number(m[1]) - 1)));
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, [last]);

  useEffect(() => {
    history.replaceState(null, "", `#slayd-${i + 1}`);
    stage.current?.scrollTo({ top: 0 });
  }, [i]);

  /* Klaviatura */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      switch (e.key) {
        case "ArrowRight": case "PageDown": case " ": e.preventDefault(); next(); break;
        case "ArrowLeft": case "PageUp": e.preventDefault(); prev(); break;
        case "Home": e.preventDefault(); go(0, -1); break;
        case "End": e.preventDefault(); go(last, 1); break;
        case "Escape": setOverview(false); setNotes(false); break;
        case "o": case "O": setOverview((v) => !v); break;
        case "n": case "N": setNotes((v) => !v); break;
        case "p": case "P": setAuto((v) => !v); break;
        case "f": case "F": void toggleFull(); break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [next, prev, go, last]);

  /* Avtomatik o'ynatish — oxirgi slaydda o'zi to'xtaydi */
  useEffect(() => {
    if (!auto) return;
    if (i === last) { setAuto(false); return; }
    const t = setTimeout(next, AUTOPLAY_MS);
    return () => clearTimeout(t);
  }, [auto, i, last, next]);

  /* To'liq ekran holatini kuzatamiz (Esc bilan chiqilsa ham tugma to'g'ri tursin) */
  useEffect(() => {
    const onFs = () => setFull(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  async function toggleFull() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch { /* brauzer ruxsat bermasa — jim qolamiz */ }
  }

  /* Barmoq bilan surish */
  const touch = useRef<{ x: number; y: number } | null>(null);
  const onTouchStart = (e: React.TouchEvent) => {
    touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const t0 = touch.current;
    if (!t0) return;
    touch.current = null;
    const dx = e.changedTouches[0].clientX - t0.x;
    const dy = e.changedTouches[0].clientY - t0.y;
    if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.4) (dx < 0 ? next : prev)();
  };

  /* Sichqoncha g'ildiragi — slayd ichi sig'ib turgan bo'lsa slayd almashadi */
  const onWheel = (e: React.WheelEvent) => {
    const el = stage.current;
    if (!el) return;
    const scrollable = el.scrollHeight - el.clientHeight > 8;
    if (scrollable) {
      const atTop = el.scrollTop <= 0;
      const atEnd = el.scrollTop + el.clientHeight >= el.scrollHeight - 1;
      if (!(atTop && e.deltaY < 0) && !(atEnd && e.deltaY > 0)) return;
    }
    if (Math.abs(e.deltaY) < 14) return;
    const now = Date.now();
    if (now < lockUntil.current) return;
    lockUntil.current = now + 620;
    (e.deltaY > 0 ? next : prev)();
  };

  const s = slides[i];
  const dark = s.tone === "dark";

  return (
    <div className={`flex h-[100svh] flex-col overflow-hidden ${dark ? "bg-insof-900" : "bg-beton-100"}`}>
      {/* ───────── Tepa panel ───────── */}
      <header className="relative z-30 flex h-14 shrink-0 items-center gap-2 border-b border-white/10 bg-beton-950 px-3 text-white sm:gap-3 sm:px-5">
        <Link href="/" className="inline-flex h-9 items-center gap-2 rounded-md px-2 text-[13px] font-medium text-white/70 transition-colors hover:bg-white/10 hover:text-white" aria-label="Bosh sahifaga qaytish">
          <Home size={16} />
          <span className="hidden sm:inline">Bosh sahifa</span>
        </Link>

        <span className="hidden h-5 w-px bg-white/15 sm:block" />

        {/* Logotip telefonda chiqmaydi: tepa qatorda tugmalar va hisoblagichga joy qolsin */}
        <Image src="/media/logo-light.png" alt="INSOF" width={470} height={86} className="hidden h-5 w-auto sm:block sm:h-6" priority />

        <span className="ml-auto flex items-center gap-1 sm:gap-1.5">
          <Btn onClick={() => setAuto((v) => !v)} active={auto} label={auto ? "Avtomatik o'ynatishni to'xtatish" : "Avtomatik o'ynatish"}>
            {auto ? <Pause size={16} /> : <Play size={16} />}
          </Btn>
          <Btn onClick={() => setNotes((v) => !v)} active={notes} label="Ma'ruzachi izohi">
            <StickyNote size={16} />
          </Btn>
          <Btn onClick={() => setOverview(true)} label="Barcha slaydlar">
            <LayoutGrid size={16} />
          </Btn>
          <Btn onClick={() => void toggleFull()} label={full ? "To'liq ekrandan chiqish" : "To'liq ekran"}>
            {full ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          </Btn>
          <span className="ml-1.5 font-mono text-[12px] whitespace-nowrap tabular-nums text-white/50 sm:ml-2.5 sm:text-[13px]">
            {String(i + 1).padStart(2, "0")} <span className="text-white/25">/ {slides.length}</span>
          </span>
        </span>
      </header>

      {/* ───────── Slayd ───────── */}
      <div className="relative flex-1 overflow-hidden" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd} onWheel={onWheel}>
        {/* Jarayon chizig'i */}
        <div className="absolute inset-x-0 top-0 z-20 h-[3px] bg-black/15">
          <div className="h-full bg-signal transition-[width] duration-500 ease-out" style={{ width: `${((i + 1) / slides.length) * 100}%` }} />
        </div>

        <article
          key={i}
          ref={stage}
          className={`deck-swap-${dir > 0 ? "next" : "prev"} relative h-full overflow-x-hidden overflow-y-auto ${dark ? "bg-insof-900 text-white" : "bg-beton-100 text-beton-900"}`}
          aria-live="polite"
        >
          {s.bg && (
            <>
              {/* Telefonda kadr o'ng tomonga suriladi — zavod ko'rinib tursin */}
              <Image src={s.bg} alt="" fill priority={i === 0} sizes="100vw" className="deck-kadr -z-20 object-cover object-right lg:object-center" />
              {/* Matn ostidagi parda: qorong'i slaydda quyuq, ochig'ida oq */}
              <div
                className={`absolute inset-0 -z-10 ${
                  dark
                    ? "bg-linear-to-r from-insof-900/95 via-insof-900/70 to-insof-900/35"
                    : "bg-white/65 lg:bg-transparent"
                }`}
              />
            </>
          )}

          {/* lg da yon tomondan keng joy — o'ng/chap o'tish tugmalari matnni to'smaydi */}
          <div className={`mx-auto flex min-h-full w-full max-w-[1300px] flex-col justify-center px-4 py-8 sm:px-8 sm:py-10 lg:px-20 ${notes ? "pb-40" : ""}`}>
            {!s.bare && (
              <header className="mb-6 sm:mb-8">
                <h2 className={`deck-up font-display text-[clamp(1.35rem,3.6vw,2.6rem)] leading-[1.08] font-extrabold ${dark ? "text-white" : "text-beton-900"}`} style={{ animationDelay: "40ms" }}>
                  {s.title}
                </h2>
                {s.sub && (
                  <p className={`deck-up mt-2 text-[13px] sm:text-lg ${dark ? "text-white/55" : "text-beton-500"}`} style={{ animationDelay: "110ms" }}>
                    {s.sub}
                  </p>
                )}
                <div className="deck-line mt-4 h-0.5 w-20 bg-signal" style={{ animationDelay: "160ms" }} />
              </header>
            )}

            {s.body}
          </div>
        </article>

        {/* Yon tugmalar — keng ekranda */}
        <NavBtn side="left" onClick={prev} disabled={i === 0} />
        <NavBtn side="right" onClick={next} disabled={i === last} />

        {/* Ma'ruzachi izohi */}
        {notes && (
          <div className="deck-note absolute inset-x-0 bottom-0 z-20 border-t border-white/10 bg-beton-950/95 px-4 py-4 text-white backdrop-blur-sm sm:px-8">
            <div className="mx-auto flex max-w-[1240px] items-start gap-3">
              <StickyNote size={15} className="mt-0.5 shrink-0 text-signal" />
              <p className="text-[13px] leading-relaxed text-white/75 sm:text-sm">{s.notes}</p>
              <button type="button" onClick={() => setNotes(false)} className="ml-auto shrink-0 rounded p-1 text-white/40 hover:text-white" aria-label="Izohni yopish">
                <X size={15} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ───────── Pastki boshqaruv ───────── */}
      <footer className="relative z-30 flex h-14 shrink-0 items-center gap-3 border-t border-white/10 bg-beton-950 px-3 text-white sm:px-5">
        <button
          type="button"
          onClick={prev}
          disabled={i === 0}
          className="inline-flex h-9 items-center gap-1.5 rounded-md border border-white/15 px-3 text-[13px] font-medium transition-colors hover:bg-white/10 disabled:opacity-30 sm:px-4"
        >
          <ChevronLeft size={16} /> <span className="hidden sm:inline">Orqaga</span>
        </button>

        {/* Nuqtalar — bosib o'tish mumkin */}
        <div className="mx-auto hidden items-center gap-1.5 md:flex">
          {slides.map((sl, k) => (
            <button
              key={sl.n}
              type="button"
              onClick={() => go(k, k > i ? 1 : -1)}
              aria-label={`${sl.n}-slayd: ${sl.title}`}
              aria-current={k === i}
              className={`h-1.5 rounded-full transition-all duration-300 ${k === i ? "w-7 bg-signal" : "w-1.5 bg-white/25 hover:bg-white/50"}`}
            />
          ))}
        </div>

        <span className="mx-auto truncate font-mono text-[11px] tracking-wide text-white/40 uppercase md:hidden">{s.title}</span>

        <button
          type="button"
          onClick={next}
          disabled={i === last}
          className="inline-flex h-9 items-center gap-1.5 rounded-md bg-signal px-3 text-[13px] font-semibold text-white transition-colors hover:bg-signal-600 disabled:opacity-30 sm:px-4"
        >
          <span className="hidden sm:inline">Keyingi</span> <ChevronRight size={16} />
        </button>
      </footer>

      {/* ───────── Slaydlar ro'yxati ───────── */}
      {overview && (
        <div className="deck-fade fixed inset-0 z-50 overflow-y-auto bg-beton-950/97 p-4 backdrop-blur-sm sm:p-8">
          <div className="mx-auto max-w-[1240px]">
            <div className="mb-6 flex items-center gap-3">
              <h3 className="font-display text-lg font-bold text-white sm:text-2xl">Slaydlar</h3>
              <span className="font-mono text-[12px] text-white/40">{slides.length} ta</span>
              <button type="button" onClick={() => setOverview(false)} className="ml-auto inline-flex h-10 w-10 items-center justify-center rounded-md border border-white/15 text-white/70 hover:bg-white/10 hover:text-white" aria-label="Yopish">
                <X size={18} />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
              {slides.map((sl, k) => (
                <button
                  key={sl.n}
                  type="button"
                  onClick={() => { go(k, k > i ? 1 : -1); setOverview(false); }}
                  className={`group rounded-lg p-4 text-left ring-1 transition-colors ${k === i ? "bg-signal/15 ring-signal" : "bg-white/[0.04] ring-white/10 hover:bg-white/[0.09]"}`}
                >
                  <span className="font-mono text-[11px] tabular-nums text-signal">{String(sl.n).padStart(2, "0")}</span>
                  <div className="mt-1.5 font-display text-[13px] leading-tight font-bold text-white sm:text-[15px]">{sl.title}</div>
                  {sl.sub && <div className="mt-1 line-clamp-2 text-[11px] leading-snug text-white/45 sm:text-[12px]">{sl.sub}</div>}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Btn({ children, onClick, label, active }: { children: React.ReactNode; onClick: () => void; label: string; active?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={`inline-flex h-9 w-9 items-center justify-center rounded-md transition-colors ${active ? "bg-signal text-white" : "text-white/60 hover:bg-white/10 hover:text-white"}`}
    >
      {children}
    </button>
  );
}

function NavBtn({ side, onClick, disabled }: { side: "left" | "right"; onClick: () => void; disabled: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={side === "left" ? "Oldingi slayd" : "Keyingi slayd"}
      className={`absolute top-1/2 z-20 hidden h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-beton-950/35 text-white/80 backdrop-blur-xs transition-all hover:bg-signal hover:text-white disabled:pointer-events-none disabled:opacity-0 lg:inline-flex ${side === "left" ? "left-3" : "right-3"}`}
    >
      {side === "left" ? <ChevronLeft size={22} /> : <ChevronRight size={22} />}
    </button>
  );
}
