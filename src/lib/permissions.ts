import type { Role } from "@/generated/prisma";
import type { Perms } from "./auth";
import { isModuleOff } from "./platform-modules";

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
    { key: "edit",     label: "Zayavkani tahrirlash",               roles: ["SALES", "SUPERVISOR"], hint: "Ishlab chiqarish boshlanguncha: mahsulot, soni, narx, sana, manzil, dastavka, to'lov. Summa oshsa limit qayta tekshiriladi" },
    { key: "contract", label: "Shartnoma va kafolat xati",          roles: ["SALES", "ACCOUNTING"] },
    { key: "import",   label: "Excel'dan zayavka import",           roles: ["SALES"] },
    { key: "stock",    label: "Sklad (zaxira) zayavkasi",           roles: STOCK_ORDER, hint: "Ochish (Ishlab chiqarish → «Skladga zayavka»), tahrirlash, qabul qilish, yopish, bekor qilish" },
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
    { key: "reschedule", label: "Zayavkani boshqa kunga ko'chirish (doska)", roles: ["PRODUCTION", "SUPERVISOR"], hint: "Qabul qilingan zayavka ham — yangi kunning kunlik limiti tekshiriladi" },
    { key: "recipe",  label: "Retsept versiyasi / import",       roles: ["PRODUCTION", "WAREHOUSE", "PROCUREMENT"] },
    { key: "report",  label: "Brak, davomat, smena hisoboti",    roles: ["PRODUCTION", "SUPERVISOR"] },
    { key: "batch_storno", label: "Zamesni bekor qilish",       roles: [], hint: "Xomashyo skladga qaytadi, mahsulot chiqariladi — odatda faqat direktor" },
    { key: "plan",    label: "Oylik va kunlik ishlab chiqarish plani", roles: [], hint: "Bosh sahifadagi mahsulot bo'yicha plan — odatda direktor" },
    { key: "staff",   label: "Sex xodimlarini brigadalarga taqsimlash", roles: ["SUPERVISOR"], hint: "Brigadalar → «Xodimlar» tabi va bosh sahifadagi «Xodimlarni taqsimlash»" },
  ],
  tasks: [
    { key: "progress", label: "Bajarilgan hajmni qayd qilish",   roles: ["PRODUCTION", "SUPERVISOR"] },
    { key: "cancel",   label: "Topshiriqni bekor qilish",        roles: ["PRODUCTION", "SUPERVISOR"] },
    { key: "brigade",  label: "Brigada ochish / tahrirlash",     roles: ["PRODUCTION", "SUPERVISOR", "HR"] },
    { key: "pay",      label: "Brigada oyligi: brak summasini tahrirlash", roles: ["SUPERVISOR"], hint: "Brak summasi brigadadagi sdelka xodimlarining oyligidan ushlanadi" },
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
    { key: "expense",  label: "Transport xarajati kiritish",     roles: ["LOGISTICS", "ACCOUNTING", "MECHANIC", "DISPATCHER"], hint: "Dispetcher — Haydovchilar tabeli → «Qo'lda yozuvlar» dan" },
    { key: "sites",    label: "Obyektlar",                       roles: ["LOGISTICS", "SALES"] },
    { key: "order_edit", label: "Buyurtmalar: yetkazish ma'lumotlarini tahrirlash (sana, soat, manzil, nasos, izoh)", roles: ["LOGISTICS"], hint: "Mahsulot, miqdor va narx o'zgarmaydi — ular sotuvning to'liq tahririda (Zayavkalar → edit)" },
    { key: "drivers",  label: "Haydovchi kartochkasi",           roles: ["LOGISTICS", "DISPATCHER"] },
    { key: "driver_login", label: "Haydovchiga kirish berish (vaqtinchalik parol)", roles: ["LOGISTICS", "DISPATCHER"], hint: "Faqat haydovchi roli; parol 72 soat amal qiladi, haydovchi kirishda o'z parolini qo'yadi" },
    { key: "pay",      label: "Reys narxi, to'lov turi, haydovchi tarifi va usta puli (tabel)", roles: ["DISPATCHER"], hint: "Narx va usta puli ish boshqaruvchi tasdig'iga boradi" },
    { key: "pay_approve", label: "Reys haqini tasdiqlash (naqd → kassa, oylik → vedomost)", roles: ["SUPERVISOR"] },
    { key: "ledger",   label: "Hisob varag'i: qo'lda qator, km va baraban soatini tuzatish", roles: ["LOGISTICS", "DISPATCHER"], hint: "ECO'ga tushmagan reys qatori (zapravka, xarajat bilan); haq ish boshqaruvchi tasdig'iga boradi" },
    { key: "real_auto", label: "Realizatsiya: reysdan tushgan qatorni to'ldirish (ortilgan joy, manzil, izoh)", roles: ["LOGISTICS", "DISPATCHER"], hint: "Qatorlar reyslardan (TTN) o'zi tushadi; miqdor, narx va mijoz zayavkadan — ular o'zgarmaydi" },
    { key: "real_manual", label: "Realizatsiya: qo'lda qator kiritish, tuzatish, bekor qilish", roles: ["LOGISTICS", "DISPATCHER"], hint: "Tizimga reys bo'lib tushmagan jo'natma. Faqat reestr — mijoz qarzi, kassa va skladga ta'sir qilmaydi" },
    { key: "settings", label: "Logistika sozlamalari",           roles: ["LOGISTICS"] },
  ],
  stock: [
    { key: "receipt",   label: "Kirim (xomashyo qabul qilish)",  roles: ["PROCUREMENT", "WAREHOUSE"] },
    { key: "shipment",  label: "Jo'natma — olib kelingan molni skladga jo'natish", roles: ["PROCUREMENT", "MECHANIC"], hint: "Nakladnoy kiritadi, sklad qabul qilgach kirim bo'ladi (mexanik — avto zapchast)" },
    { key: "shipment_accept", label: "Jo'natmani qabul qilish / rad etish", roles: ["WAREHOUSE"], hint: "Qabul qilingan qatorlar skladga kirim bo'lib tushadi" },
    { key: "receipt_storno", label: "Kirimni bekor qilish",    roles: [], hint: "Sklad harakatlari teskari yoziladi — odatda faqat direktor" },
    { key: "issue",     label: "Chiqim — skladdan berish (Kimga)", roles: ["WAREHOUSE", "PROCUREMENT"], hint: "Shafyorlar, svarchiklar, brigadalarga xomashyo berish va «Kimga» ro'yxati" },
    { key: "price",     label: "«Dona narxi» — xomashyo narxini belgilash", roles: ["PROCUREMENT"], hint: "Chiqim, brigadaga berish va hisobdan chiqarish shu narx bilan baholanadi" },
    { key: "issue_storno", label: "Chiqimni bekor qilish", roles: [], hint: "Berilgan xomashyo skladga teskari yoziladi — odatda faqat direktor" },
    { key: "adjust",    label: "Inventarizatsiya va spisanie",   roles: ["WAREHOUSE"] },
    { key: "brigade",   label: "Brigadaga berish / qaytarish",   roles: ["WAREHOUSE", "PROCUREMENT", "PRODUCTION", "SUPERVISOR"] },
    { key: "products",  label: "Tayyor mahsulot qo'shish (qatorlar, yangi mahsulot, nomini tahrirlash)", roles: ["WAREHOUSE", "PRODUCTION", "SUPERVISOR"] },
    { key: "import",    label: "Xomashyo import",                roles: ["WAREHOUSE", "PROCUREMENT", "PRODUCTION"] },
    { key: "suppliers", label: "Yetkazuvchilar",                 roles: ["WAREHOUSE", "PROCUREMENT", "ACCOUNTING"] },
  ],
  // Ta'minot zanjiri va mexanik so'rovlari: qadamlar rol bo'yicha (`requireModuleWrite`). «write» — direktor bergan
  // yozish huquqi: belgilansa rol ro'yxatida bo'lmasa ham yozadi, faqat oyna berilsa — ko'radi (`moduleWriteAllowed`)
  taminot: [
    { key: "write", label: "Zayavka bilan ishlash (ochish, tasdiqlash, narx, qabul)", roles: ["WAREHOUSE", "PROCUREMENT", "PRODUCTION", "MECHANIC"], hint: "Har qadam baribir o'z bosqichidagi bo'limga" },
  ],
  // Mexanik so'raydi, ish boshqaruvchi tasdiqlaydi, kassa beradi
  mexanik: [
    { key: "write", label: "So'rov bilan ishlash (so'rash, tasdiqlash, pul berish)", roles: ["MECHANIC", "SUPERVISOR", "CASHIER"] },
  ],
  // Tizimga o'tish sanasidagi qoldiqlar — pulga ta'sir qiladi
  opening: [
    { key: "write", label: "Qoldiqlarni kiritish va tahrirlash", roles: ["ACCOUNTING"] },
  ],
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
    { key: "import", label: "Kassa jurnaliga Excel import",       roles: ["CASHIER", "ACCOUNTING", "FINANCE"] },
  ],
  cashflow: [
    { key: "create", label: "Kirim-chiqim yozish",              roles: ["CASHIER", "ACCOUNTING", "FINANCE"] },
    { key: "delete", label: "Yozuvni o'chirish",                roles: ["ACCOUNTING", "FINANCE"] },
    { key: "edit",   label: "Yozuvni tahrirlash (Kassa jurnali)", roles: ["ACCOUNTING", "FINANCE"], hint: "Qo'lda yozilgan kirim/chiqim: sana, hisob, summa, manba, kontragent, izoh — AuditLog'da" },
    { key: "pay",    label: "Yetkazuvchiga to'lash",            roles: ["FINANCE", "ACCOUNTING"] },
    { key: "transfer", label: "Hisoblararo o'tkazma (kassa ⇄ bank)", roles: ["CASHIER", "ACCOUNTING", "FINANCE"], hint: "Inkassatsiya, naqdlashtirish; kassa qoldig'idan oshmaydi" },
    { key: "transfer_storno", label: "O'tkazmani bekor qilish",  roles: [], delegable: false },
    { key: "close",  label: "Kassani yopish (kun oxiri sanog'i)", roles: ["CASHIER"], hint: "Nazorat: sanalgan naqd tizimdagi qoldiq bilan solishtiriladi" },
  ],
  employees: [
    { key: "create", label: "Xodim qo'shish",                    roles: ["HR"] },
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
  if (isModuleOff(module)) return false; // platforma tarifida o'chirilgan — direktor ham bajarmaydi
  if (who.role === "DIRECTOR") return true;
  const def = actionDef(module, action);
  if (def?.delegable === false) return false;
  const lvl = who.perms?.[module];
  if (lvl === "none" || lvl === "view") return false;
  if (lvl === "write") return !def?.explicit;
  if (Array.isArray(lvl)) return lvl.includes(action);
  return (def?.roles ?? fallbackRoles ?? []).includes(who.role);
}

