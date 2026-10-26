import { z } from "zod";
import { ALL_STAFF } from "./hr-access";
import { KADR_CREATE, KADR_CREATE_PERM } from "./kadr-access";
import { kadrAriza, kadrCreate, kadrForm, kadrRequestForm } from "./kadr-extra";
import { createRequestMobile, requestForm } from "./hr";
import { createTaskMobile, taskForm } from "./hr-work";
import { createFeedbackMobile, feedbackForm } from "./hr-voice";
import { driverPositionNames } from "@/lib/positions";
import { db } from "@/lib/db";
import { productCatalog, groupPath } from "@/lib/product-catalog";
import { createOrder } from "@/lib/orders";
import { createTrip, READINESS_INCLUDE, orderReadiness } from "@/lib/trips";
import { customersCredit, blacklistedIds, customerMarks, markedName, defaultCreditLimit } from "@/lib/finance";
import { ADVANCE_ORDER_STATUSES, accountBalances, addPayment, expectedAdvance } from "@/lib/payments";
import { createCashEntry } from "@/lib/cash-entry";
import { createTransfer } from "@/lib/cash-transfer";
import { TRANSFER_REF } from "@/lib/cash-tx";
import { categoryOptions } from "@/lib/fin-report/categories";
import { unpaidReceipts } from "@/lib/receipt-payables";
import { MAX_AMOUNT } from "@/lib/action";
import { date as day } from "@/lib/format";
import { pushTripToEco } from "@/lib/eco/sync";
import { ecoEnabled, normalizePhone } from "@/lib/eco/client";
import { syncCustomerLater } from "@/lib/eco/customers";
import { audit } from "@/lib/audit";
import { createSupplyRequest } from "@/lib/supply";
import { DEPARTMENTS, PRIORITIES, PRIORITY_LABEL } from "@/lib/procurement-const";
import type { MobileUser } from "./auth";
import type { DayCell, FormField, FormOption } from "./detail";
import { ListError } from "./list";
import { MATERIAL_UNITS, unitLabel, unitShort } from "@/lib/unit";
import { codeFromName } from "@/lib/excel";
import { canDo } from "@/lib/permissions";
import { dateRu, fmtNum } from "@/lib/format";
import { createGoodsReceipt, receiptNote, receiptTokenOf } from "@/lib/receipts";
import { scanAllowed, scanEnabled } from "./scan";
import { ISSUE_STORNO, IssueError, issueDate, issueStock, issueToken, parseIssueTarget, type IssueTarget } from "@/lib/stock-issue";
import { activeRecipients, brigadeLabel, issueTargetOptions } from "@/lib/stock-recipients";
import { issuePrices } from "@/lib/stock-price";
import { STOCK_EPS } from "@/lib/stock-lock";
import { createMechanicRequest, FACTORY_OBJECTS, FACTORY_PROBLEMS, PROBLEMS } from "@/lib/mechanic-requests";
import { capText, VEHICLE_TYPE } from "@/lib/logistics";
import { dataUrlFile } from "@/lib/procurement";
import type { Role } from "@/generated/prisma";
import { arendaChiqimForm, arendaCreate, arendaKirimForm, arendaShopForm } from "./arenda";
import { SKLAD_CREATE_PERM, SKLAD_CREATE_ROLES, SKLAD_FORMS } from "./sklad-extra-access";
import { prixodExtraFields, skladCreate, skladForm } from "./sklad-extra";
import { payrollCreate, payrollForm } from "./moliya-extra";
import { batchForm, createBatchMobile } from "./sex-extra";
import { LOGI_CREATE } from "./logistika-access";
import { LOGI_FORMS, logiCreate, logiForm, plannedAtOf, plannedExtra, plannedFields } from "./logistika-extra";
import { saveBrigade } from "@/lib/brigades";
import { SOTUV_CREATE_PERM, SOTUV_CREATE_ROLES } from "./sotuv-access";
import { applyFormDefaults, leadOrderPrefill, offerForm, sotuvCreate, splitFormKey, stockOrderForm } from "./sotuv-extra";
import { withNds } from "@/lib/nds";
import { saveContractFile } from "@/lib/uploads";
import { orderTotal } from "@/lib/order-total";

const WEEKDAYS = ["Yak", "Dush", "Sesh", "Chor", "Pay", "Jum", "Shan"];
const isoDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/**
 * 10 kunlik ish tartibi — veb `orders/load-calendar.tsx` bilan bir xil hisob, faqat
 * ro'yxatsiz (mobilda kartochka ochilmaydi, faqat rang va hajm — sana tanlashda yo'l ko'rsatadi).
 * Kunlik limit: m³ (sukut 200) va dona — Zayavkalar taqvimi (direktor) yoki Sozlamalar → Limitlar.
 */
async function dayCells(days = 10): Promise<DayCell[]> {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const until = new Date(today); until.setDate(until.getDate() + days);
  const [orders, settings] = await Promise.all([
    db.order.findMany({
      where: { status: { not: "CANCELLED" }, deliveryDate: { gte: today, lt: until } },
      select: { deliveryDate: true, items: { select: { qtyM3: true, product: { select: { unit: true } } } } },
    }),
    db.companySettings.findUnique({ where: { id: "main" }, select: { dailyCapacityM3: true, dailyCapacityPcs: true } }),
  ]);
  const capacity = Math.max(1, Number(settings?.dailyCapacityM3 ?? 200));
  // Dona limiti ixtiyoriy: belgilanmagan bo'lsa rangga ta'sir qilmaydi, faqat jami dona yuboriladi
  const capPcs = settings?.dailyCapacityPcs && settings.dailyCapacityPcs > 0 ? settings.dailyCapacityPcs : null;
  const byDay = new Map<string, { m3: number; pcs: number; count: number }>();
  for (const o of orders) {
    const key = isoDate(o.deliveryDate);
    // Beton (m³) va dona mahsulot (ustun, blok) — har biri o'z kunlik limitiga nisbatan
    const m3 = o.items.reduce((s, i) => s + (i.product.unit === "m3" ? Number(i.qtyM3) : 0), 0);
    const pcs = o.items.reduce((s, i) => s + (i.product.unit === "dona" ? Number(i.qtyM3) : 0), 0);
    const cur = byDay.get(key) ?? { m3: 0, pcs: 0, count: 0 };
    byDay.set(key, { m3: cur.m3 + m3, pcs: cur.pcs + pcs, count: cur.count + 1 });
  }
  return Array.from({ length: days }, (_, n) => {
    const d = new Date(today); d.setDate(d.getDate() + n);
    const key = isoDate(d);
    const day = byDay.get(key) ?? { m3: 0, pcs: 0, count: 0 };
    const pctM3 = Math.min(100, (day.m3 / capacity) * 100);
    const pctPcs = capPcs ? Math.min(100, (day.pcs / capPcs) * 100) : 0;
    return {
      key, label: n === 0 ? "Bugun" : n === 1 ? "Ertaga" : `${d.getDate()}.${String(d.getMonth() + 1).padStart(2, "0")}`,
      // pct — ikkala limitdan qaysi biri ko'proq to'lgan bo'lsa (veb taqvim bilan bir xil); eski ilova faqat shuni ko'radi
      weekday: WEEKDAYS[d.getDay()], m3: day.m3, pcs: day.pcs, capM3: capacity, capPcs, pct: Math.max(pctM3, pctPcs), count: day.count, isToday: n === 0,
    };
  });
}

/**
 * Mobil ilovada yangi hujjat ochish: forma tavsifi serverdan keladi, ilova uni chizadi.
 *
 * Shu sababli tanlov ro'yxatlari (mijozlar, mahsulotlar, mikserlar, haydovchilar) har doim
 * dolzarb bo'ladi va qoidalar (qora ro'yxat, qoldiq, sig'im) bitta joyda — `lib/orders.ts`,
 * `lib/trips.ts` da — tekshiriladi.
 */
/**
 * `scan` — formaning tepasida «Nakladnoyni skanerlash» tugmasi: ilova suratni shu yo'lga yuboradi va
 * qaytgan `values` ni formaga qo'yadi (`lib/mobile/scan.ts`). Eski ilova bu maydonni e'tiborsiz qoldiradi.
 */
export type CreateForm = { key: string; title: string; submitLabel: string; fields: FormField[]; scan?: { path: string; label: string; hint: string } };

/** Kim qaysi hujjatni ocha oladi — veb ERP bilan bir xil. */
export const CREATE_ROLES: Record<string, { roles: Role[]; title: string; label: string }> = {
  // AGENT ham zayavka ochadi, lekin faqat o'z mijoziga (ownership `mobileCreate` da tekshiriladi)
  orders: { roles: ["SALES", "AGENT"], title: "Yangi zayavka", label: "Zayavka ochish" },
  trips: { roles: ["LOGISTICS", "PRODUCTION"], title: "Yangi reys", label: "Reys ochish" },
  // Ta'minot so'rovi — sklad kerakli mahsulotlar jadvalini tuzadi (veb `/stock/supply/new`); mexanik ham
  // texnika uchun kerakli narsani snabjeniyega shu forma bilan so'raydi (bo'lim — «Texnika»)
  supply: { roles: ["WAREHOUSE", "PROCUREMENT", "PRODUCTION", "MECHANIC"], title: "Ta'minot so'rovi", label: "Ta'minot so'rash" },
  // Buxgalteriya kabinetida Mijozlar bo'limi yo'q — mijozni Sotuv qo'shadi
  customers: { roles: ["SALES", "FINANCE"], title: "Yangi mijoz", label: "Mijoz qo'shish" },
  suppliers: { roles: ["WAREHOUSE", "PROCUREMENT", "ACCOUNTING"], title: "Yangi yetkazuvchi", label: "Yetkazuvchi qo'shish" },
  // Xomashyo spravochnigiga yangi nom — ta'minot so'rovidagi xomashyo tanlovining "+" tugmasi ham shu kalitga yuboradi
  materials: { roles: ["WAREHOUSE", "PROCUREMENT", "PRODUCTION"], title: "Yangi xomashyo", label: "Xomashyo qo'shish" },
  brigades: { roles: ["SUPERVISOR", "PRODUCTION", "HR"], title: "Yangi brigada", label: "Brigada ochish" },
  // Sklad (zaxira) zayavkasi va tijorat taklifi (`./sotuv-access.ts`) — rolning "+" tugmasi o'zgarmasin deb shu yerda
  ...SOTUV_CREATE_ROLES,
  // Zames (partiya) — veb `/production/new` (ishlab chiqarish; qoida `lib/production-batch.ts`, `./sex-extra.ts`)
  // Direktor ham zames yozadi — vebdagidek (egasi qarori, 2026-10-18)
  production: { roles: ["PRODUCTION", "DIRECTOR"], title: "Yangi zames", label: "Zames yozish" },
  // Kassa: veb `/payments` va `/cashflow` formalari bilan bir xil qoida (`lib/payments.ts`, `lib/cash-entry.ts`,
  // `lib/cash-transfer.ts`). Rol ro'yxati — kim formani ko'rishi mumkinligi; aniq ruxsat `CREATE_PERM` (strict) da.
  payments: { roles: ["CASHIER", "ACCOUNTING", "FINANCE"], title: "To'lov qabul qilish", label: "To'lov qabul qilish" },
  cashflow: { roles: ["CASHIER", "ACCOUNTING", "FINANCE"], title: "Kirim / chiqim", label: "Kirim / chiqim" },
  transfer: { roles: ["CASHIER", "ACCOUNTING", "FINANCE"], title: "Kassa ⇄ bank o'tkazma", label: "Kassa ⇄ bank" },
  // Sklad → «Kirim» / «Chiqim» (veb Sklad ekranlaridagidek). Qoida `lib/receipts.ts` va `lib/stock-issue.ts` da.
  // ISTISNO: quyidagi «direktor hujjat ochmaydi» qoidasidan — foydalanuvchi direktorga ham ilovadan kiritishni aniq so'ragan
  // (vebda ham `requireAction("stock", "receipt" | "issue")` direktorni o'tkazadi). Ro'yxat oxirida: "+" tugmasi tanlovi o'zgarmasin.
  prixod: { roles: ["WAREHOUSE", "PROCUREMENT", "DIRECTOR"], title: "Yangi kirim", label: "Kirim" },
  rasxod: { roles: ["WAREHOUSE", "PROCUREMENT", "DIRECTOR"], title: "Yangi chiqim", label: "Chiqim" },
  // Mexanik so'rovi ("Kirim") — pul so'rash: ish boshqaruvchi tasdiqlaydi, kassa beradi (`lib/mechanic-requests.ts`).
  // ECO ilovasi ularni o'zining Kirim ekranidan ochadi (`/erp/new/<key>`) — bosh sahifa to'rida yo'q (`KIRIM_FORMS`)
  "kirim-transport": { roles: ["MECHANIC"], title: "Transport uchun so'rov", label: "Transport uchun so'rov" },
  "kirim-zavod": { roles: ["MECHANIC"], title: "Zavod uchun so'rov", label: "Zavod uchun so'rov" },
  "kirim-boshqa": { roles: ["MECHANIC"], title: "Boshqa xarajat so'rovi", label: "Boshqa xarajat so'rovi" },
  // Arenda (do'konlar ijarasi, `./arenda.ts`) — sekretar; veb `/arenda` formalari bilan bir xil qoida (`lib/rent.ts`)
  "arenda-kirim": { roles: ["SECRETARY"], title: "Arenda kirimi", label: "Arenda kirimi" },
  "arenda-chiqim": { roles: ["SECRETARY"], title: "Arenda chiqimi", label: "Arenda chiqimi" },
  "arenda-shop": { roles: ["SECRETARY"], title: "Yangi do'kon", label: "Do'kon qo'shish" },
  // Logistika: transport, zapravka, xarajat, obyekt (`./logistika-extra.ts`, qoida `lib/logistics-admin.ts`)
  ...Object.fromEntries(Object.entries(LOGI_CREATE).map(([k, v]) => [k, { roles: v.roles, title: v.title, label: v.label }])),
  // Xodim arizasi (ta'til, kasallik, avans…) — har bir xodim o'zi uchun (`./hr.ts`). Oxirida: rolning "+" tugmasi o'zgarmasin
  ariza: { roles: ALL_STAFF, title: "Ariza yuborish", label: "Ariza yuborish" },
  // Vazifa — o'ziga yoki (huquqi bo'lsa) boshqa xodimga (`lib/hr/tasks.ts`)
  vazifa: { roles: ALL_STAFF, title: "Yangi vazifa", label: "Vazifa yozish" },
  // Otdel kadrga murojaat (HR chat) — anonim bo'lishi mumkin (`lib/hr/voice.ts`)
  murojaat: { roles: ALL_STAFF, title: "Otdel kadrga murojaat", label: "Murojaat yozish" },
  // Ish haqi vedomosti — oy + tur bo'yicha hisoblash (veb «Ish haqi» → «Hisoblash», `lib/hr/payroll.ts` → `calculateRun`); `./moliya-extra.ts`
  "ish-haqi": { roles: ["HR", "ACCOUNTING"], title: "Ish haqini hisoblash", label: "Ish haqini hisoblash" },
  // Otdel kadr kabineti: xodim qo'shish, jarima/bonus, vakansiya, nomzod, ommaviy xabar, kechikish jarimasi (`./kadr-extra.ts`)
  ...KADR_CREATE,
  // Sklad: tayyor mahsulot qo'shish, inventarizatsiya, hisobdan chiqarish, «Kimga» oluvchisi (`./sklad-extra.ts`)
  ...SKLAD_CREATE_ROLES,
};

