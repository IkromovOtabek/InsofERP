import { db } from "@/lib/db";
import { isTransfer, txSign } from "@/lib/cash-tx";
import { activityList, approvalsList } from "./director";
import { ecoLabel } from "@/lib/eco/labels";
import { lineTotal } from "@/lib/receipt-vat";
import { PRODUCTION_FILTERS, assigned, dueLabel, isDone, isOpen, isSoon, partlyAssigned, prodFilter, prodSort } from "@/lib/production";
import { myBrigades } from "@/lib/brigades";
import { driverPositionNames } from "@/lib/positions";
import { ingredientOf } from "@/lib/recipe";
import { SUPPLY_LABEL, SUPPLY_TABS, totalPlanned } from "@/lib/supply";
import { unitLabel, unitShort } from "@/lib/unit";
import { dateRu, fmtNum, moneyShort } from "@/lib/format";
import { prixodJournal, prixodTotals } from "@/lib/receipts";
import { rasxodJournal, rasxodTotals } from "@/lib/stock-issue";
import { materialTurnover, type TurnoverRow } from "@/lib/stock-turnover";
import { canDo } from "@/lib/permissions";
import type { MobileUser } from "./auth";
import { reportRows } from "./sex";
import { brigIssuesList, brigShiftsList, brigTasksList } from "./brigadier";
import type { HomeRow, Tone } from "./home";
import type { LeadStatus, PayMethod, Prisma, Role, SupplyDelivery, SupplyPriority, SupplyStatus } from "@/generated/prisma";
import { DELIVERY_LABEL, PRIORITY_LABEL } from "@/lib/procurement-const";
import { MECH_STATUS_SHORT, MECH_STATUS_TONE, MECH_TABS, mechSubject, mechTab, mechanicCounts, mechanicList, tabCount } from "@/lib/mechanic-requests";
import { arendaDebtorsList, arendaJurnalList, arendaShopsList, arendaSvetList } from "./arenda";
import { OPEN_STATUSES, PAYREQ_STATUS_LABEL, PAYREQ_STATUS_TONE, PAYREQ_TABS, listPaymentRequests, methodsFor, payReqCounts, payReqTab, type PayReqRow } from "@/lib/payment-requests";
import { HR_ACCESS, HR_KEY_MODULE } from "./hr-access";
import { hrList } from "./hr";
import { KADR_ACCESS, KADR_KEY_MODULE } from "./kadr-access";
import { kadrList } from "./kadr-extra";
import { SKLAD_ACCESS, SKLAD_DETAIL_KEY, SKLAD_DETAIL_ROLES, SKLAD_KEY_MODULE, SKLAD_LISTS } from "./sklad-extra-access";
import { parseSkladFilter, skladJournalFilters, skladList } from "./sklad-extra";
import { DIREKTOR_ACCESS, DIREKTOR_KEY_MODULE } from "./direktor-extra-access";
import { direktorList } from "./direktor-extra";
import { LOGI_ACCESS, LOGI_DETAIL_KEY, LOGI_KEY_MODULE } from "./logistika-access";
import { logiList, tripsList } from "./logistika-extra";
import { tasksList } from "./sex-extra";
import { cashflowList, kirimQqsList, openingsList, paymentsList, realizatsiyaList, unpaidReceiptsList } from "./moliya-extra";
import { SOTUV_ACCESS, SOTUV_DETAIL_KEY, SOTUV_KEY_MODULE } from "./sotuv-access";
import { sotuvList } from "./sotuv-extra";

/**
 * Mobil ilovaning "ish" tabi — rolning asosiy ro'yxati.
 * Ruxsat veb ERP'dagi bilan bir xil mantiqda: rol ro'yxatda bo'lsa yoki DIRECTOR bo'lsa.
 */
/** Ro'yxat ustidagi filtr chipi — `count` ilovada chip ichida ko'rsatiladi (bo'lmasa — faqat yorliq, masalan davr chiplari). */
export type ListFilter = { key: string; label: string; count?: number; active: boolean };
export type MobileList = { key: string; title: string; rows: HomeRow[]; filters?: ListFilter[] };

/**
 * Ro'yxat kalitlari va kim kira olishi. Rollar veb ERP menyusi (`lib/nav.ts`) bilan bir xil:
 * vebda bo'lim ko'ringan xodim ilovada ham shu bo'limni ko'radi. Farqlar izohda.
 * Tartib — bosh ekrandagi "Tezkor amallar" to'rining tartibi.
 */
