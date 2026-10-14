import type { PayMethod, PaymentRequestStatus, Prisma, Role } from "@/generated/prisma";
import { db } from "./db";
import { audit } from "./audit";
import { nextNo } from "./numbering";
import { money, date } from "./format";
import { notifyAfter, notifyRoles, notifyUsers } from "./notify";
import { canDo } from "./permissions";
import type { Perms } from "./auth";

/**
 * Pul qabul qilish so'rovi (PS-YYYY-00001) — zayavkaning bosh to'lovi uchun.
 *
 *   Sotuvchi zayavkani bosh to'lov bilan ochadi → so'rov avtomatik ochiladi (PENDING):
 *     CASH (naqd)          → Kassa xodimiga: «kassaga pul keladi — qabul qiling»;
 *     BANK (perechisleniye) → Buxgalterga: «bankka tushum kutilmoqda — tushganini tasdiqlang».
 *   Kassir / buxgalter «Pul qabul qilish» bo'limida qabul qiladi → `addPayment` (yagona to'lov qoidasi):
 *     hisob qoldig'i (kassa yoki bank), Kirim-Chiqim («Mijoz avansi»), debitorka va kredit limiti — bitta manbadan.
 *
 * `received` va holat (PENDING → PARTIAL → RECEIVED) — zayavkaga tushgan HAQIQIY to'lovlardan qayta hisoblanadi
 * (`syncPaymentRequest`; avans + zayavka schyotlariga to'lovlar — `prepayShortError` bilan bir qoida). Pul qaysi
 * yo'l bilan kiritilmasin (shu bo'lim, Kassa/bank formasi, ECO ilovasi, storno) — so'rov holati to'g'ri qoladi.
 * Zayavka bekor qilinsa — CANCELLED (tushgan avans mijozning ortiqcha to'lovi bo'lib qoladi, `orderCancel` izohi).
 */

type Tx = Prisma.TransactionClient;
const r2 = (n: number) => Math.round(n * 100) / 100;

export const PAY_METHOD_LABEL: Record<PayMethod, string> = { CASH: "Naqd (kassa)", BANK: "Perechisleniye (bank)" };
export const PAYREQ_STATUS_LABEL: Record<PaymentRequestStatus, string> = {
  PENDING: "Kutilmoqda", PARTIAL: "Qisman tushdi", RECEIVED: "Qabul qilindi", CANCELLED: "Bekor qilindi",
};
export const PAYREQ_STATUS_COLOR: Record<PaymentRequestStatus, "amber" | "blue" | "green" | "slate"> = {
  PENDING: "amber", PARTIAL: "blue", RECEIVED: "green", CANCELLED: "slate",
};
export const PAYREQ_STATUS_TONE: Record<PaymentRequestStatus, "warning" | "brand" | "success" | "info"> = {
  PENDING: "warning", PARTIAL: "brand", RECEIVED: "success", CANCELLED: "info",
};
export const OPEN_STATUSES: PaymentRequestStatus[] = ["PENDING", "PARTIAL"];

/** Ro'yxat filtrlari — veb tablari va ECO chiplari bir xil (Ishlab chiqarish bo'limidagidek). */
export const PAYREQ_TABS = [
  { key: "all", label: "Hammasi" },
  { key: "open", label: "Ochiq" },
  { key: "today", label: "Bugungilar" },
  { key: "overdue", label: "Muddati o'tgan" },
  { key: "done", label: "Tugallanganlar" },
  { key: "history", label: "Tarix" },
] as const;
export type PayReqTab = (typeof PAYREQ_TABS)[number]["key"];
export const payReqTab = (k?: string | null): PayReqTab => (PAYREQ_TABS.find((t) => t.key === k)?.key ?? "open");

/** So'rov usuli → qabul qiladigan rol (bildirishnoma) va amal (`lib/permissions.ts`, direktor ruxsat bilan boshqaga ham beradi). */
export const METHOD_ROLE: Record<PayMethod, Role> = { CASH: "CASHIER", BANK: "ACCOUNTING" };
export const METHOD_ACTION: Record<PayMethod, "receive_cash" | "receive_bank"> = { CASH: "receive_cash", BANK: "receive_bank" };

/** Foydalanuvchi qaysi usuldagi so'rovlarni ko'radi va qabul qiladi: kassir — naqd, buxgalter — bank, direktor — ikkalasi. */
export function methodsFor(s: { role: Role; perms?: Perms | null }): PayMethod[] {
  return (["CASH", "BANK"] as const).filter((m) => canDo({ role: s.role, perms: s.perms ?? undefined }, "payments", METHOD_ACTION[m]));
}

