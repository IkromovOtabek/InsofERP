import { z } from "zod";
import { driverPositionNames } from "@/lib/positions";
import { db } from "@/lib/db";
import { productCatalog, groupPath } from "@/lib/product-catalog";
import { createOrder } from "@/lib/orders";
import { createTrip, READINESS_INCLUDE, orderReadiness } from "@/lib/trips";
import { customersCredit, blacklistedIds, customerMarks, markedName } from "@/lib/finance";
import { ADVANCE_ORDER_STATUSES, accountBalances, addPayment, expectedAdvance } from "@/lib/payments";
import { createCashEntry } from "@/lib/cash-entry";
import { createTransfer } from "@/lib/cash-transfer";
import { TRANSFER_REF } from "@/lib/cash-tx";
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES } from "@/lib/cash-categories";
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
import { unitLabel } from "@/lib/unit";
import { canDo } from "@/lib/permissions";
import type { Role } from "@/generated/prisma";

const WEEKDAYS = ["Yak", "Dush", "Sesh", "Chor", "Pay", "Jum", "Shan"];
const isoDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/**
 * 10 kunlik ish tartibi — veb `orders/load-calendar.tsx` bilan bir xil hisob, faqat
 * ro'yxatsiz (mobilda kartochka ochilmaydi, faqat rang va hajm — sana tanlashda yo'l ko'rsatadi).
 * Kunlik quvvat: Sozlamalar → «Kunlik quvvat (m³)» (sukut 200).
 */