const ACCESS: Record<string, { title: string; roles: Role[]; menuHide?: Role[] }> = {
  // ── Sotuv ──
  // AGENT — faqat o'zi kiritgan zayavkalar (ownership `mobileList` da filtrlanadi)
  orders: { title: "Zayavkalar", roles: ["AGENT", "SALES", "PRODUCTION", "SUPERVISOR", "LOGISTICS", "ACCOUNTING", "FINANCE"] },
  sales: { title: "Sotuv", roles: ["SALES", "PRODUCTION", "LOGISTICS", "ACCOUNTING", "FINANCE"] },
  // AGENT — faqat o'ziga biriktirilgan mijozlar (ownership `mobileList` da filtrlanadi).
  // Buxgalteriya kabinetida Mijozlar bo'limi yo'q (`menuHide`, vebda ham): ruxsat qoladi — qarzdorlar «Barchasi», schyot va to'lovdan ochiladi
  customers: { title: "Mijozlar", roles: ["AGENT", "SALES", "ACCOUNTING", "FINANCE"], menuHide: ["ACCOUNTING"] },
  leads: { title: "Sayt arizalari", roles: ["SALES"] },
  // Tijorat takliflari, e-commerce, marketing (kontent, target, statistika) — `./sotuv-access.ts`
  ...SOTUV_ACCESS,
  // CASHIER veb ERP'da schyotlar sahifasiga kirmaydi, lekin to'lov aynan schyot ustida olinadi —
  // mobil ilovada kassir schyotni ochib, shu yerdan to'lovni kiritadi.
  invoices: { title: "Schyotlar", roles: ["ACCOUNTING", "FINANCE", "SALES", "CASHIER"] },
  // ── Ishlab chiqarish ──
  production: { title: "Zameslar", roles: ["PRODUCTION", "SUPERVISOR"] },
  recipes: { title: "Retseptlar", roles: ["PRODUCTION"] },
  // BRIGADIER — faqat o'z brigadasiga tayinlanganlar (`myBrigadeIds`)
  tasks: { title: "Topshiriqlar", roles: ["SUPERVISOR", "PRODUCTION", "SALES", "LOGISTICS", "BRIGADIER"] },
  brigades: { title: "Brigadalar", roles: ["SUPERVISOR", "PRODUCTION", "HR", "SALES"] },
  // Qayd etilgan kunlik hisobotlar — sex yozadi, direktor o'qiydi (`./sex.ts`)
  "prod-report": { title: "Ishlab chiqarish hisobotlari", roles: ["PRODUCTION", "SUPERVISOR"] },
  // Brigadir bildirgan muammolar — har bo'lim o'zi mas'ul turlarni ko'radi (`lib/brigade-shift.ts` BRIGADE_ISSUE).
  // Sklad ro'yxatsiz: ilovadagi bo'limlaridan olib tashlangan; o'ziga tegishli muammo bildirishnomadan ochiladi (`detail.ts` ISSUE_RESOLVERS).
  // Mexanik — uskuna nosozligining egasi (`BRIGADE_ISSUE.EQUIPMENT`)
  "brig-issues": { title: "Brigada muammolari", roles: ["BRIGADIER", "PRODUCTION", "SUPERVISOR", "PROCUREMENT", "MECHANIC", "HR"] },
  // Brigadir yopgan smena hisobotlari (`./brigadier.ts`)
  "brig-shifts": { title: "Smena hisobotlari", roles: ["BRIGADIER", "PRODUCTION", "SUPERVISOR"] },
  // ── Logistika ──
  trips: { title: "Reyslar", roles: ["LOGISTICS", "PRODUCTION", "SUPERVISOR", "DRIVER", "MECHANIC"] },
  drivers: { title: "Haydovchilar", roles: ["LOGISTICS", "HR"] },
  // ── Sklad ──
  stock: { title: "Sklad", roles: ["WAREHOUSE", "PROCUREMENT", "PRODUCTION", "ACCOUNTING", "SALES", "LOGISTICS", "MECHANIC"] },
  // Snabjeniye oynasi: narx kutayotgan va qabul kutayotgan so'rovlar (vebdagi `/snabjeniye`).
  // Sklad ham snabjeniye amallarini bajaradi (narx, yetkazish, qabul — `supply.*` ruxsatlari), vebda ham /snabjeniye ochiq;
  // 2026-10-13 da olib tashlangan edi, 2026-10-16 foydalanuvchi qaytarishni so'radi
  snabjeniye: { title: "Snabjeniye", roles: ["PROCUREMENT", "WAREHOUSE"] },
  // Ta'minot zayavkalari: vebda ro'yxat sklad/snabjeniye/ishlab chiqarishga, hujjatning o'zi esa
  // zanjirdagi hammaga ochiq (`/taminot/[id]`). Ilovada ro'yxat ham zanjirdagi hammaga — sotuvchi
  // tasdiq kutayotganlarni, moliya pul kutayotganlarni shu yerdan ochadi (vebdagi tasdiq kartalari o'rnida).
  supply: { title: "Ta'minot zayavkalari", roles: ["WAREHOUSE", "PROCUREMENT", "PRODUCTION", "SALES", "FINANCE", "ACCOUNTING", "CASHIER"] },
  receipts: { title: "Kirimlar", roles: ["PROCUREMENT", "WAREHOUSE", "SALES"] },
  suppliers: { title: "Yetkazuvchilar", roles: ["WAREHOUSE", "PROCUREMENT", "ACCOUNTING"] },
  // Sklad jurnallari — vebdagi Sklad → «Kirim», «Chiqim», «Qoldiqlar» (foydalanuvchi Excel'idagi ustunlar bilan; `skladList`)
  prixod: { title: "Kirim", roles: ["WAREHOUSE", "PROCUREMENT"] },
  rasxod: { title: "Chiqim", roles: ["WAREHOUSE", "PROCUREMENT"] },
  ostatki: { title: "Qoldiqlar", roles: ["WAREHOUSE", "PROCUREMENT"] },
  // ── Moliya ──
  cashflow: { title: "Kirim-chiqim", roles: ["CASHIER", "ACCOUNTING", "FINANCE"] },
  payments: { title: "To'lovlar", roles: ["CASHIER", "ACCOUNTING", "FINANCE"] },
  // Mexanik so'rovlari ("Kirim"): mexanik — faqat o'zinikini (`kirimList`), ish boshqaruvchi va kassa — hammasini
  kirim: { title: "Mexanik so'rovlari", roles: ["MECHANIC", "SUPERVISOR", "CASHIER"] },
  // Zayavka bosh to'lovi (`lib/payment-requests.ts`): kassir — naqd, buxgalter — perechisleniye, moliya — ikkalasi faqat ko'rish
  payreq: { title: "Pul qabul qilish", roles: ["CASHIER", "ACCOUNTING", "FINANCE"] },
  // Moliya qo'shimchalari (`./moliya-extra.ts`): to'lanmagan kirimlar (veb Kirim-Chiqim tepasida), Kirim QQS reyestri,
  // Boshlang'ich qoldiqlar (ko'rish + yetkazuvchi qarzini to'lash), Realizatsiya jurnali (veb Kassa/bank → jurnal tabi)
  "unpaid-receipts": { title: "To'lanmagan kirimlar", roles: ["CASHIER", "ACCOUNTING", "FINANCE"] },
  "kirim-qqs": { title: "Kirim QQS", roles: ["ACCOUNTING", "FINANCE"] },
  openings: { title: "Boshlang'ich qoldiqlar", roles: ["ACCOUNTING", "FINANCE"] },
  realizatsiya: { title: "Realizatsiya jurnali", roles: ["CASHIER", "ACCOUNTING", "FINANCE"] },
  // ── Arenda (do'konlar ijarasi, `./arenda.ts`) — sekretar; vebdagi `/arenda` sahifasi bilan bir xil ──
  "arenda-jurnal": { title: "Kirim-chiqim jurnali", roles: ["SECRETARY"] },
  "arenda-shops": { title: "Do'konlar", roles: ["SECRETARY"] },
  "arenda-debtors": { title: "Qarzdorlar", roles: ["SECRETARY"] },
  "arenda-svet": { title: "Svet hisobi", roles: ["SECRETARY"] },
  // ── Boshqaruv ──
  // PRODUCTION/SUPERVISOR shu yerdan brigadir biriktiradi (veb "Brigadalar" sahifasidagidek)
  employees: { title: "Xodimlar", roles: ["HR", "LOGISTICS", "PRODUCTION", "SUPERVISOR"] },
  // ── Faqat direktor (roles bo'sh — DIRECTOR har doim o'tadi) ──
  // Tasdiqlar: bloklangan zayavka, ta'minot tasdig'i/to'lovi — ilovadagi ikkinchi tab
  approvals: { title: "Tasdiqlar", roles: [] },
  // Bugun kim nima qildi — bosh sahifadagi "Bugungi holat" dan ochiladi
  activity: { title: "Xodimlar faoliyati", roles: [] },
  // ── Otdel kadr: arizalar, smena grafigi, ish haqi (`./hr.ts`) — o'z arizasi / grafigi / oyligi har bir xodimga ──
  ...HR_ACCESS,
  // Otdel kadr kabineti (veb `/otdel-kadr` tablari) — `./kadr-extra.ts`
  ...KADR_ACCESS,
  // ── Direktor kabineti: BI tahlil (moliya, buxgalteriya ham), ilova foydalanuvchilari, xarajat byudjeti (`./direktor-extra.ts`) ──
  ...DIREKTOR_ACCESS,
  // ── Sklad / snabjeniye: tayyor mahsulot, ishlab chiqarish imkoni, brigadalar skladi, «Kimga» oluvchilari (`./sklad-extra.ts`) ──
  ...SKLAD_ACCESS,
  // ── Logistika kabineti: buyurtmalar, kalendar, transport, yoqilg'i, xarajat, nakladnoy, yetkazish, hisobot, obyektlar (`./logistika-extra.ts`) ──
  ...LOGI_ACCESS,
};

/** Ro'yxat kaliti → kartochka kaliti (bir xil hujjat bir nechta ro'yxatda chiqadi). */
// Ro'yxat kaliti → kartochka kaliti. "brig-issues"/"brig-shifts" ro'yxati qatorlari oddiy id bilan keladi —
// ilova `/erp/brig-issues/<id>` ni ochadi; bu xaritasiz kartochka "Bunday kartochka yo'q" (brigadirda — "ruxsat yo'q") bo'lardi.
// «Kirim» qatori — kirim kartochkasi (id `<receiptId>~<itemId>`: bir kirimning qatorlari takrorlanmasin, `detail.ts` `~` dan keyingisini tashlaydi).
// «Chiqim» qatori id'si `stock:<materialId>~<n>` (splitRef — xomashyo kartochkasi), «Chiqim» kartochkasi esa berish hujjati (`rasxod`, id = ref).
// «Qoldiqlar» qatori — xomashyo kartochkasi (id — xomashyo), birinchi qator — jami (`detail.ts` `ostatki`).
export const DETAIL_KEY: Record<string, string> = { sales: "orders", snabjeniye: "supply", drivers: "employees", "brig-issues": "brig-issue", "brig-shifts": "brig-shift", prixod: "receipts", "arenda-jurnal": "arenda-tx", "arenda-shops": "arenda-shop", "arenda-debtors": "arenda-shop", "arenda-svet": "arenda-shop", ...SKLAD_DETAIL_KEY, ...LOGI_DETAIL_KEY, ...SOTUV_DETAIL_KEY };

/** Ta'minot ro'yxatida rol qaysi bosqichni birinchi ko'radi — vebdagi tasdiq kartalari bilan bir xil. */
const SUPPLY_DEFAULT: Partial<Record<Role, string>> = {
  SALES: "PRICED", FINANCE: "APPROVED", ACCOUNTING: "APPROVED", CASHIER: "APPROVED",
  PROCUREMENT: "NEW", WAREHOUSE: "open", PRODUCTION: "open",
};

const LEAD_LABEL: Record<LeadStatus, string> = { NEW: "Yangi", IN_PROGRESS: "Bog'lanildi", CONVERTED: "Mijoz bo'ldi", REJECTED: "Bekor" };
const LEAD_TONE: Record<LeadStatus, Tone> = { NEW: "brand", IN_PROGRESS: "warning", CONVERTED: "success", REJECTED: "danger" };
const SUPPLY_TONE: Record<SupplyStatus, Tone> = { NEW: "info", PRICED: "warning", APPROVED: "warning", FUNDED: "brand", RECEIVED: "success", REJECTED: "danger" };

