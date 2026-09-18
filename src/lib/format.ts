/**
 * Raqam formatlash — Intl ishlatilmaydi: Node va brauzer ICU'lari "uz-UZ" uchun
 * har xil ajratgich beradi va hydration xatosi chiqaradi. Bu yerda natija deterministik.
 */
export function fmtNum(v: number | string | { toString(): string }, maxFrac = 0): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  const neg = n < 0;
  const fixed = Math.abs(n).toFixed(maxFrac);
  const [int, frac] = fixed.split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  const fracTrim = frac ? frac.replace(/0+$/, "") : "";
  return (neg ? "-" : "") + grouped + (fracTrim ? "," + fracTrim : "");
}

export const money = (v: number | string | { toString(): string }) => fmtNum(v, 0) + " so'm";
export const qty = (v: number | string | { toString(): string }) => fmtNum(v, 3);

const pad = (n: number) => String(n).padStart(2, "0");
export const date = (d: Date) => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
export const dateTime = (d: Date) => `${date(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
export const isoDate = (d: Date = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