/** Mexanik so'rovi formalari — bosh sahifadagi "+" va tezkor amallar to'rida ko'rsatilmaydi (ilova o'z ekranidan ochadi). */
export const KIRIM_FORMS: ReadonlySet<string> = new Set(["kirim-transport", "kirim-zavod", "kirim-boshqa"]);

// Direktor hujjat ochmaydi — zayavka sotuvchining, reys dispetcherning ishi; u nazorat qiladi (istisno: prixod/rasxod, yuqorida).
// Direktor bergan ruxsat (`User.perms`) vebdagi kabi ishlaydi: modul "yo'q"/"ko'rish" yoki amal ro'yxatda bo'lmasa — forma ham,
// yaratish ham rad etiladi; amal berilgan bo'lsa — rol ro'yxatida bo'lmasa ham ochadi (masalan Ish boshqaruvchi zayavka ochadi).
// `strict` — vebdagi `requireAction(module, action)` bilan aynan bir xil: `canDo` (rol standarti + direktor ruxsati).
// Masalan Moliya (FINANCE) vebda to'lov qabul qilmaydi — ilovada ham, direktor `payments: create` bermaguncha.
const CREATE_PERM: Record<string, { module: string; action?: string; strict?: boolean }> = {
  ...KADR_CREATE_PERM,
  orders: { module: "orders", action: "create" },
  trips: { module: "trips", action: "create" },
  supply: { module: "taminot" },
  customers: { module: "customers", action: "edit" },
  suppliers: { module: "stock", action: "suppliers" },
  materials: { module: "stock", action: "import", strict: true }, // veb «Xomashyo qo'shish» (`importMaterials`) bilan bir xil
  brigades: { module: "tasks", action: "brigade" },
  production: { module: "production", action: "batch", strict: true },
  payments: { module: "payments", action: "create", strict: true },
  cashflow: { module: "cashflow", action: "create", strict: true },
  transfer: { module: "cashflow", action: "transfer", strict: true },
  prixod: { module: "stock", action: "receipt", strict: true },
  rasxod: { module: "stock", action: "issue", strict: true },
  "kirim-transport": { module: "mexanik" },
  "kirim-zavod": { module: "mexanik" },
  "kirim-boshqa": { module: "mexanik" },
  "arenda-kirim": { module: "arenda", action: "create", strict: true },
  "arenda-chiqim": { module: "arenda", action: "create", strict: true },
  "arenda-shop": { module: "arenda", action: "shops", strict: true },
  // Logistika — veb `requireAction("logistika", …)` bilan aynan bir xil
  ...Object.fromEntries(Object.entries(LOGI_CREATE).map(([k, v]) => [k, { ...v.perm, strict: true }])),
  "ish-haqi": { module: "payroll", action: "calc", strict: true },
  ...SKLAD_CREATE_PERM,
  ...SOTUV_CREATE_PERM,
};

export const canCreate = (user: MobileUser, key: string) => {
  if (!Object.hasOwn(CREATE_ROLES, key)) return false; // prototip kalitlari ("constructor") — forma emas
  const roleOk = CREATE_ROLES[key].roles.includes(user.role);
  const p = CREATE_PERM[key];
  const lvl = p && user.perms?.[p.module];
  if (!p || !lvl) { // direktor bu modulga alohida ruxsat bermagan — rol bo'yicha
    if (!roleOk) return false;
    return p?.strict && p.action ? canDo({ role: user.role, perms: user.perms }, p.module, p.action) : true;
  }
  if (lvl === "none" || lvl === "view") return false;
  // Direktor bergan ruxsat rol ro'yxatidan USTUN — vebdagi `requireAction` bilan bir xil: Ish boshqaruvchiga
  // Zayavkalarda "To'liq" yoki "Mijoz zayavkasini ochish" berilsa, ilovada ham zayavka ochadi.
  if (p.action) return canDo({ role: user.role, perms: user.perms }, p.module, p.action);
  return lvl === "write" || roleOk;
};

const NEW_CUSTOMER = "__new__";
const money = (n: number) => `${Math.round(n).toLocaleString("ru-RU")} so'm`;
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// ───────────────────────── Forma tavsifi ─────────────────────────

/**
 * Kalit oldindan to'ldirish parametrlarini olib kelishi mumkin: `orders~customerId=<id>~lead=<id>` (kartochkadagi
 * «Zayavka ochish»). Forma asosiy kalit bilan quriladi, parametr — shu nomli maydonning boshlang'ich qiymati (`./sotuv-extra.ts`).
 */
export async function mobileForm(user: MobileUser, rawKey: string): Promise<CreateForm> {
  const { key, defaults } = splitFormKey(rawKey);
  return applyFormDefaults(await formOf(user, key, defaults), defaults);
}

async function formOf(user: MobileUser, key: string, defaults: Record<string, string>): Promise<CreateForm> {
  if (!Object.hasOwn(CREATE_ROLES, key)) throw new ListError("UNKNOWN_FORM", "Bunday forma yo'q", 404);
  if (!canCreate(user, key)) throw new ListError("FORBIDDEN", "Bu hujjatni ochishga ruxsatingiz yo'q", 403);
  switch (key) {
    case "prixod": {
      const f = await prixodForm(user);
      return scanEnabled() && scanAllowed(user)
        ? { ...f, scan: { path: "/scan/receipt", label: "Nakladnoyni skanerlash", hint: "Suratga oling — yetkazuvchi, TTN va xomashyo qatorlari o'zi to'ldiriladi, siz tekshirasiz" } }
        : f;
    }
    case "rasxod": return rasxodForm();
    case "production": return batchForm();
    case "orders": return orderForm(user, defaults);
    case "stock-order": return stockOrderForm();
    case "offers": return offerForm(defaults);
    case "trips": return tripForm();
    case "supply": return supplyForm(user);
    case "customers": return customerForm();
    case "suppliers": return supplierForm();
    case "materials": return materialForm();
    case "payments": return paymentForm();
    case "cashflow": return cashForm();
    case "transfer": return transferForm();
    case "kirim-transport": return kirimTransportForm();
    case "kirim-zavod": return kirimZavodForm();
    case "kirim-boshqa": return kirimBoshqaForm();
    // Otdel kadr — boshida «Kim uchun» (xodim nomidan ariza, veb `createRequestForEmployee`)
    case "ariza": return kadrRequestForm(user, requestForm());
    case "vazifa": return taskForm(user);
    case "murojaat": return feedbackForm();
    case "arenda-kirim": return arendaKirimForm();
    case "arenda-chiqim": return arendaChiqimForm();
    case "arenda-shop": return arendaShopForm();
    case "vehicles": case "fuel": case "expenses": case "sites": return logiForm(user, key);
    case "ish-haqi": return payrollForm();
    case "products": case "inventory": case "writeoff": case "recipient": return skladForm(user, key);
    case "employees": case "jarima-bonus": case "vakansiyalar": case "nomzodlar": case "xabar": case "davomat-sozlama": return kadrForm(user, key);
    default: return brigadeForm();
  }
}

// ───────────────────────── Kassa: to'lov, kirim/chiqim, o'tkazma ─────────────────────────

/** Oxirgi 7 kun — sana tanlovi (ilovadagi sana chiplari faqat kelajakni ko'rsatadi, kassaga o'tgan kun kerak). */
function recentDays(): FormOption[] {
  return Array.from({ length: 7 }, (_, n) => {
    const d = new Date(); d.setDate(d.getDate() - n);
    return { value: ymd(d), label: n === 0 ? "Bugun" : n === 1 ? "Kecha" : `${d.getDate()}.${String(d.getMonth() + 1).padStart(2, "0")} · ${WEEKDAYS[d.getDay()]}` };
  });
}
const dateField = (): FormField => ({ name: "date", label: "Sana", type: "select", required: true, value: ymd(new Date()), options: recentDays() });

/** Kassa/bank hisoblari — qoldig'i bilan (chiqim qoldiqdan oshmasin, kassir oldindan ko'rsin). */
async function cashAccountOptions(): Promise<{ options: FormOption[]; cash?: string; bank?: string }> {
  const [accounts, bal] = await Promise.all([
    db.cashAccount.findMany({ where: { isActive: true }, orderBy: [{ type: "asc" }, { name: "asc" }] }),
    accountBalances(),
  ]);
  return {
    options: accounts.map((a) => ({ value: a.id, label: `${a.name} · ${a.type === "CASH" ? "naqd kassa" : "bank"}`, hint: `qoldiq ${money(bal.get(a.id) ?? 0)}${a.type === "BANK" && a.allowOverdraft ? " · overdraft ruxsat" : ""}` })),
    cash: accounts.find((a) => a.type === "CASH")?.id ?? accounts[0]?.id,
    bank: accounts.find((a) => a.type === "BANK")?.id,
  };
}

/** To'lov usuli — `Payment`da alohida ustun yo'q: izohga yoziladi ("Usul: Plastik karta"). */
const PAY_METHODS = ["Naqd", "Plastik karta", "Bank o'tkazmasi", "Click / Payme"] as const;

/**
 * To'lov qabul qilish — veb `/payments` formasi bilan bir xil: mijoz, (ixtiyoriy) ochiq schyot — boshlang'ich
 * qarz (BQ-…) ham — yoki schyoti yo'q zayavka avansi; hech biri tanlanmasa — taqsimlanmagan avans.
 * Schyot/zayavka mijozga bog'liq (`dependsOn`); moslikni `addPayment` baribir tekshiradi.
 */
