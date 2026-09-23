import type { Role } from "@/generated/prisma";
import { ROLE_LABELS } from "./nav";

/**
 * Tizimga kirgan har bir xodim uchun bosqichma-bosqich instruksiya.
 *
 * Qoidalar:
 *  - `action: "click"` bo'lgan bosqich — foydalanuvchi ko'rsatilgan joyni bosmaguncha
 *    keyingi bosqichga o'tilmaydi ("Keyingi" tugmasi umuman chiqmaydi).
 *  - `target` yo'q bosqich ekran markazida ko'rsatiladi (kirish/yakun so'zi).
 *  - `path` berilgan bo'lsa, bosqich faqat shu sahifada ko'rsatiladi; foydalanuvchi
 *    boshqa sahifada bo'lsa, unga o'tish taklif qilinadi.
 *  - `only` — faqat ish stoli yoki faqat telefon uchun mo'ljallangan bosqich.
 *  - `skipIfOpen` — nishon allaqachon ochiq bo'lsa (aria-expanded="true"), bosqich
 *    o'tkazib yuboriladi: yopiq guruhni ochishni so'rab, ochig'ini yopib qo'ymaslik uchun.
 */
export type TourStep = {
  id: string;
  title: string;
  text: string;
  target?: string;
  path?: string;
  action?: "click";
  only?: "mobile" | "desktop";
  skipIfOpen?: boolean;
};

/** Menyudagi band va guruh sarlavhasi — `app-shell.tsx` shu belgilarni qo'yadi. */
const nav = (href: string) => `[data-tour="nav:${href}"]`;
const group = (g: string) => `[data-tour="group:${g}"]`;
/** Sahifa sarlavhasidagi asosiy tugmalar (`PageHeader` ning `action` qismi). */
const PAGE_ACTION = '[data-tour="page-action"]';

/** "Falon guruhni oching" bosqichi. */
function openGroup(g: string): TourStep {
  return {
    id: `group:${g}`,
    title: `«${g}» guruhini oching`,
    text: `Chap menyudagi «${g}» sarlavhasini bosing — shu guruhga tegishli sahifalar ro'yxati ochiladi.`,
    target: group(g),
    action: "click",
    skipIfOpen: true,
  };
}

/** "Falon bo'limga kiring" bosqichi — menyudagi band bosilishi shart. */
function openPage(href: string, label: string, text: string): TourStep {
  return { id: `nav:${href}`, title: `«${label}» bo'limini oching`, text, target: nav(href), action: "click" };
}

/** Ochilgan sahifadagi tushuntirish bosqichi. */
function onPage(id: string, path: string, title: string, text: string, target?: string): TourStep {
  return { id, path, title, text, target };
}

/* ═══════════════════════ Umumiy qism ═══════════════════════ */

const intro = (role: Role): TourStep => ({
  id: "intro",
  title: "Insof ERP — qisqa instruksiya",
  text:
    `Siz tizimga «${ROLE_LABELS[role]}» sifatida kirdingiz. Quyida o'z bo'limingiz bo'yicha qisqa ` +
    `yo'riqnoma ko'rsatiladi: strelka qayerni bosish kerakligini ko'rsatadi va siz o'sha amalni ` +
    `bajarmaguningizcha keyingi bosqichga o'tilmaydi. Shoshib turgan bo'lsangiz — «O'tkazib yuborish».`,
});

const SHELL_START: TourStep[] = [
  {
    id: "sidebar",
    title: "Chap menyu — barcha bo'limlar",
    text: "Ishlaydigan sahifalaringiz shu yerda, guruhlarga ajratilgan. Guruh sarlavhasi bosilsa ichidagi bandlar ochiladi, boshqasi yopiladi.",
    target: '[data-tour="sidebar"]',
    only: "desktop",
  },
  {
    id: "menu",
    title: "Menyu tugmasi",
    text: "Telefonda bo'limlar shu tugma ortida turadi. Instruksiya davomida menyu kerak bo'lganda o'zi ochiladi.",
    target: '[data-tour="menu"]',
    only: "mobile",
  },
];