function dayBounds(now = new Date()) {
  const start = new Date(now); start.setHours(0, 0, 0, 0);
  const end = new Date(start); end.setDate(end.getDate() + 1);
  return { start, end };
}

/** Filtr sharti. «Muddati o'tgan» — yetkazish sanasi bugundan oldin, pul hali to'liq tushmagan. */
export function payReqWhere(tab: PayReqTab, methods: PayMethod[], opts: { q?: string; from?: Date; to?: Date } = {}): Prisma.PaymentRequestWhereInput {
  const { start, end } = dayBounds();
  const open = { status: { in: OPEN_STATUSES } };
  const byTab: Record<PayReqTab, Prisma.PaymentRequestWhereInput> = {
    all: {},
    open,
    today: { ...open, OR: [{ dueDate: { gte: start, lt: end } }, { createdAt: { gte: start, lt: end } }] },
    overdue: { ...open, dueDate: { lt: start } },
    done: { status: "RECEIVED" },
    history: { status: { in: ["RECEIVED", "CANCELLED"] }, ...(opts.from || opts.to ? { closedAt: { ...(opts.from ? { gte: opts.from } : {}), ...(opts.to ? { lte: opts.to } : {}) } } : {}) },
  };
  const q = opts.q?.trim();
  return {
    method: { in: methods },
    ...byTab[tab],
    ...(q ? { AND: [{ OR: [{ docNo: { contains: q, mode: "insensitive" } }, { order: { orderNo: { contains: q, mode: "insensitive" } } }, { customer: { name: { contains: q, mode: "insensitive" } } }] }] } : {}),
  };
}

/** Har filtr bo'yicha son — tab yonidagi raqam. */
export async function payReqCounts(methods: PayMethod[]): Promise<Record<PayReqTab, number>> {
  const keys = PAYREQ_TABS.map((t) => t.key);
  const ns = await Promise.all(keys.map((k) => db.paymentRequest.count({ where: payReqWhere(k, methods) })));
  return Object.fromEntries(keys.map((k, i) => [k, ns[i]])) as Record<PayReqTab, number>;
}

/** Ro'yxat qatori: so'rov + zayavka qisqacha (mahsulot, summa) — kassir zayavka sahifasiga kirmasa ham hammasini ko'radi. */
export async function listPaymentRequests(tab: PayReqTab, methods: PayMethod[], opts: { q?: string; from?: Date; to?: Date; take?: number; id?: string } = {}) {
  const rows = await db.paymentRequest.findMany({
    where: opts.id ? { id: opts.id, method: { in: methods } } : payReqWhere(tab, methods, opts),
    // Ochiqlar — muddati yaqini tepada; yopilganlar — oxirgi yopilgani tepada
    orderBy: tab === "done" || tab === "history" ? [{ closedAt: "desc" }] : tab === "all" ? [{ createdAt: "desc" }] : [{ dueDate: "asc" }, { createdAt: "asc" }],
    take: opts.take ?? 200,
    include: {
      customer: { select: { id: true, name: true, phone: true } },
      createdBy: { select: { fullName: true } },
      order: {
        select: {
          id: true, orderNo: true, status: true, deliveryDate: true, deliveryTime: true, onCredit: true,
          items: { select: { qtyM3: true, price: true, product: { select: { code: true, unit: true } } } },
          payments: { select: { id: true, amount: true, date: true, cashAccount: { select: { name: true, type: true } }, createdBy: { select: { fullName: true } } }, orderBy: { date: "asc" } },
          invoices: { where: { status: { not: "CANCELLED" } }, select: { payments: { select: { id: true, amount: true, date: true, cashAccount: { select: { name: true, type: true } }, createdBy: { select: { fullName: true } } } } } },
        },
      },
    },
  });
  const { start } = dayBounds();
  return rows.map((r) => {
    const total = r.order.items.reduce((s, i) => s + Number(i.qtyM3) * Number(i.price), 0);
    const amount = Number(r.amount), received = Number(r.received);
    const pays = [...r.order.payments, ...r.order.invoices.flatMap((i) => i.payments)].sort((a, b) => a.date.getTime() - b.date.getTime());
    return {
      id: r.id, docNo: r.docNo, method: r.method, status: r.status, amount, received, left: r2(Math.max(0, amount - received)),
      dueDate: r.dueDate, createdAt: r.createdAt, closedAt: r.closedAt, createdBy: r.createdBy.fullName,
      overdue: OPEN_STATUSES.includes(r.status) && r.dueDate < start,
      customer: r.customer, order: { id: r.order.id, orderNo: r.order.orderNo, status: r.order.status, deliveryTime: r.order.deliveryTime, onCredit: r.order.onCredit, total: r2(total), products: r.order.items.map((i) => i.product.code).join(", ") },
      payments: pays.map((p) => ({ id: p.id, amount: Number(p.amount), date: p.date, account: p.cashAccount.name, accountType: p.cashAccount.type, by: p.createdBy?.fullName ?? null })),
    };
  });
}
export type PayReqRow = Awaited<ReturnType<typeof listPaymentRequests>>[number];