async function paymentForm(): Promise<CreateForm> {
  const [customers, invoices, orders, acc] = await Promise.all([
    db.customer.findMany({ where: { isActive: true, isInternal: false }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    // Eng eski schyot birinchi — kassir FIFO bo'yicha yopadi
    db.invoice.findMany({ where: { status: { in: ["OPEN", "PARTIAL"] } }, orderBy: [{ date: "asc" }, { createdAt: "asc" }], include: { payments: { select: { amount: true } }, customer: { select: { name: true } } } }),
    db.order.findMany({
      where: { kind: "SALE", status: { in: [...ADVANCE_ORDER_STATUSES] }, invoices: { none: { status: { not: "CANCELLED" } } }, customer: { isInternal: false } },
      orderBy: { date: "asc" },
      select: { id: true, orderNo: true, customerId: true, prepayAmount: true, customer: { select: { name: true } }, deliveryFee: true, items: { select: { qtyM3: true, price: true } }, payments: { where: { invoiceId: null }, select: { amount: true } } },
    }),
    cashAccountOptions(),
  ]);
  const marks = await customerMarks(customers.map((c) => c.id));
  const debt = new Map<string, number>();
  const invOpts: FormOption[] = invoices.map((i) => {
    const left = Number(i.amount) - i.payments.reduce((s, p) => s + Number(p.amount), 0);
    debt.set(i.customerId, (debt.get(i.customerId) ?? 0) + left);
    return {
      value: `inv:${i.id}`, label: `${i.invoiceNo} · ${i.customer.name}`,
      hint: `${i.isOpening ? "boshlang'ich qarz · " : ""}${day(i.date)} · qoldiq ${money(left)}`,
      extra: { customerId: i.customerId, amount: String(Math.round(left * 100) / 100) },
    };
  });
  const ordOpts: FormOption[] = orders.map((o) => {
    const total = orderTotal(o);
    const paid = o.payments.reduce((s, p) => s + Number(p.amount), 0);
    const expected = expectedAdvance(o);
    // Veb bilan bir xil taklif: sotuvchi yozgan kutilayotgan avans (olinganidan tashqari), aks holda zayavka qoldig'i
    const suggest = Math.max(0, Math.round(((expected > paid ? expected : total) - paid) * 100) / 100);
    return {
      value: `ord:${o.id}`, label: `${o.orderNo} · ${o.customer.name} — avans`,
      hint: `zayavka ${money(total)}${expected > 0 ? ` · kutilmoqda ${money(expected)}` : ""}${paid > 0 ? ` · olingan ${money(paid)}` : ""}`,
      extra: { customerId: o.customerId, amount: String(suggest) },
    };
  });
  return {
    key: "payments", title: "To'lov qabul qilish", submitLabel: "To'lovni saqlash",
    fields: [
      {
        name: "customerId", label: "Mijoz", type: "select", required: true,
        options: customers.map((c) => ({ value: c.id, label: markedName(c.name, c.id, marks), hint: debt.get(c.id) ? `ochiq schyotlar: ${money(debt.get(c.id)!)}` : undefined })),
      },
      {
        name: "link", label: "Schyot yoki zayavka (ixtiyoriy)", type: "select", dependsOn: "customerId", options: [...invOpts, ...ordOpts],
        hint: "Tanlanmasa — avans (taqsimlanmagan) bo'lib yoziladi, keyin schyotga bog'lanadi",
      },
      { name: "amount", label: "Summa (so'm)", type: "number", required: true, placeholder: "0", hint: "Schyot tanlansa qoldig'i o'zi yoziladi; qoldiqdan ko'p bo'lmaydi" },
      { name: "cashAccountId", label: "Kassa / hisob", type: "select", required: true, options: acc.options, value: acc.cash },
      { name: "method", label: "To'lov usuli", type: "select", options: PAY_METHODS.map((m) => ({ value: m, label: m })) },
      dateField(),
      { name: "note", label: "Izoh", type: "text", placeholder: "Platyojka №, kim topshirdi…" },
    ],
  };
}

/** Kirim / chiqim — veb `/cashflow` formasi: kategoriya, yetkazuvchi va to'lanmagan kirim hujjatiga bog'lash. */
async function cashForm(): Promise<CreateForm> {
  const [acc, suppliers, unpaid, inCats, outCats] = await Promise.all([
    cashAccountOptions(),
    db.supplier.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    unpaidReceipts(),
    // Kategoriyalar — veb bilan bitta daraxt (`CashCategory`, faqat manbalar); loyiha/kredit tanlovi hozircha vebda
    categoryOptions("INCOME").then((c) => c.map((x) => x.name)),
    categoryOptions("EXPENSE").then((c) => c.map((x) => x.name)),
  ]);
  const expense = { field: "type", equals: "EXPENSE" }, income = { field: "type", equals: "INCOME" };
  return {
    key: "cashflow", title: "Kirim / chiqim", submitLabel: "Saqlash",
    fields: [
      { name: "type", label: "Turi", type: "select", required: true, value: "EXPENSE", options: [{ value: "EXPENSE", label: "Chiqim (pul chiqdi)" }, { value: "INCOME", label: "Kirim (pul kirdi)" }] },
      { name: "cashAccountId", label: "Kassa / hisob", type: "select", required: true, options: acc.options, value: acc.cash, hint: "Naqd kassa qoldiqdan oshib chiqim qilmaydi" },
      { name: "amount", label: "Summa (so'm)", type: "number", required: true, placeholder: "0" },
      { name: "categoryExpense", label: "Kategoriya", type: "select", required: true, value: outCats[0], options: outCats.map((c) => ({ value: c, label: c })), showIf: expense },
      { name: "categoryIncome", label: "Kategoriya", type: "select", required: true, value: inCats[0], options: inCats.map((c) => ({ value: c, label: c })), showIf: income },
      { name: "supplierId", label: "Yetkazuvchi", type: "select", options: suppliers.map((s) => ({ value: s.id, label: s.name })), showIf: expense, hint: "Xomashyo uchun to'lov bo'lsa" },
      {
        name: "receiptId", label: "Kirim hujjati (ixtiyoriy)", type: "select", dependsOn: "supplierId", showIf: expense,
        options: unpaid.map((r) => ({ value: r.id, label: `${r.docNo} · ${r.supplier}`, hint: `${day(r.date)} · qolgan ${money(r.left)}`, extra: { supplierId: r.supplierId, amount: String(r.left) } })),
        hint: "Tanlansa — shu kirimga to'lov (qisman ham), qolgandan oshmaydi",
      },
      { name: "counterparty", label: "Kimga / kimdan", type: "text", placeholder: "Nomi / F.I.O." },
      dateField(),
      { name: "note", label: "Izoh", type: "text", placeholder: "Nima uchun" },
    ],
  };
}

/** Hisoblararo o'tkazma (inkassatsiya / naqdlashtirish) — `lib/cash-transfer.ts`. */
async function transferForm(): Promise<CreateForm> {
  const acc = await cashAccountOptions();
  return {
    key: "transfer", title: "Kassa ⇄ bank o'tkazma", submitLabel: "O'tkazmani saqlash",
    fields: [
      { name: "fromAccountId", label: "Qayerdan", type: "select", required: true, options: acc.options, value: acc.cash },
      { name: "toAccountId", label: "Qayerga", type: "select", required: true, options: acc.options, value: acc.bank },
      { name: "amount", label: "Summa (so'm)", type: "number", required: true, placeholder: "0", hint: "Manba hisob qoldig'idan oshmaydi" },
      { name: "fee", label: "Bank komissiyasi (so'm)", type: "number", placeholder: "0", hint: "Bo'lsa — bank tomonidan «Bank xizmati» chiqimi bo'lib yoziladi" },
      dateField(),
      { name: "note", label: "Izoh", type: "text" },
    ],
  };
}

// ───────────────────────── Sklad: «Kirim» va «Chiqim» ─────────────────────────

/** Oxirgi `n` kun — «Sana» tanlovi (ilovaning `date` maydoni faqat kelajak kunlarni ko'rsatadi). */
function lastDays(n: number): FormOption[] {
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() - i);
    return { value: ymd(d), label: i === 0 ? "Bugun" : i === 1 ? "Kecha" : `${dateRu(d)} · ${WEEKDAYS[d.getDay()]}` };
  });
}
/** Sana tanlovida necha kun orqaga (Chiqim qoidasi 31 kungacha — ro'yxat ixcham bo'lsin, eskirog'i vebdan). */
const SKLAD_DAYS = 14;
const skladDate = (): FormField => ({ name: "date", label: "Sana", type: "select", required: true, value: ymd(new Date()), options: lastDays(SKLAD_DAYS) });

/** Faol skladlar — asosiysi birinchi (sukut qiymat). Bitta bo'lsa ham ko'rinadi: qayerga yozilayotgani aniq bo'lsin. */
async function skladField(): Promise<FormField> {
  const ws = await db.warehouse.findMany({ where: { isActive: true }, orderBy: [{ isDefault: "desc" }, { name: "asc" }], select: { id: true, name: true } });
  return { name: "warehouseId", label: "Sklad", type: "select", required: true, value: ws[0]?.id, options: ws.map((w) => ({ value: w.id, label: w.name })) };
}

/** Umumiy qoldiq (barcha skladlar) — tanlovda ko'rsatish uchun; berishda server tanlangan sklad bo'yicha tekshiradi. */
async function stockBalances(): Promise<Map<string, number>> {
  const rows = await db.stockMove.groupBy({ by: ["materialId"], where: { materialId: { not: null } }, _sum: { qty: true } });
  return new Map(rows.map((b) => [b.materialId!, Number(b._sum.qty ?? 0)]));
}

/**
 * «Yangi kirim» — veb Sklad → Kirim formasi bilan bir xil maydonlar (Ta'minotchi — Snabjeniye o'zi, to'lov hisobi — faqat vebda).
 * «Narx» avtomatik to'ldirilmaydi: ilova `extra` ni faqat BO'SH katakka yozadi — xomashyo almashtirilsa eski xomashyoning
 * narxi qolib ketardi. O'rniga «Xomashyo» izohida «Dona narxi» (bo'lmasa «≈» o'rtacha tannarx) ko'rinadi, «Narx» bo'sh
 * qoldirilsa server saqlashda aynan shu narxni oladi (`mobileCreate` → `prixod`); yozilgan narx (0 ham) o'zgarmaydi.
 */
async function prixodForm(user: MobileUser): Promise<CreateForm> {
  const [suppliers, warehouse, materials, recipients, bal] = await Promise.all([
    db.supplier.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true, vatPayer: true } }),
    skladField(),
    db.material.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true, code: true, unit: true, unitPrice: true } }),
    activeRecipients(),
    stockBalances(),
  ]);
  const [prices, extra] = await Promise.all([issuePrices(materials.map((m) => m.id)), prixodExtraFields(user, recipients)]);
  return {
    key: "prixod", title: "Yangi kirim", submitLabel: "Kirimni saqlash",
    fields: [
      skladDate(),
      { name: "supplierId", label: "Kimdan", type: "select", required: true, options: suppliers.map((s) => ({ value: s.id, label: s.name, hint: s.vatPayer ? undefined : "QQS to'lovchisi emas, QQS 0" })) },
      warehouse,
      {
        name: "payment", label: "To'lov turi", type: "select", required: true, value: "BANK",
        options: [
          { value: "BANK", label: "Bank o'tkazma", hint: "QQS 12% (yetkazuvchi QQS to'lovchisi bo'lsa)" },
          { value: "CASH", label: "Naqd pul", hint: "Barcha qatorlarda QQS 0" },
        ],
      },
      { name: "waybillNo", label: "TTN", type: "text", placeholder: "Nakladnoy raqami" },
      { name: "recipientId", label: "Kimga", type: "select", options: recipients.map((r) => ({ value: r.id, label: r.name })), hint: "Tanlanmasa — skladga" },
      { name: "address", label: "Manzil", type: "text", placeholder: "Qayerdan / qayerga yetkazildi" },
      { name: "purpose", label: "Maqsad", type: "text", placeholder: "Nima uchun sotib olindi" },
      // Qayerdan yuklandi, mashina, darhol kimga berildi, (direktor) to'lov hisobi — veb `prixod-form.tsx` (`./sklad-extra.ts`)
      ...extra,
      {
        name: "items", label: "Xomashyo", type: "items", required: true,
        columns: [
          {
            name: "materialId", label: "Xomashyo", type: "select", required: true,
            options: materials.map((m) => {
              const u = unitShort(m.unit), p = prices.get(m.id);
              // Narx `extra` da emas (yuqoridagi izoh) — faqat ko'rsatiladi; «Narx» bo'sh bo'lsa server shuni oladi
              const price = p == null ? "" : ` · ${m.unitPrice == null ? "≈ o'rtacha tannarx" : "Dona narxi"} ${fmtNum(p, 2)}`;
              return { value: m.id, label: `${m.name} · ${u}`, hint: `${m.code} · Qoldiq ${fmtNum(bal.get(m.id) ?? 0, 3)} ${u}${price}`, extra: { unit: u } };
            }),
          },
          { name: "qty", label: "Miqdor", type: "number", required: true, placeholder: "0" },
          { name: "price", label: "Narx (QQSsiz)", type: "number", placeholder: "bo'sh — «Dona narxi» bo'yicha" },
          { name: "deliveryCost", label: "Yetkazib berish", type: "number", placeholder: "0" },
        ],
      },
      { name: "note", label: "Izoh", type: "text", placeholder: "Holati, qo'shimcha ma'lumot" },
    ],
  };
}

