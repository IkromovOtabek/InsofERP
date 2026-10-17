import type { Role } from "@/generated/prisma";
import type { Perms, Session } from "./auth";

export type NavChild = { href: string; label: string };
/**
 * `hidden` — menyuda ko'rinmaydi, lekin middleware ruxsatni shu yerdan tekshiradi (havola bo'yicha ochiladi).
 * `menuFor` — menyuda faqat shu rollarga ko'rinadi (direktor ham kirmaydi); boshqalar sahifani bo'lim tablari orqali
 * ochadi (`components/section-tabs.tsx`). Ruxsat (`roles`) o'zgarmaydi.
 * `menuHide` — shu rollarning veb menyusida ko'rinmaydi, lekin ruxsat qoladi: boshqa sahifadagi havolalar,
 * Insof ECO ilovasi va amal huquqlari (`canDo`) o'zgarmaydi. Direktor modulni ruxsat bilan bergan bo'lsa — menyuda chiqadi.
 * Kabinet menyusida faqat o'z bo'limining ishi tursin: boshqa bo'lim sahifasi rolga ilova yoki havola uchun berilgan bo'lsa — shu yerga.
 */
export type NavItem = { href: string; label: string; roles: Role[] | "all"; group: string; children?: NavChild[]; hidden?: boolean; menuFor?: Role[]; menuHide?: Role[] };

const BI_ROLES: Role[] = ["DIRECTOR", "FINANCE", "ACCOUNTING"];
/** Logistika rahbari va dispetcher — bizda bitta LOGISTICS roli (TZ 15: Logistics Director + Dispatcher). */
const LOGI: Role[] = ["LOGISTICS"];

