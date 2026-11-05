import type { Role } from "@/generated/prisma";
import type { PermValue } from "./auth";
import { MODULE_ACTIONS, actionDef } from "./permissions";

/* ───────────────────────── Ruxsatlar daraxti: bo'lim → tugma → amal ─────────────────────────
 *
 * Bo'lim — menyu guruhi (Sotuv, Sklad...), tugma — modul ichidagi oyna, amal — `MODULE_ACTIONS` dagi kalit.
 *
 *   paths   — tugma alohida ochiladigan oyna (yo'l prefikslari, eng uzuni yutadi): /stock/prixod, /jonatma...
 *   inPage  — sahifa ichidagi oyna (?bolim=holat): sahifaning o'zi `canSee` bilan tekshiradi
 *   ikkalasi ham yo'q — oynasiz tugma: amali boshqa modul oynasida (masalan yetkazuvchi kartasidagi to'lov)
 *
 * Oynani ko'rish huquqi perms ro'yxatida `@<tugma>` bilan saqlanadi: `stock: ["@kirim", "receipt", "@chiqim"]`.
 * Ro'yxatda birorta `@` bo'lsa — tugma rejimi (faqat belgilangan oynalar ochiq); bo'lmasa — eski "tanlangan amallar"
 * (modulning hamma oynasi ochiq). Amal tekshiruvi (`canDo`) o'zgarmaydi. Bu fayl klientda ham ishlatiladi.
 */

export type PermButton = {
  key: string;
  label: string;
  paths?: string[];
  inPage?: boolean;
  actions: string[];
  /** Rol bo'yicha bu oynani ko'rmaydigan rollar (sahifa ichidagi oynalar uchun) */
  notRoles?: Role[];
};