/**
 * «Yangi chiqim» — skladdan oluvchiga yoki brigadaga berish (veb Sklad → Chiqim bilan bitta qoida).
 * Tanlovda faqat qoldig'i bor xomashyo, yorliqda qoldiq va «Dona narxi» (bo'lmasa o'rtacha tannarx, «≈»).
 */
async function rasxodForm(): Promise<CreateForm> {
  const [warehouse, targets, materials, bal] = await Promise.all([
    skladField(),
    issueTargetOptions(),
    db.material.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true, code: true, unit: true, unitPrice: true } }),
    stockBalances(),
  ]);
  const { brigades, employees, recipients } = targets;
  const inStock = materials.filter((m) => (bal.get(m.id) ?? 0) > STOCK_EPS);
  const prices = await issuePrices(inStock.map((m) => m.id));
  return {
    key: "rasxod", title: "Yangi chiqim", submitLabel: "Chiqimni saqlash",
    fields: [
      skladDate(),
      warehouse,
      {
        name: "to", label: "Kimga", type: "select", required: true,
        // Tartib vebdagi bilan bir xil: bizning brigadalar → xodimlar → tizimda yo'q nomlar
        options: [
          ...brigades.map((b) => ({ value: `b:${b.id}`, label: `Brigada: ${brigadeLabel(b)}` })),
          ...employees.map((e) => ({ value: `e:${e.id}`, label: `Xodim: ${e.name} · ${e.position}` })),
          ...recipients.map((r) => ({ value: `r:${r.id}`, label: `Oluvchi: ${r.name}` })),
        ],
        hint: recipients.length ? undefined : "Oluvchilar ro'yxati saytda yuritiladi: Sklad → Chiqim → Oluvchilar",
      },
      {
        name: "items", label: "Xomashyo", type: "items", required: true,
        columns: [
          {
            name: "materialId", label: "Xomashyo", type: "select", required: true,
            options: inStock.map((m) => {
              const u = unitShort(m.unit), p = prices.get(m.id);
              const price = p == null ? "narxsiz" : `${m.unitPrice == null ? "≈" : ""}${fmtNum(p, 2)} so'm`;
              return { value: m.id, label: `${m.name} — qoldiq ${fmtNum(bal.get(m.id) ?? 0, 3)} ${u} · ${price}`, hint: `${m.code}${m.unitPrice == null && p != null ? " · narx — o'rtacha tannarx" : ""}` };
            }),
          },
          { name: "qty", label: "Miqdor", type: "number", required: true, placeholder: "0" },
        ],
      },
      { name: "note", label: "Izoh", type: "text", placeholder: "Nima uchun / qaysi obyekt" },
    ],
  };
}

/** Ta'minot so'rovi: sklad + qachongacha + mahsulotlar jadvali (spravochnikdagi xomashyo, miqdor, izoh). */
async function supplyForm(user: MobileUser): Promise<CreateForm> {
  const [warehouses, materials, balances] = await Promise.all([
    db.warehouse.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
    db.material.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
    db.stockMove.groupBy({ by: ["materialId"], where: { materialId: { not: null } }, _sum: { qty: true } }),
  ]);
  const bal = new Map(balances.map((b) => [b.materialId, Number(b._sum.qty ?? 0)]));
  return {
    key: "supply", title: "Ta'minot so'rovi", submitLabel: "Snabjeniyega yuborish",
    fields: [
      { name: "warehouseId", label: "Sklad", type: "select", required: true, value: warehouses[0]?.id, options: warehouses.map((w) => ({ value: w.id, label: w.name })) },
      { name: "department", label: "Bo'lim (kim so'rayapti)", type: "select", options: DEPARTMENTS.map((d) => ({ value: d, label: d })), value: user.role === "PRODUCTION" ? "Ishlab chiqarish" : user.role === "WAREHOUSE" ? "Sklad" : user.role === "MECHANIC" ? "Texnika" : undefined },
      { name: "priority", label: "Ustuvorlik", type: "select", required: true, value: "NORMAL", options: PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABEL[p] })), hint: "Kritik — ishlab chiqarish to'xtab qolishi mumkin" },
      { name: "needBy", label: "Qachongacha kerak", type: "date" },
      {
        name: "items", label: "Kerakli mahsulotlar", type: "items", required: true,
        columns: [
          // Qoldiq nom yonida — kam qolganini ko'rib so'raydi. Birlik xomashyodan olinadi (`extra`).
          // `create` — qidiruv yonidagi "+": spravochnikda yo'q xomashyoni shu yerning o'zida qo'shib, darhol tanlaydi
          { name: "materialId", label: "Xomashyo", type: "select", required: true, options: materials.map((m) => supplyMaterialOption(m, bal.get(m.id) ?? 0)),
            ...(canCreate(user, "materials") ? { create: { key: "materials", label: "Yangi xomashyo", fields: materialFields() } } : {}) },
          { name: "qty", label: "Miqdor", type: "number", required: true, placeholder: "0" },
          { name: "note", label: "Izoh (marka, o'lcham…)", type: "text" },
        ],
      },
      { name: "note", label: "Izoh", type: "text", hint: canCreate(user, "materials") ? "Spravochnikda yo'q xomashyoni tanlovdagi «+» tugmasi bilan qo'shing" : "Spravochnikda yo'q mahsulotni vebdagi Sklad bo'limidan so'rang" },
    ],
  };
}

// ───────────────────────── Mexanik so'rovi (Kirim) ─────────────────────────

const VEHICLE_STATUS_HINT: Record<string, string> = { REPAIR: "ta'mirda", IDLE: "bekor turibdi" };
/** Umumiy maydonlar: summa, tavsif, shoshilinch, surat (orqa kamera). */
const kirimTail = (): FormField[] => [
  { name: "amount", label: "Summa (so'm)", type: "number", required: true, placeholder: "0" },
  { name: "note", label: "Muammo tavsifi — nima buzildi, nima kerak", type: "text", required: true },
  { name: "urgent", label: "Shoshilinch", type: "switch", value: "false" },
  { name: "photo", label: "Surat (muammo yoki chek)", type: "photo", camera: "back", hint: "Ixtiyoriy" },
];

async function kirimTransportForm(): Promise<CreateForm> {
  const vehicles = await db.vehicle.findMany({ where: { isActive: true }, orderBy: { plate: "asc" }, select: { id: true, plate: true, type: true, brand: true, model: true, status: true } });
  return {
    key: "kirim-transport", title: "Transport uchun so'rov", submitLabel: "So'rov yuborish",
    fields: [
      {
        name: "vehicleId", label: "Mashina", type: "select", required: true,
        options: vehicles.map((v) => ({
          value: v.id, label: v.plate,
          hint: [[VEHICLE_TYPE[v.type] ?? v.type, [v.brand, v.model].filter(Boolean).join(" ")].filter(Boolean).join(" · "), VEHICLE_STATUS_HINT[v.status]].filter(Boolean).join(" · "),
        })),
      },
      { name: "problem", label: "Muammo turi", type: "select", required: true, options: PROBLEMS.map((p) => ({ value: p, label: p })) },
      ...kirimTail(),
    ],
  };
}

async function kirimZavodForm(): Promise<CreateForm> {
  return {
    key: "kirim-zavod", title: "Zavod uchun so'rov", submitLabel: "So'rov yuborish",
    fields: [
      { name: "object", label: "Obyekt", type: "select", required: true, options: FACTORY_OBJECTS.map((o) => ({ value: o, label: o })) },
      { name: "objectNote", label: "Qaysi obyekt", type: "text", required: true, placeholder: "Masalan: tarozi, ombor darvozasi", showIf: { field: "object", equals: "Boshqa" } },
      { name: "problem", label: "Muammo turi", type: "select", required: true, options: FACTORY_PROBLEMS.map((p) => ({ value: p, label: p })) },
      ...kirimTail(),
    ],
  };
}

async function kirimBoshqaForm(): Promise<CreateForm> {
  return {
    key: "kirim-boshqa", title: "Boshqa xarajat so'rovi", submitLabel: "So'rov yuborish",
    fields: [
      { name: "object", label: "Nima uchun", type: "text", required: true, placeholder: "Masalan: asbob-uskuna, kanselyariya" },
      ...kirimTail(),
    ],
  };
}

async function customerForm(): Promise<CreateForm> {
  return {
    key: "customers", title: "Yangi mijoz", submitLabel: "Mijozni saqlash",
    fields: [
      { name: "name", label: "Nomi", type: "text", required: true, placeholder: "MChJ yoki F.I.Sh." },
      { name: "phone", label: "Telefon", type: "text", placeholder: "+998 90 123 45 67" },
      { name: "inn", label: "INN", type: "text", placeholder: "9 raqam" },
      { name: "address", label: "Manzil", type: "text" },
    ],
  };
}

async function supplierForm(): Promise<CreateForm> {
  return {
    key: "suppliers", title: "Yangi yetkazuvchi", submitLabel: "Saqlash",
    fields: [
      { name: "name", label: "Nomi", type: "text", required: true },
      { name: "phone", label: "Telefon", type: "text", placeholder: "+998 90 123 45 67" },
      { name: "address", label: "Manzil", type: "text", placeholder: "Shahar, ko'cha, uy" },
    ],
  };
}

/** Ta'minot so'rovidagi xomashyo varianti: qoldiq nom yonida (kam qolganini ko'rib so'raydi), birlik `extra` da. */
const supplyMaterialOption = (m: { id: string; name: string; unit: string; minStock: unknown }, balance: number): FormOption =>
  ({ value: m.id, label: `${m.name} · qoldiq ${balance.toFixed(1)} ${m.unit}${balance < Number(m.minStock) ? " · kam qolgan" : ""}`, extra: { unit: m.unit } });

/** Yangi xomashyo maydonlari — alohida forma ham, tanlov ichidagi "+" varag'i ham shuni ishlatadi. */
const materialFields = (): FormField[] => [
  { name: "name", label: "Nomi", type: "text", required: true, placeholder: "Sement M400" },
  { name: "unit", label: "Birlik", type: "select", required: true, value: "kg", options: MATERIAL_UNITS.map((u) => ({ value: u, label: unitLabel(u) })) },
  { name: "minStock", label: "Minimal qoldiq", type: "number", placeholder: "0", hint: "Qoldiq shundan kam bo'lsa «kam qolgan» deb belgilanadi" },
];

async function materialForm(): Promise<CreateForm> {
  return { key: "materials", title: "Yangi xomashyo", submitLabel: "Saqlash", fields: materialFields() };
}

async function brigadeForm(): Promise<CreateForm> {
  const leaders = await db.employee.findMany({ where: { isActive: true }, orderBy: { fullName: "asc" }, select: { id: true, fullName: true, position: true } });
  return {
    key: "brigades", title: "Yangi brigada", submitLabel: "Brigadani ochish",
    fields: [
      { name: "name", label: "Brigada nomi", type: "text", required: true, placeholder: "1-brigada" },
      { name: "leaderId", label: "Brigadir", type: "select", options: leaders.map((e) => ({ value: e.id, label: `${e.fullName} · ${e.position}` })), hint: "Keyin Xodimlar kartochkasidan ham biriktirish mumkin" },
      { name: "phone", label: "Telefon", type: "text" },
      { name: "note", label: "Izoh", type: "text" },
    ],
  };
}

