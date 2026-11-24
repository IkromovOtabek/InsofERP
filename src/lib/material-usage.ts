import { cache } from "react";
import type { MaterialCategory } from "@/generated/prisma";
import { db } from "@/lib/db";

/**
 * Xomashyo sarfi va «necha kunga yetadi» — BITTA ta'rif (Sarvar rejasi 1.2, 2026-11-24). Sklad holati, Tahlil → Ombor,
 * Bugun, Egasi paneli, mobil ilova va bashorat shu funksiyalardan oladi. Ilgari Sklad faqat zamesni (PRODUCTION_CONSUME)
 * sanardi: xomashyo asosan «Chiqim» (ISSUE) bilan chiqqani uchun sement «354 kunga yetadi» chiqardi, haqiqatda 1–2 kun.
 *
 * Kunlik sarf = so'nggi 30 kundagi haqiqiy chiqim (zames + brigadaga berilgan + «Chiqim»/Расход − brigadadan qaytgan) ÷ 30;
 * tizim 30 kundan yangi bo'lsa — ishlagan kunlar soniga bo'linadi. «Yetadi, kun» = qoldiq ÷ kunlik sarf.
 * Xavf darajasi — Sozlamalar → Limitlar (`stockCritDays`, `stockWarnDays`) chegarasi bilan, faqat XOMASHYO toifasi
 * (zapchast va ofis tovarlari «necha kunga yetadi» bilan baholanmaydi).
 */
export const CONSUME_TYPES = ["PRODUCTION_CONSUME", "BRIGADE_ISSUE", "ISSUE", "BRIGADE_RETURN"] as const;
const DAY = 86_400_000;
export const USAGE_WINDOW_DAYS = 30;

const startOfDay = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };

export type MaterialUsage = {
  /** material → kunlik o'rtacha sarf (musbat) */
  perDay: Map<string, number>;
  /** material → oynadagi jami sarf (musbat) */
  consumed: Map<string, number>;
  /** sarf necha kunga bo'lindi (≤ 30) */
  window: number;
  /** birinchi sklad harakatidan beri kunlar (90 kunlik «muzlagan» belgisi uchun) */
  historyDays: number;
};

/** So'nggi 30 kunlik haqiqiy sarf (sahifa chizilishida bir marta — `cache`). */
export const materialUsage = cache(async (): Promise<MaterialUsage> => {
  const today = startOfDay(new Date()), since = new Date(today.getTime() - USAGE_WINDOW_DAYS * DAY);
  const [consumed, firstMove] = await Promise.all([
    db.stockMove.groupBy({ by: ["materialId"], where: { materialId: { not: null }, type: { in: [...CONSUME_TYPES] }, date: { gte: since } }, _sum: { qty: true } }),
    db.stockMove.aggregate({ where: { materialId: { not: null } }, _min: { date: true } }),
  ]);
  const historyDays = firstMove._min.date ? Math.max(1, Math.ceil((today.getTime() + DAY - startOfDay(firstMove._min.date).getTime()) / DAY)) : 0;
  const window = Math.min(USAGE_WINDOW_DAYS, Math.max(1, historyDays));
  // Storno bekor qilingan sanada yoziladi — oynada sarf manfiy chiqishi mumkin: 0 dan past olinmaydi
  const used = new Map(consumed.map((x) => [x.materialId as string, Math.max(0, -Number(x._sum.qty ?? 0))]));
  return { perDay: new Map([...used].map(([id, q]) => [id, q / window])), consumed: used, window, historyDays };
});

/** «Yetadi, kun»: qoldiq ÷ kunlik sarf; sarf yo'q bo'lsa — null (baholab bo'lmaydi) */
export const daysLeft = (balance: number, perDay: number) => (perDay > 0 ? Math.max(0, balance) / perDay : null);

/** Xavf darajasi kuzatiladigan toifa — faqat xomashyo */
export const isRiskTracked = (category: MaterialCategory | string | null | undefined) => category === "XOMASHYO";

export type StockRisk = "short" | "low" | "ok";
/**
 * Xavf darajasi — bitta chegara (Sozlamalar → Limitlar): `short` — zayavkalarga yetmaydi yoki `critDays` kundan kam;
 * `low` — minimal qoldiqdan kam yoki `warnDays` kundan kam; qolgani `ok`. Kuzatilmaydigan toifa — doim `ok`.
 */
export function stockRisk(
  m: { days: number | null; balance: number; minStock: number; short: boolean; category?: MaterialCategory | string | null },
  t: { critDays: number; warnDays: number },
): StockRisk {
  if (m.category !== undefined && !isRiskTracked(m.category)) return "ok";
  if (m.short || (m.days !== null && m.days < t.critDays)) return "short";
  if (m.balance < m.minStock || (m.days !== null && m.days < t.warnDays)) return "low";
  return "ok";
}
