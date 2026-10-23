import { db } from "@/lib/db";
import { HR_ACCESS, HR_ACTION_ROLES, SELF_CARDS } from "./hr-access";
import { hrDetail } from "./hr";
import { KADR_ACCESS, KADR_ACTION_ROLES, KADR_CARDS, KADR_PERM } from "./kadr-access";
import { kadrDetail, kadrEmployeeExtras } from "./kadr-extra";
import { DIREKTOR_ACTION_ROLES, DIREKTOR_CARDS, DIREKTOR_DETAIL_ROLES, DIREKTOR_PERM } from "./direktor-extra-access";
import { direktorDetail } from "./direktor-extra";
import { LOGI_ACTION_ROLES, LOGI_DETAIL_ROLES, LOGI_PERM } from "./logistika-access";
import { logiDetail, resolveIssueForm, withDriverExtras, withOrderTrip, withTripExtras } from "./logistika-extra";
import { TX_TYPE_LABEL, isTransfer, txSign } from "@/lib/cash-tx";
import { CANCELLED_LABEL, cancelNote, cancellerNames } from "@/lib/cancelled";
import { activityDetail, splitRef } from "./director";
import { customerCredit } from "@/lib/finance";
import { materialOutlook } from "@/lib/dashboard";
import { ecoEnabled } from "@/lib/eco/client";
import { ecoLabel } from "@/lib/eco/labels";
import { activeBrigades } from "@/lib/brigades";
import { driverPositionNames } from "@/lib/positions";
import { distanceLabel, tripArrival, tripSteps, tripTrackStats } from "@/lib/trips";
import { ISSUE_KIND, TRIP_PHASE, tripPhase, tripPlannedAt } from "@/lib/logistics";
import { lastFuelPrice } from "@/lib/logistics-costs";
import { customersHistory, STAR_LABELS } from "@/lib/finance";
import {
  DELIVERY_KINDS, SUPPLY_LABEL, SUPPLY_OWNER, SUPPLY_STEPS, hasFact, lastPurchasePrices, plannedSum, priceDelta, priceKey,
  supplyRequest, totalFact, totalPlanned, isOpenSupply, canRejectSupply,
} from "@/lib/supply";
import { DELIVERY_OWN } from "@/lib/supply-const";
import { directorLimit, needsDirector, responsibleOptions } from "@/lib/procurement";
import {
  DELIVERY_LABEL, DELIVERY_MANUAL, DEPARTMENTS, DOC_KINDS, INCIDENT_KINDS, INCIDENT_LABEL, PAYMENT_TERMS, PRIORITIES, PRIORITY_LABEL, REQUIRED_DOCS,
} from "@/lib/procurement-const";
import type { MobileUser } from "./auth";
import type { HomeSection, Tone } from "./home";
import { DETAIL_KEY, OSTATKI_SUM, PAY_LABEL, driverEmployeeId, journalGranted, listAllowed, moduleClosed, myBrigadeIds, payreqMethods, qtyUnit, shortSum, skladPeriod, turnoverLow, turnoverSums, ListError } from "./list";
import { unitLabel, unitShort, unitTotals, soleUnit, donePercent, type UnitRow } from "@/lib/unit";
import { dateRu, fmtNum } from "@/lib/format";
import { resolveReceiptPayments, waybillFromNote } from "@/lib/receipts";
import { materialTurnover } from "@/lib/stock-turnover";
import { ISSUE_STORNO, STORNO_NOTE_RE } from "@/lib/stock-issue";
import { ingredientOf } from "@/lib/recipe";
import { savedReportDetail, sexDetail, sexEmployeeDetail } from "./sex";
import { repDetail } from "./report-detail";
import { dashDetail } from "./dash-detail";
import { problemDetail } from "./problems";
import { brigIssueDetail, brigShiftDetail, defectAction, issueActions, brigStockDetail } from "./brigadier";
import { BRIGADE_ISSUE, ISSUE_RESOLVERS, taskPhase } from "@/lib/brigade-shift";
import { DEFECT_REASONS } from "@/lib/production-day";
import { TASK_ROLES } from "@/lib/tasks";
import { canDo } from "@/lib/permissions";
import { pctText } from "./fmt";
import { lineTotal, receiptAmounts } from "@/lib/receipt-vat";
import type { Role, SupplyStatus } from "@/generated/prisma";
import { MECH_REF, MECH_STATUS_LABEL, MECH_STATUS_TONE, TARGET_LABEL, mechSubject, mechanicRequest, payAccounts } from "@/lib/mechanic-requests";
import { VEHICLE_TYPE } from "@/lib/logistics";
import { OPEN_STATUSES, PAY_METHOD_LABEL, PAYREQ_STATUS_LABEL, PAYREQ_STATUS_TONE, getPaymentRequest, methodsFor, receiveAccounts } from "@/lib/payment-requests";
import { accountBalances } from "@/lib/payments";
import { arendaShopDetail, arendaTxDetail } from "./arenda";
import { publicOrigin } from "@/lib/public-url";
import { orderPublicPath } from "@/lib/order-qr";
import { CASH_SUM, cashSumDetail, cashflowActions, invoiceCancelActions, kirimQqsDetail, openingDetail, paymentActions, realizatsiyaDetail, receiptPayActions, supplierOpeningExtra } from "./moliya-extra";
import { SKLAD_ACTION_ROLES, SKLAD_CARDS, SKLAD_DETAIL_ROLES, SKLAD_PERM_EXACT } from "./sklad-extra-access";
import { brigadeStockLink, materialExtraActions, ostatkiExtraActions, parseSkladFilter, rasxodExtra, receiptExtra, skladDetail, supplierExtra, supplyExtraActions } from "./sklad-extra";
import { defectCard, withBatchActions, withBrigadeActions, withDefectActions, withOrderActions, withRecipeActions } from "./sex-extra";
import { SOTUV_ACTION_ROLES, SOTUV_DETAIL_ROLES, SOTUV_PERM_EXACT } from "./sotuv-access";
import { REASON_FORM, boostExtras, customerExtras, leadExtras, orderExtras, smmExtras, sotuvDetail } from "./sotuv-extra";

/**
 * Bitta hujjat kartochkasi — ro'yxatdagi qator bosilganda ochiladi.
 *
 * Nima ko'rinishi va qaysi tugmalar borligini server hal qiladi: ilova faqat chizadi.
 * Shuning uchun yangi amal qo'shish uchun ilovani qayta chiqarish shart emas —
 * `actions` ro'yxatiga qator qo'shiladi, mos ijro `lib/mobile/actions.ts` da yoziladi.
 */
export type DetailField = { label: string; value: string; tone?: Tone };
export type FormOption = {
  value: string;
  label: string;
  /** Tanlanganda boshqa maydonlarni to'ldirish uchun (masalan mahsulot narxi). */
  extra?: Record<string, string>;
  /** Variant ostidagi kichik izoh (qoldiq, sana) — ilova `Select` ida ikkinchi qator. */
  hint?: string;
};
export type FormField = {
  name: string;
  label: string;
  /**
   * `items` — takrorlanuvchi qatorlar (zayavka mahsulotlari); ustunlari `columns` da.
   * `photo` — kamera yoki galereyadan rasm; ilova `data:image/jpeg;base64,...` qilib yuboradi.
   * Eski ilova `photo` ni bilmaydi — maydon chizilmaydi, server "surat yo'q" deb javob beradi.
   */
  type: "text" | "number" | "date" | "time" | "select" | "switch" | "items" | "photo";
  /** `text`: maxfiy qiymat (parol) — ilova yulduzcha bilan ko'rsatadi. Eski ilova oddiy matn deb chizadi. */
  secure?: boolean;
  required?: boolean;
  placeholder?: string;
  /** Boshlang'ich qiymat. Switch uchun "true"/"false". */
  value?: string;
  /** Maydon ostidagi kichik izoh. */
  hint?: string;
  options?: FormOption[];
  /** Shart: boshqa maydon shu qiymatda bo'lsagina ko'rinadi. */
  showIf?: { field: string; equals: string };
  /**
   * `select` uchun: variantlar boshqa maydonga bog'liq — faqat `option.extra[dependsOn]` shu maydon qiymatiga
   * teng bo'lganlari ko'rinadi (u bo'sh bo'lsa — hammasi). Masalan mijozning schyotlari. Eski ilova buni
   * bilmaydi va hamma variantni ko'rsatadi — moslikni server baribir tekshiradi.
   */
  dependsOn?: string;
  /** `photo` uchun: qaysi kamera ochilsin (yuz — old kamera) va galereyadan tanlashga yo'l qo'ymaslik (faqat jonli kadr). */
  camera?: "front" | "back";
  cameraOnly?: boolean;
  columns?: FormField[];
  /** `items` uchun: oldindan to'ldirilgan qatorlar (masalan taklif zayavkadan). Eski ilova bilmaydi — birinchi qatorni ustunlar `value` sidan oladi. */
  rows?: Record<string, string>[];
  /**
   * `select` uchun: qidiruv yonidagi "+" — spravochnikda yo'q yozuvni shu yerning o'zida qo'shish. Ilova `fields` ni
   * varaqda chizadi, `/api/mobile/create` ga `key` bilan yuboradi va javobdagi `option` ni tanlaydi. Eski ilova e'tiborsiz qoldiradi.
   */
  create?: { key: string; label: string; fields: FormField[] };
  /** `date` maydoni uchun — veb "10 kunlik ish tartibi" bilan bir xil kunlik yuklama (`lib/mobile/create.ts` `dayCells`). */
  cells?: DayCell[];
};
/** Bitta kun — sana tanlovida kunlik quvvat rangi va hajmi (veb `orders/load-calendar.tsx` bilan bir xil hisob). */
export type DayCell = { key: string; label: string; weekday: string; m3: number; pct: number; count: number; isToday: boolean };
/**
 * Amal muvaffaqiyatli bajarilgandan KEYIN ilova nima qilishi.
 *
 * Ilova o'zi qaror qilmaydi — "yo'lga chiqdi" nima degani va undan keyin nima bo'lishi
 * server tomonda turadi. Shu sababli qoidani o'zgartirish uchun ilovani qayta chiqarish
 * shart emas (kartochkaning qolgan qismi ham shu tamoyilda).
 */
export type ActionEffect = {
  /** Fon GPS kuzatuvi: reys boshlanganda "start", yopilganda "stop". */
  track?: "start" | "stop";
  /**
   * Ilova ichidagi marshrut ekranini ochish — xarita, tezlik, qolgan masofa.
   * Eski ilovalar buni tushunmaydi, shuning uchun `navigate` ham birga yuboriladi:
   * yangi ilova `route` ni afzal biladi, eskisi avvalgidek tashqi navigatorni ochadi.
   */
  route?: boolean;
  /** Navigatsiya ilovasini shu nuqtaga ochish (koordinata bo'lmasa — yo'q). */
  navigate?: { lat: number; lng: number; label: string };
  /** Havolani ochish (masalan nakladnoyning QR tekshiruv sahifasi). Eski ilova bilmaydi — e'tiborsiz qoldiradi. */
  openUrl?: string;
};
export type DetailAction = {
  id: string;
  label: string;
  tone?: "brand" | "danger" | "success" | "warning";
  /** Bosilganda ko'rsatiladigan savol — bo'lsa tasdiqlash so'raladi. */
  confirm?: string;
  /** Bo'lsa — avval shu maydonlar so'raladi. */
  form?: FormField[];
  /** Bajarilgandan keyingi ish (kuzatuv, marshrut, navigatsiya). */
  effect?: ActionEffect;
  /**
   * Tugma ko'rinadi, lekin bosilmaydi — sababi `hint` da.
   * Yashirmaymiz: haydovchi "Yetkazdim qani?" deb izlamasin, nega ochilmaganini o'qisin.
   */
  disabled?: boolean;
  hint?: string;
  /** Serverga so'rov yubormaydigan tugma — faqat `effect` bajariladi (masalan marshrutni ochish). */
  local?: boolean;
};
/**
 * Pul hujjati "chek" ko'rinishida (kirim-chiqim, to'lov, schyot, xarid kirimi) — ilova sarlavha va
 * maydonlar o'rniga chek kartasini chizadi: katta summa, holat plashkasi (kirim yashil / chiqim qizil),
 * qatorlar, raqamni nusxalash. `fields` baribir to'ldiriladi — eski ilova chekni bilmaydi.
 * Amal natijasidagi `Receipt` (`actions.ts`) bilan bir xil shakl.
 */
export type DetailReceipt = {
  headline: string;
  caption?: string;
  status: { label: string; tone: "success" | "warning" | "danger"; at: string };
  rows: { label: string; value: string; copy?: boolean }[];
};
export type MobileDetail = {
  key: string;
  id: string;
  title: string;
  subtitle?: string;
  status?: string;
  fields: DetailField[];
  sections: HomeSection[];
  actions: DetailAction[];
  receipt?: DetailReceipt;
  /**
   * Hujjat surati (mexanik so'rovi): `url` — mobil API yo'li, Bearer token bilan GET → `{ data: "data:image/...;base64,..." }`
   * (`/api/mobile/face/photo` bilan bir xil shakl). Eski ilova bilmaydi — e'tiborsiz qoldiradi.
   */
  photo?: { url: string; title: string };
};

const sum = (n: unknown) => Number(n ?? 0);
const money = (n: number) => `${Math.round(n).toLocaleString("ru-RU")} so'm`;
/** Miqdor mahsulotning o'z birligida: beton m³, ustun/blok dona. */
const num = (n: number) => sum(n).toFixed(sum(n) % 1 ? 1 : 0);
const inUnit = (n: number, unit: string | null) => (unit ? `${num(n)} ${unitLabel(unit)}` : num(n));
/** Aralash birlikli zayavka hajmi: "12 m³ · 500 dona" — m³ bilan dona qo'shilmaydi. */
const totalsText = (rows: UnitRow[]) => {
  const t = unitTotals(rows);
  return t.length ? t.map((x) => inUnit(x.qty, x.unit)).join(" · ") : "0";
};
const day = (d: Date) => d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const dt = (d: Date) => `${day(d)} ${d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}`;
const TRIP_TONE: Record<string, Tone> = { PLANNED: "info", LOADED: "warning", ON_ROAD: "brand", DELIVERED: "success", CANCELLED: "danger" };
/**
 * Ro'yxat qatori id'sidagi `~` dan keyingi qism — faqat React kaliti noyob bo'lishi uchun (bir kirimning bir nechta
 * qatori «Kirim» da, bir xomashyoning bir nechta harakati «Chiqim» da). Kirim va xomashyo id'larida `~` bo'lmaydi.
 */
const baseId = (id: string) => id.split("~")[0];
/** Tarixdagi vaqt — o'ng ustunga sig'ishi uchun qisqa: `23.09 14:05`. */
const shortDt = (d: Date) => `${d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" })} ${d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}`;

/** "Bosqichlar" bo'limi — tarix `lib/trips.ts` dan, bu yerda faqat ilova uchun ko'rinishga o'giriladi. */
async function stepsSection(id: string): Promise<HomeSection> {
  const steps = await tripSteps(id);
  return {
    title: "Bosqichlar",
    empty: "Hali bosqich yozilmagan",
    icon: "clock",
    rows: steps.map((x) => ({ id: x.id, title: x.label, subtitle: x.by, right: shortDt(x.at), tone: TRIP_TONE[x.status] })),
  };
}
/** Brigadir formasidagi "yangi brigada" tanlovi — `lib/mobile/actions.ts` da ham shu kalit. */
export const NEW_BRIGADE = "__new__";
/**
 * "Yetkazildi" tugmasi so'raydigan maydonlar — haydovchi ham, logist ham bir xil to'ldiradi.
 * Marshrut ekrani ham shu ro'yxatni oladi (`lib/mobile/route.ts`): ikkita forma ikki tomonga
 * o'sib ketmasin.
 */
export const RECEIVER_FORM: FormField[] = [
  { name: "receiverName", label: "Obyektda kim qabul qildi", type: "text", required: true, placeholder: "F.I.Sh." },
  // Yetkazib berish miqdorlari (Logistika TZ 11) — bo'sh qolsa qabul = yuklangan
  { name: "acceptedQty", label: "Qabul qilingan miqdor", type: "number", hint: "Bo'sh qoldirsangiz — hammasi qabul qilingan" },
  { name: "returnedQty", label: "Qaytarilgan miqdor", type: "number" },
  { name: "note", label: "Izoh", type: "text" },
];

/** Haydovchi / dispetcher "Muammo" formasi — turlari `lib/logistics.ts` dagi ro'yxat. */
export const ISSUE_FORM: FormField[] = [
  { name: "kind", label: "Nima bo'ldi", type: "select", required: true, value: "TRAFFIC", options: Object.entries(ISSUE_KIND).filter(([k]) => k !== "DECLINED").map(([value, label]) => ({ value, label })) },
  { name: "note", label: "Tafsilot", type: "text", placeholder: "Qayerda, qancha kutish kerak…" },
];

/** Zapravka formasi — transport va haydovchi reysdan olinadi. */
export const fuelForm = (price: number | null): FormField[] => [
  { name: "liters", label: "Necha litr", type: "number", required: true },
  { name: "pricePerL", label: "1 litr narxi, so'm", type: "number", required: true, value: price ? String(price) : undefined },
  { name: "odometerKm", label: "Probeg (spidometr), km", type: "number" },
  { name: "station", label: "Zapravka", type: "text" },
];

/** Reysni yopish — qabul qilingan / qaytarilgan miqdor tasdiqlanadi. */
export const closeForm = (loaded: number, accepted: number | null, returned: number | null): FormField[] => [
  { name: "acceptedQty", label: "Qabul qilingan", type: "number", value: String(accepted ?? loaded) },
  { name: "returnedQty", label: "Qaytarilgan", type: "number", value: returned != null ? String(returned) : undefined },
  { name: "note", label: "Izoh", type: "text" },
];

