"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { CalendarDays, Check, ChevronLeft, ChevronRight, Loader2, X } from "lucide-react";
import { dateRu, isoDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { rescheduleOrder } from "./actions";

/**
 * Ishlab chiqarish doskasi va matritsasidagi yetkazish sanasi — bosilsa ilova uslubidagi kalendar ochiladi
 * (brauzerning standart oynasi emas), kun tanlansa zayavka shu kunga ko'chiriladi (`rescheduleOrder`).
 * Kalendar `body` ga chiqariladi (fixed): matritsaning aylanuvchi qutisi va yopishqoq ustunlari uni kesmasin.
 * Ro'yxatlar sana bo'yicha tartiblangan — ko'chirilgan zayavka boshqa joyga o'tadi: shuning uchun pastda tasdiq
 * («… → 20.11.2026 ga ko'chirildi») chiqadi, sana tugmasi yashil belgilanadi va ekranga olib kelinadi.
 */

const MONTHS = ["Yanvar", "Fevral", "Mart", "Aprel", "May", "Iyun", "Iyul", "Avgust", "Sentabr", "Oktabr", "Noyabr", "Dekabr"];
const WEEK = ["Du", "Se", "Ch", "Pa", "Ju", "Sh", "Ya"];
const W = 280, H = 340;

const dayStart = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

function MiniCalendar({ value, onPick, onClose }: { value: string | null; onPick: (v: string) => void; onClose: () => void }) {
  const today = dayStart();
  const init = value ? new Date(`${value}T00:00:00`) : today;
  const [month, setMonth] = useState(() => new Date(init.getFullYear(), init.getMonth(), 1));
  const lead = (month.getDay() + 6) % 7; // haftaning boshi — dushanba
  const count = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const cells: (Date | null)[] = [...Array<null>(lead).fill(null), ...Array.from({ length: count }, (_, i) => new Date(month.getFullYear(), month.getMonth(), i + 1))];
  const canPrev = month > new Date(today.getFullYear(), today.getMonth(), 1);
  const shift = (n: number) => setMonth((m) => new Date(m.getFullYear(), m.getMonth() + n, 1));
  const quick: [string, number][] = [["Bugun", 0], ["Ertaga", 1], ["+1 hafta", 7]];

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between">
        <button type="button" onClick={() => shift(-1)} disabled={!canPrev} aria-label="Oldingi oy"
          className="grid h-8 w-8 place-items-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 disabled:pointer-events-none disabled:opacity-30"><ChevronLeft size={16} /></button>
        <span className="text-sm font-semibold text-slate-900">{MONTHS[month.getMonth()]} {month.getFullYear()}</span>
        <button type="button" onClick={() => shift(1)} aria-label="Keyingi oy"
          className="grid h-8 w-8 place-items-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"><ChevronRight size={16} /></button>
      </div>
      <div className="grid grid-cols-7 gap-0.5 text-center">
        {WEEK.map((w, i) => <span key={w} className={cn("pb-1 text-[11px] font-medium", i === 6 ? "text-red-500" : "text-slate-400")}>{w}</span>)}
        {cells.map((d, i) => {
          if (!d) return <span key={`e${i}`} />;
          const v = isoDate(d), past = d < today, sel = v === value, isToday = d.getTime() === today.getTime();
          return (
            <button key={v} type="button" disabled={past} onClick={() => onPick(v)}
              className={cn("h-8 rounded-lg text-[13px] tabular transition",
                sel ? "bg-slate-900 font-semibold text-white"
                  : past ? "text-slate-300"
                  : cn("text-slate-700 hover:bg-brand-50 hover:text-slate-900", d.getDay() === 0 && "text-red-600"),
                isToday && !sel && "font-semibold ring-1 ring-brand-500 ring-inset")}>
              {d.getDate()}
            </button>
          );
        })}
      </div>
      <div className="flex items-center gap-1.5 border-t border-slate-100 pt-2.5">
        {quick.map(([l, n]) => (
          <button key={l} type="button" onClick={() => onPick(isoDate(addDays(today, n)))}
            className="h-7 rounded-md border border-slate-200 px-2 text-[12px] font-medium whitespace-nowrap text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900">{l}</button>
        ))}
        <button type="button" onClick={onClose} className="ml-auto h-7 px-1.5 text-[12px] text-slate-400 transition hover:text-slate-700">Bekor</button>
      </div>
    </div>
  );
}

