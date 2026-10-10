import type { Role } from "@/generated/prisma";
import type { Perms, Session } from "./auth";

export type NavChild = { href: string; label: string };
/**
 * `hidden` — menyuda ko'rinmaydi, lekin middleware ruxsatni shu yerdan tekshiradi (havola bo'yicha ochiladi).
 * `menuFor` — menyuda faqat shu rollarga ko'rinadi (direktor ham kirmaydi); boshqalar sahifani bo'lim tablari orqali
 * ochadi (`components/section-tabs.tsx`). Ruxsat (`roles`) o'zgarmaydi.
 */
export type NavItem = { href: string; label: string; roles: Role[] | "all"; group: string; children?: NavChild[]; hidden?: boolean; menuFor?: Role[] };

const BI_ROLES: Role[] = ["DIRECTOR", "FINANCE", "ACCOUNTING"];
/** Logistika rahbari va dispetcher — bizda bitta LOGISTICS roli (TZ 15: Logistics Director + Dispatcher). */
const LOGI: Role[] = ["LOGISTICS"];

export const NAV: NavItem[] = [
  { href: "/dashboard",   label: "Bosh sahifa",        roles: "all", group: "Asosiy" },
  { href: "/orders",      label: "Zayavkalar",         roles: ["SALES", "PRODUCTION", "SUPERVISOR", "LOGISTICS", "ACCOUNTING", "FINANCE"], group: "Sotuv" },
  { href: "/sales",       label: "Sotuv",              roles: ["SALES", "PRODUCTION", "LOGISTICS", "ACCOUNTING", "FINANCE"], group: "Sotuv" },
  { href: "/customers",   label: "Mijozlar",           roles: ["SALES", "ACCOUNTING", "FINANCE"], group: "Sotuv" },
  // Sotuv agenti — o'z mijozlari, ularning qarzi va o'z mijoziga zayavka. AGENT uchun yagona sahifa
  // (DRIVER/BRIGADIER kabi). DIRECTOR/HR/SALES — mijozni agentga biriktirish uchun shu sahifaga kiradi.
  { href: "/agent",       label: "Sotuv agentlari",    roles: ["AGENT", "HR", "SALES"], group: "Sotuv" },
  // Saytdagi (`/`) formadan tushgan so'rovlar — mijozga aylantirilgandan keyingina Customer yaratiladi
  { href: "/leads",       label: "Sayt arizalari",     roles: ["SALES"], group: "Sotuv" },
  // Insof ECO ilovasidagi do'kon: qaysi mahsulot ko'rinadi, surat/narx, ilovadan tushgan buyurtmalar
  { href: "/e-commerce",  label: "E-commerce",         roles: ["SALES"], group: "Sotuv" },
  { href: "/production",  label: "Ishlab chiqarish",   roles: ["PRODUCTION", "SUPERVISOR"], group: "Ishlab chiqarish" },
  { href: "/recipes",     label: "Retseptlar",         roles: ["PRODUCTION"], group: "Ishlab chiqarish" },
  { href: "/tasks",       label: "Topshiriqlar",       roles: ["SUPERVISOR", "PRODUCTION", "SALES", "LOGISTICS"], group: "Ishlab chiqarish" },
  { href: "/brigades",    label: "Brigadalar",         roles: ["SUPERVISOR", "PRODUCTION", "HR", "SALES"], group: "Ishlab chiqarish" },
  // ── Logistika kabineti (Biton Logistika TZ, 2-bo'lim). Bosh sahifa — /dashboard (LOGISTICS uchun logistika paneli) ──
  { href: "/logistika/buyurtmalar", label: "Buyurtmalar",        roles: LOGI, group: "Logistika" },
  { href: "/trips",                 label: "Reyslar",            roles: ["LOGISTICS", "PRODUCTION", "SUPERVISOR", "MECHANIC"], group: "Logistika" },
  { href: "/logistika/kalendar",    label: "Dispetcher kalendari", roles: LOGI, group: "Logistika" },
  { href: "/logistika/transport",   label: "Transport",          roles: [...LOGI, "MECHANIC"], group: "Logistika" },
  { href: "/logistika/haydovchilar", label: "Haydovchilar",      roles: LOGI, group: "Logistika" },
  { href: "/logistika/obyektlar",   label: "Obyektlar",          roles: [...LOGI, "SALES"], group: "Logistika" },
  { href: "/logistika/monitoring",  label: "GPS / Monitoring",   roles: [...LOGI, "PRODUCTION", "SUPERVISOR"], group: "Logistika" },
  // Bir vazifadagi sahifalar menyuda bitta band, qolganlari shu bandning tablarida (SECTION_TABS):
  // Reyslar ⇢ Nakladnoylar, Yetkazib berish; Transport ⇢ Yoqilg'i, Xarajatlar; Hisobotlar ⇢ Analitika; Haydovchilar ⇢ ECO ilovasi.
  // Buxgalteriya Reyslar/Transport'ga kirmaydi — unga o'z bandlari menyuda qoladi.
  { href: "/logistika/nakladnoylar", label: "Nakladnoylar",      roles: [...LOGI, "ACCOUNTING"], group: "Logistika", menuFor: ["ACCOUNTING"] },
  { href: "/logistika/yetkazish",   label: "Yetkazib berish",    roles: [...LOGI, "ACCOUNTING"], group: "Logistika", menuFor: ["ACCOUNTING"] },
  // Logistika buxgalteri (TZ 15) — bizda Buxgalteriya roli: yoqilg'i, xarajat, hisobot
  { href: "/logistika/yoqilgi",     label: "Yoqilg'i",           roles: [...LOGI, "ACCOUNTING"], group: "Logistika", menuFor: ["ACCOUNTING"] },
  { href: "/logistika/xarajatlar",  label: "Transport xarajatlari", roles: [...LOGI, "ACCOUNTING"], group: "Logistika", menuFor: ["ACCOUNTING"] },
  { href: "/logistika/hisobotlar",  label: "Hisobotlar",         roles: [...LOGI, "ACCOUNTING"], group: "Logistika" },
  { href: "/logistika/analitika",   label: "Analitika",          roles: [...LOGI, "ACCOUNTING"], group: "Logistika", menuFor: [] },
  { href: "/logistika/sozlamalar",  label: "Logistika sozlamalari", roles: LOGI, group: "Logistika" },
  // Sklad: xomashyo qoldig'i + "Ishlab chiqarish imkoni" ichida hovlidagi dona mahsulot va tayyor beton (eski Astatka shu yerga ko'chdi)
  { href: "/stock",       label: "Sklad",              roles: ["WAREHOUSE", "PROCUREMENT", "PRODUCTION", "ACCOUNTING", "SALES", "LOGISTICS", "MECHANIC"], group: "Sklad" },
  // Snabjeniye oynasi — Sklad bandining ostida: sklad so'roviga narx qo'yiladi, kelgan mol qabul qilinadi
  { href: "/snabjeniye",  label: "Snabjeniye",         roles: ["WAREHOUSE", "PROCUREMENT"], group: "Sklad" },
  // Ta'minot zayavkalari — ma'sul (zayavka) xodim tasdiqlaydi; zanjirdagi boshqa bo'limlar holatini ko'radi
  { href: "/taminot",     label: "Ta'minot zayavkalari", roles: ["WAREHOUSE", "PROCUREMENT", "PRODUCTION"], group: "Sklad" },
  // Hujjatning o'zi zanjirdagi hamma bo'limga ochiq (Zayavkalar va Kirim-Chiqimdagi "To'liq hujjat" havolasi)
  { href: "/taminot/",    label: "Ta'minot hujjati",     roles: ["SALES", "WAREHOUSE", "PROCUREMENT", "PRODUCTION", "FINANCE", "ACCOUNTING", "CASHIER"], group: "Sklad", hidden: true },
  { href: "/receipts",    label: "Kirim",              roles: ["WAREHOUSE", "PROCUREMENT", "SALES"], group: "Sklad" }, // SALES — faqat ko'radi (kim, nima, qancha kiritgan)
  { href: "/suppliers",   label: "Yetkazuvchilar",     roles: ["WAREHOUSE", "PROCUREMENT", "ACCOUNTING"], group: "Sklad" },
  // Schyotlar menyudan olib tashlandi — sahifa va eski schyotlar joyida (to'lovlar shularga bog'langan)
  { href: "/invoices",    label: "Schyotlar",          roles: ["ACCOUNTING", "FINANCE", "SALES"], group: "Sotuv", hidden: true },
  { href: "/payments",    label: "Kassa / bank",       roles: ["CASHIER", "ACCOUNTING", "FINANCE"], group: "Moliya" },
  { href: "/cashflow",    label: "Kirim-Chiqim",       roles: ["CASHIER", "ACCOUNTING", "FINANCE"], group: "Moliya" },
  // Kirim QQS reyestri (oy va yetkazuvchi kesimida QQS'siz summa, QQS, jami) — buxgalteriya hisobotlari uchun
  { href: "/kirim-qqs",   label: "Kirim QQS",          roles: ["ACCOUNTING", "FINANCE"], group: "Moliya" },
  // Tizimga o'tish sanasidagi qoldiqlar (mijoz/yetkazuvchi qarzi, kassa, tayyor mahsulot) — kiritish direktor va buxgalteriya;
  // Finance ko'radi va yetkazuvchining boshlang'ich qarzini to'laydi ("Yetkazuvchiga to'lash" huquqi — shu sahifada).
  // /settings ostida bo'lsa ham alohida band: eng uzun prefiks qoidasi bo'yicha shu rollarga ochiq, qolgan sozlamalar yopiq.
  { href: "/settings/boshlangich-qoldiq", label: "Boshlang'ich qoldiqlar", roles: ["ACCOUNTING", "FINANCE"], group: "Moliya" },
  // Otdel kadr bo'limi: sahifaning tablari bevosita menyuda turadi — ichida yana "Otdel kadr" bandi bo'lmaydi.
  // Birinchisi sahifaning o'zi (`?tab` siz ochilganda xodimlar ro'yxati chiqadi) — middleware ruxsatni shu yo'ldan tekshiradi.
  { href: "/otdel-kadr",                label: "Xodimlar ro'yxati", roles: ["HR"], group: "Otdel kadr" },
  { href: "/otdel-kadr?tab=lavozimlar", label: "Ishchi lavozimlar", roles: ["HR"], group: "Otdel kadr" },
  { href: "/otdel-kadr?tab=bolimlar",   label: "Bo'limlar",         roles: ["HR"], group: "Otdel kadr" },
  { href: "/otdel-kadr?tab=davomat",    label: "Davomat",           roles: ["HR"], group: "Otdel kadr" },
  { href: "/otdel-kadr?tab=taqvim",     label: "Kadr taqvimi",      roles: ["HR"], group: "Otdel kadr" },
  { href: "/employees",   label: "Xodimlar",           roles: ["HR", "LOGISTICS"], group: "Boshqaruv" },
  // Haydovchi ERP'ga kirsa faqat shu sahifani ko'radi — o'zining reyslari (qolgan bo'limlar yopiq)
  { href: "/mening-reyslarim", label: "Mening reyslarim", roles: ["DRIVER"], group: "Logistika", menuFor: ["DRIVER"] },
  // Brigadir ham xuddi shunday: vebda faqat o'z brigadasiga tayinlangan topshiriqlar
  { href: "/mening-topshiriqlarim", label: "Mening topshiriqlarim", roles: ["BRIGADIER"], group: "Ishlab chiqarish", menuFor: ["BRIGADIER"] },
  // Logistika uchun — Haydovchilar tabida; otdel kadrga menyuda qoladi (logistika haydovchilari sahifasi unga yopiq)
  { href: "/drivers",     label: "Haydovchi ilovasi (ECO)", roles: ["LOGISTICS", "HR"], group: "Logistika", menuFor: ["HR"] },
  // ── Tahlil (Team24 BI tuzilmasi) ──
  { href: "/bi-tahlil",                  label: "BI tahlil",        roles: BI_ROLES, group: "Tahlil" },
  { href: "/bi-tahlil/sotuvlar",         label: "Sotuvlar",         roles: BI_ROLES, group: "Tahlil", children: [{ href: "/bi-tahlil/sotuvlar/bekor", label: "Bekor qilinganlar" }] },
  { href: "/bi-tahlil/agentlar",         label: "Agentlar",         roles: BI_ROLES, group: "Tahlil" },
  { href: "/bi-tahlil/mijozlar",         label: "Mijozlar",         roles: BI_ROLES, group: "Tahlil" },
  { href: "/bi-tahlil/ombor",            label: "Ombor",            roles: BI_ROLES, group: "Tahlil" },
  { href: "/bi-tahlil/mahsulotlar",      label: "Mahsulotlar",      roles: BI_ROLES, group: "Tahlil" },
  { href: "/bi-tahlil/ishlab-chiqarish", label: "Ishlab chiqarish", roles: BI_ROLES, group: "Tahlil" },
  { href: "/bi-tahlil/marketing",        label: "Marketing",        roles: BI_ROLES, group: "Tahlil", children: [{ href: "/bi-tahlil/marketing/reja", label: "Marketing reja nazorati" }, { href: "/bi-tahlil/marketing/malumotlar", label: "Marketing ma'lumotlari" }] },
  { href: "/bi-tahlil/reja",             label: "Reja nazorati",    roles: BI_ROLES, group: "Tahlil" },
  { href: "/bi-tahlil/moliya",           label: "Moliya",           roles: BI_ROLES, group: "Tahlil" },
  { href: "/bi-tahlil/ml",               label: "ML tahlil",        roles: BI_ROLES, group: "Tahlil", children: [{ href: "/bi-tahlil/ml/anomaliyalar", label: "Anomaliyalar" }, { href: "/bi-tahlil/ml/churn", label: "Churn tahlili" }, { href: "/bi-tahlil/ml/klasterlar", label: "Klasterlar" }] },
  { href: "/bi-tahlil/ai",               label: "Insof AI",         roles: BI_ROLES, group: "Tahlil", children: [{ href: "/bi-tahlil/ai/chat", label: "AI Chat" }, { href: "/bi-tahlil/ai/telegram", label: "Telegram bot" }] },
  // Insof ECO ilovasida ro'yxatdan o'tgan hamma (tadbirkor, quruvchi, haydovchi) — faqat direktor
  { href: "/ilova-foydalanuvchilari", label: "Ilova foydalanuvchilari", roles: ["DIRECTOR"], group: "Boshqaruv" },
  { href: "/settings",    label: "Sozlamalar",         roles: ["DIRECTOR"], group: "Boshqaruv" },
];

