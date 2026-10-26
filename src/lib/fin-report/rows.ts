/**
 * Moliyaviy hisobot qatori — PNL, DDS va Balans bir xil ko'rinishda chiziladi (oylar ustunda, oxirida jami).
 *   head  — bo'lim sarlavhasi (qiymatsiz)
 *   total — qalin jami qator
 *   line  — oddiy qator; sub — ichki (chekinib) qator
 *   pct   — foiz qatori (qiymat %, jami ustunida ham foiz)
 *   check — tekshiruv qatori: 0 bo'lishi kerak (0 bo'lmasa qizil)
 */
export type RowKind = "head" | "total" | "line" | "sub" | "pct" | "check";

export type FinRow = { key: string; label: string; kind: RowKind; values: (number | null)[]; total: number | null; hint?: string };

export const r2 = (n: number) => Math.round(n * 100) / 100;
export const zeros = (n: number) => Array.from({ length: n }, () => 0);
export const sumArr = (a: (number | null)[]) => r2(a.reduce<number>((s, v) => s + (v ?? 0), 0));
export const addInto = (acc: number[], i: number, v: number) => { acc[i] = (acc[i] ?? 0) + v; };
export const neg = (a: number[]) => a.map((v) => (v === 0 ? 0 : -v));
export const plus = (...arrs: number[][]) => arrs[0]!.map((_, i) => r2(arrs.reduce((s, a) => s + (a[i] ?? 0), 0)));

export function row(key: string, label: string, kind: RowKind, values: (number | null)[], opts: { total?: number | null; hint?: string } = {}): FinRow {
  return { key, label, kind, values: values.map((v) => (v === null ? null : r2(v))), total: opts.total !== undefined ? opts.total : sumArr(values), ...(opts.hint ? { hint: opts.hint } : {}) };
}

export const head = (key: string, label: string, n: number): FinRow => ({ key, label, kind: "head", values: Array.from({ length: n }, () => null), total: null });

/** Ulush qatori: a / b × 100 (b = 0 bo'lsa bo'sh). */
export function pctRow(key: string, label: string, a: number[], b: number[]): FinRow {
  const p = (x: number, y: number) => (y === 0 ? null : Math.round((x / y) * 1000) / 10);
  return { key, label, kind: "pct", values: a.map((v, i) => p(v, b[i] ?? 0)), total: p(a.reduce((s, v) => s + v, 0), b.reduce((s, v) => s + v, 0)) };
}
