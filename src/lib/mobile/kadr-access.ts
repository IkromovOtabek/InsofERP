import type { Role } from "@/generated/prisma";

/**
 * Otdel kadr kabineti (ERP → mobil paritet) — ruxsat jadvallari (`./kadr-extra.ts`). Alohida fayl: `list.ts` / `detail.ts` /
 * `create.ts` / `home.ts` ularni modul yuklanishida o'qiydi — `kadr-extra.ts` ga to'g'ridan bog'lansa aylanma import bo'lardi.
 * Rollar veb bilan bir xil: `lib/nav.ts` (Otdel kadr tablari — HR, direktor har doim), amallar — `lib/permissions.ts`
 * katalogidagi "employees" moduli amallari (`requireAction("employees", …)`).
 */
const HR: Role[] = ["HR"];
const HR_DIR: Role[] = ["HR", "DIRECTOR"];

/**
 * Ro'yxatlar — vebdagi `/otdel-kadr?tab=…` tablari. Kartochka kaliti ham shu (bitta istisno — `kadr-hujjat`).
 * Lavozimlar, smena grafigi, cheklist, KPI, vakansiya, moslashuv, kurslar, so'rovnoma va kadr hisobotlari olib tashlangan.
 */
export const KADR_ACCESS: Record<string, { title: string; roles: Role[] }> = {
  tabel: { title: "Tabel (oylik davomat)", roles: HR },
  "jarima-bonus": { title: "Jarima va bonuslar", roles: HR },
  "kadr-taqvim": { title: "Kadr taqvimi", roles: HR },
};
/** Ro'yxatsiz kartochka: xodim hujjat nusxasi (xodim kartasidagi «Hujjatlar» bo'limidan ochiladi). */
export const KADR_CARDS = ["kadr-hujjat"];
export const KADR_KEY_MODULE: Record<string, string> = Object.fromEntries([...Object.keys(KADR_ACCESS), ...KADR_CARDS].map((k) => [k, "employees"]));

/** Tezkor amallar to'ri ikonlari (ilovadagi `design/icons.tsx` nomlari). */
export const KADR_ICON: Record<string, string> = { tabel: "calendar-days", "jarima-bonus": "scale", "kadr-taqvim": "calendar-days" };

/** Yangi hujjat formalari (`create.ts`). Direktor hujjat ochmaydi (create.ts qoidasi) — u kartalardagi amallarni bajaradi. */
export const KADR_CREATE: Record<string, { roles: Role[]; title: string; label: string }> = {
  // Xodimlar → «Xodim qo'shish» (veb tezkor forma). Logistika xodim qo'shmaydi — haydovchiga faqat kirish beradi (Haydovchilar kartasi)
  employees: { roles: HR, title: "Yangi xodim", label: "Xodim qo'shish" },
  "jarima-bonus": { roles: HR, title: "Jarima / bonus", label: "Jarima / bonus yozish" },
  "davomat-sozlama": { roles: HR, title: "Kechikish jarimasi", label: "Kechikish jarimasi" },
};
export const KADR_CREATE_PERM: Record<string, { module: string; action?: string; strict?: boolean }> = {
  employees: { module: "employees", action: "create", strict: true },
  "jarima-bonus": { module: "employees", action: "payrules", strict: true },
  "davomat-sozlama": { module: "employees" },
};

/** Kartochka amallari → veb amali (`requireAction("employees", <action>)`). */
const ACTION_PERM: Record<string, string> = {
  "employee.edit": "edit", "employee.toggle": "edit", "employee.dismiss": "edit", "employee.restore": "edit",
  "employee.schedule": "edit", "employee.photo": "edit", "employee.photo.remove": "edit", "employee.doc": "edit", "employee.doc.remove": "edit",
  "employee.login": "login", "employee.block": "login", "employee.role": "login", "employee.resetpw": "login", "employee.rename": "login",
  "payadj.cancel": "payrules",
};
export const KADR_ACTION_ROLES: Record<string, Role[]> = Object.fromEntries(Object.keys(ACTION_PERM).map((a) => [a, HR_DIR]));
export const KADR_PERM: Record<string, { module: string; action: string }> = Object.fromEntries(Object.entries(ACTION_PERM).map(([a, p]) => [a, { module: "employees", action: p }]));
export const kadrActionPerm = (action: string) => (Object.hasOwn(ACTION_PERM, action) ? ACTION_PERM[action] : undefined);
export const isKadrAction = (action: string) => Object.hasOwn(ACTION_PERM, action);
