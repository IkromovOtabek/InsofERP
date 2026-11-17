/* Ushlanma turlari (Excel C2026 ustunlari) — server va brauzer uchun umumiy. `PayAdjustment.category`. */

export const DEDUCTION_CATS = [
  { key: "ALIMENT", label: "Aliment / ijro", excel: "Алимент/удержание" },
  { key: "LOAN", label: "Qarz to'lovi", excel: "Ойма-ой олинадиган карз" },
  { key: "SALARY_DEBT", label: "Oylikdan qarz", excel: "Ойлик хисобидан карз" },
  { key: "FUND", label: "To'y puli", excel: "Тугилган кун / туй пули" },
  { key: "FINE", label: "Jarima", excel: "Штраф" },
] as const;

export type DeductionCat = (typeof DEDUCTION_CATS)[number]["key"];
export const isDeductionCat = (v: unknown): v is DeductionCat => DEDUCTION_CATS.some((c) => c.key === v);
export const deductionLabel = (k: string | null | undefined) => DEDUCTION_CATS.find((c) => c.key === k)?.label ?? null;
