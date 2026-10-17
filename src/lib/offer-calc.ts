import { NDS_RATE } from "./nds";

/**
 * Tijorat taklifi — sof hisob va lug'atlar (bazasiz). Klient forma ham, server ham shu fayldan oladi:
 * `lib/offers.ts` (baza, bildirishnoma) klient bundle'iga tushmasin.
 */

/** Qator birliklari — katalog mahsuloti o'z birligini olib keladi, xizmat uchun shu ro'yxatdan tanlanadi. */
export const OFFER_UNITS: [string, string][] = [
  ["dona", "dona"], ["m3", "m³"], ["reys", "reys"], ["soat", "soat"], ["mash_soat", "mash/soat"],
  ["kun", "kun"], ["t", "tonna"], ["m", "m"], ["m2", "m²"], ["xizmat", "xizmat"],
];
const UNIT_LABEL: Record<string, string> = Object.fromEntries(OFFER_UNITS);
export const offerUnitLabel = (u: string) => UNIT_LABEL[u] ?? u;

export type OfferLineInput = { productId?: string | null; name: string; unit: string; qty: number; price: number };
export type OfferLineCalc = OfferLineInput & { vatUnit: number; grossUnit: number; net: number; vat: number; gross: number };
export type OfferTotals = { lines: OfferLineCalc[]; qty: number; net: number; vat: number; gross: number; advance: number; rest: number };

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Qatorlar bo'yicha QQS'siz, QQS va QQS bilan summalar; `withVat` bo'lmasa QQS 0. */
export function offerTotals(lines: OfferLineInput[], withVat: boolean, advance = 0): OfferTotals {
  const calc = lines.map((l) => {
    const vatUnit = withVat ? r2(l.price * NDS_RATE) : 0;
    const grossUnit = r2(l.price + vatUnit);
    const net = r2(l.qty * l.price);
    const vat = r2(l.qty * vatUnit);
    return { ...l, vatUnit, grossUnit, net, vat, gross: r2(net + vat) };
  });
  const net = r2(calc.reduce((s, l) => s + l.net, 0));
  const vat = r2(calc.reduce((s, l) => s + l.vat, 0));
  const gross = r2(net + vat);
  return { lines: calc, qty: calc.reduce((s, l) => s + l.qty, 0), net, vat, gross, advance, rest: r2(gross - advance) };
}