/**
 * Vebda faqat bitta sahifasi bor rollar — asosiy ish joyi Insof ECO ilovasi.
 * Middleware shu jadval bo'yicha yo'naltiradi, menyu esa umumiy bandlarni olib tashlaydi.
 */
/**
 * Har qanday rolga (shu jumladan "faqat o'z sahifasi" rollariga) ochiq yo'llar:
 * qo'llanma va "Mening hisobim" (login/parolni o'zi o'zgartirish).
 */
export const ALWAYS_OPEN = ["/qollanma", "/hisobim"] as const;
export const alwaysOpen = (pathname: string) => ALWAYS_OPEN.some((p) => pathname === p || pathname.startsWith(`${p}/`) || pathname.startsWith(`${p}?`));

export const OWN_PAGE_ONLY: Partial<Record<Role, string>> = {
  DRIVER: "/mening-reyslarim",
  BRIGADIER: "/mening-topshiriqlarim",
  // Sotuv agenti ham ko'chada ishlaydi: vebda faqat o'z kabineti (o'z mijozlari + zayavka ochish)
  AGENT: "/agent",
};

export const ROLE_LABELS: Record<Role, string> = {
  DIRECTOR: "Direktor",
  AGENT: "Sotuv agenti",
  SALES: "Sotuv",
  PRODUCTION: "Ishlab chiqarish",
  SUPERVISOR: "Ish boshqaruvchi",
  LOGISTICS: "Logistika",
  WAREHOUSE: "Sklad",
  PROCUREMENT: "Snabjeniye",
  ACCOUNTING: "Buxgalteriya",
  FINANCE: "Finance (eski bo'lim)",
  HR: "Otdel kadr",
  CASHIER: "Kassa / bank",
  MECHANIC: "Mexanik",
  DRIVER: "Haydovchi",
  BRIGADIER: "Brigadir",
  SUPERADMIN: "IT superadmin",
};

