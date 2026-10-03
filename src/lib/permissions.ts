import type { Role } from "@/generated/prisma";
import type { Perms } from "./auth";

/* ───────────────────────── Amal darajasidagi ruxsat (direktor taqsimlaydi) ─────────────────────────
 *
 * Har bir modul (lib/nav.ts → MODULES) ichida aniq amallar bor: masalan "Zayavkalar" → ochish,
 * qabul qilish, bekor qilish, shartnoma... Direktor xodimga modul bo'yicha daraja beradi:
 *
 *   (yo'q)      — rol bo'yicha: amalni rol odatda bajara olsa bajaradi (`roles` ro'yxati)
 *   "none"      — modul yopiq: menyuda ham yo'q, sahifa ham ochilmaydi
 *   "view"      — faqat ko'radi, hech bir amal yo'q
 *   string[]    — ko'radi + faqat belgilangan amallar (masalan ["create","confirm"])
 *   "write"     — ko'radi + moduldagi barcha topshiriladigan amallar
 *
 * Direktor bergan ruxsat rol cheklovidan USTUN: Ishlab chiqarish xodimiga Zayavkalarda "create"
 * berilsa, u mijoz zayavkasini ocha oladi — rol ro'yxatida SALES bo'lmasa ham.
 *
 * `delegable: false` — faqat direktor bajaradi, hech kimga berib bo'lmaydi.
 * Bu fayl klientda ham ishlatiladi (Sozlamalar → Ruxsatlar formasi) — baza importi bo'lmasin.
 */

export type ActionDef = {
  key: string;
  label: string;
  /** Rol bo'yicha (direktor ruxsat bermagan holatda) shu amalni bajaradigan rollar. Direktor — doim. */
  roles: readonly Role[];
  /** Izoh — formada kichik matn bilan */
  hint?: string;
  /** false — faqat direktor (boshqaga berib bo'lmaydi) */
  delegable?: boolean;
};

const STOCK_ORDER: readonly Role[] = ["SALES", "PRODUCTION", "SUPERVISOR", "WAREHOUSE"];
const BI: readonly Role[] = ["FINANCE", "ACCOUNTING"];

