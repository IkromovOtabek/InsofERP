import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { money } from "@/lib/format";
import { notifyAfter, notifyRoles } from "@/lib/notify";
import type { Prisma } from "@/generated/prisma";
import { txSign } from "@/lib/cash-tx";

type Tx = Prisma.TransactionClient;

/**
 * To'lov qabul qilish — yagona joy (veb kassa sahifasi ham, mobil ilova ham shu yerdan).
 * Schyot ko'rsatilsa uning holati qayta hisoblanadi; zayavkaning hamma schyoti yopilsa — zayavka CLOSED.
 * Zayavka (avans) ko'rsatilsa — to'lov shu zayavkaga bog'lanadi, schyot yozilganda `createInvoice` uni o'zi ulaydi.
 */
export type PaymentInput = {
  customerId: string;
  invoiceId?: string | null;
  /** Avans: schyoti hali yo'q zayavka */
  orderId?: string | null;
  cashAccountId: string;
  amount: number;
  date: Date;
  note?: string | null;
};

class PaymentError extends Error {}

/** Bir xil to'lov shu oraliqda qayta kelsa — ikki marta bosilgan deb hisoblanadi. */
const DUPLICATE_WINDOW_MS = 60_000;

/** Tiyinga yaxlitlash — Decimal(18,2) ga mos. */
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Schyot holati to'lovlar yig'indisidan: bekor qilingani o'zgarmaydi. */
function invoiceStatusOf(amount: number, paid: number): "OPEN" | "PARTIAL" | "PAID" {
  return paid >= amount - 0.005 ? "PAID" : paid > 0.005 ? "PARTIAL" : "OPEN";
}

/**
 * Schyot holatini to'lovlardan qayta hisoblaydi va zayavka holatini moslaydi:
 * hamma schyot yopilsa DELIVERED → CLOSED, to'lov olib tashlanib schyot ochilsa CLOSED → DELIVERED.
 */
export async function recalcInvoice(tx: Tx, invoiceId: string, userId: string): Promise<string> {
  const inv = await tx.invoice.findUniqueOrThrow({ where: { id: invoiceId }, include: { payments: { select: { amount: true } } } });
  if (inv.status === "CANCELLED") return inv.status;
  const paid = inv.payments.reduce((x, y) => x + Number(y.amount), 0);
  const status = invoiceStatusOf(Number(inv.amount), paid);
  if (status !== inv.status) {
    await tx.invoice.update({ where: { id: inv.id }, data: { status } });
    await audit(tx, userId, "STATUS_CHANGE", "Invoice", inv.id, { status: inv.status }, { status, paid });
  }
  if (inv.orderId) {
    const open = await tx.invoice.count({ where: { orderId: inv.orderId, status: { in: ["OPEN", "PARTIAL"] } } });
    if (open === 0) {
      const r = await tx.order.updateMany({ where: { id: inv.orderId, status: "DELIVERED" }, data: { status: "CLOSED" } });
      if (r.count) await audit(tx, userId, "STATUS_CHANGE", "Order", inv.orderId, { status: "DELIVERED" }, { status: "CLOSED", by: "payment" });
    } else {
      const r = await tx.order.updateMany({ where: { id: inv.orderId, status: "CLOSED", kind: "SALE" }, data: { status: "DELIVERED" } });
      if (r.count) await audit(tx, userId, "STATUS_CHANGE", "Order", inv.orderId, { status: "CLOSED" }, { status: "DELIVERED", by: "payment-reversal" });
    }
  }
  return status;
}

/** Avans qabul qilinadigan zayavka holatlari (schyot hali yo'q). */
export const ADVANCE_ORDER_STATUSES = ["DRAFT", "BLOCKED", "CONFIRMED", "IN_PRODUCTION", "DELIVERED"] as const;