const SHELL_END: TourStep[] = [
  {
    id: "help",
    title: "Yordam — to'liq qo'llanma",
    text: "Har bir bo'lim bo'yicha suratli, batafsil qo'llanma shu havolada. Instruksiya tugagach ham istalgan payt ochishingiz mumkin.",
    target: '[data-tour="help"]',
  },
  {
    id: "restart",
    title: "Instruksiyani qayta ko'rish",
    text: "Biror bosqichni esdan chiqarsangiz, shu tugma instruksiyani boshidan ishga tushiradi.",
    target: '[data-tour="tour"]',
  },
  {
    id: "theme",
    title: "Yorug' / qorong'i rejim",
    text: "Ko'zingizga qulay rejimni tanlang — tanlov shu brauzerda saqlanadi.",
    target: '[data-tour="theme"]',
  },
  {
    id: "logout",
    title: "Tizimdan chiqish",
    text: "Ish kuni tugagach shu tugma orqali chiqing. Qayta kirganingizda instruksiya yana boshidan ko'rsatiladi.",
    target: '[data-tour="logout"]',
  },
  {
    id: "done",
    title: "Instruksiya tugadi",
    text: "Endi mustaqil ishlashingiz mumkin. Savol tug'ilsa — tepadagi «Yordam» bo'limi yoki instruksiyani qayta ishga tushirish tugmasi xizmatingizda. Omad!",
  },
];

const DASHBOARD: TourStep[] = [
  onPage(
    "dash",
    "/dashboard",
    "Bosh sahifa — kunlik manzara",
    "Yuqoridagi kartalarda bugungi zayavkalar, ishlab chiqarilgan va yetkazilgan hajm, debitorka va bloklangan zayavkalar soni turadi. Kartani bosish o'sha bo'limga olib o'tadi.",
    '[data-tour="stats"]',
  ),
];

/* ═══════════════════════ Rollar bo'yicha ═══════════════════════ */

const SALES_STEPS: TourStep[] = [
  openGroup("Sotuv"),
  openPage("/orders", "Zayavkalar", "Ish shu yerdan boshlanadi: mijozdan kelgan yangi zayavka avval shu ro'yxatga tushadi."),
  onPage("orders-new", "/orders", "Yangi zayavka", "«Yangi zayavka» tugmasi mijoz, mahsulot, hajm, yetkazish sanasi va manzilini so'raydi. Manzilni 2GIS qidiruvidan yoki xaritadan belgilaysiz — masofa avtomatik hisoblanadi.", PAGE_ACTION),
  openPage("/sales", "Sotuv", "Qabul qilingan zayavkalar shu yerga o'tadi — bajarilish holati va realizatsiya jurnali shu bo'limda."),
  openPage("/customers", "Mijozlar", "Mijozlar kartotekasi. Har bir mijozga 100 mln so'm kredit limit; qarz limitni to'ldirsa mijoz avtomatik qora ro'yxatga tushadi va yangi zayavka bloklanadi."),
  openPage("/leads", "Sayt arizalari", "Kompaniya saytidagi formadan tushgan so'rovlar. Ariza bilan ishlab, uni mijozga aylantirganingizdan keyingina kartoteka ochiladi."),
  openGroup("Sklad"),
  openPage("/stock", "Sklad", "Mijozga va'da berishdan oldin shu yerga qarang: xomashyo qoldig'i va «Ishlab chiqarish imkoni» qancha beton chiqarish mumkinligini ko'rsatadi."),
];

const PRODUCTION_STEPS: TourStep[] = [
  openGroup("Ishlab chiqarish"),
  openPage("/production", "Ishlab chiqarish", "Tasdiqlangan zayavkalar bo'yicha zames (partiya) shu yerda qayd etiladi — xomashyo retsept bo'yicha avtomatik hisobdan chiqadi."),
  openPage("/recipes", "Retseptlar", "Har bir marka uchun 1 m³ ga ketadigan xomashyo normasi. Norma to'g'ri bo'lsa, sklad hisobi ham to'g'ri chiqadi."),
  openPage("/tasks", "Topshiriqlar", "Sizga va brigadalarga berilgan topshiriqlar; bajarilgani shu yerda belgilanadi."),
  openGroup("Sklad"),
  openPage("/stock", "Sklad", "Xomashyo qoldig'i va «Ishlab chiqarish imkoni». Qoldiq kamayganda ta'minot zayavkasi shu yerdan ochiladi."),
  openGroup("Logistika"),
  openPage("/trips", "Reyslar / nakladnoy", "Tayyor beton mikserga yuklanadi va reys ochiladi. Nakladnoy shu yerdan chop etiladi."),
];

