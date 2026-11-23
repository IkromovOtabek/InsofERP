import type { Role } from "@/generated/prisma";

/**
 * Vebdan mobilga ko'chirilgan bo'limlar (2026-11): Hisob varag'i, Logistika moliya, Dispetcher ombori, Realizatsiya reestri,
 * Oy yopish, Kreditlar, Asosiy vositalar, To'lov rejasi, HR qo'ng'iroqlar, xodim nasiyasi. Jadvallar alohida faylda (aylanma import
 * sababli — `logistika-access.ts` kabi): `list.ts` / `detail.ts` / `actions.ts` / `create.ts` ularni yoyadi, mantiq — `./port.ts`.
 * Rollar veb ERP bilan bir xil (`lib/nav.ts`), amal ruxsati — veb katalog (`lib/permissions.ts`, direktor bergan ruxsat ham).
 */

/** Ro'yxatlar (`list.ts` ACCESS) — bosh ekrandagi «Bo'limlar» to'rida chiqadi. */
export const PORT_ACCESS: Record<string, { title: string; roles: Role[]; menuHide?: Role[] }> = {
  // Veb «Haydovchilar tabeli → Hisob varag'i»: mashina × kun qatorlari, har qatorni tahrirlash (`lib/ledger-edit.ts`)
  ledger: { title: "Hisob varag'i", roles: ["LOGISTICS", "DISPATCHER", "SUPERVISOR", "ACCOUNTING"] },
  // Veb «Logistika moliya»: alohida logistika hisoblari, kirim-chiqim (`lib/logistics-finance.ts`)
  "logi-moliya": { title: "Logistika moliya", roles: ["SUPERVISOR", "MECHANIC"] },
  // Veb «Dispetcher ombori»: dispetcherdagi zapchast/yoqilg'i qoldig'i (`lib/dispatcher-stock.ts`)
  "disp-stock": { title: "Dispetcher ombori", roles: ["DISPATCHER", "WAREHOUSE", "SUPERVISOR", "MECHANIC"] },
  // Veb «Logistika → Realizatsiya»: reysdan jonli reestr (`lib/realization.ts`)
  "real-reestr": { title: "Realizatsiya reestri", roles: ["LOGISTICS", "DISPATCHER", "SALES", "ACCOUNTING", "FINANCE"] },
  // Veb «Moliya → Oy yopish» (`lib/period-sections.ts`)
  "oy-yopish": { title: "Oy yopish", roles: ["ACCOUNTING", "FINANCE"] },
  // Veb «Moliya → Kreditlar va qarzlar», «Asosiy vositalar», «To'lov rejasi»
  loans: { title: "Kreditlar va qarzlar", roles: ["ACCOUNTING", "FINANCE"] },
  assets: { title: "Asosiy vositalar", roles: ["ACCOUNTING", "FINANCE"] },
  "pay-plan": { title: "To'lov rejasi", roles: ["ACCOUNTING", "FINANCE"] },
  // Veb «Otdel kadr → Qo'ng'iroqlar» (`HrCallLog`)
  "hr-calls": { title: "Qo'ng'iroqlar jurnali", roles: ["HR"] },
  // Veb «Ish haqi → Xodim qarzlari» (`EmployeeDebt`, oylikdan ushlanadi)
  "emp-debts": { title: "Xodim qarzlari (nasiya)", roles: ["SECRETARY", "HR", "ACCOUNTING"] },
  // Veb «Otdel kadr → Komanda va brigadalar»: komandalar (svarshiklar va h.k.) tarkibi bilan — faqat ko'rish
  teams: { title: "Komandalar", roles: ["HR"] },
};

/** Ro'yxat/kartochka kaliti → veb modul (direktor «yo'q» qilsa ochilmaydi). */
export const PORT_KEY_MODULE: Record<string, string> = {
  ledger: "logistika", "logi-moliya": "logistika", "disp-stock": "stock", "real-reestr": "logistika",
  "oy-yopish": "moliya", loans: "moliya", assets: "moliya", "pay-plan": "moliya", "hr-calls": "employees", "emp-debts": "payroll", teams: "employees",
};

/** Kartochkalar (id bilan so'ralsa ham) — ro'yxat rollari bilan bir xil. */
export const PORT_DETAIL_ROLES: Record<string, Role[]> = Object.fromEntries(Object.entries(PORT_ACCESS).map(([k, v]) => [k, v.roles]));

/** Amal → veb katalog (modul + amal). Rollar — katalogdagi standart rollar (direktor ruxsati `can` da hisobga olinadi). */
export const PORT_PERM: Record<string, { module: string; action: string }> = {
  "ledger.edit": { module: "logistika", action: "ledger" },
  "logitx.cancel": { module: "logistika", action: "fin_write" },
  "period.close": { module: "moliya", action: "period_close" },
  "period.closeall": { module: "moliya", action: "period_close" },
  "period.reopen": { module: "moliya", action: "period_reopen" },
  "hrcall.status": { module: "employees", action: "calls" },
};
export const PORT_ACTION_ROLES: Record<string, Role[]> = {
  "ledger.edit": ["LOGISTICS", "DISPATCHER", "DIRECTOR"],
  "logitx.cancel": ["SUPERVISOR", "DIRECTOR"],
  "period.close": ["ACCOUNTING", "DIRECTOR"],
  "period.closeall": ["ACCOUNTING", "DIRECTOR"],
  "period.reopen": ["DIRECTOR"],
  "hrcall.status": ["HR", "DIRECTOR"],
};
export const PORT_ACTIONS = new Set(Object.keys(PORT_ACTION_ROLES));

/** Yangi hujjat formalari (`create.ts` CREATE_ROLES / CREATE_PERM). */
export const PORT_CREATE_ROLES: Record<string, { roles: Role[]; title: string; label: string }> = {
  "logi-tx": { roles: ["SUPERVISOR"], title: "Logistika kirim / chiqim", label: "Logistika moliya" },
  "hr-call": { roles: ["HR"], title: "Qo'ng'iroq yozish", label: "Qo'ng'iroq" },
  // Veb «Kirim-Chiqim → Kassani yopish»: kun oxirida naqdni sanash, tizim qoldig'i bilan farq
  "kassa-yopish": { roles: ["CASHIER"], title: "Kassani yopish (sanash)", label: "Kassani yopish" },
};
export const PORT_CREATE_PERM: Record<string, { module: string; action?: string; strict?: boolean }> = {
  "logi-tx": { module: "logistika", action: "fin_write", strict: true },
  "hr-call": { module: "employees", action: "calls", strict: true },
  "kassa-yopish": { module: "cashflow", action: "close", strict: true },
};
export const PORT_FORMS = new Set(Object.keys(PORT_CREATE_ROLES));

/** Bosh ekran to'ridagi belgi (`home.ts` LIST_ICON; ilovada bor nomlar). */
export const PORT_ICON: Record<string, string> = {
  ledger: "calendar-days", "logi-moliya": "wallet", "disp-stock": "warehouse", "real-reestr": "receipt", "oy-yopish": "circle-check",
  loans: "hand-coins", assets: "factory", "pay-plan": "calendar-days", "hr-calls": "users", "emp-debts": "scale", teams: "hard-hat",
};