/** Amalga kim haqli — veb ERP'dagi `requireSession([...])` bilan bir xil ro'yxat. */
export const ACTION_ROLES: Record<string, Role[]> = {
  // Otdel kadr: ariza qarori, vedomost yuborish / tasdiq / to'lov (`./hr.ts`)
  ...HR_ACTION_ROLES,
  // Otdel kadr kabineti: xodim kartasi, lavozim, grafik, KPI, yollash… (`./kadr-extra.ts`)
  ...KADR_ACTION_ROLES,
  // Direktor kabineti: kirish arizasi, hisobni o'chirish, ilova foydalanuvchisi ruxsati, Telegram kodi (`./direktor-extra.ts`)
  ...DIREKTOR_ACTION_ROLES,
  // Logistika kabineti: dispetcher bosqichlari, xarajat, transport, obyekt, haydovchi kartasi (`./logistika-extra.ts`)
  ...LOGI_ACTION_ROLES,
  // Sotuv kabineti (kafolat, shartnoma, sklad zayavkasi, mijoz, taklif, e-commerce, marketing) — `./sotuv-access.ts`
  ...SOTUV_ACTION_ROLES,
  "order.confirm": ["SALES"],
  "order.unblock": ["DIRECTOR"],
  // Direktor "Tasdiqlar" tabida bloklangan zayavkani rad eta oladi (vebda ham `requireSession` direktorni o'tkazadi)
  "order.cancel": ["SALES", "DIRECTOR"],
  // Reys bosqichlarini HAYDOVCHI belgilaydi — o'z ilovasidan, faqat o'ziga biriktirilgan reysda
  // (`assertOwnTrip`, `lib/mobile/actions.ts`). Dispetcher haydovchi o'rniga bosmaydi: har kim
  // o'z ishiga javob beradi. "Yuklandi" — zavod tomonidagi tasdiq, shuning uchun ishlab chiqarish ham.
  "trip.loaded": ["PRODUCTION", "DRIVER"],
  "trip.onroad": ["DRIVER"],
  "trip.delivered": ["DRIVER"],
  // Marshrutni ochish — ilova ichidagi ish, holatni o'zgartirmaydi. Ro'yxatda turishi
  // shuning uchun: `local` ni tushunmaydigan eski ilova baribir serverga murojaat qiladi,
  // va "Bunday amal yo'q" degan xato o'rniga bo'sh javob olsin.
  "trip.route": ["DRIVER"],
  // Dispetcherning o'z ishi: reysni ochish/bekor qilish, ECO'ga yuborish, muammoni hal qilish, yopish
  "trip.cancel": ["LOGISTICS"],
  // ECO'ga yuborish — veb `syncTripWithEco` (`trips` → `create`): dispetcher va ishlab chiqarish
  "trip.eco": ["LOGISTICS", "PRODUCTION"],
  // Logistika TZ: obyektga keldi → tushirilmoqda → yetkazildi → zavodga qaytdi (haydovchi) → yopildi (dispetcher)
  "trip.arrived": ["DRIVER"],
  "trip.unloading": ["DRIVER"],
  "trip.returned": ["DRIVER"],
  "trip.problem": ["LOGISTICS", "PRODUCTION", "DRIVER"],
  "trip.fuel": ["DRIVER"],
  "trip.close": ["LOGISTICS"],
  // Reysdagi ochiq muammolarni hal qilindi deb yopish (id — reys)
  "trip.resolve": ["LOGISTICS"],
  "invoice.pay": ["CASHIER", "ACCOUNTING"],
  // Schyot yozish — veb `/invoices/new` bilan bir xil
  "order.invoice": ["SALES", "ACCOUNTING"],
  // Brigadir o'z brigadasining topshirig'ini ilovada qayd qiladi (`assertOwnTask` — qaysi topshiriqni)
  // Rol matritsasi `lib/tasks.ts` (TASK_ROLES) — veb bilan bir xil; logistika ishlab chiqarish natijasini yozmaydi
  "task.progress": [...TASK_ROLES.progress, "BRIGADIER"],
  // Brigadir ish kuni (`lib/brigade-shift.ts`): ishni boshlash, yakunlash, muammo va brak — o'z topshirig'ida
  "task.start": ["BRIGADIER"],
  "task.finish": [...TASK_ROLES.progress, "BRIGADIER"],
  "task.defect": ["BRIGADIER"],
  // Smena kartochkasi (id — `b~<brigadeId>`) va topshiriq kartasi (id — topshiriq): smena, muammolar, brak
  "shift.open": ["BRIGADIER"],
  "shift.close": ["BRIGADIER"],
  "shift.defect": ["BRIGADIER"],
  "issue.equipment": ["BRIGADIER"],
  "issue.material": ["BRIGADIER"],
  "issue.staff": ["BRIGADIER"],
  "issue.other": ["BRIGADIER"],
  // Muammoni mas'ul bo'lim yopadi; qaysi tur kimniki — `canResolveIssue` (brigadir o'zinikini ham)
  "issue.resolve": ["BRIGADIER", ...ISSUE_RESOLVERS, "DIRECTOR"],
  // Direktor muammoni mas'ul bo'limga eslatadi (bildirishnoma) — `brigIssueDetail`
  "issue.remind": ["DIRECTOR"],
  "task.cancel": [...TASK_ROLES.cancel],
  // Brigadir — veb "Brigadalar" sahifasidagi bilan bir xil ruxsat
  "employee.brigade": [...TASK_ROLES.brigadeEdit],
  "employee.brigade.clear": [...TASK_ROLES.brigadeEdit],
  // Ish hududidan tashqarida "Keldim/Ketdim" ruxsati — faqat otdel kadr va direktor (`setAttendanceAnywhere`)
  "employee.anywhere": ["HR", "DIRECTOR"],
  "brigade.toggle": [...TASK_ROLES.brigadeEdit],
  // Ta'minot zanjiri — `lib/supply-actions.ts` dagi bilan bir xil bo'linish:
  // sklad so'raydi → snabjeniye narxlaydi → sotuv tasdiqlaydi → moliya pul ajratadi → snabjeniye qabul qiladi.
  // Zavodda alohida snabjeniye logini bo'lmasligi mumkin — snabjeniye amallarini WAREHOUSE ham bajaradi.
  "supply.items": ["WAREHOUSE", "PROCUREMENT", "PRODUCTION"],
  "supply.price": ["PROCUREMENT", "WAREHOUSE"],
  // Direktor "Tasdiqlar" tabidagi ta'minot: tasdiqlash va pul ajratish (veb `approve`/`fund` — `requireModuleWrite`
  // direktorni har doim o'tkazadi). Ilgari bu yerda direktor yo'q edi — kartochkada faqat "Bekor qilish" qolardi.
  "supply.approve": ["SALES", "DIRECTOR"],
  "supply.fund": ["FINANCE", "ACCOUNTING", "CASHIER", "DIRECTOR"],
  "supply.fact": ["PROCUREMENT", "WAREHOUSE"],
  "supply.receive": ["PROCUREMENT", "WAREHOUSE"],
  // Aniq qoida bosqich va yaratuvchiga bog'liq — `canRejectSupply` (pul bosqichida faqat moliya/direktor)
  "supply.reject": ["WAREHOUSE", "PROCUREMENT", "PRODUCTION", "SALES", "FINANCE", "ACCOUNTING", "DIRECTOR"],
  // Snabjeniye TZ (`lib/procurement.ts`): rekvizit, taklif, yetkazish — snabjeniye; katta xarid — direktor;
  // muammoni so'rovchi bo'lim ham yozadi; hujjatni buxgalteriya/moliya ham biriktiradi
  "supply.meta": ["PROCUREMENT", "WAREHOUSE"],
  "supply.quote": ["PROCUREMENT", "WAREHOUSE"],
  "supply.quote.choose": ["PROCUREMENT", "WAREHOUSE"],
  "supply.director": ["DIRECTOR"],
  // Marketing (veb «Kontent reja» / «Target»): post nashri va reklama puli — direktor qarori (`lib/smm/approval.ts`, `lib/smm/boosts.ts`)
  "smm.approve": ["DIRECTOR"],
  "smm.reject": ["DIRECTOR"],
  "boost.approve": ["DIRECTOR"],
  "boost.reject": ["DIRECTOR"],
  "supply.delivery": ["PROCUREMENT", "WAREHOUSE"],
  "supply.incident": ["PROCUREMENT", "WAREHOUSE", "PRODUCTION"],
  "supply.incident.resolve": ["PROCUREMENT", "WAREHOUSE"],
  "supply.doc": ["PROCUREMENT", "WAREHOUSE", "ACCOUNTING", "FINANCE"],
  // Mexanik so'rovi ("Kirim", `lib/mechanic-requests.ts`): ish boshqaruvchi tasdiqlaydi/rad etadi, kassa pul beradi,
  // mexanik o'z so'rovini tasdiqdan oldin bekor qiladi (egalik `runMobileAction` da). Direktor — ta'minotdagi kabi
  // "Tasdiqlar" tabidan tasdiq, rad va to'lov (vebda ham direktor bajaradi)
  "kirim.approve": ["SUPERVISOR", "DIRECTOR"],
  "kirim.reject": ["SUPERVISOR", "DIRECTOR"],
  "kirim.pay": ["CASHIER", "DIRECTOR"],
  "kirim.cancel": ["MECHANIC"],
  // Arenda (`lib/permissions.ts` → arenda: storno / shops): storno — yozuv chizilgan holda qoladi; oy hisobi va do'kon holati
  "arenda.storno": ["SECRETARY"],
  "arenda.open-month": ["SECRETARY"],
  "arenda.shop.toggle": ["SECRETARY"],
  "arenda.charge": ["SECRETARY"],
  // Ijarachi kartasi (veb `/arenda/dokon/[id]`): shartnoma, narx o'zgarishi, svet, eslatma, sobiq ijarachi qarzi
  "arenda.lease.start": ["SECRETARY"],
  "arenda.lease.end": ["SECRETARY"],
  "arenda.price": ["SECRETARY"],
  "arenda.price.cancel": ["SECRETARY"],
  "arenda.elec": ["SECRETARY"],
  "arenda.remind": ["SECRETARY"],
  "arenda.pay.former": ["SECRETARY"],
  // Pul qabul qilish (zayavka bosh to'lovi, `lib/payment-requests.ts`): naqd — kassa, perechisleniye — buxgalter, direktor ikkalasi.
  // Aniq qoida usulga bog'liq — `can` da `methodsFor` (payments → receive_cash / receive_bank): direktor amalni boshqa
  // xodimga (masalan moliyaga) bersa, u ham qabul qiladi; bermasa moliya faqat ko'radi
  "payreq.receive": ["CASHIER", "ACCOUNTING", "FINANCE", "DIRECTOR"],
  // Sayt arizalari — veb `/leads` bilan bir xil (SALES; direktor har doim)
  "lead.progress": ["SALES"],
  "lead.reopen": ["SALES"],
  "lead.reject": ["SALES"],
  "lead.convert": ["SALES"],
  "lead.note": ["SALES"],
  // Yetkazuvchini yopish/ochish — veb `/suppliers`
  "supplier.toggle": ["WAREHOUSE", "PROCUREMENT", "ACCOUNTING"],
  // Sex (mobil ishlab chiqarish bosh ekrani): davomatni sex boshlig'i belgilaydi (`lib/production-staff.ts`),
  // kunlik hisobotni u qayd etadi; xodimni brigadaga direktor taqsimlaydi
  // Brigadir smena boshida faqat O'Z brigadasi a'zolarini belgilaydi (`assertOwnMember`).
  // Yuz tekshiruvi yoqiq bo'lsa brigadir "Keldi" ni faqat `att.face` bilan qo'yadi: att.present/att.all va
  // att.status orqali PRESENT rad etiladi, vaqtni esa faqat sex boshlig'i tuzatadi (`lib/mobile/actions.ts`)
  "att.present": ["PRODUCTION", "SUPERVISOR", "BRIGADIER"],
  // "Keldi" yuz bilan: kamera kadri Face ID namunasi (yo'q bo'lsa profil surati) bilan solishtiriladi (`lib/face-verify.ts`), mos kelmasa yozilmaydi
  "att.face": ["PRODUCTION", "SUPERVISOR", "BRIGADIER"],
  "att.checkout": ["PRODUCTION", "SUPERVISOR", "BRIGADIER"],
  "att.absent": ["PRODUCTION", "SUPERVISOR", "BRIGADIER"],
  "att.status": ["PRODUCTION", "SUPERVISOR", "BRIGADIER"],
  "att.all": ["PRODUCTION", "SUPERVISOR", "BRIGADIER"],
  "att.form": ["PRODUCTION", "SUPERVISOR"],
  "report.submit": ["PRODUCTION", "SUPERVISOR"],
  "sex.assign": ["DIRECTOR"],
  // Egasi qarori (dashboard "Muammolar") — mas'ul bo'limga topshirish va qarorni qayd etish (`problemDetail`)
  "problem.assign": ["DIRECTOR"],
  "problem.note": ["DIRECTOR"],
  // «Dona narxi» — xomashyo chiqim narxi (Material.unitPrice): Snabjeniye belgilaydi (`stock` → `price`), direktor ham
  "material.price": ["PROCUREMENT", "DIRECTOR"],
  // Moliya (`./moliya-extra.ts`) — veb `requireAction` bilan bir xil (`PERM_EXACT`). Storno, o'chirish va schyot bekor qilish —
  // nazorat amali, vebdagidek direktor ham; to'lov/bog'lash — kassa va buxgalteriyaning ishi
  "payment.storno": ["ACCOUNTING", "DIRECTOR"],
  "payment.link": ["CASHIER", "ACCOUNTING"],
  "cashflow.cancel": ["ACCOUNTING", "FINANCE", "DIRECTOR"],
  "receipt.pay": ["FINANCE", "ACCOUNTING"],
  "invoice.cancel": ["ACCOUNTING", "DIRECTOR"],
  "supplier.opening.pay": ["FINANCE", "ACCOUNTING"],
  "payroll.recalc": ["HR", "ACCOUNTING"],
  "arenda.shop.edit": ["SECRETARY"],
  // Ishlab chiqarish kabineti (`./sex-extra.ts`) — veb `requireAction` bilan bir xil (`PERM_EXACT`):
  // zayavka qatorlarini brigadalarga taqsimlash, zames storno (odatda faqat direktor), retsept versiyasi, brigada tahriri, brak.
  // Direktor ilovada ham tayinlaydi, retsept va brak yozadi — vebdagidek (egasi qarori, 2026-10-18)
  "order.assign": ["PRODUCTION", "DIRECTOR"],
  "batch.storno": ["DIRECTOR"],
  "recipe.version": ["PRODUCTION", "WAREHOUSE", "PROCUREMENT", "DIRECTOR"],
  "brigade.edit": [...TASK_ROLES.brigadeEdit],
  "defect.add": ["PRODUCTION", "SUPERVISOR", "DIRECTOR"],
  // Xato yozilgan brak: direktor — har qandayini, boshqalar — bugun o'zi yozganini (`canDeleteDefect`)
  "defect.delete": ["PRODUCTION", "SUPERVISOR", "DIRECTOR"],
  // Sklad / snabjeniye qo'shimchalari: storno, brigada skladi, «Kimga», narx, o'chirish, rekvizitlar (`./sklad-extra-access.ts`)
  ...SKLAD_ACTION_ROLES,
};

/**
 * Direktor bu yerda istisno EMAS: u hamma hujjatni ko'radi, lekin tugma faqat ro'yxatda
 * DIRECTOR yozilgan amallarda chiqadi (blokdan chiqarish kabi). Aks holda direktor ilovasida
 * "Bog'landim", "Yetkazildi" kabi xodimning ishi turib qoladi va kim javobgar — chalkashadi.
 */
export const can = (user: MobileUser, action: string) => {
  const roleOk = (Object.hasOwn(ACTION_ROLES, action) ? ACTION_ROLES[action] : []).includes(user.role);
  // Pul qabul qilish — veb bilan bir qoida: kamida bitta usul (`methodsFor`); qaysi so'rov ekani kartochkada va
  // `receivePaymentRequest` ichida usul bo'yicha yana tekshiriladi
  if (action === "payreq.receive") return roleOk && methodsFor(user).length > 0;
  if (user.role === "DIRECTOR") return roleOk; // direktor — yuqoridagi izohdagi kabi faqat ro'yxat bo'yicha
  const map = permFor(action);
  const lvl = map && user.perms?.[map.module];
  if (!map || !lvl) return roleOk; // direktor bu modulga ruxsat bermagan — rol bo'yicha
  // Katalogdagi amal (`lib/permissions.ts`) — veb bilan AYNAN bir qoida: yopadi ham, beradi ham
  if (map.action) return canDo({ role: user.role, perms: user.perms }, map.module, map.action);
  // Katalogda yo'q amal (haydovchi/brigadir o'z ishi) — perms faqat CHEKLAYDI: "yo'q"/"ko'rish" — amal yo'q
  if (lvl === "none" || lvl === "view") return false;
  return roleOk;
};

/**
 * Mobil amal → veb ruxsat moduli (+ katalog amali). Direktor `User.perms` da modulni yopsa yoki
 * "faqat ko'rish" qilsa, ilovada ham tugma chiqmaydi va server rad etadi (veb bilan bir xil).
 */
const PERM_EXACT: Record<string, { module: string; action?: string }> = {
  ...KADR_PERM,
  "order.confirm": { module: "orders", action: "confirm" },
  "order.cancel": { module: "orders", action: "cancel" },
  "order.unblock": { module: "orders", action: "unblock" },
  "order.invoice": { module: "sales", action: "invoice" },
  "invoice.pay": { module: "payments", action: "create" },
  "trip.loaded": { module: "trips", action: "load" },
  "trip.cancel": { module: "trips", action: "cancel" },
  "trip.close": { module: "trips", action: "move" },
  "trip.eco": { module: "trips", action: "create" },
  "trip.problem": { module: "trips", action: "issue" },
  // Veb `resolveIssue` — `trips` → `move`
  "trip.resolve": { module: "trips", action: "move" },
  "task.progress": { module: "tasks", action: "progress" },
  "task.finish": { module: "tasks", action: "progress" },
  "task.cancel": { module: "tasks", action: "cancel" },
  "employee.brigade": { module: "tasks", action: "brigade" },
  "employee.brigade.clear": { module: "tasks", action: "brigade" },
  "brigade.toggle": { module: "tasks", action: "brigade" },
  "supplier.toggle": { module: "stock", action: "suppliers" },
  "report.submit": { module: "production", action: "report" },
  "att.form": { module: "production", action: "report" },
  "material.price": { module: "stock", action: "price" },
  "payment.storno": { module: "payments", action: "storno" },
  "payment.link": { module: "payments", action: "create" },
  // Kassa yozuvini bekor qilish — veb `cancelCashTx` bilan bir xil ruxsat (`cashflow` → `delete`)
  "cashflow.cancel": { module: "cashflow", action: "delete" },
  "receipt.pay": { module: "cashflow", action: "pay" },
  "invoice.cancel": { module: "sales", action: "invoice_cancel" },
  "supplier.opening.pay": { module: "cashflow", action: "pay" },
  "payroll.recalc": { module: "payroll", action: "calc" },
  "arenda.shop.edit": { module: "arenda", action: "shops" },
  "arenda.lease.start": { module: "arenda", action: "shops" },
  "arenda.lease.end": { module: "arenda", action: "shops" },
  "arenda.price": { module: "arenda", action: "shops" },
  "arenda.price.cancel": { module: "arenda", action: "shops" },
  "arenda.elec": { module: "arenda", action: "shops" },
  "arenda.remind": { module: "arenda", action: "create" },
  "arenda.pay.former": { module: "arenda", action: "create" },
  "order.assign": { module: "production", action: "assign" },
  "batch.storno": { module: "production", action: "batch_storno" },
  "recipe.version": { module: "production", action: "recipe" },
  "brigade.edit": { module: "tasks", action: "brigade" },
  "defect.add": { module: "production", action: "report" },
  "defect.delete": { module: "production", action: "report" },
  ...DIREKTOR_PERM,
  ...SKLAD_PERM_EXACT,
  ...LOGI_PERM,
  ...SOTUV_PERM_EXACT,
};
const PERM_PREFIX: [string, { module: string; action?: string }][] = [
  ["lead.", { module: "sales", action: "leads" }],
  ["supply.", { module: "taminot" }],
  ["kirim.", { module: "mexanik" }],
  ["arenda.", { module: "arenda" }],
  ["smm.", { module: "marketing", action: "publish" }],
  ["boost.", { module: "marketing", action: "boost_approve" }],
  ["trip.", { module: "trips" }],
  ["task.", { module: "tasks" }],
  ["shift.", { module: "tasks" }],
  ["issue.", { module: "tasks" }],
  ["att.", { module: "production" }],
];
function permFor(action: string): { module: string; action?: string } | undefined {
  return PERM_EXACT[action] ?? PERM_PREFIX.find(([p]) => action.startsWith(p))?.[1];
}

/**
 * Maxfiy kartochkalar — id bilan to'g'ridan-to'g'ri so'ralsa ham faqat shu rollar ochadi
 * (ro'yxatdagi ACCESS bilan bir xil, qo'shimcha: boshqa kartadan havola orqali ochadiganlar).
 * Operatsion hujjatlar (zayavka, reys, zames...) ochiq qoladi — ular kartalar orasida bog'langan.
 */
const DETAIL_ROLES: Partial<Record<string, Role[]>> = {
  // Egasi qarori — faqat direktor (moliyaviy xulosa, mas'ul bo'limlar)
  problem: [],
  cashflow: ["CASHIER", "ACCOUNTING", "FINANCE"],
  // Sotuvchi schyot kartasidan to'lovni ochadi
  payments: ["CASHIER", "ACCOUNTING", "FINANCE", "SALES"],
  // Kassir to'lovni mijoz ustida oladi
  // Sotuv agenti — faqat o'ziga biriktirilgan mijoz (egalik `customerDetail` da tekshiriladi)
  customers: ["SALES", "ACCOUNTING", "FINANCE", "CASHIER", "AGENT"],
  // Brigada kartasidan brigadirni ochadiganlar (SALES) ham
  // Dispetcher — faqat haydovchi lavozimidagi xodim (`employeeDetail` da tekshiriladi)
  employees: ["HR", "LOGISTICS", "PRODUCTION", "SUPERVISOR", "SALES", "DISPATCHER"],
  // Sex statistikasi, sex xodimi va kunlik hisobot (`./sex.ts`)
  sex: ["PRODUCTION", "SUPERVISOR"],
  "sex-emp": ["PRODUCTION", "SUPERVISOR", "BRIGADIER"],
  // Brigadir smenasi va muammolari (`./brigadier.ts`) — brigadirga faqat o'z brigadasiniki
  "brig-shift": ["PRODUCTION", "SUPERVISOR", "BRIGADIER"],
  "brig-issue": ["BRIGADIER", ...ISSUE_RESOLVERS],
  // Brigadaning sklad kartasi: qo'lidagi xomashyo, berilgani, samaradorlik (`./brigadier.ts` → `brigStockDetail`)
  "brig-stock": ["PRODUCTION", "SUPERVISOR", "BRIGADIER", "WAREHOUSE", "PROCUREMENT"],
  "prod-report": ["PRODUCTION", "SUPERVISOR"],
  // Hisobotdan bosib ochiladigan soat / brigada / mahsulot / brak kartalari — faqat ko'rish (`./report-detail.ts`)
  rep: ["PRODUCTION", "SUPERVISOR"],
  // Mijozning shaxsiy ma'lumoti (ism, telefon) — faqat sotuv
  leads: ["SALES"],
  // Pul hujjati: summa, to'lovlar — ro'yxatdagi ACCESS bilan bir xil
  invoices: ["ACCOUNTING", "FINANCE", "SALES", "CASHIER"],
  // Yetkazuvchi rekvizitlari va qarzi
  suppliers: ["WAREHOUSE", "PROCUREMENT", "ACCOUNTING"],
  // Sklad jurnallari: «Chiqim» berish hujjati va «Qoldiqlar» jami — ro'yxatlari bilan bir xil (`list.ts` ACCESS).
  // Direktor bergan `stock` amali (Chiqim — «issue», Qoldiqlar — kirim/berish/narx) ham ochadi: `mobileDetail` → `journalGranted`
  rasxod: ["WAREHOUSE", "PROCUREMENT"],
  ostatki: ["WAREHOUSE", "PROCUREMENT"],
  // Marketing posti va target so'rovi — direktor qarori (vebda ham «publish» / «boost_approve» faqat unda)
  // Sotuv ham ochadi: tasdiqqa yuborish, target so'rovi (veb «Kontent reja» / «Target»); qarorlar baribir direktorda
  smm: ["SALES"],
  boost: ["SALES"],
  // Mexanik so'rovi — mexanikka faqat o'zinikini (`kirimDetail`)
  kirim: ["MECHANIC", "SUPERVISOR", "CASHIER"],
  // Pul qabul qilish so'rovi — ro'yxati bilan bir xil (`list.ts` ACCESS); usul bo'yicha cheklov `payreqDetail` da
  payreq: ["CASHIER", "ACCOUNTING", "FINANCE"],
  // Arenda (do'konlar ijarasi) — sekretar (`./arenda.ts`)
  "arenda-tx": ["SECRETARY"],
  "arenda-shop": ["SECRETARY"],
  // Moliya qo'shimchalari — ro'yxatlari bilan bir xil (`list.ts` ACCESS, `./moliya-extra.ts`)
  "kirim-qqs": ["ACCOUNTING", "FINANCE"],
  openings: ["ACCOUNTING", "FINANCE"],
  realizatsiya: ["CASHIER", "ACCOUNTING", "FINANCE"],
  // Bitta brak yozuvi (sex «Brak» kartochkasidan) — o'chirish tugmasi bilan (`./sex-extra.ts`)
  defect: ["PRODUCTION", "SUPERVISOR"],
  // BI tahlil, ilova foydalanuvchilari, byudjet, Egasi paneli bloklari, kirish arizasi, o'chirish so'rovi (`./direktor-extra-access.ts`)
  ...DIREKTOR_DETAIL_ROLES,
  // Tayyor mahsulot, imkoniyat, oluvchi kartasi, ta'minot hujjati (`./sklad-extra-access.ts`)
  ...SKLAD_DETAIL_ROLES,
  ...LOGI_DETAIL_ROLES,
  ...SOTUV_DETAIL_ROLES,
};

const BRIGADIER_CARDS = ["tasks", "brig-shift", "brig-issue", "brig-stock", "sex-emp", "dash", ...SELF_CARDS];

