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
  /** true — modulga «write» berilgani yetmaydi, amal aniq belgilanishi kerak (pul sarfi, kompaniya nomidan nashr) */
  explicit?: boolean;
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
    { key: "capacity", label: "Kunlik limit (taqvimdagi m³ / dona quvvati)", roles: [], hint: "Zayavkani bloklamaydi, taqvim rangini belgilaydi — odatda direktor" },
  ],
  sales: [
    { key: "leads",     label: "Sayt arizalari bilan ishlash",  roles: ["SALES"], hint: "Holat, izoh, mijozga aylantirish" },
    { key: "ecommerce", label: "E-commerce do'konini boshqarish", roles: ["SALES"] },
    { key: "invoice",   label: "Schyot yozish",                  roles: ["ACCOUNTING", "SALES"] },
    { key: "invoice_cancel", label: "Schyotni bekor qilish",     roles: ["ACCOUNTING"] },
    { key: "amocrm",    label: "amoCRM kelishuvlari bilan ishlash", roles: ["SALES"], hint: "Kelishuvdan zayavka ochish yoki «kerak emas» deb yopish" },
    { key: "amocrm_settings", label: "amoCRM'ni ulash va voronka sozlamasi", roles: [], explicit: true, hint: "Kompaniya amoCRM hisobiga kalit beradi; odatda direktor" },
  ],
  // Tijorat taklifi (KP): zayavkadan mustaqil rasmiy narx hujjati — direktor istalgan xodimga «create» beradi
  offers: [
    { key: "create",   label: "Tijorat taklifi tuzish va chop etish", roles: ["SALES"], hint: "Zayavka bo'lishi shart emas; hujjat QR bilan chiqadi" },
    { key: "cancel",   label: "Taklifni bekor qilish / qabul qilindi deb belgilash", roles: ["SALES"] },
    { key: "settings", label: "Taklif matni, shartlari va rekvizitlari", roles: [], hint: "Hujjat boshidagi matn, shartlar, OKED, QQS raqami — odatda direktor" },
  ],
  marketing: [
    { key: "content", label: "Kontent reja (Reels, post)",        roles: ["SALES"] },
    { key: "ads",     label: "Reklama kampaniyalari va xarajat",  roles: ["SALES"] },
    { key: "seo",     label: "SEO kalit so'zlar va pozitsiyalar", roles: ["SALES"] },
    { key: "agent",   label: "AI marketing agenti",               roles: ["SALES"], hint: "Agent kontent rejaga yozishi uchun «Kontent reja» ruxsati ham kerak" },
    { key: "publish", label: "Postni tasdiqlash va tarmoqqa chiqarish", roles: [], explicit: true, hint: "Instagram, Telegram, Facebook — kompaniya nomidan chiqadi; odatda direktor" },
    { key: "boost",   label: "Target (reklama) so'rovi yuborish",  roles: ["SALES"], hint: "Faqat so'rov — pul tasdiqlangandan keyin sarflanadi" },
    { key: "boost_approve", label: "Targetni tasdiqlash va ishga tushirish", roles: [], explicit: true, hint: "Real pul sarflanadi — limitlar Sozlamalar sahifasida" },
    { key: "settings", label: "Ijtimoiy tarmoq profillarini ulash", roles: [], explicit: true, hint: "Instagram, Facebook, Telegram va reklama kabineti — kompaniya nomidan ishlaydi; odatda direktor" },
  ],
  customers: [
    { key: "edit",     label: "Mijoz qo'shish / tahrirlash",  roles: ["SALES", "ACCOUNTING", "FINANCE"] },
    { key: "sites",    label: "Mijoz obyektlari",             roles: ["SALES", "ACCOUNTING", "FINANCE"] },
    { key: "app_link", label: "ECO ilova hisobini bog'lash",  roles: ["SALES"] },
    { key: "agent",    label: "Mijozni agentga biriktirish",  roles: ["HR", "SALES"] },
  ],
  // Sotuv agentlari sahifasi (`/agent`): ko'rish darajasi; mijozni agentga biriktirish — «customers» → «agent»
  agent: [],
  production: [
    { key: "batch",   label: "Zames (partiya) yozish",           roles: ["PRODUCTION"] },
    { key: "assign",  label: "Brigadalarga taqsimlash",          roles: ["PRODUCTION"] },
    { key: "recipe",  label: "Retsept versiyasi / import",       roles: ["PRODUCTION", "WAREHOUSE", "PROCUREMENT"] },
    { key: "report",  label: "Brak, davomat, smena hisoboti",    roles: ["PRODUCTION", "SUPERVISOR"] },
    { key: "batch_storno", label: "Zamesni bekor qilish",       roles: [], hint: "Xomashyo skladga qaytadi, mahsulot chiqariladi — odatda faqat direktor" },
    { key: "plan",    label: "Oylik va kunlik ishlab chiqarish plani", roles: [], hint: "Bosh sahifadagi mahsulot bo'yicha plan — odatda direktor" },
    { key: "staff",   label: "Sex xodimlarini brigadalarga taqsimlash", roles: [], hint: "Bosh sahifa → «Xodimlarni taqsimlash» — odatda direktor" },
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
    { key: "resolve", label: "Reys muammosini hal qilish",        roles: ["LOGISTICS", "DISPATCHER"], hint: "Dispetcher — buzilish, avariya va boshqa transport muammolari" },
    { key: "cost",    label: "Reys xarajati",                     roles: ["LOGISTICS", "ACCOUNTING"] },
    { key: "drivers", label: "Haydovchi ilovasi (ECO) boshqaruvi", roles: ["LOGISTICS", "HR", "DISPATCHER"] },
  ],
  logistika: [
    { key: "vehicle",  label: "Transport kartochkasi",           roles: ["LOGISTICS", "DISPATCHER"] },
    { key: "service",  label: "Texnik xizmat va transport holati", roles: ["LOGISTICS", "MECHANIC", "DISPATCHER"] },
    { key: "fuel",     label: "Yoqilg'i yozuvlari, xarajat o'chirish", roles: ["LOGISTICS", "ACCOUNTING"] },
    { key: "expense",  label: "Transport xarajati kiritish",     roles: ["LOGISTICS", "ACCOUNTING", "MECHANIC"] },
    { key: "sites",    label: "Obyektlar",                       roles: ["LOGISTICS", "SALES"] },
    { key: "drivers",  label: "Haydovchi kartochkasi",           roles: ["LOGISTICS", "DISPATCHER"] },
    { key: "pay",      label: "Reys narxi, to'lov turi, haydovchi tarifi va usta puli (tabel)", roles: ["DISPATCHER"], hint: "Narx va usta puli ish boshqaruvchi tasdig'iga boradi" },
    { key: "pay_approve", label: "Reys haqini tasdiqlash (naqd → kassa, oylik → vedomost)", roles: ["SUPERVISOR"] },
    { key: "settings", label: "Logistika sozlamalari",           roles: ["LOGISTICS"] },
  ],
  stock: [
    { key: "receipt",   label: "Kirim (xomashyo qabul qilish)",  roles: ["PROCUREMENT", "WAREHOUSE"] },
    { key: "shipment",  label: "Jo'natma — olib kelingan molni skladga jo'natish", roles: ["PROCUREMENT"], hint: "Nakladnoy kiritadi, sklad qabul qilgach kirim bo'ladi" },
    { key: "shipment_accept", label: "Jo'natmani qabul qilish / rad etish", roles: ["WAREHOUSE"], hint: "Qabul qilingan qatorlar skladga kirim bo'lib tushadi" },
    { key: "receipt_storno", label: "Kirimni bekor qilish",    roles: [], hint: "Sklad harakatlari teskari yoziladi — odatda faqat direktor" },
    { key: "issue",     label: "Chiqim — skladdan berish (Kimga)", roles: ["WAREHOUSE", "PROCUREMENT"], hint: "Shafyorlar, svarchiklar, brigadalarga xomashyo berish va «Kimga» ro'yxati" },
    { key: "price",     label: "«Dona narxi» — xomashyo narxini belgilash", roles: ["PROCUREMENT"], hint: "Chiqim, brigadaga berish va hisobdan chiqarish shu narx bilan baholanadi" },
    { key: "issue_storno", label: "Chiqimni bekor qilish", roles: [], hint: "Berilgan xomashyo skladga teskari yoziladi — odatda faqat direktor" },
    { key: "adjust",    label: "Inventarizatsiya va spisanie",   roles: ["WAREHOUSE"] },
    { key: "brigade",   label: "Brigadaga berish / qaytarish",   roles: ["WAREHOUSE", "PROCUREMENT", "PRODUCTION", "SUPERVISOR"] },
    { key: "products",  label: "Tayyor mahsulot qoldig'ini kiritish", roles: ["WAREHOUSE", "PRODUCTION"] },
    { key: "import",    label: "Xomashyo import",                roles: ["WAREHOUSE", "PROCUREMENT", "PRODUCTION"] },
    { key: "suppliers", label: "Yetkazuvchilar",                 roles: ["WAREHOUSE", "PROCUREMENT", "ACCOUNTING"] },
  ],
  taminot: [],
  // Mexanik so'rovlari — ta'minot kabi: amal rol bo'yicha (mexanik so'raydi, ish boshqaruvchi tasdiqlaydi, kassa beradi),
  // direktor modulni "yo'q" / "ko'rish" / "yozish" qilib cheklaydi yoki beradi (`requireModuleWrite`)
  mexanik: [],
  "kirim-qqs": [], // faqat ko'rish (hisobot)
  // Moliyaviy hisobotlar o'zi faqat ko'rish; ma'lumotnomalarni buxgalteriya yuritadi (`lib/fin-report`)
  moliya: [
    { key: "assets",     label: "Asosiy vositalar va amortizatsiya", roles: ["ACCOUNTING"] },
    { key: "loans",      label: "Kreditlar va qarzlar reyestri",     roles: ["ACCOUNTING"] },
    { key: "categories", label: "Kassa kategoriyalari va loyihalar", roles: ["ACCOUNTING"], hint: "Manba / Sub manba, PNL qatori va pul oqimi turi" },
    { key: "plan",       label: "To'lov rejasi (doimiy va bir martalik to'lovlar, muddatlar)", roles: ["FINANCE"], hint: "To'lov kalendari shundan hisoblanadi" },
    { key: "cost",       label: "Tannarx sozlamalari (koeffitsiyent, ishlab chiqarish xarajatlari, brigada ish haqi)", roles: ["ACCOUNTING"], hint: "Tahlil → Moliya → Tannarx hisobi va Mahsulot foydasi" },
  ],
  arenda: [
    { key: "create", label: "Arenda kirim-chiqimini yozish",       roles: ["SECRETARY"] },
    { key: "shops",  label: "Do'konlar va oylik hisobni tahrirlash", roles: ["SECRETARY"] },
    { key: "storno", label: "Kirim-chiqimni bekor qilish",        roles: ["SECRETARY"], hint: "Sabab bilan; yozuv jurnalda chizilgan holda qoladi" },
  ],
  payments: [
    { key: "create", label: "To'lov qabul qilish / bog'lash",   roles: ["CASHIER", "ACCOUNTING"] },
    // «Pul qabul qilish» so'rovlari (zayavka bosh to'lovi): naqd — kassa, perechisleniye — buxgalteriya (`lib/payment-requests.ts`)
    { key: "receive_cash", label: "Naqd bosh to'lovni qabul qilish (kassa)", roles: ["CASHIER"] },
    { key: "receive_bank", label: "Perechisleniyeni tasdiqlash (bank)", roles: ["ACCOUNTING"] },
    { key: "storno", label: "To'lovni bekor qilish",           roles: ["ACCOUNTING"] },
    { key: "import", label: "Sotuv reyestri importi",           roles: ["CASHIER", "ACCOUNTING", "FINANCE"] },
  ],
  cashflow: [
    { key: "create", label: "Kirim-chiqim yozish",              roles: ["CASHIER", "ACCOUNTING", "FINANCE"] },
    { key: "delete", label: "Yozuvni o'chirish",                roles: ["ACCOUNTING", "FINANCE"] },
    { key: "pay",    label: "Yetkazuvchiga to'lash",            roles: ["FINANCE", "ACCOUNTING"] },
    { key: "transfer", label: "Hisoblararo o'tkazma (kassa ⇄ bank)", roles: ["CASHIER", "ACCOUNTING", "FINANCE"], hint: "Inkassatsiya, naqdlashtirish; kassa qoldig'idan oshmaydi" },
    { key: "transfer_storno", label: "O'tkazmani bekor qilish",  roles: [], delegable: false },
    { key: "close",  label: "Kassani yopish (kun oxiri sanog'i)", roles: ["CASHIER"], hint: "Nazorat: sanalgan naqd tizimdagi qoldiq bilan solishtiriladi" },
  ],
  employees: [
    { key: "create", label: "Xodim qo'shish",                    roles: ["HR", "LOGISTICS"] },
    { key: "edit",   label: "Xodimni tahrirlash / bo'shatish",   roles: ["HR"] },
    { key: "login",  label: "Login berish, parol, rol",          roles: ["HR"], hint: "Rol berish — muhim huquq" },
    { key: "requests", label: "Arizalarni tasdiqlash (ta'til, kasallik, avans)", roles: ["HR"], hint: "Tasdiqlangan ta'til/kasallik davomatga tushadi, avans — direktor tasdig'iga" },
    { key: "calendar", label: "Zavod ish tartibi va bayramlar", roles: ["HR"], hint: "Hisobot va prognozlardagi ish kunlari shundan; davomat va ish haqiga ta'sir qilmaydi" },
    { key: "late_fine", label: "Kechikish jarimasi (Sozlamalar → Davomat)", roles: ["HR"] },
    { key: "schedule", label: "Smena grafigini tuzish",          roles: ["HR"] },
    { key: "payrules", label: "Jarima va bonuslar",              roles: ["HR"], hint: "Qoidalar (hamma uchun bir xil) va qo'lda jarima/bonus" },
    { key: "checklists", label: "Kundalik cheklistlar (lavozim majburiyatlari)", roles: ["HR"] },
    { key: "kpi",      label: "KPI: ko'rsatkichlar va faktlar",   roles: ["HR"], hint: "Mukofot oy yakuni ish haqiga bonus bo'lib qo'shiladi" },
    { key: "recruit",  label: "Yollash: vakansiya, nomzodlar, suhbatlar", roles: ["HR"], hint: "Nomzodni qabul qilish xodim kartasini ochadi" },
    { key: "onboarding", label: "Ishga qabul va moslashuv (sinov muddati)", roles: ["HR"] },
    { key: "training", label: "O'qitish: kurslar, testlar, sertifikatlar", roles: ["HR"] },
    { key: "voice",    label: "So'rovnoma, murojaatlar (HR chat), ommaviy xabar", roles: ["HR"], hint: "Anonim murojaat muallifi hech kimga ko'rinmaydi" },
    { key: "attendance", label: "Barcha xodimlarni davomatdan o'tkazish (skaner)", roles: ["HR", "SUPERVISOR"], hint: "Davomat sahifasi va ECO skaneri — sexdan tashqari xodimlar ham; yuzni ro'yxatga olish baribir faqat otdel kadrda" },
  ],
  // Umumiy vazifalar (`/vazifalar`, `lib/hr/tasks.ts`): o'ziga — har kim; boshqaga berish — rahbarlar
  vazifalar: [
    { key: "assign",   label: "Boshqa xodimga vazifa berish",    roles: ["HR", "SUPERVISOR", "PRODUCTION", "LOGISTICS", "SALES", "WAREHOUSE", "PROCUREMENT", "ACCOUNTING", "FINANCE"] },
    { key: "view_all", label: "Barcha vazifalarni ko'rish",      roles: ["HR"], hint: "Boshqalarning vazifalari, qabul qilish va bekor qilish" },
  ],
  payroll: [
    { key: "calc",     label: "Ish haqini hisoblash, vedomost",  roles: ["HR", "ACCOUNTING"] },
    { key: "settings", label: "Ish haqi sozlamalari (soliq, avans)", roles: ["HR", "ACCOUNTING"] },
    { key: "pay",      label: "Ish haqini kassadan to'lash",     roles: ["CASHIER"], explicit: true, hint: "Pul chiqimi — kassir" },
    { key: "approve",  label: "Vedomostni tasdiqlash",           roles: [], delegable: false, hint: "Faqat direktor" },
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
  if (lvl === "write") return !def?.explicit;
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
