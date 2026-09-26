import { db } from "@/lib/db";
import { customerCredit } from "@/lib/finance";
import { ecoEnabled } from "@/lib/eco/client";
import { ecoLabel } from "@/lib/eco/labels";
import { activeBrigades } from "@/lib/brigades";
import { distanceLabel, tripArrival, tripSteps, tripTrackStats } from "@/lib/trips";
import { customersHistory, STAR_LABELS } from "@/lib/finance";
import {
  DELIVERY_KINDS, SUPPLY_LABEL, SUPPLY_OWNER, SUPPLY_STEPS, hasFact, lastPurchasePrices, plannedSum, priceDelta, priceKey,
  supplyRequest, totalFact, totalPlanned, isOpenSupply,
} from "@/lib/supply";
import { DELIVERY_OWN } from "@/lib/supply-const";
import type { MobileUser } from "./auth";
import type { HomeSection, Tone } from "./home";
import { DETAIL_KEY, driverEmployeeId, myBrigadeIds, ListError } from "./list";
import { unitLabel, unitTotals, soleUnit, donePercent, type UnitRow } from "@/lib/unit";
import { ingredientOf } from "@/lib/recipe";
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
  /** `items` — takrorlanuvchi qatorlar (zayavka mahsulotlari); ustunlari `columns` da. */
  type: "text" | "number" | "date" | "time" | "select" | "switch" | "items";
  required?: boolean;
  placeholder?: string;
  /** Boshlang'ich qiymat. Switch uchun "true"/"false". */
  value?: string;
  /** Maydon ostidagi kichik izoh. */
  hint?: string;
  options?: FormOption[];
  /** Shart: boshqa maydon shu qiymatda bo'lsagina ko'rinadi. */
  showIf?: { field: string; equals: string };
  columns?: FormField[];
};
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
export type MobileDetail = {
  key: string;
  id: string;
  title: string;
  subtitle?: string;
  status?: string;
  fields: DetailField[];
  sections: HomeSection[];
  actions: DetailAction[];
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
  { name: "note", label: "Izoh", type: "text" },
];

/** Amalga kim haqli — veb ERP'dagi `requireSession([...])` bilan bir xil ro'yxat. */
export const ACTION_ROLES: Record<string, Role[]> = {
  "order.confirm": ["SALES"],
  "order.unblock": ["DIRECTOR"],
  "order.cancel": ["SALES"],
  // Haydovchi reysni ilovadan o'zi harakatlantiradi — lekin faqat o'ziga biriktirilganini
  // (`assertOwnTrip`, `lib/mobile/actions.ts`). Rol ro'yxati "kim", egalik "qaysi reysni" deydi.
  "trip.loaded": ["LOGISTICS", "PRODUCTION", "DRIVER"],
  "trip.onroad": ["LOGISTICS", "PRODUCTION", "DRIVER"],
  "trip.delivered": ["LOGISTICS", "PRODUCTION", "DRIVER"],
  // Marshrutni ochish — ilova ichidagi ish, holatni o'zgartirmaydi. Ro'yxatda turishi
  // shuning uchun: `local` ni tushunmaydigan eski ilova baribir serverga murojaat qiladi,
  // va "Bunday amal yo'q" degan xato o'rniga bo'sh javob olsin.
  "trip.route": ["LOGISTICS", "DRIVER"],
  "trip.cancel": ["LOGISTICS"],
  "trip.eco": ["LOGISTICS"],
  "invoice.pay": ["CASHIER", "ACCOUNTING"],
  // Schyot yozish — veb `/invoices/new` bilan bir xil
  "order.invoice": ["SALES", "ACCOUNTING"],
  // Brigadir o'z brigadasining topshirig'ini ilovada qayd qiladi (`assertOwnTask` — qaysi topshiriqni)
  "task.progress": ["SUPERVISOR", "PRODUCTION", "LOGISTICS", "BRIGADIER"],
  "task.cancel": ["SUPERVISOR", "PRODUCTION", "SALES"],
  // Brigadir — veb "Brigadalar" sahifasidagi bilan bir xil ruxsat
  "employee.brigade": ["HR", "PRODUCTION", "SUPERVISOR"],
  "employee.brigade.clear": ["HR", "PRODUCTION", "SUPERVISOR"],
  "brigade.toggle": ["SUPERVISOR", "PRODUCTION", "HR"],
  // Ta'minot zanjiri — `lib/supply-actions.ts` dagi bilan bir xil bo'linish:
  // sklad so'raydi → snabjeniye narxlaydi → sotuv tasdiqlaydi → moliya pul ajratadi → snabjeniye qabul qiladi.
  // Zavodda alohida snabjeniye logini bo'lmasligi mumkin — snabjeniye amallarini WAREHOUSE ham bajaradi.
  "supply.items": ["WAREHOUSE", "PROCUREMENT", "PRODUCTION"],
  "supply.price": ["PROCUREMENT", "WAREHOUSE"],
  "supply.approve": ["SALES"],
  "supply.fund": ["FINANCE", "ACCOUNTING", "CASHIER"],
  "supply.fact": ["PROCUREMENT", "WAREHOUSE"],
  "supply.receive": ["PROCUREMENT", "WAREHOUSE"],
  "supply.reject": ["WAREHOUSE", "PROCUREMENT", "PRODUCTION", "SALES", "FINANCE", "ACCOUNTING", "CASHIER"],
  // Sayt arizalari — veb `/leads` bilan bir xil (SALES; direktor har doim)
  "lead.progress": ["SALES"],
  "lead.reopen": ["SALES"],
  "lead.reject": ["SALES"],
  "lead.convert": ["SALES"],
  "lead.note": ["SALES"],
  // Yetkazuvchini yopish/ochish — veb `/suppliers`
  "supplier.toggle": ["WAREHOUSE", "PROCUREMENT"],
};