export async function addPayment(input: PaymentInput, userId: string): Promise<{ id?: string; invoiceStatus?: string; error?: string }> {
  // Decimal(18,2): tiyindan mayda qism bazada yaxlitlanardi, tekshiruvlar esa yaxlitlanmagan summani ko'rardi
  input = { ...input, amount: r2(input.amount) };
  if (!(input.amount > 0)) return { error: "Summa 0 dan katta bo'lsin" };
  if (input.invoiceId && input.orderId) return { error: "Schyot yoki zayavkadan bittasini tanlang" };
  const res = await db.$transaction(async (tx) => {
    // Mijoz bo'yicha navbat: bir vaqtdagi ikki to'lov qoldiqni ham, dublikatni ham to'g'ri ko'rsin
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${input.customerId}))`;
    // Mijoz: mavjud bo'lmasa — tushunarli xato (ilgari foreign key xatosi Prisma matni bilan chiqardi);
    // ichki "mijoz" (sklad zaxirasi) — haqiqiy mijoz emas, unga pul tushmaydi.
    // Nofaol (isActive: false) mijozdan to'lov ATAYLAB qabul qilinadi — yopilgan mijozning eski qarzini yig'ish uchun.
    const cust = await tx.customer.findUnique({ where: { id: input.customerId }, select: { isInternal: true } });
    if (!cust) throw new PaymentError("Mijoz topilmadi");
    if (cust.isInternal) throw new PaymentError("Ichki (tizim) mijoziga to'lov qabul qilinmaydi");
    const acc = await tx.cashAccount.findUnique({ where: { id: input.cashAccountId }, select: { isActive: true } });
    if (!acc?.isActive) throw new PaymentError("Kassa/hisob topilmadi yoki yopilgan");
    if (input.invoiceId) {
      // Schyot shu mijozniki, ochiq va summa qoldiqdan oshmasin (mobil ilovadagi qoida bilan bir xil).
      // Aks holda A mijozning puli B ning schyotini yopishi yoki bekor qilingan schyot qayta "to'landi" bo'lishi mumkin edi.
      const inv = await tx.invoice.findUnique({ where: { id: input.invoiceId }, include: { payments: { select: { amount: true } } } });
      if (!inv) throw new PaymentError("Schyot topilmadi");
      if (inv.customerId !== input.customerId) throw new PaymentError("Schyot boshqa mijozniki");
      if (!["OPEN", "PARTIAL"].includes(inv.status)) throw new PaymentError("Bu schyot yopilgan yoki bekor qilingan");
      const left = Number(inv.amount) - inv.payments.reduce((x, y) => x + Number(y.amount), 0);
      if (input.amount > left + 0.005) throw new PaymentError(`Qoldiqdan ko'p: ${money(left)}`);
    }
    if (input.orderId) {
      // Avans: zayavka shu mijozniki, bekor/yopilmagan va schyoti hali yo'q (bo'lsa — to'lov schyotga yoziladi)
      const o = await tx.order.findUnique({
        where: { id: input.orderId },
        select: { customerId: true, kind: true, status: true, orderNo: true, items: { select: { qtyM3: true, price: true } }, invoices: { where: { status: { not: "CANCELLED" } }, select: { invoiceNo: true } }, payments: { where: { invoiceId: null }, select: { amount: true } } },
      });
      if (!o || o.kind !== "SALE") throw new PaymentError("Zayavka topilmadi");
      if (o.customerId !== input.customerId) throw new PaymentError("Zayavka boshqa mijozniki");
      if (!(ADVANCE_ORDER_STATUSES as readonly string[]).includes(o.status)) throw new PaymentError("Bu zayavka yopilgan yoki bekor qilingan");
      if (o.invoices.length) throw new PaymentError(`${o.orderNo} ga schyot yozilgan (${o.invoices.map((i) => i.invoiceNo).join(", ")}) — to'lovni schyotga yozing`);
      const total = o.items.reduce((x, i) => x + Number(i.qtyM3) * Number(i.price), 0);
      const left = total - o.payments.reduce((x, p) => x + Number(p.amount), 0);
      if (input.amount > left + 0.005) throw new PaymentError(`Avans zayavka qoldig'idan ko'p: ${money(Math.max(0, left))}`);
    }
    const dup = await tx.payment.findFirst({
      where: {
        customerId: input.customerId, invoiceId: input.invoiceId ?? null, orderId: input.orderId ?? null, cashAccountId: input.cashAccountId,
        amount: input.amount, createdAt: { gte: new Date(Date.now() - DUPLICATE_WINDOW_MS) },
      },
      select: { id: true },
    });
    if (dup) throw new PaymentError("Aynan shu to'lov hozirgina yozildi — ikki marta bosilgan bo'lishi mumkin. Rostdan ikkinchi to'lov bo'lsa, bir daqiqadan keyin qayta kiriting");
    const p = await tx.payment.create({
      data: {
        customerId: input.customerId,
        invoiceId: input.invoiceId ?? undefined,
        orderId: input.orderId ?? undefined,
        cashAccountId: input.cashAccountId,
        amount: input.amount,
        date: input.date,
        note: input.note ?? undefined,
        createdById: userId,
      },
    });
    await audit(tx, userId, "CREATE", "Payment", p.id, undefined, p);

    if (!input.invoiceId) return { id: p.id };
    const status = await recalcInvoice(tx, input.invoiceId, userId);
    return { id: p.id, invoiceStatus: status };
  }).catch((e: Error) => { if (e instanceof PaymentError) return { error: e.message }; throw e; });
  if ("error" in res) return res;

  // To'lov mijozning limitini bo'shatadi — sotuv va buxgalteriya buni kutib turadi
  notifyAfter(async () => {
    const c = await db.customer.findUnique({ where: { id: input.customerId }, select: { name: true } });
    await notifyRoles(["SALES", "ACCOUNTING"], {
      type: "PAYMENT_RECEIVED",
      title: `To'lov: ${money(input.amount)}`,
      body: `${c?.name ?? "Mijoz"}${res.invoiceStatus === "PAID" ? " · schyot yopildi" : input.orderId ? " · avans" : ""}`,
      link: input.invoiceId ? { key: "invoices", id: input.invoiceId } : input.orderId ? { key: "orders", id: input.orderId } : undefined,
      channel: "oddiy",
    }, { except: userId });
  });
  return res;
}

