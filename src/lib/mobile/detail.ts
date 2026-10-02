import { db } from "@/lib/db";
import { activityDetail, splitRef } from "./director";
import { customerCredit } from "@/lib/finance";
import { materialOutlook } from "@/lib/dashboard";
import { ecoEnabled } from "@/lib/eco/client";
import { ecoLabel } from "@/lib/eco/labels";
import { activeBrigades } from "@/lib/brigades";
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
import { DETAIL_KEY, driverEmployeeId, myBrigadeIds, ListError } from "./list";
import { unitLabel, unitTotals, soleUnit, donePercent, type UnitRow } from "@/lib/unit";
import { ingredientOf } from "@/lib/recipe";
import { savedReportDetail, sexDetail, sexEmployeeDetail } from "./sex";
import { repDetail } from "./report-detail";
import { dashDetail } from "./dash-detail";
import { brigIssueDetail, brigShiftDetail, defectAction, issueActions } from "./brigadier";
import { BRIGADE_ISSUE, ISSUE_RESOLVERS, taskPhase } from "@/lib/brigade-shift";
import { DEFECT_REASONS } from "@/lib/production-day";
import { TASK_ROLES } from "@/lib/tasks";
import { pctText } from "./fmt";
import type { Role, SupplyStatus } from "@/generated/prisma";

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
  required?: boolean;
  placeholder?: string;
  /** Boshlang'ich qiymat. Switch uchun "true"/"false". */
  value?: string;
  /** Maydon ostidagi kichik izoh. */
  hint?: string;
  options?: FormOption[];
  /** Shart: boshqa maydon shu qiymatda bo'lsagina ko'rinadi. */
  showIf?: { field: string; equals: string };
  /** `photo` uchun: qaysi kamera ochilsin (yuz — old kamera) va galereyadan tanlashga yo'l qo'ymaslik (faqat jonli kadr). */
  camera?: "front" | "back";
  cameraOnly?: boolean;
  columns?: FormField[];
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
  "order.confirm": ["SALES"],
  "order.unblock": ["DIRECTOR"],
  "order.cancel": ["SALES"],
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
  "trip.eco": ["LOGISTICS"],
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
  "issue.resolve": ["BRIGADIER", ...ISSUE_RESOLVERS],
  "task.cancel": [...TASK_ROLES.cancel],
  // Brigadir — veb "Brigadalar" sahifasidagi bilan bir xil ruxsat
  "employee.brigade": [...TASK_ROLES.brigadeEdit],
  "employee.brigade.clear": [...TASK_ROLES.brigadeEdit],
  "brigade.toggle": [...TASK_ROLES.brigadeEdit],
  // Ta'minot zanjiri — `lib/supply-actions.ts` dagi bilan bir xil bo'linish:
  // sklad so'raydi → snabjeniye narxlaydi → sotuv tasdiqlaydi → moliya pul ajratadi → snabjeniye qabul qiladi.
  // Zavodda alohida snabjeniye logini bo'lmasligi mumkin — snabjeniye amallarini WAREHOUSE ham bajaradi.
  "supply.items": ["WAREHOUSE", "PROCUREMENT", "PRODUCTION"],
  "supply.price": ["PROCUREMENT", "WAREHOUSE"],
  "supply.approve": ["SALES"],
  "supply.fund": ["FINANCE", "ACCOUNTING", "CASHIER"],
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
  "supply.delivery": ["PROCUREMENT", "WAREHOUSE"],
  "supply.incident": ["PROCUREMENT", "WAREHOUSE", "PRODUCTION"],
  "supply.incident.resolve": ["PROCUREMENT", "WAREHOUSE"],
  "supply.doc": ["PROCUREMENT", "WAREHOUSE", "ACCOUNTING", "FINANCE"],
  // Sayt arizalari — veb `/leads` bilan bir xil (SALES; direktor har doim)
  "lead.progress": ["SALES"],
  "lead.reopen": ["SALES"],
  "lead.reject": ["SALES"],
  "lead.convert": ["SALES"],
  "lead.note": ["SALES"],
  // Yetkazuvchini yopish/ochish — veb `/suppliers`
  "supplier.toggle": ["WAREHOUSE", "PROCUREMENT"],
  // Sex (mobil ishlab chiqarish bosh ekrani): davomatni sex boshlig'i belgilaydi (`lib/production-staff.ts`),
  // kunlik hisobotni u qayd etadi; xodimni brigadaga direktor taqsimlaydi
  // Brigadir smena boshida faqat O'Z brigadasi a'zolarini belgilaydi (`assertOwnMember`).
  // Yuz tekshiruvi yoqiq bo'lsa brigadir "Keldi" ni faqat `att.face` bilan qo'yadi: att.present/att.all va
  // att.status orqali PRESENT rad etiladi, vaqtni esa faqat sex boshlig'i tuzatadi (`lib/mobile/actions.ts`)
  "att.present": ["PRODUCTION", "SUPERVISOR", "BRIGADIER"],
  // "Keldi" yuz bilan: kamera kadri profil surati bilan solishtiriladi (`lib/ai/face.ts`), mos kelmasa yozilmaydi
  "att.face": ["PRODUCTION", "SUPERVISOR", "BRIGADIER"],
  "att.checkout": ["PRODUCTION", "SUPERVISOR", "BRIGADIER"],
  "att.absent": ["PRODUCTION", "SUPERVISOR", "BRIGADIER"],
  "att.status": ["PRODUCTION", "SUPERVISOR", "BRIGADIER"],
  "att.all": ["PRODUCTION", "SUPERVISOR", "BRIGADIER"],
  "att.form": ["PRODUCTION", "SUPERVISOR"],
  "report.submit": ["PRODUCTION", "SUPERVISOR"],
  "sex.assign": ["DIRECTOR"],
};