/**
 * Yo'l darajasidagi ruxsat: yo'l NAV'dagi qaysi bo'limga tegishli bo'lsa, shu rollar kiradi.
 * Middleware (sahifa) ham, fayl beruvchi marshrutlar ham shu qoidadan foydalanadi —
 * ikki joyda ikki xil ro'yxat bo'lib qolmasin.
 *
 * `perms` — direktor bergan modul ruxsati (ixtiyoriy): yo'l modulga tegishli bo'lsa va perms'da shu
 * modul uchun qiymat bo'lsa, u KO'RISH huquqini rol o'rniga aniqlaydi ("none" — yopiq, aks holda ochiq).
 */
export function pathAllowed(pathname: string, role: Role, perms?: Perms) {
  if (role === "DIRECTOR") return true;
  // Modul ruxsati rol ustiga ishlaydi: direktor berib qo'ygan bo'lsa shu hal qiladi (grant yoki restrict)
  const mod = moduleForPath(pathname);
  const lvl = mod && perms?.[mod];
  if (lvl) return lvl !== "none";
  const item = NAV.filter((i) => pathname.startsWith(i.href)).sort((a, b) => b.href.length - a.href.length)[0];
  // Default-deny: NAV'da ro'yxatga olinmagan yo'l faqat direktorga ochiq (fail-open emas).
  // Istisno — ALWAYS_OPEN (qo'llanma, o'z hisobi). Yangi sahifa qo'shilganda uni NAV'ga kiritish shart.
  if (!item) return alwaysOpen(pathname);
  return item.roles === "all" || item.roles.includes(role);
}

