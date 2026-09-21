import { db } from "@/lib/db";
import { eco, ecoEnabled, EcoError, normalizePhone } from "./client";

/**
 * ERP → ECO spravochnik sinxroni. ERP — yagona manba, ECO — ko'zgu.
 *
 * Yo'nalish faqat bir tomonlama: ERP'da nima bo'lsa ECO'da ham shu bo'ladi.
 * ECO'dan ERP'ga faqat haydovchi harakati qaytadi (u `sync.ts` da).
 *
 * Hech bir funksiya tashlamaydi — natija `PushResult` bo'lib qaytadi, chaqiruvchi hisobot yig'adi.
 * Tartib muhim: mijoz → marka → xomashyo → zayavka → schyot → to'lov.
 * Schyot zayavkaga, to'lov schyotga tayanadi (ECO'da shunday tuzilgan).
 */
export type PushResult = { ok: boolean; skipped?: boolean; error?: string };

const errMsg = (e: unknown) => (e instanceof EcoError ? `${e.message} [${e.code}]` : String((e as Error)?.message ?? e));
const inn9 = (v: string | null | undefined) => (/^\d{9}$/.test(v ?? "") ? v! : undefined);

/** ERP mijoz kartasi → ECO tashkiloti + kredit limiti. */
export async function pushCustomer(customerId: string): Promise<PushResult> {
  if (!ecoEnabled()) return { ok: false, skipped: true };
  const c = await db.customer.findUnique({ where: { id: customerId } });
  if (!c) return { ok: false, skipped: true };
  try {
    await eco.upsertCustomer({
      externalRef: c.id,
      name: c.name,
      inn: inn9(c.inn),
      phone: normalizePhone(c.phone) ?? undefined,
      address: c.address ?? undefined,
      creditLimit: Number(c.creditLimit),
      isActive: c.isActive,
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
}

/** ERP mahsulot kartasi (beton markasi) → ECO ConcreteMix. */
export async function pushProduct(productId: string): Promise<PushResult> {
  if (!ecoEnabled()) return { ok: false, skipped: true };
  const p = await db.product.findUnique({ where: { id: productId } });
  if (!p) return { ok: false, skipped: true };
  try {
    await eco.upsertMix({ grade: p.code, name: p.name, unitPrice: Number(p.price), isActive: p.isActive });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
}

/**
 * ERP xomashyo kartasi → ECO Material.
 * ERP kartasida narx yo'q (narx kirimda bo'ladi), shuning uchun oxirgi kirim narxi yuboriladi.
 */
export async function pushMaterial(materialId: string): Promise<PushResult> {
  if (!ecoEnabled()) return { ok: false, skipped: true };
  const m = await db.material.findUnique({ where: { id: materialId } });
  if (!m) return { ok: false, skipped: true };
  const last = await db.goodsReceiptItem.findFirst({
    where: { materialId },
    orderBy: { receipt: { date: "desc" } },
    select: { price: true },
  });
  try {
    await eco.upsertMaterial({
      externalRef: m.id,
      name: m.name,
      unit: m.unit,
      category: "Xomashyo",
      price: last ? Number(last.price) : 0,
      minStock: Number(m.minStock),
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
}

/**
 * ERP zayavkasi → ECO buyurtmasi. Reys bo'lmasa ham ketadi — mijoz ilovada o'z buyurtmasini ko'radi.
 * Manzil koordinatasi ERP'da saqlanmaydi, shuning uchun `location` yuborilmaydi:
 * ECO'da nuqta 0/0 bo'lib qoladi va yetib borish vaqti hisoblanmaydi.
 */
export async function pushOrder(orderId: string): Promise<PushResult> {
  if (!ecoEnabled()) return { ok: false, skipped: true };
  const o = await db.order.findUnique({
    where: { id: orderId },
    include: { customer: true, items: { include: { product: true } } },
  });
  if (!o) return { ok: false, skipped: true };
  if (o.items.length === 0) return { ok: false, skipped: true }; // ECO'da bo'sh buyurtma bo'lmaydi
  try {
    await eco.upsertOrder(o.orderNo, {
      customer: {
        externalRef: o.customer.id,
        name: o.customer.name,
        inn: inn9(o.customer.inn),
        phone: normalizePhone(o.customer.phone) ?? undefined,
      },
      status: o.status,
      address: o.deliveryAddress,
      scheduledAt: o.deliveryDate.toISOString(),
      needsPump: o.needsPump,
      note: o.note ?? undefined,
      items: o.items.map((i) => ({
        grade: i.product.code,
        name: i.product.name,
        volumeM3: Number(i.qtyM3),
        unitPrice: Number(i.price),
      })),
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
}

/**
 * ERP schyoti → ECO hisob-fakturasi.
 * ECO'da schyot buyurtmaga tegishli, shuning uchun zayavkaga bog'lanmagan schyot o'tkazilmaydi.
 */
export async function pushInvoice(invoiceId: string): Promise<PushResult> {
  if (!ecoEnabled()) return { ok: false, skipped: true };
  const inv = await db.invoice.findUnique({ where: { id: invoiceId }, include: { order: true, payments: true } });
  if (!inv) return { ok: false, skipped: true };
  if (!inv.order) return { ok: false, skipped: true };
  const paid = inv.payments.reduce((s, p) => s + Number(p.amount), 0);
  try {
    await eco.upsertInvoice(inv.invoiceNo, {
      orderRef: inv.order.orderNo,
      amount: Number(inv.amount),
      paidAmount: paid,
      status: inv.status,
      issuedAt: inv.date.toISOString(),
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
}

/** ERP to'lovi → ECO to'lovi. Schyotga bog'lanmagan to'lov (avans) ECO'ga o'tmaydi. */
export async function pushPayment(paymentId: string): Promise<PushResult> {
  if (!ecoEnabled()) return { ok: false, skipped: true };
  const p = await db.payment.findUnique({
    where: { id: paymentId },
    include: { invoice: { include: { order: true } }, cashAccount: true },
  });
  if (!p) return { ok: false, skipped: true };
  const order = p.invoice?.order;
  if (!order) return { ok: false, skipped: true };
  try {
    await eco.upsertPayment(p.id, {
      orderRef: order.orderNo,
      amount: Number(p.amount),
      method: p.cashAccount.type === "BANK" ? "TRANSFER" : "CASH",
      paidAt: p.date.toISOString(),
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
}

// ───────────────────────── To'liq sinxron ─────────────────────────

export type SyncReport = {
  enabled: boolean;
  startedAt: string;
  finishedAt: string;
  sections: Record<string, { total: number; ok: number; skipped: number; failed: number; errors: string[] }>;
};

type Runner = { id: string; label: string; run: () => Promise<PushResult> };

async function runSection(items: Runner[]) {
  const s = { total: items.length, ok: 0, skipped: 0, failed: 0, errors: [] as string[] };
  for (const it of items) {
    const r = await it.run();
    if (r.ok) s.ok++;
    else if (r.skipped) s.skipped++;
    else {
      s.failed++;
      if (s.errors.length < 5) s.errors.push(`${it.label}: ${r.error}`);
    }
  }
  return s;
}

/**
 * Hamma spravochnikni ECO'ga bosqichma-bosqich yuboradi.
 * `sinceDays` — zayavka, schyot va to'lovlar uchun oyna (standart 90 kun);
 * mijoz, marka va xomashyo har doim to'liq yuboriladi (ular kam va doim kerak).
 */
export async function syncAllToEco(opts: { sinceDays?: number } = {}): Promise<SyncReport> {
  const startedAt = new Date().toISOString();
  if (!ecoEnabled()) {
    return { enabled: false, startedAt, finishedAt: new Date().toISOString(), sections: {} };
  }
  const since = new Date();
  since.setDate(since.getDate() - (opts.sinceDays ?? 90));

  const [customers, products, materials, orders, invoices, payments] = await Promise.all([
    db.customer.findMany({ select: { id: true, name: true } }),
    db.product.findMany({ select: { id: true, code: true } }),
    db.material.findMany({ select: { id: true, code: true } }),
    db.order.findMany({ where: { date: { gte: since } }, select: { id: true, orderNo: true }, orderBy: { date: "asc" } }),
    db.invoice.findMany({ where: { date: { gte: since }, orderId: { not: null } }, select: { id: true, invoiceNo: true }, orderBy: { date: "asc" } }),
    db.payment.findMany({ where: { date: { gte: since }, invoiceId: { not: null } }, select: { id: true, date: true }, orderBy: { date: "asc" } }),
  ]);

  const sections: SyncReport["sections"] = {};
  sections["Mijozlar"] = await runSection(customers.map((c) => ({ id: c.id, label: c.name, run: () => pushCustomer(c.id) })));
  sections["Markalar"] = await runSection(products.map((p) => ({ id: p.id, label: p.code, run: () => pushProduct(p.id) })));
  sections["Xomashyo"] = await runSection(materials.map((m) => ({ id: m.id, label: m.code, run: () => pushMaterial(m.id) })));
  sections["Zayavkalar"] = await runSection(orders.map((o) => ({ id: o.id, label: o.orderNo, run: () => pushOrder(o.id) })));
  sections["Schyotlar"] = await runSection(invoices.map((i) => ({ id: i.id, label: i.invoiceNo, run: () => pushInvoice(i.id) })));
  sections["To'lovlar"] = await runSection(payments.map((p) => ({ id: p.id, label: p.date.toISOString().slice(0, 10), run: () => pushPayment(p.id) })));

  return { enabled: true, startedAt, finishedAt: new Date().toISOString(), sections };
}