export const can = (user: MobileUser, action: string) =>
  user.role === "DIRECTOR" || (ACTION_ROLES[action] ?? []).includes(user.role);

export async function mobileDetail(user: MobileUser, key: string, id: string): Promise<MobileDetail> {
  if (!id) throw new ListError("BAD_REQUEST", "id yo'q", 400);
  // Brigadir ilovada faqat topshiriq kartochkasini ochadi: zayavka, schyot va boshqa
  // hujjatlar unga ro'yxatda ham ko'rinmaydi, id qo'lda yuborilsa ham ochilmaydi.
  if (user.role === "BRIGADIER" && key !== "tasks") throw new ListError("FORBIDDEN", "Bu bo'limga ruxsat yo'q", 403);
  // Haydovchi ilovada faqat reys kartochkasini ochadi — vebda ham unga faqat "Mening reyslarim" ochiq
  if (user.role === "DRIVER" && key !== "trips") throw new ListError("FORBIDDEN", "Bu bo'limga ruxsat yo'q", 403);
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
    case "customers": return customerDetail(id);
    case "leads": return leadDetail(user, id);
    case "brigades": return brigadeDetail(user, id);
    case "suppliers": return supplierDetail(user, id);
    case "recipes": return recipeDetail(id);
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
      { title: "Mahsulotlar", empty: "Qator yo'q", rows: o.items.map((i) => ({ id: i.id, title: i.product.name, subtitle: `${money(sum(i.price))} / ${unitLabel(i.product.unit)}`, right: inUnit(sum(i.qtyM3), i.product.unit) })) },
      { title: "Reyslar", empty: "Reys yo'q", target: "trips", rows: o.trips.map((t) => ({ id: t.id, title: `${t.deliveryNoteNo} · ${t.vehicle.plate}`, subtitle: t.driver.fullName, right: inUnit(sum(t.qtyM3), orderUnit), status: t.status, tone: TRIP_TONE[t.status] })) },
      { title: "Zameslar", empty: "Zames yo'q", target: "production", rows: o.batches.map((b) => ({ id: b.id, title: `${b.batchNo} · ${b.product.name}`, subtitle: day(b.date), right: inUnit(sum(b.qtyM3), b.product.unit) })) },
      { title: "Schyotlar", empty: "Schyot yo'q", target: "invoices", rows: o.invoices.map((i) => ({ id: i.id, title: i.invoiceNo, subtitle: day(i.date), right: money(sum(i.amount)), status: i.status })) },
    ].filter((s) => s.rows.length > 0 || s.title === "Mahsulotlar"),
    actions,
  };
}

