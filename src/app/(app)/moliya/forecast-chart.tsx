import type { CalDay } from "@/lib/fin-report/calendar";
import { fmtNum, moneyShort } from "@/lib/format";

/**
 * 30 kunlik kassa prognozi grafigi: qoldiq chizig'i (maydon bilan), pastda katta to'lovlar kuni (ta'minotchi + majburiy)
 * ustunlari, eng past qoldiq nuqtasi; qoldiq manfiyga tushsa nol chizig'i va qizil zona. Server komponenti (SVG, JS'siz).
 */
export function ForecastChart({ days, height = 220 }: { days: CalDay[]; height?: number }) {
  const W = 640, H = 220, L = 56, R = 12, T = 14, B = 26;
  const vals = days.map((d) => d.balance);
  const pays = days.map((d) => d.outSupplier + d.outMandatory);
  const hi = Math.max(1, ...vals, ...pays), lo = Math.min(0, ...vals);
  const span = hi - lo || 1;
  const x = (i: number) => L + ((W - L - R) * i) / Math.max(1, days.length - 1);
  const y = (v: number) => T + ((H - T - B) * (hi - v)) / span;
  const ticks = [lo, lo + span / 2, hi].map((v) => Math.round(v));
  const minI = vals.indexOf(Math.min(...vals));
  const line = vals.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const bw = Math.max(3, (W - L - R) / days.length - 6);
  const label = (d: Date) => `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={height} role="img" aria-label="30 kunlik kassa qoldig'i prognozi" className="overflow-visible">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} className="stroke-slate-200" strokeWidth={1} />
          <text x={L - 8} y={y(t) + 4} textAnchor="end" className="fill-slate-400 text-[11px]">{moneyShort(t)}</text>
        </g>
      ))}
      {lo < 0 && <rect x={L} y={y(0)} width={W - L - R} height={y(lo) - y(0)} className="fill-red-500/8" />}
      {lo < 0 && <line x1={L} x2={W - R} y1={y(0)} y2={y(0)} className="stroke-red-400" strokeDasharray="4 3" />}
      {pays.map((p, i) => p > 0 && (
        <rect key={i} x={x(i) - bw / 2} y={y(lo + p)} width={bw} height={Math.max(1, y(lo) - y(lo + p))} rx={2} className="fill-red-500/30">
          <title>{`${label(days[i]!.date)}: to'lovlar ${fmtNum(p)} so'm`}</title>
        </rect>
      ))}
      <path d={`${line} L${x(vals.length - 1)},${y(lo)} L${x(0)},${y(lo)} Z`} className="fill-amber-400/15" />
      <path d={line} fill="none" className="stroke-amber-500" strokeWidth={2.5} strokeLinejoin="round" />
      {vals.map((v, i) => (
        <circle key={i} cx={x(i)} cy={y(v)} r={7} fill="transparent"><title>{`${label(days[i]!.date)}: qoldiq ${fmtNum(v)} so'm`}</title></circle>
      ))}
      <circle cx={x(minI)} cy={y(vals[minI]!)} r={5} className="fill-red-600 stroke-white" strokeWidth={2} />
      <text x={Math.min(Math.max(x(minI), L + 60), W - R - 60)} y={y(vals[minI]!) + (y(vals[minI]!) > H - 50 ? -10 : 18)} textAnchor="middle" className="fill-red-700 text-[11px] font-semibold">eng past: {moneyShort(vals[minI]!)}</text>
      {[0, 7, 14, 21, days.length - 1].filter((i) => i < days.length).map((i) => (
        <text key={i} x={x(i)} y={H - 6} textAnchor={i === 0 ? "start" : i === days.length - 1 ? "end" : "middle"} className="fill-slate-400 text-[11px]">{label(days[i]!.date)}</text>
      ))}
    </svg>
  );
}
