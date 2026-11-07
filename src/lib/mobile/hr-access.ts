import type { Role } from "@/generated/prisma";

/**
 * Mobil kadr modullari ruxsat jadvallari (`./hr.ts`). Alohida fayl: `list.ts` / `detail.ts` / `actions.ts` ularni modul
 * yuklanishida o'qiydi — `hr.ts` ga to'g'ridan bog'lansa aylanma import bo'lardi. Rollar `lib/hr/*` bilan bir xil.
 */
const PAYROLL_ROLES: Role[] = ["HR", "ACCOUNTING", "FINANCE", "CASHIER"];

/** Har bir xodim (login egasi) — o'z vazifalari va oyligi uchun. */
export const ALL_STAFF: Role[] = ["DIRECTOR", "SALES", "PRODUCTION", "SUPERVISOR", "LOGISTICS", "WAREHOUSE", "PROCUREMENT", "ACCOUNTING", "FINANCE", "HR", "CASHIER", "MECHANIC", "DISPATCHER", "DRIVER", "BRIGADIER", "SECRETARY", "AGENT"];
/**
 * O'z ishi kartochkalari — haydovchi, brigadir, agent ham ochadi (ularning ilovasi boshqa bo'limlarni yopadi).
 * Arizalar, smena grafigi, cheklist, KPI, kurslar, moslashuv, suhbat/nomzod, so'rovnoma, murojaat va xabarlar olib
 * tashlangan — ilova kalitni ro'yxatda ko'rmasa, tugmasini ham chizmaydi.
 */
export const SELF_CARDS = ["oyligim", "vazifalarim"];
export const HR_ACCESS: Record<string, { title: string; roles: Role[] }> = {
  oyligim: { title: "Ish haqim", roles: ALL_STAFF },
  vazifalarim: { title: "Vazifalarim", roles: ALL_STAFF },
  "ish-haqi": { title: "Ish haqi vedomostlari", roles: PAYROLL_ROLES },
};
export const HR_KEY_MODULE: Record<string, string> = { "ish-haqi": "payroll", vazifalarim: "vazifalar" };
export const HR_ACTION_ROLES: Record<string, Role[]> = {
  "wtask.start": ALL_STAFF, "wtask.done": ALL_STAFF, "wtask.accept": ALL_STAFF, "wtask.return": ALL_STAFF, "wtask.cancel": ALL_STAFF, "wtask.comment": ALL_STAFF,
  "payroll.submit": ["HR", "ACCOUNTING", "DIRECTOR"], "payroll.approve": ["DIRECTOR"], "payroll.return": ["DIRECTOR"], "payroll.pay": ["CASHIER", "DIRECTOR"],
};