/** Tugma ostida (joy bo'lmasa — ustida) kalendar o'rni; tugma ekrandan chiqib ketgan bo'lsa — null. */
function placeAt(el: HTMLElement | null): { top: number; left: number } | null {
  const r = el?.getBoundingClientRect();
  if (!r || r.bottom < 0 || r.top > window.innerHeight) return null;
  const below = r.bottom + 6 + H <= window.innerHeight;
  return { top: below ? r.bottom + 6 : Math.max(8, r.top - 6 - H), left: Math.min(Math.max(8, r.left), window.innerWidth - W - 8) };
}

export function DateMove({ o, name, label, className }: { o: { id: string; deliveryDate: string; dateUnknown: boolean }; name: string; label: string; className?: string }) {
  const btn = useRef<HTMLButtonElement>(null);
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  // Ko'chirilgan sana — tasdiq va yashil belgi bir necha soniya turadi
  const [moved, setMoved] = useState<string | null>(null);
  const current = o.dateUnknown ? null : isoDate(new Date(o.deliveryDate));
  const close = () => setPos(null);

  const toggle = () => {
    if (pos) return close();
    setErr(null);
    setPos(placeAt(btn.current));
  };

  // Sahifa yoki jadval aylansa — kalendar tugmaga ergashadi (bosilganda brauzer tugmani ko'rinishga surishi mumkin,
  // ilgari shunda kalendar darhol yopilib qolardi); tugma ekrandan chiqsa yoki Esc — yopiladi
  useEffect(() => {
    if (!pos) return;
    const follow = () => setPos(placeAt(btn.current));
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setPos(null); };
    window.addEventListener("scroll", follow, true);
    window.addEventListener("resize", follow);
    window.addEventListener("keydown", key);
    return () => { window.removeEventListener("scroll", follow, true); window.removeEventListener("resize", follow); window.removeEventListener("keydown", key); };
  }, [pos]);

  // Yangi sana bilan qayta chizilgach: zayavka jadvalda boshqa joyga o'tgan bo'lishi mumkin — uni ekranga olib kelamiz
  useEffect(() => {
    if (!moved || moved !== current) return;
    btn.current?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
    const t = setTimeout(() => setMoved(null), 5000);
    return () => clearTimeout(t);
  }, [moved, current]);

  const pickDay = (v: string) => {
    close();
    if (!v || v === current) return;
    start(async () => {
      const r = await rescheduleOrder(o.id, v);
      if (r?.error) setErr(r.error);
      else { setMoved(v); router.refresh(); }
    });
  };

  return (
    <span className="relative inline-flex flex-col">
      <button ref={btn} type="button" onClick={toggle} disabled={pending} title="Bosing — boshqa sanaga ko'chirish" aria-expanded={!!pos} aria-haspopup="dialog"
        className={cn("inline-flex items-center gap-1 rounded px-1 -mx-1 whitespace-nowrap underline decoration-dotted underline-offset-2 hover:bg-slate-100 hover:text-slate-900 disabled:opacity-60", className,
          moved && moved === current && "bg-emerald-600 text-[#fff] no-underline ring-2 ring-emerald-300 hover:bg-emerald-600 hover:text-[#fff]")}>
        {pending ? <Loader2 size={11} className="animate-spin" /> : moved && moved === current ? <Check size={11} /> : <CalendarDays size={11} />} {label}
      </button>
      {moved && moved === current && createPortal(
        <div role="status" className="fixed bottom-5 left-1/2 z-[90] flex -translate-x-1/2 items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-medium text-[#fff] shadow-(--shadow-pop)">
          <Check size={16} /> {name} — {dateRu(new Date(`${moved}T00:00:00`))} ga ko&apos;chirildi
        </div>,
        document.body,
      )}
      {pos && createPortal(
        <>
          <div className="fixed inset-0 z-[80]" onClick={close} aria-hidden />
          <div role="dialog" aria-label="Yangi yetkazish sanasi" style={{ top: pos.top, left: pos.left, width: W }}
            className="fixed z-[81] rounded-xl border border-slate-200 bg-white p-3 text-left font-normal whitespace-normal shadow-(--shadow-pop)">
            <div className="mb-2 text-[12px] text-slate-500">Qaysi kunga ko&apos;chiramiz?</div>
            <MiniCalendar value={current} onPick={pickDay} onClose={close} />
          </div>
        </>,
        document.body,
      )}
      {err && (
        <span role="alert" className="absolute top-full left-0 z-40 mt-1 flex w-60 items-start gap-1.5 rounded-md border border-red-200 bg-red-50 px-2 py-1.5 text-left text-[11px] leading-snug font-medium whitespace-normal text-red-700 shadow-md">
          <span className="min-w-0 flex-1">{err}</span>
          <button type="button" onClick={() => setErr(null)} aria-label="Yopish" className="shrink-0 text-red-500 hover:text-red-800"><X size={12} /></button>
        </span>
      )}
    </span>
  );
}
