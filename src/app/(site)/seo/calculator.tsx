"use client";

import { useMemo, useState } from "react";
import { ArrowRight, Box, Layers, Truck } from "lucide-react";
import type { Lang } from "@/lib/seo-content/lang";

type Tab = "fbs" | "pk" | "beton";

/** GOST 13579: blok og'irligi, t (eni bo'yicha) */
const FBS_WEIGHT: Record<number, { b24: number; b12: number }> = {
  400: { b24: 1.3, b12: 0.64 },
  500: { b24: 1.63, b12: 0.79 },
  600: { b24: 1.96, b12: 0.96 },
};

const T = {
  uz: {
    tabs: { fbs: "FBS bloklar", pk: "PK plitalar", beton: "Beton" },
    fbsLen: "Poydevor devorlari umumiy uzunligi, m", fbsH: "Poydevor balandligi, m", width: "Blok eni", rows: "qator",
    total: "Jami bloklar", weight: "Umumiy og'irlik", trucks: "Uzun yuk mashinasi (~20 t)",
    span: "Devorlar orasidagi oraliq, m", wall: "Plitalar teriladigan devor uzunligi, m", slabW: "Plita eni",
    slab: "Plita", count: "Plitalar soni", area: "Yopma maydoni",
    note: "Plita uzunligi = oraliq + 0,24 m tayanish uchun. Yakuniy tanlov — zavod muhandisi.",
    type: "Konstruksiya", strip: "Lentali poydevor", plate: "Plita / styajka", len: "Uzunlik, m", wid: "Eni, m", dep: "Balandlik / qalinlik, m",
    volume: "Beton hajmi (3% zaxira bilan)", mixers: "Mikserlar (~8 m³)", grade: "Tavsiya etilgan marka",
    send: "Narxini so'rash", pcs: "dona", t: "t", m2: "m²", m3: "m³", m: "m", mm: "mm",
  },
  ru: {
    tabs: { fbs: "Блоки ФБС", pk: "Плиты ПК", beton: "Бетон" },
    fbsLen: "Общая длина стен фундамента, м", fbsH: "Высота фундамента, м", width: "Ширина блока", rows: "рядов",
    total: "Всего блоков", weight: "Общий вес", trucks: "Длинномеров (~20 т)",
    span: "Пролёт между стенами, м", wall: "Длина стены, вдоль которой кладут плиты, м", slabW: "Ширина плиты",
    slab: "Плита", count: "Количество плит", area: "Площадь перекрытия",
    note: "Длина плиты = пролёт + 0,24 м на опирание. Окончательный подбор — инженер завода.",
    type: "Конструкция", strip: "Ленточный фундамент", plate: "Плита / стяжка", len: "Длина, м", wid: "Ширина, м", dep: "Высота / толщина, м",
    volume: "Объём бетона (с запасом 3%)", mixers: "Миксеров (~8 м³)", grade: "Рекомендуемая марка",
    send: "Узнать цену", pcs: "шт", t: "т", m2: "м²", m3: "м³", m: "м", mm: "мм",
  },
};

const num = (v: string) => { const n = parseFloat(v.replace(",", ".")); return Number.isFinite(n) && n > 0 ? n : 0; };
const fmt = (n: number, d = 0) => n.toFixed(d).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, " ");
const field = "w-full rounded-xl bg-white px-4 py-3 font-mono text-lg ring-1 ring-beton-200 outline-none focus:ring-2 focus:ring-insof-500";
const lbl = "mb-1.5 block text-sm text-beton-600";

function Seg<V extends string | number>({ label, value, options, onChange }: { label: string; value: V; options: { v: V; l: string }[]; onChange: (v: V) => void }) {
  return (
    <div>
      <span className={lbl}>{label}</span>
      <div className="flex rounded-xl bg-white p-1 ring-1 ring-beton-200">
        {options.map((o) => (
          <button key={String(o.v)} type="button" onClick={() => onChange(o.v)} className={`flex-1 rounded-lg px-3 py-2 font-mono text-sm transition ${value === o.v ? "bg-insof-900 text-white" : "text-beton-600 hover:text-beton-900"}`}>{o.l}</button>
        ))}
      </div>
    </div>
  );
}

