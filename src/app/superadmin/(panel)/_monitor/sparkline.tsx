"use client";

import { useId, useState } from "react";

/**
 * Kichik chiziqli grafik (inline SVG, kutubxonasiz). Bitta qator — legenda shart emas, sarlavha kartada.
 * Sichqoncha/barmoq bilan ustidan yurilsa nuqta va qiymat ko'rinadi; ekran o'quvchiga aria-label (oxirgi/min/max).
 */
export function Sparkline({ values, times, format, max, tone = "default", label }: {
  values: number[]; times?: number[]; format: (v: number) => string; max?: number;
  tone?: "default" | "warning" | "danger"; label: string;
}) {
  const id = useId();
  const [hover, setHover] = useState<number | null>(null);
  const W = 120, H = 32;
  if (values.length < 2) return <div className="h-8 text-xs text-slate-400" aria-label={`${label}: ma'lumot yetarli emas`}>—</div>;
  const hi = Math.max(max ?? 0, ...values) || 1;
  const lo = max != null ? 0 : Math.min(0, ...values);
  const x = (i: number) => (i / (values.length - 1)) * W;
  const y = (v: number) => H - 2 - ((v - lo) / (hi - lo || 1)) * (H - 4);
  const line = values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const stroke = { default: "stroke-blue-600", warning: "stroke-amber-600", danger: "stroke-red-600" }[tone];
  const fill = { default: "fill-blue-600/10", warning: "fill-amber-600/10", danger: "fill-red-600/10" }[tone];
  const last = values[values.length - 1];
  const i = hover ?? values.length - 1;
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-8 w-full touch-none overflow-visible" role="img"
        aria-label={`${label}: hozir ${format(last)}, eng kami ${format(Math.min(...values))}, eng ko'pi ${format(Math.max(...values))}`}
        onPointerMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setHover(Math.max(0, Math.min(values.length - 1, Math.round(((e.clientX - r.left) / r.width) * (values.length - 1)))));
        }}
        onPointerLeave={() => setHover(null)}>
        <title id={id}>{label}</title>
        <path d={`${line}L${W},${H}L0,${H}Z`} className={fill} />
        <path d={line} className={`fill-none ${stroke}`} strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
        {hover != null && <line x1={x(i)} x2={x(i)} y1={0} y2={H} className="stroke-slate-300" strokeWidth={1} vectorEffect="non-scaling-stroke" />}
      </svg>
      {hover != null && (
        <div className="pointer-events-none absolute -top-7 z-10 -translate-x-1/2 whitespace-nowrap rounded-md bg-slate-900 px-1.5 py-0.5 text-[11px] text-white shadow tabular"
          style={{ left: `${(i / (values.length - 1)) * 100}%` }} data-no-translit>
          {format(values[i])}{times?.[i] ? ` · ${new Date(times[i]).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : ""}
        </div>
      )}
    </div>
  );
}
