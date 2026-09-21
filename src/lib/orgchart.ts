import type { Role } from "@/generated/prisma";

/**
 * Zavodning tashkiliy tuzilmasi — "Otdel kadr › Bo'limlar" sahifasidagi diagramma shu yerdan chiziladi.
 *
 * Tugun = bo'lim lavozimi (`POSITIONS` bilan bir xil nom, Employee.position matni ham shu).
 * `parent` — kim kimga bo'ysunadi; `assignable` — ishchi lavozimlar (Haydovchi, Operator...)
 * shu bo'lim tagiga osiladimi. Bo'lim ostida bo'lim turgan joyga ishchi lavozim qo'yilmaydi,
 * shuning uchun Direktor / Ish boshqaruvchi / Buxgalteriya `assignable` emas.
 */
export type OrgTone = "slate" | "violet" | "amber" | "orange" | "blue" | "emerald" | "sky";

export type OrgDept = {
  role: Role;
  /** Employee.position matni bilan bir xil bo'lishi shart. */
  label: string;
  parent: Role | null;
  tone: OrgTone;
  /** `DEPT_ICONS` kalitlari (ikonka komponenti klient tomonda olinadi). */
  icon: string;
  /** Bo'lim nima qiladi — kartochkada bir satr. */
  duty: string;
  assignable?: boolean;
};

export const ORG_TREE: OrgDept[] = [
  { role: "DIRECTOR",   label: "Direktor",         parent: null,         tone: "slate",   icon: "crown",    duty: "Zavod rahbari, yakuniy qaror" },
  { role: "SUPERVISOR", label: "Ish boshqaruvchi", parent: "DIRECTOR",   tone: "violet",  icon: "compass",  duty: "Kunlik ishni taqsimlaydi, nazorat qiladi" },
  { role: "PRODUCTION", label: "Ishlab chiqarish", parent: "SUPERVISOR", tone: "amber",   icon: "factory",  duty: "Zames, dona mahsulot, retsept", assignable: true },
  { role: "WAREHOUSE",  label: "Sklad",            parent: "SUPERVISOR", tone: "orange",  icon: "package",  duty: "Xomashyo kirimi, qoldiq, yuklash", assignable: true },
  { role: "LOGISTICS",  label: "Logistika",        parent: "SUPERVISOR", tone: "blue",    icon: "truck",    duty: "Reys, nakladnoy, texnika", assignable: true },
  { role: "SALES",      label: "Sotuv",            parent: "DIRECTOR",   tone: "emerald", icon: "handshake",duty: "Mijoz, zayavka, shartnoma", assignable: true },
  { role: "ACCOUNTING", label: "Buxgalteriya",     parent: "DIRECTOR",   tone: "sky",     icon: "calculator", duty: "Schyot, hisob-kitob, hisobot" },
  { role: "CASHIER",    label: "Kassa / bank",     parent: "ACCOUNTING", tone: "sky",     icon: "wallet",   duty: "Pul kirimi va chiqimi", assignable: true },
  { role: "HR",         label: "Otdel kadr",       parent: "DIRECTOR",   tone: "violet",  icon: "users",    duty: "Kadr kartasi, hujjat, ma'muriy-xo'jalik", assignable: true },
];

export const ORG_ROOT: Role = "DIRECTOR";

export const deptByRole = (role: Role) => ORG_TREE.find((d) => d.role === role) ?? null;
export const deptByLabel = (label: string) => {
  const key = label.trim().toLowerCase();
  return ORG_TREE.find((d) => d.label.toLowerCase() === key) ?? null;
};
export const childDepts = (role: Role) => ORG_TREE.filter((d) => d.parent === role);

/** Ishchi lavozim biriktiriladigan bo'limlar — formadagi tanlov ro'yxati. */
export const ASSIGNABLE_DEPTS = ORG_TREE.filter((d) => d.assignable);
export const isAssignableDept = (key: string) => ASSIGNABLE_DEPTS.some((d) => d.role === key);

/** Direktordan boshlab tugungacha bo'lgan zanjir: Direktor › Ish boshqaruvchi › Logistika. */
export function chainTo(role: Role): OrgDept[] {
  const out: OrgDept[] = [];
  let cur = deptByRole(role);
  while (cur) {
    out.unshift(cur);
    cur = cur.parent ? deptByRole(cur.parent) : null;
  }
  return out;
}

/** Nomiga qarab taxmin — faqat otdel kadr bo'limni belgilamagan lavozimlar uchun. */
const GUESS: { re: RegExp; dept: Role }[] = [
  { re: /haydovch|mexanik|slesar|ta'?mirchi|shofyor/i, dept: "LOGISTICS" },
  { re: /sklad|ombor|yuk ortuvchi|pogruzchik|ekskavator/i, dept: "WAREHOUSE" },
  { re: /operator|laborant|master|prorab|betonchi|armatura|qolipchi|payvandchi|elektrik|kran|brigadir|ishchi/i, dept: "PRODUCTION" },
  { re: /qo'?riqchi|farrosh|oshpaz|kotib|kadr|xo'?jalik/i, dept: "HR" },
  { re: /sotuv|agent|menejer|marketing/i, dept: "SALES" },
  { re: /kassir|kassa/i, dept: "CASHIER" },
];

export const guessDepartment = (name: string): Role | null => GUESS.find((g) => g.re.test(name))?.dept ?? null;

/** Lavozim qaysi bo'limda: otdel kadr belgilagani, bo'lmasa nom bo'yicha taxmin. */
export const departmentOf = (p: { name: string; department: string | null }): Role | null =>
  (p.department && isAssignableDept(p.department) ? (p.department as Role) : null) ?? guessDepartment(p.name);

/* ═══════════════════════ Ish etaplari ═══════════════════════ */

/**
 * Zayavka zavod ichida qanday yo'l bosib o'tadi — diagramma tepasidagi lenta.
 * `roles` — shu etapda ishlaydigan bo'limlar (bosilganda diagrammada yoritiladi).
 */
export type OrgStage = { key: string; label: string; hint: string; roles: Role[]; icon: string };

export const ORG_STAGES: OrgStage[] = [
  { key: "zayavka",  label: "Zayavka",          hint: "Sotuv mijozdan buyurtma oladi",            roles: ["SALES"],                    icon: "handshake" },
  { key: "tasdiq",   label: "Tasdiq / limit",   hint: "Limit oshsa direktor ochib beradi",        roles: ["DIRECTOR", "ACCOUNTING"],   icon: "shieldCheck" },
  { key: "ishlab",   label: "Ishlab chiqarish", hint: "Zames beriladi, dona mahsulot quyiladi",   roles: ["SUPERVISOR", "PRODUCTION"], icon: "factory" },
  { key: "yuklash",  label: "Yuklash",          hint: "Sklad xomashyo beradi, mikser ortiladi",   roles: ["WAREHOUSE"],                icon: "package" },
  { key: "reys",     label: "Reys",             hint: "Haydovchi nakladnoy bilan obyektga boradi", roles: ["LOGISTICS"],               icon: "truck" },
  { key: "tolov",    label: "To'lov / yopish",  hint: "Kassa pulni oladi, buxgalteriya yopadi",   roles: ["CASHIER", "ACCOUNTING"],    icon: "wallet" },
];
