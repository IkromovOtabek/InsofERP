import type { Role } from "@/generated/prisma";

/**
 * Otdel kadr kabineti (ERP → mobil paritet) — ruxsat jadvallari (`./kadr-extra.ts`). Alohida fayl: `list.ts` / `detail.ts` /
 * `create.ts` / `home.ts` ularni modul yuklanishida o'qiydi — `kadr-extra.ts` ga to'g'ridan bog'lansa aylanma import bo'lardi.
 * Rollar veb bilan bir xil: `lib/nav.ts` (Otdel kadr tablari — HR, direktor har doim), amallar — `lib/permissions.ts`
 * katalogidagi "employees" moduli amallari (`requireAction("employees", …)`).
 */
const HR: Role[] = ["HR"];
const HR_DIR: Role[] = ["HR", "DIRECTOR"];

/** Ro'yxatlar — vebdagi `/otdel-kadr?tab=…` tablari. Kartochka kaliti ham shu (bitta istisno — `kadr-hujjat`). */
export const KADR_ACCESS: Record<string, { title: string; roles: Role[] }> = {
  tabel: { title: "Tabel (oylik davomat)", roles: HR },
  lavozimlar: { title: "Ishchi lavozimlar", roles: HR },
  grafik: { title: "Smena grafigi", roles: HR },
  "jarima-bonus": { title: "Jarima va bonuslar", roles: HR },
  cheklistlar: { title: "Cheklistlar (natija)", roles: HR },
  kpi: { title: "KPI — xodimlar", roles: HR },
  vakansiyalar: { title: "Vakansiyalar", roles: HR },
  moslashuv: { title: "Moslashuv (sinov muddati)", roles: HR },
  kurslar: { title: "Kurslar", roles: HR },
  sorovlar: { title: "So'rovnoma natijalari", roles: HR },
  "kadr-taqvim": { title: "Kadr taqvimi", roles: HR },
  "kadr-hisobot": { title: "Kadr hisobotlari", roles: HR },
};
/** Ro'yxatsiz kartochka: xodim hujjat nusxasi (xodim kartasidagi «Hujjatlar» bo'limidan ochiladi). */
export const KADR_CARDS = ["kadr-hujjat"];
export const KADR_KEY_MODULE: Record<string, string> = Object.fromEntries([...Object.keys(KADR_ACCESS), ...KADR_CARDS].map((k) => [k, "employees"]));

/** Tezkor amallar to'ri ikonlari (ilovadagi `design/icons.tsx` nomlari). */
export const KADR_ICON: Record<string, string> = {
  tabel: "calendar-days", lavozimlar: "briefcase", grafik: "clock", "jarima-bonus": "scale", cheklistlar: "clipboard-check",
  kpi: "target", vakansiyalar: "user-plus", moslashuv: "user-check", kurslar: "file-text", sorovlar: "chart-column",
  "kadr-taqvim": "calendar-days", "kadr-hisobot": "chart-column",
};

/** Yangi hujjat formalari (`create.ts`). Direktor hujjat ochmaydi (create.ts qoidasi) — u kartalardagi amallarni bajaradi. */
export const KADR_CREATE: Record<string, { roles: Role[]; title: string; label: string }> = {
  // Xodimlar → «Xodim qo'shish» (veb tezkor forma): logistika — faqat haydovchi (qoida `lib/kadr-employee.ts`)
  employees: { roles: ["HR", "LOGISTICS"], title: "Yangi xodim", label: "Xodim qo'shish" },
  "jarima-bonus": { roles: HR, title: "Jarima / bonus", label: "Jarima / bonus yozish" },
  vakansiyalar: { roles: HR, title: "Yangi vakansiya", label: "Vakansiya ochish" },
  nomzodlar: { roles: HR, title: "Yangi nomzod", label: "Nomzod qo'shish" },
  xabar: { roles: HR, title: "Ommaviy xabar", label: "Xabar yuborish" },
  "davomat-sozlama": { roles: HR, title: "Kechikish jarimasi", label: "Kechikish jarimasi" },
};
export const KADR_CREATE_PERM: Record<string, { module: string; action?: string; strict?: boolean }> = {
  employees: { module: "employees", action: "create", strict: true },
  "jarima-bonus": { module: "employees", action: "payrules", strict: true },
  vakansiyalar: { module: "employees", action: "recruit", strict: true },
  nomzodlar: { module: "employees", action: "recruit", strict: true },
  xabar: { module: "employees", action: "voice", strict: true },
  "davomat-sozlama": { module: "employees" },
};

/** Kartochka amallari → veb amali (`requireAction("employees", <action>)`). */
const ACTION_PERM: Record<string, string> = {
  "employee.edit": "edit", "employee.toggle": "edit", "employee.dismiss": "edit", "employee.restore": "edit",
  "employee.schedule": "edit", "employee.photo": "edit", "employee.photo.remove": "edit", "employee.doc": "edit", "employee.doc.remove": "edit",
  "employee.login": "login", "employee.block": "login", "employee.role": "login", "employee.resetpw": "login", "employee.rename": "login",
  "position.toggle": "edit",
  "shift.fill": "schedule",
  "payadj.cancel": "payrules",
  "kpi.fact": "kpi",
  "vacancy.status": "recruit", "cand.interview": "recruit", "cand.hire": "recruit",
  "onb.start": "onboarding", "onb.decide": "onboarding", "onb.hrsteps": "onboarding",
  "course.assign": "training", "course.toggle": "training",
  "survey.status": "voice",
};
export const KADR_ACTION_ROLES: Record<string, Role[]> = Object.fromEntries(Object.keys(ACTION_PERM).map((a) => [a, HR_DIR]));
export const KADR_PERM: Record<string, { module: string; action: string }> = Object.fromEntries(Object.entries(ACTION_PERM).map(([a, p]) => [a, { module: "employees", action: p }]));
export const kadrActionPerm = (action: string) => (Object.hasOwn(ACTION_PERM, action) ? ACTION_PERM[action] : undefined);
export const isKadrAction = (action: string) => Object.hasOwn(ACTION_PERM, action);