// ───────────────────────── Reys / nakladnoy ─────────────────────────

async function tripDetail(user: MobileUser, id: string): Promise<MobileDetail> {
  const t = await db.trip.findUnique({ where: { id }, include: { order: { include: { customer: true, items: { select: { qtyM3: true, product: { select: { unit: true } } } } } }, driver: true, vehicle: true } });
  if (!t) throw new ListError("NOT_FOUND", "Reys topilmadi", 404);
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
      if (dest) actions.push({ id: "trip.route", label: "Marshrutni ochish", tone: "brand", local: true, effect: { route: true } });
      // "Yetkazdim" obyektga yaqinlashguncha yopiq turadi — sabab tugma ostida yoziladi.
      actions.push({
        id: "trip.delivered", label: "Yetkazdim", tone: "success", form: RECEIVER_FORM, effect: { track: "stop" },
        disabled: arrival ? !arrival.near : false, hint: arrival?.reason ?? undefined,
      });
    }
  } else {
    // Logist/ishlab chiqarish: qadam o'tkazib yuborilgan reysni bir marta yopa olishi kerak,
    // shuning uchun ularda bir nechta tugma bir vaqtda ochiq turadi.
    if (t.status === "PLANNED" && can(user, "trip.loaded")) actions.push({ id: "trip.loaded", label: "Yuklandi", tone: "brand", confirm: "Beton yuklandi deb belgilansinmi? Skladdan chiqim yoziladi." });
    if (["PLANNED", "LOADED"].includes(t.status) && can(user, "trip.onroad")) actions.push({ id: "trip.onroad", label: "Yo'lga chiqdi", tone: "brand" });
    if (["PLANNED", "LOADED", "ON_ROAD"].includes(t.status) && can(user, "trip.delivered")) {
      actions.push({ id: "trip.delivered", label: "Yetkazildi", tone: "success", form: RECEIVER_FORM });
    }
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
      { label: "Manzil", value: t.order.deliveryAddress },
      { label: "Zayavka", value: t.order.orderNo },
      ...(track ? [{ label: "Yurilgan yo'l", value: `${distanceLabel(track.meters)}${track.minutes > 0 ? ` · ${track.minutes} daq` : ""}`, tone: "brand" as Tone }] : []),
      ...(arrival?.remainingM != null ? [{ label: "Obyektgacha", value: distanceLabel(arrival.remainingM), tone: (arrival.near ? "success" : "info") as Tone }] : []),
      ...(t.loadedAt ? [{ label: "Yuklandi", value: dt(t.loadedAt) }] : []),
      ...(t.deliveredAt ? [{ label: "Yetkazildi", value: dt(t.deliveredAt) }] : []),
      ...(t.receiverName ? [{ label: "Qabul qildi", value: t.receiverName }] : []),
      ...(t.ecoStatus ? [{ label: "Haydovchi ilovasi", value: ecoLabel(t.ecoStatus)?.label ?? t.ecoStatus, tone: "info" as Tone }] : []),
      ...(t.ecoSyncedAt ? [{ label: "ECO sinxron", value: dt(t.ecoSyncedAt) }] : []),
      ...(t.ecoError ? [{ label: "ECO xatosi", value: t.ecoError, tone: "danger" as Tone }] : []),
      ...(t.note ? [{ label: "Izoh", value: t.note }] : []),
    ],
    sections: [await stepsSection(t.id)],
    actions,
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

  return {
    key: "invoices", id: inv.id, title: inv.invoiceNo, subtitle: inv.customer.name, status: inv.status,
    fields: [
      { label: "Sana", value: day(inv.date) },
      { label: "Jami", value: money(sum(inv.amount)) },
      { label: "To'landi", value: money(paid), tone: "success" },
      { label: "Qoldiq", value: money(left), tone: left > 0 ? "danger" : "success" },
      ...(inv.order ? [{ label: "Zayavka", value: inv.order.orderNo }] : []),
    ],
    sections: [{ title: "To'lovlar", empty: "To'lov yo'q", target: "payments", rows: inv.payments.map((p) => ({ id: p.id, title: money(sum(p.amount)), subtitle: `${day(p.date)} · ${p.cashAccount.name}`, tone: "success" as Tone })) }],
    actions,
  };
}