export async function mobileDetail(user: MobileUser, key: string, id: string): Promise<MobileDetail> {
  if (!id) throw new ListError("BAD_REQUEST", "id yo'q", 400);
  // Prototip kalitlari ("constructor", "toString") jadvallardan funksiya qaytarardi — kartochka emas
  if (Object.hasOwn(Object.prototype, key)) throw new ListError("UNKNOWN_DETAIL", "Bunday kartochka yo'q", 404);
  // Brigadir ilovada faqat o'z ish joyi kartochkalarini ochadi (topshiriq, smena, muammo, brigada a'zosi):
  // zayavka, schyot va boshqa hujjatlar unga ro'yxatda ham ko'rinmaydi, id qo'lda yuborilsa ham ochilmaydi.
  if (user.role === "BRIGADIER" && !BRIGADIER_CARDS.includes(DETAIL_KEY[key] ?? key)) throw new ListError("FORBIDDEN", "Bu bo'limga ruxsat yo'q", 403);
  // Haydovchi ilovada faqat reys kartochkasini ochadi — vebda ham unga faqat "Mening reyslarim" ochiq
  if (user.role === "DRIVER" && key !== "trips" && key !== "dash" && !SELF_CARDS.includes(key)) throw new ListError("FORBIDDEN", "Bu bo'limga ruxsat yo'q", 403);
  // Sotuv agenti faqat o'z zayavkasi va o'z mijozi kartochkasini ochadi (ownership quyida tekshiriladi)
  if (user.role === "AGENT" && !["orders", "customers", "dash", ...SELF_CARDS].includes(key)) throw new ListError("FORBIDDEN", "Bu bo'limga ruxsat yo'q", 403);
  // Aralash ro'yxatlar (direktor "Tasdiqlar") qator id'sida kartochka kalitini olib keladi: `orders:<id>`
  const [refKey, refId] = splitRef(id);
  if (refKey) return mobileDetail(user, refKey, refId);
  const card = DETAIL_KEY[key] ?? key;
  const allowed = DETAIL_ROLES[card];
  // Istisno: o'zi yozgan «Chiqim» kartochkasi — direktor «issue» ruxsatini bergan boshqa rol xodimiga ham (ro'yxat bilan bir qoida)
  if (allowed && user.role !== "DIRECTOR" && !allowed.includes(user.role) && !journalGranted(user, card)) throw new ListError("FORBIDDEN", "Bu bo'limga ruxsat yo'q", 403);
  // Direktor modulni "yo'q" qilgan bo'lsa kartochka ham ochilmaydi (veb sahifa kabi) — id qo'lda yuborilsa ham
  if (moduleClosed(user, card)) throw new ListError("FORBIDDEN", "Bu bo'limga ruxsat yo'q", 403);
  if (key === "activity") {
    if (user.role !== "DIRECTOR") throw new ListError("FORBIDDEN", "Bu bo'limga ruxsat yo'q", 403);
    return activityDetail(id);
  }
  // Otdel kadr: ariza, oylik, vedomost (`./hr.ts`) — egalik / rol kartochka ichida tekshiriladi
  if (Object.hasOwn(HR_ACCESS, card)) return hrDetail(user, card, id);
  // Otdel kadr kabineti — rol / ruxsat kartochka ichida (`listAllowed`, hujjat — faqat kadr va direktor)
  if (Object.hasOwn(KADR_ACCESS, card) || KADR_CARDS.includes(card)) return kadrDetail(user, card, id);
  if (DIREKTOR_CARDS.includes(card)) return direktorDetail(user, card, id);
  if (SKLAD_CARDS.has(card)) return skladDetail(user, card, id);
  // Logistika kartochkalari: transport, zapravka, xarajat, obyekt, davr hisoboti (`./logistika-extra.ts`)
  if (["vehicles", "fuel", "expenses", "sites", "logi-report"].includes(card)) return logiDetail(user, card, id);
  switch (DETAIL_KEY[key] ?? key) {
    case "orders": return withOrderTrip(user, await withOrderActions(user, await orderDetail(user, id)));
    case "trips": return withTripExtras(user, await tripDetail(user, id));
    case "invoices": return invoiceDetail(user, id);
    case "payments": return paymentDetail(user, id);
    case "receipts": return receiptDetail(user, baseId(id));
    case "tasks": return taskDetail(user, id);
    case "production": return withBatchActions(user, await batchDetail(id));
    case "stock": return materialDetail(user, baseId(id));
    // «Chiqim» — berish hujjati (id = ref, `lib/stock-issue.ts`); «Qoldiqlar» — jami qatori yoki xomashyo
    case "rasxod": return issueDetail(user, baseId(id));
    case "ostatki": return id.startsWith(OSTATKI_SUM) ? ostatkiDetail(user, id) : materialDetail(user, baseId(id));
    case "employees": return withDriverExtras(user, await employeeDetail(user, id));
    case "cashflow": return id.startsWith(CASH_SUM) ? cashSumDetail(id) : cashflowDetail(user, id);
    case "kirim-qqs": return kirimQqsDetail(user, id);
    case "openings": return openingDetail(user, id);
    case "realizatsiya": return realizatsiyaDetail(id);
    case "supply": return supplyDetail(user, id);
    case "kirim": return kirimDetail(user, id);
    case "arenda-tx": return arendaTxDetail(user, id);
    case "arenda-shop": return arendaShopDetail(user, id);
    case "offers": case "shop": case "akt": case "csite": case "mstat": return sotuvDetail(user, card, id);
    case "smm": return smmDetail(user, id);
    case "boost": return boostDetail(user, id);
    case "payreq": return payreqDetail(user, id);
    case "customers": return customerDetail(user, id);
    case "leads": return leadDetail(user, id);
    case "brigades": return withBrigadeActions(user, await brigadeDetail(user, id));
    case "suppliers": return supplierDetail(user, id);
    case "recipes": return withRecipeActions(user, await recipeDetail(id));
    case "defect": return defectCard(user, id);
    // Dashboard kartasi bosilganda — davr bo'yicha batafsil (`./dash-detail.ts`), rol foydalanuvchidan
    case "dash": return dashDetail(user, id);
    case "sex": return id.startsWith("defect") ? withDefectActions(user, await sexDetail(user, id)) : sexDetail(user, id);
    case "sex-emp": return sexEmployeeDetail(user, id);
    case "prod-report": return savedReportDetail(user, id);
    case "rep": return repDetail(user, id);
    case "brig-shift": return brigShiftDetail(user, id);
    case "brig-issue": return brigIssueDetail(user, id);
    case "brig-stock": return brigStockDetail(user, id);
    // Egasi qarori kerak bo'lgan masala (direktor dashboardidagi "Muammolar") — `./problems.ts`
    case "problem": return problemDetail(user, id);
    default: throw new ListError("UNKNOWN_DETAIL", "Bunday kartochka yo'q", 404);
  }
}

// ───────────────────────── Zayavka ─────────────────────────

async function orderDetail(user: MobileUser, id: string): Promise<MobileDetail> {
  const o = await db.order.findUnique({
    where: { id },
    include: { customer: true, items: { include: { product: true } }, trips: { include: { driver: true, vehicle: true } }, batches: { include: { product: true } }, invoices: true, createdBy: true },
  });
  if (!o) throw new ListError("NOT_FOUND", "Zayavka topilmadi", 404);
  // Sotuv agenti faqat o'zi kiritgan zayavkani ochadi (begona id qo'lda yuborilsa — "topilmadi")
  if (user.role === "AGENT" && o.createdById !== user.id) throw new ListError("NOT_FOUND", "Zayavka topilmadi", 404);
  const credit = await customerCredit(o.customerId);
  const total = o.items.reduce((s, i) => s + sum(i.qtyM3) * sum(i.price), 0);
  // Hajm mahsulot birligida — vebdagi zayavka kartochkasi bilan bir xil
  const itemRows = o.items.map((i) => ({ unit: i.product.unit, qty: i.qtyM3 }));
  const batchRows = o.batches.map((b) => ({ unit: b.product.unit, qty: b.qtyM3 }));
  const orderUnit = soleUnit(itemRows); // aralash birlikda — null
  const volume = o.items.reduce((s, i) => s + sum(i.qtyM3), 0);
  const producedPct = donePercent(batchRows, itemRows);
  const delivered = o.trips.filter((t) => t.status === "DELIVERED").reduce((s, t) => s + sum(t.qtyM3), 0);

  const actions: DetailAction[] = [];
  // Sklad (zaxira) zayavkasi — o'z tugmalari, `stock` ruxsati bilan (`orderExtras`)
  const sale = o.kind !== "STOCK";
  if (sale && o.status === "DRAFT" && !o.dateUnknown && can(user, "order.confirm")) actions.push({ id: "order.confirm", label: "Qabul qilish", tone: "success", confirm: "Zayavka qabul qilinsinmi? Kredit limiti tekshiriladi." });
  // Direktor qarori: "Tasdiqlash" (blokni ochish) — asosiy, "Rad etish" (bekor qilish) — ikkilamchi
  if (o.status === "BLOCKED" && can(user, "order.unblock")) actions.push({ id: "order.unblock", label: "Tasdiqlash", tone: "success", confirm: `Kredit limiti oshgan (${money(credit.used)} / ${money(credit.limit)}). Blok ochilib, zayavka ishlab chiqarishga o'tsinmi?` });
  // Bekor qilish — veb kabi sabab majburiy (auditga yoziladi), zames/reys bo'lsa tugma yo'q
  if (sale && ["DRAFT", "BLOCKED", "CONFIRMED"].includes(o.status) && o.batches.length === 0 && o.trips.length === 0 && can(user, "order.cancel")) {
    // Direktor faqat bloklangan zayavkani rad etadi (qolganlari — sotuv bo'limining ishi)
    if (user.role !== "DIRECTOR") actions.push({ id: "order.cancel", label: "Bekor qilish", tone: "danger", form: REASON_FORM });
    else if (o.status === "BLOCKED") actions.push({ id: "order.cancel", label: "Rad etish", tone: "danger", form: REASON_FORM });
  }
  // Schyot yozish — tasdiqlangan, hali schyoti yo'q zayavkaga (veb `/invoices/new` bilan bir xil qoida)
  const liveInvoices = o.invoices.filter((i) => i.status !== "CANCELLED");
  if (!["DRAFT", "BLOCKED", "CANCELLED"].includes(o.status) && liveInvoices.length === 0 && can(user, "order.invoice")) {
    actions.push({
      id: "order.invoice", label: "Schyot yozish", tone: "brand",
      form: [
        { name: "amount", label: "Summa (so'm)", type: "number", required: true, value: String(Math.round(total)), hint: "Zayavka summasi — kerak bo'lsa o'zgartiring" },
        { name: "date", label: "Sana", type: "date", required: true, value: ymd(new Date()) },
      ],
    });
  }
  // Kafolat xati, shartnoma, sklad zayavkasi, tijorat taklifi — `./sotuv-extra.ts`
  const extra = await orderExtras(user, o, total);
  actions.push(...extra.actions);
  // Chop etilgan zayavkadagi QR olib boradigan ommaviy sahifa (`/z/<№>?k=`) — mijozga havola yuborish uchun
  if (o.status !== "CANCELLED") {
    const { origin } = await publicOrigin().catch(() => ({ origin: "" }));
    if (origin) actions.push({ id: "order.public", label: "Mijoz sahifasi (QR)", local: true, effect: { openUrl: `${origin}${orderPublicPath(o.orderNo)}` } });
  }

  return {
    key: "orders", id: o.id, title: o.orderNo, subtitle: o.customer.name, status: o.status,
    fields: [
      { label: "Yetkazish", value: o.dateUnknown ? "Sana aniq emas (vebda belgilanadi)" : `${day(o.deliveryDate)}${o.deliveryTime ? ` · ${o.deliveryTime}` : ""}` },
      { label: "Manzil", value: o.deliveryAddress },
      { label: "Hajm", value: totalsText(itemRows) },
      { label: "Summa", value: money(total) },
      { label: "Ishlab chiqarildi", value: `${totalsText(batchRows)} / ${totalsText(itemRows)}`, tone: producedPct >= 100 ? "success" : "warning" },
      { label: "Yetkazildi", value: `${inUnit(delivered, orderUnit)} / ${totalsText(itemRows)}`, tone: delivered >= volume ? "success" : "info" },
      { label: "Mijoz limiti", value: `${money(credit.used)} / ${money(credit.limit)}`, tone: credit.used >= credit.limit ? "danger" : "success" },
      ...(o.needsPump ? [{ label: "Nasos", value: "Kerak", tone: "warning" as Tone }] : []),
      ...(o.isUrgent ? [{ label: "Shoshilinch", value: "Ha", tone: "danger" as Tone }] : []),
      ...(o.onCredit ? [{ label: "Qarzga", value: o.guaranteeAt ? `Kafolat xati bor (${day(o.guaranteeAt)})` : "Kafolat xati yo'q", tone: o.guaranteeAt ? "success" as Tone : "danger" as Tone }] : []),
      ...(o.contractNo ? [{ label: "Shartnoma", value: `${o.contractNo}${o.contractAmount ? ` · ${money(sum(o.contractAmount))}` : ""}` }] : []),
      ...extra.fields,
      { label: "Kim kiritdi", value: `${o.createdBy.fullName} · ${day(o.date)}` },
      ...(o.note ? [{ label: "Izoh", value: o.note }] : []),
    ],
    ...(extra.photo ? { photo: extra.photo } : {}),
    sections: ([
      { title: "Mahsulotlar", empty: "Qator yo'q", icon: "package", rows: o.items.map((i) => ({ id: i.id, title: i.product.name, subtitle: `${money(sum(i.price))} / ${unitLabel(i.product.unit)}`, right: inUnit(sum(i.qtyM3), i.product.unit) })) },
      { title: "Reyslar", empty: "Reys yo'q", target: "trips", rows: o.trips.map((t) => ({ id: t.id, title: `${t.deliveryNoteNo} · ${t.vehicle.plate}`, subtitle: t.driver.fullName, right: inUnit(sum(t.qtyM3), orderUnit), status: t.status, tone: TRIP_TONE[t.status] })) },
      { title: "Zameslar", empty: "Zames yo'q", target: "production", rows: o.batches.map((b) => ({ id: b.id, title: `${b.batchNo} · ${b.product.name}`, subtitle: day(b.date), right: inUnit(sum(b.qtyM3), b.product.unit) })) },
      { title: "Schyotlar", empty: "Schyot yo'q", target: "invoices", rows: o.invoices.map((i) => ({ id: i.id, title: i.invoiceNo, subtitle: day(i.date), right: money(sum(i.amount)), status: i.status })) },
    ] as HomeSection[])
      // Schyot kartasi faqat moliya va sotuvga ochiq (DETAIL_ROLES) — boshqalarga ochilmaydigan havola ko'rsatilmaydi
      .filter((s) => s.target !== "invoices" || user.role === "DIRECTOR" || (DETAIL_ROLES.invoices ?? []).includes(user.role))
      .filter((s) => s.rows.length > 0 || s.title === "Mahsulotlar")
      .concat(extra.sections),
    actions,
  };
}

// ───────────────────────── Reys / nakladnoy ─────────────────────────

async function tripDetail(user: MobileUser, id: string): Promise<MobileDetail> {
  const t = await db.trip.findUnique({ where: { id }, include: { order: { include: { customer: true, site: true, items: { select: { qtyM3: true, product: { select: { unit: true, name: true } } } } } }, driver: true, vehicle: true, issues: { orderBy: { createdAt: "desc" } } } });
  if (!t) throw new ListError("NOT_FOUND", "Reys topilmadi", 404);
  const phase = tripPhase(t);
  const planned = tripPlannedAt(t, t.order);
  const openIssues = t.issues.filter((i) => !i.resolvedAt);
  const recent = t.status === "DELIVERED" && t.deliveredAt && Date.now() - t.deliveredAt.getTime() < 12 * 3600_000;
  const fuel = fuelForm(await lastFuelPrice(t.vehicle.fuelType));
  // Ro'yxatda haydovchiga faqat o'z reyslari chiqadi (`lib/mobile/list.ts`), lekin kartochka
  // id bo'yicha ochiladi — begona id qo'lda yuborilsa shu yerda to'xtaydi. "Topilmadi" deymiz:
  // "ruxsat yo'q" desak, boshqa reys mavjudligini tasdiqlagan bo'lardik.
  const isDriver = user.role === "DRIVER";
  if (isDriver && t.driverId !== (await driverEmployeeId(user.id))) throw new ListError("NOT_FOUND", "Reys topilmadi", 404);

  // Yurilgan yo'l — haydovchi ham, logistika ham shu bitta raqamni ko'radi.
  // Ilova kartochkani davriy yangilaydi, ya'ni reys davomida raqam o'sib boradi.
  const track = (await tripTrackStats([t.id])).get(t.id);
  // Obyektgacha qolgan masofa — yo'ldagi reysda ham kartochkada ko'rinadi, ham
  // "Yetkazdim" tugmasini ochadi/yopadi (`lib/trips.ts` dagi bitta qoida bo'yicha).
  const arrival = t.status === "ON_ROAD" ? await tripArrival(t.id) : null;

  const actions: DetailAction[] = [];
  if (isDriver) {
    // Haydovchiga qadamma-qadam: har holatda faqat KEYINGI qadam ko'rinadi — uchta tugma
    // bir vaqtda turgani chalkashtiradi va tasodifan bosilishi mumkin.
    if (t.status === "PLANNED") actions.push({ id: "trip.loaded", label: "Yukladim", tone: "brand", confirm: "Beton yuklandi deb belgilansinmi?" });
    // Yo'lga chiqilganda: fon kuzatuvi boshlanadi va navigatsiya obyektga yo'l ko'rsatadi.
    // Koordinata zayavkada bo'lmasa navigatsiya ochilmaydi — kuzatuv baribir ishlaydi.
    const dest = t.order.lat != null && t.order.lng != null
      ? { lat: t.order.lat, lng: t.order.lng, label: t.order.deliveryAddress }
      : undefined;
    if (t.status === "LOADED") actions.push({ id: "trip.onroad", label: "Yo'lga chiqdim", tone: "brand", effect: { track: "start", route: true, navigate: dest } });
    if (t.status === "ON_ROAD") {
      // Marshrut ekrani reys davomida qayta ochilishi kerak: haydovchi ilovadan chiqib
      // ketsa yoki telefon qulflansa, xaritaga qaytish uchun boshqa yo'l qolmaydi.
      if (dest && !t.arrivedAt) actions.push({ id: "trip.route", label: "Marshrutni ochish", tone: "brand", local: true, effect: { route: true } });
      // TZ: "Yetib keldim" → "Tushirishni boshladim" → "Yetkazdim". Obyektga yaqinlashguncha yopiq (1 km qoidasi).
      if (!t.arrivedAt) {
        actions.push({ id: "trip.arrived", label: "Yetib keldim", tone: "brand", disabled: arrival ? !arrival.near && !arrival.unknown : false, hint: arrival?.reason ?? undefined });
      } else if (!t.unloadingAt) {
        actions.push({ id: "trip.unloading", label: "Tushirishni boshladim", tone: "brand" });
      }
      // "Yetkazdim" obyektga yaqinlashguncha yopiq turadi — sabab tugma ostida yoziladi.
      // GPS umuman yo'q bo'lsa (`unknown`) tugma ochiq qoladi: bosqichni boshqa hech kim
      // belgilamaydi, reysga esa muammo yoziladi — dispetcher tekshiradi.
      actions.push({
        id: "trip.delivered", label: "Yetkazdim", tone: "success", form: RECEIVER_FORM, effect: { track: "stop" },
        disabled: arrival ? !arrival.near && !arrival.unknown : false, hint: arrival?.reason ?? undefined,
      });
    }
    if (recent && !t.returnedAt) actions.push({ id: "trip.returned", label: "Zavodga qaytdim", tone: "brand", confirm: "Zavodga qaytdingizmi? Mashina bo'sh deb belgilanadi." });
    // Muammo — yo'lda ham, obyektda ham; dispetcher darhol bildirishnoma oladi
    if (["LOADED", "ON_ROAD"].includes(t.status)) actions.push({ id: "trip.problem", label: "Muammo", tone: "danger", form: ISSUE_FORM });
    if (["PLANNED", "LOADED", "ON_ROAD"].includes(t.status) || recent) actions.push({ id: "trip.fuel", label: "Yoqilg'i quydim", tone: "warning", form: fuel });
  } else {
    // Zavod tomoni: "Yuklandi" — ishlab chiqarish mikserni yuklab, skladdan chiqimni tasdiqlaydi.
    // Yo'l bosqichlari (yo'lga chiqdi, obyektga keldi, tushirilmoqda, yetkazildi, qaytdi) bu yerda
    // YO'Q — ularni haydovchi o'z ilovasidan belgilaydi. Dispetcher esa muammoni hal qiladi va reysni yopadi.
    if (t.status === "PLANNED" && can(user, "trip.loaded")) actions.push({ id: "trip.loaded", label: "Yuklandi", tone: "brand", confirm: "Beton yuklandi deb belgilansinmi? Skladdan chiqim yoziladi." });
    if (t.status === "DELIVERED" && !t.closedAt && can(user, "trip.close")) {
      actions.push({ id: "trip.close", label: "Reysni yopish", tone: "success", form: closeForm(Number(t.qtyM3), t.acceptedQty != null ? Number(t.acceptedQty) : null, t.returnedQty != null ? Number(t.returnedQty) : null), disabled: openIssues.length > 0, hint: openIssues.length ? "Avval ochiq muammoni hal qiling" : undefined });
    }
    if (t.status !== "CANCELLED" && can(user, "trip.problem")) actions.push({ id: "trip.problem", label: "Muammo qayd etish", tone: "danger", form: ISSUE_FORM });
  }
  if (t.status === "PLANNED" && can(user, "trip.cancel")) actions.push({ id: "trip.cancel", label: "Bekor qilish", tone: "danger", confirm: "Reys bekor qilinsinmi?" });
  if (ecoEnabled() && can(user, "trip.eco")) actions.push({ id: "trip.eco", label: t.ecoDeliveryId ? "ECO'ga qayta yuborish" : "ECO'ga yuborish", tone: "warning" });

  return {
    key: "trips", id: t.id, title: t.deliveryNoteNo, subtitle: t.order.customer.name, status: t.status,
    fields: [
      { label: "Haydovchi", value: t.driver.fullName },
      { label: "Telefon", value: t.driver.phone ?? "—", tone: t.driver.phone ? undefined : "danger" },
      { label: "Mashina", value: t.vehicle.plate },
      // Nima olib ketyapti — zayavkadagi mahsulot(lar)
      { label: "Mahsulot", value: [...new Set(t.order.items.map((i) => i.product.name))].join(", ") || "—" },
      // Reys miqdori zayavkadagi mahsulot birligida
      { label: "Hajm", value: inUnit(sum(t.qtyM3), soleUnit(t.order.items.map((i) => ({ unit: i.product.unit, qty: i.qtyM3 })))) },
      { label: "Bosqich", value: TRIP_PHASE[phase].label, tone: (phase === "CLOSED" || phase === "DELIVERED" ? "success" : "info") as Tone },
      { label: "Manzil", value: t.order.deliveryAddress },
      // Obyekt kartasidagi kontakt va ko'rsatma — haydovchi obyektda kimga qo'ng'iroq qilishini bilsin
      ...(t.order.site?.contactName || t.order.site?.contactPhone ? [{ label: "Obyektda kontakt", value: [t.order.site.contactName, t.order.site.contactPhone].filter(Boolean).join(", ") }] : []),
      ...(t.order.site?.deliveryHours ? [{ label: "Qabul vaqti", value: t.order.site.deliveryHours }] : []),
      ...(t.order.site?.instructions ? [{ label: "Ko'rsatma", value: t.order.site.instructions, tone: "warning" as Tone }] : []),
      ...(planned ? [{ label: "Reja", value: dt(planned) }] : []),
      { label: "Zayavka", value: t.order.orderNo },
      ...(track ? [{ label: "Yurilgan yo'l", value: `${distanceLabel(track.meters)}${track.minutes > 0 ? ` · ${track.minutes} daq` : ""}`, tone: "brand" as Tone }] : []),
      ...(arrival?.remainingM != null ? [{ label: "Obyektgacha", value: distanceLabel(arrival.remainingM), tone: (arrival.near ? "success" : "info") as Tone }] : []),
      ...(t.loadedAt ? [{ label: "Yuklandi", value: dt(t.loadedAt) }] : []),
      ...(t.departedAt ? [{ label: "Yo'lga chiqdi", value: dt(t.departedAt) }] : []),
      ...(t.arrivedAt ? [{ label: "Obyektga keldi", value: dt(t.arrivedAt) }] : []),
      ...(t.deliveredAt ? [{ label: "Yetkazildi", value: dt(t.deliveredAt) }] : []),
      ...(t.acceptedQty != null ? [{ label: "Qabul qilindi", value: String(Number(t.acceptedQty)) }] : []),
      ...(t.returnedQty != null && Number(t.returnedQty) > 0 ? [{ label: "Qaytarildi", value: String(Number(t.returnedQty)), tone: "warning" as Tone }] : []),
      ...(t.returnedAt ? [{ label: "Zavodga qaytdi", value: dt(t.returnedAt) }] : []),
      ...(openIssues.length ? [{ label: "Ochiq muammo", value: openIssues.map((i) => ISSUE_KIND[i.kind]).join(", "), tone: "danger" as Tone }] : []),
      ...(t.receiverName ? [{ label: "Qabul qildi", value: t.receiverName }] : []),
      ...(t.ecoStatus ? [{ label: "Haydovchi ilovasi", value: ecoLabel(t.ecoStatus)?.label ?? t.ecoStatus, tone: "info" as Tone }] : []),
      ...(t.ecoSyncedAt ? [{ label: "ECO sinxron", value: dt(t.ecoSyncedAt) }] : []),
      ...(t.ecoError ? [{ label: "ECO xatosi", value: t.ecoError, tone: "danger" as Tone }] : []),
      ...(t.note ? [{ label: "Izoh", value: t.note }] : []),
    ],
    sections: [
      await stepsSection(t.id),
      ...(t.issues.length ? [{
        title: "Muammolar", empty: "", icon: "alert-triangle",
        rows: t.issues.map((i) => ({ id: i.id, title: ISSUE_KIND[i.kind], subtitle: i.resolvedAt ? `Hal qilindi: ${i.resolution ?? ""}` : (i.note ?? "ochiq"), right: shortDt(i.createdAt), tone: (i.resolvedAt ? "success" : "danger") as Tone })),
      }] : []),
    ],
    actions: [
      ...actions,
      // Ochiq muammolarni ilovadan hal qilish (logistika)
      ...(!isDriver && openIssues.length && can(user, "trip.resolve") ? [{ id: "trip.resolve", label: `Muammoni hal qilish (${openIssues.length})`, tone: "success" as const, form: resolveIssueForm(openIssues, ISSUE_KIND) }] : []),
    ],
  };
}

