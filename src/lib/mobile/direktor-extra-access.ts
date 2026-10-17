import type { Role } from "@/generated/prisma";

/**
 * Direktor kabinetining qo'shimcha bo'limlari (`./direktor-extra.ts`) — ruxsat jadvallari. Alohida fayl:
 * `list.ts` / `detail.ts` ularni modul yuklanishida o'qiydi — `direktor-extra.ts` ga to'g'ridan bog'lansa
 * aylanma import bo'lardi (`hr-access.ts` bilan bir xil yechim). Rollar veb bilan bir xil:
 *   · BI tahlil — `bi-tahlil/shell.tsx` BI_ROLES (DIRECTOR, FINANCE, ACCOUNTING), modul `bi-tahlil`;
 *   · Ilova foydalanuvchilari, Xarajat byudjeti, hisobni o'chirish so'rovlari — faqat direktor;
 *   · Kirish arizalari — `employees` → `login` (Otdel kadr va direktor).
 */
const BI: Role[] = ["FINANCE", "ACCOUNTING"];

/** Ro'yxatlar (`list.ts` ACCESS). `roles: []` — faqat direktor. */
export const DIREKTOR_ACCESS: Record<string, { title: string; roles: Role[] }> = {
  bi: { title: "BI tahlil", roles: BI },
  "ilova-users": { title: "Ilova foydalanuvchilari", roles: [] },
  byudjet: { title: "Xarajat byudjeti", roles: [] },
};
/** Ro'yxat/kartochka → veb modul: direktor `bi-tahlil` ni xodimga "yo'q" qilsa ilovada ham yopiq. */
export const DIREKTOR_KEY_MODULE: Record<string, string> = { bi: "bi-tahlil" };
/** Kartochkalar (`detail.ts` DETAIL_ROLES). `owner` — Egasi dashbordining qo'shimcha bloklari. */
export const DIREKTOR_DETAIL_ROLES: Record<string, Role[]> = {
  bi: BI, "ilova-users": [], byudjet: [], owner: [], deletion: [], access: ["HR"],
};
/** Shu kartochka kalitlari `direktorDetail` da quriladi. */
export const DIREKTOR_CARDS = Object.keys(DIREKTOR_DETAIL_ROLES);
/** Amallar (`detail.ts` ACTION_ROLES) — veb server action'idagi `requireSession` / `requireAction` bilan bir xil. */
export const DIREKTOR_ACTION_ROLES: Record<string, Role[]> = {
  "access.approve": ["HR", "DIRECTOR"],
  "access.reject": ["HR", "DIRECTOR"],
  "deletion.approve": ["DIRECTOR"],
  "deletion.reject": ["DIRECTOR"],
  "appuser.grant": ["DIRECTOR"],
  "appuser.revoke": ["DIRECTOR"],
  "tg.code": ["DIRECTOR", ...BI],
};
/** Amal → veb ruxsat katalogi (`lib/permissions.ts`), `detail.ts` PERM_EXACT ga qo'shiladi. */
export const DIREKTOR_PERM: Record<string, { module: string; action?: string }> = {
  "access.approve": { module: "employees", action: "login" },
  "access.reject": { module: "employees", action: "login" },
  "tg.code": { module: "bi-tahlil", action: "ai" },
};