/**
 * Taqsimlanmagan to'lovni (schyotsiz) ochiq schyotga bog'lash.
 * To'lov schyot qoldig'idan katta bo'lsa — ikkiga bo'linadi: qoldiqcha qismi schyotga,
 * qolgani avvalgidek taqsimlanmagan bo'lib qoladi (kassa jami o'zgarmaydi).
 * Realizatsiya jurnalidan yozilgan to'lov bog'lanmaydi — u jurnaldagi sotuvni yopadi.
 */
export async function linkPaymentToInvoice(paymentId: string, invoiceId: string, userId: string): Promise<{ error?: string; linked?: number; rest?: number; invoiceStatus?: string }> {
  const p0 = await db.payment.findUnique({ where: { id: paymentId }, select: { customerId: true } });
  if (!p0) return { error: "To'lov topilmadi" };
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${p0.customerId}))`;
    const p = await tx.payment.findUniqueOrThrow({ where: { id: paymentId }, include: { register: { select: { id: true } } } });
    if (p.invoiceId) throw new PaymentError("To'lov allaqachon schyotga bog'langan");
    if (p.register) throw new PaymentError("Realizatsiya jurnalidan yozilgan to'lov schyotga bog'lanmaydi");
    const inv = await tx.invoice.findUnique({ where: { id: invoiceId }, include: { payments: { select: { amount: true } } } });
    if (!inv) throw new PaymentError("Schyot topilmadi");
    if (inv.customerId !== p.customerId) throw new PaymentError("Schyot boshqa mijozniki");
    if (!["OPEN", "PARTIAL"].includes(inv.status)) throw new PaymentError("Bu schyot yopilgan yoki bekor qilingan");
    // Boshqa zayavkaning avansi bu schyotga o'tib ketmasin (o'sha zayavkaga schyot yozilganda o'zi ulanadi)
    if (p.orderId && inv.orderId && p.orderId !== inv.orderId) {
      const other = await tx.order.findUnique({ where: { id: p.orderId }, select: { status: true, orderNo: true } });
      if (other && other.status !== "CANCELLED") throw new PaymentError(`Bu to'lov ${other.orderNo} zayavkasining avansi — o'sha zayavka schyotiga ulanadi`);
    }
    const left = r2(Number(inv.amount) - inv.payments.reduce((x, y) => x + Number(y.amount), 0));
    if (!(left > 0.005)) throw new PaymentError("Schyot qoldig'i yo'q");
    const amount = Number(p.amount);
    const linked = r2(Math.min(amount, left));
    const rest = r2(amount - linked);
    await tx.payment.update({ where: { id: p.id }, data: { invoiceId: inv.id, amount: linked } });
    await audit(tx, userId, "UPDATE", "Payment", p.id, { invoiceId: null, amount }, { invoiceId: inv.id, amount: linked, by: "link" });
    if (rest > 0.005) {
      const q = await tx.payment.create({
        data: {
          customerId: p.customerId, orderId: p.orderId, cashAccountId: p.cashAccountId, amount: rest, date: p.date,
          note: [p.note, `qoldiq — ${inv.invoiceNo} ga bog'langandan ortgan`].filter(Boolean).join(" · "),
          createdById: p.createdById,
        },
      });
      await audit(tx, userId, "CREATE", "Payment", q.id, undefined, { ...q, splitFrom: p.id });
    }
    const status = await recalcInvoice(tx, inv.id, userId);
    return { linked, rest, invoiceStatus: status };
  }).catch((e: Error) => { if (e instanceof PaymentError) return { error: e.message }; throw e; });
}