/**
 * Yozish tillari: ERP maydonlariga hamma faqat lotinda yozadi (`components/script-guard.tsx`), qo'shimcha yozuvni
 * direktor Ruxsatlar → «Yozish tili» da beradi. `perms.til` da saqlanadi — modul emas, menyu va sahifalarga ta'sir qilmaydi.
 */
export const SCRIPT_PERM = "til";
export const WRITE_SCRIPTS = [
  { key: "kirill", label: "Kirill (rus, o'zbek kirill)" },
  { key: "boshqa", label: "Boshqa yozuvlar (arab, xitoy, koreys…)" },
] as const;
const isWriteScript = (k: string) => WRITE_SCRIPTS.some((s) => s.key === k);

/** Xodimga lotindan tashqari ruxsat berilgan yozuvlar (`kirill`, `boshqa`). Direktor — cheklovsiz. */
export function writeScripts(who: Who): string[] {
  if (who.role === "DIRECTOR") return WRITE_SCRIPTS.map((s) => s.key);
  const v = who.perms?.[SCRIPT_PERM];
  return Array.isArray(v) ? v.filter(isWriteScript) : [];
}

/** Formadagi `til` belgilari → saqlanadigan qiymat (bo'sh — faqat lotin). */
export const writeScriptsFromForm = (vals: unknown[]): string[] => [...new Set(vals.map(String))].filter(isWriteScript);