export function navFor(role: Role, perms?: Perms) {
  const items = NAV.filter((i) => {
    if (i.hidden) return false;
    if (i.menuFor && !i.menuFor.includes(role)) return false;
    if (i.roles === "all") return true;
    // Modul ruxsati rol o'rniga: granted modul rol ko'rmasa ham menyuda chiqadi, "none" esa yashiriladi
    const mod = moduleForPath(i.href);
    const lvl = mod && perms?.[mod];
    if (lvl) return lvl !== "none";
    return role === "DIRECTOR" || i.roles.includes(role);
  });
  // Haydovchi, brigadir va sotuv agenti vebda faqat o'z sahifasini ko'radi — umumiy bandlar (Bosh sahifa) menyuda turmaydi
  return OWN_PAGE_ONLY[role] ? items.filter((i) => i.roles !== "all") : items;
}

/* ───────────────────────── Modul bo'yicha ruxsat (User.perms) ─────────────────────────
 *
 * Modul = asosiy bo'lim. Direktor har foydalanuvchiga modul bo'yicha "yo'q / ko'rish / yozish"
 * belgilaydi; bu rol ruxsatining USTIGA ishlaydi. Perms'da modul berilmagan bo'lsa — avvalgidek rol bo'yicha.
 *
 * Modul ichidagi aniq amallar (zayavka ochish, qabul qilish...) — `lib/permissions.ts` (MODULE_ACTIONS, canDo).
 * Masalan "orders" ga ["create"] berilgan Ishlab chiqarish xodimi zayavkani ko'radi va ochadi, lekin qabul qila olmaydi.
 */