/**
 * Ro'yxat/kartochka kaliti → veb modul (`lib/nav.ts` MODULES). Direktor xodimga modulni "yo'q" (`none`)
 * qilib qo'ysa, vebdagi kabi ilovada ham ro'yxat ham, kartochka ham ochilmaydi.
 */
const KEY_MODULE: Record<string, string> = {
  orders: "orders", sales: "sales", leads: "sales", customers: "customers",
  invoices: "payments", payments: "payments", cashflow: "cashflow",
  production: "production", recipes: "production", "prod-report": "production", defect: "production",
  tasks: "tasks", brigades: "tasks",
  trips: "trips", drivers: "trips",
  stock: "stock", snabjeniye: "stock", receipts: "stock", suppliers: "stock",
  prixod: "stock", rasxod: "stock", ostatki: "stock",
  supply: "taminot", employees: "employees", kirim: "mexanik", payreq: "payments",
  "arenda-jurnal": "arenda", "arenda-shops": "arenda", "arenda-tx": "arenda", "arenda-shop": "arenda", "arenda-debtors": "arenda", "arenda-svet": "arenda",
  "unpaid-receipts": "cashflow", "kirim-qqs": "kirim-qqs", openings: "opening", realizatsiya: "payments",
  ...HR_KEY_MODULE,
  ...KADR_KEY_MODULE,
  ...DIREKTOR_KEY_MODULE,
  ...SKLAD_KEY_MODULE,
  ...LOGI_KEY_MODULE,
  ...SOTUV_KEY_MODULE,
};

/** Modul direktor tomonidan yopilganmi. Haydovchining reyslari va brigadirning topshiriqlari — o'z ishi, yopilmaydi. */
export function moduleClosed(user: Pick<MobileUser, "role" | "perms">, key: string): boolean {
  if (user.role === "DIRECTOR") return false;
  if ((user.role === "DRIVER" && key === "trips") || (user.role === "BRIGADIER" && key === "tasks")) return false;
  const mod = Object.hasOwn(KEY_MODULE, key) ? KEY_MODULE[key] : undefined;
  return !!mod && user.perms?.[mod] === "none";
}

/**
 * Sklad jurnallari — ISTISNO (faqat shu 3 kalit): direktor bergan `stock` amali ham ochadi (veb `lib/stock-journal-access.ts`
 * kabi), rol ACCESS ro'yxatida bo'lmasa ham. Kirim — «receipt», Chiqim — «issue», Qoldiqlar — kirim / berish / «Dona narxi»
 * amallaridan biri (qoldiq va narxni ko'rmay narx qo'yib yoki berib bo'lmaydi). Kartochkalar ham shu qoida (`detail.ts`).
 */
const JOURNAL_GRANT: Record<string, readonly string[]> = { prixod: ["receipt"], rasxod: ["issue"], ostatki: ["receipt", "issue", "price"] };
export function journalGranted(user: Pick<MobileUser, "role" | "perms">, key: string): boolean {
  const acts = Object.hasOwn(JOURNAL_GRANT, key) ? JOURNAL_GRANT[key] : undefined;
  return !!acts && acts.some((a) => canDo({ role: user.role, perms: user.perms }, "stock", a));
}

/** Ro'yxatga (va u bilan bog'liq ekranlarga, masalan reys marshrutiga) kira oladimi: rol + direktor yopmagan modul. */
export function listAllowed(user: Pick<MobileUser, "role" | "perms">, key: string): boolean {
  const meta = Object.hasOwn(ACCESS, key) ? ACCESS[key] : undefined; // "constructor" kabi prototip kalitlari — ro'yxat emas
  if (!meta) return false;
  return (user.role === "DIRECTOR" || meta.roles.includes(user.role) || journalGranted(user, key)) && !moduleClosed(user, key);
}

/**
 * Shu rol kira oladigan barcha ro'yxatlar — bosh ekrandagi tezkor amallar uchun.
 * `menuHide` — shu rollarning to'rida ko'rinmaydi (veb `lib/nav.ts` dagi kabi), lekin ruxsat (`listAllowed`) qoladi.
 */
export function listsFor(role: Role, perms?: MobileUser["perms"]) {
  return Object.entries(ACCESS)
    .filter(([key, m]) => role === "DIRECTOR" || (m.roles.includes(role) && !m.menuHide?.includes(role)) || journalGranted({ role, perms }, key))
    .filter(([key]) => !moduleClosed({ role, perms }, key))
    .map(([key, m]) => ({ key, title: m.title }));
}

export class ListError extends Error {
  constructor(readonly code: string, message: string, readonly status: number, readonly extra?: Record<string, unknown>) { super(message); }
}

const sum = (n: unknown) => Number(n ?? 0);
const money = (n: number) => `${Math.round(n).toLocaleString("ru-RU")} so'm`;
const m3 = (n: number) => `${n.toFixed(n % 1 ? 1 : 0)} m³`;
const day = (d: Date) => d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" });
const TRIP_TONE: Record<string, Tone> = { PLANNED: "info", LOADED: "warning", ON_ROAD: "brand", DELIVERED: "success", CANCELLED: "danger" };

const TAKE = 60;

/** Zayavkalar ro'yxati ishlab chiqarish ko'rinishida chiqadigan rollar (veb "/production" bilan bir xil). */
const PROD_VIEW: Role[] = ["PRODUCTION", "SUPERVISOR"];

export async function mobileList(user: MobileUser, key: string, q?: string, filter?: string): Promise<MobileList> {
  const meta = Object.hasOwn(ACCESS, key) ? ACCESS[key] : undefined; // "constructor" kabi prototip kalitlari — ro'yxat emas
  if (!meta) throw new ListError("UNKNOWN_LIST", "Bunday ro'yxat yo'q", 404);
  if (user.role !== "DIRECTOR" && !meta.roles.includes(user.role) && !journalGranted(user, key)) throw new ListError("FORBIDDEN", "Bu bo'limga ruxsat yo'q", 403);
  if (moduleClosed(user, key)) throw new ListError("FORBIDDEN", "Bu bo'limga ruxsat yo'q", 403);
  const s = q?.trim() || undefined;
  // Ishlab chiqarish uchun zayavkalar veb "/production" oynasidagidek: filtrlar va brigada holati bilan
  if (key === "orders" && PROD_VIEW.includes(user.role)) return productionOrders(meta.title, s, filter);
  // Sotuv kabineti: zayavka / sotuv / mijoz / schyot filtrlari (agent egaligi bilan), takliflar, e-commerce, marketing (`./sotuv-extra.ts`)
  const sotuv = await sotuvList(user, key, meta.title, s, filter);
  if (sotuv) return sotuv;
  if (key === "approvals") return approvalsList(meta.title, s, filter);
  if (key === "activity") return activityList(meta.title, s);
  if (key === "prod-report") return { key, title: meta.title, rows: await reportRows() };
  if (Object.hasOwn(HR_ACCESS, key)) return hrList(user, key, s, filter);
  if (Object.hasOwn(KADR_ACCESS, key)) return kadrList(user, key, s, filter);
  if (Object.hasOwn(DIREKTOR_ACCESS, key)) return direktorList(user, key, meta.title, s, filter);
  if (Object.hasOwn(LOGI_ACCESS, key)) return logiList(user, key, meta.title, s, filter);
  // Reyslar — veb `/trips` dagi holat tablari va «Tarix» (haydovchidan boshqa rollar; haydovchiga — o'z reyslari)
  if (key === "trips" && user.role !== "DRIVER") return tripsList(user, meta.title, s, filter);
  // Filtr chipli ro'yxatlar — bosqich bo'yicha
  if (key === "supply") return supplyRequests(meta.title, s, filter ?? SUPPLY_DEFAULT[user.role] ?? "open");
  if (key === "kirim") return kirimList(user, s, filter);
  if (key === "arenda-jurnal") return arendaJurnalList(s, filter);
  if (key === "arenda-shops") return arendaShopsList(s, filter);
  if (key === "arenda-debtors") return arendaDebtorsList(s, filter);
  if (key === "arenda-svet") return arendaSvetList(s, filter);
  if (key === "payreq") return payreqList(user, meta.title, s, filter);
  if (key === "payments") return paymentsList(meta.title, s, filter);
  if (key === "cashflow") return cashflowList(meta.title, s, filter);
  if (key === "unpaid-receipts") return unpaidReceiptsList(meta.title, s);
  if (key === "kirim-qqs") return kirimQqsList(meta.title, s, filter);
  if (key === "openings") return openingsList(meta.title, s, filter);
  if (key === "realizatsiya") return realizatsiyaList(meta.title, s, filter);
  if (key === "snabjeniye") return snabjeniye(meta.title, s, filter);
  if (key === "leads") return leads(meta.title, s, filter);
  if (key === "brig-issues") return brigIssuesList(user, meta.title, s, filter);
  if (key === "brig-shifts") return brigShiftsList(user, meta.title, s);
  // Sklad / snabjeniye qo'shimcha ro'yxatlari (`./sklad-extra.ts`)
  if (SKLAD_LISTS.has(key)) return skladList(user, key, meta.title, s, filter);
  // Sklad jurnallari (ruscha) — davr chiplari bilan
  if (key === "prixod") return prixodList(meta.title, s, filter);
  if (key === "rasxod") return rasxodList(user, meta.title, s, filter);
  if (key === "ostatki") return ostatkiList(meta.title, s, filter);
  if (key === "tasks" && user.role === "BRIGADIER") return brigTasksList("Topshiriqlarim", await myBrigadeIds(user.id), s, filter);
  // Qolganlarga — veb `/tasks` dagi holat tablari va brigada filtri bilan (`./sex-extra.ts`)
  if (key === "tasks") return tasksList(meta.title, s, filter);
  // Haydovchi faqat o'ziga biriktirilgan reyslarni ko'radi
  const driverId = user.role === "DRIVER" ? await driverEmployeeId(user.id) : undefined;
  // Brigadir faqat o'z brigadasiga tayinlangan topshiriqlarni ko'radi
  const brigadeIds = user.role === "BRIGADIER" ? await myBrigadeIds(user.id) : undefined;
  // Sotuv agentining zayavka va mijozlar ro'yxati (egalik bilan) — `sotuvList` da
  const rows = await build(key, s, driverId, brigadeIds);
  const title = user.role === "DRIVER" && key === "trips" ? "Mening reyslarim"
    : user.role === "BRIGADIER" && key === "tasks" ? "Topshiriqlarim"
    : user.role === "AGENT" && key === "orders" ? "Zayavkalarim"
    : user.role === "AGENT" && key === "customers" ? "Mijozlarim"
    : meta.title;
  return { key, title, rows };
}