/** Bitta so'rov (ECO kartochkasi, bildirishnoma havolasi) — faqat foydalanuvchi ko'radigan usulda. */
export async function getPaymentRequest(id: string, methods: PayMethod[]): Promise<PayReqRow | null> {
  return (await listPaymentRequests("all", methods, { id, take: 1 }))[0] ?? null;
}

/** Qabul uchun hisoblar: naqd so'rovga — faqat kassa (CASH), perechisleniyega — faqat bank (BANK). */
export async function receiveAccounts(method: PayMethod) {
  return db.cashAccount.findMany({ where: { isActive: true, type: method }, orderBy: { name: "asc" }, select: { id: true, name: true, type: true } });
}

// ───────────────────────── Yaratish / holatni yangilash / bekor qilish ─────────────────────────

/** Zayavka yaratilgan tranzaksiya ichida: bosh to'lov bo'lsa so'rov ochiladi. */
export async function createPaymentRequestTx(tx: Tx, o: { id: string; customerId: string; deliveryDate: Date }, method: PayMethod, amount: number, userId: string) {
  const r = await tx.paymentRequest.create({
    data: { docNo: await nextNo(tx, "paymentRequest", "PS"), orderId: o.id, customerId: o.customerId, method, amount: r2(amount), dueDate: o.deliveryDate, createdById: userId },
  });
  await audit(tx, userId, "CREATE", "PaymentRequest", r.id, undefined, r);
  return r;
}

/** Zayavkaga tushgan to'lovlar (avans + zayavka schyotlariga) — `prepayShortError` bilan bir qoida. */
async function orderPaid(tx: Tx, orderId: string): Promise<number> {
  const agg = await tx.payment.aggregate({ where: { OR: [{ orderId }, { invoice: { orderId } }] }, _sum: { amount: true } });
  return Number(agg._sum.amount ?? 0);
}

/**
 * To'lov yozilgan / storno qilingan / schyotga bog'langan tranzaksiya ichida chaqiriladi: so'rovning tushgan summasi va holati
 * haqiqiy to'lovlardan qayta hisoblanadi. Bekor qilingan so'rov o'zgarmaydi. Qaytaradi: yangi holat (so'rov bo'lmasa null).
 */
export async function syncPaymentRequest(tx: Tx, orderId: string | null | undefined, userId: string): Promise<PaymentRequestStatus | null> {
  if (!orderId) return null;
  const r = await tx.paymentRequest.findUnique({ where: { orderId } });
  if (!r || r.status === "CANCELLED") return r?.status ?? null;
  const paid = r2(await orderPaid(tx, orderId));
  const amount = Number(r.amount);
  const status: PaymentRequestStatus = paid >= amount - 0.005 ? "RECEIVED" : paid > 0.005 ? "PARTIAL" : "PENDING";
  const received = r2(Math.min(paid, amount));
  if (status === r.status && Math.abs(received - Number(r.received)) < 0.005) return status;
  await tx.paymentRequest.update({ where: { id: r.id }, data: { status, received, closedAt: status === "RECEIVED" ? (r.closedAt ?? new Date()) : null } });
  if (status !== r.status) await audit(tx, userId, "STATUS_CHANGE", "PaymentRequest", r.id, { status: r.status, received: Number(r.received) }, { status, received });
  return status;
}

/** Zayavka bekor qilinganda (shu tranzaksiyada): ochiq so'rov yopiladi. */
export async function cancelPaymentRequestTx(tx: Tx, orderId: string, userId: string) {
  const r = await tx.paymentRequest.updateMany({ where: { orderId, status: { in: OPEN_STATUSES } }, data: { status: "CANCELLED", closedAt: new Date() } });
  if (r.count) await audit(tx, userId, "STATUS_CHANGE", "PaymentRequest", orderId, undefined, { status: "CANCELLED", by: "order-cancel" });
}

// ───────────────────────── Bildirishnomalar ─────────────────────────

