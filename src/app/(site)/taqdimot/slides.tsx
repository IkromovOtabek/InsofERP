"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  Activity, ArrowRight, Award, BadgeCheck, Boxes, Building2, CheckCheck, ClipboardList,
  Cog, Factory, FileSignature, FlaskConical, Gauge, Handshake, Hammer, Landmark, Layers,
  Leaf, MapPin, Package, Rocket, Ruler, ShieldCheck, Target, Thermometer,
  Timer, TrendingUp, Truck, Users, Waves, Wrench,
} from "lucide-react";
import { MATN, type Lang, type Rich } from "./matn";

/**
 * INSOF taqdimoti — 23 ta slayd, PPT faylidan ko'chirilgan.
 *
 * Har bir slayd faqat o'z ichki qismini beradi; ramka, fon, sarlavha va
 * animatsiya `deck.tsx` da. Matnlar `matn.ts` da uch tilda (uz/ru/en) turadi —
 * bu yerda faqat tartib, ikonka va surat. Tanlangan til `buildSlides` ga
 * parametr bo'lib keladi.
 */

export type DeckCompany = {
  phone: string | null;
  phone2: string | null;
  email: string | null;
  address: string | null;
};

export type Slide = {
  n: number;
  tone: "dark" | "light";
  /** Sarlavha qatori — slaydning tepasida va ro'yxat (overview) ichida */
  title: string;
  sub?: string;
  /** To'liq kadr fon surati */
  bg?: string;
  /** Sarlavha bloki chizilmaydi — slayd o'zi to'liq kadr (muqova, yakun) */
  bare?: boolean;
  /** Ma'ruzachi izohi — PPT dagi "Notes" */
  notes: string;
  body: React.ReactNode;
};

/* ───────────────────────── Yordamchi bloklar ───────────────────────── */

/** Ketma-ket chiqish kechikishi — PPT dagi animatsiya tartibi */
const step = (i: number, base = 120) => ({ animationDelay: `${base + i * 90}ms` });