/**
 * Direktor bu yerda istisno EMAS: u hamma hujjatni ko'radi, lekin tugma faqat ro'yxatda
 * DIRECTOR yozilgan amallarda chiqadi (blokdan chiqarish kabi). Aks holda direktor ilovasida
 * "Bog'landim", "Yetkazildi" kabi xodimning ishi turib qoladi va kim javobgar — chalkashadi.
 */
export const can = (user: MobileUser, action: string) => (ACTION_ROLES[action] ?? []).includes(user.role);

/**
 * Maxfiy kartochkalar — id bilan to'g'ridan-to'g'ri so'ralsa ham faqat shu rollar ochadi
 * (ro'yxatdagi ACCESS bilan bir xil, qo'shimcha: boshqa kartadan havola orqali ochadiganlar).
 * Operatsion hujjatlar (zayavka, reys, zames...) ochiq qoladi — ular kartalar orasida bog'langan.
 */
const DETAIL_ROLES: Partial<Record<string, Role[]>> = {
  cashflow: ["CASHIER", "ACCOUNTING", "FINANCE"],
  // Sotuvchi schyot kartasidan to'lovni ochadi
  payments: ["CASHIER", "ACCOUNTING", "FINANCE", "SALES"],
  // Kassir to'lovni mijoz ustida oladi
  customers: ["SALES", "ACCOUNTING", "FINANCE", "CASHIER"],
  // Brigada kartasidan brigadirni ochadiganlar (SALES) ham
  employees: ["HR", "LOGISTICS", "PRODUCTION", "SUPERVISOR", "SALES"],
  // Sex statistikasi, sex xodimi va kunlik hisobot (`./sex.ts`)
  sex: ["PRODUCTION", "SUPERVISOR"],
  "sex-emp": ["PRODUCTION", "SUPERVISOR", "BRIGADIER"],
  // Brigadir smenasi va muammolari (`./brigadier.ts`) — brigadirga faqat o'z brigadasiniki
  "brig-shift": ["PRODUCTION", "SUPERVISOR", "BRIGADIER"],
  "brig-issue": ["BRIGADIER", ...ISSUE_RESOLVERS],
  "prod-report": ["PRODUCTION", "SUPERVISOR"],
  // Hisobotdan bosib ochiladigan soat / brigada / mahsulot / brak kartalari — faqat ko'rish (`./report-detail.ts`)
  rep: ["PRODUCTION", "SUPERVISOR"],
  // Mijozning shaxsiy ma'lumoti (ism, telefon) — faqat sotuv
  leads: ["SALES"],
  // Pul hujjati: summa, to'lovlar — ro'yxatdagi ACCESS bilan bir xil
  invoices: ["ACCOUNTING", "FINANCE", "SALES", "CASHIER"],
  // Yetkazuvchi rekvizitlari va qarzi
  suppliers: ["WAREHOUSE", "PROCUREMENT", "ACCOUNTING"],
};