/** Ruxsatlar ro'yxatidagi qisqa yozuv: «lotin + kirill». */
export const describeWriteScripts = (v: unknown) =>
  ["lotin", ...(Array.isArray(v) ? v : []).flatMap((k) => WRITE_SCRIPTS.find((s) => s.key === k)?.label.split(" (")[0].toLowerCase() ?? [])].join(" + ");

/** Rol bo'yicha (perms yo'q) bajariladigan amallar — formada "Tanlangan amallar" ga o'tganda boshlang'ich belgilar. */
export function roleDefaultActions(role: Role, module: string): string[] {
  return delegableActions(module).filter((a) => role === "DIRECTOR" || a.roles.includes(role)).map((a) => a.key);
}

/**
 * Boshqa xodimlarning davomati (kim keldi / kechikdi, skaner jurnali va kadrlari, AI javobi) — faqat direktor va otdel kadr.
 * Istisnolar o'z joyida: sex boshlig'i va ish boshqaruvchi — o'z sexi, brigadir — o'z brigadasi, dispetcher va logistika —
 * haydovchilar. Qolganlar faqat o'z davomatini ko'radi (`lib/self-attendance.ts`).
 */
export const STAFF_ATTENDANCE_ROLES: readonly Role[] = ["DIRECTOR", "HR"];
export const canSeeStaffAttendance = (role: Role) => STAFF_ATTENDANCE_ROLES.includes(role);

/** Xodimning shu moduldagi amallari, direktor bergani hisobga olingan holda (sozlamalarda xulosa uchun). */
export function effectiveActions(who: Who, module: string): string[] {
  return delegableActions(module).filter((a) => canDo(who, module, a.key)).map((a) => a.key);
}
