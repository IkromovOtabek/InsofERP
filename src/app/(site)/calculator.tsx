"use client";

import { useMemo, useState } from "react";
import { ArrowRight, Calculator } from "lucide-react";
import { pickQty, scrollToForm } from "./lead-bus";

/**
 * Beton hajmi kalkulyatori.
 *
 * Qurilishchi ko'pincha "qancha beton kerak?" degan savol bilan keladi, hajmni
 * emas, o'lchamni biladi. Uzunlik × kenglik × qalinlik — shu yerda hisoblanadi,
 * ustiga 5 % zaxira qo'shiladi (to'kilish, notekis asos), natija bir bosishda
 * ariza formasiga tushadi. Hisob faqat brauzerda, serverga so'rov yo'q.
 */

const PRESETS = [
  { label: "Poydevor lentasi", l: "24", w: "0.4", h: "0.6" },
  { label: "Pol / stajka", l: "10", w: "8", h: "0.12" },
  { label: "Monolit plita", l: "12", w: "9", h: "0.2" },
] as const;

const RESERVE = 0.05;

function num(v: string) {
  const n = parseFloat(v.replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function fmt(v: number) {
  return v.toLocaleString("ru-RU", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

export function VolumeCalculator() {
  const [l, setL] = useState<string>(PRESETS[2].l);
  const [w, setW] = useState<string>(PRESETS[2].w);
  const [h, setH] = useState<string>(PRESETS[2].h);
  const [preset, setPreset] = useState<number>(2);

  const volume = useMemo(() => num(l) * num(w) * num(h), [l, w, h]);
  const total = volume * (1 + RESERVE);

  const apply = (i: number) => {
    setPreset(i);
    setL(PRESETS[i].l); setW(PRESETS[i].w); setH(PRESETS[i].h);
  };

  const send = () => {
    if (total <= 0) return;
    pickQty(total.toFixed(1));
    scrollToForm();
  };

  return (
    <div className="overflow-hidden rounded-3xl bg-white ring-1 ring-beton-200 shadow-[0_24px_60px_-30px_rgba(27,42,76,0.35)]">
      <div className="flex items-center gap-3 border-b border-beton-200 px-6 py-4">
        <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl icon-tile-soft text-insof-700">
          <Calculator size={18} strokeWidth={1.5} />
        </span>
        <div>
          <div className="font-display text-[15px] font-semibold text-beton-900">Hajm kalkulyatori</div>
          <div className="text-xs text-beton-500">Metrda kiriting — natija kub metrda</div>
        </div>
      </div>

      <div className="p-6">
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p, i) => (
            <button
              key={p.label}
              type="button"
              onClick={() => apply(i)}
              aria-pressed={preset === i}
              className={`rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-colors ${
                preset === i ? "bg-insof-900 text-white" : "bg-beton-100 text-beton-700 hover:bg-beton-200"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        <div className="mt-5 grid grid-cols-3 gap-3">
          <Field label="Uzunlik" value={l} onChange={(v) => { setL(v); setPreset(-1); }} />
          <Field label="Kenglik" value={w} onChange={(v) => { setW(v); setPreset(-1); }} />
          <Field label="Qalinlik" value={h} onChange={(v) => { setH(v); setPreset(-1); }} />
        </div>

        <div className="mt-6 flex flex-wrap items-end justify-between gap-4 rounded-2xl bg-beton-50 px-5 py-4 ring-1 ring-beton-200">
          <div>
            <div className="font-mono text-[10px] tracking-[0.16em] text-beton-500 uppercase">Kerakli hajm · +5 % zaxira</div>
            <div className="mt-1 font-display text-3xl font-bold text-beton-900 tabular-nums">
              {fmt(total)} <span className="text-lg font-semibold text-beton-500">m³</span>
            </div>
            <div className="mt-1 text-xs text-beton-500">Sof hajm: {fmt(volume)} m³</div>
          </div>
          <button
            type="button"
            onClick={send}
            disabled={total <= 0}
            className="group inline-flex h-11 items-center gap-2 rounded-full bg-signal pr-2 pl-5 text-sm font-semibold text-white transition-colors hover:bg-signal-600 disabled:opacity-50"
          >
            Shu hajm bilan ariza
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-white/20 transition-transform group-hover:translate-x-0.5">
              <ArrowRight size={14} />
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="mb-1.5 block font-mono text-[10px] tracking-[0.16em] text-beton-500 uppercase">{label}</span>
      <span className="flex items-center rounded-xl bg-beton-50 ring-1 ring-beton-200 transition-shadow focus-within:ring-2 focus-within:ring-insof-500">
        <input
          inputMode="decimal"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-11 w-full min-w-0 bg-transparent px-3 font-mono text-[15px] text-beton-900 tabular-nums outline-none"
        />
        <span className="pr-3 text-xs text-beton-400">m</span>
      </span>
    </label>
  );
}