async function orderForm(user: MobileUser, defaults: Record<string, string> = {}): Promise<CreateForm> {
  // Sotuv agenti faqat o'z mijoziga zayavka ochadi: ro'yxat o'ziga biriktirilganlar, yangi mijoz tugmasi yo'q
  const isAgent = user.role === "AGENT";
  const [customers, catalog, cells, lead] = await Promise.all([
    db.customer.findMany({ where: { isActive: true, isInternal: false, ...(isAgent ? { agentId: user.id } : {}) }, orderBy: { name: "asc" } }),
    productCatalog(), // veb bilan bir xil mahsulot ro'yxati (papka yo'li nom yonida)
    dayCells(),
    // Sayt arizasidan ochilgan zayavka: mahsulot, hajm va manzil arizadan (veb `/orders/new?lead=`)
    isAgent ? null : leadOrderPrefill(defaults.lead, defaults.customerId),
  ]);
  // Qora ro'yxatdagi mijoz tanlanmasin — ro'yxatdan chiqarilmaydi, lekin belgilanadi
  const black = await blacklistedIds(customers.map((c) => c.id));
  const credit = await customersCredit(customers.map((c) => c.id));

  const customerOptions: FormOption[] = [
    ...(isAgent ? [] : [{ value: NEW_CUSTOMER, label: "+ Yangi mijoz" }]),
    ...customers.map((c) => {
      const cr = credit.get(c.id);
      const left = cr ? cr.limit - cr.used : null;
      return {
        value: c.id,
        label: black.has(c.id) ? `${c.name} — QORA RO'YXAT` : `${c.name}${left != null ? ` · limitda ${money(Math.max(0, left))}` : ""}`,
      };
    }),
  ];

  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);

  return {
    key: "orders", title: "Yangi zayavka", submitLabel: "Zayavkani ochish",
    fields: [
      { name: "customerId", label: "Mijoz", type: "select", required: true, options: customerOptions, hint: "Qora ro'yxatdagi mijozga zayavka ochilmaydi" },
      { name: "newName", label: "Yangi mijoz nomi", type: "text", required: true, showIf: { field: "customerId", equals: NEW_CUSTOMER } },
      { name: "newPhone", label: "Telefon", type: "text", placeholder: "+998 90 123 45 67", showIf: { field: "customerId", equals: NEW_CUSTOMER } },
      { name: "newInn", label: "INN", type: "text", placeholder: "9 raqam", showIf: { field: "customerId", equals: NEW_CUSTOMER } },
      { name: "deliveryDate", label: "Yetkazish sanasi", type: "date", required: true, value: ymd(tomorrow), cells, hint: "Rang shu kunga olingan beton (m³) va dona kunlik limitga nisbatan qanchaligini ko'rsatadi" },
      { name: "deliveryAddress", label: "Obyekt manzili", type: "text", required: true, value: lead?.address, placeholder: "Tuman, ko'cha, mo'ljal" },
      {
        name: "items", label: "Mahsulot", type: "items", required: true,
        ...(isAgent ? {} : { hint: "Narx NDS'siz kiritiladi; «NDS 12%» tanlangan qatorda soliq qo'shib saqlanadi" }),
        columns: [
          // Birlik mahsulot nomi yonida turadi: hajm va narx shu birlikda kiritiladi (beton m³, ustun/blok dona)
          { name: "productId", label: "Mahsulot", type: "select", required: true, value: lead?.productId ?? undefined, options: catalog.products.map((p) => { const path = groupPath(catalog.groups, p.groupId); return { value: p.id, label: `${path ? `${path} › ` : ""}${p.name} · ${p.unit}`, extra: { price: String(Math.round(Number(p.price))) } }; }) },
          { name: "qtyM3", label: "Hajmi (mahsulot birligida)", type: "number", required: true, value: lead?.qty, placeholder: "0" },
          { name: "price", label: "Narx (1 birlik)", type: "number", required: true, value: lead?.productId ? lead.price : undefined, placeholder: "0" },
          // Veb formadagi qator «NDS 12%» tugmasi (agent formasida yo'q)
          ...(isAgent ? [] : [{ name: "nds", label: "NDS 12%", type: "select" as const, value: "0", options: [{ value: "0", label: "NDS'siz" }, { value: "1", label: "NDS 12% qo'shilsin" }] }]),
        ],
      },
      { name: "needsPump", label: "Nasos kerak", type: "switch", value: "false" },
      ...(isAgent ? [] : [
        { name: "needsDelivery", label: "Dastavka kerak", type: "switch" as const, value: "true", hint: "O'chirilsa — mijoz o'zi olib ketadi" },
        // Veb formadagi «Dastavka summasi» — zayavka summasiga qo'shiladi (limit, bosh to'lov, schyot shu jami bo'yicha)
        { name: "deliveryFee", label: "Dastavka summasi (so'm)", type: "number" as const, placeholder: "0", showIf: { field: "needsDelivery", equals: "true" } },
      ]),
      { name: "isUrgent", label: "Shoshilinch", type: "switch", value: "false" },
      // Sotuv agenti to'lov bilan ishlamaydi (veb `/agent` formasi kabi): zayavka naqd, bosh to'lov so'rovisiz
      ...(isAgent ? [] : [
        { name: "onCredit", label: "Qarzga", type: "switch", value: "false", hint: "Belgilansa kafolat xati talab qilinadi; bosh to'lov bo'lsa pastda kiriting — qolgani kredit limitdan" },
        // To'lov usuli va bosh to'lov — veb formadagidek qarzga zayavkada ham (bir qismi oldindan, qolgani limitdan).
        // `showIf` faqat bitta tenglik sharti — shuning uchun ikkalasi doim ko'rinadi; server qarzga + bosh to'lovsiz holatda usulni yozmaydi.
        { name: "payMethod", label: "To'lov usuli", type: "select", required: true, value: "CASH", options: [{ value: "CASH", label: "Naqd (kassa)" }, { value: "BANK", label: "Perechisleniye (bank)" }], hint: "Naqd — Kassa xodimi qabul qiladi, perechisleniye — Buxgalter tasdiqlaydi" },
        // Sotuvchi kassaga pul yozmaydi: summa "kutilayotgan avans" bo'lib zayavkaga yoziladi, pulni kassir yoki buxgalter qabul qiladi
        { name: "prepayAmount", label: "Kutilayotgan avans (so'm)", type: "number", placeholder: "0", hint: "Bosh to'lov bo'lsa — qabul qilish so'rovi tanlangan usul bo'yicha yuboriladi" },
        // Shartnoma — veb formadagi «Shartnoma qilish»: summa va Didox'da imzolangan hujjat surati (raqam saqlashda beriladi)
        { name: "hasContract", label: "Shartnoma qilish", type: "switch", value: "false" },
        { name: "contractAmount", label: "Shartnoma summasi (so'm)", type: "number", required: true, placeholder: "0", showIf: { field: "hasContract", equals: "true" } },
        { name: "contractFile", label: "Imzolangan shartnoma surati", type: "photo", hint: "Ixtiyoriy — keyin zayavka kartochkasidan ham yuklanadi", showIf: { field: "hasContract", equals: "true" } },
      ] as FormField[]),
      { name: "note", label: "Izoh", type: "text", value: lead?.note },
    ],
  };
}

async function tripForm(): Promise<CreateForm> {
  const [orders, vehicles, drivers] = await Promise.all([
    db.order.findMany({ where: { kind: "SALE", status: { in: ["CONFIRMED", "IN_PRODUCTION"] } }, orderBy: { deliveryDate: "asc" }, include: { customer: true, ...READINESS_INCLUDE } }),
    // Veb formasi bilan bir xil: mikser ham, yuk mashina ham (nasos yuk tashimaydi)
    db.vehicle.findMany({ where: { isActive: true, type: { in: ["MIXER", "TRUCK"] } }, orderBy: [{ type: "asc" }, { plate: "asc" }] }),
    db.employee.findMany({ where: { isActive: true, position: { in: await driverPositionNames() } }, orderBy: { fullName: "asc" }, include: { vehicle: { select: { plate: true } } } }),
  ]);

  // Faqat brigada tayyorlab bergan (hali jo'natilmagan) miqdori bor zayavkalar — qolgani sexda,
  // reys ochib bo'lmaydi. Qoldiq zayavkadagi mahsulot birligida (aralash birlikda birliksiz).
  const open = orders
    .map((o) => { const rd = orderReadiness(o); return { o, left: rd.available, sexda: rd.inProduction, unit: rd.unit }; })
    .filter((x) => x.left > 0.001);

  return {
    key: "trips", title: "Yangi reys", submitLabel: "Reysni ochish",
    fields: [
      {
        name: "orderId", label: "Zayavka", type: "select", required: true,
        options: open.map(({ o, left, sexda, unit }) => ({ value: o.id, label: `${o.orderNo} · ${o.customer.name} · tayyor ${left}${unit ? ` ${unitLabel(unit)}` : ""}${sexda > 0 ? ` · sexda ${sexda}` : ""}`, extra: { qtyM3: String(left), ...plannedExtra(o) } })),
        hint: open.length ? "Faqat brigada tayyorlab bergan miqdor reysga beriladi; sexdagisi brigada tasdiqidan keyin" : "Brigada tayyorlagan mahsuloti bor zayavka yo'q — brigada tasdiqini kuting",
      },
      {
        name: "vehicleId", label: "Texnika", type: "select", required: true,
        options: vehicles.map((v) => ({ value: v.id, label: `${v.plate} · ${v.type === "MIXER" ? "mikser" : "yuk mashina"}${capText(v) ? ` · ${capText(v)}` : ""}` })),
        hint: "Beton — mikser, dona mahsulot (plita, blok) — yuk mashina",
      },
      {
        name: "driverId", label: "Haydovchi", type: "select", required: true,
        options: drivers.map((d) => ({ value: d.id, label: `${d.fullName}${d.vehicle ? ` · ${d.vehicle.plate}` : " · texnikasiz"}${normalizePhone(d.phone) ? "" : " · telefonsiz"}`, extra: d.vehicleId ? { vehicleId: d.vehicleId } : undefined })),
        hint: "Haydovchining biriktirilgan texnikasi yonida ko'rsatiladi; telefoni yo'q haydovchi ilovada reysni ko'rmaydi",
      },
      { name: "qtyM3", label: "Hajmi (zayavka birligida)", type: "number", required: true, placeholder: "0" },
      // Reja vaqti (veb `plannedAt`) — zayavka tanlanganda uning sanasi/soati qo'yiladi; bo'sh — zayavkadagi vaqt
      ...plannedFields(),
      { name: "note", label: "Izoh", type: "text" },
    ],
  };
}

// ───────────────────────── Yuborish ─────────────────────────

const OrderBody = z.object({
  customerId: z.string().trim().min(1, "Mijoz tanlanmagan"),
  newName: z.string().trim().optional(),
  newPhone: z.string().trim().optional(),
  newInn: z.string().trim().optional(),
  deliveryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Yetkazish sanasi kerak"),
  deliveryAddress: z.string().trim().min(1, "Obyekt manzili kerak"),
  items: z.array(z.object({
    productId: z.string().trim().min(1, "Marka tanlanmagan"),
    qtyM3: z.coerce.number().positive("Hajm 0 dan katta bo'lsin"),
    price: z.coerce.number().min(0, "Narx manfiy bo'lmasin"),
    // Eski ilova yubormaydi — NDS'siz
    nds: z.string().trim().optional(),
  })).min(1, "Kamida bitta mahsulot qatori kerak"),
  needsPump: z.coerce.boolean().optional(),
  needsDelivery: z.boolean().optional(),
  deliveryFee: z.coerce.number().min(0, "Dastavka summasi manfiy bo'lmasin").max(MAX_AMOUNT, "Dastavka summasi juda katta").optional(),
  hasContract: z.boolean().optional(),
  contractAmount: z.coerce.number().min(0, "Shartnoma summasi manfiy bo'lmasin").max(MAX_AMOUNT, "Shartnoma summasi juda katta").optional(),
  contractFile: z.string().optional(),
  isUrgent: z.coerce.boolean().optional(),
  onCredit: z.coerce.boolean().optional(),
  prepayAmount: z.coerce.number().min(0).optional(),
  prepayAccountId: z.string().trim().optional(),
  // Eski ilova yubormaydi — createOrder sukut bo'yicha naqd qiladi
  payMethod: z.enum(["CASH", "BANK"], { message: "To'lov usulini tanlang: naqd yoki perechisleniye" }).optional(),
  note: z.string().trim().optional(),
});

const TripBody = z.object({
  orderId: z.string().trim().min(1, "Zayavka tanlanmagan"),
  vehicleId: z.string().trim().min(1, "Mikser tanlanmagan"),
  driverId: z.string().trim().min(1, "Haydovchi tanlanmagan"),
  qtyM3: z.coerce.number().positive("Hajm 0 dan katta bo'lsin"),
  note: z.string().trim().optional(),
});

const SupplyBody = z.object({
  warehouseId: z.string().trim().min(1, "Sklad tanlanmagan"),
  needBy: z.string().trim().optional(),
  note: z.string().trim().optional(),
  department: z.string().trim().optional(),
  priority: z.enum(["NORMAL", "HIGH", "CRITICAL"]).optional(),
  items: z.array(z.object({
    materialId: z.string().trim().min(1, "Xomashyo tanlanmagan"),
    qty: z.coerce.number().positive("Miqdor 0 dan katta bo'lsin"),
    note: z.string().trim().optional(),
  })).min(1, "Kamida bitta qator kerak"),
});
const CustomerBody = z.object({ name: z.string().trim().min(2, "Mijoz nomi kerak"), phone: z.string().trim().optional(), inn: z.string().trim().optional(), address: z.string().trim().optional() });
const SupplierBody = z.object({ name: z.string().trim().min(2, "Yetkazuvchi nomi kerak"), phone: z.string().trim().optional(), address: z.string().trim().max(300).optional() });
const MaterialBody = z.object({
  name: z.string().trim().min(2, "Xomashyo nomi kerak").max(120, "Nomi juda uzun"),
  unit: z.enum(MATERIAL_UNITS, { message: "Birlik tanlanmagan" }),
  minStock: z.coerce.number().min(0, "Minimal qoldiq manfiy bo'lmasin").max(MAX_AMOUNT).optional(),
});
const BrigadeBody = z.object({ name: z.string().trim().min(1, "Brigada nomi kerak"), leaderId: z.string().trim().optional(), phone: z.string().trim().optional(), note: z.string().trim().optional() });