export const MODULE_ACTIONS: Record<string, ActionDef[]> = {
  orders: [
    { key: "create",   label: "Mijoz zayavkasini ochish",           roles: ["SALES"] },
    { key: "confirm",  label: "Zayavkani qabul qilish (tasdiqlash)", roles: ["SALES"], hint: "Kredit limiti va kunlik limit baribir tekshiriladi" },
    { key: "cancel",   label: "Zayavkani bekor qilish",             roles: ["SALES"] },
    { key: "contract", label: "Shartnoma va kafolat xati",          roles: ["SALES", "ACCOUNTING"] },
    { key: "import",   label: "Excel'dan zayavka import",           roles: ["SALES"] },
    { key: "stock",    label: "Sklad (zaxira) zayavkasi",           roles: STOCK_ORDER, hint: "Ochish, qabul qilish, yopish, bekor qilish" },
    { key: "unblock",  label: "Limitdan oshgan zayavka blokini ochish", roles: [], hint: "Odatda faqat direktor — ehtiyot bo'lib bering" },
  ],
  sales: [
    { key: "leads",     label: "Sayt arizalari bilan ishlash",  roles: ["SALES"], hint: "Holat, izoh, mijozga aylantirish" },
    { key: "ecommerce", label: "E-commerce do'konini boshqarish", roles: ["SALES"] },
    { key: "invoice",   label: "Schyot yozish",                  roles: ["ACCOUNTING", "SALES"] },
    { key: "invoice_cancel", label: "Schyotni bekor qilish",     roles: ["ACCOUNTING"] },
  ],
  customers: [
    { key: "edit",     label: "Mijoz qo'shish / tahrirlash",  roles: ["SALES", "ACCOUNTING", "FINANCE"] },
    { key: "sites",    label: "Mijoz obyektlari",             roles: ["SALES", "ACCOUNTING", "FINANCE"] },
    { key: "app_link", label: "ECO ilova hisobini bog'lash",  roles: ["SALES"] },
    { key: "agent",    label: "Mijozni agentga biriktirish",  roles: ["HR", "SALES"] },
  ],
  production: [
    { key: "batch",   label: "Zames (partiya) yozish",           roles: ["PRODUCTION"] },
    { key: "assign",  label: "Brigadalarga taqsimlash",          roles: ["PRODUCTION"] },
    { key: "recipe",  label: "Retsept versiyasi / import",       roles: ["PRODUCTION", "WAREHOUSE", "PROCUREMENT"] },
    { key: "report",  label: "Brak, davomat, smena hisoboti",    roles: ["PRODUCTION", "SUPERVISOR"] },
    { key: "batch_storno", label: "Zamesni storno qilish",       roles: [], hint: "Xomashyo skladga qaytadi, mahsulot chiqariladi — odatda faqat direktor" },
  ],
  tasks: [
    { key: "progress", label: "Bajarilgan hajmni qayd qilish",   roles: ["PRODUCTION", "SUPERVISOR"] },
    { key: "cancel",   label: "Topshiriqni bekor qilish",        roles: ["PRODUCTION", "SUPERVISOR"] },
    { key: "brigade",  label: "Brigada ochish / tahrirlash",     roles: ["PRODUCTION", "SUPERVISOR", "HR"] },
  ],
  trips: [
    { key: "create",  label: "Reys ochish",                       roles: ["LOGISTICS", "PRODUCTION"] },
    { key: "load",    label: "Yuklandi deb belgilash",            roles: ["PRODUCTION"] },
    { key: "move",    label: "Yo'lga chiqdi / yetkazildi / yopish", roles: ["LOGISTICS"] },
    { key: "cancel",  label: "Reysni bekor qilish",               roles: ["LOGISTICS"] },
    { key: "issue",   label: "Muammo yozish",                     roles: ["LOGISTICS", "PRODUCTION"] },
    { key: "cost",    label: "Reys xarajati",                     roles: ["LOGISTICS", "ACCOUNTING"] },
    { key: "drivers", label: "Haydovchi ilovasi (ECO) boshqaruvi", roles: ["LOGISTICS", "HR"] },
  ],
  logistika: [
    { key: "vehicle",  label: "Transport kartochkasi",           roles: ["LOGISTICS"] },
    { key: "service",  label: "Texnik xizmat va transport holati", roles: ["LOGISTICS", "MECHANIC"] },
    { key: "fuel",     label: "Yoqilg'i yozuvlari, xarajat o'chirish", roles: ["LOGISTICS", "ACCOUNTING"] },
    { key: "expense",  label: "Transport xarajati kiritish",     roles: ["LOGISTICS", "ACCOUNTING", "MECHANIC"] },
    { key: "sites",    label: "Obyektlar",                       roles: ["LOGISTICS", "SALES"] },
    { key: "drivers",  label: "Haydovchi kartochkasi",           roles: ["LOGISTICS"] },
    { key: "settings", label: "Logistika sozlamalari",           roles: ["LOGISTICS"] },
  ],
  stock: [
    { key: "receipt",   label: "Kirim (xomashyo qabul qilish)",  roles: ["PROCUREMENT", "WAREHOUSE"] },
    { key: "receipt_storno", label: "Kirimni storno qilish",    roles: [], hint: "Sklad harakatlari teskari yoziladi — odatda faqat direktor" },
    { key: "adjust",    label: "Inventarizatsiya va spisanie",   roles: ["WAREHOUSE"] },
    { key: "brigade",   label: "Brigadaga berish / qaytarish",   roles: ["WAREHOUSE", "PROCUREMENT", "PRODUCTION", "SUPERVISOR"] },
    { key: "products",  label: "Tayyor mahsulot qoldig'ini kiritish", roles: ["WAREHOUSE", "PRODUCTION"] },
    { key: "import",    label: "Xomashyo import",                roles: ["WAREHOUSE", "PROCUREMENT", "PRODUCTION"] },
    { key: "suppliers", label: "Yetkazuvchilar",                 roles: ["WAREHOUSE", "PROCUREMENT", "ACCOUNTING"] },
  ],
  taminot: [],
  payments: [
    { key: "create", label: "To'lov qabul qilish / bog'lash",   roles: ["CASHIER", "ACCOUNTING"] },
    { key: "storno", label: "To'lovni storno qilish",           roles: ["ACCOUNTING"] },
    { key: "import", label: "Sotuv reyestri importi",           roles: ["CASHIER", "ACCOUNTING", "FINANCE"] },
  ],
  cashflow: [
    { key: "create", label: "Kirim-chiqim yozish",              roles: ["CASHIER", "ACCOUNTING", "FINANCE"] },
    { key: "delete", label: "Yozuvni o'chirish",                roles: ["ACCOUNTING", "FINANCE"] },
    { key: "pay",    label: "Yetkazuvchiga to'lash",            roles: ["FINANCE", "ACCOUNTING"] },
  ],
  employees: [
    { key: "create", label: "Xodim qo'shish",                    roles: ["HR", "LOGISTICS"] },
    { key: "edit",   label: "Xodimni tahrirlash / bo'shatish",   roles: ["HR"] },
    { key: "login",  label: "Login berish, parol, rol",          roles: ["HR"], hint: "Rol berish — muhim huquq" },
  ],
  "bi-tahlil": [
    { key: "ai",        label: "Insof AI (savol, hisobot, Telegram)", roles: BI },
    { key: "marketing", label: "Marketing ma'lumotlari",         roles: BI },
    { key: "plan",      label: "Sotuv rejasi",                   roles: ["FINANCE"] },
  ],
};

export function actionDef(module: string, action: string): ActionDef | undefined {
  return MODULE_ACTIONS[module]?.find((a) => a.key === action);
}

/** Topshiriladigan amallar (formada ko'rsatiladi). */
export function delegableActions(module: string): ActionDef[] {
  return (MODULE_ACTIONS[module] ?? []).filter((a) => a.delegable !== false);
}

type Who = { role: Role; perms?: Perms };

/**
 * Amalni bajara oladimi — veb sahifa (tugmani ko'rsatish), server action va mobil ilova bitta qoidadan.
 * `fallbackRoles` — katalogda bo'lmagan yoki chaqiruvchi o'z ro'yxatini bergan holat uchun.
 */
export function canDo(who: Who, module: string, action: string, fallbackRoles?: readonly Role[]): boolean {
  if (who.role === "DIRECTOR") return true;
  const def = actionDef(module, action);
  if (def?.delegable === false) return false;
  const lvl = who.perms?.[module];
  if (lvl === "none" || lvl === "view") return false;
  if (lvl === "write") return true;
  if (Array.isArray(lvl)) return lvl.includes(action);
  return (def?.roles ?? fallbackRoles ?? []).includes(who.role);
}

/** Rol bo'yicha (perms yo'q) bajariladigan amallar — formada "Tanlangan amallar" ga o'tganda boshlang'ich belgilar. */
export function roleDefaultActions(role: Role, module: string): string[] {
  return delegableActions(module).filter((a) => role === "DIRECTOR" || a.roles.includes(role)).map((a) => a.key);
}

/** Xodimning shu moduldagi amallari, direktor bergani hisobga olingan holda (sozlamalarda xulosa uchun). */
export function effectiveActions(who: Who, module: string): string[] {
  return delegableActions(module).filter((a) => canDo(who, module, a.key)).map((a) => a.key);
}