/**
 * "Zayavkalar" — ishlab chiqarish ko'rinishi: filtr chiplari (Ochiq, Bugungilar, Muddati yaqin,
 * Brigada kutayotgan, Zarur, Tugallanganlar, Hammasi) va har qatorda brigada holati.
 * Sanoq qoidalari `lib/production.ts` da — veb sahifadagi raqamlar bilan bir xil chiqadi.
 */
async function productionOrders(title: string, q?: string, filter?: string): Promise<MobileList> {
  const all = await db.order.findMany({
    where: {
      status: { not: "CANCELLED" },
      ...(q ? { OR: [{ orderNo: { contains: q, mode: "insensitive" } }, { customer: { name: { contains: q, mode: "insensitive" } } }, { deliveryAddress: { contains: q, mode: "insensitive" } }] } : {}),
    },
    orderBy: { deliveryDate: "asc" }, take: 400,
    include: { customer: true, items: { include: { product: true, brigade: true, task: true } } },
  });
  const f = prodFilter(filter);
  const rows = prodSort(all.filter(f.test)).slice(0, TAKE).map((o) => {
    const ok = assigned(o);
    const done = isDone(o);
    const brigades = [...new Set(o.items.map((i) => i.brigade?.name).filter(Boolean))].join(", ");
    return {
      id: o.id,
      title: `${o.orderNo} · ${o.customer.name}${o.isUrgent ? " · zarur" : ""}`,
      subtitle: `${o.dateUnknown ? "Sana aniq emas" : `${day(o.deliveryDate)}${o.deliveryTime ? ` ${o.deliveryTime}` : ""}`} · ${isOpen(o) && !o.dateUnknown ? dueLabel(o.deliveryDate) : o.deliveryAddress}${brigades ? ` · ${brigades}` : ""}`,
      right: m3(o.items.reduce((s, i) => s + sum(i.qtyM3), 0)),
      status: done ? "Tugallandi" : ok ? "Brigada tayinlangan" : partlyAssigned(o) ? "Qisman tayinlangan" : "Brigada kutmoqda",
      tone: (done ? "success" : isSoon(o) ? "danger" : ok ? "brand" : "warning") as Tone,
    };
  });
  return {
    key: "orders", title, rows,
    filters: PRODUCTION_FILTERS.map((x) => ({ key: x.key, label: x.label, count: all.filter(x.test).length, active: x.key === f.key })),
  };
}

const supplyInclude = { items: true, warehouse: true, supplier: true, createdBy: { select: { fullName: true } } } as const;
type SupplyRow = {
  id: string; docNo: string; status: SupplyStatus; date: Date; needBy: Date | null; recheck: number; deliveryCost: unknown;
  warehouse: { name: string }; supplier: { name: string } | null; items: { qty: unknown; price: unknown; factQty?: unknown; factPrice?: unknown }[];
  department?: string | null; priority?: SupplyPriority; deliveryStatus?: SupplyDelivery | null; eta?: Date | null;
};

/** Ta'minot zayavkasi qatori — hamma ro'yxatda bir xil ko'rinadi. Pul ajratilgandan keyin holat = yetkazish holati. */
const supplyRow = (r: SupplyRow): HomeRow => {
  const due = r.status === "FUNDED" && r.eta ? r.eta : r.needBy;
  const late = !!due && due < startOfToday() && r.status !== "RECEIVED" && r.status !== "REJECTED";
  const delivery = r.status === "FUNDED" && r.deliveryStatus ? r.deliveryStatus : null;
  return {
    id: r.id,
    title: `${r.docNo} · ${r.department ?? r.warehouse.name}${r.priority && r.priority !== "NORMAL" ? ` · ${PRIORITY_LABEL[r.priority].toLowerCase()}` : ""}${r.recheck ? " · qayta tasdiq" : ""}`,
    subtitle: `${day(r.date)} · ${r.items.length} qator${r.supplier ? ` · ${r.supplier.name}` : ""}${due ? ` · ${r.status === "FUNDED" && r.eta ? "ETA" : "kerak"} ${day(due)}` : ""}${late ? " · kechikdi" : ""}`,
    right: r.status === "NEW" ? `${r.items.length} nom` : money(totalPlanned({ items: r.items as { qty: number; price: number }[], deliveryCost: r.deliveryCost as number })),
    status: delivery ? DELIVERY_LABEL[delivery] : SUPPLY_LABEL[r.status],
    tone: late || delivery === "PROBLEM" ? "danger" : r.priority === "CRITICAL" ? "danger" : SUPPLY_TONE[r.status],
  };
};
const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };

const supplyWhere = (q?: string) => (q ? { OR: [{ docNo: { contains: q, mode: "insensitive" as const } }, { items: { some: { name: { contains: q, mode: "insensitive" as const } } } }, { supplier: { name: { contains: q, mode: "insensitive" as const } } }] } : {});

/**
 * Ta'minot zayavkalari — vebdagi `/taminot` bilan bir xil bosqich tablari.
 * Sotuvchi "Tasdiq kutmoqda", moliya "Moliya kutmoqda" bilan ochadi (`SUPPLY_DEFAULT`).
 */
async function supplyRequests(title: string, q?: string, filter?: string): Promise<MobileList> {
  const tab = SUPPLY_TABS.find((t) => t.key === filter) ?? SUPPLY_TABS[0];
  const [rows, counts] = await Promise.all([
    db.supplyRequest.findMany({ where: { status: { in: tab.status }, ...supplyWhere(q) }, orderBy: { date: "desc" }, take: TAKE, include: supplyInclude }),
    db.supplyRequest.groupBy({ by: ["status"], _count: { _all: true } }),
  ]);
  const by = (s: SupplyStatus[]) => counts.filter((c) => s.includes(c.status)).reduce((n, c) => n + c._count._all, 0);
  return {
    key: "supply", title, rows: rows.map(supplyRow),
    filters: SUPPLY_TABS.map((t) => ({ key: t.key, label: t.label, count: by(t.status), active: t.key === tab.key })),
  };
}