// ───────────────────────── Schyot ─────────────────────────

async function invoiceDetail(user: MobileUser, id: string): Promise<MobileDetail> {
  const inv = await db.invoice.findUnique({ where: { id }, include: { customer: true, order: true, payments: { include: { cashAccount: true }, orderBy: { date: "desc" } } } });
  if (!inv) throw new ListError("NOT_FOUND", "Schyot topilmadi", 404);
  const paid = inv.payments.reduce((s, p) => s + sum(p.amount), 0);
  const left = sum(inv.amount) - paid;

  const actions: DetailAction[] = [];
  if (["OPEN", "PARTIAL"].includes(inv.status) && can(user, "invoice.pay")) {
    const accounts = await db.cashAccount.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      include: { _count: { select: { payments: true, transactions: true } } },
    });
    // Ko'p ishlatilgani birinchi turadi; bir xil nomlilar bo'lsa id oxiri bilan ajratiladi
    // (bazada bir nechta bir xil nomli kassa bo'lib qolishi mumkin).
    const byName = new Map<string, number>();
    for (const a of accounts) byName.set(a.name, (byName.get(a.name) ?? 0) + 1);
    const sorted = [...accounts].sort((a, b) => (b._count.payments + b._count.transactions) - (a._count.payments + a._count.transactions));
    actions.push({
      id: "invoice.pay", label: "To'lov qabul qilish", tone: "success",
      form: [
        { name: "amount", label: "Summa (so'm)", type: "number", required: true, value: String(Math.round(left)) },
        {
          name: "cashAccountId", label: "Qayerga tushdi", type: "select", required: true, value: sorted[0]?.id,
          options: sorted.map((a) => ({
            value: a.id,
            label: `${a.name} (${a.type === "CASH" ? "kassa" : "bank"})${(byName.get(a.name) ?? 0) > 1 ? ` · ${a.id.slice(-4)}` : ""}`,
          })),
        },
        { name: "note", label: "Izoh", type: "text" },
      ],
    });
  }
  // «Bekor qilish» — ochiq, to'lovsiz schyot (`./moliya-extra.ts`, qoida `lib/invoices.ts`)
  actions.push(...invoiceCancelActions(user, inv, paid));

  const fields: DetailField[] = [
    { label: "Schyot", value: inv.invoiceNo },
    { label: "Sana", value: day(inv.date) },
    { label: "Jami", value: money(sum(inv.amount)) },
    { label: "To'landi", value: money(paid), tone: "success" },
    { label: "Qoldiq", value: money(left), tone: left > 0 ? "danger" : "success" },
    ...(inv.order ? [{ label: "Zayavka", value: inv.order.orderNo }] : []),
  ];
  // Chek holati — schyot holatining o'zi: to'langan yashil, qisman/ochiq sariq, bekor qizil
  const st = inv.status === "PAID" ? { label: "To'langan", tone: "success" as const }
    : inv.status === "PARTIAL" ? { label: `Qisman · qoldiq ${money(left)}`, tone: "warning" as const }
    : inv.status === "CANCELLED" ? { label: "Bekor qilingan", tone: "danger" as const }
    : { label: "To'lanmagan", tone: "warning" as const };
  return {
    key: "invoices", id: inv.id, title: inv.invoiceNo, subtitle: inv.customer.name, status: inv.status,
    fields: fields.slice(1),
    sections: [{ title: "To'lovlar", empty: "To'lov yo'q", target: "payments", rows: inv.payments.map((p) => ({ id: p.id, title: `+${money(sum(p.amount))}`, subtitle: `${day(p.date)} · ${p.cashAccount.name}`, right: `+${money(sum(p.amount))}`, tone: "success" as Tone })) }],
    actions,
    receipt: {
      headline: money(sum(inv.amount)), caption: inv.customer.name,
      status: { ...st, at: inv.date.toISOString() },
      rows: fields.map((f) => ({ label: f.label, value: f.value, copy: f.label === "Schyot" || f.label === "Zayavka" })),
    },
  };
}

// ───────────────────────── Qolganlari — faqat ko'rish ─────────────────────────

async function paymentDetail(user: MobileUser, id: string): Promise<MobileDetail> {
  const p = await db.payment.findUnique({ where: { id }, include: { customer: true, cashAccount: true, invoice: true, order: true, createdBy: { select: { fullName: true } } } });
  if (!p) throw new ListError("NOT_FOUND", "To'lov topilmadi", 404);
  const fields: DetailField[] = [
    { label: "Sana", value: dt(p.date) },
    { label: "Mijoz", value: p.customer.name },
    { label: "Hisob", value: p.cashAccount.name },
    ...(p.invoice ? [{ label: "Schyot", value: p.invoice.invoiceNo }] : []),
    ...(p.order ? [{ label: "Zayavka", value: p.order.orderNo }] : []),
    ...(p.createdBy ? [{ label: "Kim kiritdi", value: p.createdBy.fullName }] : []),
    ...(p.note ? [{ label: "Izoh", value: p.note }] : []),
  ];
  return {
    key: "payments", id: p.id, title: `+${money(sum(p.amount))}`, subtitle: p.customer.name,
    // Storno va schyotga bog'lash — `./moliya-extra.ts`
    fields, sections: [], actions: await paymentActions(user, p.id),
    receipt: {
      headline: `+${money(sum(p.amount))}`, caption: p.customer.name,
      status: { label: "To'lov qabul qilindi", tone: "success", at: p.date.toISOString() },
      rows: fields.filter((f) => f.label !== "Mijoz").map((f) => ({ label: f.label, value: f.value, copy: f.label === "Schyot" || f.label === "Zayavka" })),
    },
  };
}

async function receiptDetail(user: MobileUser, id: string): Promise<MobileDetail> {
  const r = await db.goodsReceipt.findUnique({
    where: { id },
    include: { supplier: true, warehouse: true, createdBy: true, recipient: { select: { name: true } }, buyer: { select: { fullName: true } }, items: { include: { material: true } } },
  });
  if (!r) throw new ListError("NOT_FOUND", "Kirim topilmadi", 404);
  const { base, vat, total, delivery } = receiptAmounts(r.items);
  // «Kirim» ustunlari (Excel jurnalidagi ТТН, Деньги, Кому, Адрес, Снабженец, Почему, Доставка): TTN, To'lov turi, Kimga,
  // Manzil, Ta'minotchi, Maqsad, Yetkazib berish. To'lov turi — kirimdagi belgi, bo'lmasa bog'langan to'lov hisobining turi (jurnal bilan bir qoida — `resolveReceiptPayments`)
  const pay = (await resolveReceiptPayments([{ id: r.id, payment: r.payment }])).get(r.id) ?? null;
  const waybill = r.waybillNo ?? waybillFromNote(r.note);
  const fields: DetailField[] = [
    { label: "Hujjat", value: r.docNo },
    { label: "Sana", value: day(r.date) },
    { label: "Yetkazuvchi", value: r.supplier.name },
    { label: "Ombor", value: r.warehouse.name },
    ...(waybill ? [{ label: "TTN", value: waybill }] : []),
    ...(pay ? [{ label: "To'lov turi", value: PAY_LABEL[pay] }] : []),
    ...(r.recipient ? [{ label: "Kimga", value: r.recipient.name }] : []),
    ...(r.address ? [{ label: "Manzil", value: r.address }] : []),
    ...(r.buyer ? [{ label: "Ta'minotchi", value: r.buyer.fullName }] : []),
    ...(r.purpose ? [{ label: "Maqsad", value: r.purpose }] : []),
    // Yetkazib berish QQS'siz, «QQS'siz» summasi ichida
    ...(delivery > 0 ? [{ label: "Yetkazib berish", value: money(delivery) }] : []),
    { label: "QQS'siz", value: money(base) },
    { label: "QQS", value: money(vat) },
    { label: "Jami (QQS bilan)", value: money(total) },
    ...(r.createdBy ? [{ label: "Kim kiritdi", value: r.createdBy.fullName }] : []),
    ...(r.note ? [{ label: "Izoh", value: r.note }] : []),
    // Storno: sklad harakatlari teskari yozilgan — qoldiq va qarzga kirmaydi
    ...(r.cancelledAt ? [{ label: "Holat", value: `Bekor qilingan · ${day(r.cancelledAt)}${r.cancelReason ? ` · ${r.cancelReason}` : ""}`, tone: "danger" as Tone }] : []),
  ];
  // Moliya: to'lanmagan kirim bo'lsa — qolgan summa va «To'lash» (`./moliya-extra.ts`, veb Kirim-Chiqim → «To'lanmagan kirimlar»)
  const moliya = r.cancelledAt ? null : await receiptPayActions(user, r.id);
  // Sklad: to'langan summa va «Storno» (`./sklad-extra.ts`, veb `/receipts/[id]`)
  const sklad = await receiptExtra(user, r);
  return {
    key: "receipts", id: r.id, title: r.docNo, subtitle: r.supplier.name,
    ...(r.cancelledAt ? { status: "Bekor qilingan" } : {}),
    fields: [...fields.slice(1), ...sklad.fields, ...(moliya?.fields ?? [])],
    sections: [{ title: "Qatorlar", empty: "Qator yo'q", icon: "package", rows: r.items.map((i) => ({ id: i.id, title: i.material.name, subtitle: `${money(sum(i.price))} / ${i.material.unit}${Number(i.vatAmount) > 0 ? ` + QQS ${i.vatRate}%` : ""}${sum(i.deliveryCost) > 0 ? ` + yetkazib berish ${money(sum(i.deliveryCost))}` : ""}`, right: `${sum(i.qty)} ${i.material.unit}` })) }],
    actions: [...(moliya?.actions ?? []), ...sklad.actions],
    // Xarid — pul chiqib ketgan hujjat, chekda qizil
    receipt: {
      headline: r.cancelledAt ? `${money(total)} · bekor qilingan` : `−${money(total)}`, caption: r.supplier.name,
      status: r.cancelledAt
        ? { label: "Bekor qilingan · qoldiqqa kirmaydi", tone: "warning", at: r.cancelledAt.toISOString() }
        : { label: "Xarid · omborga kirim", tone: "danger", at: r.date.toISOString() },
      rows: fields.filter((f) => f.label !== "Yetkazuvchi").map((f) => ({ label: f.label, value: f.value, copy: f.label === "Hujjat" || f.label === "TTN" })),
    },
  };
}

async function taskDetail(user: MobileUser, id: string): Promise<MobileDetail> {
  const t = await db.brigadeTask.findUnique({
    where: { id },
    include: {
      brigade: true, order: { include: { customer: true } }, orderItem: { include: { product: true } },
      progress: { orderBy: { date: "desc" }, include: { createdBy: true } },
      issues: { orderBy: { createdAt: "desc" }, select: { id: true, kind: true, note: true, equipment: true, createdAt: true, resolvedAt: true } },
      defects: { orderBy: { date: "desc" }, select: { id: true, qty: true, reason: true, note: true, date: true, createdBy: { select: { fullName: true } } } },
    },
  });
  if (!t) throw new ListError("NOT_FOUND", "Topshiriq topilmadi", 404);
  // Brigadirga faqat o'z brigadasining topshirig'i. Reysdagidek "topilmadi" deymiz:
  // "ruxsat yo'q" desak, begona topshiriq mavjudligini tasdiqlagan bo'lardik.
  if (user.role === "BRIGADIER" && !(await myBrigadeIds(user.id)).includes(t.brigadeId)) {
    throw new ListError("NOT_FOUND", "Topshiriq topilmadi", 404);
  }
  const left = sum(t.qty) - sum(t.doneQty);
  const open = !["DONE", "CANCELLED"].includes(t.status);
  const unit = unitLabel(t.orderItem.product.unit);
  const ph = taskPhase(t, t.issues.filter((i) => !i.resolvedAt).map((i) => i.kind));
  const pu = t.orderItem.product.unit;
  const defQty = t.defects.reduce((a, d) => a + sum(d.qty), 0);
  const defPct = sum(t.doneQty) > 0 ? (defQty / sum(t.doneQty)) * 100 : 0;
  // Fakt bilan birga "shundan brak" — brigadir alohida forma ochmasin
  const defectFields: FormField[] = [
    { name: "defectQty", label: `Shundan brak (${unit})`, type: "number", placeholder: "0", hint: "brak chiqmagan bo'lsa bo'sh qoldiring" },
    { name: "defectReason", label: "Brak sababi", type: "select", value: DEFECT_REASONS[0], options: DEFECT_REASONS.map((r) => ({ value: r, label: r })) },
  ];

  // Hujjatdagi tartib: Ishni boshlash → fakt (qisman) → yakunlash; yon tomonda muammo va brak
  const actions: DetailAction[] = [];
  if (open && !t.startedAt && t.status === "NEW" && can(user, "task.start")) {
    actions.push({ id: "task.start", label: "Ishni boshlash", tone: "brand", confirm: `${t.taskNo} — ish boshlandi deb belgilansinmi? Smena ochilmagan bo'lsa, u ham ochiladi.` });
  }
  if (open && can(user, "task.progress")) {
    actions.push({
      id: "task.progress", label: "Faktni kiritish", tone: "success",
      form: [
        { name: "qty", label: `Bajarilgan miqdor (${unit}) — qoldiq ${num(left)}`, type: "number", required: true, value: String(left), hint: "Qisman bajarilgan bo'lsa — bajarilganini yozing" },
        ...defectFields,
        { name: "note", label: "Izoh", type: "text" },
      ],
    });
  }
  if (open && left > 0 && can(user, "task.finish")) {
    actions.push({
      id: "task.finish", label: `Ishni yakunlash — ${num(left)} ${unit}`, tone: "success",
      confirm: `Qolgan ${num(left)} ${unit} bajarildi va topshiriq yopilsinmi?`,
      form: [...defectFields, { name: "note", label: "Yakuniy izoh", type: "text", placeholder: "ixtiyoriy" }],
    });
  }
  // Muammo tugmalari smena kartasidagi bilan bir xil (`issue.*`) — id topshiriq bo'lgani uchun muammo shunga bog'lanadi
  if (open && can(user, "issue.material")) actions.push(...issueActions(null));
  if (can(user, "task.defect") && sum(t.doneQty) > 0) actions.push(defectAction("task.defect", [t.orderItem.product]));
  if (open && can(user, "task.cancel")) actions.push({ id: "task.cancel", label: "Bekor qilish", tone: "danger", confirm: "Topshiriq bekor qilinsinmi?" });

  return {
    key: "tasks", id: t.id, title: t.taskNo, subtitle: `${t.brigade.name} · ${t.order.customer.name}`, status: ph.label,
    fields: [
      { label: "Holat", value: ph.label, tone: ph.tone === "brand" || ph.tone === "info" ? undefined : ph.tone },
      { label: "Mahsulot", value: t.orderItem.product.name },
      { label: "Topshiriq", value: inUnit(sum(t.qty), t.orderItem.product.unit) },
      // Brigadirga faqat foiz — miqdorlar "Topshiriq" va "Qoldiq" qatorlarida bor
      { label: "Bajarildi", value: user.role === "BRIGADIER" ? `${Math.round((sum(t.doneQty) / (sum(t.qty) || 1)) * 100)}%` : `${inUnit(sum(t.doneQty), t.orderItem.product.unit)} / ${inUnit(sum(t.qty), t.orderItem.product.unit)} · ${Math.round((sum(t.doneQty) / (sum(t.qty) || 1)) * 100)}%`, tone: left <= 0 ? "success" : "warning" },
      { label: "Qoldiq", value: inUnit(left, t.orderItem.product.unit), tone: left > 0 ? "warning" : "success" },
      ...(sum(t.doneQty) > 0 ? [
        { label: "Brak", value: defQty > 0 ? `${inUnit(defQty, pu)} · ${pctText(defPct)}` : "yo'q", tone: (defQty > 0 ? (defPct > 5 ? "danger" : "warning") : "success") as Tone },
        { label: "Sifatli", value: inUnit(Math.max(0, sum(t.doneQty) - defQty), pu), tone: "success" as Tone },
      ] : []),
      { label: "Muddat", value: day(t.dueDate), tone: ph.late ? "danger" : undefined },
      ...(t.startedAt ? [{ label: "Boshlandi", value: dt(t.startedAt) }] : []),
      ...(t.order.isUrgent ? [{ label: "Shoshilinch", value: "ha", tone: "danger" as Tone }] : []),
      { label: "Zayavka", value: t.order.orderNo },
      ...(t.note ? [{ label: "Izoh", value: t.note }] : []),
    ],
    sections: [
      {
        title: "Bajarilganlik qaydlari", empty: "Hali qayd yo'q", icon: "square-check",
        rows: t.progress.map((p) => ({ id: p.id, title: inUnit(sum(p.qty), t.orderItem.product.unit), subtitle: `${day(p.date)} · ${p.createdBy.fullName}${p.note ? ` · ${p.note}` : ""}`, tone: "success" as Tone })),
      },
      ...(t.defects.length ? [{
        title: `Brak — ${inUnit(defQty, pu)}`, empty: "Brak yo'q", icon: "triangle-alert",
        rows: t.defects.map((d) => ({ id: d.id, title: inUnit(sum(d.qty), pu), subtitle: `${dt(d.date)} · ${d.reason}${d.note ? ` · ${d.note}` : ""} · ${d.createdBy.fullName}`, tone: "danger" as Tone })),
      }] : []),
      ...(t.issues.length ? [{
        title: "Muammolar", empty: "Muammo yo'q", target: "brig-issue",
        rows: t.issues.map((i) => ({ id: i.id, title: BRIGADE_ISSUE[i.kind].label, subtitle: [i.equipment, i.note].filter(Boolean).join(" · "), right: day(i.createdAt), status: i.resolvedAt ? "Hal qilindi" : "Ochiq", tone: (i.resolvedAt ? "success" : "danger") as Tone })),
      }] : []),
    ],
    actions,
  };
}