export const PERM_BUTTONS: Record<string, PermButton[]> = {
  orders: [
    { key: "zayavkalar", label: "Zayavkalar", paths: ["/orders"], actions: ["create", "edit", "confirm", "cancel", "contract", "stock", "unblock", "capacity"] },
    { key: "import", label: "Excel'dan import", paths: ["/orders/import"], actions: ["import"] },
    { key: "tarix", label: "Zayavkalar tarixi", paths: ["/orders/tarix"], actions: [] },
  ],
  sales: [
    { key: "sotuv", label: "Sotuv", paths: ["/sales"], actions: [] },
    { key: "realizatsiya", label: "Realizatsiya reestri", paths: ["/sales/realizatsiya"], actions: [] },
    { key: "leads", label: "Sayt arizalari", paths: ["/leads"], actions: ["leads"] },
    { key: "ecommerce", label: "E-commerce", paths: ["/e-commerce"], actions: ["ecommerce"] },
    { key: "amocrm", label: "amoCRM", paths: ["/amocrm"], actions: ["amocrm", "amocrm_settings"] },
    { key: "schyot", label: "Schyotlar (Kassa / schyot oynasida)", actions: ["invoice", "invoice_cancel"] },
  ],
  offers: [
    { key: "takliflar", label: "Tijorat takliflari", paths: ["/takliflar"], actions: ["create", "cancel"] },
    { key: "sozlamalar", label: "Taklif sozlamalari", paths: ["/takliflar/sozlamalar"], actions: ["settings"] },
  ],
  marketing: [
    { key: "statistika", label: "Statistika", paths: ["/marketing"], actions: ["seo"] },
    { key: "kontent", label: "Kontent reja", paths: ["/marketing/kontent"], actions: ["content", "publish", "boost"] },
    { key: "studiya", label: "AI studiya", paths: ["/marketing/studiya"], actions: [] },
    { key: "agent", label: "AI marketing agenti", paths: ["/marketing/agent"], actions: ["agent"] },
    { key: "media", label: "Media kutubxona", paths: ["/marketing/media"], actions: [] },
    { key: "target", label: "Target", paths: ["/marketing/target"], actions: ["ads", "boost_approve"] },
    { key: "sozlamalar", label: "Marketing sozlamalari", paths: ["/marketing/sozlamalar"], actions: ["settings"] },
  ],
  customers: [
    { key: "mijozlar", label: "Mijozlar", paths: ["/customers"], actions: ["edit", "sites", "app_link", "agent"] },
  ],
  agent: [
    { key: "agentlar", label: "Sotuv agentlari", paths: ["/agent"], actions: [] },
  ],
  production: [
    { key: "ishlab", label: "Ishlab chiqarish", paths: ["/production"], actions: ["batch", "batch_storno", "assign", "reschedule", "report", "plan", "staff"] },
    { key: "retseptlar", label: "Retseptlar", paths: ["/recipes"], actions: ["recipe"] },
  ],
  tasks: [
    { key: "topshiriqlar", label: "Topshiriqlar", paths: ["/tasks"], actions: ["progress", "cancel"] },
    { key: "brigadalar", label: "Brigadalar", paths: ["/brigades"], actions: ["brigade", "pay"] },
  ],
  trips: [
    { key: "reyslar", label: "Reyslar", paths: ["/trips"], actions: ["create", "load", "move", "cancel", "issue", "resolve", "cost"] },
    { key: "eco", label: "Haydovchi ilovasi (ECO)", paths: ["/drivers"], actions: ["drivers"] },
  ],
  logistika: [
    { key: "buyurtmalar", label: "Buyurtmalar", paths: ["/logistika/buyurtmalar"], actions: [] },
    { key: "kalendar", label: "Dispetcher kalendari", paths: ["/logistika/kalendar"], actions: [] },
    { key: "transport", label: "Transport", paths: ["/logistika/transport"], actions: ["vehicle", "service"] },
    { key: "yoqilgi", label: "Yoqilg'i", paths: ["/logistika/yoqilgi"], actions: ["fuel"] },
    { key: "xarajatlar", label: "Transport xarajatlari", paths: ["/logistika/xarajatlar"], actions: ["expense"] },
    { key: "haydovchilar", label: "Haydovchilar", paths: ["/logistika/haydovchilar"], actions: ["drivers", "driver_login"] },
    { key: "tabel", label: "Haydovchilar tabeli", paths: ["/logistika/tabel"], actions: ["pay", "pay_approve"] },
    { key: "realizatsiya", label: "Realizatsiya", paths: ["/logistika/realizatsiya"], actions: ["real_auto", "real_manual"] },
    { key: "obyektlar", label: "Obyektlar", paths: ["/logistika/obyektlar"], actions: ["sites"] },
    { key: "monitoring", label: "GPS / Monitoring", paths: ["/logistika/monitoring"], actions: [] },
    { key: "nakladnoy", label: "Nakladnoylar va yetkazish", paths: ["/logistika/nakladnoylar", "/logistika/yetkazish"], actions: [] },
    { key: "hisobot", label: "Hisobotlar va analitika", paths: ["/logistika/hisobotlar", "/logistika/analitika"], actions: [] },
    { key: "sozlamalar", label: "Logistika sozlamalari", paths: ["/logistika/sozlamalar"], actions: ["settings"] },
  ],
  stock: [
    { key: "sklad", label: "Sklad (xomashyo qoldiqlari)", paths: ["/stock"], actions: ["price", "import"] },
    { key: "kirim", label: "Kirim", paths: ["/stock/prixod", "/receipts"], actions: ["receipt", "receipt_storno"] },
    { key: "chiqim", label: "Chiqim", paths: ["/stock/rasxod", "/oluvchi"], actions: ["issue", "issue_storno"] },
    { key: "holat", label: "Sklad holati — xomashyo", inPage: true, notRoles: ["MECHANIC"], actions: [] },
    { key: "hovli", label: "Hovli va tayyor mahsulot", inPage: true, paths: ["/stock/products"], notRoles: ["MECHANIC"], actions: ["products"] },
    { key: "brigada", label: "Brigadalarga berish", inPage: true, actions: ["brigade"] },
    { key: "inventar", label: "Inventarizatsiya va hisobdan chiqarish", paths: ["/stock/inventarizatsiya", "/stock/spisanie"], actions: ["adjust"] },
    { key: "jonatma", label: "Jo'natmalar", paths: ["/jonatma"], actions: ["shipment", "shipment_accept"] },
    { key: "snabjeniye", label: "Snabjeniye", paths: ["/snabjeniye"], actions: [] },
    { key: "yetkazuvchilar", label: "Yetkazuvchilar", paths: ["/suppliers"], actions: ["suppliers"] },
  ],
  taminot: [
    { key: "zayavkalar", label: "Ta'minot zayavkalari", paths: ["/taminot"], actions: ["write"] },
  ],
  mexanik: [
    { key: "sorovlar", label: "Mexanik so'rovlari", paths: ["/mexanik-sorovlar"], actions: ["write"] },
  ],
  payments: [
    { key: "kassa", label: "Kassa / bank", paths: ["/payments"], actions: ["create", "storno", "import"] },
    { key: "pulqabul", label: "Pul qabul qilish", paths: ["/pul-qabul"], actions: ["receive_cash", "receive_bank"] },
    { key: "schyotlar", label: "Schyotlar", paths: ["/invoices"], actions: [] },
  ],
  cashflow: [
    { key: "kirimchiqim", label: "Kirim-chiqim", paths: ["/cashflow"], actions: ["create", "delete", "transfer", "transfer_storno", "close"] },
    { key: "tolash", label: "Yetkazuvchiga to'lash (yetkazuvchi kartasida)", actions: ["pay"] },
  ],
  arenda: [
    { key: "kassa", label: "Arenda kassasi", paths: ["/arenda"], actions: ["create", "storno"] },
    { key: "dokonlar", label: "Do'konlar va oylik hisob", paths: ["/arenda/dokon", "/arenda/import", "/arenda/kvitansiya"], actions: ["shops"] },
  ],
  "kirim-qqs": [
    { key: "reyestr", label: "Kirim QQS reyestri", paths: ["/kirim-qqs"], actions: [] },
  ],
  moliya: [
    { key: "kreditlar", label: "Kreditlar va qarzlar", paths: ["/moliya"], actions: ["loans"] },
    { key: "vositalar", label: "Asosiy vositalar", paths: ["/moliya/asosiy-vositalar"], actions: ["assets"] },
    { key: "kategoriyalar", label: "Kassa kategoriyalari", paths: ["/moliya/kategoriyalar"], actions: ["categories"] },
    { key: "reja", label: "To'lov rejasi va kalendar", paths: ["/moliya/tolov-rejasi", "/moliya/kalendar"], actions: ["plan"] },
    { key: "tannarx", label: "Tannarx sozlamalari (Tahlil oynasida)", actions: ["cost"] },
  ],
  employees: [
    { key: "xodimlar", label: "Xodimlar", paths: ["/employees"], actions: ["create", "edit", "login"] },
    { key: "kadr", label: "Otdel kadr", paths: ["/otdel-kadr"], actions: ["requests", "schedule", "payrules", "checklists", "kpi", "recruit", "onboarding", "training", "voice", "attendance"] },
    { key: "davomat", label: "Davomat sozlamalari", paths: ["/settings/davomat"], actions: ["late_fine"] },
    { key: "taqvim", label: "Ish tartibi va bayramlar", paths: ["/settings/ish-tartibi"], actions: ["calendar"] },
  ],
  payroll: [
    { key: "ishhaqi", label: "Ish haqi", paths: ["/ish-haqi"], actions: ["calc", "settings", "pay", "approve"] },
  ],
  vazifalar: [
    { key: "vazifalar", label: "Vazifalar", paths: ["/vazifalar"], actions: ["assign", "view_all"] },
  ],
  "bi-tahlil": [
    { key: "sotuvlar", label: "Sotuvlar", paths: ["/bi-tahlil/sotuvlar"], actions: [] },
    { key: "moliya", label: "Moliya hisobotlari", paths: ["/bi-tahlil/moliya"], actions: [] },
    { key: "agentlar", label: "Agentlar", paths: ["/bi-tahlil/agentlar"], actions: [] },
    { key: "mijozlar", label: "Debitorka / kreditorka", paths: ["/bi-tahlil/mijozlar"], actions: [] },
    { key: "ombor", label: "Ombor", paths: ["/bi-tahlil/ombor"], actions: [] },
    { key: "logistika", label: "Logistika tahlili", paths: ["/bi-tahlil/logistika"], actions: [] },
    { key: "mexanik", label: "Mexanik tahlili", paths: ["/bi-tahlil/mexanik"], actions: [] },
    { key: "mahsulotlar", label: "Mahsulotlar", paths: ["/bi-tahlil/mahsulotlar"], actions: [] },
    { key: "ishlab", label: "Ishlab chiqarish tahlili", paths: ["/bi-tahlil/ishlab-chiqarish"], actions: [] },
    { key: "marketing", label: "Marketing tahlili", paths: ["/bi-tahlil/marketing"], actions: ["marketing"] },
    { key: "reja", label: "Reja nazorati", paths: ["/bi-tahlil/reja"], actions: ["plan"] },
    { key: "ml", label: "ML tahlil", paths: ["/bi-tahlil/ml"], actions: [] },
    { key: "ai", label: "Insof AI", paths: ["/bi-tahlil/ai"], actions: ["ai"] },
  ],
  opening: [
    { key: "qoldiqlar", label: "Boshlang'ich qoldiqlar", paths: ["/settings/boshlangich-qoldiq"], actions: ["write"] },
  ],
};