/** Pul maydoni: "1 000 000,50" ham qabul qilinadi. */
const zMoney = (msg: string) => z.preprocess((v) => (typeof v === "string" ? v.replace(/\s/g, "").replace(",", ".") : v), z.coerce.number({ message: msg }).positive(msg).max(MAX_AMOUNT, "Summa juda katta"));
const zDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Sana noto'g'ri").optional();
const PaymentBody = z.object({
  customerId: z.string().trim().min(1, "Mijoz tanlanmagan"),
  link: z.string().trim().optional(),
  cashAccountId: z.string().trim().min(1, "Kassa/hisob tanlanmagan"),
  amount: zMoney("Summa 0 dan katta bo'lsin"),
  method: z.enum(PAY_METHODS).optional(),
  date: zDay,
  note: z.string().trim().max(500).optional(),
});
const CashBody = z.object({
  type: z.enum(["INCOME", "EXPENSE"], { message: "Turi tanlanmagan" }),
  cashAccountId: z.string().trim().min(1, "Kassa/hisob tanlanmagan"),
  amount: zMoney("Summa 0 dan katta bo'lsin"),
  category: z.string().trim().optional(),
  categoryExpense: z.string().trim().optional(),
  categoryIncome: z.string().trim().optional(),
  supplierId: z.string().trim().optional(),
  receiptId: z.string().trim().optional(),
  counterparty: z.string().trim().max(200).optional(),
  date: zDay,
  note: z.string().trim().max(500).optional(),
});
const TransferBody = z.object({
  fromAccountId: z.string().trim().min(1, "Qayerdan — hisob tanlanmagan"),
  toAccountId: z.string().trim().min(1, "Qayerga — hisob tanlanmagan"),
  amount: zMoney("Summa 0 dan katta bo'lsin"),
  fee: z.preprocess((v) => (v === "" || v == null ? undefined : typeof v === "string" ? v.replace(/\s/g, "").replace(",", ".") : v), z.coerce.number({ message: "Komissiya raqam bo'lsin" }).min(0, "Komissiya manfiy bo'lolmaydi").max(MAX_AMOUNT).optional()),
  date: zDay,
  note: z.string().trim().max(500).optional(),
  // Ixtiyoriy bir martalik kalit (ilova forma ochilganda UUID yaratadi): tarmoq uzilib qayta yuborilsa — o'sha hujjat qaytadi.
  // G'alati qiymat e'tiborsiz (veb `tokenOf` bilan bir xil qoida) — eski ilova kalitsiz ham ishlayveradi.
  clientToken: z.preprocess((v) => (typeof v === "string" && /^[A-Za-z0-9-]{16,64}$/.test(v.trim()) ? v.trim() : undefined), z.string().optional()),
});

// Mexanik so'rovi: `vehicleId` / `object` turiga qarab `mobileCreate` da tekshiriladi, qoida — `lib/mechanic-requests.ts`
const KirimBody = z.object({
  vehicleId: z.string().trim().optional(),
  object: z.string().trim().max(200, "Obyekt nomi juda uzun").optional(),
  objectNote: z.string().trim().max(150, "Obyekt izohi juda uzun").optional(),
  problem: z.string().trim().optional(),
  amount: zMoney("Summa 0 dan katta bo'lsin"),
  note: z.string({ message: "Muammo tavsifini yozing" }).trim().min(3, "Muammo tavsifini yozing — nima buzildi, nima kerak").max(500, "Tavsif juda uzun"),
  urgent: z.preprocess((v) => v === true || v === "true" || v === "1", z.boolean()).optional(),
  photo: z.string().optional(),
  clientToken: z.unknown().optional(),
});

// Sklad formalari. Raqam maydoni ilovadan satr bo'lib keladi: "1 250,5" ham qabul qilinadi (`zMoney` uslubi).
// Qator xatolarida «—» ishlatilmaydi: «{0}-qator: {1}» rus tarjimasi shablonida bo'lak «—» bo'yicha bo'linib ketadi.
const numText = (v: unknown) => (typeof v === "string" ? v.replace(/\s+/g, "").replace(",", ".") : v);
const zSkNum = (msg: string, min: "positive" | "nonneg") => z.preprocess(numText, (min === "positive" ? z.coerce.number({ message: msg }).positive(msg) : z.coerce.number({ message: msg }).min(0, msg)).max(MAX_AMOUNT, "Juda katta qiymat"));
const zSkText = (max: number, label: string) => z.string({ message: `«${label}» matn bo'lsin` }).trim().max(max, `«${label}»: ${max} belgidan oshmasin`).optional();
/** Majburiy tanlov/satr: yo'q bo'lsa ham (`undefined`) o'z matni bilan. */
const zSkReq = (msg: string) => z.string({ message: msg }).trim().min(1, msg);
const PrixodBody = z.object({
  date: z.string({ message: "Sanani tanlang" }).regex(/^\d{4}-\d{2}-\d{2}$/, "Sanani tanlang"),
  supplierId: zSkReq("Yetkazuvchini tanlang («Kimdan»)"),
  warehouseId: zSkReq("Skladni tanlang"),
  payment: z.enum(["BANK", "CASH"], { message: "To'lov turini tanlang: bank o'tkazma yoki naqd pul" }),
  waybillNo: zSkText(60, "TTN"),
  recipientId: z.string({ message: "Oluvchi noto'g'ri («Kimga»)" }).trim().optional(),
  address: zSkText(300, "Manzil"),
  purpose: zSkText(300, "Maqsad"),
  carrier: zSkText(120, "Mashina (kim olib keldi)"),
  loadedFrom: zSkText(300, "Qayerdan yuklandi"),
  autoIssueToId: z.string({ message: "Oluvchi noto'g'ri («Darhol kimga berildi»)" }).trim().optional(),
  cashAccountId: z.string({ message: "To'lov hisobi noto'g'ri" }).trim().optional(),
  note: zSkText(1000, "Izoh"),
  clientToken: z.unknown().optional(),
  items: z.array(z.object({
    materialId: zSkReq("Xomashyoni tanlang"),
    qty: zSkNum("Miqdor 0 dan katta bo'lsin", "positive"),
    // Bo'sh «Narx» — server «Dona narxi» ni oladi (`prixodForm` izohi); "0" — yozilgan narx, o'zgarmaydi
    price: z.preprocess((v) => { const t = numText(v); return t === "" || t == null ? undefined : t; }, z.coerce.number({ message: "Narx 0 yoki undan katta son bo'lsin" }).min(0, "Narx 0 yoki undan katta son bo'lsin").max(MAX_AMOUNT, "Juda katta qiymat").optional()),
    deliveryCost: z.preprocess((v) => (v === "" || v == null ? undefined : numText(v)), z.coerce.number({ message: "Yetkazib berish narxi son bo'lsin" }).min(0, "Yetkazib berish narxi manfiy bo'lmasin").max(MAX_AMOUNT, "Juda katta qiymat").optional()),
  }), { message: "Kamida bitta qator qo'shing" }).min(1, "Kamida bitta qator qo'shing"),
});
const RasxodBody = z.object({
  date: z.string({ message: "Chiqim sanasi noto'g'ri" }).regex(/^\d{4}-\d{2}-\d{2}$/, "Chiqim sanasi noto'g'ri").optional(),
  warehouseId: zSkReq("Skladni tanlang"),
  to: zSkReq("Kimga berilishini tanlang («Kimga»)"),
  note: zSkText(300, "Izoh"),
  clientToken: z.unknown().optional(),
  items: z.array(z.object({
    materialId: zSkReq("Xomashyoni tanlang"),
    qty: zSkNum("Miqdor 0 dan katta bo'lsin", "positive"),
  }), { message: "Kamida bitta qator qo'shing" }).min(1, "Kamida bitta qator qo'shing"),
});

/** zod xatosi → foydalanuvchi matni; qator xatosida «N-qator: …». */
function skladIssue(e: z.ZodError): string {
  const i = e.issues[0];
  // zod'ning o'z (inglizcha) matni — noto'g'ri shakl (payload obyekt emas, qator obyekt emas): umumiy matn
  const msg = !i || /^(Invalid|Expected|Required)/.test(i.message) ? "Ma'lumot to'liq emas" : i.message;
  return i && i.path[0] === "items" && typeof i.path[1] === "number" ? `${i.path[1] + 1}-qator: ${msg}` : msg;
}

/**
 * Takror himoyasi (evristika) oynasi: ilova so'rovi 60 s da uziladi — javob yo'qolib, foydalanuvchi qayta bossa ham shu
 * oynada ushlansin. Faqat yaroqli `clientToken` KELMAGANDA ishlaydi: kalit bo'lsa server himoyasi (unique) yetarli —
 * ilova clientToken yuborsa (OTA'dan keyin) bu evristika o'chadi.
 */
const DUP_WINDOW_MS = 3 * 60_000;
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const r2 = (n: number) => Math.round(n * 100) / 100;
/** Matn maydoni bazaga qanday yozilsa (`lib/receipts.ts` `clean`): trim, kesish, bo'sh — null. */
const txt = (v: string | null | undefined, max = 300) => { const t = (v ?? "").trim(); return t ? t.slice(0, max) : null; };

type PrixodSig = {
  supplierId: string; warehouseId: string; date: string; payment: "BANK" | "CASH";
  waybillNo?: string; recipientId?: string; address?: string; purpose?: string; note?: string;
};

/**
 * Shu xodim oxirgi 3 daqiqada AYNAN shunday kirim yozganmi — bo'lsa o'sha kirim. Imzo: yetkazuvchi, sklad, sana, to'lov turi,
 * TTN, kimga, manzil, maqsad, izoh va qatorlar (xomashyo | miqdor | narx | yetkazib berish). TTN yoki dostavka boshqa — boshqa kirim.
 * Ilova «Kirim» formasida bir martalik kalit yubormaydi; tarmoq uzilib qayta yuborilsa ikkinchi kirim ochilmasin.
 */
async function recentPrixod(userId: string, d: PrixodSig, items: { materialId: string; qty: number; price: number; deliveryCost: number }[]) {
  const date = new Date(d.date);
  if (!Number.isFinite(date.getTime())) return null; // noto'g'ri sana — `createGoodsReceipt` o'zi rad etadi
  // `createGoodsReceipt` yozgandek: TTN alohida ustunda ham, izohda ham («Nakladnoy № …», `receiptNote`)
  const waybillNo = txt(d.waybillNo, 60);
  const n = receiptNote({ note: txt(d.note, 1000), waybillNo });
  if ("error" in n) return null;
  const sig = (xs: { materialId: string; qty: number; price: number; deliveryCost: number }[]) =>
    xs.map((i) => `${i.materialId}|${r3(i.qty)}|${r2(i.price)}|${i.deliveryCost > 0 ? r2(i.deliveryCost) : 0}`).sort().join(";");
  const want = sig(items);
  const recent = await db.goodsReceipt.findMany({
    where: {
      createdById: userId, createdAt: { gte: new Date(Date.now() - DUP_WINDOW_MS) }, cancelledAt: null,
      supplierId: d.supplierId, warehouseId: d.warehouseId, date, payment: d.payment,
      waybillNo, recipientId: txt(d.recipientId, 64), address: txt(d.address), purpose: txt(d.purpose), note: n.note,
    },
    select: { id: true, docNo: true, items: { select: { materialId: true, qty: true, price: true, deliveryCost: true } } },
  });
  return recent.find((r) => sig(r.items.map((i) => ({ materialId: i.materialId, qty: Number(i.qty), price: Number(i.price), deliveryCost: Number(i.deliveryCost) }))) === want) ?? null;
}

/** Berish izohi StockMove'da: oluvchi / xodimga — o'zi, brigadaga — «<brigada> brigadasiga berildi · <izoh>» (`writeBrigadeIssue`). */
function issueNoteOf(kind: IssueTarget["kind"], raw: string | null): string | null {
  if (kind !== "brigade") return raw;
  const m = /^[\s\S]*? brigadasiga berildi(?: · ([\s\S]*))?$/.exec(raw ?? "");
  return m ? (m[1] ?? null) : raw;
}