const BRIGADIER_CARDS = ["tasks", "brig-shift", "brig-issue", "sex-emp", "dash"];

export async function mobileDetail(user: MobileUser, key: string, id: string): Promise<MobileDetail> {
  if (!id) throw new ListError("BAD_REQUEST", "id yo'q", 400);
  // Brigadir ilovada faqat o'z ish joyi kartochkalarini ochadi (topshiriq, smena, muammo, brigada a'zosi):
  // zayavka, schyot va boshqa hujjatlar unga ro'yxatda ham ko'rinmaydi, id qo'lda yuborilsa ham ochilmaydi.
  if (user.role === "BRIGADIER" && !BRIGADIER_CARDS.includes(key)) throw new ListError("FORBIDDEN", "Bu bo'limga ruxsat yo'q", 403);
  // Haydovchi ilovada faqat reys kartochkasini ochadi — vebda ham unga faqat "Mening reyslarim" ochiq
  if (user.role === "DRIVER" && key !== "trips" && key !== "dash") throw new ListError("FORBIDDEN", "Bu bo'limga ruxsat yo'q", 403);
  // Sotuv agenti faqat o'z zayavkasi va o'z mijozi kartochkasini ochadi (ownership quyida tekshiriladi)
  if (user.role === "AGENT" && !["orders", "customers", "dash"].includes(key)) throw new ListError("FORBIDDEN", "Bu bo'limga ruxsat yo'q", 403);
  // Aralash ro'yxatlar (direktor "Tasdiqlar") qator id'sida kartochka kalitini olib keladi: `orders:<id>`
  const [refKey, refId] = splitRef(id);
  if (refKey) return mobileDetail(user, refKey, refId);
  const card = DETAIL_KEY[key] ?? key;
  const allowed = DETAIL_ROLES[card];
  if (allowed && user.role !== "DIRECTOR" && !allowed.includes(user.role)) throw new ListError("FORBIDDEN", "Bu bo'limga ruxsat yo'q", 403);
  if (key === "activity") {
    if (user.role !== "DIRECTOR") throw new ListError("FORBIDDEN", "Bu bo'limga ruxsat yo'q", 403);
    return activityDetail(id);
  }
  switch (DETAIL_KEY[key] ?? key) {
    case "orders": return orderDetail(user, id);
    case "trips": return tripDetail(user, id);
    case "invoices": return invoiceDetail(user, id);
    case "payments": return paymentDetail(id);
    case "receipts": return receiptDetail(id);
    case "tasks": return taskDetail(user, id);
    case "production": return batchDetail(id);
    case "stock": return materialDetail(id);
    case "employees": return employeeDetail(user, id);
    case "cashflow": return cashflowDetail(id);
    case "supply": return supplyDetail(user, id);
    case "customers": return customerDetail(user, id);
    case "leads": return leadDetail(user, id);
    case "brigades": return brigadeDetail(user, id);
    case "suppliers": return supplierDetail(user, id);
    case "recipes": return recipeDetail(id);
    // Dashboard kartasi bosilganda — davr bo'yicha batafsil (`./dash-detail.ts`), rol foydalanuvchidan
    case "dash": return dashDetail(user, id);
    case "sex": return sexDetail(user, id);
    case "sex-emp": return sexEmployeeDetail(user, id);
    case "prod-report": return savedReportDetail(user, id);
    case "rep": return repDetail(user, id);
    case "brig-shift": return brigShiftDetail(user, id);
    case "brig-issue": return brigIssueDetail(user, id);
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
  if (o.status === "DRAFT" && can(user, "order.confirm")) actions.push({ id: "order.confirm", label: "Qabul qilish", tone: "success", confirm: "Zayavka qabul qilinsinmi? Kredit limiti tekshiriladi." });
  if (o.status === "BLOCKED" && can(user, "order.unblock")) actions.push({ id: "order.unblock", label: "Blokni ochish", tone: "warning", confirm: `Limit oshgan (${money(credit.used)} / ${money(credit.limit)}). Baribir ochilsinmi?` });
  if (["DRAFT", "BLOCKED", "CONFIRMED"].includes(o.status) && can(user, "order.cancel")) actions.push({ id: "order.cancel", label: "Bekor qilish", tone: "danger", confirm: "Zayavka bekor qilinsinmi?" });
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

  return {
    key: "orders", id: o.id, title: o.orderNo, subtitle: o.customer.name, status: o.status,
    fields: [
      { label: "Yetkazish", value: `${day(o.deliveryDate)}${o.deliveryTime ? ` · ${o.deliveryTime}` : ""}` },
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
      { label: "Kim kiritdi", value: `${o.createdBy.fullName} · ${day(o.date)}` },
      ...(o.note ? [{ label: "Izoh", value: o.note }] : []),
    ],
    sections: [
      { title: "Mahsulotlar", empty: "Qator yo'q", icon: "package", rows: o.items.map((i) => ({ id: i.id, title: i.product.name, subtitle: `${money(sum(i.price))} / ${unitLabel(i.product.unit)}`, right: inUnit(sum(i.qtyM3), i.product.unit) })) },
      { title: "Reyslar", empty: "Reys yo'q", target: "trips", rows: o.trips.map((t) => ({ id: t.id, title: `${t.deliveryNoteNo} · ${t.vehicle.plate}`, subtitle: t.driver.fullName, right: inUnit(sum(t.qtyM3), orderUnit), status: t.status, tone: TRIP_TONE[t.status] })) },
      { title: "Zameslar", empty: "Zames yo'q", target: "production", rows: o.batches.map((b) => ({ id: b.id, title: `${b.batchNo} · ${b.product.name}`, subtitle: day(b.date), right: inUnit(sum(b.qtyM3), b.product.unit) })) },
      { title: "Schyotlar", empty: "Schyot yo'q", target: "invoices", rows: o.invoices.map((i) => ({ id: i.id, title: i.invoiceNo, subtitle: day(i.date), right: money(sum(i.amount)), status: i.status })) },
    ]
      // Schyot kartasi faqat moliya va sotuvga ochiq (DETAIL_ROLES) — boshqalarga ochilmaydigan havola ko'rsatilmaydi
      .filter((s) => s.target !== "invoices" || user.role === "DIRECTOR" || (DETAIL_ROLES.invoices ?? []).includes(user.role))
      .filter((s) => s.rows.length > 0 || s.title === "Mahsulotlar"),
    actions,
  };
}

// ───────────────────────── Reys / nakladnoy ─────────────────────────

async function tripDetail(user: MobileUser, id: string): Promise<MobileDetail> {
  const t = await db.trip.findUnique({ where: { id }, include: { order: { include: { customer: true, site: true, items: { select: { qtyM3: true, product: { select: { unit: true } } } } } }, driver: true, vehicle: true, issues: { orderBy: { createdAt: "desc" } } } });
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
      ...(!isDriver && openIssues.length && can(user, "trip.resolve") ? [{ id: "trip.resolve", label: `Muammoni hal qilish (${openIssues.length})`, tone: "success" as const, form: [{ name: "resolution", label: "Qanday hal qilindi", type: "text" as const, required: true }] }] : []),
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

async function paymentDetail(id: string): Promise<MobileDetail> {
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
    fields, sections: [], actions: [],
    receipt: {
      headline: `+${money(sum(p.amount))}`, caption: p.customer.name,
      status: { label: "To'lov qabul qilindi", tone: "success", at: p.date.toISOString() },
      rows: fields.filter((f) => f.label !== "Mijoz").map((f) => ({ label: f.label, value: f.value, copy: f.label === "Schyot" || f.label === "Zayavka" })),
    },
  };
}

async function receiptDetail(id: string): Promise<MobileDetail> {
  const r = await db.goodsReceipt.findUnique({ where: { id }, include: { supplier: true, warehouse: true, createdBy: true, items: { include: { material: true } } } });
  if (!r) throw new ListError("NOT_FOUND", "Kirim topilmadi", 404);
  const total = r.items.reduce((s, i) => s + sum(i.qty) * sum(i.price), 0);
  const fields: DetailField[] = [
    { label: "Hujjat", value: r.docNo },
    { label: "Sana", value: day(r.date) },
    { label: "Yetkazuvchi", value: r.supplier.name },
    { label: "Ombor", value: r.warehouse.name },
    { label: "Jami", value: money(total) },
    ...(r.createdBy ? [{ label: "Kim kiritdi", value: r.createdBy.fullName }] : []),
    ...(r.note ? [{ label: "Izoh", value: r.note }] : []),
  ];
  return {
    key: "receipts", id: r.id, title: r.docNo, subtitle: r.supplier.name,
    fields: fields.slice(1),
    sections: [{ title: "Qatorlar", empty: "Qator yo'q", icon: "package", rows: r.items.map((i) => ({ id: i.id, title: i.material.name, subtitle: `${money(sum(i.price))} / ${i.material.unit}`, right: `${sum(i.qty)} ${i.material.unit}` })) }],
    actions: [],
    // Xarid — pul chiqib ketgan hujjat, chekda qizil
    receipt: {
      headline: `−${money(total)}`, caption: r.supplier.name,
      status: { label: "Xarid · omborga kirim", tone: "danger", at: r.date.toISOString() },
      rows: fields.filter((f) => f.label !== "Yetkazuvchi").map((f) => ({ label: f.label, value: f.value, copy: f.label === "Hujjat" })),
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
      id: "task.progress", label: "Fakt kiritish (qisman bajarildi)", tone: "success",
      form: [
        { name: "qty", label: `Bajarilgan miqdor (${unit}) — qoldiq ${num(left)}`, type: "number", required: true, value: String(left) },
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
    fields: [
      { label: "Sana", value: dt(b.date) },
      { label: "Smena", value: `${b.shift}-smena` },
      { label: "Hajm", value: inUnit(sum(b.qtyM3), b.product.unit) },
      { label: "Zayavka", value: b.order ? `${b.order.orderNo} · ${b.order.customer.name}` : "Omborga" },
      { label: "Retsept", value: `${b.product.name} · v${b.recipe.version}` },
      { label: "Kim kiritdi", value: b.createdBy.fullName },
    ],
    sections: [{
      title: "Sarflangan xomashyo / mahsulot", empty: "Retsept bo'sh", icon: "layers",
      rows: b.recipe.items.map((i) => { const ing = ingredientOf(i); return { id: i.id, title: ing.name, subtitle: `${sum(ing.qtyPerM3)} ${ing.unit} / ${unitLabel(b.product.unit)}`, right: `${(ing.qtyPerM3 * sum(b.qtyM3)).toFixed(1)} ${ing.unit}` }; }),
    }],
    actions: [],
  };
}

async function materialDetail(id: string): Promise<MobileDetail> {
  const m = await db.material.findUnique({ where: { id } });
  if (!m) throw new ListError("NOT_FOUND", "Xomashyo topilmadi", 404);
  const [agg, moves, outlook] = await Promise.all([
    db.stockMove.aggregate({ where: { materialId: id }, _sum: { qty: true } }),
    db.stockMove.findMany({ where: { materialId: id }, orderBy: { date: "desc" }, take: 20, include: { createdBy: true } }),
    materialOutlook(),
  ]);
  const balance = sum(agg._sum.qty);
  const o = outlook.find((x) => x.id === id);
  const n = (v: number) => `${num(v)} ${m.unit}`;
  const need = o ? Math.max(0, o.planned - balance, sum(m.minStock) - balance) : 0;
  const MOVE_LABEL: Record<string, string> = { RECEIPT: "Kirim", PRODUCTION_CONSUME: "Ishlab chiqarishga", SHIPMENT: "Chiqim", ADJUSTMENT: "Tuzatish", WRITE_OFF: "Hisobdan chiqarish", TRANSFER: "Ko'chirish" };
  return {
    key: "stock", id: m.id, title: m.name, subtitle: m.code,
    fields: [
      { label: "Qoldiq", value: `${balance.toFixed(1)} ${m.unit}`, tone: balance < sum(m.minStock) ? "danger" : "success" },
      { label: "Minimum", value: `${sum(m.minStock)} ${m.unit}` },
      ...(o ? [
        { label: "Zayavkalarga kerak", value: o.planned > 0 ? `${n(o.planned)} · ${o.orders.length} ta zayavka` : "yo'q" },
        { label: "Zayavkaga yetmaydi", value: o.orderGap > 0 ? n(o.orderGap) : "yetadi", tone: (o.orderGap > 0 ? "danger" : "success") as Tone },
        ...(need > 0 ? [{ label: "Olib kelish kerak", value: n(need), tone: "warning" as Tone }] : []),
        ...(o.perDay > 0 ? [{ label: "Kunlik sarf", value: `${n(o.perDay)} · ${o.days !== null ? `${o.days > 999 ? ">999" : o.days.toFixed(1)} kunga yetadi` : "—"}` }] : []),
      ] : []),
      { label: "Holat", value: m.isActive ? "Faol" : "Nofaol" },
    ],
    sections: [...(o && o.orders.length ? [{
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
      rows: moves.map((mv) => ({ id: mv.id, title: MOVE_LABEL[mv.type] ?? mv.type, subtitle: `${day(mv.date)}${mv.createdBy ? ` · ${mv.createdBy.fullName}` : ""}`, right: `${sum(mv.qty) > 0 ? "+" : ""}${sum(mv.qty).toFixed(1)} ${m.unit}`, tone: sum(mv.qty) > 0 ? ("success" as Tone) : ("danger" as Tone) })),
    }],
    actions: [],
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
  if (led.length && can(user, "employee.brigade.clear")) {
    actions.push({ id: "employee.brigade.clear", label: "Brigadirlikdan olish", tone: "danger", confirm: `${e.fullName} ${led.map((b) => b.name).join(", ")} brigadirligidan olinsinmi? Brigada o'chmaydi, brigadirsiz qoladi.` });
  }

  return {
    key: "employees", id: e.id, title: e.fullName, subtitle: e.position, status: e.isActive ? "Faol" : "Nofaol",
    fields: [
      { label: "Telefon", value: e.phone ?? "—" },
      { label: "Brigada", value: led.length ? `${led.map((b) => b.name).join(", ")} brigadiri` : "—", tone: led.length ? "success" : undefined },
      { label: "Tizim logini", value: e.user ? e.user.login : "yo'q" },
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
    ],
    actions,
  };
}

async function cashflowDetail(id: string): Promise<MobileDetail> {
  const t = await db.cashTransaction.findUnique({ where: { id }, include: { cashAccount: true, supplier: true, createdBy: true } });
  if (!t) throw new ListError("NOT_FOUND", "Yozuv topilmadi", 404);
  const out = t.type === "EXPENSE";
  const fields: DetailField[] = [
    { label: "Sana", value: dt(t.date) },
    { label: "Turi", value: out ? "Chiqim" : "Kirim", tone: out ? "danger" : "success" },
    { label: "Kategoriya", value: t.category },
    { label: "Hisob", value: t.cashAccount.name },
    ...(t.counterparty ? [{ label: out ? "Kimga" : "Kimdan", value: t.counterparty }] : []),
    ...(t.supplier ? [{ label: "Yetkazuvchi", value: t.supplier.name }] : []),
    ...(t.refType === "SupplyRequest" && t.refId ? [{ label: "Talabnoma", value: t.refId }] : []),
    { label: "Kim kiritdi", value: t.createdBy.fullName },
    ...(t.note ? [{ label: "Izoh", value: t.note }] : []),
  ];
  return {
    key: "cashflow", id: t.id, title: `${out ? "−" : "+"}${money(sum(t.amount))}`, subtitle: t.category,
    fields, sections: [], actions: [],
    receipt: {
      headline: `${out ? "−" : "+"}${money(sum(t.amount))}`, caption: t.counterparty ? `${t.category} · ${t.counterparty}` : t.category,
      status: { label: out ? "Chiqim" : "Kirim", tone: out ? "danger" : "success", at: t.date.toISOString() },
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
      { name: "note", label: "Izoh", type: "text" },
    ];
    if (can(user, "supply.receive")) actions.push({ id: "supply.receive", label: "Qabul qildim — skladga kirim", tone: "success", form: factForm });
    if (can(user, "supply.fact")) actions.push({ id: "supply.fact", label: "Faktni saqlash (hali qabul emas)", tone: "brand", form: factForm });
  }
  // Bekor qilish — har bosqichda, zanjirdagi o'z bo'limi
  // ── Snabjeniye TZ ──
  const limit = await directorLimit();
  const big = needsDirector(planned, limit);
  const waitDirector = st === "PRICED" && big && !r.directorOkAt;
  // Katta xarid direktor tasdig'ini kutsa — sotuvchining "Tasdiqlash" tugmasi ko'rinadi, lekin yopiq (nega — hint'da)
  const ap = actions.find((a) => a.id === "supply.approve");
  if (ap && waitDirector) { ap.disabled = true; ap.hint = `${money(planned)} — ${money(limit)} dan katta xarid: avval direktor tasdiqlaydi`; }
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
      id: "supply.meta", label: "Rekvizitlar (bo'lim, ustuvorlik, mas'ul)", tone: "brand",
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
  if (isOpenSupply(st) && can(user, "supply.reject") && canRejectSupply(r, user)) {
    actions.push({ id: "supply.reject", label: "Bekor qilish", tone: "danger", form: [{ name: "reason", label: "Sabab", type: "text", required: true, placeholder: "Nega bekor qilinmoqda" }] });
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
      ...(r.documents.length ? [{ title: "Hujjatlar", empty: "", icon: "file-text", rows: r.documents.map((d) => ({ id: d.id, title: d.kind, subtitle: `${d.fileName} · ${d.createdBy.fullName}`, right: shortDt(d.createdAt) })) }] : []),
      { title: "Bosqichlar", empty: "Hali bosqich yozilmagan", icon: "clock", rows: r.events.map((e) => ({ id: e.id, title: STAGE_LABEL[e.stage] ?? SUPPLY_LABEL[e.stage], subtitle: `${e.user.fullName}${e.note ? ` · ${e.note}` : ""}`, right: shortDt(e.createdAt), tone: SUPPLY_TONE[e.stage] })) },
      ...(r.receipt ? [{ title: "Kirim hujjati", empty: "", target: "receipts", rows: [{ id: r.receipt.id, title: r.receipt.docNo, subtitle: "Skladga kirim", tone: "success" as Tone }] }] : []),
    ],
    actions,
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
      { label: "Qarz (schyot bo'yicha)", value: money(credit.debt), tone: credit.debt > 0 ? "danger" : "success" },
      { label: "Schyotsiz zayavkalar", value: money(credit.open), tone: credit.open > 0 ? "warning" : undefined },
      { label: "Limitda qoldi", value: money(Math.max(0, credit.free)), tone: credit.blacklisted ? "danger" : "success" },
      ...(history?.orders ? [{ label: "Xarid", value: `${money(history.bought)} · ${history.orders} zayavka` }] : []),
      ...(history?.lastOrderAt ? [{ label: "Oxirgi zayavka", value: day(history.lastOrderAt) }] : []),
      { label: "Holat", value: c.isActive ? "Faol" : "Nofaol", tone: c.isActive ? "success" : "danger" },
    ],
    sections: [
      { title: "Ochiq schyotlar", empty: "Ochiq schyot yo'q", target: "invoices", rows: c.invoices.map((i) => { const left = sum(i.amount) - i.payments.reduce((p, x) => p + sum(x.amount), 0); return { id: i.id, title: i.invoiceNo, subtitle: `${day(i.date)} · jami ${money(sum(i.amount))}`, right: money(left), status: i.status, tone: (i.status === "PARTIAL" ? "warning" : "danger") as Tone }; }) },
      { title: "So'nggi zayavkalar", empty: "Zayavka yo'q", target: "orders", rows: c.orders.map((o) => ({ id: o.id, title: o.orderNo, subtitle: `${day(o.deliveryDate)} · ${o.deliveryAddress}`, right: money(o.items.reduce((s, i) => s + sum(i.qtyM3) * sum(i.price), 0)), status: o.status, tone: ORDER_TONE[o.status] })) },
    ],
    actions: [],
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
    sections: l.customer ? [{ title: "Mijoz", empty: "", target: "customers", rows: [{ id: l.customer.id, title: l.customer.name, subtitle: l.customer.phone ?? undefined, tone: "success" as Tone }] }] : [],
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
  const spent = (await db.goodsReceipt.findMany({ where: { supplierId: id }, select: { items: { select: { qty: true, price: true } } } }))
    .reduce((a, r) => a + r.items.reduce((x, i) => x + sum(i.qty) * sum(i.price), 0), 0);
  const actions: DetailAction[] = [];
  if (can(user, "supplier.toggle")) {
    actions.push(s.isActive
      ? { id: "supplier.toggle", label: "Yetkazuvchini yopish", tone: "danger", confirm: "Yopilgan yetkazuvchi kirim va narx formalarida chiqmaydi. Yopilsinmi?" }
      : { id: "supplier.toggle", label: "Qayta ochish", tone: "success" });
  }
  return {
    key: "suppliers", id: s.id, title: s.name, subtitle: s.phone ?? undefined, status: s.isActive ? undefined : "Nofaol",
    fields: [
      { label: "Telefon", value: s.phone ?? "—" },
      ...(s.inn ? [{ label: "INN", value: s.inn }] : []),
      { label: "Kirimlar", value: `${s._count.receipts} hujjat` },
      { label: "Jami xarid", value: money(spent), tone: "brand" },
      { label: "Holat", value: s.isActive ? "Faol" : "Nofaol", tone: s.isActive ? "success" : "danger" },
      { label: "Qo'shilgan", value: day(s.createdAt) },
    ],
    sections: [
      { title: "Ochiq ta'minot zayavkalari", empty: "Ochiq zayavka yo'q", target: "supply", rows: s.supplyRequests.map((r) => ({ id: r.id, title: `${r.docNo} · ${r.warehouse.name}`, subtitle: `${day(r.date)} · ${r.items.length} qator`, right: money(totalPlanned(r)), status: SUPPLY_LABEL[r.status], tone: SUPPLY_TONE[r.status] })) },
      { title: "So'nggi kirimlar", empty: "Kirim yo'q", target: "receipts", rows: s.receipts.map((r) => ({ id: r.id, title: r.docNo, subtitle: `${day(r.date)} · ${r.items.length} qator`, right: money(plannedSum(r.items)) })) },
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
      { label: "Amaldagi retsept", value: active ? `v${active.version} · ${active.items.length} tarkib · ${active._count.batches} zamesda ishlatilgan` : "Tuzilmagan — vebda Retseptlar bo'limida yarating", tone: active ? "success" : "warning" },
      ...(active?.note ? [{ label: "Izoh", value: active.note }] : []),
    ],
    sections: [
      { title: `Tarkib — 1 ${unit} uchun`, empty: "Retsept bo'sh", icon: "layers", rows: (active?.items ?? []).map((i) => { const ing = ingredientOf(i); return { id: i.id, title: ing.name, subtitle: ing.kind === "product" ? "yarim tayyor mahsulot" : "xomashyo", right: `${ing.qtyPerM3} ${ing.unit}` }; }) },
      ...(p.recipes.length > 1 ? [{ title: "Versiyalar tarixi", empty: "", icon: "clock", rows: p.recipes.map((r) => ({ id: r.id, title: `v${r.version}`, subtitle: `${day(r.createdAt)} · ${r.items.length} tarkib · ${r._count.batches} zames`, status: r.isActive ? "Amalda" : "Eski", tone: (r.isActive ? "success" : "info") as Tone })) }] : []),
    ],
    actions: [],
  };
}