/**
 * Mexanik so'rovlari ("Kirim") — holat chiplari, sukut: hammasi, yangisi tepada. Mexanik faqat o'zinikini ko'radi.
 * Qator: sarlavha — mashina raqami yoki obyekt (shoshilinch belgisi bilan), o'ngda summa, holat — rangli.
 */
async function kirimList(user: MobileUser, q?: string, filter?: string): Promise<MobileList> {
  const own = user.role === "MECHANIC" ? user.id : null;
  const tab = mechTab(filter);
  const [rows, c] = await Promise.all([mechanicList({ status: tab.status, createdById: own, q, take: TAKE }), mechanicCounts(own)]);
  return {
    key: "kirim", title: own ? "Mening so'rovlarim" : "Mexanik so'rovlari",
    rows: rows.map((r) => ({
      id: r.id,
      title: `${mechSubject(r)}${r.urgent ? " · shoshilinch" : ""}`,
      subtitle: `${r.problem} · ${r.docNo} · ${day(r.createdAt)}${own ? "" : ` · ${r.createdBy.fullName}`}`,
      right: money(sum(r.amount)),
      status: MECH_STATUS_SHORT[r.status],
      tone: r.urgent && r.status === "NEW" ? "danger" : MECH_STATUS_TONE[r.status],
    })),
    filters: MECH_TABS.map((t) => ({ key: t.key, label: t.label, count: tabCount(c.counts, t), active: t.key === tab.key })),
  };
}

/**
 * Pul qabul qilish so'rovlari qaysi usulda ko'rinadi: qabul qila oladigani (`methodsFor` — kassir naqd, buxgalter bank,
 * direktor ikkalasi). Bo'sh bo'lsa (moliya yoki direktor amalni olib qo'ygan) — ikkala usul, faqat ko'rish (tugma chiqmaydi).
 */
export const payreqMethods = (user: Pick<MobileUser, "role" | "perms">): PayMethod[] => {
  const m = methodsFor(user);
  return m.length ? m : ["CASH", "BANK"];
};
const PAYREQ_METHOD_SHORT: Record<PayMethod, string> = { CASH: "Naqd", BANK: "Perechisleniye" };

/**
 * So'rov qatori — ro'yxat va bosh sahifa bir xil: «PS-… · Mijoz» / «Z-… · Naqd · muddat dd.mm» / qolgan summa.
 * Ochiqda o'ngda qolgan bosh to'lov, yopilganda tushgan (bekor qilinganda — so'ralgan) summa. Muddati o'tgan — qizil.
 */
export const payreqRow = (r: PayReqRow): HomeRow => {
  const open = OPEN_STATUSES.includes(r.status);
  return {
    id: r.id,
    title: `${r.docNo} · ${r.customer.name}`,
    subtitle: `${r.order.orderNo} · ${PAYREQ_METHOD_SHORT[r.method]} · muddat ${day(r.dueDate)}${r.overdue ? " · muddati o'tdi" : ""}`,
    right: money(open ? r.left : r.status === "RECEIVED" ? r.received : r.amount),
    status: PAYREQ_STATUS_LABEL[r.status],
    tone: r.overdue ? "danger" : PAYREQ_STATUS_TONE[r.status],
  };
};

/** «Pul qabul qilish» — veb kabinetdagi tablar bilan bir xil filtr chiplari (sonlari bilan), sukut «Ochiq». */
async function payreqList(user: MobileUser, title: string, q?: string, filter?: string): Promise<MobileList> {
  const methods = payreqMethods(user);
  const tab = payReqTab(filter);
  const [rows, counts] = await Promise.all([listPaymentRequests(tab, methods, { q, take: TAKE }), payReqCounts(methods)]);
  return {
    key: "payreq", title, rows: rows.map(payreqRow),
    filters: PAYREQ_TABS.map((t) => ({ key: t.key, label: t.label, count: counts[t.key], active: t.key === tab })),
  };
}

/**
 * Snabjeniye: narx qo'yiladigan (NEW/PRICED) va qabul qilinadigan (FUNDED) so'rovlar — vebdagi `/snabjeniye`,
 * ustiga TZ filtrlari: shoshilinch, tasdiqda, yo'lda, kechikkan, muammoli.
 */
async function snabjeniye(title: string, q?: string, filter?: string): Promise<MobileList> {
  const OPEN_S: SupplyStatus[] = ["NEW", "PRICED", "APPROVED", "FUNDED"];
  const today = startOfToday();
  const tabs: { key: string; label: string; where: Prisma.SupplyRequestWhereInput }[] = [
    { key: "price", label: "Narx qo'yish", where: { status: { in: ["NEW", "PRICED"] } } },
    { key: "urgent", label: "Shoshilinch", where: { status: { in: OPEN_S }, OR: [{ priority: { in: ["HIGH", "CRITICAL"] } }, { needBy: { lt: new Date(today.getTime() + 3 * 86400000) } }] } },
    { key: "approve", label: "Tasdiqda", where: { status: { in: ["PRICED", "APPROVED"] } } },
    { key: "receive", label: "Buyurtmalar", where: { status: "FUNDED" } },
    { key: "transit", label: "Yo'lda", where: { status: "FUNDED", deliveryStatus: "IN_TRANSIT" } },
    { key: "late", label: "Kechikkan", where: { status: { in: OPEN_S }, OR: [{ status: "FUNDED", eta: { lt: today } }, { eta: null, needBy: { lt: today } }, { status: { not: "FUNDED" }, needBy: { lt: today } }] } },
    { key: "problem", label: "Muammo", where: { status: { not: "REJECTED" }, incidents: { some: { resolvedAt: null } } } },
    { key: "done", label: "Qabul qilingan", where: { status: "RECEIVED" } },
  ];
  const tab = tabs.find((t) => t.key === filter) ?? tabs[0];
  const [rows, counts] = await Promise.all([
    db.supplyRequest.findMany({ where: { AND: [tab.where, supplyWhere(q)] }, orderBy: [{ priority: "desc" }, { date: "desc" }], take: TAKE, include: supplyInclude }),
    Promise.all(tabs.map((t) => db.supplyRequest.count({ where: t.where }))),
  ]);
  return { key: "snabjeniye", title, rows: rows.map(supplyRow), filters: tabs.map((t, i) => ({ key: t.key, label: t.label, count: counts[i], active: t.key === tab.key })) };
}

/** Sayt arizalari — holat bo'yicha tablar (vebdagi `/leads`). Yangi arizalar birinchi. */
async function leads(title: string, q?: string, filter?: string): Promise<MobileList> {
  const tabs: { key: string; label: string; status?: LeadStatus }[] = [
    { key: "NEW", label: "Yangi", status: "NEW" },
    { key: "IN_PROGRESS", label: "Bog'lanildi", status: "IN_PROGRESS" },
    { key: "CONVERTED", label: "Mijoz bo'ldi", status: "CONVERTED" },
    { key: "REJECTED", label: "Bekor", status: "REJECTED" },
    { key: "all", label: "Hammasi" },
  ];
  const tab = tabs.find((t) => t.key === filter) ?? tabs[0];
  const [rows, counts] = await Promise.all([
    db.lead.findMany({
      where: { ...(tab.status ? { status: tab.status } : {}), ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { phone: { contains: q } }, { address: { contains: q, mode: "insensitive" } }] } : {}) },
      orderBy: { createdAt: "desc" }, take: TAKE, include: { product: { select: { name: true, unit: true } } },
    }),
    db.lead.groupBy({ by: ["status"], _count: { _all: true } }),
  ]);
  const by = (s?: LeadStatus) => (s ? counts.find((c) => c.status === s)?._count._all ?? 0 : counts.reduce((n, c) => n + c._count._all, 0));
  return {
    key: "leads", title,
    rows: rows.map((l) => ({
      id: l.id, title: `${l.name} · ${l.phone}`,
      subtitle: `${day(l.createdAt)}${l.product ? ` · ${l.product.name}` : ""}${l.address ? ` · ${l.address}` : ""}`,
      right: l.qty && l.product ? `${sum(l.qty)} ${unitLabel(l.product.unit)}` : undefined,
      status: LEAD_LABEL[l.status], tone: LEAD_TONE[l.status],
    })),
    filters: tabs.map((t) => ({ key: t.key, label: t.label, count: by(t.status), active: t.key === tab.key })),
  };
}

// ───────────────────────── Sklad: «Kirim», «Chiqim», «Qoldiqlar» (Excel jurnallaridagidek) ─────────────────────────