const SUPERVISOR_STEPS: TourStep[] = [
  openGroup("Ishlab chiqarish"),
  openPage("/production", "Ishlab chiqarish", "Smena davomidagi zameslar va bajarilgan hajm shu yerda ko'rinadi."),
  openPage("/tasks", "Topshiriqlar", "Brigadalarga topshiriq berish va bajarilishini nazorat qilish shu bo'limda."),
  openPage("/brigades", "Brigadalar", "Brigada tarkibi, ularga biriktirilgan material va ish hajmi."),
  openGroup("Sotuv"),
  openPage("/orders", "Zayavkalar", "Ertangi kunga rejalashtirilgan hajmni shu yerdan ko'rasiz — smenani shunga qarab tuzasiz."),
];

const LOGISTICS_STEPS: TourStep[] = [
  openGroup("Logistika"),
  openPage("/trips", "Reyslar / nakladnoy", "Mikserlarga reys ochish, haydovchi biriktirish va nakladnoy chiqarish shu yerda."),
  onPage("trips-live", "/trips", "Jonli xarita", "Yo'ldagi mikserlar xaritada real vaqtda ko'rinadi — haydovchining ilovasi joylashuvni o'zi yuboradi.", '[data-tour="page-title"]'),
  openPage("/drivers", "Haydovchilar (ECO)", "Haydovchilar ro'yxati va ularning holati. Haydovchi mobil ilovaga telefon raqami bilan kiradi."),
  openGroup("Sotuv"),
  openPage("/orders", "Zayavkalar", "Qaysi zayavkaga qancha hajm, qaysi manzilga va qachon kerakligini shu yerdan ko'rasiz."),
];

const WAREHOUSE_STEPS: TourStep[] = [
  openGroup("Sklad"),
  openPage("/stock", "Sklad", "Xomashyo qoldig'i — asosiy ish oynangiz. Qoldiq kamayganda shu yerdan ta'minot zayavkasi ochiladi."),
  openPage("/taminot", "Ta'minot zayavkalari", "Ochilgan zayavkalar va ularning holati: narx qo'yildimi, tasdiqlandimi, to'landimi."),
  openPage("/snabjeniye", "Snabjeniye", "Zayavkaga narx qo'yish va yetkazuvchini tanlash. Narx o'zgarsa hujjat qayta tasdiqlashga ketadi."),
  openPage("/receipts", "Kirim", "Kelgan mol qabul qilinadi. Nakladnoyni kamerada suratga olsangiz, AI raqamlarni o'zi o'qib beradi."),
  openPage("/suppliers", "Yetkazuvchilar", "Yetkazuvchilar bazasi va ular bilan hisob-kitob holati."),
];

const ACCOUNTING_STEPS: TourStep[] = [
  openGroup("Moliya"),
  openPage("/payments", "Kassa / bank", "Mijozdan tushgan to'lovlar shu yerda qayd etiladi va schyotga bog'lanadi."),
  openPage("/cashflow", "Kirim-Chiqim", "Kassa va bank bo'yicha barcha harakat. Ta'minot hujjatlari to'lovga shu yerda tasdiqlanadi."),
  openGroup("Sotuv"),
  openPage("/orders", "Zayavkalar", "Zayavka va unga bog'langan schyot-faktura holati."),
  openPage("/customers", "Mijozlar", "Mijozning qarzi, kredit limiti va qora ro'yxat holati shu yerda ko'rinadi."),
];

const CASHIER_STEPS: TourStep[] = [
  openGroup("Moliya"),
  openPage("/payments", "Kassa / bank", "Kunlik ish joyingiz: kirim to'lovlari shu yerda kiritiladi."),
  onPage("payments-form", "/payments", "Yangi to'lov", "Mijoz, summa, schyot va kassa/bank hisobini tanlab saqlaysiz — mijozning qarzi shu zahoti kamayadi.", '[data-tour="page-title"]'),
  openPage("/cashflow", "Kirim-Chiqim", "Kun oxirida kassa qoldig'ini shu yerdan solishtirasiz; chiqim to'lovlari ham shu bo'limda tasdiqlanadi."),
];

const HR_STEPS: TourStep[] = [
  openGroup("Otdel kadr"),
  openPage("/otdel-kadr", "Xodimlar ro'yxati", "Kadr bo'limining asosiy oynasi: yangi xodim hujjatlari bilan kiritiladi, shaxsiy varaqa chop etiladi."),
  openPage("/otdel-kadr?tab=lavozimlar", "Ishchi lavozimlar", "Tizimga login bermaydigan lavozimlar shu yerda ochiladi va darhol xodimlar ro'yxatiga tushadi."),
  openPage("/otdel-kadr?tab=bolimlar", "Bo'limlar", "Korxona tuzilmasi — qaysi xodim qaysi bo'limga tegishli."),
  openPage("/otdel-kadr?tab=taqvim", "Kadr taqvimi", "Tug'ilgan kunlar, mehnat shartnomasi muddatlari va boshqa kadr sanalari."),
  openGroup("Boshqaruv"),
  openPage("/employees", "Xodimlar", "Tizimga kiradigan xodimlar: login, rol va parolni shu yerdan berasiz."),
];