/**
 * Shu xodim oxirgi 3 daqiqada AYNAN shunday berish yozganmi — bo'lsa o'sha berish (ref). Imzo: sklad, «Kimga», sana (kun —
 * `issueDate` bilan, `issueStock` dagidek), izoh (trim, 300 belgi) va qatorlar (xomashyo | jami miqdor). Storno qilingani hisobga
 * olinmaydi — xato berishni bekor qilib, qaytadan yozgan xodimning yangi chiqimi yozilsin.
 */
async function recentIssue(userId: string, d: { warehouseId: string; date?: string; note?: string }, to: IssueTarget, items: { materialId: string; qty: number }[]): Promise<string | null> {
  let at: Date;
  try { at = issueDate(d.date); } catch { return null; } // noto'g'ri sana — `issueStock` o'zi rad etadi
  const from = new Date(at); from.setHours(0, 0, 0, 0);
  const till = new Date(from); till.setDate(till.getDate() + 1);
  const note = d.note?.trim() ? d.note.trim().slice(0, 300) : null;
  const want = new Map<string, number>();
  for (const i of items) want.set(i.materialId, r3((want.get(i.materialId) ?? 0) + i.qty));
  const moves = await db.stockMove.findMany({
    where: {
      refType: "Issue", createdById: userId, createdAt: { gte: new Date(Date.now() - DUP_WINDOW_MS) }, warehouseId: d.warehouseId,
      date: { gte: from, lt: till }, ...(to.kind === "recipient" ? { recipientId: to.id } : to.kind === "employee" ? { employeeId: to.id } : { brigadeId: to.id }),
    },
    select: { refId: true, materialId: true, qty: true, note: true },
  });
  const byRef = new Map<string, { note: string | null; rows: Map<string, number> }>();
  for (const m of moves) {
    if (!m.refId || !m.materialId) continue;
    const g = byRef.get(m.refId) ?? { note: issueNoteOf(to.kind, m.note), rows: new Map<string, number>() };
    g.rows.set(m.materialId, r3((g.rows.get(m.materialId) ?? 0) - Number(m.qty)));
    byRef.set(m.refId, g);
  }
  const same = [...byRef].filter(([, g]) => g.note === note && g.rows.size === want.size && [...want].every(([id, q]) => g.rows.get(id) === q)).map(([ref]) => ref);
  if (!same.length) return null;
  const cancelled = new Set((await db.stockMove.findMany({ where: { refType: ISSUE_STORNO, refId: { in: same } }, select: { refId: true } })).map((m) => m.refId));
  return same.find((ref) => !cancelled.has(ref)) ?? null;
}

/**
 * Kassa sanasi: bugun — hozirgi vaqt; o'tgan kun — vebdagi kabi `new Date("YYYY-MM-DD")`.
 * Kelajak va 30 kundan eski sana rad etiladi (vebda ham sana bugundan oshmaydi).
 */
function cashDate(v: string | undefined): Date {
  const today = ymd(new Date());
  if (!v || v === today) return new Date();
  const d = new Date(v);
  const min = new Date(); min.setDate(min.getDate() - 30);
  if (Number.isNaN(d.getTime()) || v > today || d < min) throw new Error("Sana bugundan oldingi 30 kun ichida bo'lsin");
  return d;
}

/** `option` — tanlov ichidagi "+" dan yaratilganda: ilova uni ro'yxatga qo'shib, darhol tanlaydi. */
export type CreateResult = { key: string; id: string; message: string; option?: FormOption };