/**
 * Davr chiplari — veb `StockPeriodBar` bilan bir xil chegaralar: mahalliy yarim tun, `to` eksklyuziv, hafta dushanbadan.
 * Sukut — «Oy» (joriy oy boshidan bugungacha, vebdagi standart davr).
 */
export const SKLAD_PERIODS = [
  { key: "today", label: "Bugun" },
  { key: "week", label: "Hafta" },
  { key: "month", label: "Oy" },
  { key: "prev", label: "O'tgan oy" },
] as const;
export type SkladPeriodKey = (typeof SKLAD_PERIODS)[number]["key"];
export type SkladPeriod = { key: SkladPeriodKey; label: string; from: Date; to: Date; /** «01.10.2026 — 13.10.2026» (bir kun bo'lsa — sana) */ range: string };

export function skladPeriod(key?: string | null, now = new Date()): SkladPeriod {
  const p = SKLAD_PERIODS.find((x) => x.key === key) ?? SKLAD_PERIODS[2];
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  let from = today;
  let to = new Date(today); to.setDate(to.getDate() + 1);
  if (p.key === "week") { from = new Date(today); from.setDate(today.getDate() - ((today.getDay() + 6) % 7)); }
  else if (p.key === "month") from = new Date(today.getFullYear(), today.getMonth(), 1);
  else if (p.key === "prev") { from = new Date(today.getFullYear(), today.getMonth() - 1, 1); to = new Date(today.getFullYear(), today.getMonth(), 1); }
  const last = new Date(to); last.setDate(last.getDate() - 1);
  return { key: p.key, label: p.label, from, to, range: from.getTime() === last.getTime() ? dateRu(from) : `${dateRu(from)} — ${dateRu(last)}` };
}

/** To'lov turi: bank o'tkazma (perechisleniye) yoki naqd pul (kassa); Excel'dagi «П-р» / «Н-к». */
export const PAY_LABEL = { BANK: "Bank o'tkazma", CASH: "Naqd pul" } as const;

/** Qisqa summa: «12,3 mln», «1,25 mlrd», «350 ming» (`moneyShort`, manfiyda «−»). */
export const shortSum = (v: number) => `${v < 0 ? "−" : ""}${moneyShort(Math.abs(v))}`;

/** Miqdor + qisqa birlik: «12,5 t». */
export const qtyUnit = (q: number, unit: string) => `${fmtNum(q, 3)} ${unitShort(unit)}`;

/**
 * Sarlavhada davr jami: 60 qatordan ko'pi ko'rsatilmaydi, lekin jami summa va qatorlar soni — butun davr bo'yicha.
 * Tartib «Kirim · 15 qator · 12,3 mln»: summa oxirida — rus tarjimasida «{0} · {1} qator» shabloni summani yutib yubormasin.
 */
const journalTitle = (title: string, n: number, total: number) => (n ? `${title} · ${n} qator · ${shortSum(total)}` : title);

/**
 * «Kirim» — kirimlarning har qatori (`lib/receipts.ts#prixodJournal`, storno qilingani belgi bilan + storno qatori), yangisi tepada.
 * Qator: «Xomashyo · miqdor birlik» / «dd.mm.yyyy · Kimdan · TTN · to'lov turi» / «+Jami». Kartochka — kirim (`receipts`).
 */
async function prixodList(title: string, q?: string, filter?: string): Promise<MobileList> {
  // Filtr: davr yoki `<davr>|<sklad>` — skladlar bir nechta bo'lsa sklad chiplari ham (`./sklad-extra.ts`)
  const { period: p, warehouseId } = parseSkladFilter(filter);
  const wf = await skladJournalFilters(p.key, warehouseId);
  const all = await prixodJournal({ from: p.from, to: p.to, q, warehouseId: wf.warehouse?.id });
  const t = prixodTotals(all);
  const rows = all.slice(-TAKE).reverse().map((r): HomeRow => ({
    id: `${r.receiptId}~${r.id}`,
    title: `${r.material} · ${qtyUnit(r.qty, r.unit)}`,
    subtitle: [dateRu(r.date), r.supplier, r.waybillNo ? `TTN ${r.waybillNo}` : null, r.payment ? PAY_LABEL[r.payment] : null].filter(Boolean).join(" · "),
    // Storno qilingan kirim o'z sanasida «Bekor qilindi», storno sanasida manfiy qator (jurnal = «Qoldiqlar» Kirim)
    right: r.storno ? `−${fmtNum(Math.abs(r.total))}` : `+${fmtNum(r.total)}`,
    tone: r.storno ? "danger" : "success",
    ...(r.storno ? { status: "Bekor qilish" } : r.cancelled ? { status: "Bekor qilindi" } : {}),
  }));
  return { key: "prixod", title: journalTitle(title, all.length, t.total), rows, filters: wf.filters };
}

/**
 * «Chiqim» — `lib/stock-issue.ts#rasxodJournal` (oluvchiga berish, brigada, zames, spisanie, inventarizatsiya), yangisi tepada.
 * Qator: «Xomashyo · miqdor birlik» / «dd.mm.yyyy · Kimga · to'lov turi» / «−Jami» (≈ — narxi taxminiy). Zames qatorlari
 * (Excel'dagi ko'k) — `info` rangida; brigadadan qaytish — «+». Bosilsa xomashyo kartochkasi (`stock:<id>~<n>`, id noyob bo'lsin).
 */
async function rasxodList(user: MobileUser, title: string, q?: string, filter?: string): Promise<MobileList> {
  const { period: p, warehouseId } = parseSkladFilter(filter);
  const wf = await skladJournalFilters(p.key, warehouseId);
  const s = q?.toLowerCase();
  const all = (await rasxodJournal({ from: p.from, to: p.to, warehouseId: wf.warehouse?.id })).filter((r) => !s || r.material.toLowerCase().includes(s) || r.to.toLowerCase().includes(s));
  const t = rasxodTotals(all);
  const oluvchiOk = user.role === "DIRECTOR" || (SKLAD_DETAIL_ROLES.oluvchi ?? []).includes(user.role);
  const rows = all.map((r, i) => ({ r, i })).slice(-TAKE).reverse().map(({ r, i }): HomeRow => {
    const back = r.qty < 0;
    const noPrice = r.price == null && Math.abs(r.total) < 0.005;
    return {
      // Berish hujjati (oluvchi / brigada, storno) — «Chiqim» kartochkasi (storno, oluvchi kartasi shu yerda);
      // brigadadan qaytish — brigada skladi; zames, spisanie, inventarizatsiya — xomashyo kartochkasi
      id: r.ref && (r.kind === "issue" || r.kind === "brigade" || r.kind === "storno") ? `rasxod:${r.ref}~${i}`
        : /^b:/.test(r.toKey) && oluvchiOk ? `oluvchi:b~${r.toKey.slice(2)}~${i}`
        : `stock:${r.materialId}~${i}`,
      title: `${r.material} · ${qtyUnit(Math.abs(r.qty), r.unit)}`,
      subtitle: [dateRu(r.date), r.to, r.payment ? PAY_LABEL[r.payment] : null].filter(Boolean).join(" · "),
      right: noPrice ? "narxsiz" : `${r.priceApprox ? "≈" : ""}${back ? "+" : "−"}${fmtNum(Math.abs(r.total))}`,
      tone: back ? "success" : r.kind === "prod" ? "info" : "danger",
      ...(r.kind === "storno" ? { status: "Bekor qilish" } : r.cancelled ? { status: "Bekor qilindi" } : {}),
    };
  });
  return { key: "rasxod", title: journalTitle(title, all.length, t.total), rows, filters: wf.filters };
}

/** «Qoldiqlar» jami qatorining id prefiksi: `jami~<davr>` — kartochkasi `detail.ts` da (`ostatki`). */
export const OSTATKI_SUM = "jami~";
/** Minimumdan kam (davr oxiridagi qoldiq bo'yicha) — veb «Qoldiqlar» va mobil «Sklad» ro'yxati bilan bir xil qoida. */
export const turnoverLow = (m: TurnoverRow) => m.close.q < m.minStock - 0.0005;
/** «Qoldiqlar» summalari yig'indisi (miqdor birliklari har xil — qo'shilmaydi). */
export function turnoverSums(rows: TurnoverRow[]) {
  const r2 = (v: number) => Math.round(v * 100) / 100 || 0;
  const s = (f: (m: TurnoverRow) => number) => r2(rows.reduce((a, m) => a + f(m), 0));
  return { open: s((m) => m.open.s), in: s((m) => m.in.s), out: s((m) => m.out.s), close: s((m) => m.close.s), approx: rows.some((m) => m.approx) };
}