/** Yangi so'rov: naqd — kassirga, perechisleniye — buxgalterga (ECO push + veb kabinetdagi ro'yxat). */
export function notifyNewPaymentRequest(id: string, exceptUserId?: string) {
  notifyAfter(async () => {
    const r = await db.paymentRequest.findUnique({ where: { id }, include: { order: { select: { orderNo: true } }, customer: { select: { name: true } } } });
    if (!r) return;
    const sum = money(Number(r.amount));
    const due = date(r.dueDate);
    const n = r.method === "CASH"
      ? { title: `Kassaga pul keladi — ${sum}`, body: `${r.order.orderNo} · ${r.customer.name} naqd bosh to'lov olib keladi (yetkazish ${due}). Pul qo'lingizga tekkach «Pul qabul qilish»da bir bosishda qabul qiling.` }
      : { title: `Bankka tushum kutilmoqda — ${sum}`, body: `${r.order.orderNo} · ${r.customer.name} perechisleniye qiladi (yetkazish ${due}). Hisob raqamga tushgach «Pul qabul qilish»da tasdiqlang — bank qoldig'i va mijoz qarzi o'zi yangilanadi.` };
    await notifyRoles([METHOD_ROLE[r.method]], { type: "PAYMENT_REQUEST", ...n, link: { key: "payreq", id: r.id } }, { except: exceptUserId });
  });
}

// ───────────────────────── Qabul qilish ─────────────────────────

export type ReceiveInput = { requestId: string; cashAccountId: string; amount: number; date: Date; note?: string | null; docRef?: string | null };

/**
 * So'rov bo'yicha pulni qabul qilish. Tekshiruv va yozish `addPayment` ichida bitta tranzaksiyada (mijoz qulfi ostida):
 * so'rov ochiqligi, usul ↔ hisob turi (naqd → kassa, perechisleniye → bank), summa qolgan bosh to'lovdan oshmasligi.
 * Zayavkaga schyot yozilgan bo'lsa — pul o'sha schyotga tushadi (aks holda zayavka avansi).
 */
export async function receivePaymentRequest(input: ReceiveInput, s: { userId: string; role: Role; perms?: Perms | null }): Promise<{ error?: string; status?: PaymentRequestStatus | null; docNo?: string }> {
  const r = await db.paymentRequest.findUnique({
    where: { id: input.requestId },
    include: { order: { select: { id: true, orderNo: true, createdById: true, invoices: { where: { status: { in: ["OPEN", "PARTIAL"] } }, orderBy: { date: "asc" }, select: { id: true } } } }, customer: { select: { name: true } } },
  });
  if (!r) return { error: "So'rov topilmadi" };
  if (!methodsFor(s).includes(r.method)) return { error: r.method === "CASH" ? "Naqd pulni Kassa xodimi qabul qiladi" : "Perechisleniyeni Buxgalter tasdiqlaydi" };
  if (!OPEN_STATUSES.includes(r.status)) return { error: r.status === "RECEIVED" ? `${r.docNo} allaqachon to'liq qabul qilingan` : `${r.docNo} bekor qilingan (zayavka bekor)` };
  const { addPayment } = await import("./payments");
  const invoiceId = r.order.invoices[0]?.id ?? null;
  const note = [r.docNo, input.docRef ? `topshiriqnoma № ${input.docRef}` : null, input.note?.trim() || null].filter(Boolean).join(" · ");
  const res = await addPayment({
    customerId: r.customerId, orderId: invoiceId ? null : r.orderId, invoiceId, cashAccountId: input.cashAccountId,
    amount: input.amount, date: input.date, note, request: { id: r.id, method: r.method },
  }, s.userId);
  if (res.error) return { error: res.error };
  const after = await db.paymentRequest.findUnique({ where: { id: r.id }, select: { status: true, amount: true, received: true } });
  // Zayavka ochgan sotuvchiga — pul keldi (reys ochish shu bosh to'lovni kutadi)
  notifyAfter(async () => {
    const left = after ? Math.max(0, Number(after.amount) - Number(after.received)) : 0;
    await notifyUsers([r.order.createdById].filter((u) => u !== s.userId), {
      type: "PAYMENT_REQUEST_RECEIVED",
      title: `Pul qabul qilindi — ${money(r2(input.amount))}`,
      body: `${r.order.orderNo} · ${r.customer.name} · ${r.method === "CASH" ? "kassaga naqd" : "bankka perechisleniye"} · ${after?.status === "RECEIVED" ? "bosh to'lov to'liq yopildi, reys ochish mumkin" : `qolgan bosh to'lov ${money(left)}`}`,
      link: { key: "orders", id: r.orderId },
    });
  });
  return { status: after?.status ?? null, docNo: r.docNo };
}