async function batchDetail(id: string): Promise<MobileDetail> {
  const b = await db.productionBatch.findUnique({ where: { id }, include: { product: true, recipe: { include: { items: { include: { material: true, product: true } } } }, order: { include: { customer: true } }, createdBy: true } });
  if (!b) throw new ListError("NOT_FOUND", "Zames topilmadi", 404);
  return {
    key: "production", id: b.id, title: b.batchNo, subtitle: b.product.name,
    ...(b.cancelledAt ? { status: "Bekor qilingan" } : {}),
    fields: [
      // Storno: xomashyo skladga qaytgan, mahsulot qoldiqdan chiqarilgan
      ...(b.cancelledAt ? [{ label: "Holat", value: `Bekor qilingan · ${dt(b.cancelledAt)}${b.cancelReason ? ` · ${b.cancelReason}` : ""}`, tone: "danger" as Tone }] : []),
      { label: "Sana", value: dt(b.date) },
      { label: "Smena", value: `${b.shift}-smena` },
      { label: "Hajm", value: inUnit(sum(b.qtyM3), b.product.unit) },
      { label: "Zayavka", value: b.order ? `${b.order.orderNo} · ${b.order.customer.name}` : "Omborga" },
      { label: "Retsept", value: `${b.product.name} · v${b.recipe.version}` },
      { label: "Kim kiritdi", value: b.createdBy.fullName },
    ],
    sections: [{
      title: b.cancelledAt ? "Retsept bo'yicha (bekor qilingan — skladga qaytarilgan)" : "Sarflangan xomashyo / mahsulot", empty: "Retsept bo'sh", icon: "layers",
      rows: b.recipe.items.map((i) => { const ing = ingredientOf(i); return { id: i.id, title: ing.name, subtitle: `${sum(ing.qtyPerM3)} ${ing.unit} / ${unitLabel(b.product.unit)}`, right: `${(ing.qtyPerM3 * sum(b.qtyM3)).toFixed(1)} ${ing.unit}` }; }),
    }],
    actions: [],
  };
}

/**
 * Xomashyo kartochkasi. Sklad qismi: «Dona narxi» (kim/qachon belgilagan) va joriy oy bo'yicha
 * «Qoldiqlar» (Boshida / Kirim / Chiqim / Jami — veb Sklad → Qoldiqlar bilan bir manba, `materialTurnover`).
 * «Dona narxi» tugmasi — `material.price` (Snabjeniye / direktor, `actions.ts` → `setMaterialPrice`).
 * Narx va summalar (sklad qismi) — faqat ko'rish huquqi borlarga: direktor, «Qoldiqlar» ro'yxati ochiqlar yoki «Dona narxi»
 * qo'ya oladiganlar. Kartochkani ochadigan boshqa rollarga (sotuv, logistika, mexanik…) qolgan qismi avvalgidek.
 */
async function materialDetail(user: MobileUser, id: string): Promise<MobileDetail> {
  const m = await db.material.findUnique({ where: { id }, include: { unitPriceBy: { select: { fullName: true } } } });
  if (!m) throw new ListError("NOT_FOUND", "Xomashyo topilmadi", 404);
  const month = skladPeriod("month");
  const seePrice = user.role === "DIRECTOR" || listAllowed(user, "ostatki") || can(user, "material.price");
  const [agg, moves, outlook, turnover] = await Promise.all([
    db.stockMove.aggregate({ where: { materialId: id }, _sum: { qty: true } }),
    db.stockMove.findMany({
      where: { materialId: id }, orderBy: { date: "desc" }, take: 20,
      include: { createdBy: true, recipient: { select: { name: true } }, employee: { select: { fullName: true } }, brigade: { select: { name: true } } },
    }),
    materialOutlook(),
    seePrice ? materialTurnover({ from: month.from, to: month.to }) : Promise.resolve([]),
  ]);
  const balance = sum(agg._sum.qty);
  const o = outlook.find((x) => x.id === id);
  const n = (v: number) => `${num(v)} ${m.unit}`;
  const need = o ? Math.max(0, o.planned - balance, sum(m.minStock) - balance) : 0;
  // ISSUE — Sklad → «Chiqim» (oluvchiga berish); SHIPMENT — mahsulot jo'natish (ikkalasi bir xil nomlanmasin)
  const MOVE_LABEL: Record<string, string> = { RECEIPT: "Kirim", PRODUCTION_CONSUME: "Ishlab chiqarishga", PRODUCTION_OUTPUT: "Ishlab chiqarildi", SHIPMENT: "Jo'natildi", ADJUSTMENT: "Tuzatish", WRITE_OFF: "Hisobdan chiqarish", BRIGADE_ISSUE: "Brigadaga berildi", BRIGADE_RETURN: "Brigadadan qaytdi", TRANSFER: "Ko'chirish", ISSUE: "Chiqim" };
  // Storno harakati (teskari yozuv) alohida nom bilan — "Kirim −5 t" chalg'itmasin. Chiqim — oluvchi bilan, brigada — nomi bilan
  const moveLabel = (mv: { type: string; note: string | null; recipient: { name: string } | null; employee: { fullName: string } | null; brigade: { name: string } | null }) => {
    const whom = mv.type === "ISSUE" ? ` → ${mv.employee?.fullName ?? mv.recipient?.name ?? "—"}` : (mv.type === "BRIGADE_ISSUE" || mv.type === "BRIGADE_RETURN") && mv.brigade ? ` · ${mv.brigade.name}` : "";
    return `${mv.note?.startsWith("Storno ") || mv.note?.startsWith("Bekor qilish ") ? "Bekor qilish · " : ""}${MOVE_LABEL[mv.type] ?? mv.type}${whom}`;
  };

  // «Dona narxi»: Snabjeniye belgilagan narx; bo'lmasa chiqimlar o'rtacha tannarx bilan baholanadi («≈»)
  const u = unitShort(m.unit);
  const tr = turnover.find((x) => x.id === id);
  const own = m.unitPrice == null ? null : Number(m.unitPrice);
  const avg = tr?.avgCost ?? null;
  const priceFields: DetailField[] = !seePrice ? [] : [
    {
      label: "Dona narxi",
      value: own != null ? `${fmtNum(own, 2)} so'm / ${u}` : avg != null ? `narx belgilanmagan · ≈ ${fmtNum(avg, 2)} (o'rtacha tannarx)` : "narx belgilanmagan",
      ...(own == null ? { tone: "warning" as Tone } : {}),
    },
    ...(own != null && (m.unitPriceBy || m.unitPriceAt) ? [{ label: "Narxni belgilagan", value: [m.unitPriceBy?.fullName, m.unitPriceAt ? dateRu(m.unitPriceAt) : null].filter(Boolean).join(" · ") }] : []),
  ];
  const sumText = (s: number) => `Summa ${tr?.approx ? "≈" : ""}${fmtNum(s)} so'm`;
  const turnoverSection: HomeSection[] = tr ? [{
    title: `Qoldiqlar · ${month.range}`, empty: "", icon: "warehouse",
    rows: [
      { id: "t-open", title: "Boshlang'ich qoldiq", subtitle: sumText(tr.open.s), right: qtyUnit(tr.open.q, m.unit) },
      { id: "t-in", title: "Kirim", subtitle: sumText(tr.in.s), right: `${tr.in.q ? "+" : ""}${qtyUnit(tr.in.q, m.unit)}`, tone: "success" as Tone },
      { id: "t-out", title: "Chiqim", subtitle: sumText(tr.out.s), right: `${tr.out.q ? "−" : ""}${qtyUnit(tr.out.q, m.unit)}`, tone: "danger" as Tone },
      { id: "t-close", title: "Jami (qoldiq)", subtitle: sumText(tr.close.s), right: qtyUnit(tr.close.q, m.unit), ...(turnoverLow(tr) ? { status: "Kam", tone: "danger" as Tone } : {}) },
    ],
  }] : [];

  const actions: DetailAction[] = [];
  if (can(user, "material.price")) {
    actions.push({
      id: "material.price", label: "Dona narxi", tone: "brand",
      form: [{
        name: "price", label: `Dona narxi (1 ${u} uchun)`, type: "number", required: true, placeholder: "0",
        // Narx yo'q bo'lsa — o'rtacha tannarx taklif qilinadi (vebdagi «o'rtachadan to'ldirish» kabi)
        value: own != null ? String(own) : avg != null ? String(Math.round(avg * 100) / 100) : undefined,
        hint: "Chiqim, brigadaga berish va hisobdan chiqarish shu narxda hisoblanadi",
      }],
    });
  }
  // «Dona narxi» ni olib tashlash va xomashyoni o'chirish (`./sklad-extra.ts`)
  actions.push(...materialExtraActions(user, m));

  return {
    key: "stock", id: m.id, title: m.name, subtitle: m.code,
    fields: [
      { label: "Qoldiq", value: `${balance.toFixed(1)} ${m.unit}`, tone: balance < sum(m.minStock) ? "danger" : "success" },
      { label: "Minimum", value: `${sum(m.minStock)} ${m.unit}` },
      ...priceFields,
      ...(o ? [
        { label: "Zayavkalarga kerak", value: o.planned > 0 ? `${n(o.planned)} · ${o.orders.length} ta zayavka` : "yo'q" },
        { label: "Zayavkaga yetmaydi", value: o.orderGap > 0 ? n(o.orderGap) : "yetadi", tone: (o.orderGap > 0 ? "danger" : "success") as Tone },
        ...(need > 0 ? [{ label: "Olib kelish kerak", value: n(need), tone: "warning" as Tone }] : []),
        ...(o.perDay > 0 ? [{ label: "Kunlik sarf", value: `${n(o.perDay)} · ${o.days !== null ? `${o.days > 999 ? ">999" : o.days.toFixed(1)} kunga yetadi` : "—"}` }] : []),
      ] : []),
      { label: "Holat", value: m.isActive ? "Faol" : "Nofaol" },
    ],
    sections: [...turnoverSection, ...(o && o.orders.length ? [{
      title: `Zayavkalar bo'yicha kerak · ${o.orders.length}`, empty: "", target: "orders", icon: "clipboard-list",
      rows: (() => {
        // Yetkazish sanasi bo'yicha navbat: qoldiq qaysi zayavkagacha yetadi
        let left = balance;
        return o.orders.map((x) => {
          left -= x.qty;
          return { id: x.id, title: `${x.orderNo} · ${x.customer}`, subtitle: `${day(x.date)} · ${left >= 0 ? "qoldiq yetadi" : `yetmaydi: ${n(Math.min(x.qty, -left))} kam`}`, right: n(x.qty), tone: (left >= 0 ? "success" : "danger") as Tone };
        });
      })(),
    }] : []), {
      title: "So'nggi harakatlar", empty: "Harakat yo'q",
      rows: moves.map((mv) => ({ id: mv.id, title: moveLabel(mv), subtitle: `${day(mv.date)}${mv.createdBy ? ` · ${mv.createdBy.fullName}` : ""}${mv.type === "ISSUE" && mv.note ? ` · ${mv.note}` : ""}`, right: `${sum(mv.qty) > 0 ? "+" : ""}${sum(mv.qty).toFixed(1)} ${m.unit}`, tone: sum(mv.qty) > 0 ? ("success" as Tone) : ("danger" as Tone) })),
    }],
    actions,
  };
}

/**
 * «Chiqim» — bitta berish hujjati (Sklad → Chiqim, `lib/stock-issue.ts#issueStock`): `refType "Issue"`, id = ref.
 * Ilova yangi «Chiqim» saqlangach shu kartochkani ochadi. Narx — yozilgan paytdagi «Dona narxi» (snapshot).
 */
async function issueDetail(user: MobileUser, ref: string): Promise<MobileDetail> {
  const moves = await db.stockMove.findMany({
    where: { refType: "Issue", refId: ref },
    orderBy: { createdAt: "asc" },
    select: {
      id: true, date: true, qty: true, unitCost: true, note: true, materialId: true, recipientId: true, employeeId: true, brigadeId: true,
      material: { select: { name: true, unit: true } }, warehouse: { select: { name: true } },
      recipient: { select: { name: true } }, employee: { select: { fullName: true } }, brigade: { select: { name: true } }, createdBy: { select: { fullName: true } },
    },
  });
  if (!moves.length) throw new ListError("NOT_FOUND", "Chiqim topilmadi", 404);
  // Storno qilingan berish (`cancelIssue`: teskari harakatlar `refType "IssueStorno"`, `refId = ref`) — kartochkada belgisi bilan
  const storno = await db.stockMove.findFirst({ where: { refType: ISSUE_STORNO, refId: ref }, select: { createdAt: true, note: true, createdBy: { select: { fullName: true } } } });
  const first = moves[0];
  const to = first.employee ? `Xodim: ${first.employee.fullName}` : first.recipient?.name ?? (first.brigade ? `Brigada: ${first.brigade.name}` : "—");
  const lines = moves.map((mv) => {
    const q = -sum(mv.qty), cost = mv.unitCost == null ? null : sum(mv.unitCost);
    return { mv, q, cost, total: cost == null ? 0 : Math.round(q * cost * 100) / 100 };
  });
  const total = Math.round(lines.reduce((a, l) => a + l.total, 0) * 100) / 100;
  const noPrice = lines.some((l) => l.cost == null);
  const fields: DetailField[] = [
    { label: "Sana", value: `${dateRu(first.date)} ${String(first.date.getHours()).padStart(2, "0")}:${String(first.date.getMinutes()).padStart(2, "0")}` },
    { label: "Kimdan", value: first.warehouse.name },
    { label: "Kimga", value: to },
    { label: "Xomashyolar soni", value: String(lines.length) },
    { label: "Umumiy summa", value: `${fmtNum(total)} so'm${noPrice ? " (ba'zi qatorlar narxsiz)" : ""}`, ...(noPrice ? { tone: "warning" as Tone } : {}) },
    { label: "Bergan xodim", value: first.createdBy.fullName },
    ...(first.note ? [{ label: "Izoh", value: first.note }] : []),
    ...(storno ? [{ label: "Bekor qilindi", value: [storno.note?.replace(STORNO_NOTE_RE, ""), storno.createdBy.fullName, dateRu(storno.createdAt)].filter(Boolean).join(" · "), tone: "warning" as Tone }] : []),
  ];
  // Storno tugmasi va oluvchi kartasiga havola (`./sklad-extra.ts`)
  const sklad = rasxodExtra(user, ref, !!storno, { recipientId: first.recipientId, employeeId: first.employeeId, brigadeId: first.brigadeId, name: to });
  return {
    key: "rasxod", id: ref, title: "Chiqim", subtitle: `${dateRu(first.date)} · ${to}`,
    ...(storno ? { status: "Bekor qilingan" } : {}),
    fields,
    sections: [{
      title: "Xomashyolar", empty: "", target: "stock", icon: "package",
      rows: lines.map((l) => ({
        id: l.mv.materialId ?? l.mv.id,
        title: l.mv.material?.name ?? "—",
        subtitle: `${qtyUnit(l.q, l.mv.material?.unit ?? "")} × ${l.cost == null ? "narxsiz" : `${fmtNum(l.cost, 2)} so'm`}`,
        right: `−${fmtNum(l.total)}`, tone: "danger" as Tone,
      })),
    }, ...sklad.sections],
    actions: sklad.actions,
    receipt: {
      headline: `−${fmtNum(total)} so'm`, caption: to,
      status: storno
        ? { label: "Bekor qilingan · skladga qaytarildi", tone: "warning", at: storno.createdAt.toISOString() }
        : { label: "Skladdan chiqim", tone: "danger", at: first.date.toISOString() },
      rows: fields.filter((f) => f.label !== "Kimga").map((f) => ({ label: f.label, value: f.value })),
    },
  };
}

/**
 * «Qoldiqlar» jami qatori (`jami~<davr>`, `list.ts`): davr summalari, minimumdan kam qolganlar va eng ko'p sarflanganlar.
 * Qatorlar bosilsa — xomashyo kartochkasi.
 */
async function ostatkiDetail(user: MobileUser, id: string): Promise<MobileDetail> {
  // id: `jami~<davr>` yoki `jami~<davr>|<sklad>` (ro'yxatdagi sklad filtri, `./sklad-extra.ts`)
  const { period: p, warehouseId } = parseSkladFilter(id.slice(OSTATKI_SUM.length));
  const wh = warehouseId ? await db.warehouse.findUnique({ where: { id: warehouseId }, select: { id: true, name: true } }) : null;
  const rows = await materialTurnover({ from: p.from, to: p.to, warehouseId: wh?.id });
  const s = turnoverSums(rows);
  const ap = s.approx ? "≈" : "";
  const money = (v: number) => `${ap}${fmtNum(v)} so'm`;
  const low = rows.filter(turnoverLow);
  const top = rows.filter((m) => m.out.s > 0.005).sort((a, b) => b.out.s - a.out.s).slice(0, 10);
  const matRow = (m: (typeof rows)[number], right: string) => ({
    id: m.id, title: `${m.name} (${unitShort(m.unit)})`, right,
    subtitle: `Qoldiq ${fmtNum(m.close.q, 3)} · Minimum ${fmtNum(m.minStock, 3)} · Jami ${m.approx ? "≈" : ""}${fmtNum(m.close.s)}`,
  });
  return {
    key: "ostatki", id, title: "Qoldiqlar — jami", subtitle: `${p.label} · ${p.range}${wh ? ` · ${wh.name}` : ""}`,
    fields: [
      { label: "Davr", value: p.range },
      { label: "Xomashyolar soni", value: String(rows.length) },
      { label: "Boshlang'ich qoldiq", value: money(s.open) },
      { label: "Kirim", value: money(s.in), tone: "success" },
      { label: "Chiqim", value: money(s.out), tone: "danger" },
      { label: "Jami (qoldiq)", value: money(s.close) },
      { label: "Kam (minimumdan past)", value: String(low.length), tone: low.length ? "danger" : "success" },
      ...(s.approx ? [{ label: "≈", value: "Ba'zi harakatlar narxsiz — «Dona narxi» yoki o'rtacha tannarx bo'yicha baholandi" }] : []),
    ],
    sections: [
      ...(low.length ? [{ title: `Kam · ${low.length}`, empty: "", target: "stock", icon: "triangle-alert", rows: low.slice(0, 30).map((m) => ({ ...matRow(m, qtyUnit(m.close.q, m.unit)), status: "Kam", tone: "danger" as Tone })) }] : []),
      { title: "Eng ko'p chiqim", empty: "Davr ichida chiqim bo'lmadi", target: "stock", icon: "circle-arrow-up", rows: top.map((m) => matRow(m, `−${shortSum(m.out.s)}`)) },
    ],
    // Narxi yo'q xomashyolarga o'rtacha tannarx (veb «Qoldiqlar» dagi tugma)
    actions: ostatkiExtraActions(user, rows.filter((m) => m.isActive && m.unitPrice == null && (m.avgCost ?? 0) > 0).length),
  };
}