/**
 * «Qoldiqlar» — xomashyo aylanmasi (`lib/stock-turnover.ts`, veb Sklad → Qoldiqlar bilan bir manba). Birinchi qator — jami
 * (summalar; bosilsa jami kartochkasi), keyin har xomashyo: «Nomi (birlik)» / «Boshida · Kirim · Chiqim» + «Dona narxi · Jami» /
 * davr oxiridagi qoldiq, minimumdan kam bo'lsa «Kam».
 * Ikki qatorli izohda qator ko'chishi « ·\n» bilan: rus tarjimasi matnni « · » bo'yicha bo'laklaydi (bo'shliqlar bittaga yig'iladi).
 */
async function ostatkiList(title: string, q?: string, filter?: string): Promise<MobileList> {
  const { period: p, warehouseId } = parseSkladFilter(filter);
  const wf = await skladJournalFilters(p.key, warehouseId);
  const s = q?.toLowerCase();
  const all = (await materialTurnover({ from: p.from, to: p.to, warehouseId: wf.warehouse?.id })).filter((m) => !s || m.name.toLowerCase().includes(s) || m.code.toLowerCase().includes(s));
  const sums = turnoverSums(all);
  const low = all.filter(turnoverLow).length;
  const ap = sums.approx ? "≈" : "";
  const head: HomeRow = {
    id: `${OSTATKI_SUM}${p.key}${wf.warehouse ? `|${wf.warehouse.id}` : ""}`,
    title: `Jami · ${all.length} ta xomashyo · ${p.label}${wf.warehouse ? ` · ${wf.warehouse.name}` : ""}`,
    subtitle: `Boshida ${shortSum(sums.open)} · Kirim ${shortSum(sums.in)} ·\nChiqim ${shortSum(sums.out)} · Jami ${ap}${shortSum(sums.close)}`,
    right: `${ap}${shortSum(sums.close)}`,
    ...(low ? { status: `Kam: ${low}`, tone: "warning" as Tone } : {}),
  };
  const rows = all.slice(0, TAKE - 1).map((m): HomeRow => {
    const price = m.unitPrice ?? m.avgCost;
    const priceText = price == null ? "Dona narxi yo'q" : `Dona narxi ${m.unitPrice == null ? "≈" : ""}${fmtNum(price, 2)}`;
    return {
      id: m.id,
      title: `${m.name} (${unitShort(m.unit)})`,
      subtitle: `Boshida ${fmtNum(m.open.q, 3)} · Kirim ${fmtNum(m.in.q, 3)} · Chiqim ${fmtNum(m.out.q, 3)} ·\n${priceText} · Jami ${m.approx ? "≈" : ""}${fmtNum(m.close.s)}`,
      right: qtyUnit(m.close.q, m.unit),
      ...(turnoverLow(m) ? { status: "Kam", tone: "danger" as Tone } : {}),
    };
  });
  return { key: "ostatki", title, rows: [head, ...rows], filters: wf.filters };
}

/** Login qilgan haydovchining xodim kartasi — reyslar shu id bo'yicha filtrlanadi. */
export async function driverEmployeeId(userId: string): Promise<string> {
  const e = await db.employee.findFirst({ where: { userId }, select: { id: true } });
  if (!e) throw new ListError("NO_EMPLOYEE", "Bu login xodim kartasiga bog'lanmagan — Otdel kadrga ayting", 403);
  return e.id;
}

/**
 * Login qilgan brigadirning brigadalari. Brigadir bo'lmasa ro'yxat ochilmaydi —
 * "hammaning topshirig'i" ko'rinib qolgandan ko'ra tushunarli xato yaxshiroq.
 */
export async function myBrigadeIds(userId: string): Promise<string[]> {
  const list = await myBrigades(userId);
  if (list.length === 0) throw new ListError("NO_BRIGADE", "Siz hali brigadaga brigadir qilib biriktirilmagansiz — ishlab chiqarishga ayting", 403);
  return list.map((b) => b.id);
}

