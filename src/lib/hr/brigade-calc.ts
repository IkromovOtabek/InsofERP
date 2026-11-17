import { roundHalfAway } from "@/lib/format";

/**
 * Brigada varag'i hisobi — Excel'dagi brigada varag'i formulalarining aynan o'zi (brauzer va server bir xil hisoblaydi):
 *
 *   kunlik fond (d)   = Σ qatorlar  soni(d) × narx                       (Excel: 45-qator SUMPRODUCT)
 *   xodim ulushi (d)  = fond(d) × xodim soati(d) ÷ brigada soati(d)       (Excel: yashirin AL:BP — IFERROR(E4/8*…/E$24))
 *   hisoblangan       = ROUND(Σ ulush, −4)  — 10 000 ga yaxlitlanadi      (Excel: BQ = ROUND(SUM(AL:BP),−4) − brak)
 *   brak ulushi       = brak × xodim oy soati ÷ brigada oy soati          (Excel: BR = soat × koeffitsient)
 *   qo'lga (сумма)    = hisoblangan − brak ulushi
 *
 * Soat yozilmagan kundagi fond hech kimga tushmaydi — `lost` da ko'rsatiladi (Excel'da ham shunday).
 */

export type SheetLine = { name: string; rate: number; productId?: string | null };
export type SheetCalcInput = {
  days: number;
  /** xodim id → kunlar (0-indeks) bo'yicha soat */
  hours: Record<string, (number | null | undefined)[]>;
  lines: (SheetLine & { qty: (number | null | undefined)[] })[];
  brak: number;
  /** false — 10 000 ga yaxlitlanmaydi (avans davri uchun) */
  round?: boolean;
};
export type SheetEmp = { hours: number; raw: number; amount: number; brak: number; net: number };
export type SheetCalc = {
  pool: number[]; dayHours: number[]; lost: number;
  emp: Record<string, SheetEmp>;
  total: { pool: number; hours: number; raw: number; amount: number; brak: number; net: number };
};

const n = (v: number | null | undefined) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

export function calcBrigadeSheet(x: SheetCalcInput): SheetCalc {
  const pool = Array.from({ length: x.days }, (_, d) => x.lines.reduce((s, l) => s + n(l.qty[d]) * l.rate, 0));
  const ids = Object.keys(x.hours);
  const dayHours = Array.from({ length: x.days }, (_, d) => ids.reduce((s, id) => s + n(x.hours[id]![d]), 0));
  const lost = pool.reduce((s, p, d) => s + (dayHours[d]! > 0 ? 0 : p), 0);
  const totalHours = dayHours.reduce((s, h) => s + h, 0);
  const emp: Record<string, SheetEmp> = {};
  for (const id of ids) {
    let raw = 0, hours = 0;
    for (let d = 0; d < x.days; d++) {
      const h = n(x.hours[id]![d]);
      hours += h;
      if (h > 0 && dayHours[d]! > 0) raw += (pool[d]! * h) / dayHours[d]!;
    }
    const amount = x.round === false ? Math.round(raw) : roundHalfAway(raw, -4);
    const brak = totalHours > 0 ? Math.round((x.brak * hours) / totalHours) : 0;
    emp[id] = { hours, raw, amount, brak, net: amount - brak };
  }
  const vals = Object.values(emp);
  return {
    pool, dayHours, lost,
    emp,
    total: {
      pool: pool.reduce((s, p) => s + p, 0), hours: totalHours,
      raw: vals.reduce((s, e) => s + e.raw, 0), amount: vals.reduce((s, e) => s + e.amount, 0),
      brak: vals.reduce((s, e) => s + e.brak, 0), net: vals.reduce((s, e) => s + e.net, 0),
    },
  };
}