export async function mobileCreate(user: MobileUser, key: string, payload: unknown): Promise<CreateResult> {
  if (!Object.hasOwn(CREATE_ROLES, key)) throw new ListError("UNKNOWN_FORM", "Bunday forma yo'q", 404);
  if (!canCreate(user, key)) throw new ListError("FORBIDDEN", "Bu hujjatni ochishga ruxsatingiz yo'q", 403);

  try {
    // ── Xodim arizasi — `createHrRequest` (veb "Mening hisobim" bilan bitta qoida) ──
    if (key === "ariza") return await kadrAriza(user, payload, () => createRequestMobile(user, payload));
    if (key === "vazifa") return await createTaskMobile(user, payload);
    if (key === "murojaat") return await createFeedbackMobile(user, payload);
    if (key === "ish-haqi") return await payrollCreate(user, payload);
    if (Object.hasOwn(KADR_CREATE, key)) return await kadrCreate(user, key, payload);
    // ── Arenda (sekretar): kirim / chiqim / do'kon — `./arenda.ts` (qoida `lib/rent.ts`) ──
    if (key.startsWith("arenda-")) return await arendaCreate(user, key, payload);
    // ── Sklad: tayyor mahsulot, inventarizatsiya, hisobdan chiqarish, «Kimga» oluvchisi (`./sklad-extra.ts`) ──
    if (SKLAD_FORMS.has(key)) return await skladCreate(user, key, payload);
    // ── Sklad (zaxira) zayavkasi va tijorat taklifi — `./sotuv-extra.ts` (qoida `lib/stock-orders.ts`, `lib/offers.ts`) ──
    if (key === "stock-order" || key === "offers") return await sotuvCreate(user, key, payload);
    // ── Logistika: transport, zapravka, xarajat, obyekt (`./logistika-extra.ts`) ──
    if (LOGI_FORMS.has(key)) return await logiCreate(user, key, payload);
    // ── Zames — `createProductionBatch` (veb «Yangi zames» bilan bitta qoida) ──
    if (key === "production") return await createBatchMobile(user, payload);
    // ── Sklad → «Kirim»: kirim — `createGoodsReceipt` (veb Kirim formasi bilan bitta qoida) ──
    if (key === "prixod") {
      const p = PrixodBody.safeParse(payload);
      if (!p.success) throw new Error(skladIssue(p.error));
      const d = p.data;
      // «Narx» bo'sh — «Dona narxi» (bo'lmasa o'rtacha tannarx): formadagi izoh bilan bir manba (`issuePrices`)
      const blank = d.items.flatMap((i, n) => (i.price == null ? [n] : []));
      const auto = blank.length ? await issuePrices(blank.map((n) => d.items[n].materialId)) : new Map<string, number>();
      const miss = blank.find((n) => { const v = auto.get(d.items[n].materialId); return v == null || v < 0; });
      if (miss != null) throw new Error(`${miss + 1}-qator: narxni kiriting, xomashyoning «Dona narxi» belgilanmagan`);
      const items = d.items.map((i) => ({ materialId: i.materialId, qty: i.qty, price: i.price ?? r2(auto.get(i.materialId) ?? 0), deliveryCost: i.deliveryCost ?? 0 }));
      const token = receiptTokenOf(d.clientToken);
      // Yaroqli kalit bo'lsa — faqat server himoyasi (`createGoodsReceipt`, unique); yo'q bo'lsa — 3 daqiqalik evristika
      const dup = token ? null : await recentPrixod(user.id, d, items);
      if (dup) return { key: "receipts", id: dup.id, message: `${dup.docNo}: xuddi shunday kirim hozirgina saqlangan — qayta yozilmadi` };
      const r = await createGoodsReceipt({
        supplierId: d.supplierId, warehouseId: d.warehouseId, date: d.date, payment: d.payment,
        waybillNo: d.waybillNo || null, recipientId: d.recipientId || null, address: d.address || null, purpose: d.purpose || null, note: d.note || null,
        // Ta'minotchi — kiritgan Snabjeniye xodimining o'zi (veb formadagi sukut); boshqa rolda bo'sh — jurnalda kiritgan xodim
        buyerId: user.role === "PROCUREMENT" ? user.id : null,
        carrier: d.carrier || null, loadedFrom: d.loadedFrom || null, autoIssueToId: d.autoIssueToId || null,
        // Darhol to'lash — faqat direktor (`createGoodsReceipt` boshqa rolda e'tiborsiz qoldiradi)
        cashAccountId: user.role === "DIRECTOR" ? d.cashAccountId || null : null,
        clientToken: token, items,
      }, { userId: user.id, role: user.role });
      return {
        key: "receipts", id: r.id,
        message: r.existed ? `${r.docNo} allaqachon saqlangan` : `Kirim ${r.docNo} saqlandi — skladdagi qoldiq oshdi${blank.length ? ` · «Dona narxi» bo'yicha narx: ${blank.length} qator` : ""}`,
      };
    }
    // ── Sklad → «Chiqim»: oluvchiga yoki brigadaga berish — `issueStock` (lockStock, qoldiq tanlangan sklad bo'yicha) ──
    if (key === "rasxod") {
      const p = RasxodBody.safeParse(payload);
      if (!p.success) throw new Error(skladIssue(p.error));
      const d = p.data;
      const to = parseIssueTarget(d.to);
      if (!to) throw new IssueError("Kimga berilishini tanlang («Kimga»)");
      const items = d.items.map((i) => ({ materialId: i.materialId, qty: i.qty }));
      const token = issueToken(d.clientToken);
      // Yaroqli kalit bo'lsa — faqat server himoyasi (`issueStock`, unique); yo'q bo'lsa — 3 daqiqalik evristika
      const dup = token ? null : await recentIssue(user.id, d, to, items);
      // Kartochka — berish hujjati (`detail.ts` → `rasxod`, id = ref): nima, kimga, qancha, qaysi narxda
      if (dup) return { key: "rasxod", id: dup, message: "Xuddi shunday chiqim hozirgina saqlangan — qayta yozilmadi" };
      const r = await issueStock({ warehouseId: d.warehouseId, date: d.date || null, to, items, note: d.note || null, clientToken: token }, { userId: user.id, role: user.role });
      return { key: "rasxod", id: r.ref, message: r.existed ? "Bu chiqim allaqachon saqlangan" : `Chiqim saqlandi: ${r.count} ta xomashyo — skladdagi qoldiq kamaydi` };
    }

    // ── Mexanik so'rovi ("Kirim"): transport / zavod / boshqa — `createMechanicRequest` (veb bilan bitta qoida) ──
    if (KIRIM_FORMS.has(key)) {
      const p = KirimBody.safeParse(payload);
      if (!p.success) throw new Error(p.error.issues[0]?.message ?? "Ma'lumot to'liq emas");
      const d = p.data;
      const target = key === "kirim-transport" ? "TRANSPORT" : key === "kirim-zavod" ? "FACTORY" : "OTHER";
      // Zavod: "Boshqa" obyekt — izohi bilan bitta matn ("Boshqa: tarozi")
      const object = target === "FACTORY" && d.object === "Boshqa" ? (d.objectNote ? `Boshqa: ${d.objectNote}` : "") : d.object;
      if (target === "FACTORY" && d.object === "Boshqa" && !d.objectNote) throw new Error("Qaysi obyekt ekanini yozing");
      const photo = d.photo ? dataUrlFile(d.photo, "surat") : null;
      if (d.photo && !photo) throw new Error("Surat o'qilmadi — qayta oling");
      const r = await createMechanicRequest({
        target, vehicleId: d.vehicleId || null, object: object || null, problem: d.problem || null,
        amount: d.amount, note: d.note, urgent: !!d.urgent, photo, clientToken: typeof d.clientToken === "string" ? d.clientToken : null,
      }, user.id);
      if (r.error || !r.id) throw new Error(r.error ?? "Saqlanmadi");
      return { key: "kirim", id: r.id, message: r.existed ? `${r.docNo} allaqachon yuborilgan` : "So'rov yuborildi — ish boshqaruvchi tasdig'ini kutmoqda" };
    }

    if (key === "orders") {
      const p = OrderBody.safeParse(payload);
      if (!p.success) throw new Error(p.error.issues[0]?.message ?? "Ma'lumot to'liq emas");
      const d = p.data;
      const isNew = d.customerId === NEW_CUSTOMER;
      // Sotuv agenti: yangi mijoz ocholmaydi va faqat O'Z mijoziga zayavka ochadi (ownership)
      const isAgent = user.role === "AGENT";
      if (isAgent) {
        if (isNew) throw new Error("Agent yangi mijoz qo'sha olmaydi — mavjud (o'zingizga biriktirilgan) mijozni tanlang");
        const c = await db.customer.findUnique({ where: { id: d.customerId }, select: { agentId: true } });
        if (!c || c.agentId !== user.id) throw new Error("Bu mijoz sizga biriktirilmagan — faqat o'z mijozingizga zayavka ocha olasiz");
      }
      // Shartnoma (veb «Shartnoma qilish»): summa majburiy; imzolangan fayl zayavka id'si bo'yicha saqlanadi — id oldindan
      const withContract = !isAgent && !!d.hasContract;
      if (withContract && !(d.contractAmount && d.contractAmount > 0)) throw new Error("Shartnoma summasini kiriting");
      const orderId = crypto.randomUUID();
      let contractFile: { stored: string; name: string; type: string } | undefined;
      if (withContract && d.contractFile) {
        const f = dataUrlFile(d.contractFile, "shartnoma");
        if (!f) throw new Error("Shartnoma surati o'qilmadi — qayta oling");
        const saved = await saveContractFile(orderId, f);
        if (saved && "error" in saved) throw new Error(saved.error);
        contractFile = saved ?? undefined;
      }
      const r = await createOrder({
        customerId: isNew ? undefined : d.customerId,
        newCustomer: isNew ? { name: d.newName ?? "", phone: d.newPhone || undefined, inn: d.newInn || undefined } : undefined,
        deliveryDate: new Date(`${d.deliveryDate}T00:00:00`),
        deliveryAddress: d.deliveryAddress,
        // Narx NDS'siz kiritiladi; «NDS 12%» tanlangan qatorda soliq qo'shib saqlanadi (veb `createOrder` bilan bir xil)
        items: d.items.map((i) => {
          const nds = !isAgent && i.nds === "1";
          return { productId: i.productId, qtyM3: i.qtyM3, price: nds ? withNds(i.price) : i.price, nds };
        }),
        needsPump: d.needsPump,
        needsDelivery: isAgent ? undefined : d.needsDelivery,
        deliveryFee: isAgent || d.needsDelivery === false ? 0 : d.deliveryFee,
        isUrgent: d.isUrgent,
        contractAmount: withContract ? d.contractAmount : undefined,
        // Agent uchun to'lov maydonlari e'tiborsiz (veb `createAgentOrder` kabi — naqd, pul qabul so'rovi ochilmaydi)
        onCredit: isAgent ? false : d.onCredit,
        prepay: !isAgent && d.prepayAmount ? { amount: d.prepayAmount, cashAccountId: d.prepayAccountId ?? "" } : undefined,
        // Qarzga + bosh to'lovsiz — usul yozilmaydi (veb bilan bir xil)
        payMethod: isAgent ? undefined : !d.onCredit || d.prepayAmount ? d.payMethod : undefined,
        note: d.note,
      }, user.id, isAgent ? { viaAgent: true } : { id: orderId, contractFile });
      return { key: "orders", id: r.id, message: `${r.orderNo} ochildi — qoralama holatida, qabul qilishni unutmang` };
    }

    if (key === "supply") {
      const p = SupplyBody.safeParse(payload);
      if (!p.success) throw new Error(p.error.issues[0]?.message ?? "Ma'lumot to'liq emas");
      const mats = await db.material.findMany({ where: { id: { in: p.data.items.map((i) => i.materialId) } }, select: { id: true, name: true, unit: true } });
      const byId = new Map(mats.map((m) => [m.id, m]));
      const r = await createSupplyRequest({
        warehouseId: p.data.warehouseId, needBy: p.data.needBy || null, note: p.data.note || null,
        department: p.data.department && (DEPARTMENTS as readonly string[]).includes(p.data.department) ? p.data.department : null,
        priority: p.data.priority ?? "NORMAL",
        items: p.data.items.map((i) => { const m = byId.get(i.materialId); return { materialId: m?.id ?? null, name: m?.name ?? "", unit: m?.unit ?? "dona", qty: i.qty, note: i.note || null }; }),
      }, user.id);
      if (r.error || !r.id) throw new Error(r.error ?? "Saqlanmadi");
      return { key: "supply", id: r.id, message: `${r.docNo} ochildi — snabjeniye narx qo'yadi` };
    }
    if (key === "customers") {
      const p = CustomerBody.safeParse(payload);
      if (!p.success) throw new Error(p.error.issues[0]?.message ?? "Ma'lumot to'liq emas");
      const d = p.data;
      if (d.inn && (await db.customer.findUnique({ where: { inn: d.inn } }))) throw new Error("Bu INN bilan mijoz allaqachon bor");
      // Mobil formada limit maydoni yo'q — yangi mijozga standart limit (Sozlamalar → Limitlar)
      const c = await db.customer.create({ data: { name: d.name, phone: d.phone || null, inn: d.inn || null, address: d.address || null, creditLimit: await defaultCreditLimit() } });
      await audit(db, user.id, "CREATE", "Customer", c.id, undefined, c);
      syncCustomerLater(c.id);
      return { key: "customers", id: c.id, message: `${c.name} qo'shildi` };
    }
    if (key === "suppliers") {
      const p = SupplierBody.safeParse(payload);
      if (!p.success) throw new Error(p.error.issues[0]?.message ?? "Ma'lumot to'liq emas");
      const d = p.data;
      const sup = await db.supplier.create({ data: { name: d.name, phone: d.phone || null, address: d.address || null } });
      await audit(db, user.id, "CREATE", "Supplier", sup.id, undefined, sup);
      return { key: "suppliers", id: sup.id, message: `${sup.name} qo'shildi` };
    }
    if (key === "materials") {
      const p = MaterialBody.safeParse(payload);
      if (!p.success) throw new Error(p.error.issues[0]?.message ?? "Ma'lumot to'liq emas");
      const d = p.data;
      // Bir nom — bitta xomashyo: bor bo'lsa (arxivda bo'lsa — tiklab) o'shani qaytaramiz, dublikat ochilmaydi
      const same = await db.material.findFirst({ where: { name: { equals: d.name, mode: "insensitive" } } });
      let m = same;
      if (same && !same.isActive) {
        m = await db.material.update({ where: { id: same.id }, data: { isActive: true } });
        await audit(db, user.id, "UPDATE", "Material", same.id, { isActive: false }, { isActive: true, via: "mobile" });
      }
      if (!m) {
        const base = codeFromName(d.name);
        let code = base;
        for (let n = 2; await db.material.findUnique({ where: { code }, select: { id: true } }); n++) code = `${base.slice(0, 13)}-${n}`;
        m = await db.material.create({ data: { code, name: d.name, unit: d.unit, minStock: d.minStock ?? 0, isActive: true } });
        await audit(db, user.id, "CREATE", "Material", m.id, undefined, { ...m, via: "mobile" });
      }
      const bal = same ? Number((await db.stockMove.aggregate({ where: { materialId: m.id }, _sum: { qty: true } }))._sum.qty ?? 0) : 0;
      return {
        key: "stock", id: m.id, option: supplyMaterialOption(m, bal),
        message: same ? `${m.name} spravochnikda bor edi${same.isActive ? "" : " — arxivdan tiklandi"}` : `${m.name} qo'shildi`,
      };
    }
    if (key === "brigades") {
      const p = BrigadeBody.safeParse(payload);
      if (!p.success) throw new Error(p.error.issues[0]?.message ?? "Ma'lumot to'liq emas");
      const d = p.data;
      // Veb «Brigadalar» formasi bilan bitta qoida (`lib/brigades.ts`): brigadir — ishlayotgan xodim
      const r = await saveBrigade(null, { name: d.name, leaderId: d.leaderId || null, phone: d.phone || null, note: d.note || null }, user.id);
      if ("error" in r) throw new Error(r.error);
      return { key: "brigades", id: r.id, message: `${d.name} ochildi` };
    }
    if (key === "payments") {
      const p = PaymentBody.safeParse(payload);
      if (!p.success) throw new Error(p.error.issues[0]?.message ?? "Ma'lumot to'liq emas");
      const d = p.data;
      const [kind, refId] = d.link ? d.link.split(":", 2) : [];
      if (d.link && !(refId && (kind === "inv" || kind === "ord"))) throw new Error("Schyot yoki zayavka noto'g'ri tanlangan");
      // Qoidalar (qulf, mijoz mosligi, qoldiq, avans, dublikat) — veb bilan bitta joyda: `addPayment`
      const r = await addPayment({
        customerId: d.customerId,
        invoiceId: kind === "inv" ? refId : null,
        orderId: kind === "ord" ? refId : null,
        cashAccountId: d.cashAccountId,
        amount: d.amount,
        date: cashDate(d.date),
        note: [d.method ? `Usul: ${d.method}` : null, d.note || null].filter(Boolean).join(" · ") || null,
      }, user.id);
      if (r.error || !r.id) throw new Error(r.error ?? "Saqlanmadi");
      return {
        key: "payments", id: r.id,
        message: r.invoiceStatus === "PAID" ? `${money(d.amount)} qabul qilindi — schyot yopildi`
          : kind === "inv" ? `${money(d.amount)} qabul qilindi — schyot qisman to'landi`
          : kind === "ord" ? `${money(d.amount)} avans zayavkaga yozildi`
          : `${money(d.amount)} qabul qilindi — avans (schyotga bog'lanmagan)`,
      };
    }
    if (key === "cashflow") {
      const p = CashBody.safeParse(payload);
      if (!p.success) throw new Error(p.error.issues[0]?.message ?? "Ma'lumot to'liq emas");
      const d = p.data;
      const expense = d.type === "EXPENSE";
      const category = (expense ? d.categoryExpense : d.categoryIncome) || d.category;
      if (!category || !(await categoryOptions(expense ? "EXPENSE" : "INCOME")).some((c) => c.name === category)) throw new Error("Kategoriya tanlanmagan");
      // Qoidalar (qulf, kirim hujjati qoldig'i, kassa minusi/overdraft, dublikat) — veb bilan bitta joyda
      const r = await createCashEntry({
        type: d.type, date: cashDate(d.date), cashAccountId: d.cashAccountId, amount: d.amount, category,
        counterparty: d.counterparty || null,
        supplierId: expense ? d.supplierId || null : null,
        receiptId: expense ? d.receiptId || null : null,
        note: d.note || null,
      }, user.id);
      if (r.error || !r.id) throw new Error(r.error ?? "Saqlanmadi");
      return { key: "cashflow", id: r.id, message: `${expense ? "Chiqim" : "Kirim"} saqlandi: ${money(d.amount)} · ${category}` };
    }
    if (key === "transfer") {
      const p = TransferBody.safeParse(payload);
      if (!p.success) throw new Error(p.error.issues[0]?.message ?? "Ma'lumot to'liq emas");
      const d = p.data;
      const fee = d.fee && d.fee > 0 ? d.fee : null;
      // Qoidalar (qulf, qoldiq, dublikat: kalit bo'yicha va 60 s oynasi — qulf ichida) — veb bilan bitta joyda: `createTransfer`
      const r = await createTransfer({ date: cashDate(d.date), fromAccountId: d.fromAccountId, toAccountId: d.toAccountId, amount: d.amount, fee, note: d.note || null, clientToken: d.clientToken ?? null }, user.id);
      if (r.error || !r.id) throw new Error(r.error ?? "Saqlanmadi");
      // Kartochka — manba hisobdagi yozuv (Kirim-chiqim kartochkasi o'tkazmani ko'rsatadi)
      const out = await db.cashTransaction.findFirst({ where: { refType: TRANSFER_REF, refId: r.id, type: "TRANSFER_OUT" }, select: { id: true } });
      return { key: "cashflow", id: out?.id ?? r.id, message: r.duplicate ? `${r.docNo} allaqachon saqlangan (qayta yuborildi)` : `${r.docNo} saqlandi: ${money(d.amount)}` };
    }

    if (key !== "trips") throw new ListError("UNKNOWN_FORM", "Bunday forma yo'q", 404);
    const p = TripBody.safeParse(payload);
    if (!p.success) throw new Error(p.error.issues[0]?.message ?? "Ma'lumot to'liq emas");
    const r = await createTrip({ ...p.data, plannedAt: plannedAtOf(payload as Record<string, unknown>) }, user.id);
    // Haydovchi ilovasiga darhol yuborish — reys kartochkasi ochilganda holat ko'rinsin
    if (ecoEnabled()) {
      const push = await pushTripToEco(r.id);
      if (push.error) return { key: "trips", id: r.id, message: `${r.deliveryNoteNo} ochildi. ${push.error}` };
    }
    return { key: "trips", id: r.id, message: `${r.deliveryNoteNo} ochildi va haydovchi ilovasiga yuborildi` };
  } catch (e) {
    if (e instanceof ListError) throw e;
    // Prisma xatosi (so'rov, ustun, constraint tafsiloti) mijozga ko'rsatilmaydi — faqat jurnalga.
    // Biznes xatolari (`throw new Error("...")`, PaymentError va sh.k.) matni o'zgarmay qaytadi.
    if (isPrismaError(e)) {
      console.error("[mobile-create]", key, e);
      throw new ListError("CREATE_FAILED", "Saqlanmadi — ma'lumotni tekshirib, qayta urinib ko'ring", 400);
    }
    throw new ListError("CREATE_FAILED", (e as Error).message, 400);
  }
}

/** Prisma mijoz xatolari: `PrismaClient*Error` sinflari yoki `P1234` kodi. */
function isPrismaError(e: unknown): boolean {
  const x = e as { name?: unknown; code?: unknown } | null;
  return !!x && ((typeof x.name === "string" && x.name.startsWith("PrismaClient")) || (typeof x.code === "string" && /^P\d{4}$/.test(x.code)));
}
