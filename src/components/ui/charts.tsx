import { cn } from "@/lib/utils";

const barTone = { brand: "bg-brand-500", success: "bg-emerald-500", info: "bg-blue-500", warning: "bg-amber-500", danger: "bg-red-500", slate: "bg-slate-700", violet: "bg-violet-500" };
const hexTone = { brand: "#ffa800", success: "#00cb80", info: "#0d78ff", warning: "#ffa800", danger: "#fa1636", slate: "var(--color-slate-700)", violet: "#8b2fff", muted: "var(--color-slate-300)" };
export type ChartTone = keyof typeof barTone;
export const PALETTE = ["#ffa800", "#0d78ff", "#00cb80", "#8b2fff", "#fa1636", "#009ef5", "#ff5c00", "#00d6c0", "#6b7f9e", "#b433ff"];

/** Vertikal ustunli grafik — kunlik/oylik dinamika. `compare` — oldingi davr (och rang). */
export function BarChart({ data, tone = "brand", height = 160, formatValue = String, labelEvery = 1, compare }: {
  data: { label: string; value: number; tone?: ChartTone }[];
  tone?: ChartTone;
  height?: number;
  formatValue?: (v: number) => string;
  labelEvery?: number;
  compare?: number[];
}) {
  const max = Math.max(1, ...data.map((d) => d.value), ...(compare ?? []));
  return (
    <div>
      <div className="flex items-end gap-1" style={{ height }}>
        {data.map((d, i) => (
          <div key={i} title={`${d.label}: ${formatValue(d.value)}${compare ? ` (oldingi: ${formatValue(compare[i] ?? 0)})` : ""}`} className="group relative flex h-full flex-1 items-end justify-center gap-px">
            {compare && <div className="w-1/2 rounded-t bg-slate-200" style={{ height: `${((compare[i] ?? 0) / max) * 100}%` }} />}
            <div className={cn(compare ? "w-1/2" : "w-full", "rounded-t transition-all group-hover:opacity-80", barTone[d.tone ?? tone])} style={{ height: `${Math.max(d.value > 0 ? 2 : 0, (d.value / max) * 100)}%` }} />
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex gap-1 text-[10px] text-slate-400">
        {data.map((d, i) => <div key={i} className="flex-1 truncate text-center">{i % labelEvery === 0 ? d.label : ""}</div>)}
      </div>
    </div>
  );
}

/** Gorizontal bar ro'yxat — reyting / taqsimot. */
export function HBarList({ data, tone = "brand", formatValue = String, max: maxIn }: {
  data: { label: string; value: number; hint?: string; tone?: ChartTone; sub?: string }[];
  tone?: ChartTone;
  formatValue?: (v: number) => string;
  max?: number;
}) {
  const max = maxIn ?? Math.max(1, ...data.map((d) => Math.abs(d.value)));
  return (
    <div className="space-y-3">
      {data.map((d, i) => (
        <div key={i}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-[13px]">
            <span className="truncate font-medium text-slate-800">{d.label}{d.sub && <span className="ml-1.5 text-xs font-normal text-slate-400">{d.sub}</span>}</span>
            <span className="shrink-0 tabular text-slate-600">{formatValue(d.value)}{d.hint && <span className="ml-1.5 text-xs text-slate-400">{d.hint}</span>}</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
            <div className={cn("h-full rounded-full", barTone[d.tone ?? tone])} style={{ width: `${Math.max(1, (Math.abs(d.value) / max) * 100)}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Chiziqli grafik (SVG). Bir nechta seriya, `dashed` — bashorat uchun. */
export function LineChart({ series, labels, height = 180, formatValue = String, labelEvery = 1, area = true }: {
  series: { name: string; values: (number | null)[]; color?: string; dashed?: boolean }[];
  labels: string[];
  height?: number;
  formatValue?: (v: number) => string;
  labelEvery?: number;
  area?: boolean;
}) {
  const W = 600, H = 200, padL = 8, padR = 8, padT = 10, padB = 6;
  const n = labels.length;
  const all = series.flatMap((s) => s.values.filter((v): v is number => v !== null));
  const max = Math.max(1, ...all), min = Math.min(0, ...all);
  const x = (i: number) => padL + (n <= 1 ? 0 : (i / (n - 1)) * (W - padL - padR));
  const y = (v: number) => padT + (1 - (v - min) / (max - min)) * (H - padT - padB);
  const path = (vals: (number | null)[]) => {
    let d = "", started = false;
    vals.forEach((v, i) => { if (v === null) { started = false; return; } d += `${started ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)} `; started = true; });
    return d;
  };
  const gridY = [0, 0.25, 0.5, 0.75, 1].map((t) => min + t * (max - min));
  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-3 text-xs text-slate-500">
        {series.map((s, i) => (
          <span key={i} className="inline-flex items-center gap-1.5"><span className="inline-block h-0.5 w-4 rounded" style={{ background: s.color ?? PALETTE[i], borderTop: s.dashed ? `2px dashed ${s.color ?? PALETTE[i]}` : undefined, height: s.dashed ? 0 : undefined }} />{s.name}</span>
        ))}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height }} preserveAspectRatio="none">
        {gridY.map((g, i) => <line key={i} x1={padL} x2={W - padR} y1={y(g)} y2={y(g)} className="stroke-slate-200" strokeWidth={1} vectorEffect="non-scaling-stroke" />)}
        {series.map((s, i) => {
          const color = s.color ?? PALETTE[i];
          const first = s.values.findIndex((v) => v !== null), last = s.values.length - 1 - [...s.values].reverse().findIndex((v) => v !== null);
          return (
            <g key={i}>
              {area && !s.dashed && first >= 0 && <path d={`${path(s.values)} L${x(last).toFixed(1)},${y(min).toFixed(1)} L${x(first).toFixed(1)},${y(min).toFixed(1)} Z`} fill={color} fillOpacity={0.08} />}
              <path d={path(s.values)} fill="none" stroke={color} strokeWidth={2} strokeDasharray={s.dashed ? "6 4" : undefined} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
            </g>
          );
        })}
        {labels.map((l, i) => {
          const pts = series.map((s) => s.values[i]).filter((v): v is number => v !== null);
          if (!pts.length) return null;
          return <rect key={i} x={x(i) - (W / n) / 2} y={0} width={W / n} height={H} fill="transparent"><title>{`${l}: ${series.map((s) => s.values[i] === null ? "" : `${s.name} ${formatValue(s.values[i] as number)}`).filter(Boolean).join(" · ")}`}</title></rect>;
        })}
      </svg>
      <div className="mt-1 flex text-[10px] text-slate-400">
        {labels.map((l, i) => <div key={i} className="flex-1 truncate text-center">{i % labelEvery === 0 ? l : ""}</div>)}
      </div>
      <div className="mt-0.5 flex justify-between text-[10px] text-slate-400"><span>min {formatValue(min)}</span><span>max {formatValue(max)}</span></div>
    </div>
  );
}

/** Donut — ulushlar. */
export function DonutChart({ data, formatValue = String, size = 150, center }: {
  data: { label: string; value: number; color?: string }[];
  formatValue?: (v: number) => string;
  size?: number;
  center?: { value: string; label?: string };
}) {
  const total = data.reduce((s, d) => s + d.value, 0) || 1;
  const R = 50, r = 34, C = 60;
  let acc = 0;
  const arcs = data.map((d, i) => {
    const a0 = (acc / total) * 2 * Math.PI - Math.PI / 2; acc += d.value;
    const a1 = (acc / total) * 2 * Math.PI - Math.PI / 2;
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const p = (a: number, rr: number) => `${(C + rr * Math.cos(a)).toFixed(2)},${(C + rr * Math.sin(a)).toFixed(2)}`;
    const dPath = d.value <= 0 ? "" : `M${p(a0, R)} A${R},${R} 0 ${large} 1 ${p(a1, R)} L${p(a1, r)} A${r},${r} 0 ${large} 0 ${p(a0, r)} Z`;
    return { ...d, color: d.color ?? PALETTE[i % PALETTE.length], dPath, share: (d.value / total) * 100 };
  });
  return (
    <div className="flex flex-wrap items-center gap-5">
      <svg viewBox="0 0 120 120" style={{ width: size, height: size }} className="shrink-0">
        {arcs.map((a, i) => a.dPath && <path key={i} d={a.dPath} fill={a.color}><title>{`${a.label}: ${formatValue(a.value)} (${a.share.toFixed(1)}%)`}</title></path>)}
        {center && <>
          <text x={60} y={58} textAnchor="middle" className="fill-slate-900" style={{ fontSize: 13, fontWeight: 600 }}>{center.value}</text>
          {center.label && <text x={60} y={72} textAnchor="middle" className="fill-slate-500" style={{ fontSize: 8 }}>{center.label}</text>}
        </>}
      </svg>
      <ul className="min-w-0 flex-1 space-y-1.5 text-[13px]">
        {arcs.map((a, i) => (
          <li key={i} className="flex items-center justify-between gap-3">
            <span className="flex min-w-0 items-center gap-2"><span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: a.color }} /><span className="truncate text-slate-700">{a.label}</span></span>
            <span className="shrink-0 tabular text-slate-600">{formatValue(a.value)} <span className="text-xs text-slate-400">{a.share.toFixed(0)}%</span></span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Issiqlik xaritasi — matritsa (RFM, kun × soat, agent × hafta kuni). */
export function Heatmap({ rows, cols, cells, formatValue = String, tone = "brand", rowLabel, colLabel }: {
  rows: string[]; cols: string[]; cells: number[][];
  formatValue?: (v: number) => string; tone?: "brand" | "info" | "danger" | "success"; rowLabel?: string; colLabel?: string;
}) {
  const max = Math.max(1, ...cells.flat());
  const base = { brand: "255,168,0", info: "13,120,255", danger: "250,22,54", success: "0,203,128" }[tone];
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-separate border-spacing-1 text-xs">
        <thead><tr><th className="text-left font-medium text-slate-400">{rowLabel ?? ""}{colLabel && <span className="ml-1 text-slate-300">→ {colLabel}</span>}</th>{cols.map((c) => <th key={c} className="px-1 py-1 text-center font-medium text-slate-500">{c}</th>)}</tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r}>
              <td className="whitespace-nowrap pr-2 font-medium text-slate-600">{r}</td>
              {cols.map((c, j) => {
                const v = cells[i]?.[j] ?? 0, a = v / max;
                return <td key={c} title={`${r} × ${c}: ${formatValue(v)}`} className="h-9 min-w-10 rounded-md text-center tabular" style={{ background: `rgba(${base},${0.08 + a * 0.85})`, color: a > 0.55 ? "#fff" : "var(--color-slate-700)" }}>{v ? formatValue(v) : ""}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Kichik sparkline (KPI kartalar uchun). */
export function Sparkline({ values, color = "#ffa800", height = 28 }: { values: number[]; color?: string; height?: number }) {
  const W = 100, H = 30, n = values.length;
  const max = Math.max(1, ...values), min = Math.min(0, ...values);
  const pts = values.map((v, i) => `${(n <= 1 ? 0 : (i / (n - 1)) * W).toFixed(1)},${(2 + (1 - (v - min) / (max - min)) * (H - 4)).toFixed(1)}`).join(" ");
  return <svg viewBox={`0 0 ${W} ${H}`} style={{ height }} className="w-full" preserveAspectRatio="none"><polyline points={pts} fill="none" stroke={color} strokeWidth={1.5} vectorEffect="non-scaling-stroke" /></svg>;
}

/** Waterfall — tushumdan foydagacha. */
export function Waterfall({ steps, formatValue }: { steps: { label: string; value: number; total?: boolean }[]; formatValue: (v: number) => string }) {
  let running = 0;
  const bars = steps.map((s) => {
    if (s.total) { const b = { ...s, start: 0, end: s.value }; running = s.value; return b; }
    const start = running, end = running + s.value; running = end;
    return { ...s, start: Math.min(start, end), end: Math.max(start, end) };
  });
  const max = Math.max(1, ...bars.map((b) => Math.max(b.end, b.start)));
  const min = Math.min(0, ...bars.map((b) => Math.min(b.end, b.start)));
  const span = max - min || 1;
  return (
    <div>
      <div className="flex items-end gap-2" style={{ height: 180 }}>
        {bars.map((b, i) => {
          const top = (1 - (b.end - min) / span) * 100, h = ((b.end - b.start) / span) * 100;
          const color = b.total ? "bg-slate-800" : b.value >= 0 ? "bg-emerald-500" : "bg-red-500";
          return (
            <div key={i} className="relative h-full flex-1" title={`${b.label}: ${formatValue(b.value)}`}>
              <div className={cn("absolute w-full rounded", color)} style={{ top: `${top}%`, height: `${Math.max(1, h)}%` }} />
            </div>
          );
        })}
      </div>
      <div className="mt-1.5 flex gap-2 text-[10px] text-slate-500">
        {bars.map((b, i) => <div key={i} className="flex-1 text-center"><div className="truncate">{b.label}</div><div className={cn("tabular font-medium", b.total ? "text-slate-900" : b.value >= 0 ? "text-emerald-600" : "text-red-600")}>{formatValue(b.value)}</div></div>)}
      </div>
    </div>
  );
}

/** Scatter (2 o'lchov) — foydalilik, klaster. */
export function Scatter({ points, xLabel, yLabel, formatX = String, formatY = String, height = 240, xMedian, yMedian, quadrants }: {
  points: { x: number; y: number; r?: number; label: string; color?: string }[];
  xLabel: string; yLabel: string; formatX?: (v: number) => string; formatY?: (v: number) => string; height?: number;
  xMedian?: number; yMedian?: number; quadrants?: [string, string, string, string];
}) {
  const W = 600, H = 300, pad = 24;
  const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
  const xMin = Math.min(0, ...xs), xMax = Math.max(1, ...xs), yMin = Math.min(0, ...ys), yMax = Math.max(1, ...ys);
  const rMax = Math.max(1, ...points.map((p) => p.r ?? 1));
  const X = (v: number) => pad + ((v - xMin) / (xMax - xMin || 1)) * (W - 2 * pad);
  const Y = (v: number) => H - pad - ((v - yMin) / (yMax - yMin || 1)) * (H - 2 * pad);
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height }}>
        <rect x={pad} y={pad} width={W - 2 * pad} height={H - 2 * pad} className="fill-slate-50 stroke-slate-200" />
        {xMedian !== undefined && <line x1={X(xMedian)} x2={X(xMedian)} y1={pad} y2={H - pad} className="stroke-slate-400" strokeDasharray="4 4" />}
        {yMedian !== undefined && <line x1={pad} x2={W - pad} y1={Y(yMedian)} y2={Y(yMedian)} className="stroke-slate-400" strokeDasharray="4 4" />}
        {quadrants && <>
          <text x={W - pad - 4} y={pad + 12} textAnchor="end" fontSize={10} className="fill-slate-500">{quadrants[0]}</text>
          <text x={pad + 4} y={pad + 12} fontSize={10} className="fill-slate-500">{quadrants[1]}</text>
          <text x={pad + 4} y={H - pad - 4} fontSize={10} className="fill-slate-500">{quadrants[2]}</text>
          <text x={W - pad - 4} y={H - pad - 4} textAnchor="end" fontSize={10} className="fill-slate-500">{quadrants[3]}</text>
        </>}
        {points.map((p, i) => <circle key={i} cx={X(p.x)} cy={Y(p.y)} r={4 + Math.sqrt((p.r ?? 1) / rMax) * 12} fill={p.color ?? PALETTE[i % PALETTE.length]} fillOpacity={0.55} stroke={p.color ?? PALETTE[i % PALETTE.length]}><title>{`${p.label}\n${xLabel}: ${formatX(p.x)}\n${yLabel}: ${formatY(p.y)}`}</title></circle>)}
        <text x={W / 2} y={H - 6} textAnchor="middle" fontSize={10} className="fill-slate-500">{xLabel} →</text>
        <text x={8} y={H / 2} fontSize={10} className="fill-slate-500" transform={`rotate(-90 8 ${H / 2})`} textAnchor="middle">{yLabel} →</text>
      </svg>
    </div>
  );
}

export const toneHex = (t: keyof typeof hexTone) => hexTone[t];