const FINANCE_STEPS: TourStep[] = [
  openGroup("Moliya"),
  openPage("/payments", "Kassa / bank", "Tushum va to'lovlar bo'yicha kunlik manzara."),
  openPage("/cashflow", "Kirim-Chiqim", "Pul oqimi, ta'minot hujjatlarini to'lovga tasdiqlash."),
  openGroup("Tahlil"),
  openPage("/bi-tahlil", "BI tahlil", "Sotuv, mijoz, ombor va moliya bo'yicha tahliliy panellar. Har bir bo'lim uchun alohida sahifa bor."),
];

const DIRECTOR_STEPS: TourStep[] = [
  openGroup("Tahlil"),
  openPage("/bi-tahlil", "BI tahlil", "Korxonaning umumiy manzarasi: sotuv, agentlar, mijozlar, ombor, ishlab chiqarish, moliya va ML tahlillari."),
  {
    id: "ai",
    title: "Insof AI",
    text: "Savolni oddiy tilda yozing — AI ERP ma'lumotlari asosida javob beradi («bu oy qancha beton sotildi?» kabi).",
    target: '[data-tour="ai"]',
  },
  openGroup("Sotuv"),
  openPage("/orders", "Zayavkalar", "Kunlik zayavkalar oqimi va bloklangan (limitdan o'tgan) zayavkalar."),
  openGroup("Moliya"),
  openPage("/cashflow", "Kirim-Chiqim", "Pul oqimi va tasdiqlashingizni kutayotgan to'lovlar."),
  openGroup("Boshqaruv"),
  openPage("/settings", "Sozlamalar", "Korxona ma'lumotlari, zavod nuqtasi, birliklar va integratsiyalar shu yerda sozlanadi."),
];

const DRIVER_STEPS: TourStep[] = [
  openGroup("Logistika"),
  openPage("/mening-reyslarim", "Mening reyslarim", "Veb-saytda sizga faqat shu sahifa ochiq — bugungi reyslaringiz va ularning bosqichlari."),
  onPage(
    "driver-stages",
    "/mening-reyslarim",
    "Reys bosqichlari",
    "Har bir reysda bosqichni ketma-ket belgilab borasiz: yuklandi → yo'lda → yetkazildi. Asosiy ish esa mobil ilovada — u joylashuvingizni ham yuboradi.",
    '[data-tour="page-title"]',
  ),
  {
    id: "driver-apk",
    title: "Mobil ilova",
    text: "Android ilovasini shu havoladan yuklab oling. Reyslar, bosqichlar va navigatsiya ilovada ancha qulay.",
    target: '[data-tour="apk"]',
  },
];

const BY_ROLE: Record<Role, TourStep[]> = {
  DIRECTOR: DIRECTOR_STEPS,
  SALES: SALES_STEPS,
  PRODUCTION: PRODUCTION_STEPS,
  SUPERVISOR: SUPERVISOR_STEPS,
  LOGISTICS: LOGISTICS_STEPS,
  WAREHOUSE: WAREHOUSE_STEPS,
  PROCUREMENT: WAREHOUSE_STEPS,
  ACCOUNTING: ACCOUNTING_STEPS,
  FINANCE: FINANCE_STEPS,
  HR: HR_STEPS,
  CASHIER: CASHIER_STEPS,
  DRIVER: DRIVER_STEPS,
};

/** Rolga mos to'liq instruksiya: kirish → qobiq → rol bo'limlari → yakun. */
export function tourFor(role: Role): TourStep[] {
  // Haydovchi vebda faqat bitta sahifani ko'radi — bosh sahifa bosqichi unga tegishli emas
  const base = role === "DRIVER" ? [] : DASHBOARD;
  return [intro(role), ...SHELL_START, ...base, ...BY_ROLE[role], ...SHELL_END];
}

/** Instruksiya holati saqlanadigan cookie. Sessiya cookie'si: chiqishda o'chiriladi. */
export const TOUR_COOKIE = "insof_tour";
/** Foydalanuvchi instruksiyani tugatgan yoki o'tkazib yuborgan holat. */
export const TOUR_DONE = "done";