async function dayCells(days = 10): Promise<DayCell[]> {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const until = new Date(today); until.setDate(until.getDate() + days);
  const [orders, settings] = await Promise.all([
    db.order.findMany({
      where: { status: { not: "CANCELLED" }, deliveryDate: { gte: today, lt: until } },
      select: { deliveryDate: true, items: { select: { qtyM3: true, product: { select: { unit: true } } } } },
    }),
    db.companySettings.findUnique({ where: { id: "main" }, select: { dailyCapacityM3: true } }),
  ]);
  const capacity = Math.max(1, Number(settings?.dailyCapacityM3 ?? 200));
  const byDay = new Map<string, { m3: number; count: number }>();
  for (const o of orders) {
    const key = isoDate(o.deliveryDate);
    // Faqat beton (m³) — ustun/donali mahsulot kunlik ishlab chiqarish quvvatini band qilmaydi
    const m3 = o.items.reduce((s, i) => s + (i.product.unit === "m3" ? Number(i.qtyM3) : 0), 0);
    const cur = byDay.get(key) ?? { m3: 0, count: 0 };
    byDay.set(key, { m3: cur.m3 + m3, count: cur.count + 1 });
  }
  return Array.from({ length: days }, (_, n) => {
    const d = new Date(today); d.setDate(d.getDate() + n);
    const key = isoDate(d);
    const day = byDay.get(key) ?? { m3: 0, count: 0 };
    return {
      key, label: n === 0 ? "Bugun" : n === 1 ? "Ertaga" : `${d.getDate()}.${String(d.getMonth() + 1).padStart(2, "0")}`,
      weekday: WEEKDAYS[d.getDay()], m3: day.m3, pct: Math.min(100, (day.m3 / capacity) * 100), count: day.count, isToday: n === 0,
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
export type CreateForm = { key: string; title: string; submitLabel: string; fields: FormField[] };

/** Kim qaysi hujjatni ocha oladi — veb ERP bilan bir xil. */
export const CREATE_ROLES: Record<string, { roles: Role[]; title: string; label: string }> = {
  // AGENT ham zayavka ochadi, lekin faqat o'z mijoziga (ownership `mobileCreate` da tekshiriladi)
  orders: { roles: ["SALES", "AGENT"], title: "Yangi zayavka", label: "Zayavka ochish" },
  trips: { roles: ["LOGISTICS", "PRODUCTION"], title: "Yangi reys", label: "Reys ochish" },
  // Ta'minot so'rovi — sklad kerakli mahsulotlar jadvalini tuzadi (veb `/stock/supply/new`)
  supply: { roles: ["WAREHOUSE", "PROCUREMENT", "PRODUCTION"], title: "Ta'minot so'rovi", label: "Ta'minot so'rash" },
  customers: { roles: ["SALES", "ACCOUNTING", "FINANCE"], title: "Yangi mijoz", label: "Mijoz qo'shish" },
  suppliers: { roles: ["WAREHOUSE", "PROCUREMENT", "ACCOUNTING"], title: "Yangi yetkazuvchi", label: "Yetkazuvchi qo'shish" },
  brigades: { roles: ["SUPERVISOR", "PRODUCTION", "HR"], title: "Yangi brigada", label: "Brigada ochish" },
  // Kassa: veb `/payments` va `/cashflow` formalari bilan bir xil qoida (`lib/payments.ts`, `lib/cash-entry.ts`,
  // `lib/cash-transfer.ts`). Rol ro'yxati — kim formani ko'rishi mumkinligi; aniq ruxsat `CREATE_PERM` (strict) da.
  payments: { roles: ["CASHIER", "ACCOUNTING", "FINANCE"], title: "To'lov qabul qilish", label: "To'lov qabul qilish" },
  cashflow: { roles: ["CASHIER", "ACCOUNTING", "FINANCE"], title: "Kirim / chiqim", label: "Kirim / chiqim" },
  transfer: { roles: ["CASHIER", "ACCOUNTING", "FINANCE"], title: "Kassa ⇄ bank o'tkazma", label: "Kassa ⇄ bank" },
};

// Direktor hujjat ochmaydi — zayavka sotuvchining, reys dispetcherning ishi; u nazorat qiladi.
// Direktor bergan ruxsat (`User.perms`) faqat CHEKLAYDI: modul "yo'q"/"ko'rish" yoki amal ro'yxatda bo'lmasa — vebdagi
// kabi forma ham, yaratish ham rad etiladi. (Ilgari faqat rol tekshirilardi — "faqat ko'rish" sotuvchi ilovadan zayavka ochardi.)
// `strict` — vebdagi `requireAction(module, action)` bilan aynan bir xil: `canDo` (rol standarti + direktor ruxsati).
// Masalan Moliya (FINANCE) vebda to'lov qabul qilmaydi — ilovada ham, direktor `payments: create` bermaguncha.
const CREATE_PERM: Record<string, { module: string; action?: string; strict?: boolean }> = {
  orders: { module: "orders", action: "create" },
  trips: { module: "trips", action: "create" },
  supply: { module: "taminot" },
  customers: { module: "customers", action: "edit" },
  suppliers: { module: "stock", action: "suppliers" },
  brigades: { module: "tasks", action: "brigade" },
  payments: { module: "payments", action: "create", strict: true },
  cashflow: { module: "cashflow", action: "create", strict: true },
  transfer: { module: "cashflow", action: "transfer", strict: true },
};

export const canCreate = (user: MobileUser, key: string) => {
  if (!Object.hasOwn(CREATE_ROLES, key) || !CREATE_ROLES[key].roles.includes(user.role)) return false; // prototip kalitlari ("constructor") — forma emas
  const p = CREATE_PERM[key];
  if (p?.strict && p.action) return canDo({ role: user.role, perms: user.perms }, p.module, p.action);
  const lvl = p && user.perms?.[p.module];
  if (!lvl) return true; // direktor bu modulga alohida ruxsat bermagan — rol bo'yicha
  if (lvl === "none" || lvl === "view") return false;
  return p.action ? canDo({ role: user.role, perms: user.perms }, p.module, p.action) : true;
};

const NEW_CUSTOMER = "__new__";
const money = (n: number) => `${Math.round(n).toLocaleString("ru-RU")} so'm`;
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// ───────────────────────── Forma tavsifi ─────────────────────────

export async function mobileForm(user: MobileUser, key: string): Promise<CreateForm> {
  if (!Object.hasOwn(CREATE_ROLES, key)) throw new ListError("UNKNOWN_FORM", "Bunday forma yo'q", 404);
  if (!canCreate(user, key)) throw new ListError("FORBIDDEN", "Bu hujjatni ochishga ruxsatingiz yo'q", 403);
  switch (key) {
    case "orders": return orderForm(user);
    case "trips": return tripForm();
    case "supply": return supplyForm(user);
    case "customers": return customerForm();
    case "suppliers": return supplierForm();
    case "payments": return paymentForm();
    case "cashflow": return cashForm();
    case "transfer": return transferForm();
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
      select: { id: true, orderNo: true, customerId: true, prepayAmount: true, customer: { select: { name: true } }, items: { select: { qtyM3: true, price: true } }, payments: { where: { invoiceId: null }, select: { amount: true } } },
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
    const total = o.items.reduce((s, i) => s + Number(i.qtyM3) * Number(i.price), 0);
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
  const [acc, suppliers, unpaid] = await Promise.all([
    cashAccountOptions(),
    db.supplier.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    unpaidReceipts(),
  ]);
  const expense = { field: "type", equals: "EXPENSE" }, income = { field: "type", equals: "INCOME" };
  return {
    key: "cashflow", title: "Kirim / chiqim", submitLabel: "Saqlash",
    fields: [
      { name: "type", label: "Turi", type: "select", required: true, value: "EXPENSE", options: [{ value: "EXPENSE", label: "Chiqim (pul chiqdi)" }, { value: "INCOME", label: "Kirim (pul kirdi)" }] },
      { name: "cashAccountId", label: "Kassa / hisob", type: "select", required: true, options: acc.options, value: acc.cash, hint: "Naqd kassa qoldiqdan oshib chiqim qilmaydi" },
      { name: "amount", label: "Summa (so'm)", type: "number", required: true, placeholder: "0" },
      { name: "categoryExpense", label: "Kategoriya", type: "select", required: true, value: EXPENSE_CATEGORIES[0], options: EXPENSE_CATEGORIES.map((c) => ({ value: c, label: c })), showIf: expense },
      { name: "categoryIncome", label: "Kategoriya", type: "select", required: true, value: INCOME_CATEGORIES[0], options: INCOME_CATEGORIES.map((c) => ({ value: c, label: c })), showIf: income },
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
      { name: "department", label: "Bo'lim (kim so'rayapti)", type: "select", options: DEPARTMENTS.map((d) => ({ value: d, label: d })), value: user.role === "PRODUCTION" ? "Ishlab chiqarish" : user.role === "WAREHOUSE" ? "Sklad" : undefined },
      { name: "priority", label: "Ustuvorlik", type: "select", required: true, value: "NORMAL", options: PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABEL[p] })), hint: "Kritik — ishlab chiqarish to'xtab qolishi mumkin" },
      { name: "needBy", label: "Qachongacha kerak", type: "date" },
      {
        name: "items", label: "Kerakli mahsulotlar", type: "items", required: true,
        columns: [
          // Qoldiq nom yonida — kam qolganini ko'rib so'raydi. Birlik xomashyodan olinadi (`extra`).
          { name: "materialId", label: "Xomashyo", type: "select", required: true, options: materials.map((m) => ({ value: m.id, label: `${m.name} · qoldiq ${(bal.get(m.id) ?? 0).toFixed(1)} ${m.unit}${(bal.get(m.id) ?? 0) < Number(m.minStock) ? " · kam qolgan" : ""}`, extra: { unit: m.unit } })) },
          { name: "qty", label: "Miqdor", type: "number", required: true, placeholder: "0" },
          { name: "note", label: "Izoh (marka, o'lcham…)", type: "text" },
        ],
      },
      { name: "note", label: "Izoh", type: "text", hint: "Spravochnikda yo'q mahsulotni vebdagi Sklad bo'limidan so'rang" },
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
      { name: "inn", label: "INN", type: "text", placeholder: "9 raqam" },
    ],
  };
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

async function orderForm(user: MobileUser): Promise<CreateForm> {
  // Sotuv agenti faqat o'z mijoziga zayavka ochadi: ro'yxat o'ziga biriktirilganlar, yangi mijoz tugmasi yo'q
  const isAgent = user.role === "AGENT";
  const [customers, catalog, cells] = await Promise.all([
    db.customer.findMany({ where: { isActive: true, isInternal: false, ...(isAgent ? { agentId: user.id } : {}) }, orderBy: { name: "asc" } }),
    productCatalog(), // veb bilan bir xil mahsulot ro'yxati (papka yo'li nom yonida)
    dayCells(),
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
      { name: "deliveryDate", label: "Yetkazish sanasi", type: "date", required: true, value: ymd(tomorrow), cells, hint: "Ustun rangi shu kunga qancha beton olinganini ko'rsatadi" },
      { name: "deliveryAddress", label: "Obyekt manzili", type: "text", required: true, placeholder: "Tuman, ko'cha, mo'ljal" },
      {
        name: "items", label: "Mahsulot", type: "items", required: true,
        columns: [
          // Birlik mahsulot nomi yonida turadi: hajm va narx shu birlikda kiritiladi (beton m³, ustun/blok dona)
          { name: "productId", label: "Mahsulot", type: "select", required: true, options: catalog.products.map((p) => { const path = groupPath(catalog.groups, p.groupId); return { value: p.id, label: `${path ? `${path} › ` : ""}${p.name} · ${p.unit}`, extra: { price: String(Math.round(Number(p.price))) } }; }) },
          { name: "qtyM3", label: "Hajmi (mahsulot birligida)", type: "number", required: true, placeholder: "0" },
          { name: "price", label: "Narx (1 birlik)", type: "number", required: true, placeholder: "0" },
        ],
      },
      { name: "needsPump", label: "Nasos kerak", type: "switch", value: "false" },
      { name: "isUrgent", label: "Shoshilinch", type: "switch", value: "false" },
      { name: "onCredit", label: "Qarzga", type: "switch", value: "false", hint: "Belgilansa kafolat xati talab qilinadi, oldindan to'lov olinmaydi" },
      // Sotuvchi kassaga pul yozmaydi: summa "kutilayotgan avans" bo'lib zayavkaga yoziladi, kassir o'zi qabul qiladi
      { name: "prepayAmount", label: "Kutilayotgan avans (so'm)", type: "number", placeholder: "0", showIf: { field: "onCredit", equals: "false" } },
      { name: "note", label: "Izoh", type: "text" },
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
        options: open.map(({ o, left, sexda, unit }) => ({ value: o.id, label: `${o.orderNo} · ${o.customer.name} · tayyor ${left}${unit ? ` ${unitLabel(unit)}` : ""}${sexda > 0 ? ` · sexda ${sexda}` : ""}`, extra: { qtyM3: String(left) } })),
        hint: open.length ? "Faqat brigada tayyorlab bergan miqdor reysga beriladi; sexdagisi brigada tasdiqidan keyin" : "Brigada tayyorlagan mahsuloti bor zayavka yo'q — brigada tasdiqini kuting",
      },
      {
        name: "vehicleId", label: "Texnika", type: "select", required: true,
        options: vehicles.map((v) => ({ value: v.id, label: `${v.plate} · ${v.type === "MIXER" ? "mikser" : "yuk mashina"}${v.capacityM3 ? ` · ${v.capacityM3} m³` : ""}` })),
        hint: "Beton — mikser, dona mahsulot (plita, blok) — yuk mashina",
      },
      {
        name: "driverId", label: "Haydovchi", type: "select", required: true,
        options: drivers.map((d) => ({ value: d.id, label: `${d.fullName}${d.vehicle ? ` · ${d.vehicle.plate}` : " · texnikasiz"}${normalizePhone(d.phone) ? "" : " · telefonsiz"}`, extra: d.vehicleId ? { vehicleId: d.vehicleId } : undefined })),
        hint: "Haydovchining biriktirilgan texnikasi yonida ko'rsatiladi; telefoni yo'q haydovchi ilovada reysni ko'rmaydi",
      },
      { name: "qtyM3", label: "Hajmi (zayavka birligida)", type: "number", required: true, placeholder: "0" },
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
  })).min(1, "Kamida bitta mahsulot qatori kerak"),
  needsPump: z.coerce.boolean().optional(),
  isUrgent: z.coerce.boolean().optional(),
  onCredit: z.coerce.boolean().optional(),
  prepayAmount: z.coerce.number().min(0).optional(),
  prepayAccountId: z.string().trim().optional(),
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
const SupplierBody = z.object({ name: z.string().trim().min(2, "Yetkazuvchi nomi kerak"), phone: z.string().trim().optional(), inn: z.string().trim().optional() });
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
});

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