export const MODULES: { key: string; label: string; prefixes: string[] }[] = [
  { key: "orders",    label: "Zayavkalar",            prefixes: ["/orders"] },
  { key: "sales",     label: "Sotuv va arizalar",     prefixes: ["/sales", "/leads", "/e-commerce"] },
  { key: "customers", label: "Mijozlar",              prefixes: ["/customers"] },
  { key: "production",label: "Ishlab chiqarish",      prefixes: ["/production", "/recipes"] },
  { key: "tasks",     label: "Topshiriq / brigada",   prefixes: ["/tasks", "/brigades"] },
  { key: "trips",     label: "Reyslar / haydovchi",   prefixes: ["/trips", "/drivers"] },
  { key: "logistika", label: "Logistika",             prefixes: ["/logistika"] },
  { key: "stock",     label: "Sklad",                 prefixes: ["/stock", "/snabjeniye", "/receipts", "/suppliers"] },
  { key: "taminot",   label: "Ta'minot zayavkalari",  prefixes: ["/taminot"] },
  { key: "payments",  label: "Kassa / schyot",        prefixes: ["/payments", "/invoices"] },
  { key: "cashflow",  label: "Kirim-chiqim",          prefixes: ["/cashflow"] },
  { key: "kirim-qqs", label: "Kirim QQS reyestri",    prefixes: ["/kirim-qqs"] },
  { key: "employees", label: "Xodimlar / kadr",       prefixes: ["/employees", "/otdel-kadr"] },
  { key: "bi-tahlil", label: "BI tahlil",             prefixes: ["/bi-tahlil"] },
  // Sozlamalar ostidagi yagona modul: boshlang'ich qoldiqlar pulga ta'sir qiladi — direktor yopa/ocha olsin
  { key: "opening",   label: "Boshlang'ich qoldiqlar", prefixes: ["/settings/boshlangich-qoldiq"] },
];