// ───────────────────────── Qolganlari — faqat ko'rish ─────────────────────────

async function paymentDetail(id: string): Promise<MobileDetail> {
  const p = await db.payment.findUnique({ where: { id }, include: { customer: true, cashAccount: true, invoice: true, order: true } });
  if (!p) throw new ListError("NOT_FOUND", "To'lov topilmadi", 404);
  return {
    key: "payments", id: p.id, title: money(sum(p.amount)), subtitle: p.customer.name,
    fields: [
      { label: "Sana", value: dt(p.date) },
      { label: "Hisob", value: p.cashAccount.name },
      ...(p.invoice ? [{ label: "Schyot", value: p.invoice.invoiceNo }] : []),
      ...(p.order ? [{ label: "Zayavka", value: p.order.orderNo }] : []),
      ...(p.note ? [{ label: "Izoh", value: p.note }] : []),
    ],
    sections: [], actions: [],
  };
}

async function receiptDetail(id: string): Promise<MobileDetail> {
  const r = await db.goodsReceipt.findUnique({ where: { id }, include: { supplier: true, warehouse: true, createdBy: true, items: { include: { material: true } } } });
  if (!r) throw new ListError("NOT_FOUND", "Kirim topilmadi", 404);
  const total = r.items.reduce((s, i) => s + sum(i.qty) * sum(i.price), 0);
  return {
    key: "receipts", id: r.id, title: r.docNo, subtitle: r.supplier.name,
    fields: [
      { label: "Sana", value: day(r.date) },
      { label: "Ombor", value: r.warehouse.name },
      { label: "Jami", value: money(total) },
      ...(r.createdBy ? [{ label: "Kim kiritdi", value: r.createdBy.fullName }] : []),
      ...(r.note ? [{ label: "Izoh", value: r.note }] : []),
    ],
    sections: [{ title: "Qatorlar", empty: "Qator yo'q", rows: r.items.map((i) => ({ id: i.id, title: i.material.name, subtitle: `${money(sum(i.price))} / ${i.material.unit}`, right: `${sum(i.qty)} ${i.material.unit}` })) }],
    actions: [],
  };
}