async function employeeDetail(user: MobileUser, id: string): Promise<MobileDetail> {
  const e = await db.employee.findUnique({
    where: { id },
    include: {
      user: true,
      brigades: { orderBy: { name: "asc" }, include: { tasks: { where: { status: { in: ["NEW", "IN_PROGRESS"] } }, orderBy: { dueDate: "asc" }, include: { order: { include: { customer: true } }, orderItem: { include: { product: true } } } } } },
      trips: { orderBy: { createdAt: "desc" }, take: 10, include: { order: { include: { customer: true, items: { select: { qtyM3: true, product: { select: { unit: true } } } } } } } },
    },
  });
  if (!e) throw new ListError("NOT_FOUND", "Xodim topilmadi", 404);
  if (user.role === "DISPATCHER" && !(await driverPositionNames()).includes(e.position)) throw new ListError("FORBIDDEN", "Dispetcherga faqat haydovchi kartasi ochiq", 403);
  const led = e.brigades.filter((b) => b.isActive);
  const tasks = led.flatMap((b) => b.tasks.map((t) => ({ ...t, brigadeName: b.name })));

  // Brigadir biriktirish: mavjud brigada tanlanadi yoki shu yerda yangisi ochiladi
  const actions: DetailAction[] = [];
  if (e.isActive && can(user, "employee.brigade")) {
    const brigades = await activeBrigades();
    actions.push({
      id: "employee.brigade",
      label: led.length ? "Brigadani almashtirish" : "Brigadir qilib biriktirish",
      tone: "brand",
      form: [
        {
          name: "brigadeId", label: "Brigada", type: "select", required: true, value: led[0]?.id,
          options: [
            { value: NEW_BRIGADE, label: "+ Yangi brigada" },
            ...brigades.map((b) => ({
              value: b.id,
              label: `${b.name} · ${b.leaderId === e.id ? "hozirgi brigadiri" : b.leader ? `brigadiri ${b.leader.fullName}` : "brigadirsiz"}`,
            })),
          ],
          hint: led.length ? `Hozir: ${led.map((b) => b.name).join(", ")}` : "Bitta xodim bitta brigadaga brigadir bo'ladi",
        },
        { name: "newName", label: "Yangi brigada nomi", type: "text", required: true, placeholder: "1-brigada", showIf: { field: "brigadeId", equals: NEW_BRIGADE } },
        { name: "newPhone", label: "Brigada telefoni", type: "text", placeholder: e.phone ?? "+998 90 123 45 67", showIf: { field: "brigadeId", equals: NEW_BRIGADE } },
        { name: "newNote", label: "Izoh", type: "text", showIf: { field: "brigadeId", equals: NEW_BRIGADE } },
      ],
    });
  }
  // Hududdan tashqarida davomat: qiymat formadagi kalitdan aniq yuboriladi (`on`), almashtirilmaydi
  if (can(user, "employee.anywhere")) {
    actions.push({
      id: "employee.anywhere",
      label: e.attendanceAnywhere ? "Hududdan tashqarida davomat: yoqilgan" : "Hududdan tashqarida davomat",
      form: [{
        name: "on", label: "Hududdan tashqarida davomat", type: "switch", value: e.attendanceAnywhere ? "true" : "false",
        hint: "Komandirovka / obyektda ishlovchi: ish hududidan tashqarida ham Keldim/Ketdim belgilay oladi (yuz + joy rasmi bilan)",
      }],
    });
  }
  if (led.length && can(user, "employee.brigade.clear")) {
    actions.push({ id: "employee.brigade.clear", label: "Brigadirlikdan olish", tone: "danger", confirm: `${e.fullName} ${led.map((b) => b.name).join(", ")} brigadirligidan olinsinmi? Brigada o'chmaydi, brigadirsiz qoladi.` });
  }
  // Otdel kadr: tahrir, login, bo'shatish, surat, hujjatlar… — ruxsati borga (`./kadr-extra.ts`)
  const kadr = await kadrEmployeeExtras(user, e.id);
  actions.push(...kadr.actions);

  return {
    ...(kadr.photo ? { photo: kadr.photo } : {}),
    key: "employees", id: e.id, title: e.fullName, subtitle: e.position, status: e.isActive ? "Faol" : "Nofaol",
    fields: [
      { label: "Telefon", value: e.phone ?? "—" },
      { label: "Brigada", value: led.length ? `${led.map((b) => b.name).join(", ")} brigadiri` : "—", tone: led.length ? "success" : undefined },
      { label: "Tizim logini", value: e.user ? e.user.login : "yo'q" },
      { label: "Davomat joyi", value: e.attendanceAnywhere ? "Hududdan tashqarida ham" : "Faqat ish hududida", tone: e.attendanceAnywhere ? "warning" : undefined },
      { label: "Haydovchi ilovasi", value: e.ecoUserId ? (e.ecoActive ? "Ulangan" : "Nofaol") : "Ulanmagan", tone: e.ecoUserId && e.ecoActive ? "success" : e.ecoError ? "danger" : "info" },
      ...(e.ecoError ? [{ label: "ECO xatosi", value: e.ecoError, tone: "danger" as Tone }] : []),
      { label: "Ishga olingan", value: day(e.createdAt) },
    ],
    sections: [
      ...(tasks.length
        ? [{
            title: "Brigada topshiriqlari", empty: "Ochiq topshiriq yo'q", target: "tasks",
            rows: tasks.map((t) => ({ id: t.id, title: `${t.taskNo} · ${t.brigadeName}`, subtitle: `${t.order.customer.name} · muddat ${day(t.dueDate)}`, right: `${(sum(t.qty) - sum(t.doneQty)).toFixed(1)} / ${inUnit(sum(t.qty), t.orderItem.product.unit)}`, status: t.status, tone: (t.dueDate < new Date() ? "danger" : "warning") as Tone })),
          }]
        : []),
      ...(e.trips.length
        ? [{ title: "So'nggi reyslar", empty: "Reys yo'q", target: "trips", rows: e.trips.map((t) => ({ id: t.id, title: `${t.deliveryNoteNo} · ${t.order.customer.name}`, subtitle: day(t.createdAt), right: inUnit(sum(t.qtyM3), soleUnit(t.order.items.map((i) => ({ unit: i.product.unit, qty: i.qtyM3 })))), status: t.status, tone: TRIP_TONE[t.status] })) }]
        : []),
      ...kadr.sections,
    ],
    actions,
  };
}

async function cashflowDetail(user: MobileUser, id: string): Promise<MobileDetail> {
  const t = await db.cashTransaction.findUnique({ where: { id }, include: { cashAccount: true, supplier: true, createdBy: true } });
  if (!t) throw new ListError("NOT_FOUND", "Yozuv topilmadi", 404);
  // Ishora — txSign (chiqim va o'tkazma-chiqdi manfiy); o'tkazma va boshlang'ich qoldiq — "info"
  const out = txSign(t.type) < 0;
  // Bekor qilingan yozuv: kartochkada «Bekor qilingan» (sabab, kim, qachon), tugmasiz — `cashflowActions` bo'sh qaytaradi
  const cancel = cancelNote(t, await cancellerNames([t]));
  const fields: DetailField[] = [
    ...(cancel ? [{ label: CANCELLED_LABEL, value: cancel, tone: "danger" as const }] : []),
    { label: "Sana", value: dt(t.date) },
    { label: "Turi", value: TX_TYPE_LABEL[t.type], tone: t.type === "OPENING" || isTransfer(t.type) ? "info" : out ? "danger" : "success" },
    { label: "Kategoriya", value: t.category },
    { label: "Hisob", value: t.cashAccount.name },
    ...(t.counterparty ? [{ label: out ? "Kimga" : "Kimdan", value: t.counterparty }] : []),
    ...(t.supplier ? [{ label: "Yetkazuvchi", value: t.supplier.name }] : []),
    ...(t.refType === "SupplyRequest" && t.refId ? [{ label: "Talabnoma", value: t.refId }] : []),
    ...(t.refType === MECH_REF && t.refId ? [{ label: "Mexanik so'rovi", value: (await db.mechanicRequest.findUnique({ where: { id: t.refId }, select: { docNo: true } }))?.docNo ?? t.refId }] : []),
    { label: "Kim kiritdi", value: t.createdBy.fullName },
    ...(t.note ? [{ label: "Izoh", value: t.note }] : []),
  ];
  return {
    key: "cashflow", id: t.id, title: `${out ? "−" : "+"}${money(sum(t.amount))}`, subtitle: t.category,
    ...(cancel ? { status: CANCELLED_LABEL } : {}),
    // «Bekor qilish» — veb Kirim-Chiqim jadvalidagi kabi (`./moliya-extra.ts`)
    fields, sections: [], actions: await cashflowActions(user, t),
    receipt: {
      headline: `${out ? "−" : "+"}${money(sum(t.amount))}`, caption: t.counterparty ? `${t.category} · ${t.counterparty}` : t.category,
      status: cancel ? { label: CANCELLED_LABEL, tone: "warning", at: (t.cancelledAt ?? t.date).toISOString() } : { label: out ? "Chiqim" : "Kirim", tone: out ? "danger" : "success", at: t.date.toISOString() },
      rows: fields.filter((f) => f.label !== "Turi").map((f) => ({ label: f.label, value: f.value, copy: f.label === "Talabnoma" })),
    },
  };
}


// ───────────────────────── Ta'minot zayavkasi ─────────────────────────

const SUPPLY_TONE: Record<SupplyStatus, Tone> = { NEW: "info", PRICED: "warning", APPROVED: "warning", FUNDED: "brand", RECEIVED: "success", REJECTED: "danger" };

/** Faol kassa/bank hisoblari — moliya tanlovi uchun. */
const accountOptions = async (): Promise<FormOption[]> =>
  (await db.cashAccount.findMany({ where: { isActive: true }, orderBy: [{ type: "asc" }, { name: "asc" }] }))
    .map((a) => ({ value: a.id, label: `${a.name} (${a.type === "CASH" ? "kassa" : "bank"})` }));

const supplierOptions = async (current?: string | null): Promise<FormOption[]> =>
  (await db.supplier.findMany({ where: { OR: [{ isActive: true }, ...(current ? [{ id: current }] : [])] }, orderBy: { name: "asc" } }))
    .map((s) => ({ value: s.id, label: s.name }));

/**
 * Ta'minot zayavkasi kartochkasi — vebdagi `/taminot/[id]` bilan bir xil ma'lumot.
 * Qaysi tugma chiqishi bosqich + rolga bog'liq (`ACTION_ROLES`): sotuvchiga faqat tasdiq,
 * moliyaga faqat pul ajratish, snabjeniyega narx va qabul. Qoida `lib/supply.ts` da.
 */
