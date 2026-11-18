/**
 * Platforma (IT panel) korxona tarifida o'chirib qo'yadigan qo'shimcha modullar.
 *
 * Asosiy ish (zayavka, mijoz, sklad, kassa, logistika, ishlab chiqarish, xodimlar) har doim yoqiq — faqat shu ro'yxatdagilar
 * o'chiriladi. O'chirilgan modul hamma uchun yopiladi, direktor va IT uchun ham: menyudan yo'qoladi, sahifa ochilmaydi,
 * amallar (`canDo`, `canView`, `canWrite`, `moduleWriteAllowed`) va mobil API rad etadi. Ma'lumot o'chmaydi — yoqilsa qaytadi.
 *
 * Har korxona — alohida jarayon, shuning uchun ro'yxat jarayon bo'yicha umumiy (`globalThis`): sessiya o'qilganda
 * korxona bazasidan yangilanadi (lib/tenant.ts → loadPlatformGate). Fayl brauzerda ham import qilinadi — u yerda ro'yxat
 * bo'sh (hech narsa yopilmaydi), haqiqiy tekshiruv serverda.
 */
export const PLATFORM_MODULES = [
  "leads", "amocrm", "marketing", "arenda", "offers", "agent", "bi-tahlil", "kirim-qqs", "moliya", "payroll", "mexanik", "taminot", "vazifalar",
] as const;

/**
 * Asosiy modul ichidagi qism (`lib/nav.ts` MODULES'da alohida modul emas): Sayt arizalari va amoCRM — «Sotuv» ichida.
 * Ruxsatlar (perms) avvalgidek «sales» modulida qoladi, platforma esa ularni alohida o'chiradi.
 */
export const PLATFORM_SUB_LABELS: Record<string, string> = { leads: "Sayt arizalari", amocrm: "amoCRM" };

const g = globalThis as { __insofModulesOff?: ReadonlySet<string> };

export const isPlatformModule = (key: string) => (PLATFORM_MODULES as readonly string[]).includes(key);

export function setModulesOff(keys: readonly string[]) {
  g.__insofModulesOff = new Set(keys.filter(isPlatformModule));
}

export const isModuleOff = (key: string | null | undefined): boolean => !!key && !!g.__insofModulesOff?.has(key);

export const MODULE_OFF_MESSAGE = "Bu bo'lim korxonangiz tarifiga kirmaydi — ulash uchun Insof administratoriga murojaat qiling";

/**
 * Boshqa modul ichida turgan, lekin o'chiriladigan modulga bog'liq sahifalar (BI tahlilidagi Marketing, Agentlar …):
 * asosiy modul o'chirilsa — ular ham yopiladi.
 */
const DEPENDENT_PATHS: [prefix: string, module: string][] = [
  ["/bi-tahlil/marketing", "marketing"], ["/bi-tahlil/agentlar", "agent"], ["/bi-tahlil/mexanik", "mexanik"], ["/bi-tahlil/moliya/ish-haqi", "payroll"],
  ["/leads", "leads"], ["/amocrm", "amocrm"],
];

/** Boshqa modul katalogidagi, lekin o'chiriladigan modulga tegishli amallar (`lib/permissions.ts` MODULE_ACTIONS). */
const DEPENDENT_ACTIONS: [module: string, action: string, platform: string][] = [
  ["sales", "leads", "leads"], ["sales", "amocrm", "amocrm"], ["sales", "amocrm_settings", "amocrm"], ["customers", "agent", "agent"],
];

/** Amal platforma tomonidan yopilganmi: modulning o'zi yoki amal tegishli qism (Sotuv → Sayt arizalari) o'chirilgan. */
export function actionOff(module: string | null | undefined, action: string | null | undefined): boolean {
  if (isModuleOff(module)) return true;
  return !!action && DEPENDENT_ACTIONS.some(([m, a, p]) => m === module && a === action && isModuleOff(p));
}

/** Yo'l platforma tomonidan yopilganmi. `module` — `moduleForPath(path)` (lib/nav.ts; bu yerda import qilinmaydi — aylana bog'lanish). */
export function pathOff(path: string, module: string | null): boolean {
  if (isModuleOff(module)) return true;
  return DEPENDENT_PATHS.some(([p, m]) => (path === p || path.startsWith(`${p}/`) || path.startsWith(`${p}?`)) && isModuleOff(m));
}