async function build(key: string, q?: string, driverId?: string, brigadeIds?: string[]): Promise<HomeRow[]> {
  switch (key) {
    case "trips": {
      const list = await db.trip.findMany({
        where: {
          ...(driverId ? { driverId } : {}),
          ...(q ? { OR: [{ deliveryNoteNo: { contains: q, mode: "insensitive" } }, { order: { customer: { name: { contains: q, mode: "insensitive" } } } }] } : {}),
        },
        orderBy: { createdAt: "desc" }, take: TAKE, include: { order: { include: { customer: true } }, driver: true, vehicle: true },
      });
      return list.map((t) => ({ id: t.id, title: `${t.deliveryNoteNo} · ${t.order.customer.name}`, subtitle: `${t.driver.fullName} · ${t.vehicle.plate}${t.ecoStatus ? ` · ${ecoLabel(t.ecoStatus)?.label ?? t.ecoStatus}` : ""}`, right: m3(sum(t.qtyM3)), status: t.status, tone: t.ecoError ? "danger" : TRIP_TONE[t.status] }));
    }
    case "tasks": {
      const list = await db.brigadeTask.findMany({
        where: {
          ...(brigadeIds ? { brigadeId: { in: brigadeIds } } : {}),
          ...(q ? { OR: [{ taskNo: { contains: q, mode: "insensitive" } }, { brigade: { name: { contains: q, mode: "insensitive" } } }, { order: { customer: { name: { contains: q, mode: "insensitive" } } } }] } : {}),
        },
        orderBy: [{ status: "asc" }, { dueDate: "asc" }], take: TAKE,
        include: { brigade: true, order: { include: { customer: true } }, orderItem: { include: { product: true } } },
      });
      const now = new Date(); now.setHours(0, 0, 0, 0);
      return list.map((t) => {
        const unit = unitLabel(t.orderItem.product.unit);
        return {
        id: t.id,
        // Brigadirga o'z brigadasining nomi har qatorda takrorlanmaydi — mahsulot muhimroq
        title: brigadeIds ? `${t.taskNo} · ${t.orderItem.product.name}` : `${t.taskNo} · ${t.brigade.name}`,
        subtitle: `${t.order.customer.name} · muddat ${day(t.dueDate)}`,
        right: `${(sum(t.qty) - sum(t.doneQty)).toFixed(1)} / ${sum(t.qty)} ${unit}`,
        status: t.status,
        tone: t.status === "DONE" ? ("success" as Tone) : t.status === "CANCELLED" ? ("info" as Tone) : t.dueDate < now ? ("danger" as Tone) : ("warning" as Tone),
        };
      });
    }
    case "production": {
      const list = await db.productionBatch.findMany({
        where: q ? { OR: [{ batchNo: { contains: q, mode: "insensitive" } }, { product: { name: { contains: q, mode: "insensitive" } } }] } : undefined,
        orderBy: { date: "desc" }, take: TAKE, include: { product: true, order: { include: { customer: true } } },
      });
      // Storno qilingan zames tarixda qoladi, lekin aniq belgilanadi — hajmi qoldiqda yo'q
      return list.map((b) => ({
        id: b.id, title: `${b.batchNo} · ${b.product.name}`,
        subtitle: `${day(b.date)} · ${b.order ? b.order.customer.name : "Omborga"}${b.cancelledAt ? " · bekor qilingan" : ""}`,
        right: b.cancelledAt ? "bekor qilingan" : m3(sum(b.qtyM3)),
        status: b.cancelledAt ? "Bekor qilingan" : `${b.shift}-smena`,
        ...(b.cancelledAt ? { tone: "danger" as Tone } : {}),
      }));
    }
    case "stock": {
      const [materials, balances] = await Promise.all([
        db.material.findMany({ where: { isActive: true, ...(q ? { name: { contains: q, mode: "insensitive" } } : {}) }, orderBy: { name: "asc" } }),
        db.stockMove.groupBy({ by: ["materialId"], where: { materialId: { not: null } }, _sum: { qty: true } }),
      ]);
      const bal = new Map(balances.map((b) => [b.materialId, sum(b._sum.qty)]));
      return materials.map((m) => {
        const b = bal.get(m.id) ?? 0;
        const low = b < sum(m.minStock);
        return { id: m.id, title: m.name, subtitle: `${m.code} · minimum ${sum(m.minStock)} ${m.unit}`, right: `${b.toFixed(1)} ${m.unit}`, status: low ? "Kam" : undefined, tone: low ? "danger" : "success" };
      });
    }
    case "receipts": {
      const list = await db.goodsReceipt.findMany({
        where: q ? { OR: [{ docNo: { contains: q, mode: "insensitive" } }, { supplier: { name: { contains: q, mode: "insensitive" } } }] } : undefined,
        orderBy: { date: "desc" }, take: TAKE, include: { supplier: true, items: true },
      });
      // Storno qilingan kirim — summasi qoldiq va qarzga kirmaydi, ro'yxatda "Bekor qilingan" belgisi bilan
      return list.map((r) => ({
        id: r.id, title: `${r.docNo} · ${r.supplier.name}`,
        subtitle: `${day(r.date)} · ${r.items.length} qator${r.cancelledAt ? " · bekor qilingan" : ""}`,
        right: r.cancelledAt ? "bekor qilingan" : money(r.items.reduce((s, i) => s + lineTotal(i), 0)),
        ...(r.cancelledAt ? { status: "Bekor qilingan", tone: "danger" as Tone } : {}),
      }));
    }
    case "cashflow": {
      const list = await db.cashTransaction.findMany({
        // Boshlang'ich qoldiq (OPENING) kirim-chiqim emas — ro'yxatga tushmaydi
        where: { type: { not: "OPENING" }, ...(q ? { OR: [{ category: { contains: q, mode: "insensitive" } }, { counterparty: { contains: q, mode: "insensitive" } }] } : {}) },
        orderBy: { date: "desc" }, take: TAKE, include: { cashAccount: true },
      });
      // Hisoblararo o'tkazma ham o'z qatori bilan ko'rinadi (ishora — txSign, rang — "info")
      // Bekor qilingan yozuv ro'yxatda qoladi — «Bekor qilingan» holati bilan
      return list.map((t) => ({ id: t.id, title: `${t.category}${t.counterparty ? ` · ${t.counterparty}` : ""}`, subtitle: `${day(t.date)} · ${t.cashAccount.name}${t.cancelReason ? ` · ${t.cancelReason}` : ""}`, right: `${txSign(t.type) < 0 ? "−" : "+"}${money(sum(t.amount))}`, tone: t.cancelledAt ? "danger" : isTransfer(t.type) ? "info" : txSign(t.type) < 0 ? "danger" : "success", ...(t.cancelledAt ? { status: "Bekor qilingan" } : {}) }));
    }
    case "payments": {
      const list = await db.payment.findMany({
        where: q ? { customer: { name: { contains: q, mode: "insensitive" } } } : undefined,
        orderBy: { date: "desc" }, take: TAKE, include: { customer: true, cashAccount: true, invoice: true },
      });
      return list.map((p) => ({ id: p.id, title: p.customer.name, subtitle: `${day(p.date)} · ${p.cashAccount.name}${p.invoice ? ` · ${p.invoice.invoiceNo}` : ""}`, right: `+${money(sum(p.amount))}`, tone: "success" }));
    }
    case "employees": {
      const list = await db.employee.findMany({
        where: q ? { OR: [{ fullName: { contains: q, mode: "insensitive" } }, { position: { contains: q, mode: "insensitive" } }, { brigades: { some: { name: { contains: q, mode: "insensitive" } } } }] } : undefined,
        orderBy: [{ isActive: "desc" }, { fullName: "asc" }], take: TAKE,
        include: { brigades: { where: { isActive: true }, orderBy: { name: "asc" }, select: { name: true } } },
      });
      return list.map((e) => {
        const led = e.brigades.map((b) => b.name).join(", ");
        return {
          id: e.id,
          title: e.fullName,
          subtitle: `${e.position}${led ? ` · ${led} brigadiri` : ""}${e.phone ? ` · ${e.phone}` : ""}`,
          right: led ? "Brigadir" : undefined,
          status: e.isActive ? "Faol" : "Nofaol",
          tone: e.isActive ? "success" : "danger",
        };
      });
    }
    // Haydovchilar — haydovchi lavozimidagi xodimlar, texnikasi va ilova holati bilan (vebdagi `/drivers`)
    case "drivers": {
      const list = await db.employee.findMany({
        where: { position: { in: await driverPositionNames() }, ...(q ? { OR: [{ fullName: { contains: q, mode: "insensitive" } }, { phone: { contains: q } }, { vehicle: { plate: { contains: q, mode: "insensitive" } } }] } : {}) },
        orderBy: [{ isActive: "desc" }, { fullName: "asc" }], take: TAKE,
        include: { vehicle: { select: { plate: true } }, _count: { select: { trips: { where: { status: { in: ["PLANNED", "LOADED", "ON_ROAD"] } } } } } },
      });
      return list.map((e) => ({
        id: e.id, title: e.fullName,
        subtitle: `${e.vehicle ? e.vehicle.plate : "texnika biriktirilmagan"}${e.phone ? ` · ${e.phone}` : " · telefonsiz"}`,
        right: e._count.trips ? `${e._count.trips} ochiq reys` : undefined,
        status: !e.isActive ? "Nofaol" : e.ecoUserId ? (e.ecoActive ? "Ilova ulangan" : "Ilova nofaol") : "Ilova ulanmagan",
        tone: !e.isActive ? "danger" : e.ecoUserId && e.ecoActive ? "success" : e.ecoError ? "danger" : "warning",
      }));
    }
    // Brigadalar — brigadiri va ochiq topshiriqlari (vebdagi `/brigades`)
    case "brigades": {
      const list = await db.brigade.findMany({
        where: q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { leader: { fullName: { contains: q, mode: "insensitive" } } }] } : undefined,
        orderBy: [{ isActive: "desc" }, { name: "asc" }], take: TAKE,
        include: { leader: { select: { fullName: true, phone: true } }, _count: { select: { tasks: { where: { status: { in: ["NEW", "IN_PROGRESS"] } } } } } },
      });
      return list.map((b) => ({
        id: b.id, title: b.name,
        subtitle: b.leader ? `Brigadir: ${b.leader.fullName}${b.leader.phone ? ` · ${b.leader.phone}` : ""}` : "Brigadir biriktirilmagan",
        right: `${b._count.tasks} topshiriq`,
        status: b.isActive ? undefined : "Nofaol",
        tone: !b.isActive ? "info" : b.leader ? "success" : "warning",
      }));
    }
    // Yetkazuvchilar — oxirgi kirimi bilan (vebdagi `/suppliers`)
    case "suppliers": {
      const list = await db.supplier.findMany({
        where: q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { phone: { contains: q } }, { inn: { contains: q } }] } : undefined,
        orderBy: [{ isActive: "desc" }, { name: "asc" }], take: TAKE,
        include: { _count: { select: { receipts: true } }, receipts: { orderBy: { date: "desc" }, take: 1, select: { date: true } } },
      });
      return list.map((s) => ({
        id: s.id, title: s.name,
        subtitle: `${s.phone ?? "telefonsiz"}${s.inn ? ` · INN ${s.inn}` : ""}${s.receipts[0] ? ` · oxirgi kirim ${day(s.receipts[0].date)}` : ""}`,
        right: `${s._count.receipts} kirim`,
        status: s.isActive ? undefined : "Nofaol",
        tone: s.isActive ? "success" : "info",
      }));
    }
    // Retseptlar — har mahsulotning amaldagi retsepti (vebdagi `/recipes`); id — mahsulot id'si
    case "recipes": {
      const list = await db.product.findMany({
        where: { isActive: true, ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { code: { contains: q, mode: "insensitive" } }] } : {}) },
        orderBy: { code: "asc" }, take: TAKE,
        include: { recipes: { where: { isActive: true }, orderBy: { version: "desc" }, take: 1, include: { items: { include: { material: true, product: true } } } } },
      });
      return list.map((p) => {
        const r = p.recipes[0];
        return {
          id: p.id, title: `${p.code} · ${p.name}`,
          subtitle: r ? r.items.map((i) => { const ing = ingredientOf(i); return `${ing.name} ${ing.qtyPerM3} ${ing.unit}`; }).join(" · ") : "Retsept tuzilmagan",
          right: r ? `v${r.version}` : undefined,
          status: r ? `${r.items.length} tarkib` : "Yo'q",
          tone: r ? "success" : "warning",
        };
      });
    }
    default:
      return [];
  }
}