/** FBS / PK plita / beton miqdori kalkulyatori (GOST o'lchamlari bo'yicha). Natija — taxminiy, narxni menejer aytadi. */
export function SeoCalculator({ lang, initial = "fbs" }: { lang: Lang; initial?: Tab }) {
  const c = T[lang];
  const [tab, setTab] = useState<Tab>(initial);
  const [fLen, setFLen] = useState("54"); const [fH, setFH] = useState("1.8"); const [fW, setFW] = useState(500);
  const [pSpan, setPSpan] = useState("6"); const [pLen, setPLen] = useState("12"); const [pW, setPW] = useState(1.2);
  const [bT, setBT] = useState<"strip" | "plate">("strip"); const [bL, setBL] = useState("54"); const [bW, setBW] = useState("0.4"); const [bD, setBD] = useState("0.8");

  const fbs = useMemo(() => {
    const L = num(fLen);
    const rows = Math.max(1, Math.ceil(num(fH) / 0.6 - 1e-9));
    const n24 = Math.floor(L / 2.4 + 1e-9);
    const rest = L - n24 * 2.4;
    const n12 = rest > 0.05 ? Math.ceil(rest / 1.2 - 1e-9) : 0;
    const w = FBS_WEIGHT[fW]!;
    const weight = n24 * rows * w.b24 + n12 * rows * w.b12;
    return { rows, b24: n24 * rows, b12: n12 * rows, weight, trucks: Math.ceil(weight / 20) };
  }, [fLen, fH, fW]);
  const pk = useMemo(() => {
    const len = Math.ceil((num(pSpan) + 0.24) * 10 - 1e-9) / 10;
    const count = Math.ceil(num(pLen) / pW - 0.05);
    return { mark: `${lang === "uz" ? "PK" : "ПК"} ${Math.round(len * 10)}-${Math.round(pW * 10)}-8`, count, area: count * len * pW };
  }, [pSpan, pLen, pW, lang]);
  const beton = useMemo(() => {
    const v = num(bL) * num(bW) * num(bD) * 1.03;
    return { v, mixers: Math.ceil(v / 8 - 1e-9), grade: bT === "strip" ? (lang === "uz" ? "M250–M300" : "М250–М300") : (lang === "uz" ? "M200–M300" : "М200–М300") };
  }, [bL, bW, bD, bT, lang]);

  const input = (label: string, v: string, set: (x: string) => void, suffix?: string) => (
    <label className="block">
      <span className={lbl}>{label}</span>
      <span className="relative block">
        <input type="number" inputMode="decimal" min="0" step="0.1" value={v} onChange={(e) => set(e.target.value)} className={field} />
        {suffix && <span className="pointer-events-none absolute top-1/2 right-4 -translate-y-1/2 font-mono text-sm text-beton-400">{suffix}</span>}
      </span>
    </label>
  );
  const result = (main: [string, string], items: [string, string][]) => (
    <div className="rounded-3xl bg-insof-900 p-6 text-white">
      <p className="font-mono text-[11px] tracking-[0.16em] text-white/50 uppercase">{main[0]}</p>
      <p className="mt-2 font-display text-5xl font-bold text-signal">{main[1]}</p>
      <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-4">
        {items.map(([k, v]) => <div key={k} className="border-t border-white/10 pt-3"><dt className="text-xs text-white/50">{k}</dt><dd className="mt-1 font-mono">{v}</dd></div>)}
      </dl>
    </div>
  );

  return (
    <div className="rounded-3xl bg-beton-50 p-3 ring-1 ring-beton-200 sm:p-4">
      <div role="tablist" className="grid grid-cols-3 gap-1 rounded-2xl bg-white p-1 ring-1 ring-beton-200">
        {([["fbs", Box], ["pk", Layers], ["beton", Truck]] as const).map(([k, Icon]) => (
          <button key={k} role="tab" aria-selected={tab === k} type="button" onClick={() => setTab(k)} className={`flex items-center justify-center gap-2 rounded-xl px-2 py-3 text-sm font-semibold transition ${tab === k ? "bg-insof-600 text-white" : "text-beton-600 hover:text-beton-900"}`}>
            <Icon size={16} className="hidden sm:block" /> {c.tabs[k]}
          </button>
        ))}
      </div>
      <div className="grid gap-6 p-2 pt-5 sm:p-4 lg:grid-cols-2">
        <div className="space-y-4">
          {tab === "fbs" && <>
            {input(c.fbsLen, fLen, setFLen, c.m)}
            {input(c.fbsH, fH, setFH, `${fbs.rows} ${c.rows}`)}
            <Seg label={c.width} value={fW} onChange={setFW} options={[400, 500, 600].map((v) => ({ v, l: `${v} ${c.mm}` }))} />
          </>}
          {tab === "pk" && <>
            {input(c.span, pSpan, setPSpan, c.m)}
            {input(c.wall, pLen, setPLen, c.m)}
            <Seg label={c.slabW} value={pW} onChange={setPW} options={[1, 1.2, 1.5].map((v) => ({ v, l: `${fmt(v, 1)} ${c.m}` }))} />
            <p className="text-sm text-beton-500">{c.note}</p>
          </>}
          {tab === "beton" && <>
            <Seg label={c.type} value={bT} onChange={(v) => { setBT(v); if (v === "plate") { setBL("10"); setBW("12"); setBD("0.3"); } else { setBL("54"); setBW("0.4"); setBD("0.8"); } }} options={[{ v: "strip" as const, l: c.strip }, { v: "plate" as const, l: c.plate }]} />
            <div className="grid grid-cols-3 gap-3">{input(c.len, bL, setBL)}{input(c.wid, bW, setBW)}{input(c.dep, bD, setBD)}</div>
          </>}
        </div>
        <div className="space-y-3">
          {tab === "fbs" && result([c.total, `${fmt(fbs.b24 + fbs.b12)} ${c.pcs}`], [
            [`${lang === "uz" ? "FBS" : "ФБС"} 24.${fW / 100}.6`, `${fmt(fbs.b24)} ${c.pcs}`],
            [`${lang === "uz" ? "FBS" : "ФБС"} 12.${fW / 100}.6`, `${fmt(fbs.b12)} ${c.pcs}`],
            [c.weight, `≈ ${fmt(fbs.weight, 1)} ${c.t}`],
            [c.trucks, fmt(fbs.trucks)],
          ])}
          {tab === "pk" && result([c.count, `${fmt(pk.count)} ${c.pcs}`], [[c.slab, pk.mark], [c.area, `${fmt(pk.area, 1)} ${c.m2}`]])}
          {tab === "beton" && result([c.volume, `${fmt(beton.v, 1)} ${c.m3}`], [[c.mixers, fmt(beton.mixers)], [c.grade, beton.grade]])}
          <a href="#ariza" className="flex h-12 items-center justify-center gap-2 rounded-full bg-signal font-semibold text-white transition hover:bg-signal-600">
            {c.send} <ArrowRight size={16} />
          </a>
        </div>
      </div>
    </div>
  );
}
