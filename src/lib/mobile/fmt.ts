import { unitLabel, unitTotals, soleUnit, type UnitRow } from "@/lib/unit";

/**
 * Mobil bosh ekran va dashboard uchun umumiy formatlash — `home.ts` va `dashboard.ts` bir xil
 * ko'rinishda yozsin (bir joyda "1,2 mln", boshqasida "1 200 000 so'm" bo'lib ketmasin).
 */
export const sum = (n: unknown) => Number(n ?? 0);
export const money = (n: number) => `${Math.round(n).toLocaleString("ru-RU")} so'm`;
const shortAbs = (n: number) =>
  n >= 1_000_000_000 ? `${(n / 1_000_000_000).toFixed(1)} mlrd` : n >= 1_000_000 ? `${(n / 1_000_000).toFixed(n >= 100_000_000 ? 0 : 1)} mln` : n >= 1_000 ? `${Math.round(n / 1_000)} ming` : String(Math.round(n));
/**
 * Qisqa summa: "1.2 mln". Manfiy ham qisqa: "−1.5 mlrd" — ilgari manfiy son shartlardan o'tmay xom chiqardi
 * ("-1523550019", direktor bosh sahifasidagi «Sof foyda»).
 */
export const short = (n: number) => {
  if (n >= 0) return shortAbs(n);
  const s = shortAbs(-n);
  return s === "0" ? s : `−${s}`;
};
/** Manfiy summa ham qisqa ko'rinishda: "−1,2 mln" (endi `short` bilan bir xil, eski chaqiruvlar uchun). */
export const shortSigned = short;
/**
 * To'liq summa, xonalab: "−1 523 550 019 so'm" — bosh sahifa hero'si (katta karta, joy yetadi).
 * "so'm" birligi shart: ilova `splitValue` raqamni birlikdan bo'sh joy bo'yicha ajratadi.
 */
export const sumFull = (n: number) => {
  const r = Math.round(n);
  return `${r < 0 ? "−" : ""}${String(Math.abs(r)).replace(/\B(?=(\d{3})+(?!\d))/g, " ")} so'm`;
};
/** Miqdor mahsulotning o'z birligida: beton m³, ustun/blok dona. */
export const num = (n: number) => n.toFixed(n % 1 ? 1 : 0);
export const inUnit = (n: number, unit: string | null) => (unit ? `${num(n)} ${unitLabel(unit)}` : num(n));
/** Aralash birlikli hajm: "12 m³ · 500 dona" — m³ bilan dona qo'shilmaydi. */
export const totalsText = (rows: UnitRow[]) => {
  const t = unitTotals(rows);
  return t.length ? t.map((x) => inUnit(x.qty, x.unit)).join(" · ") : "0";
};
/** Reys miqdori zayavkadagi mahsulot birligida (aralash bo'lsa — birliksiz son). */
export const tripQty = (t: { qtyM3: unknown; order: { items: { qtyM3: UnitRow["qty"]; product: { unit: string } }[] } }) =>
  inUnit(sum(t.qtyM3), soleUnit(t.order.items.map((i) => ({ unit: i.product.unit, qty: i.qtyM3 }))));
export const time = (d: Date) => d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
export const day = (d: Date) => d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" });
export const pctText = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? "—" : `${Math.round(v)}%`);
