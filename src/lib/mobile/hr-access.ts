import type { Role } from "@/generated/prisma";

/**
 * Mobil kadr modullari ruxsat jadvallari (`./hr.ts`). Alohida fayl: `list.ts` / `detail.ts` / `actions.ts` ularni modul
 * yuklanishida o'qiydi — `hr.ts` ga to'g'ridan bog'lansa aylanma import bo'lardi. Rollar `lib/hr/*` bilan bir xil.
 */
const PAYROLL_ROLES: Role[] = ["HR", "ACCOUNTING", "FINANCE", "CASHIER"];
const DECIDERS: Role[] = ["HR", "DIRECTOR"];

/** Har bir xodim (login egasi) — o'z arizasi, grafigi va oyligi uchun. */
export const ALL_STAFF: Role[] = ["DIRECTOR", "SALES", "PRODUCTION", "SUPERVISOR", "LOGISTICS", "WAREHOUSE", "PROCUREMENT", "ACCOUNTING", "FINANCE", "HR", "CASHIER", "MECHANIC", "DRIVER", "BRIGADIER", "SECRETARY", "AGENT"];
/** O'z ishi kartochkalari — haydovchi, brigadir, agent ham ochadi (ularning ilovasi boshqa bo'limlarni yopadi). */
export const SELF_CARDS = ["arizalarim", "oyligim", "grafigim", "vazifalarim", "cheklistim", "kpim", "kurslarim", "moslashuvim", "suhbatlarim"];
export const HR_ACCESS: Record<string, { title: string; roles: Role[] }> = {
  arizalarim: { title: "Arizalarim", roles: ALL_STAFF },
  grafigim: { title: "Smena grafigim", roles: ALL_STAFF },
  oyligim: { title: "Ish haqim", roles: ALL_STAFF },
  vazifalarim: { title: "Vazifalarim", roles: ALL_STAFF },
  cheklistim: { title: "Bugungi cheklist", roles: ALL_STAFF },
  kpim: { title: "KPI'm", roles: ALL_STAFF },
  kurslarim: { title: "Kurslarim", roles: ALL_STAFF },
  moslashuvim: { title: "Moslashuv", roles: ALL_STAFF },
  suhbatlarim: { title: "Suhbatlarim", roles: ALL_STAFF },
  nomzodlar: { title: "Nomzodlar", roles: ["HR"] },
  arizalar: { title: "Xodim arizalari", roles: ["HR"] },
  "ish-haqi": { title: "Ish haqi vedomostlari", roles: PAYROLL_ROLES },
};
export const HR_KEY_MODULE: Record<string, string> = { arizalar: "employees", "ish-haqi": "payroll", vazifalarim: "vazifalar", nomzodlar: "employees" };
export const HR_ACTION_ROLES: Record<string, Role[]> = {
  "hrreq.approve": DECIDERS, "hrreq.reject": DECIDERS, "hrreq.cancel": ALL_STAFF,
  "wtask.start": ALL_STAFF, "wtask.done": ALL_STAFF, "wtask.accept": ALL_STAFF, "wtask.return": ALL_STAFF, "wtask.cancel": ALL_STAFF, "wtask.comment": ALL_STAFF,
  "checklist.save": ALL_STAFF,
  "course.take": ALL_STAFF, "onb.steps": ALL_STAFF, "interview.result": ALL_STAFF, "cand.move": ["HR", "DIRECTOR"],
  "payroll.submit": ["HR", "ACCOUNTING", "DIRECTOR"], "payroll.approve": ["DIRECTOR"], "payroll.return": ["DIRECTOR"], "payroll.pay": ["CASHIER", "DIRECTOR"],
};