/** Yo'l qaysi modulga tegishli (eng uzun mos prefiks). Modulga kirmagan yo'l (dashboard, settings, agent) — null. */
export function moduleForPath(pathname: string): string | null {
  let best: { key: string; len: number } | null = null;
  for (const m of MODULES) {
    for (const p of m.prefixes) {
      if ((pathname === p || pathname.startsWith(p + "/") || pathname.startsWith(p + "?")) && (!best || p.length > best.len)) {
        best = { key: m.key, len: p.length };
      }
    }
  }
  return best?.key ?? null;
}

/** Rol modulni odatda ko'radimi (perms yo'q holat uchun asos) — NAV ro'yxatidan hisoblanadi. */
function roleHasModule(role: Role, module: string): boolean {
  if (role === "DIRECTOR") return true;
  const prefixes = MODULES.find((m) => m.key === module)?.prefixes ?? [];
  return NAV.some((i) => prefixes.some((p) => i.href.startsWith(p)) && i.roles !== "all" && (i.roles as Role[]).includes(role));
}

/** Modulni KO'RISH huquqi: perms bergan bo'lsa shu, aks holda rol bo'yicha. */
export function canView(session: Pick<Session, "role" | "perms">, module: string): boolean {
  if (session.role === "DIRECTOR") return true;
  const lvl = session.perms?.[module];
  if (lvl) return lvl !== "none";
  return roleHasModule(session.role, module);
}

/**
 * Modulga YOZISH huquqi (zayavka ochish/qabul qilish, to'lov kiritish, sklad harakati...).
 * perms bergan bo'lsa — faqat "write" yozdiradi; aks holda rol moduli bo'yicha avvalgidek
 * (ya'ni modulni ko'rsa yoza ham olardi — perms kiritilmaguncha xulq o'zgarmaydi).
 */
export function canWrite(session: Pick<Session, "role" | "perms">, module: string): boolean {
  if (session.role === "DIRECTOR") return true;
  const lvl = session.perms?.[module];
  if (Array.isArray(lvl)) return lvl.length > 0; // tanlangan amallar — aniq amal `canDo` bilan tekshiriladi
  if (lvl) return lvl === "write";
  return roleHasModule(session.role, module);
}