/**
 * To'lovni storno qilish (xato kiritilgan to'lov): yozuv o'chiriladi, oldingi holati to'liq auditda qoladi,
 * schyot holati (OPEN/PARTIAL/PAID) va zayavka (CLOSED → DELIVERED) qayta hisoblanadi.
 * Realizatsiya importidan yozilgan to'lov bu yo'l bilan o'chirilmaydi — partiyani qaytarish kerak.
 */
export async function reversePayment(paymentId: string, reason: string, userId: string): Promise<{ error?: string }> {
  if (reason.trim().length < 3) return { error: "Storno sababini yozing" };
  const p0 = await db.payment.findUnique({ where: { id: paymentId }, select: { customerId: true } });
  if (!p0) return { error: "To'lov topilmadi" };
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${p0.customerId}))`;
    const p = await tx.payment.findUnique({ where: { id: paymentId }, include: { register: { select: { id: true, batch: true } } } });
    if (!p) throw new PaymentError("To'lov topilmadi");
    if (p.register) throw new PaymentError("Bu to'lov Excel importidan yozilgan — Realizatsiya jurnalida partiyani qaytaring");
    // Storno kassadan pulni olib tashlaydi — naqd kassa minusga tushmasin (pul allaqachon sarflangan bo'lsa)
    const cashErr = await cashOutflowError(tx, p.cashAccountId, Number(p.amount));
    if (cashErr) throw new PaymentError(`Storno qilinsa kassa minusga tushadi. ${cashErr}`);
    await tx.payment.delete({ where: { id: p.id } });
    await audit(tx, userId, "DELETE", "Payment", p.id, { ...p, register: undefined }, { reversed: true, reason: reason.trim() });
    if (p.invoiceId) await recalcInvoice(tx, p.invoiceId, userId);
    return {};
  }).catch((e: Error) => { if (e instanceof PaymentError) return { error: e.message }; throw e; });
}

// ───────────────────────── Kutilayotgan avans (zayavka formasidan) ─────────────────────────

/**
 * Sotuvchi zayavka ochganda mijoz va'da qilgan bosh to'lov — pul emas, kutilayotgan avans (`Order.prepayAmount`).
 * Kassir uni `/payments` dagi "Zayavka (avans)" tanlovida ko'radi va pulni o'zi qabul qiladi.
 * Ilgari summa izoh matniga yozilib, undan regex bilan o'qilardi — izoh tahrirlansa qoida buzilardi.
 */
export const expectedAdvance = (o: { prepayAmount?: unknown }): number => Math.max(0, Number(o.prepayAmount ?? 0) || 0);

/**
 * Naqd to'lovli zayavka (`onCredit = false`) bo'yicha talab qilingan bosh to'lov hali kelmagan bo'lsa —
 * reys ochilmaydi va yuklanmaydi (mahsulot pulsiz chiqib ketmasin). To'langan = zayavkaga yozilgan avans
 * + zayavka schyotlariga tushgan to'lovlar. Qarzga (kafolat xati) zayavka va bosh to'lovsiz zayavka tekshirilmaydi.
 * Qaytaradi: xato matni yoki null.
 */
export async function prepayShortError(client: Tx | typeof db, orderId: string): Promise<string | null> {
  const o = await client.order.findUnique({ where: { id: orderId }, select: { kind: true, onCredit: true, prepayAmount: true, orderNo: true } });
  if (!o || o.kind !== "SALE" || o.onCredit) return null;
  const required = expectedAdvance(o);
  if (!(required > 0.005)) return null;
  const agg = await client.payment.aggregate({ where: { OR: [{ orderId }, { invoice: { orderId } }] }, _sum: { amount: true } });
  const paid = Number(agg._sum.amount ?? 0);
  if (paid + 0.005 >= required) return null;
  return `${o.orderNo}: bosh to'lov ${money(required)} kerak, to'langan ${money(paid)} — qolgan ${money(required - paid)} kassaga tushmaguncha reys ochilmaydi va yuklanmaydi`;
}

// ───────────────────────── Hisob qoldiqlari ─────────────────────────

/**
 * Kassa/bank hisoblarining haqiqiy qoldig'i (butun davr): mijoz to'lovlari + boshqa kirimlar − chiqimlar.
 * Kassa/bank sahifasidagi kartalar, Kirim-Chiqim va "kassa minusga tushmasin" tekshiruvi — bitta manba.
 */
export async function accountBalances(client: Tx = db, ids?: string[]): Promise<Map<string, number>> {
  const byAcc = ids ? { cashAccountId: { in: ids } } : {};
  const [pay, tx] = await Promise.all([
    client.payment.groupBy({ by: ["cashAccountId"], where: byAcc, _sum: { amount: true } }),
    client.cashTransaction.groupBy({ by: ["cashAccountId", "type"], where: byAcc, _sum: { amount: true } }),
  ]);
  const balance = new Map<string, number>();
  for (const p of pay) balance.set(p.cashAccountId, (balance.get(p.cashAccountId) ?? 0) + Number(p._sum.amount ?? 0));
  for (const t of tx) balance.set(t.cashAccountId, (balance.get(t.cashAccountId) ?? 0) + txSign(t.type) * Number(t._sum.amount ?? 0));
  for (const [k, v] of balance) balance.set(k, r2(v));
  return balance;
}

/**
 * Chiqim hisob qoldig'idan oshmasin: naqd kassa — har doim; bank hisobi — direktor "overdraft ruxsat"
 * (`CashAccount.allowOverdraft`) belgilamagan bo'lsa (ilgari bank tekshirilmasdi va jimgina minusga tushardi).
 * Tranzaksiya ichida chaqiriladi: hisob bo'yicha qulf olinadi, ikki parallel chiqim birga o'tib ketmasin.
 * Qaytaradi: xato matni yoki null.
 */
export async function cashOutflowError(tx: Tx, cashAccountId: string, amount: number): Promise<string | null> {
  const acc = await tx.cashAccount.findUnique({ where: { id: cashAccountId }, select: { type: true, name: true, allowOverdraft: true } });
  if (!acc || (acc.type === "BANK" && acc.allowOverdraft)) return null;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"cash:" + cashAccountId}))`;
  const left = (await accountBalances(tx, [cashAccountId])).get(cashAccountId) ?? 0;
  if (amount > left + 0.005) {
    return acc.type === "CASH"
      ? `${acc.name} kassasida yetarli pul yo'q: qoldiq ${money(left)}, chiqim ${money(amount)}`
      : `${acc.name} hisobida yetarli pul yo'q: qoldiq ${money(left)}, chiqim ${money(amount)} (overdraft kerak bo'lsa direktor Sozlamalarda ruxsat beradi)`;
  }
  return null;
}