/** Raqam nolda emas, sanab chiqadi. Slayd har ochilganda qaytadan sanaydi. */
function Count({ to, prefix = "", suffix = "", ms = 1100, sep = false }: { to: number; prefix?: string; suffix?: string; ms?: number; sep?: boolean }) {
  const [v, setV] = useState(0);
  useEffect(() => {
    if (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setV(to);
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / ms);
      setV(Math.round(to * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [to, ms]);
  // Katta raqam bo'sh joy bilan ajratiladi: 45 000
  return <span className="tabular-nums">{prefix}{sep ? v.toLocaleString("ru-RU").replace(/ /g, " ") : v}{suffix}</span>;
}

/** PPT da bo'sh qolgan katak — sayt "tayyor emas" ko'rinmasin uchun bitta uslubda */
function Tbd({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center rounded border border-dashed border-current/35 px-2 py-0.5 font-mono text-[11px] tracking-wide opacity-55">
      {label}
    </span>
  );
}

/** Ichida qalin bo'lak bo'lgan matn (matn.ts dagi `Rich`) */
function RichText({ parts, boldClass }: { parts: Rich; boldClass: string }) {
  return (
    <>
      {parts.map((p, i) => (typeof p === "string" ? <span key={i}>{p}</span> : <span key={i} className={boldClass}>{p.b}</span>))}
    </>
  );
}

/** Katta raqamli katak (RAQAMLARDA INSOF, ZAVOD VA QUVVAT) */
function Cell({ value, label, i, tone, accent }: { value: React.ReactNode; label: string; i: number; tone: "dark" | "light"; accent?: boolean }) {
  const dark = tone === "dark";
  return (
    <div
      className={`deck-up group relative overflow-hidden rounded-lg p-5 sm:p-6 ${
        dark ? "bg-white/[0.045] ring-1 ring-white/10" : "bg-white ring-1 ring-beton-200"
      }`}
      style={step(i)}
    >
      <span className={`absolute inset-x-0 top-0 h-0.5 origin-left scale-x-0 transition-transform duration-500 group-hover:scale-x-100 ${accent ? "bg-signal" : dark ? "bg-white/40" : "bg-insof-500"}`} />
      <div className={`font-display text-[clamp(1.6rem,3.6vw,2.6rem)] leading-none font-extrabold ${accent ? "text-signal" : dark ? "text-white" : "text-insof-700"}`}>
        {value}
      </div>
      <div className={`mt-3 text-[13px] leading-snug sm:text-sm ${dark ? "text-white/55" : "text-beton-600"}`}>{label}</div>
    </div>
  );
}

/** Ikonkali kartochka (NEGA INSOF, SIFAT NAZORATI, HAMKORGA NIMA BERADI) */
function IconCard({
  icon: Icon, title, text, i, tone,
}: { icon: typeof ShieldCheck; title: string; text: string; i: number; tone: "dark" | "light" }) {
  const dark = tone === "dark";
  return (
    <div
      className={`deck-up flex gap-4 rounded-lg p-5 transition-colors sm:gap-5 sm:p-6 ${
        dark ? "bg-white/[0.045] ring-1 ring-white/10 hover:bg-white/[0.08]" : "bg-white ring-1 ring-beton-200 hover:ring-insof-400"
      }`}
      style={step(i)}
    >
      <span className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md sm:h-12 sm:w-12 ${dark ? "bg-signal text-white" : "bg-insof-900 text-signal"}`}>
        <Icon size={20} />
      </span>
      <div>
        <h3 className={`font-display text-[15px] leading-tight font-bold sm:text-lg ${dark ? "text-white" : "text-beton-900"}`}>{title}</h3>
        <p className={`mt-1.5 text-[13px] leading-relaxed sm:text-[15px] ${dark ? "text-white/60" : "text-beton-600"}`}>{text}</p>
      </div>
    </div>
  );
}

/** Raqamlangan qadam (ISHLAB CHIQARISH JARAYONI, JARAYON) */
function Step({ n, title, text, i, tone }: { n: string; title: string; text: string; i: number; tone: "dark" | "light" }) {
  const dark = tone === "dark";
  return (
    <li className={`deck-up relative rounded-lg p-5 ${dark ? "bg-white/[0.045] ring-1 ring-white/10" : "bg-white ring-1 ring-beton-200"}`} style={step(i)}>
      <span className="font-mono text-[13px] font-semibold text-signal">{n}</span>
      <h3 className={`mt-2 font-display text-[15px] leading-tight font-bold sm:text-lg ${dark ? "text-white" : "text-beton-900"}`}>{title}</h3>
      <p className={`mt-2 text-[13px] leading-relaxed sm:text-[14px] ${dark ? "text-white/60" : "text-beton-600"}`}>{text}</p>
    </li>
  );
}

/** Surat — ochilishda sekin yaqinlashadi (ken-burns) */
function Shot({ src, alt, caption, i, ratio = "aspect-4/3" }: { src: string; alt: string; caption?: string; i: number; ratio?: string }) {
  return (
    <figure className="deck-up group" style={step(i, 160)}>
      <div className={`relative overflow-hidden rounded-lg bg-beton-200 ${ratio}`}>
        <Image src={src} alt={alt} fill sizes="(min-width:1024px) 25vw, (min-width:640px) 50vw, 100vw" className="deck-kadr object-cover transition-transform duration-700 group-hover:scale-105" />
      </div>
      {caption && <figcaption className="mt-2.5 text-[12px] leading-snug font-medium sm:text-[13px]">{caption}</figcaption>}
    </figure>
  );
}

/* ───────────────── Tilga bog'liq bo'lmagan ma'lumot: ikonka, surat, video ───────────────── */

const ICONS = {
  nega: [ShieldCheck, BadgeCheck, Timer, Leaf],
  bazaChip: [Ruler, Cog, Thermometer, Truck],
  nazorat: [Gauge, Activity, CheckCheck],
  logistika: [Truck, Hammer, Timer],
  foyda: [Boxes, FlaskConical, Truck, Target, Rocket, Award],
  kimlar: [Landmark, Building2, Factory, FlaskConical],
  shakllar: [FileSignature, Package, Layers, Wrench],
};

const LAVHA = [
  { src: "/media/maydon.mp4", poster: "/media/maydon.jpg" },
  { src: "/media/xomashyo.mp4", poster: "/media/xomashyo.jpg" },
  { src: "/media/zavod.mp4", poster: "/media/zavod.jpg" },
];

const KATALOG = [
  "/taqdimot/mahsulot-1.jpg",
  "/taqdimot/mahsulot-2.jpg",
  "/taqdimot/mahsulot-3.jpg",
  "/taqdimot/mahsulot-4.jpg",
  "/taqdimot/mahsulot-5.jpg",
  "/taqdimot/mahsulot-6.jpg",
  "/taqdimot/mahsulot-7.jpg",
  "/taqdimot/mahsulot-8.jpg",
];

const HAMKORLAR = [
  { logo: "/taqdimot/hamkor-yangiyol.jpg", name: "Yangiyo'l City" },
  { logo: "/taqdimot/hamkor-mbg.jpg", name: "MBG House" },
  { logo: null, name: "MPMK-33" },
  { logo: "/taqdimot/hamkor-sergeli.jpg", name: "Sergeli City" },
];

/* ───────────────────────── Slaydlar ───────────────────────── */

export function buildSlides(c: DeckCompany, lang: Lang): Slide[] {
  const t = MATN[lang];
  const phone = c.phone?.trim() || "+998 33 000 14 18";
  const email = c.email?.trim() || "grppuzbekistan@gmail.com";
  const address = c.address?.trim() || t.addressDefault;
  // Tashkil etilgan yil taqdimotning o'zidan: korxona 2000-yildan buyon ishlaydi.
  const founded = 2000;
  const years = new Date().getFullYear() - founded;
  const tbd = <Tbd label={t.tbd} />;

  return [
    /* 01 ─ Muqova */
    {
      n: 1,
      tone: "light",
      bare: true,
      // Taqdimotdagi muqova kadri to'liq fon bo'lib turadi (logotip suratning o'zida)
      bg: "/taqdimot/muqova.jpg",
      title: t.s1.title,
      sub: t.s1.sub,
      notes: t.s1.notes,
      body: (
        <div className="max-w-2xl">
          {/* Keng ekranda logotip fon suratining o'zida ko'rinadi; telefonda kadr
              kesilgani uchun uni alohida chizamiz */}
          <Image
            src="/media/logo.png"
            alt={t.s1.logoAlt}
            width={940}
            height={172}
            priority
            className="deck-up h-10 w-auto sm:h-12 lg:hidden"
            style={step(0, 40)}
          />
          <div className="deck-line mt-6 h-0.5 w-14 bg-signal" style={step(1, 40)} />
          <p className="deck-up mt-5 font-display text-[clamp(1.35rem,3.6vw,2.7rem)] leading-[1.12] font-bold text-beton-900 sm:mt-6" style={step(2, 40)}>
            {t.s1.tagline(years, founded)}
          </p>
          <p className="deck-up mt-5 text-[14px] font-semibold text-insof-600 sm:text-lg" style={step(3, 40)}>
            {t.regions}
          </p>
          <p className="deck-up mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[12px] text-beton-600 sm:text-[13px]" style={step(4, 40)}>
            <span className="inline-flex items-center gap-2"><MapPin size={13} className="text-signal-dim" />{address}</span>
            <span className="hidden text-beton-400 sm:inline">|</span>
            <span className="tabular-nums">{phone}</span>
          </p>
        </div>
      ),
    },

    /* 02 ─ Kompaniya haqida */
    {
      n: 2,
      tone: "light",
      title: t.s2.title,
      sub: t.s2.sub,
      notes: t.s2.notes,
      body: (
        <div className="grid gap-8 lg:grid-cols-[1.25fr_1fr] lg:gap-14">
          <div className="space-y-4 sm:space-y-5">
            {t.s2.paras.map((p, i) => (
              <p key={i} className="deck-up text-[14px] leading-relaxed text-beton-700 sm:text-[17px]" style={step(i)}>{p}</p>
            ))}
          </div>
          <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1 lg:gap-0 lg:divide-y lg:divide-beton-200">
            {t.s2.facts.map(([k, v, note], i) => (
              <div key={k} className="deck-up rounded-lg bg-white p-4 ring-1 ring-beton-200 lg:rounded-none lg:bg-transparent lg:px-0 lg:py-3.5 lg:ring-0" style={step(i + 3)}>
                <dt className="font-mono text-[10px] tracking-[0.16em] text-signal-dim uppercase">{k}</dt>
                <dd className="mt-1 font-display text-[17px] font-bold text-beton-900 sm:text-xl">{v}</dd>
                {note && <dd className="mt-0.5 text-[13px] text-beton-500">{note}</dd>}
              </div>
            ))}
          </dl>
        </div>
      ),
    },

    /* 03 ─ Raqamlarda */
    {
      n: 3,
      tone: "dark",
      title: t.s3.title,
      sub: t.s3.sub,
      notes: t.s3.notes,
      body: (
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
          <Cell i={0} tone="dark" value={<Count to={years} />} label={t.s3.years(founded)} />
          <Cell i={1} tone="dark" value={<Count to={12} suffix={t.s3.areaSuf} />} label={t.s3.area} />
          <Cell i={2} tone="dark" accent value={<Count to={9} suffix={t.s3.ballSuf} />} label={t.s3.seismic} />
          <Cell i={3} tone="dark" value="M100-M600" label={t.s3.marks} />
          <Cell i={4} tone="dark" value={<Count to={4} suffix={t.s3.regSuf} />} label={t.s3.regions} />
          <Cell i={5} tone="dark" value={<Count to={18} suffix={t.s3.hourSuf} />} label={t.s3.hours} />
        </div>
      ),
    },

    /* 04 ─ Nega INSOF */
    {
      n: 4,
      tone: "light",
      title: t.s4.title,
      sub: t.s4.sub,
      notes: t.s4.notes,
      body: (
        <div className="grid gap-3 sm:gap-4 lg:grid-cols-2">
          {t.s4.items.map((a, i) => <IconCard key={a.title} icon={ICONS.nega[i]} {...a} i={i} tone="light" />)}
        </div>
      ),
    },

    /* 05 ─ Ishlab chiqarish bazasi */
    {
      n: 5,
      tone: "dark",
      title: t.s5.title,
      sub: t.s5.sub,
      notes: t.s5.notes,
      body: (
        <div className="grid gap-6 lg:grid-cols-2 lg:gap-12">
          <div className="deck-up relative aspect-16/10 overflow-hidden rounded-lg ring-1 ring-white/10" style={step(0)}>
            <Image src="/taqdimot/ombor.jpg" alt={t.s5.imgAlt} fill sizes="(min-width:1024px) 50vw, 100vw" className="deck-kadr object-cover" />
          </div>
          <div>
            {t.s5.paras.map((p, i) => (
              <p key={i} className="deck-up mb-4 text-[14px] leading-relaxed text-white/70 sm:text-[17px]" style={step(i + 1)}>{p}</p>
            ))}
            <ul className="mt-5 grid gap-2.5 sm:grid-cols-2">
              {t.s5.chips.map((text, i) => {
                const Icon = ICONS.bazaChip[i];
                return (
                  <li key={text} className="deck-up flex items-center gap-3 rounded-md bg-white/[0.045] px-4 py-3 text-[13px] text-white/85 ring-1 ring-white/10 sm:text-sm" style={step(i + 3)}>
                    <Icon size={16} className="shrink-0 text-signal" />
                    {text}
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      ),
    },

    /* 06 ─ Zavod va quvvat */
    {
      n: 6,
      tone: "dark",
      title: t.s6.title,
      sub: t.s6.sub,
      notes: t.s6.notes,
      body: (
        <div>
          <p className="deck-up mb-5 text-[13px] text-white/60 sm:text-[15px]" style={step(0, 60)}>
            {t.s6.intro(founded)}
          </p>
          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
            <Cell i={0} tone="dark" value={<Count to={70} />} label={t.s6.cells[0]} />
            <Cell i={1} tone="dark" value="1000-1500" label={t.s6.cells[1]} />
            <Cell i={2} tone="dark" accent value={<Count to={45000} sep />} label={t.s6.cells[2]} />
            <Cell i={3} tone="dark" value={<Count to={150} />} label={t.s6.cells[3]} />
            <Cell i={4} tone="dark" value={<Count to={4650} sep />} label={t.s6.cells[4]} />
            <Cell i={5} tone="dark" value={<Count to={120} />} label={t.s6.cells[5]} />
          </div>
        </div>
      ),
    },

    /* 07 ─ Zavod ishda (video) */
    {
      n: 7,
      tone: "dark",
      title: t.s7.title,
      sub: t.s7.sub,
      notes: t.s7.notes,
      body: (
        <div className="grid gap-4 sm:grid-cols-3">
          {LAVHA.map((v, i) => (
            <figure key={v.src} className="deck-up overflow-hidden rounded-lg bg-white/[0.045] ring-1 ring-white/10" style={step(i, 160)}>
              <video
                src={v.src}
                poster={v.poster}
                autoPlay
                muted
                loop
                playsInline
                preload="metadata"
                onClick={(e) => { const el = e.currentTarget; if (el.paused) void el.play(); else el.pause(); }}
                className="aspect-9/16 w-full cursor-pointer object-cover sm:aspect-4/5"
              />
              <figcaption className="px-4 py-3.5">
                <div className="font-display text-[15px] font-bold text-white sm:text-base">{t.s7.clips[i].title}</div>
                <div className="mt-1 font-mono text-[10px] tracking-[0.12em] text-white/35 uppercase">{t.s7.clips[i].meta}</div>
              </figcaption>
            </figure>
          ))}
        </div>
      ),
    },

    /* 08 ─ Tovar beton */
    {
      n: 8,
      tone: "light",
      title: t.s8.title,
      sub: t.s8.sub,
      notes: t.s8.notes,
      body: (
        <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr] lg:gap-10">
          <div>
            <div className="overflow-hidden rounded-lg ring-1 ring-beton-200">
              {t.s8.marks.map(([m, use], i) => (
                <div
                  key={m}
                  className={`deck-right grid grid-cols-[86px_1fr] items-center gap-3 px-4 py-2.5 text-[13px] sm:grid-cols-[120px_1fr] sm:py-3 sm:text-[15px] ${i % 2 ? "bg-beton-50" : "bg-white"}`}
                  style={step(i, 100)}
                >
                  <span className="font-display font-bold text-insof-700">{m}</span>
                  <span className="text-beton-700">{use}</span>
                </div>
              ))}
            </div>
            <p className="deck-up mt-4 text-[13px] text-beton-500 sm:text-sm" style={step(9)}>
              {t.s8.note}
            </p>
          </div>
          <div className="deck-up relative hidden aspect-4/3 overflow-hidden rounded-lg ring-1 ring-beton-200 lg:block" style={step(2)}>
            <Image src="/taqdimot/markalar.jpg" alt={t.s8.imgAlt} fill sizes="33vw" className="deck-kadr object-cover" />
          </div>
        </div>
      ),
    },

    /* 09 ─ Katalog */
    {
      n: 9,
      tone: "light",
      title: t.s9.title,
      sub: t.s9.sub,
      notes: t.s9.notes,
      body: (
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          {KATALOG.map((src, i) => (
            <Shot
              key={src}
              src={src}
              alt={t.s9.items[i]}
              i={i}
              caption={t.s9.items[i]}
              ratio="aspect-4/3"
            />
          ))}
        </div>
      ),
    },

    /* 10 ─ Texnik xususiyatlar */
    {
      n: 10,
      tone: "light",
      title: t.s10.title,
      sub: t.s10.sub,
      notes: t.s10.notes,
      body: (
        <div>
          <div className="overflow-hidden rounded-lg ring-1 ring-beton-200">
            <div className="hidden grid-cols-[1.4fr_1.2fr_1.1fr_0.7fr] gap-3 bg-insof-900 px-4 py-2.5 font-mono text-[10px] tracking-[0.14em] text-white/70 uppercase sm:grid">
              {t.s10.head.map((h) => <span key={h}>{h}</span>)}
            </div>
            {t.s10.rows.map((r, i) => (
              <div
                key={r.name}
                className={`deck-right grid gap-1 px-4 py-3 text-[13px] sm:grid-cols-[1.4fr_1.2fr_1.1fr_0.7fr] sm:gap-3 sm:text-[14px] ${i % 2 ? "bg-beton-50" : "bg-white"}`}
                style={step(i, 90)}
              >
                <span className="font-semibold text-beton-900">{r.name}</span>
                <span className="text-insof-700">{r.klass ?? tbd}</span>
                <span className="text-beton-600">{r.olcham ?? tbd}</span>
                <span className="text-beton-600 tabular-nums">{r.ogirlik ?? tbd}</span>
              </div>
            ))}
          </div>
          <p className="deck-up mt-4 text-[13px] text-beton-500 sm:text-sm" style={step(10)}>
            {t.s10.note}
          </p>
        </div>
      ),
    },

    /* 11 ─ Opora SV 110-3,5 */
    {
      n: 11,
      tone: "dark",
      title: t.s11.title,
      sub: t.s11.sub,
      notes: t.s11.notes,
      body: (
        <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr] lg:gap-12">
          <div className="grid grid-cols-2 gap-3 sm:gap-4">
            <Cell i={0} tone="dark" value={<Count to={11} suffix={t.s11.mSuf} />} label={t.s11.length} />
            <Cell i={1} tone="dark" value={<Count to={35} suffix={t.s11.kNmSuf} />} label={t.s11.moment} />
            <Cell i={2} tone="dark" value={<Count to={1125} suffix={t.s11.kgSuf} />} label={t.s11.weight} />
            <Cell i={3} tone="dark" accent value={<Count to={9} suffix={t.s11.ballSuf} />} label={t.s11.seismic} />
          </div>
          <div className="flex flex-col justify-center gap-5">
            <div className="deck-up relative aspect-16/10 overflow-hidden rounded-lg ring-1 ring-white/10" style={step(4)}>
              <Image src="/taqdimot/mahsulot-2.jpg" alt={t.s11.imgAlt} fill sizes="(min-width:1024px) 45vw, 100vw" className="deck-kadr object-cover" />
            </div>
            <p className="deck-up text-[14px] leading-relaxed text-white/70 sm:text-base" style={step(5)}>
              {t.s11.text}
            </p>
          </div>
        </div>
      ),
    },

    /* 12 ─ Inert materiallar */
    {
      n: 12,
      tone: "light",
      title: t.s12.title,
      sub: t.s12.sub,
      notes: t.s12.notes,
      body: (
        <div className="grid gap-6 lg:grid-cols-2 lg:gap-12">
          <div className="deck-up relative aspect-16/10 overflow-hidden rounded-lg ring-1 ring-beton-200" style={step(0)}>
            <Image src="/taqdimot/inert.jpg" alt={t.s12.imgAlt} fill sizes="(min-width:1024px) 50vw, 100vw" className="deck-kadr object-cover" />
          </div>
          <div className="space-y-4">
            <div className="deck-up rounded-lg bg-white p-5 ring-1 ring-beton-200" style={step(1)}>
              <h3 className="flex items-center gap-2.5 font-display text-[17px] font-bold text-beton-900 sm:text-xl">
                <Boxes size={18} className="text-signal-dim" /> {t.s12.stone.h}
              </h3>
              <p className="mt-2 text-[14px] leading-relaxed text-beton-600 sm:text-[15px]">
                {t.s12.stone.p}
              </p>
            </div>
            <div className="deck-up rounded-lg bg-white p-5 ring-1 ring-beton-200" style={step(2)}>
              <h3 className="flex items-center gap-2.5 font-display text-[17px] font-bold text-beton-900 sm:text-xl">
                <Waves size={18} className="text-signal-dim" /> {t.s12.sand.h}
              </h3>
              <p className="mt-2 text-[14px] leading-relaxed text-beton-600 sm:text-[15px]">
                {t.s12.sand.p}
              </p>
            </div>
            <p className="deck-up flex items-start gap-3 rounded-lg border-l-4 border-signal bg-beton-100 p-4 text-[13px] leading-relaxed text-beton-700 sm:text-[15px]" style={step(3)}>
              <Truck size={18} className="mt-0.5 shrink-0 text-insof-700" />
              {t.s12.callout}
            </p>
          </div>
        </div>
      ),
    },

    /* 13 ─ Ishlab chiqarish jarayoni */
    {
      n: 13,
      tone: "light",
      title: t.s13.title,
      sub: t.s13.sub,
      notes: t.s13.notes,
      body: (
        <ol className="grid gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-4">
          {t.s13.steps.map((s, i) => <Step key={s.n} {...s} i={i} tone="light" />)}
        </ol>
      ),
    },

    /* 14 ─ Sifat nazorati */
    {
      n: 14,
      tone: "dark",
      title: t.s14.title,
      sub: t.s14.sub,
      notes: t.s14.notes,
      body: (
        <div>
          <p className="deck-up max-w-4xl text-[14px] leading-relaxed text-white/75 sm:text-[17px]" style={step(0)}>
            {t.s14.intro}
          </p>
          <div className="mt-6 grid gap-3 sm:gap-4 lg:grid-cols-3">
            {t.s14.items.map((a, i) => <IconCard key={a.title} icon={ICONS.nazorat[i]} {...a} i={i + 1} tone="dark" />)}
          </div>
        </div>
      ),
    },

    /* 15 ─ Logistika */
    {
      n: 15,
      tone: "light",
      title: t.s15.title,
      sub: t.s15.sub,
      notes: t.s15.notes,
      body: (
        <div>
          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
            {t.s15.regions.map((h, i) => (
              <div key={h} className="deck-pop flex items-center gap-3 rounded-lg bg-insof-900 px-4 py-5 sm:px-5" style={step(i)}>
                <MapPin size={18} className="shrink-0 text-signal" />
                <span className="font-display text-[14px] leading-tight font-bold text-white sm:text-[17px]">{h}</span>
              </div>
            ))}
          </div>
          <div className="mt-6 grid gap-3 sm:gap-4 lg:grid-cols-3">
            {t.s15.items.map((text, i) => {
              const Icon = ICONS.logistika[i];
              return (
                <div key={text} className="deck-up flex items-start gap-3 rounded-lg bg-white p-5 ring-1 ring-beton-200" style={step(i + 4)}>
                  <Icon size={18} className="mt-0.5 shrink-0 text-insof-700" />
                  <span className="text-[14px] leading-relaxed text-beton-700 sm:text-[15px]">{text}</span>
                </div>
              );
            })}
          </div>
        </div>
      ),
    },

    /* 16 ─ Hamkorlar */
    {
      n: 16,
      tone: "light",
      title: t.s16.title,
      sub: t.s16.sub,
      notes: t.s16.notes,
      body: (
        <div>
          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
            {HAMKORLAR.map((h, i) => (
              <div key={h.name} className="deck-pop flex flex-col items-center justify-center rounded-lg bg-white p-4 ring-1 ring-beton-200 sm:p-5" style={step(i)}>
                <div className="relative flex h-20 w-full items-center justify-center sm:h-24">
                  {h.logo ? (
                    <Image src={h.logo} alt={h.name} fill sizes="(min-width:1024px) 22vw, 45vw" className="object-contain" />
                  ) : (
                    <span className="font-display text-[22px] font-extrabold text-insof-700 sm:text-3xl">{h.name}</span>
                  )}
                </div>
                {/* Logotipsiz kartochkada nom allaqachon katta yozilgan — takrorlanmaydi */}
                {h.logo && <div className="mt-3 text-center font-display text-[13px] font-bold text-beton-900 sm:text-[15px]">{h.name}</div>}
              </div>
            ))}
          </div>
          <div className="deck-up mt-6 flex items-start gap-3 rounded-lg border-l-4 border-signal bg-white p-5 ring-1 ring-beton-200" style={step(4)}>
            <Handshake size={18} className="mt-0.5 shrink-0 text-insof-700" />
            <div>
              <p className="text-[14px] leading-relaxed font-semibold text-beton-900 sm:text-[15px]">
                {t.s16.p1}
              </p>
              <p className="mt-1.5 text-[13px] leading-relaxed text-beton-600 sm:text-[14px]">
                {t.s16.p2}
              </p>
            </div>
          </div>
        </div>
      ),
    },

    /* 17 ─ Hamkorga nima beradi */
    {
      n: 17,
      tone: "light",
      title: t.s17.title,
      sub: t.s17.sub,
      notes: t.s17.notes,
      body: (
        <div className="grid gap-3 sm:gap-4 lg:grid-cols-3">
          {t.s17.items.map((a, i) => <IconCard key={a.title} icon={ICONS.foyda[i]} {...a} i={i} tone="light" />)}
        </div>
      ),
    },

    /* 18 ─ Kimlar uchun */
    {
      n: 18,
      tone: "dark",
      title: t.s18.title,
      sub: t.s18.sub,
      notes: t.s18.notes,
      body: (
        <div className="grid gap-3 sm:gap-4 lg:grid-cols-2">
          {t.s18.items.map((a, i) => <IconCard key={a.title} icon={ICONS.kimlar[i]} {...a} i={i} tone="dark" />)}
        </div>
      ),
    },

    /* 19 ─ Hamkorlik shakllari */
    {
      n: 19,
      tone: "light",
      title: t.s19.title,
      sub: t.s19.sub,
      notes: t.s19.notes,
      body: (
        <div>
          <div className="grid gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-4">
            {t.s19.items.map((a, i) => {
              const Icon = ICONS.shakllar[i];
              return (
                <div key={a.title} className="deck-up rounded-lg bg-white p-5 ring-1 ring-beton-200" style={step(i)}>
                  <span className="inline-flex h-11 w-11 items-center justify-center rounded-md bg-insof-900 text-signal">
                    <Icon size={19} />
                  </span>
                  <h3 className="mt-4 font-display text-[15px] leading-tight font-bold text-beton-900 sm:text-lg">{a.title}</h3>
                  <p className="mt-2 text-[13px] leading-relaxed text-beton-600 sm:text-[14px]">{a.text}</p>
                </div>
              );
            })}
          </div>
          <p className="deck-up mt-6 text-[14px] text-beton-600 sm:text-[15px]" style={step(4)}>
            {t.s19.note}
          </p>
        </div>
      ),
    },

    /* 20 ─ Jarayon */
    {
      n: 20,
      tone: "dark",
      title: t.s20.title,
      sub: t.s20.sub,
      notes: t.s20.notes,
      body: (
        <div>
          <ol className="grid gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-5">
            {t.s20.steps.map((s, i) => <Step key={s.n} {...s} i={i} tone="dark" />)}
          </ol>
          <p className="deck-up mt-6 flex flex-wrap items-center gap-3 rounded-lg bg-signal px-5 py-4 text-[14px] font-semibold text-white sm:text-[17px]" style={step(5)}>
            <ClipboardList size={18} />
            {t.s20.cta}
            <a href={`tel:${phone.replace(/[^\d+]/g, "")}`} className="font-display tabular-nums underline-offset-4 hover:underline">{phone}</a>
          </p>
        </div>
      ),
    },

    /* 21 ─ Davlat qo'llab-quvvatlashi */
    {
      n: 21,
      tone: "light",
      title: t.s21.title,
      sub: t.s21.sub,
      notes: t.s21.notes,
      body: (
        <div>
          <div className="grid gap-3 sm:gap-4 lg:grid-cols-3">
            {t.s21.cards.map((card, i) => (
              <div key={card.title} className="deck-up rounded-lg bg-white p-5 ring-1 ring-beton-200 sm:p-6" style={step(i)}>
                <span className="font-mono text-[13px] font-semibold text-signal-dim">{String(i + 1).padStart(2, "0")}</span>
                <h3 className="mt-2 font-display text-[17px] leading-tight font-bold text-beton-900 sm:text-xl">{card.title}</h3>
                <p className="mt-2.5 text-[14px] leading-relaxed text-beton-600 sm:text-[15px]">
                  <RichText parts={card.text} boldClass="font-semibold text-insof-700 tabular-nums" />
                </p>
              </div>
            ))}
          </div>

          {/* Natija — slaydning eng kuchli qatori, shuning uchun sariq */}
          <div className="deck-pop mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg bg-signal px-5 py-4 text-white sm:mt-5" style={step(3)}>
            <span className="font-mono text-[11px] tracking-[0.16em] uppercase">{t.s21.resultLabel}</span>
            <span className="flex items-center gap-2 text-[14px] font-semibold sm:text-[16px]"><TrendingUp size={17} /> {t.s21.results[0]}</span>
            <span className="flex items-center gap-2 text-[14px] font-semibold sm:text-[16px]"><Layers size={17} /> {t.s21.results[1]}</span>
            <span className="flex items-center gap-2 text-[14px] font-semibold sm:text-[16px]"><Users size={17} /> {t.s21.results[2]}</span>
          </div>
        </div>
      ),
    },

    /* 22 ─ Missiya va vizyon */
    {
      n: 22,
      tone: "dark",
      title: t.s22.title,
      sub: t.s22.sub,
      notes: t.s22.notes,
      body: (
        <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr] lg:gap-12">
          <div className="deck-up" style={step(0)}>
            <p className="font-mono text-[10px] tracking-[0.16em] text-signal uppercase">{t.s22.missionLabel}</p>
            <blockquote className="mt-4 font-display text-[clamp(1.15rem,2.6vw,2rem)] leading-snug font-bold text-white">
              {t.s22.mission}
            </blockquote>
          </div>
          <div className="flex flex-col justify-center gap-4">
            <div className="deck-up rounded-lg bg-white/[0.045] p-5 ring-1 ring-white/10" style={step(1)}>
              <p className="font-mono text-[10px] tracking-[0.16em] text-signal uppercase">{t.s22.visionLabel}</p>
              <p className="mt-2.5 text-[14px] leading-relaxed text-white/75 sm:text-base">
                {t.s22.vision}
              </p>
            </div>
            <div className="deck-pop rounded-lg bg-signal p-5" style={step(2)}>
              <div className="font-display text-[clamp(1.8rem,4vw,2.8rem)] leading-none font-extrabold text-white">
                <Count to={35} prefix={t.s22.pctPrefix} suffix="%" />
              </div>
              <p className="mt-2 text-[14px] leading-relaxed text-white/90 sm:text-[15px]">
                {t.s22.pct}
              </p>
            </div>
          </div>
        </div>
      ),
    },

    /* 23 ─ Yakun */
    {
      n: 23,
      tone: "dark",
      bare: true,
      bg: "/taqdimot/avtopark.jpg",
      title: t.s23.title,
      sub: t.s23.sub,
      notes: t.s23.notes,
      body: (
        <div className="w-full">
          <h2 className="deck-up font-display text-[clamp(1.8rem,5.4vw,3.6rem)] leading-[1.05] font-extrabold text-white" style={step(0, 60)}>
            {t.s23.h}
          </h2>
          <p className="deck-up mt-4 text-[15px] text-white/80 sm:text-xl" style={step(1, 60)}>
            {t.s23.p}
          </p>
          <div className="deck-line mt-6 h-0.5 w-56 max-w-full bg-signal" style={step(2, 60)} />
          <dl className="mt-7 grid gap-4 sm:grid-cols-3">
            {[
              [t.s23.phone, phone, `tel:${phone.replace(/[^\d+]/g, "")}`],
              [t.s23.email, email, `mailto:${email}`],
              [t.s23.address, address, null],
            ].map(([k, v, href], i) => (
              <div key={k as string} className="deck-up rounded-lg bg-white/[0.06] p-4 ring-1 ring-white/10 backdrop-blur-xs" style={step(i + 3, 60)}>
                <dt className="font-mono text-[10px] tracking-[0.16em] text-signal uppercase">{k}</dt>
                <dd className="mt-1.5 text-[15px] font-semibold break-words text-white sm:text-[17px]">
                  {href ? <a href={href as string} className="underline-offset-4 hover:underline">{v}</a> : v}
                </dd>
              </div>
            ))}
          </dl>
          <div className="deck-up mt-7 flex flex-wrap gap-3" style={step(6, 60)}>
            <Link href="/#ariza" className="inline-flex h-12 items-center gap-2.5 rounded-md bg-signal px-6 text-[15px] font-semibold text-white transition-colors hover:bg-signal-600">
              {t.s23.cta1} <ArrowRight size={17} />
            </Link>
            <Link href="/#mahsulotlar" className="inline-flex h-12 items-center rounded-md border border-white/30 px-6 text-[15px] font-semibold text-white transition-colors hover:bg-white/10">
              {t.s23.cta2}
            </Link>
          </div>
          <p className="deck-up mt-7 font-mono text-[11px] tracking-[0.14em] text-white/45 uppercase" style={step(7, 60)}>
            {t.s23.footer}
          </p>
        </div>
      ),
    },
  ];
}