export const BTN = "@";
export const isBtnKey = (a: string) => a.startsWith(BTN);
export const btnKey = (button: string) => BTN + button;
/** Tugma alohida oyna (ko'rish huquqi bor) yoki faqat amallar guruhi */
export const hasWindow = (b: PermButton) => !!(b.paths?.length || b.inPage);
export const buttonsOf = (module: string): PermButton[] => PERM_BUTTONS[module] ?? [];

/** Tugma rejimidagi ro'yxat (birorta `@` bor) — oynalar alohida beriladi. */
export function buttonMode(v: PermValue | undefined): v is string[] {
  return Array.isArray(v) && v.some(isBtnKey);
}

const bare = (p: string) => p.split("?")[0];
const under = (path: string, prefix: string) => path === prefix || path.startsWith(prefix + "/");

/** Yo'l modulning qaysi oynasiga tegishli (eng uzun prefiks). Hech biriga tushmasa — undefined. */
export function buttonForPath(module: string, pathname: string): PermButton | undefined {
  const path = bare(pathname);
  let best: { b: PermButton; len: number } | undefined;
  for (const b of buttonsOf(module)) for (const p of b.paths ?? []) {
    if (under(path, p) && (!best || p.length > best.len)) best = { b, len: p.length };
  }
  return best?.b;
}