async function supplyDetail(user: MobileUser, id: string): Promise<MobileDetail> {
  const r = await supplyRequest(id);
  if (!r) throw new ListError("NOT_FOUND", "Ta'minot zayavkasi topilmadi", 404);
  const st = r.status;
  const priced = st !== "NEW";
  const last = await lastPurchasePrices(r.items.map((i) => ({ materialId: i.materialId, name: i.name })));
  const planned = totalPlanned(r);
  const fact = totalFact(r);

  // Narx o'zgargan qatorlar — tasdiqlovchi bir qarashda ko'rsin
  const dearer = r.items.filter((i) => { const l = last.get(priceKey(i)); return l && sum(i.price) > l.price + 0.5; });

  const items = r.items.map((i) => {
    const l = last.get(priceKey(i));
    const price = sum(i.price);
    const delta = l ? priceDelta(price, l.price) : 0;
    const factQty = i.factQty != null ? sum(i.factQty) : null;
    const prev = i.prevPrice != null && sum(i.prevPrice) !== price ? ` · avvalgi tasdiqda ${money(sum(i.prevPrice))}` : "";
    return {
      id: i.id, title: i.name,
      subtitle: priced
        ? `${money(price)} / ${i.unit}${l ? ` · oldingi xarid ${money(l.price)}${Math.abs(delta) >= 1 ? ` (${delta > 0 ? "+" : ""}${delta.toFixed(0)}%)` : ""}` : ""}${prev}${i.note ? ` · ${i.note}` : ""}`
        : `${l ? `oldingi xarid ${money(l.price)} / ${i.unit}` : "narx kutilmoqda"}${i.note ? ` · ${i.note}` : ""}`,
      right: factQty != null ? `${num(factQty)} / ${num(sum(i.qty))} ${i.unit}` : `${num(sum(i.qty))} ${i.unit}`,
      status: factQty != null && factQty === 0 ? "Kelmadi" : undefined,
      tone: (factQty != null && factQty === 0 ? "danger" : priced && l && delta > 0.5 ? "danger" : priced && l && delta < -0.5 ? "success" : undefined) as Tone | undefined,
    };
  });

  const actions: DetailAction[] = [];
  // 1. Sklad: jadvalni tuzatish (hali narx qo'yilmagan)
  if (st === "NEW" && can(user, "supply.items")) {
    actions.push({
      id: "supply.items", label: "Miqdorlarni tuzatish", tone: "brand",
      form: r.items.map((i) => ({ name: `qty_${i.id}`, label: `${i.name} (${i.unit})`, type: "number" as const, required: true, value: num(sum(i.qty)) })),
    });
  }
  // 2. Snabjeniye: narx (NEW) yoki qayta narxlash (PRICED)
  if ((st === "NEW" || st === "PRICED") && can(user, "supply.price")) {
    const suppliers = await supplierOptions(r.supplierId);
    actions.push({
      id: "supply.price", label: st === "NEW" ? "Narx qo'yish" : "Narxni o'zgartirish", tone: "brand",
      form: [
        { name: "supplierId", label: "Yetkazuvchi", type: "select", options: suppliers, value: r.supplierId ?? undefined, hint: suppliers.length ? undefined : "Yetkazuvchi yo'q — avval Yetkazuvchilar bo'limida oching" },
        ...r.items.flatMap((i) => {
          const l = last.get(priceKey(i));
          return [
            { name: `qty_${i.id}`, label: `${i.name} — miqdor (${i.unit})`, type: "number" as const, required: true, value: num(sum(i.qty)) },
            { name: `price_${i.id}`, label: `${i.name} — narx (1 ${i.unit})`, type: "number" as const, required: true, value: sum(i.price) ? String(Math.round(sum(i.price))) : undefined, placeholder: "0", hint: l ? `Oldingi xarid: ${money(l.price)} · ${l.supplier} · ${day(l.date)}` : undefined },
          ];
        }),
        { name: "deliveryKind", label: "Kim olib keladi", type: "select", options: DELIVERY_KINDS.map((k) => ({ value: k, label: k })), value: r.deliveryKind ?? undefined, hint: `"${DELIVERY_OWN}" — o'z mashinamiz, "Ko'cha" — tashqi transport (narxi jami summaga qo'shiladi)` },
        { name: "deliveryProvider", label: "Transport / haydovchi", type: "text", value: r.deliveryProvider ?? undefined, placeholder: "Firma yoki haydovchi, mashina raqami" },
        { name: "deliveryCost", label: "Dostavka narxi (so'm)", type: "number", value: sum(r.deliveryCost) ? String(Math.round(sum(r.deliveryCost))) : undefined, placeholder: "0" },
        { name: "deliveryNote", label: "Dostavka izohi", type: "text", value: r.deliveryNote ?? undefined },
        { name: "note", label: "Izoh", type: "text" },
      ],
    });
  }
  // 3. Ma'sul (sotuv) xodim: tasdiq
  if (st === "PRICED" && can(user, "supply.approve")) {
    actions.push({
      id: "supply.approve", label: "Tasdiqlash", tone: "success",
      form: [{ name: "note", label: "Izoh", type: "text", hint: dearer.length ? `${dearer.length} ta mahsulot oldingi xariddan qimmat — ro'yxatda qizil` : "Tasdiqlasangiz Moliya bo'limiga (Kirim-Chiqim) tushadi" }],
    });
  }
  // 4. Moliya: pul ajratish
  if (st === "APPROVED" && can(user, "supply.fund")) {
    const accounts = await accountOptions();
    actions.push({
      id: "supply.fund", label: "Pul ajratish", tone: "success",
      form: [
        { name: "cashAccountId", label: "Qaysi hisobdan", type: "select", required: true, options: accounts, value: r.cashAccountId ?? accounts[0]?.value, hint: `Reja summa ${money(planned)} shu hisobga chiqim bo'lib yoziladi; qabulda fakt summaga tuzatiladi` },
        { name: "note", label: "Izoh", type: "text" },
      ],
    });
  }
  // 5. Snabjeniye: kelgan molni tekshirish va qabul
  if (st === "FUNDED" && (can(user, "supply.fact") || can(user, "supply.receive"))) {
    const suppliers = await supplierOptions(r.supplierId);
    const factForm: FormField[] = [
      { name: "supplierId", label: "Yetkazuvchi", type: "select", required: true, options: suppliers, value: r.supplierId ?? undefined },
      ...r.items.flatMap((i) => [
        { name: `factQty_${i.id}`, label: `${i.name} — keldi (${i.unit}), so'ralgan ${num(sum(i.qty))}`, type: "number" as const, required: true, value: num(i.factQty != null ? sum(i.factQty) : sum(i.qty)), hint: "Kelmagan bo'lsa 0 yozing" },
        { name: `factPrice_${i.id}`, label: `${i.name} — haqiqiy narx (1 ${i.unit})`, type: "number" as const, required: true, value: String(Math.round(i.factPrice != null ? sum(i.factPrice) : sum(i.price))), hint: "Narx o'zgarsa zayavka qayta tasdiqqa qaytadi" },
      ]),
      { name: "deliveryFactCost", label: "Dostavka — haqiqatda (so'm)", type: "number", value: String(Math.round(sum(r.deliveryFactCost ?? r.deliveryCost))) },
    ];
    // Tugma yorlig'i qisqa (telefonda bir-ikki qatorga sig'sin) — ma'nosi izoh maydonining ostida
    const noteWith = (hint: string): FormField => ({ name: "note", label: "Izoh", type: "text", hint });
    if (can(user, "supply.receive")) actions.push({ id: "supply.receive", label: "Skladga kirim qilish", tone: "success", form: [...factForm, noteWith("Mol keldi va qabul qilindi — skladga kirim yoziladi")] });
    if (can(user, "supply.fact")) actions.push({ id: "supply.fact", label: "Faktni saqlash", tone: "brand", form: [...factForm, noteWith("Hali qabul emas — faqat kelgan miqdor va narx saqlanadi")] });
  }
  // Bekor qilish — har bosqichda, zanjirdagi o'z bo'limi
  // ── Snabjeniye TZ ──
  const limit = await directorLimit();
  const big = needsDirector(planned, limit);
  const waitDirector = st === "PRICED" && big && !r.directorOkAt;
  // Katta xarid direktor tasdig'ini kutsa — sotuvchining "Tasdiqlash" tugmasi ko'rinadi, lekin yopiq (nega — hint'da)
  const ap = actions.find((a) => a.id === "supply.approve");
  if (ap && waitDirector) {
    // Direktorga yopiq "Tasdiqlash" ko'rsatilmaydi — uning tugmasi tepada ("Katta xaridni tasdiqlash")
    if (user.role === "DIRECTOR") actions.splice(actions.indexOf(ap), 1);
    else { ap.disabled = true; ap.hint = `${money(planned)} — ${money(limit)} dan katta xarid: avval direktor tasdiqlaydi`; }
  }
  if (waitDirector && can(user, "supply.director")) {
    actions.unshift({ id: "supply.director", label: "Katta xaridni tasdiqlash", tone: "success",
      form: [{ name: "note", label: "Izoh", type: "text", hint: `Jami ${money(planned)} — chegara ${money(limit)}. Tasdiqlasangiz ma'sul xodim tasdig'iga o'tadi` }] });
  }
  if (st === "FUNDED" && can(user, "supply.delivery")) {
    actions.unshift({
      id: "supply.delivery", label: "Yetkazish holati", tone: "brand",
      form: [
        { name: "deliveryStatus", label: "Holat", type: "select", required: true, options: DELIVERY_MANUAL.map((d) => ({ value: d, label: DELIVERY_LABEL[d] })), value: r.deliveryStatus && r.deliveryStatus !== "RECEIVED" ? r.deliveryStatus : "PLANNED", hint: "\"Zavodga keldi\" — skladga qabul xabari ketadi" },
        { name: "deliveryProvider", label: "Transport / haydovchi", type: "text", value: r.deliveryProvider ?? undefined, placeholder: "01 A 123 BC · haydovchi" },
        { name: "shippedAt", label: "Jo'natilgan sana", type: "date", value: r.shippedAt ? ymd(r.shippedAt) : undefined },
        { name: "eta", label: "Kutilayotgan sana (ETA)", type: "date", value: r.eta ? ymd(r.eta) : undefined },
        { name: "note", label: "Izoh (Muammo bo'lsa — majburiy)", type: "text" },
      ],
    });
  }
  const quotable = st === "NEW" || st === "PRICED";
  if (quotable && can(user, "supply.quote")) {
    const suppliers = await supplierOptions(r.supplierId);
    actions.push({
      id: "supply.quote", label: "Tijorat taklifi qo'shish", tone: "brand",
      form: [
        { name: "supplierId", label: "Yetkazuvchi", type: "select", options: suppliers, hint: "Spravochnikda bo'lmasa — pastda nomini yozing" },
        { name: "supplierName", label: "Yangi yetkazuvchi nomi", type: "text" },
        { name: "amount", label: "Jami taklif summasi (so'm)", type: "number", required: true },
        { name: "deliveryDays", label: "Necha kunda yetkazadi", type: "number" },
        { name: "paymentTerms", label: "To'lov sharti", type: "select", options: PAYMENT_TERMS.map((t) => ({ value: t, label: t })) },
        { name: "validUntil", label: "Taklif amal qiladi", type: "date" },
        { name: "note", label: "Izoh", type: "text" },
      ],
    });
    const choosable = r.quotes.filter((q) => !q.chosen);
    if (choosable.length && can(user, "supply.quote.choose")) {
      actions.push({ id: "supply.quote.choose", label: "Taklifni tanlash", tone: "success",
        form: [{ name: "quoteId", label: "Taklif", type: "select", required: true, options: choosable.map((q) => ({ value: q.id, label: `${q.supplierName} · ${money(sum(q.amount))}${q.deliveryDays != null ? ` · ${q.deliveryDays} kun` : ""}` })) }] });
    }
  }
  if (isOpenSupply(st) && can(user, "supply.meta")) {
    const people = await responsibleOptions();
    actions.push({
      id: "supply.meta", label: "Rekvizitlar", tone: "brand",
      form: [
        { name: "department", label: "Bo'lim", type: "select", options: DEPARTMENTS.map((d) => ({ value: d, label: d })), value: r.department ?? undefined },
        { name: "priority", label: "Ustuvorlik", type: "select", required: true, options: PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABEL[p] })), value: r.priority },
        { name: "responsibleId", label: "Mas'ul xodim", type: "select", options: people.map((p) => ({ value: p.id, label: p.fullName })), value: r.responsibleId ?? undefined },
        { name: "needBy", label: "Qachongacha kerak", type: "date", value: r.needBy ? ymd(r.needBy) : undefined },
        { name: "contractNo", label: "Shartnoma raqami", type: "text", value: r.contractNo ?? undefined },
      ],
    });
  }
  const openInc = r.incidents.filter((x) => !x.resolvedAt);
  if (st !== "REJECTED" && can(user, "supply.incident")) {
    actions.push({ id: "supply.incident", label: "Muammo qayd qilish", tone: "warning",
      form: [
        { name: "kind", label: "Turi", type: "select", required: true, options: INCIDENT_KINDS.map((k) => ({ value: k, label: INCIDENT_LABEL[k] })), value: "SHORTAGE" },
        { name: "note", label: "Nima bo'ldi", type: "text", required: true, placeholder: "Masalan: sement 2 t kam keldi" },
      ] });
  }
  if (openInc.length && can(user, "supply.incident.resolve")) {
    actions.push({ id: "supply.incident.resolve", label: "Muammoni yopish", tone: "success",
      form: [
        { name: "incidentId", label: "Muammo", type: "select", required: true, options: openInc.map((x) => ({ value: x.id, label: `${INCIDENT_LABEL[x.kind]}: ${x.note.slice(0, 40)}` })), value: openInc[0].id },
        { name: "resolution", label: "Qanday hal qilindi", type: "text", required: true },
      ] });
  }
  if (can(user, "supply.doc")) {
    const missing = REQUIRED_DOCS.filter((k) => !r.documents.some((d) => d.kind === k));
    actions.push({ id: "supply.doc", label: "Hujjat biriktirish", tone: "brand",
      form: [
        { name: "kind", label: "Hujjat turi", type: "select", required: true, options: DOC_KINDS.map((k) => ({ value: k, label: k })), value: (st === "FUNDED" || st === "RECEIVED") && missing[0] ? missing[0] : DOC_KINDS[0] },
        { name: "photo", label: "Surat (kamera yoki galereya)", type: "photo", required: true, hint: "PDF bo'lsa — vebdan biriktiring" },
      ] });
  }
  // Tijorat taklifini o'chirish (`./sklad-extra.ts`)
  actions.push(...supplyExtraActions(user, r));
  if (isOpenSupply(st) && can(user, "supply.reject") && canRejectSupply(r, user)) {
    // Direktor uchun bu qaror — "Rad etish" (tasdiq kutayotgan hujjat), boshqalarga — "Bekor qilish"
    const rejectLabel = user.role === "DIRECTOR" && (st === "PRICED" || st === "APPROVED") ? "Rad etish" : "Bekor qilish";
    actions.push({ id: "supply.reject", label: rejectLabel, tone: "danger", form: [{ name: "reason", label: "Sabab", type: "text", required: true, placeholder: `Nega ${rejectLabel === "Rad etish" ? "rad etilmoqda" : "bekor qilinmoqda"}` }] });
  }

  // Ombor qoldig'i — omborda bor bo'lsa xaridni kamaytirish uchun (TZ 4.3)
  const matIds = r.items.map((i) => i.materialId).filter((x): x is string => !!x);
  const balances = isOpenSupply(st) && matIds.length ? await db.stockMove.groupBy({ by: ["materialId"], where: { materialId: { in: matIds } }, _sum: { qty: true } }) : [];
  const bal = new Map(balances.map((b) => [b.materialId, sum(b._sum.qty)]));
  const stockRows = r.items.filter((i) => i.materialId && isOpenSupply(st)).map((i) => {
    const b = bal.get(i.materialId!) ?? 0;
    return { id: `stock:${i.id}`, title: i.name, subtitle: b >= sum(i.qty) ? "Omborda yetarli — xarid shart emasligini tekshiring" : "Omborda yetmaydi", right: `${num(b)} / ${num(sum(i.qty))} ${i.unit}`, tone: (b >= sum(i.qty) ? "success" : undefined) as Tone | undefined };
  });
  const docsMissing = st === "FUNDED" || st === "RECEIVED" ? REQUIRED_DOCS.filter((k) => !r.documents.some((d) => d.kind === k)) : [];

  const STAGE_LABEL = Object.fromEntries(SUPPLY_STEPS.map((s) => [s.key, s.label])) as Record<string, string>;
  const delivery = r.deliveryKind ? `${r.deliveryKind}${r.deliveryProvider ? ` · ${r.deliveryProvider}` : ""}${sum(r.deliveryCost) ? ` · ${money(sum(r.deliveryCost))}` : ""}` : null;

  return {
    key: "supply", id: r.id, title: r.docNo, subtitle: r.warehouse.name, status: SUPPLY_LABEL[st],
    fields: [
      { label: "Bosqich", value: waitDirector ? "Katta xarid — avval direktor tasdiqlaydi" : SUPPLY_OWNER[st], tone: SUPPLY_TONE[st] },
      { label: "Sana", value: day(r.date) },
      ...(r.department ? [{ label: "Bo'lim", value: r.department }] : []),
      { label: "Ustuvorlik", value: PRIORITY_LABEL[r.priority], tone: (r.priority === "CRITICAL" ? "danger" : r.priority === "HIGH" ? "warning" : undefined) as Tone | undefined },
      ...(r.responsible ? [{ label: "Mas'ul", value: r.responsible.fullName }] : []),
      ...(r.contractNo ? [{ label: "Shartnoma", value: r.contractNo }] : []),
      ...(big && (st === "PRICED" || r.directorOkAt) ? [{ label: "Direktor tasdig'i", value: r.directorOkAt ? `Tasdiqlangan · ${day(r.directorOkAt)}` : "Kutilmoqda", tone: (r.directorOkAt ? "success" : "warning") as Tone }] : []),
      ...(r.deliveryStatus ? [{ label: "Yetkazish", value: `${DELIVERY_LABEL[r.deliveryStatus]}${r.shippedAt ? ` · jo'natildi ${day(r.shippedAt)}` : ""}`, tone: (r.deliveryStatus === "PROBLEM" ? "danger" : r.deliveryStatus === "RECEIVED" ? "success" : "brand") as Tone }] : []),
      ...(r.eta ? [{ label: "Kutilayotgan sana (ETA)", value: day(r.eta), tone: (isOpenSupply(st) && r.eta < new Date(new Date().setHours(0, 0, 0, 0)) ? "danger" : undefined) as Tone | undefined }] : []),
      ...(openInc.length ? [{ label: "Ochiq muammo", value: `${openInc.length} ta`, tone: "danger" as Tone }] : []),
      ...(docsMissing.length ? [{ label: "Hujjat yetishmaydi", value: docsMissing.join(", "), tone: "warning" as Tone }] : []),
      ...(r.needBy ? [{ label: "Qachongacha kerak", value: day(r.needBy), tone: (isOpenSupply(st) && r.needBy < new Date() ? "danger" : undefined) as Tone | undefined }] : []),
      ...(r.supplier ? [{ label: "Yetkazuvchi", value: r.supplier.name }] : []),
      ...(delivery ? [{ label: "Dostavka", value: delivery }] : []),
      ...(priced ? [{ label: "Jami (reja)", value: money(planned), tone: "brand" as Tone }] : [{ label: "Mahsulot", value: `${r.items.length} nom` }]),
      ...(hasFact(r.items) ? [{ label: "Jami (fakt)", value: money(fact), tone: (fact > planned + 0.5 ? "danger" : "success") as Tone }] : []),
      ...(dearer.length && (st === "PRICED" || st === "APPROVED") ? [{ label: "Narx oshgan", value: `${dearer.length} ta mahsulot oldingi xariddan qimmat`, tone: "danger" as Tone }] : []),
      ...(r.recheck ? [{ label: "Qayta tasdiq", value: `${r.recheck}-marta — qabulda narx o'zgargan`, tone: "warning" as Tone }] : []),
      ...(r.cashAccount ? [{ label: "To'lov hisobi", value: r.cashAccount.name }] : []),
      ...(r.receipt ? [{ label: "Kirim hujjati", value: r.receipt.docNo, tone: "success" as Tone }] : []),
      { label: "Kim so'radi", value: `${r.createdBy.fullName} · ${day(r.createdAt)}` },
      ...(r.note ? [{ label: "Izoh", value: r.note }] : []),
    ],
    sections: [
      { title: "Mahsulotlar", empty: "Qator yo'q", icon: "package", rows: items },
      ...(stockRows.length ? [{ title: "Ombor qoldig'i", empty: "", icon: "layers", rows: stockRows }] : []),
      ...(r.quotes.length ? [{ title: "Tijorat takliflari", empty: "", icon: "banknote", rows: r.quotes.map((q) => ({
        id: q.id, title: q.supplierName,
        subtitle: [q.deliveryDays != null ? `${q.deliveryDays} kunda` : null, q.paymentTerms, q.validUntil ? `${day(q.validUntil)} gacha` : null, q.note].filter(Boolean).join(" · ") || undefined,
        right: money(sum(q.amount)), status: q.chosen ? "Tanlangan" : undefined, tone: (q.chosen ? "success" : undefined) as Tone | undefined,
      })) }] : []),
      ...(r.incidents.length ? [{ title: "Muammolar", empty: "", icon: "warning", rows: r.incidents.map((x) => ({
        id: x.id, title: INCIDENT_LABEL[x.kind], subtitle: `${x.note}${x.resolution ? ` → ${x.resolution}` : ""} · ${x.createdBy.fullName}`,
        right: shortDt(x.createdAt), status: x.resolvedAt ? "Hal qilindi" : "Ochiq", tone: (x.resolvedAt ? "success" : "danger") as Tone,
      })) }] : []),
      ...(r.documents.length ? [{ title: "Hujjatlar", empty: "", icon: "file-text", target: "supply-doc", rows: r.documents.map((d) => ({ id: d.id, title: d.kind, subtitle: `${d.fileName} · ${d.createdBy.fullName}`, right: shortDt(d.createdAt) })) }] : []),
      { title: "Bosqichlar", empty: "Hali bosqich yozilmagan", icon: "clock", rows: r.events.map((e) => ({ id: e.id, title: STAGE_LABEL[e.stage] ?? SUPPLY_LABEL[e.stage], subtitle: `${e.user.fullName}${e.note ? ` · ${e.note}` : ""}`, right: shortDt(e.createdAt), tone: SUPPLY_TONE[e.stage] })) },
      ...(r.receipt ? [{ title: "Kirim hujjati", empty: "", target: "receipts", rows: [{ id: r.receipt.id, title: r.receipt.docNo, subtitle: "Skladga kirim", tone: "success" as Tone }] }] : []),
    ],
    actions,
  };
}

// ───────────────────────── Mexanik so'rovi (Kirim) ─────────────────────────

/**
 * Mexanik so'rovi kartochkasi: nima uchun, qancha, surat, kim qachon tasdiqlagan / pul bergan.
 * Tugmalar holat + rolga bog'liq: NEW — ish boshqaruvchi (tasdiq/rad), mexanik (bekor); APPROVED — kassa (pul berish).
 */
async function kirimDetail(user: MobileUser, id: string): Promise<MobileDetail> {
  const r = await mechanicRequest(id);
  if (!r) throw new ListError("NOT_FOUND", "So'rov topilmadi", 404);
  if (user.role === "MECHANIC" && r.createdById !== user.id) throw new ListError("FORBIDDEN", "Bu so'rov sizniki emas", 403);
  const st = r.status;
  const amount = sum(r.amount);
  const subject = mechSubject(r);

  const actions: DetailAction[] = [];
  if (st === "NEW" && can(user, "kirim.approve")) {
    actions.push({ id: "kirim.approve", label: "Tasdiqlash", tone: "success", confirm: `${money(amount)} so'rovni tasdiqlaysizmi? Kassa pul beradi` });
  }
  if (st === "NEW" && can(user, "kirim.reject")) {
    actions.push({ id: "kirim.reject", label: "Rad etish", tone: "danger", form: [{ name: "reason", label: "Sabab", type: "text", required: true, placeholder: "Nega rad etilmoqda" }] });
  }
  if (st === "APPROVED" && can(user, "kirim.pay")) {
    const accounts = await payAccounts();
    actions.push({
      id: "kirim.pay", label: "Pul berish", tone: "success",
      form: [
        {
          name: "cashAccountId", label: "Qaysi kassadan", type: "select", required: true,
          value: accounts.find((a) => a.type === "CASH")?.id ?? accounts[0]?.id,
          options: accounts.map((a) => ({ value: a.id, label: `${a.name} · ${a.type === "CASH" ? "naqd kassa" : "bank"}`, hint: `qoldiq ${money(a.balance)}${a.type === "BANK" && a.allowOverdraft ? " · overdraft ruxsat" : ""}` })),
          hint: `${money(amount)} shu hisobdan chiqim bo'lib yoziladi`,
        },
        { name: "note", label: "Izoh", type: "text" },
      ],
    });
  }
  if (st === "NEW" && r.createdById === user.id && can(user, "kirim.cancel")) {
    actions.push({ id: "kirim.cancel", label: "Bekor qilish", tone: "danger", confirm: "So'rovni bekor qilasizmi?" });
  }

  const v = r.vehicle;
  const steps = [
    { id: "created", title: "So'rov yuborildi", subtitle: r.createdBy.fullName, at: r.createdAt, tone: "info" as Tone },
    ...(r.decidedAt && st !== "CANCELLED" ? [{ id: "decided", title: st === "REJECTED" ? "Rad etildi" : "Tasdiqlandi", subtitle: `${r.decidedBy ?? "—"}${r.rejectReason ? ` · ${r.rejectReason}` : ""}`, at: r.decidedAt, tone: (st === "REJECTED" ? "danger" : "success") as Tone }] : []),
    ...(st === "CANCELLED" && r.decidedAt ? [{ id: "cancelled", title: "Bekor qilindi", subtitle: r.createdBy.fullName, at: r.decidedAt, tone: "info" as Tone }] : []),
    ...(r.paidAt ? [{ id: "paid", title: "Pul berildi", subtitle: `${r.paidBy ?? "—"}${r.cashAccount ? ` · ${r.cashAccount.name}` : ""}`, at: r.paidAt, tone: "success" as Tone }] : []),
  ];

  return {
    key: "kirim", id: r.id, title: `${subject}${r.urgent ? " · shoshilinch" : ""}`, subtitle: `${r.docNo} · ${TARGET_LABEL[r.target]}`, status: MECH_STATUS_LABEL[st],
    fields: [
      { label: "Holat", value: MECH_STATUS_LABEL[st], tone: MECH_STATUS_TONE[st] },
      { label: "Summa", value: money(amount), tone: "brand" },
      { label: "Turi", value: TARGET_LABEL[r.target] },
      ...(v ? [{ label: "Mashina", value: `${v.plate} · ${VEHICLE_TYPE[v.type] ?? v.type}${v.brand || v.model ? ` · ${[v.brand, v.model].filter(Boolean).join(" ")}` : ""}` }] : []),
      ...(r.object ? [{ label: r.target === "OTHER" ? "Nima uchun" : "Obyekt", value: r.object }] : []),
      { label: "Muammo", value: r.problem },
      ...(r.note ? [{ label: "Tavsif", value: r.note }] : []),
      ...(r.urgent ? [{ label: "Shoshilinch", value: "Ha", tone: "danger" as Tone }] : []),
      { label: "Kim so'radi", value: `${r.createdBy.fullName} · ${dt(r.createdAt)}` },
      ...(r.decidedAt && st !== "CANCELLED" ? [{ label: st === "REJECTED" ? "Rad etdi" : "Tasdiqladi", value: `${r.decidedBy ?? "—"} · ${dt(r.decidedAt)}`, tone: (st === "REJECTED" ? "danger" : "success") as Tone }] : []),
      ...(r.rejectReason ? [{ label: "Rad sababi", value: r.rejectReason, tone: "danger" as Tone }] : []),
      ...(r.paidAt ? [{ label: "Pul berdi", value: `${r.paidBy ?? "—"} · ${dt(r.paidAt)}`, tone: "success" as Tone }] : []),
      ...(r.cashAccount ? [{ label: "Kassa", value: r.cashAccount.name }] : []),
      ...(r.photo ? [{ label: "Surat", value: "Biriktirilgan" }] : []),
    ],
    sections: [
      { title: "Bosqichlar", empty: "", icon: "clock", rows: steps.map((x) => ({ id: x.id, title: x.title, subtitle: x.subtitle, right: shortDt(x.at), tone: x.tone })) },
      ...(r.cashTxId && ["CASHIER", "ACCOUNTING", "FINANCE", "DIRECTOR"].includes(user.role) ? [{ title: "Kirim-chiqim yozuvi", empty: "", target: "cashflow", rows: [{ id: r.cashTxId, title: `−${money(amount)}`, subtitle: r.cashAccount?.name ?? "Chiqim", tone: "danger" as Tone }] }] : []),
    ],
    actions,
    ...(r.photo ? { photo: { url: `/api/mobile/kirim/photo?id=${r.id}`, title: "Muammo surati" } } : {}),
  };
}

// ───────────────────────── Pul qabul qilish (zayavka bosh to'lovi) ─────────────────────────

/** Qabul sanasi tanlovi: bugun va oldingi 6 kun (ilovaning `date` chipi faqat bugundan oldinga ko'rsatadi). */
const RECEIVE_DAYS = 7;
const receiveDayOptions = (): FormOption[] => Array.from({ length: RECEIVE_DAYS }, (_, i) => {
  const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - i);
  return { value: ymd(d), label: i === 0 ? `Bugun · ${day(d)}` : i === 1 ? `Kecha · ${day(d)}` : day(d) };
});

/**
 * So'rov kartochkasi (ro'yxat qatori va bildirishnoma havolasi `{ key: "payreq", id }`). Foydalanuvchi ko'radigan usulda
 * bo'lmasa — «topilmadi» (kassirga perechisleniye, buxgalterga naqd ko'rinmaydi). «Qabul qilish» — faqat shu usulni
 * qabul qila oladiganga; pul `receivePaymentRequest` → `addPayment` orqali (hisob qoldig'i, Kirim-Chiqim, debitorka).
 */
async function payreqDetail(user: MobileUser, id: string): Promise<MobileDetail> {
  const r = await getPaymentRequest(id, payreqMethods(user));
  if (!r) throw new ListError("NOT_FOUND", "So'rov topilmadi", 404);
  const st = r.status;
  const open = OPEN_STATUSES.includes(st);
  const isCash = r.method === "CASH";

  const actions: DetailAction[] = [];
  if (open && can(user, "payreq.receive") && methodsFor(user).includes(r.method)) {
    const [accounts, bal] = await Promise.all([receiveAccounts(r.method), accountBalances()]);
    if (!accounts.length) {
      actions.push({ id: "payreq.receive", label: "Pulni qabul qilish", tone: "success", disabled: true, hint: isCash ? "Faol kassa hisobi yo'q — vebda Kassa/bank bo'limida qo'shing" : "Faol bank hisobi yo'q — vebda Kassa/bank bo'limida qo'shing" });
    } else {
      actions.push({
        id: "payreq.receive", label: isCash ? "Pulni qabul qilish" : "Tushumni tasdiqlash", tone: "success",
        form: [
          {
            name: "cashAccountId", label: isCash ? "Qaysi kassaga" : "Qaysi bank hisobiga", type: "select", required: true, value: accounts[0].id,
            options: accounts.map((a) => ({ value: a.id, label: a.name, hint: `qoldiq ${money(bal.get(a.id) ?? 0)}` })),
            hint: "Summa shu hisobga kirim bo'lib yoziladi",
          },
          { name: "amount", label: "Summa (so'm)", type: "number", required: true, value: String(r.left), hint: `Qolgan bosh to'lov ${money(r.left)} · qisman ham qabul qilinadi` },
          { name: "date", label: "Sana", type: "select", required: true, value: ymd(new Date()), options: receiveDayOptions() },
          ...(isCash ? [] : [{ name: "docRef", label: "To'lov topshiriqnomasi №", type: "text" as const, placeholder: "Bank ko'chirmasidagi raqam" }]),
          { name: "note", label: "Izoh", type: "text" },
        ],
      });
    }
  }

  const due = `${day(r.dueDate)}${r.order.deliveryTime ? ` ${r.order.deliveryTime}` : ""}`;
  const fields: DetailField[] = [
    { label: "Holat", value: PAYREQ_STATUS_LABEL[st], tone: PAYREQ_STATUS_TONE[st] },
    { label: "Usul", value: PAY_METHOD_LABEL[r.method] },
    { label: "Bosh to'lov", value: money(r.amount), tone: "brand" },
    { label: "Tushgan", value: money(r.received), tone: r.received > 0 ? "success" : undefined },
    ...(st !== "CANCELLED" ? [{ label: "Qolgan", value: money(r.left), tone: (r.left > 0.005 ? "danger" : "success") as Tone }] : []),
    { label: "Muddat (yetkazish)", value: r.overdue ? `${due} · muddati o'tdi` : due, tone: r.overdue ? "danger" : undefined },
    { label: "Zayavka", value: `${r.order.orderNo} · ${r.order.products || "—"} · ${money(r.order.total)}` },
    { label: "Mijoz", value: r.customer.name },
    ...(r.customer.phone ? [{ label: "Telefon", value: r.customer.phone }] : []),
    { label: "Kim ochgan", value: `${r.createdBy} · ${dt(r.createdAt)}` },
    ...(r.closedAt ? [{ label: st === "CANCELLED" ? "Bekor qilindi" : "Yopildi", value: dt(r.closedAt), tone: (st === "CANCELLED" ? "info" : "success") as Tone }] : []),
  ];

  // Zayavka va mijoz kartochkasi — rol ocha olsa (direktor modulni yopmagan; mijoz — `DETAIL_ROLES.customers`)
  const custOk = (user.role === "DIRECTOR" || (DETAIL_ROLES.customers ?? []).includes(user.role)) && !moduleClosed(user, "customers");
  const sections: HomeSection[] = [
    {
      title: "To'lovlar tarixi", empty: "Hali to'lov tushmagan", target: "payments", icon: "banknote",
      rows: [...r.payments].reverse().map((p) => ({ id: p.id, title: `+${money(p.amount)}`, subtitle: [shortDt(p.date), p.account, p.by].filter(Boolean).join(" · "), right: `+${money(p.amount)}`, tone: "success" as Tone })),
    },
    ...(!moduleClosed(user, "orders") ? [{ title: "Zayavka", empty: "", target: "orders", rows: [{ id: r.order.id, title: `${r.order.orderNo} · ${r.customer.name}`, subtitle: `${r.order.products || "—"} · yetkazish ${due}`, right: money(r.order.total), tone: "brand" as Tone }] }] : []),
    ...(custOk ? [{ title: "Mijoz", empty: "", target: "customers", rows: [{ id: r.customer.id, title: r.customer.name, subtitle: r.customer.phone ?? undefined }] }] : []),
  ];

  return {
    key: "payreq", id: r.id, title: `${r.docNo} · ${r.customer.name}`, subtitle: `${r.order.orderNo} · ${PAY_METHOD_LABEL[r.method]}`, status: PAYREQ_STATUS_LABEL[st],
    fields, sections, actions,
  };
}

// ───────────────────────── Mijoz ─────────────────────────

async function customerDetail(user: MobileUser, id: string): Promise<MobileDetail> {
  const c = await db.customer.findUnique({
    where: { id },
    include: {
      orders: { where: { kind: "SALE" }, orderBy: { date: "desc" }, take: 10, include: { items: { include: { product: true } } } },
      invoices: { where: { status: { in: ["OPEN", "PARTIAL"] } }, orderBy: { date: "asc" }, include: { payments: true } },
    },
  });
  if (!c) throw new ListError("NOT_FOUND", "Mijoz topilmadi", 404);
  // Sotuv agenti faqat o'ziga biriktirilgan mijozni ochadi (begona id — "topilmadi")
  if (user.role === "AGENT" && c.agentId !== user.id) throw new ListError("NOT_FOUND", "Mijoz topilmadi", 404);
  const credit = await customerCredit(c.id);
  const history = (await customersHistory([c.id])).get(c.id);
  const ORDER_TONE: Record<string, Tone> = { DRAFT: "info", BLOCKED: "danger", CONFIRMED: "brand", IN_PRODUCTION: "warning", DELIVERED: "success", CLOSED: "success", CANCELLED: "danger" };
  // Tahrirlash, obyektlar, to'lovlar, akt sverki, ilova hisobi, agent, «Zayavka ochish» — `./sotuv-extra.ts`
  const extra = await customerExtras(user, c, credit.blacklisted);
  return {
    key: "customers", id: c.id, title: c.name, subtitle: c.phone ?? undefined,
    status: !c.isActive ? "Nofaol" : credit.blacklisted ? "Qora ro'yxat" : history?.label,
    fields: [
      { label: "Telefon", value: c.phone ?? "—" },
      ...(c.inn ? [{ label: "INN", value: c.inn }] : []),
      ...(c.address ? [{ label: "Manzil", value: c.address }] : []),
      { label: "Reyting", value: history ? `${"★".repeat(history.stars)}${"☆".repeat(5 - history.stars)} ${STAR_LABELS[history.stars]}` : "—" },
      { label: "Kredit limiti", value: money(credit.limit) },
      { label: "Ishlatilgan", value: money(credit.used), tone: credit.blacklisted ? "danger" : credit.used > credit.limit / 2 ? "warning" : "success" },
      // Yagona balans (lib/receivables.ts): schyotlar − barcha to'lovlar; manfiy — mijoz avansi
      credit.advance > 0.005
        ? { label: "Avans (oldindan to'langan)", value: money(credit.advance), tone: "success" }
        : { label: "Qarz (debitorka)", value: money(credit.debt), tone: credit.debt > 0 ? "danger" : "success" },
      { label: "Schyotsiz zayavkalar", value: money(credit.open), tone: credit.open > 0 ? "warning" : undefined },
      { label: "Limitda qoldi", value: money(Math.max(0, credit.free)), tone: credit.blacklisted ? "danger" : "success" },
      ...(history?.orders ? [{ label: "Xarid", value: `${money(history.bought)} · ${history.orders} zayavka` }] : []),
      ...(history?.lastOrderAt ? [{ label: "Oxirgi zayavka", value: day(history.lastOrderAt) }] : []),
      { label: "Holat", value: c.isActive ? "Faol" : "Nofaol", tone: c.isActive ? "success" : "danger" },
      ...extra.fields,
    ],
    sections: [
      ...extra.sections.filter((x) => x.target === "new"),
      { title: "Ochiq schyotlar", empty: "Ochiq schyot yo'q", target: "invoices", rows: c.invoices.map((i) => { const left = sum(i.amount) - i.payments.reduce((p, x) => p + sum(x.amount), 0); return { id: i.id, title: i.invoiceNo, subtitle: `${day(i.date)} · jami ${money(sum(i.amount))}`, right: money(left), status: i.status, tone: (i.status === "PARTIAL" ? "warning" : "danger") as Tone }; }) },
      { title: "So'nggi zayavkalar", empty: "Zayavka yo'q", target: "orders", rows: c.orders.map((o) => ({ id: o.id, title: o.orderNo, subtitle: `${day(o.deliveryDate)} · ${o.deliveryAddress}`, right: money(o.items.reduce((s, i) => s + sum(i.qtyM3) * sum(i.price), 0)), status: o.status, tone: ORDER_TONE[o.status] })) },
      ...extra.sections.filter((x) => x.target !== "new"),
    ],
    actions: extra.actions,
  };
}

// ───────────────────────── Sayt arizasi ─────────────────────────

async function leadDetail(user: MobileUser, id: string): Promise<MobileDetail> {
  const l = await db.lead.findUnique({ where: { id }, include: { product: true, customer: true, handledBy: { select: { fullName: true } } } });
  if (!l) throw new ListError("NOT_FOUND", "Ariza topilmadi", 404);
  const LABEL: Record<string, string> = { NEW: "Yangi", IN_PROGRESS: "Bog'lanildi", CONVERTED: "Mijoz bo'ldi", REJECTED: "Bekor" };
  const TONE: Record<string, Tone> = { NEW: "brand", IN_PROGRESS: "warning", CONVERTED: "success", REJECTED: "danger" };

  const actions: DetailAction[] = [];
  const open = l.status !== "CONVERTED";
  if (l.status === "NEW" && can(user, "lead.progress")) actions.push({ id: "lead.progress", label: "Bog'landim", tone: "brand", confirm: "Mijoz bilan bog'landingizmi? Ariza \"Bog'lanildi\" holatiga o'tadi." });
  if (open && can(user, "lead.convert")) {
    actions.push({
      id: "lead.convert", label: "Mijozga aylantirish", tone: "success",
      form: [
        { name: "name", label: "Mijoz nomi", type: "text", required: true, value: l.name, hint: "Shu telefonli mijoz bo'lsa yangisi ochilmaydi — boriga bog'lanadi" },
        { name: "inn", label: "INN", type: "text", placeholder: "9 raqam" },
      ],
    });
  }
  if (open && can(user, "lead.note")) actions.push({ id: "lead.note", label: l.note ? "Izohni o'zgartirish" : "Izoh yozish", tone: "brand", form: [{ name: "note", label: "Ichki izoh", type: "text", value: l.note ?? undefined, placeholder: "Nima kelishildi, qachon qo'ng'iroq qilish kerak" }] });
  if ((l.status === "NEW" || l.status === "IN_PROGRESS") && can(user, "lead.reject")) actions.push({ id: "lead.reject", label: "Bekor qilish", tone: "danger", confirm: "Ariza bekor qilinsinmi? Keyin yana \"Yangi\" qilib qaytarish mumkin." });
  if ((l.status === "REJECTED" || l.status === "IN_PROGRESS") && can(user, "lead.reopen")) actions.push({ id: "lead.reopen", label: "Yana yangi qilish", tone: "warning" });

  return {
    key: "leads", id: l.id, title: l.name, subtitle: l.phone, status: LABEL[l.status],
    fields: [
      { label: "Telefon", value: l.phone, tone: "brand" },
      ...(l.product ? [{ label: "Mahsulot", value: `${l.product.name}${l.qty ? ` · ${num(sum(l.qty))} ${unitLabel(l.product.unit)}` : ""}` }] : []),
      ...(l.address ? [{ label: "Obyekt manzili", value: l.address }] : []),
      ...(l.message ? [{ label: "Xabar", value: l.message }] : []),
      { label: "Manba", value: l.source === "landing" ? "Sayt" : l.source },
      { label: "Kelgan vaqti", value: dt(l.createdAt) },
      ...(l.handledBy ? [{ label: "Kim ko'tardi", value: `${l.handledBy.fullName}${l.handledAt ? ` · ${dt(l.handledAt)}` : ""}` }] : []),
      ...(l.note ? [{ label: "Izoh", value: l.note, tone: "info" as Tone }] : []),
      { label: "Holat", value: LABEL[l.status], tone: TONE[l.status] },
    ],
    sections: [
      ...(l.customer ? [{ title: "Mijoz", empty: "", target: "customers", rows: [{ id: l.customer.id, title: l.customer.name, subtitle: l.customer.phone ?? undefined, tone: "success" as Tone }] }] : []),
      // Mijozga aylangandan keyin: «Zayavka ochish» / «Tijorat taklifi» (`./sotuv-extra.ts`)
      ...leadExtras(user, { id: l.id, status: l.status, customerId: l.customerId }),
    ],
    actions,
  };
}

// ───────────────────────── Brigada ─────────────────────────

async function brigadeDetail(user: MobileUser, id: string): Promise<MobileDetail> {
  const b = await db.brigade.findUnique({
    where: { id },
    include: {
      leader: { select: { id: true, fullName: true, phone: true } },
      tasks: { orderBy: [{ status: "asc" }, { dueDate: "asc" }], take: 30, include: { order: { include: { customer: true } }, orderItem: { include: { product: true } } } },
    },
  });
  if (!b) throw new ListError("NOT_FOUND", "Brigada topilmadi", 404);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const open = b.tasks.filter((t) => t.status === "NEW" || t.status === "IN_PROGRESS");
  const done = b.tasks.filter((t) => t.status === "DONE").slice(0, 8);
  const actions: DetailAction[] = [];
  if (can(user, "brigade.toggle")) {
    actions.push(b.isActive
      ? { id: "brigade.toggle", label: "Brigadani yopish", tone: "danger", confirm: open.length ? `${open.length} ta ochiq topshiriq bor. Baribir yopilsinmi? Topshiriqlar joyida qoladi.` : "Brigada yopilsinmi? Zayavkaga tayinlab bo'lmaydi, keyin qayta ochish mumkin." }
      : { id: "brigade.toggle", label: "Brigadani qayta ochish", tone: "success" });
  }
  return {
    key: "brigades", id: b.id, title: b.name, subtitle: b.leader ? `Brigadir: ${b.leader.fullName}` : "Brigadir biriktirilmagan", status: b.isActive ? undefined : "Nofaol",
    fields: [
      { label: "Brigadir", value: b.leader?.fullName ?? "—", tone: b.leader ? "success" : "warning" },
      { label: "Telefon", value: b.leader?.phone ?? b.phone ?? "—" },
      { label: "Ochiq topshiriq", value: String(open.length), tone: open.length ? "brand" : "success" },
      { label: "Holat", value: b.isActive ? "Faol" : "Nofaol", tone: b.isActive ? "success" : "danger" },
      ...(b.note ? [{ label: "Izoh", value: b.note }] : []),
      { label: "Ochilgan", value: day(b.createdAt) },
    ],
    sections: [
      { title: "Ochiq topshiriqlar", empty: "Ochiq topshiriq yo'q", target: "tasks", rows: open.map((t) => ({ id: t.id, title: `${t.taskNo} · ${t.orderItem.product.name}`, subtitle: `${t.order.customer.name} · muddat ${day(t.dueDate)}`, right: inUnit(sum(t.qty) - sum(t.doneQty), t.orderItem.product.unit), status: t.status, tone: (t.dueDate < today ? "danger" : t.status === "NEW" ? "info" : "warning") as Tone })) },
      { title: "Yaqinda bajarilganlar", empty: "Hali bajarilgan topshiriq yo'q", target: "tasks", rows: done.map((t) => ({ id: t.id, title: `${t.taskNo} · ${t.orderItem.product.name}`, subtitle: `${t.order.customer.name} · ${day(t.updatedAt)}`, right: inUnit(sum(t.qty), t.orderItem.product.unit), tone: "success" as Tone })) },
      ...(b.leader ? [{ title: "Brigadir", empty: "", target: "employees", rows: [{ id: b.leader.id, title: b.leader.fullName, subtitle: b.leader.phone ?? undefined, tone: "success" as Tone }] }] : []),
      // Brigada skladi — qo'lidagi xomashyo, berish / qaytarish (`./sklad-extra.ts`)
      ...brigadeStockLink(user, b.id),
    ],
    actions,
  };
}

// ───────────────────────── Yetkazuvchi ─────────────────────────

async function supplierDetail(user: MobileUser, id: string): Promise<MobileDetail> {
  const s = await db.supplier.findUnique({
    where: { id },
    include: {
      receipts: { orderBy: { date: "desc" }, take: 10, include: { items: true } },
      supplyRequests: { where: { status: { in: ["PRICED", "APPROVED", "FUNDED"] } }, orderBy: { date: "desc" }, take: 10, include: { items: true, warehouse: true } },
      _count: { select: { receipts: true } },
    },
  });
  if (!s) throw new ListError("NOT_FOUND", "Yetkazuvchi topilmadi", 404);
  const spent = (await db.goodsReceipt.findMany({ where: { cancelledAt: null, supplierId: id }, select: { items: { select: { qty: true, price: true, vatAmount: true, deliveryCost: true } } } }))
    .reduce((a, r) => a + r.items.reduce((x, i) => x + lineTotal(i), 0), 0);
  const actions: DetailAction[] = [];
  if (can(user, "supplier.toggle")) {
    actions.push(s.isActive
      ? { id: "supplier.toggle", label: "Yetkazuvchini yopish", tone: "danger", confirm: "Yopilgan yetkazuvchi kirim va narx formalarida chiqmaydi. Yopilsinmi?" }
      : { id: "supplier.toggle", label: "Qayta ochish", tone: "success" });
  }
  // Boshlang'ich qarz va uni to'lash (`./moliya-extra.ts`, veb «Boshlang'ich qoldiqlar» → «To'lash»)
  const opening = await supplierOpeningExtra(user, id);
  actions.push(...opening.actions);
  // Rekvizitlar, hisob-kitob, to'lanmagan kirimlar, narxlar tarixi va «Rekvizitlar» tugmasi (`./sklad-extra.ts`)
  const sklad = await supplierExtra(user, id);
  actions.unshift(...sklad.actions);
  return {
    key: "suppliers", id: s.id, title: s.name, subtitle: s.phone ?? undefined, status: s.isActive ? undefined : "Nofaol",
    fields: [
      { label: "Telefon", value: s.phone ?? "—" },
      ...(s.inn ? [{ label: "INN", value: s.inn }] : []),
      { label: "Kirimlar", value: `${s._count.receipts} hujjat` },
      { label: "Jami xarid", value: money(spent), tone: "brand" },
      { label: "Holat", value: s.isActive ? "Faol" : "Nofaol", tone: s.isActive ? "success" : "danger" },
      { label: "Qo'shilgan", value: day(s.createdAt) },
      ...sklad.fields,
    ],
    sections: [
      ...sklad.sections,
      { title: "Ochiq ta'minot zayavkalari", empty: "Ochiq zayavka yo'q", target: "supply", rows: s.supplyRequests.map((r) => ({ id: r.id, title: `${r.docNo} · ${r.warehouse.name}`, subtitle: `${day(r.date)} · ${r.items.length} qator`, right: money(totalPlanned(r)), status: SUPPLY_LABEL[r.status], tone: SUPPLY_TONE[r.status] })) },
      { title: "So'nggi kirimlar", empty: "Kirim yo'q", target: "receipts", rows: s.receipts.map((r) => ({ id: r.id, title: r.docNo, subtitle: `${day(r.date)} · ${r.items.length} qator`, right: money(plannedSum(r.items)) })) },
      ...opening.sections,
    ],
    actions,
  };
}

// ───────────────────────── Retsept ─────────────────────────

/** `id` — mahsulot id'si: amaldagi retsept tarkibi va eski versiyalar (vebdagi `/recipes/[productId]`). */
async function recipeDetail(id: string): Promise<MobileDetail> {
  const p = await db.product.findUnique({ where: { id }, include: { recipes: { orderBy: { version: "desc" }, include: { items: { include: { material: true, product: true } }, _count: { select: { batches: true } } } } } });
  if (!p) throw new ListError("NOT_FOUND", "Mahsulot topilmadi", 404);
  const active = p.recipes.find((r) => r.isActive) ?? p.recipes[0];
  const unit = unitLabel(p.unit);
  return {
    key: "recipes", id: p.id, title: p.name, subtitle: p.code, status: active ? `v${active.version}` : "Retsept yo'q",
    fields: [
      { label: "Birlik", value: unit },
      { label: "Bazaviy narx", value: `${money(sum(p.price))} / ${unit}` },
      ...(p.strengthClass ? [{ label: "Sinf", value: p.strengthClass }] : []),
      { label: "Amaldagi retsept", value: active ? `v${active.version} · ${active.items.length} tarkib · ${active._count.batches} zamesda ishlatilgan` : "Tuzilmagan — «Retsept tuzish» tugmasi bilan yarating", tone: active ? "success" : "warning" },
      ...(active?.note ? [{ label: "Izoh", value: active.note }] : []),
    ],
    sections: [
      { title: `Tarkib — 1 ${unit} uchun`, empty: "Retsept bo'sh", icon: "layers", rows: (active?.items ?? []).map((i) => { const ing = ingredientOf(i); return { id: i.id, title: ing.name, subtitle: ing.kind === "product" ? "yarim tayyor mahsulot" : "xomashyo", right: `${ing.qtyPerM3} ${ing.unit}` }; }) },
      ...(p.recipes.length > 1 ? [{ title: "Versiyalar tarixi", empty: "", icon: "clock", rows: p.recipes.map((r) => ({ id: r.id, title: `v${r.version}`, subtitle: `${day(r.createdAt)} · ${r.items.length} tarkib · ${r._count.batches} zames`, status: r.isActive ? "Amalda" : "Eski", tone: (r.isActive ? "success" : "info") as Tone })) }] : []),
    ],
    actions: [],
  };
}

// ───────────────────────── Marketing: post va target (direktor qarori) ─────────────────────────

const SMM_CH: Record<string, string> = { INSTAGRAM: "Instagram", FACEBOOK: "Facebook", TELEGRAM: "Telegram" };
const SMM_APPROVAL: Record<string, string> = { DRAFT: "Qoralama", PENDING: "Tasdiq kutilmoqda", APPROVED: "Tasdiqlangan", REJECTED: "Rad etilgan" };
const clip = (t: string | null, n: number) => (t && t.length > n ? `${t.slice(0, n)}…` : t ?? "");
const hm2 = (d: Date) => `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

async function smmDetail(user: MobileUser, id: string): Promise<MobileDetail> {
  const c = await db.marketingContent.findUnique({ where: { id }, include: { media: { include: { media: { select: { kind: true } } } } } });
  if (!c) throw new ListError("NOT_FOUND", "Post topilmadi", 404);
  const actions: DetailAction[] = [];
  const open = c.status !== "CANCELLED" && c.status !== "PUBLISHED";
  if (open && (c.approval === "PENDING" || c.approval === "DRAFT") && can(user, "smm.approve")) {
    actions.push({
      id: "smm.approve", label: "Tasdiqlash", tone: "success",
      // Direktor ko'rgan versiya: shundan keyin matn o'zgargan bo'lsa server rad etadi (vebdagi qoida)
      form: [{ name: "seen", label: "Matn", type: "select", required: true, value: String(c.updatedAt.getTime()), options: [{ value: String(c.updatedAt.getTime()), label: "Oxirgi matnni ko'rdim — chiqarishga ruxsat" }] }],
    });
  }
  if (open && (c.approval === "PENDING" || c.approval === "APPROVED") && can(user, "smm.reject")) {
    actions.push({ id: "smm.reject", label: "Rad etish", tone: "danger", form: [{ name: "note", label: "Sabab", type: "text", required: true, placeholder: "Nimani o'zgartirish kerak" }] });
  }
  const photos = c.media.filter((m) => m.media.kind === "IMAGE").length, videos = c.media.length - photos;
  // Sotuv: tasdiqqa yuborish, nashr, target so'rovi; nashrlar va so'rovlar (`./sotuv-extra.ts`)
  const extra = await smmExtras(user, c.id);
  actions.push(...extra.actions);
  return {
    key: "smm", id: c.id, title: c.title, subtitle: `${c.type === "REELS" ? "Reels" : c.type === "STORIES" ? "Stories" : "Post"}${c.createdBy ? ` · ${c.createdBy}` : ""}`,
    status: SMM_APPROVAL[c.approval],
    fields: [
      { label: "Holat", value: SMM_APPROVAL[c.approval], tone: c.approval === "PENDING" ? "warning" : c.approval === "APPROVED" ? "success" : c.approval === "REJECTED" ? "danger" : "info" },
      { label: "Tarmoqlar", value: c.channels.map((x) => SMM_CH[x] ?? x).join(", ") || "—" },
      { label: "Chiqish vaqti", value: c.scheduledAt ? hm2(c.scheduledAt) : "belgilanmagan" },
      { label: "Media", value: c.media.length ? `${videos ? `${videos} video` : ""}${videos && photos ? ", " : ""}${photos ? `${photos} rasm` : ""}` : "yo'q" },
      ...(c.locationName ? [{ label: "Joylashuv", value: c.locationName }] : []),
      ...(c.approvalNote ? [{ label: "Izoh", value: c.approvalNote, tone: "danger" as Tone }] : []),
      { label: "Matn (asosiy)", value: clip(c.caption, 900) || "—" },
      ...(c.captionUz ? [{ label: "Matn (ikkinchi til)", value: clip(c.captionUz, 600) }] : []),
      ...(c.hashtags ? [{ label: "Heshteglar", value: c.hashtags }] : []),
    ],
    sections: extra.sections,
    actions,
  };
}

async function boostDetail(user: MobileUser, id: string): Promise<MobileDetail> {
  const b = await db.smmBoost.findUnique({ where: { id }, include: { content: { select: { title: true } } } });
  if (!b) throw new ListError("NOT_FOUND", "Target so'rovi topilmadi", 404);
  const st = await db.marketingSettings.findUnique({ where: { id: "main" }, select: { adCurrency: true } });
  const cur = st?.adCurrency ?? "USD";
  const total = Number(b.dailyBudget) * b.days;
  const actions: DetailAction[] = [];
  if (b.status === "PENDING_APPROVAL" && can(user, "boost.approve")) {
    actions.push({ id: "boost.approve", label: "Tasdiqlash va ishga tushirish", tone: "success", confirm: `Reklamani ishga tushirasizmi? Jami ${fmtNum(total, 2)} ${cur} gacha sarflanadi` });
  }
  if (b.status === "PENDING_APPROVAL" && can(user, "boost.reject")) {
    actions.push({ id: "boost.reject", label: "Rad etish", tone: "danger", form: [{ name: "note", label: "Sabab", type: "text", placeholder: "Ixtiyoriy" }] });
  }
  const OBJ: Record<string, string> = { REACH: "Ko'proq odam ko'rsin", MESSAGES: "Direct'ga yozishsin", LEADS: "Ariza qoldirishsin" };
  // Natijalar va to'xtatish / davom ettirish (`./sotuv-extra.ts`)
  const extra = await boostExtras(user, b.id);
  actions.push(...extra.actions);
  return {
    key: "boost", id: b.id, title: `Target · ${b.content.title}`, subtitle: b.requestedByName ? `So'radi: ${b.requestedByName}` : undefined,
    status: b.status === "PENDING_APPROVAL" ? "Tasdiq kutilmoqda" : b.status,
    fields: [
      { label: "Maqsad", value: OBJ[b.objective] ?? b.objective },
      { label: "Kunlik byudjet", value: `${fmtNum(Number(b.dailyBudget), 2)} ${cur}` },
      { label: "Muddat", value: `${b.days} kun` },
      { label: "Jami", value: `${fmtNum(total, 2)} ${cur}`, tone: "brand" },
      ...(b.note ? [{ label: "Izoh", value: b.note }] : []),
      ...(b.error ? [{ label: "Natija", value: b.error }] : []),
      ...extra.fields,
    ],
    sections: extra.sections,
    actions,
  };
}