export const NAV: NavItem[] = [
  { href: "/dashboard",   label: "Bosh sahifa",        roles: "all", group: "Asosiy" },
  // Umumiy vazifalar — har bir xodim (o'ziga / rahbar beradi), `lib/hr/tasks.ts`
  { href: "/vazifalar",   label: "Vazifalar",          roles: "all", group: "Asosiy" },
  { href: "/orders",      label: "Zayavkalar",         roles: ["SALES", "PRODUCTION", "SUPERVISOR", "LOGISTICS", "ACCOUNTING", "FINANCE"], group: "Sotuv" },
  { href: "/sales",       label: "Sotuv",              roles: ["SALES", "PRODUCTION", "LOGISTICS", "ACCOUNTING", "FINANCE"], group: "Sotuv", menuHide: ["PRODUCTION", "LOGISTICS"] },
  // Buxgalteriya kabinetida Mijozlar bandi yo'q (veb va ECO) — ruxsat qoladi: schyot, to'lov, qarzdorlar havolalaridan ochiladi
  { href: "/customers",   label: "Mijozlar",           roles: ["SALES", "ACCOUNTING", "FINANCE"], group: "Sotuv", menuHide: ["ACCOUNTING"] },
  // Sotuv agenti — o'z mijozlari, ularning qarzi va o'z mijoziga zayavka. AGENT uchun yagona sahifa
  // (DRIVER/BRIGADIER kabi). DIRECTOR/HR/SALES — mijozni agentga biriktirish uchun shu sahifaga kiradi.
  // Otdel kadr kabinetida Sotuv guruhi yo'q — ruxsat ilova (ECO) va havolalar uchun qoladi.
  { href: "/agent",       label: "Sotuv agentlari",    roles: ["AGENT", "HR", "SALES"], group: "Sotuv", menuHide: ["HR"] },
  // Saytdagi (`/`) formadan tushgan so'rovlar — mijozga aylantirilgandan keyingina Customer yaratiladi
  { href: "/leads",       label: "Sayt arizalari",     roles: ["SALES"], group: "Sotuv" },
  // Tijorat takliflari (KP) — rasmiy narx hujjati, zayavkasiz ham tuziladi; QR → ommaviy /taklif/<№>. Boshqa xodimga direktor «offers» moduli orqali beradi
  { href: "/takliflar",   label: "Tijorat takliflari", roles: ["SALES", "ACCOUNTING"], group: "Sotuv", menuHide: ["ACCOUNTING"] },
  // Insof ECO ilovasidagi do'kon: qaysi mahsulot ko'rinadi, surat/narx, ilovadan tushgan buyurtmalar
  { href: "/e-commerce",  label: "E-commerce",         roles: ["SALES"], group: "Sotuv" },
  // Marketing: statistika va AI tavsiyalar, kontent reja, AI studiya (g'oya → ssenariy, matn, video), media, target, sozlamalar
  // Guruh nomi «Marketing» — bandlar ichma-ich emas, to'g'ridan-to'g'ri (aks holda menyuda «Marketing → Marketing»)
  { href: "/marketing",            label: "Statistika",      roles: ["SALES"], group: "Marketing" },
  { href: "/marketing/kontent",    label: "Kontent reja",    roles: ["SALES"], group: "Marketing" },
  { href: "/marketing/studiya",    label: "AI studiya",      roles: ["SALES"], group: "Marketing" },
  { href: "/marketing/media",      label: "Media kutubxona", roles: ["SALES"], group: "Marketing" },
  { href: "/marketing/target",     label: "Target",          roles: ["SALES"], group: "Marketing" },
  { href: "/marketing/sozlamalar", label: "Sozlamalar",      roles: ["SALES"], group: "Marketing" },
  { href: "/production",  label: "Ishlab chiqarish",   roles: ["PRODUCTION", "SUPERVISOR"], group: "Ishlab chiqarish" },
  { href: "/recipes",     label: "Retseptlar",         roles: ["PRODUCTION"], group: "Ishlab chiqarish" },
  // Sotuv, Logistika va Otdel kadr kabinetida Ishlab chiqarish guruhi yo'q (ruxsat ECO ilovasi va havolalar uchun)
  { href: "/tasks",       label: "Topshiriqlar",       roles: ["SUPERVISOR", "PRODUCTION", "SALES", "LOGISTICS"], group: "Ishlab chiqarish", menuHide: ["SALES", "LOGISTICS"] },
  { href: "/brigades",    label: "Brigadalar",         roles: ["SUPERVISOR", "PRODUCTION", "HR", "SALES"], group: "Ishlab chiqarish", menuHide: ["HR", "SALES"] },
  // ── Logistika kabineti (Biton Logistika TZ, 2-bo'lim). Bosh sahifa — /dashboard (LOGISTICS uchun logistika paneli) ──
  { href: "/logistika/buyurtmalar", label: "Buyurtmalar",        roles: LOGI, group: "Logistika" },
  { href: "/trips",                 label: "Reyslar",            roles: ["LOGISTICS", "PRODUCTION", "SUPERVISOR", "MECHANIC"], group: "Logistika" },
  { href: "/logistika/kalendar",    label: "Dispetcher kalendari", roles: LOGI, group: "Logistika" },
  { href: "/logistika/transport",   label: "Transport",          roles: [...LOGI, "MECHANIC"], group: "Logistika" },
  // Mexanik so'rovlari ("Kirim"): mexanik pul so'raydi → ish boshqaruvchi tasdiqlaydi → kassa beradi (`lib/mechanic-requests.ts`)
  { href: "/mexanik-sorovlar",      label: "Mexanik so'rovlari", roles: ["MECHANIC", "SUPERVISOR", "CASHIER"], group: "Logistika" },
  { href: "/logistika/haydovchilar", label: "Haydovchilar",      roles: LOGI, group: "Logistika" },
  // Sotuvda mijoz obyekti mijoz kartasidan ochiladi; GPS — logistika ishi (sex Reyslar'dagi jonli xaritani ko'radi)
  { href: "/logistika/obyektlar",   label: "Obyektlar",          roles: [...LOGI, "SALES"], group: "Logistika", menuHide: ["SALES"] },
  { href: "/logistika/monitoring",  label: "GPS / Monitoring",   roles: [...LOGI, "PRODUCTION", "SUPERVISOR"], group: "Logistika", menuHide: ["PRODUCTION", "SUPERVISOR"] },
  // Bir vazifadagi sahifalar menyuda bitta band, qolganlari shu bandning tablarida (SECTION_TABS):
  // Reyslar ⇢ Nakladnoylar, Yetkazib berish; Transport ⇢ Yoqilg'i, Xarajatlar; Hisobotlar ⇢ Analitika; Haydovchilar ⇢ ECO ilovasi.
  // Buxgalteriya kabinetida Logistika guruhi yo'q (veb va ECO): ruxsat qoladi — sahifalar havola va bo'lim tablari orqali ochiladi.
  { href: "/logistika/nakladnoylar", label: "Nakladnoylar",      roles: [...LOGI, "ACCOUNTING"], group: "Logistika", menuFor: [] },
  { href: "/logistika/yetkazish",   label: "Yetkazib berish",    roles: [...LOGI, "ACCOUNTING"], group: "Logistika", menuFor: [] },
  // Logistika buxgalteri (TZ 15) — bizda Buxgalteriya roli: yoqilg'i, xarajat, hisobot
  { href: "/logistika/yoqilgi",     label: "Yoqilg'i",           roles: [...LOGI, "ACCOUNTING"], group: "Logistika", menuFor: [] },
  { href: "/logistika/xarajatlar",  label: "Transport xarajatlari", roles: [...LOGI, "ACCOUNTING"], group: "Logistika", menuFor: [] },
  { href: "/logistika/hisobotlar",  label: "Hisobotlar",         roles: [...LOGI, "ACCOUNTING"], group: "Logistika", menuHide: ["ACCOUNTING"] },
  { href: "/logistika/analitika",   label: "Analitika",          roles: [...LOGI, "ACCOUNTING"], group: "Logistika", menuFor: [] },
  { href: "/logistika/sozlamalar",  label: "Logistika sozlamalari", roles: LOGI, group: "Logistika" },
  // Sklad: xomashyo qoldig'i + "Ishlab chiqarish imkoni" ichida hovlidagi dona mahsulot va tayyor beton (eski Astatka shu yerga ko'chdi)
  { href: "/stock",       label: "Sklad",              roles: ["WAREHOUSE", "PROCUREMENT", "PRODUCTION", "ACCOUNTING", "SALES", "LOGISTICS", "MECHANIC"], group: "Sklad", menuHide: ["LOGISTICS"] },
  // Oluvchi kartasi (brigada / xodim / erkin oluvchi): skladdan nima olgan, qo'lida nima bor, samaradorlik. Menyuda yo'q —
  // Chiqim jurnalidagi «Kimga» nomidan ochiladi. Ish boshqaruvchi ham ko'radi (sklad bo'limining o'zi unga yopiq)
  { href: "/oluvchi",     label: "Oluvchi kartasi",    roles: ["WAREHOUSE", "PROCUREMENT", "PRODUCTION", "SUPERVISOR", "ACCOUNTING"], group: "Sklad", hidden: true },
  // Snabjeniye oynasi — Sklad bandining ostida: sklad so'roviga narx qo'yiladi, kelgan mol qabul qilinadi.
  // Sklad kabinetida ham menyuda: sklad xodimi ba'zi mollarni o'zi olib keladi (narx qo'yadi, sotib oladi, qabul qiladi)
  { href: "/snabjeniye",  label: "Snabjeniye",         roles: ["WAREHOUSE", "PROCUREMENT"], group: "Sklad", menuFor: ["PROCUREMENT", "WAREHOUSE", "DIRECTOR"] },
  // Ta'minot zayavkalari — ma'sul (zayavka) xodim tasdiqlaydi; zanjirdagi boshqa bo'limlar holatini ko'radi.
  // Sklad menyusida yo'q — u so'rovni Sklad → «Kerakli mahsulotlar» dan jo'natadi, hujjatga bildirishnoma/havoladan kiradi
  { href: "/taminot",     label: "Ta'minot zayavkalari", roles: ["WAREHOUSE", "PROCUREMENT", "PRODUCTION"], group: "Sklad", menuFor: ["PROCUREMENT", "PRODUCTION", "DIRECTOR"] },
  // Hujjatning o'zi zanjirdagi hamma bo'limga ochiq (Zayavkalar va Kirim-Chiqimdagi "To'liq hujjat" havolasi)
  { href: "/taminot/",    label: "Ta'minot hujjati",     roles: ["SALES", "WAREHOUSE", "PROCUREMENT", "PRODUCTION", "FINANCE", "ACCOUNTING", "CASHIER"], group: "Sklad", hidden: true },
  { href: "/receipts",    label: "Kirim",              roles: ["WAREHOUSE", "PROCUREMENT", "SALES"], group: "Sklad" }, // SALES — faqat ko'radi (kim, nima, qancha kiritgan)
  { href: "/suppliers",   label: "Yetkazuvchilar",     roles: ["WAREHOUSE", "PROCUREMENT", "ACCOUNTING"], group: "Sklad" },
  // Schyotlar menyudan olib tashlandi — sahifa va eski schyotlar joyida (to'lovlar shularga bog'langan)
  { href: "/invoices",    label: "Schyotlar",          roles: ["ACCOUNTING", "FINANCE", "SALES"], group: "Sotuv", hidden: true },
  // Zayavka bosh to'lovi so'rovlari (PS-…): naqd — kassir, perechisleniye — buxgalter qabul qiladi; Finance faqat ko'radi
  { href: "/pul-qabul",   label: "Pul qabul qilish",   roles: ["CASHIER", "ACCOUNTING", "FINANCE"], group: "Moliya" },
  { href: "/payments",    label: "Kassa / bank",       roles: ["CASHIER", "ACCOUNTING", "FINANCE"], group: "Moliya" },
  { href: "/cashflow",    label: "Kirim-Chiqim",       roles: ["CASHIER", "ACCOUNTING", "FINANCE"], group: "Moliya" },
  // Kirim QQS reyestri (oy va yetkazuvchi kesimida QQS'siz summa, QQS, jami) — buxgalteriya hisobotlari uchun
  // Arenda (do'konlar ijarasi): oylik hisob jadvali + arenda kassasi kirim-chiqimi. Sekretar uchun yagona sahifa (OWN_PAGE_ONLY)
  { href: "/arenda",      label: "Arenda",             roles: ["SECRETARY"], group: "Moliya" },
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
  { href: "/otdel-kadr?tab=ish-vaqti",  label: "Ish vaqti",         roles: ["HR"], group: "Otdel kadr" },
  { href: "/otdel-kadr?tab=taqvim",     label: "Kadr taqvimi",      roles: ["HR"], group: "Otdel kadr" },
  { href: "/otdel-kadr?tab=grafik",     label: "Smena grafigi",     roles: ["HR"], group: "Otdel kadr" },
  { href: "/otdel-kadr?tab=arizalar",   label: "Arizalar",          roles: ["HR"], group: "Otdel kadr" },
  { href: "/otdel-kadr?tab=jarima-bonus", label: "Jarima va bonuslar", roles: ["HR"], group: "Otdel kadr" },
  { href: "/otdel-kadr?tab=cheklistlar", label: "Cheklistlar",      roles: ["HR"], group: "Otdel kadr" },
  { href: "/otdel-kadr?tab=kpi",        label: "KPI",               roles: ["HR"], group: "Otdel kadr" },
  { href: "/otdel-kadr?tab=yollash",    label: "Yollash",           roles: ["HR"], group: "Otdel kadr" },
  { href: "/otdel-kadr?tab=moslashuv",  label: "Moslashuv",         roles: ["HR"], group: "Otdel kadr" },
  { href: "/otdel-kadr?tab=oqitish",    label: "O'qitish",          roles: ["HR"], group: "Otdel kadr" },
  { href: "/otdel-kadr?tab=sorovnoma",  label: "So'rovnoma",        roles: ["HR"], group: "Otdel kadr" },
  { href: "/otdel-kadr?tab=murojaatlar", label: "Murojaatlar va xabar", roles: ["HR"], group: "Otdel kadr" },
  { href: "/otdel-kadr?tab=hisobotlar", label: "Kadr hisobotlari",  roles: ["HR"], group: "Otdel kadr" },
  // Ish haqi: kadr hisoblaydi, direktor tasdiqlaydi, kassir to'laydi (`lib/hr/payroll.ts`)
  { href: "/ish-haqi",                  label: "Ish haqi",          roles: ["HR", "ACCOUNTING", "FINANCE", "CASHIER"], group: "Moliya" },
  // Davomat sozlamalari (kechikish jarimasi) — /settings ostida, lekin otdel kadrga ham ochiq (eng uzun prefiks qoidasi)
  { href: "/settings/davomat",          label: "Davomat sozlamalari", roles: ["HR"], group: "Otdel kadr" },
  { href: "/employees",   label: "Xodimlar",           roles: ["HR", "LOGISTICS"], group: "Boshqaruv" },
  // Haydovchi ERP'ga kirsa faqat shu sahifani ko'radi — o'zining reyslari (qolgan bo'limlar yopiq)
  { href: "/mening-reyslarim", label: "Mening reyslarim", roles: ["DRIVER"], group: "Logistika", menuFor: ["DRIVER"] },
  // Brigadir ham xuddi shunday: vebda faqat o'z brigadasiga tayinlangan topshiriqlar
  { href: "/mening-topshiriqlarim", label: "Mening topshiriqlarim", roles: ["BRIGADIER"], group: "Ishlab chiqarish", menuFor: ["BRIGADIER"] },
  // Logistika uchun — Haydovchilar tabida. Otdel kadr kabinetida Logistika guruhi yo'q: ruxsat ECO ilovasi uchun qoladi
  { href: "/drivers",     label: "Haydovchi ilovasi (ECO)", roles: ["LOGISTICS", "HR"], group: "Logistika", menuFor: [] },
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
  // Sekretar vebda faqat arenda bilan ishlaydi: kirgach to'g'ridan-to'g'ri shu sahifa ochiladi
  SECRETARY: "/arenda",
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
  SECRETARY: "Sekretar",
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
    if (i.menuHide?.includes(role)) return false;
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
  { key: "offers",    label: "Tijorat takliflari",    prefixes: ["/takliflar"] },
  { key: "marketing", label: "Marketing",             prefixes: ["/marketing"] },
  { key: "customers", label: "Mijozlar",              prefixes: ["/customers"] },
  { key: "production",label: "Ishlab chiqarish",      prefixes: ["/production", "/recipes"] },
  { key: "tasks",     label: "Topshiriq / brigada",   prefixes: ["/tasks", "/brigades"] },
  { key: "trips",     label: "Reyslar / haydovchi",   prefixes: ["/trips", "/drivers"] },
  { key: "logistika", label: "Logistika",             prefixes: ["/logistika"] },
  { key: "stock",     label: "Sklad",                 prefixes: ["/stock", "/snabjeniye", "/receipts", "/suppliers", "/oluvchi"] },
  { key: "taminot",   label: "Ta'minot zayavkalari",  prefixes: ["/taminot"] },
  { key: "mexanik",   label: "Mexanik so'rovlari",    prefixes: ["/mexanik-sorovlar"] },
  { key: "payments",  label: "Kassa / schyot",        prefixes: ["/payments", "/invoices", "/pul-qabul"] },
  { key: "cashflow",  label: "Kirim-chiqim",          prefixes: ["/cashflow"] },
  { key: "arenda",    label: "Arenda",                prefixes: ["/arenda"] },
  { key: "kirim-qqs", label: "Kirim QQS reyestri",    prefixes: ["/kirim-qqs"] },
  { key: "employees", label: "Xodimlar / kadr",       prefixes: ["/employees", "/otdel-kadr"] },
  { key: "payroll",   label: "Ish haqi",              prefixes: ["/ish-haqi"] },
  { key: "vazifalar", label: "Vazifalar",             prefixes: ["/vazifalar"] },
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