/** Yo'l perms bo'yicha ochiqmi (modul "none" emasligi alohida tekshiriladi): tugma rejimida — oynasi berilgan bo'lsa. */
export function windowOpen(module: string, pathname: string, lvl: PermValue): boolean {
  if (!buttonMode(lvl)) return true;
  const b = buttonForPath(module, pathname);
  return !b || lvl.includes(btnKey(b.key));
}

/** Amal qaysi tugmaga tegishli */
export function buttonOfAction(module: string, action: string): PermButton | undefined {
  return buttonsOf(module).find((b) => b.actions.includes(action));
}

/**
 * Modul ruxsatini o'qiladigan matnga: tugma rejimida "Kirim (kirim qabul qilish), Chiqim",
 * eski ro'yxatda — amallar. Audit, bildirishnoma va Ruxsatlar ro'yxatidagi belgilar uchun.
 */
export function describeModuleValue(module: string, v: PermValue): string {
  if (v === "none") return "yopiq";
  if (v === "view") return "faqat ko'rish";
  if (v === "write") return "to'liq";
  const act = (a: string) => actionDef(module, a)?.label ?? a;
  if (!v.some(isBtnKey)) return `ko'rish${v.length ? " + " + v.map(act).join(", ") : ""}`;
  const all = buttonsOf(module);
  const parts = all.flatMap((b) => {
    const acts = b.actions.filter((a) => v.includes(a)).map(act);
    if (hasWindow(b) && !v.includes(btnKey(b.key))) return [];
    if (!hasWindow(b) && !acts.length) return [];
    const what = acts.length ? acts.join(", ") : "ko'rish";
    return [all.length === 1 ? what : `${b.label} — ${what}`]; // yagona oynali modulda oyna nomi takrorlanmaydi
  });
  return parts.length ? parts.join("; ") : "yopiq";
}

/** Katalog butunligi: har topshiriladigan amal aynan bitta tugmada (QA va dev tekshiruvi uchun). */
export function catalogProblems(): string[] {
  const out: string[] = [];
  for (const [m, defs] of Object.entries(MODULE_ACTIONS)) {
    for (const a of defs) {
      const n = buttonsOf(m).filter((b) => b.actions.includes(a.key)).length;
      if (n !== 1) out.push(`${m}.${a.key}: ${n} ta tugmada`);
    }
    if (!buttonsOf(m).length) out.push(`${m}: tugma yo'q`);
  }
  for (const [m, bs] of Object.entries(PERM_BUTTONS)) for (const b of bs) {
    for (const a of b.actions) if (!actionDef(m, a)) out.push(`${m}.${b.key}: «${a}» katalogda yo'q`);
    if (!/^[a-z_]{1,31}$/.test(b.key)) out.push(`${m}.${b.key}: kalit faqat a-z va _`);
  }
  return out;
}