/** Bir xil o'tkazma shu oraliqda qayta kelsa — ikki marta bosilgan (veb formadagi `clientToken` o'rniga). */
const TRANSFER_DUP_MS = 60_000;

export type CreateResult = { key: string; id: string; message: string };

export async function mobileCreate(user: MobileUser, key: string, payload: unknown): Promise<CreateResult> {
  if (!Object.hasOwn(CREATE_ROLES, key)) throw new ListError("UNKNOWN_FORM", "Bunday forma yo'q", 404);
  if (!canCreate(user, key)) throw new ListError("FORBIDDEN", "Bu hujjatni ochishga ruxsatingiz yo'q", 403);

  try {
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
      const r = await createOrder({
        customerId: isNew ? undefined : d.customerId,
        newCustomer: isNew ? { name: d.newName ?? "", phone: d.newPhone || undefined, inn: d.newInn || undefined } : undefined,
        deliveryDate: new Date(`${d.deliveryDate}T00:00:00`),
        deliveryAddress: d.deliveryAddress,
        items: d.items,
        needsPump: d.needsPump,
        isUrgent: d.isUrgent,
        onCredit: d.onCredit,
        prepay: d.prepayAmount ? { amount: d.prepayAmount, cashAccountId: d.prepayAccountId ?? "" } : undefined,
        note: d.note,
      }, user.id, isAgent ? { viaAgent: true } : undefined);
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
      const c = await db.customer.create({ data: { name: d.name, phone: d.phone || null, inn: d.inn || null, address: d.address || null } });
      await audit(db, user.id, "CREATE", "Customer", c.id, undefined, c);
      syncCustomerLater(c.id);
      return { key: "customers", id: c.id, message: `${c.name} qo'shildi` };
    }
    if (key === "suppliers") {
      const p = SupplierBody.safeParse(payload);
      if (!p.success) throw new Error(p.error.issues[0]?.message ?? "Ma'lumot to'liq emas");
      const d = p.data;
      if (d.inn && (await db.supplier.findUnique({ where: { inn: d.inn } }))) throw new Error("Bu INN bilan yetkazuvchi bor");
      const sup = await db.supplier.create({ data: { name: d.name, phone: d.phone || null, inn: d.inn || null } });
      await audit(db, user.id, "CREATE", "Supplier", sup.id, undefined, sup);
      return { key: "suppliers", id: sup.id, message: `${sup.name} qo'shildi` };
    }
    if (key === "brigades") {
      const p = BrigadeBody.safeParse(payload);
      if (!p.success) throw new Error(p.error.issues[0]?.message ?? "Ma'lumot to'liq emas");
      const d = p.data;
      const b = await db.brigade.create({ data: { name: d.name, leaderId: d.leaderId || null, phone: d.phone || null, note: d.note || null } });
      await audit(db, user.id, "CREATE", "Brigade", b.id, undefined, b);
      return { key: "brigades", id: b.id, message: `${b.name} ochildi` };
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
      if (!category || !(expense ? EXPENSE_CATEGORIES : INCOME_CATEGORIES).includes(category)) throw new Error("Kategoriya tanlanmagan");
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
      const recent = await db.cashTransfer.findFirst({
        where: { createdById: user.id, fromAccountId: d.fromAccountId, toAccountId: d.toAccountId, amount: Math.round(d.amount * 100) / 100, cancelledAt: null, createdAt: { gte: new Date(Date.now() - TRANSFER_DUP_MS) } },
        select: { docNo: true },
      });
      if (recent) throw new Error(`${recent.docNo} hozirgina saqlandi — ikki marta bosilgan bo'lishi mumkin. Rostdan ikkinchisi bo'lsa, bir daqiqadan keyin qayta kiriting`);
      const r = await createTransfer({ date: cashDate(d.date), fromAccountId: d.fromAccountId, toAccountId: d.toAccountId, amount: d.amount, fee, note: d.note || null }, user.id);
      if (r.error || !r.id) throw new Error(r.error ?? "Saqlanmadi");
      // Kartochka — manba hisobdagi yozuv (Kirim-chiqim kartochkasi o'tkazmani ko'rsatadi)
      const out = await db.cashTransaction.findFirst({ where: { refType: TRANSFER_REF, refId: r.id, type: "TRANSFER_OUT" }, select: { id: true } });
      return { key: "cashflow", id: out?.id ?? r.id, message: `${r.docNo} saqlandi: ${money(d.amount)}` };
    }

    const p = TripBody.safeParse(payload);
    if (!p.success) throw new Error(p.error.issues[0]?.message ?? "Ma'lumot to'liq emas");
    const r = await createTrip(p.data, user.id);
    // Haydovchi ilovasiga darhol yuborish — reys kartochkasi ochilganda holat ko'rinsin
    if (ecoEnabled()) {
      const push = await pushTripToEco(r.id);
      if (push.error) return { key: "trips", id: r.id, message: `${r.deliveryNoteNo} ochildi. ${push.error}` };
    }
    return { key: "trips", id: r.id, message: `${r.deliveryNoteNo} ochildi va haydovchi ilovasiga yuborildi` };
  } catch (e) {
    if (e instanceof ListError) throw e;
    throw new ListError("CREATE_FAILED", (e as Error).message, 400);
  }
}