async function taskDetail(user: MobileUser, id: string): Promise<MobileDetail> {
  const t = await db.brigadeTask.findUnique({
    where: { id },
    include: { brigade: true, order: { include: { customer: true } }, orderItem: { include: { product: true } }, progress: { orderBy: { date: "desc" }, include: { createdBy: true } } },
  });
  if (!t) throw new ListError("NOT_FOUND", "Topshiriq topilmadi", 404);
  // Brigadirga faqat o'z brigadasining topshirig'i. Reysdagidek "topilmadi" deymiz:
  // "ruxsat yo'q" desak, begona topshiriq mavjudligini tasdiqlagan bo'lardik.
  if (user.role === "BRIGADIER" && !(await myBrigadeIds(user.id)).includes(t.brigadeId)) {
    throw new ListError("NOT_FOUND", "Topshiriq topilmadi", 404);
  }
  const left = sum(t.qty) - sum(t.doneQty);
  const open = !["DONE", "CANCELLED"].includes(t.status);

  const actions: DetailAction[] = [];
  if (open && can(user, "task.progress")) {
    actions.push({
      id: "task.progress", label: "Bajarilgan miqdorni qayd qilish", tone: "success",
      form: [
        { name: "qty", label: `Miqdor (${unitLabel(t.orderItem.product.unit)}) — qoldiq ${left.toFixed(1)}`, type: "number", required: true, value: String(left) },
        { name: "note", label: "Izoh", type: "text" },
      ],
    });
  }
  if (open && can(user, "task.cancel")) actions.push({ id: "task.cancel", label: "Bekor qilish", tone: "danger", confirm: "Topshiriq bekor qilinsinmi?" });

  return {
    key: "tasks", id: t.id, title: t.taskNo, subtitle: `${t.brigade.name} · ${t.order.customer.name}`, status: t.status,
    fields: [
      { label: "Mahsulot", value: t.orderItem.product.name },
      { label: "Topshiriq", value: inUnit(sum(t.qty), t.orderItem.product.unit) },
      { label: "Bajarildi", value: `${inUnit(sum(t.doneQty), t.orderItem.product.unit)} / ${inUnit(sum(t.qty), t.orderItem.product.unit)}`, tone: left <= 0 ? "success" : "warning" },
      { label: "Qoldiq", value: inUnit(left, t.orderItem.product.unit), tone: left > 0 ? "warning" : "success" },
      { label: "Muddat", value: day(t.dueDate), tone: open && t.dueDate < new Date() ? "danger" : undefined },
      { label: "Zayavka", value: t.order.orderNo },
      ...(t.note ? [{ label: "Izoh", value: t.note }] : []),
    ],
    sections: [{
      title: "Bajarilganlik qaydlari", empty: "Hali qayd yo'q",
      rows: t.progress.map((p) => ({ id: p.id, title: inUnit(sum(p.qty), t.orderItem.product.unit), subtitle: `${day(p.date)} · ${p.createdBy.fullName}${p.note ? ` · ${p.note}` : ""}`, tone: "success" as Tone })),
    }],
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
      title: "Sarflangan xomashyo / mahsulot", empty: "Retsept bo'sh",
      rows: b.recipe.items.map((i) => { const ing = ingredientOf(i); return { id: i.id, title: ing.name, subtitle: `${sum(ing.qtyPerM3)} ${ing.unit} / ${unitLabel(b.product.unit)}`, right: `${(ing.qtyPerM3 * sum(b.qtyM3)).toFixed(1)} ${ing.unit}` }; }),
    }],
    actions: [],
  };
}

async function materialDetail(id: string): Promise<MobileDetail> {
  const m = await db.material.findUnique({ where: { id } });
  if (!m) throw new ListError("NOT_FOUND", "Xomashyo topilmadi", 404);
  const [agg, moves] = await Promise.all([
    db.stockMove.aggregate({ where: { materialId: id }, _sum: { qty: true } }),
    db.stockMove.findMany({ where: { materialId: id }, orderBy: { date: "desc" }, take: 20, include: { createdBy: true } }),
  ]);
  const balance = sum(agg._sum.qty);
  const MOVE_LABEL: Record<string, string> = { RECEIPT: "Kirim", PRODUCTION_CONSUME: "Ishlab chiqarishga", SHIPMENT: "Chiqim", ADJUSTMENT: "Tuzatish", WRITE_OFF: "Hisobdan chiqarish", TRANSFER: "Ko'chirish" };
  return {
    key: "stock", id: m.id, title: m.name, subtitle: m.code,
    fields: [
      { label: "Qoldiq", value: `${balance.toFixed(1)} ${m.unit}`, tone: balance < sum(m.minStock) ? "danger" : "success" },
      { label: "Minimum", value: `${sum(m.minStock)} ${m.unit}` },
      { label: "Holat", value: m.isActive ? "Faol" : "Nofaol" },
    ],
    sections: [{
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
  return {
    key: "cashflow", id: t.id, title: `${t.type === "EXPENSE" ? "−" : "+"}${money(sum(t.amount))}`, subtitle: t.category,
    fields: [
      { label: "Sana", value: day(t.date) },
      { label: "Turi", value: t.type === "EXPENSE" ? "Chiqim" : "Kirim", tone: t.type === "EXPENSE" ? "danger" : "success" },
      { label: "Hisob", value: t.cashAccount.name },
      ...(t.counterparty ? [{ label: "Kimga / kimdan", value: t.counterparty }] : []),
      ...(t.supplier ? [{ label: "Yetkazuvchi", value: t.supplier.name }] : []),
      { label: "Kim kiritdi", value: t.createdBy.fullName },
      ...(t.note ? [{ label: "Izoh", value: t.note }] : []),
    ],
    sections: [], actions: [],
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
  if (isOpenSupply(st) && can(user, "supply.reject")) {
    actions.push({ id: "supply.reject", label: "Bekor qilish", tone: "danger", form: [{ name: "reason", label: "Sabab", type: "text", required: true, placeholder: "Nega bekor qilinmoqda" }] });
  }

  const STAGE_LABEL = Object.fromEntries(SUPPLY_STEPS.map((s) => [s.key, s.label])) as Record<string, string>;
  const delivery = r.deliveryKind ? `${r.deliveryKind}${r.deliveryProvider ? ` · ${r.deliveryProvider}` : ""}${sum(r.deliveryCost) ? ` · ${money(sum(r.deliveryCost))}` : ""}` : null;

  return {
    key: "supply", id: r.id, title: r.docNo, subtitle: r.warehouse.name, status: SUPPLY_LABEL[st],
    fields: [
      { label: "Bosqich", value: SUPPLY_OWNER[st], tone: SUPPLY_TONE[st] },
      { label: "Sana", value: day(r.date) },
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
      { title: "Mahsulotlar", empty: "Qator yo'q", rows: items },
      { title: "Bosqichlar", empty: "Hali bosqich yozilmagan", rows: r.events.map((e) => ({ id: e.id, title: STAGE_LABEL[e.stage] ?? SUPPLY_LABEL[e.stage], subtitle: `${e.user.fullName}${e.note ? ` · ${e.note}` : ""}`, right: shortDt(e.createdAt), tone: SUPPLY_TONE[e.stage] })) },
      ...(r.receipt ? [{ title: "Kirim hujjati", empty: "", target: "receipts", rows: [{ id: r.receipt.id, title: r.receipt.docNo, subtitle: "Skladga kirim", tone: "success" as Tone }] }] : []),
    ],
    actions,
  };
}

// ───────────────────────── Mijoz ─────────────────────────

async function customerDetail(id: string): Promise<MobileDetail> {
  const c = await db.customer.findUnique({
    where: { id },
    include: {
      orders: { where: { kind: "SALE" }, orderBy: { date: "desc" }, take: 10, include: { items: { include: { product: true } } } },
      invoices: { where: { status: { in: ["OPEN", "PARTIAL"] } }, orderBy: { date: "asc" }, include: { payments: true } },
    },
  });
  if (!c) throw new ListError("NOT_FOUND", "Mijoz topilmadi", 404);
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
      { title: `Tarkib — 1 ${unit} uchun`, empty: "Retsept bo'sh", rows: (active?.items ?? []).map((i) => { const ing = ingredientOf(i); return { id: i.id, title: ing.name, subtitle: ing.kind === "product" ? "yarim tayyor mahsulot" : "xomashyo", right: `${ing.qtyPerM3} ${ing.unit}` }; }) },
      ...(p.recipes.length > 1 ? [{ title: "Versiyalar tarixi", empty: "", rows: p.recipes.map((r) => ({ id: r.id, title: `v${r.version}`, subtitle: `${day(r.createdAt)} · ${r.items.length} tarkib · ${r._count.batches} zames`, status: r.isActive ? "Amalda" : "Eski", tone: (r.isActive ? "success" : "info") as Tone })) }] : []),
    ],
    actions: [],
  };
}
