import { db } from "./db";
import { audit } from "./audit";
import { nextNo } from "./numbering";
import { money } from "./format";
import { cashOutflowError } from "./payments";
import { lockStock } from "./stock-lock";
import type { OpeningKind, Prisma } from "@/generated/prisma";

/**
 * Boshlang'ich qoldiqlar — real korxona ma'lumotini tizimga o'tkazish (tizimga o'tish sanasidagi holat).
 *
 * Har qoldiq turi mavjud hisob zanjiriga O'Z HUJJATI orqali kiradi — hisobotlarni alohida o'zgartirish shart emas:
 *
 *   CUSTOMER → `Invoice` (isOpening = true, zayavkasiz, raqami BQ-YYYY-00001).
 *              Qarz = schyotlar − to'lovlar qoidasi (`lib/finance.ts`), akt sverka, debitorka, aging, BI —
 *              hammasi schyotlardan hisoblanadi, shuning uchun boshlang'ich qarz o'zi qatnashadi.
 *              Musbat summa — mijoz qarzi (OPEN; kassir to'lovni shu schyotga yozadi),
 *              manfiy — mijoz bergan avans (PAID; qarzdan ayiriladi, ochiq zayavkani qoplaydi).
 *              Tushum (sotuv) hisobotlarida `isOpening` schyotlar hisobga olinmaydi.
 *   SUPPLIER → alohida hujjat yo'q: qoldiq shu yozuvning o'zi. To'lovi — Kirim-Chiqimdagi chiqim
 *              (refType = "OpeningBalance", refId = shu yozuv). Yetkazuvchi kartasida qarzga qo'shiladi.
 *   CASH     → `CashTransaction` type = OPENING: hisob qoldig'iga kiradi, kirim/chiqim hisobotlariga emas.
 *   STOCK    → `StockMove` ADJUSTMENT (refType = "OpeningBalance") tannarx bilan, sklad bo'yicha.
 *
 * Bitta obyektga bitta faol qoldiq: `activeKey` unique (bekor qilinganda bo'shaydi).
 * Kiritish — direktor va buxgalteriya; tahrir va bekor qilish — faqat direktor (action'da tekshiriladi).
 */

export const OPENING_REF = "OpeningBalance";
export const OPENING_CATEGORY = "Boshlang'ich qoldiq";
/** Qoldiq kirita oladigan rollar (direktordan tashqari) — action guard'i ham, sahifadagi formalar ham shu ro'yxatdan. */
export const OPENING_WRITERS = ["ACCOUNTING"] as const;

export const KIND_LABEL: Record<OpeningKind, string> = {
  CUSTOMER: "Mijozlar qarzi",
  SUPPLIER: "Yetkazuvchilarga qarz",
  CASH: "Kassa / bank",
  STOCK: "Tayyor mahsulot",
};

type Tx = Prisma.TransactionClient;
class OpeningError extends Error {}

export type OpeningInput = {
  kind: OpeningKind;
  date: Date;
  customerId?: string | null;
  supplierId?: string | null;
  cashAccountId?: string | null;
  productId?: string | null;
  warehouseId?: string | null;
  /** Pul (ishorali). STOCK da hisoblanadi: qty × unitCost. */
  amount?: number;
  qty?: number | null;
  unitCost?: number | null;
  note?: string | null;
};

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Faol yozuv kaliti: bitta obyektga (mijoz, hisob, mahsulot+sklad) bitta boshlang'ich qoldiq. */
export function activeKeyOf(i: Pick<OpeningInput, "kind" | "customerId" | "supplierId" | "cashAccountId" | "productId" | "warehouseId">): string {
  switch (i.kind) {
    case "CUSTOMER": return `CUSTOMER:${i.customerId}`;
    case "SUPPLIER": return `SUPPLIER:${i.supplierId}`;
    case "CASH": return `CASH:${i.cashAccountId}`;
    case "STOCK": return `STOCK:${i.productId}:${i.warehouseId}`;
  }
}

/** Mahsulotning shu skladdagi joriy qoldig'i (barcha harakatlar yig'indisi). */
async function productStock(tx: Tx, productId: string, warehouseId: string): Promise<number> {
  const s = await tx.stockMove.aggregate({ where: { productId, warehouseId }, _sum: { qty: true } });
  return Number(s._sum.qty ?? 0);
}

/** Yetkazuvchi qoldig'iga qilingan to'lovlar (chiqim − qaytgan pul). */
async function supplierOpeningPaid(client: Tx | typeof db, openingIds: string[]): Promise<Map<string, number>> {
  if (!openingIds.length) return new Map();
  const rows = await client.cashTransaction.groupBy({ by: ["refId", "type"], where: { refType: OPENING_REF, refId: { in: openingIds }, type: { in: ["EXPENSE", "INCOME"] } }, _sum: { amount: true } });
  const out = new Map<string, number>();
  for (const r of rows) if (r.refId) out.set(r.refId, (out.get(r.refId) ?? 0) + (r.type === "EXPENSE" ? 1 : -1) * Number(r._sum.amount ?? 0));
  return out;
}

/** Mijoz qoldig'i schyotining holati: manfiy (avans) — PAID; musbat — to'lovlarga qarab. */
function invoiceStatusFor(amount: number, paid: number): "OPEN" | "PARTIAL" | "PAID" {
  if (amount <= 0) return "PAID";
  return paid >= amount - 0.005 ? "PAID" : paid > 0.005 ? "PARTIAL" : "OPEN";
}

/**
 * Bitta boshlang'ich qoldiqni yozish (tranzaksiya ichida). Import ham shu funksiyani chaqiradi.
 * Shu obyektga faol qoldiq bo'lsa — xato (mavjudini ko'rsatadi), ikkinchi marta yozilmaydi.
 */
export async function createOpeningTx(tx: Tx, input: OpeningInput, userId: string): Promise<{ id: string }> {
  const key = activeKeyOf(input);
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"opening:" + key}))`;
  const exists = await tx.openingBalance.findUnique({ where: { activeKey: key }, select: { amount: true, qty: true, date: true } });
  if (exists) {
    const what = input.kind === "STOCK" ? `${Number(exists.qty ?? 0)} birlik` : money(Number(exists.amount));
    throw new OpeningError(`Bu obyektga boshlang'ich qoldiq allaqachon kiritilgan (${what}, ${exists.date.toLocaleDateString("ru-RU")} holatiga). O'zgartirish kerak bo'lsa — direktor ro'yxatdan tahrirlaydi`);
  }
  const note = input.note?.trim() || null;
  const base = { kind: input.kind, date: input.date, note, activeKey: key, createdById: userId };

  switch (input.kind) {
    case "CUSTOMER": {
      const amount = r2(input.amount ?? 0);
      if (!amount) throw new OpeningError("Summa 0 bo'lmasin (musbat — mijoz qarzi, manfiy — mijoz avansi)");
      const c = await tx.customer.findUnique({ where: { id: input.customerId ?? "" }, select: { id: true, name: true, isInternal: true } });
      if (!c || c.isInternal) throw new OpeningError("Mijoz topilmadi");
      const inv = await tx.invoice.create({
        data: { invoiceNo: await nextNo(tx, "invoice", "BQ"), date: input.date, customerId: c.id, amount, isOpening: true, status: invoiceStatusFor(amount, 0) },
      });
      await audit(tx, userId, "CREATE", "Invoice", inv.id, undefined, inv);
      const o = await tx.openingBalance.create({ data: { ...base, customerId: c.id, amount, invoiceId: inv.id } });
      await audit(tx, userId, "CREATE", "OpeningBalance", o.id, undefined, o);
      return { id: o.id };
    }
    case "SUPPLIER": {
      const amount = r2(input.amount ?? 0);
      if (!amount) throw new OpeningError("Summa 0 bo'lmasin (musbat — bizning qarzimiz, manfiy — yetkazuvchiga bergan avansimiz)");
      const s = await tx.supplier.findUnique({ where: { id: input.supplierId ?? "" }, select: { id: true } });
      if (!s) throw new OpeningError("Yetkazuvchi topilmadi");
      const o = await tx.openingBalance.create({ data: { ...base, supplierId: s.id, amount } });
      await audit(tx, userId, "CREATE", "OpeningBalance", o.id, undefined, o);
      return { id: o.id };
    }
    case "CASH": {
      const amount = r2(input.amount ?? 0);
      if (!amount) throw new OpeningError("Summa 0 bo'lmasin");
      const acc = await tx.cashAccount.findUnique({ where: { id: input.cashAccountId ?? "" }, select: { id: true, type: true, name: true } });
      if (!acc) throw new OpeningError("Kassa/hisob topilmadi");
      if (amount < 0 && acc.type === "CASH") throw new OpeningError(`${acc.name}: naqd kassa qoldig'i manfiy bo'lolmaydi (manfiy — faqat bank overdrafti)`);
      const o = await tx.openingBalance.create({ data: { ...base, cashAccountId: acc.id, amount } });
      const t = await tx.cashTransaction.create({
        data: { type: "OPENING", date: input.date, cashAccountId: acc.id, amount, category: OPENING_CATEGORY, note: note ?? "Tizimga o'tish sanasidagi qoldiq", refType: OPENING_REF, refId: o.id, createdById: userId },
      });
      await audit(tx, userId, "CREATE", "CashTransaction", t.id, undefined, t);
      const after = await tx.openingBalance.update({ where: { id: o.id }, data: { cashTxId: t.id } });
      await audit(tx, userId, "CREATE", "OpeningBalance", o.id, undefined, after);
      return { id: o.id };
    }
    case "STOCK": {
      const qty = Number(input.qty ?? 0);
      const unitCost = input.unitCost == null ? null : r2(input.unitCost);
      if (!(qty > 0)) throw new OpeningError("Miqdor 0 dan katta bo'lsin");
      if (unitCost != null && unitCost < 0) throw new OpeningError("Tannarx manfiy bo'lmasin");
      const [p, wh] = await Promise.all([
        tx.product.findUnique({ where: { id: input.productId ?? "" }, select: { id: true } }),
        tx.warehouse.findUnique({ where: { id: input.warehouseId ?? "" }, select: { id: true } }),
      ]);
      if (!p) throw new OpeningError("Mahsulot topilmadi");
      if (!wh) throw new OpeningError("Sklad topilmadi");
      const o = await tx.openingBalance.create({ data: { ...base, productId: p.id, warehouseId: wh.id, qty, unitCost, amount: r2(qty * (unitCost ?? 0)) } });
      const m = await tx.stockMove.create({
        data: { type: "ADJUSTMENT", date: input.date, warehouseId: wh.id, productId: p.id, qty, unitCost, refType: OPENING_REF, refId: o.id, note: `${OPENING_CATEGORY}${note ? ` · ${note}` : ""}`, createdById: userId },
      });
      await audit(tx, userId, "CREATE", "StockMove", m.id, undefined, m);
      const after = await tx.openingBalance.update({ where: { id: o.id }, data: { stockMoveId: m.id } });
      await audit(tx, userId, "CREATE", "OpeningBalance", o.id, undefined, after);
      return { id: o.id };
    }
  }
}

export async function createOpening(input: OpeningInput, userId: string): Promise<{ id?: string; error?: string }> {
  return db.$transaction((tx) => createOpeningTx(tx, input, userId))
    .catch((e: Error) => { if (e instanceof OpeningError) return { error: e.message }; throw e; });
}

export type OpeningPatch = { date: Date; amount?: number; qty?: number | null; unitCost?: number | null; note?: string | null };

/**
 * Tahrir (faqat direktor): summa/sana/izoh. Bog'langan hujjat ham moslanadi:
 * mijoz schyoti summasi (to'langanidan kam bo'lmaydi), kassa yozuvi, sklad — tuzatuvchi harakat.
 */
export async function updateOpening(id: string, patch: OpeningPatch, userId: string): Promise<{ error?: string }> {
  return db.$transaction(async (tx) => {
    const o = await tx.openingBalance.findUnique({ where: { id } });
    if (!o || o.cancelledAt) throw new OpeningError("Yozuv topilmadi yoki bekor qilingan");
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"opening:" + o.activeKey}))`;
    const note = patch.note?.trim() || null;
    let data: Prisma.OpeningBalanceUpdateInput = { date: patch.date, note };

    switch (o.kind) {
      case "CUSTOMER": {
        const amount = r2(patch.amount ?? 0);
        if (!amount) throw new OpeningError("Summa 0 bo'lmasin — qoldiq kerak bo'lmasa bekor qiling");
        // Mijoz qulfi (`addPayment` bilan bir xil): shu payt yozilayotgan to'lov tekshiruvdan o'tib ketmasin
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${o.customerId!}))`;
        const inv = await tx.invoice.findUniqueOrThrow({ where: { id: o.invoiceId! }, include: { payments: { select: { amount: true } } } });
        const paid = inv.payments.reduce((s, p) => s + Number(p.amount), 0);
        if (paid > 0.005 && amount < paid - 0.005) throw new OpeningError(`Bu qoldiqqa ${money(paid)} to'lov yozilgan — summa undan kam bo'lolmaydi`);
        const after = await tx.invoice.update({ where: { id: inv.id }, data: { amount, date: patch.date, status: invoiceStatusFor(amount, paid) } });
        await audit(tx, userId, "UPDATE", "Invoice", inv.id, { amount: inv.amount, date: inv.date, status: inv.status }, { amount: after.amount, date: after.date, status: after.status, by: "opening" });
        data = { ...data, amount };
        break;
      }
      case "SUPPLIER": {
        const amount = r2(patch.amount ?? 0);
        if (!amount) throw new OpeningError("Summa 0 bo'lmasin — qoldiq kerak bo'lmasa bekor qiling");
        const paid = (await supplierOpeningPaid(tx, [o.id])).get(o.id) ?? 0;
        if (paid > 0.005 && amount < paid - 0.005) throw new OpeningError(`Bu qarzga ${money(paid)} to'langan — summa undan kam bo'lolmaydi`);
        data = { ...data, amount };
        break;
      }
      case "CASH": {
        const amount = r2(patch.amount ?? 0);
        if (!amount) throw new OpeningError("Summa 0 bo'lmasin — qoldiq kerak bo'lmasa bekor qiling");
        const t = await tx.cashTransaction.findUniqueOrThrow({ where: { id: o.cashTxId! } });
        const acc = await tx.cashAccount.findUniqueOrThrow({ where: { id: t.cashAccountId }, select: { type: true, name: true } });
        if (amount < 0 && acc.type === "CASH") throw new OpeningError(`${acc.name}: naqd kassa qoldig'i manfiy bo'lolmaydi`);
        // Qoldiq kamaysa — naqd kassa minusga tushmasin (shu orada pul chiqib ketgan bo'lishi mumkin)
        const drop = Number(t.amount) - amount;
        if (drop > 0.005) { const err = await cashOutflowError(tx, t.cashAccountId, drop); if (err) throw new OpeningError(err); }
        const after = await tx.cashTransaction.update({ where: { id: t.id }, data: { amount, date: patch.date, note: note ?? t.note } });
        await audit(tx, userId, "UPDATE", "CashTransaction", t.id, t, after);
        data = { ...data, amount };
        break;
      }
      case "STOCK": {
        const qty = Number(patch.qty ?? 0);
        const unitCost = patch.unitCost == null ? null : r2(patch.unitCost);
        if (!(qty > 0)) throw new OpeningError("Miqdor 0 dan katta bo'lsin — qoldiq kerak bo'lmasa bekor qiling");
        const oldQty = Number(o.qty ?? 0);
        // Sklad qulfi (reys yuklash, brak, storno bilan navbat): qoldiq tekshiruvi va yozuv orasida mahsulot chiqib ketmasin
        await lockStock(tx);
        if (qty < oldQty) {
          const left = await productStock(tx, o.productId!, o.warehouseId!);
          if (left - (oldQty - qty) < -0.0005) throw new OpeningError(`Skladda hozir ${left} qoldi — boshlang'ich qoldiqni ${qty} gacha kamaytirib bo'lmaydi (mahsulot sotilgan/jo'natilgan)`);
        }
        // Sklad harakati o'zgarmas: eskisi teskari harakat bilan yopiladi, yangisi yoziladi (tannarx ham yangilanadi)
        const rev = await tx.stockMove.create({ data: { type: "ADJUSTMENT", date: patch.date, warehouseId: o.warehouseId!, productId: o.productId!, qty: -oldQty, unitCost: o.unitCost, refType: OPENING_REF, refId: o.id, note: `${OPENING_CATEGORY} — tahrir (eskisi qaytarildi)`, createdById: userId } });
        const m = await tx.stockMove.create({ data: { type: "ADJUSTMENT", date: patch.date, warehouseId: o.warehouseId!, productId: o.productId!, qty, unitCost, refType: OPENING_REF, refId: o.id, note: `${OPENING_CATEGORY}${note ? ` · ${note}` : ""}`, createdById: userId } });
        await audit(tx, userId, "CREATE", "StockMove", rev.id, undefined, rev);
        await audit(tx, userId, "CREATE", "StockMove", m.id, undefined, m);
        data = { ...data, qty, unitCost, amount: r2(qty * (unitCost ?? 0)), stockMove: { connect: { id: m.id } } };
        break;
      }
    }
    const after = await tx.openingBalance.update({ where: { id }, data });
    await audit(tx, userId, "UPDATE", "OpeningBalance", id, o, after);
    return {};
  }).catch((e: Error) => { if (e instanceof OpeningError) return { error: e.message }; throw e; });
}

/**
 * Bekor qilish (faqat direktor, sabab bilan). Yozuv o'chirilmaydi — tarix uchun qoladi, faol kaliti bo'shaydi
 * (keyin to'g'ri qoldiqni qayta kiritish mumkin). Bog'langan hujjat ham qaytariladi.
 */
export async function cancelOpening(id: string, reason: string, userId: string): Promise<{ error?: string }> {
  return db.$transaction(async (tx) => {
    const o = await tx.openingBalance.findUnique({ where: { id } });
    if (!o || o.cancelledAt) throw new OpeningError("Yozuv topilmadi yoki allaqachon bekor qilingan");
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"opening:" + o.activeKey}))`;
    switch (o.kind) {
      case "CUSTOMER": {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${o.customerId!}))`; // to'lov bilan navbat
        const inv = await tx.invoice.findUniqueOrThrow({ where: { id: o.invoiceId! }, include: { payments: { select: { id: true } } } });
        if (inv.payments.length) throw new OpeningError(`Bu qoldiqqa ${inv.payments.length} ta to'lov yozilgan — avval to'lovlarni bekor qiling (Kassa / bank)`);
        await tx.invoice.update({ where: { id: inv.id }, data: { status: "CANCELLED" } });
        await audit(tx, userId, "STATUS_CHANGE", "Invoice", inv.id, { status: inv.status }, { status: "CANCELLED", by: "opening", reason });
        break;
      }
      case "SUPPLIER": {
        const paid = (await supplierOpeningPaid(tx, [o.id])).get(o.id) ?? 0;
        if (Math.abs(paid) > 0.005) throw new OpeningError(`Bu qarzga ${money(paid)} to'langan — bekor qilib bo'lmaydi (summani tahrirlang)`);
        break;
      }
      case "CASH": {
        const t = await tx.cashTransaction.findUniqueOrThrow({ where: { id: o.cashTxId! } });
        if (Number(t.amount) > 0) { const err = await cashOutflowError(tx, t.cashAccountId, Number(t.amount)); if (err) throw new OpeningError(`Qoldiq olib tashlansa kassa minusga tushadi. ${err}`); }
        await tx.openingBalance.update({ where: { id }, data: { cashTx: { disconnect: true } } });
        await tx.cashTransaction.delete({ where: { id: t.id } });
        await audit(tx, userId, "DELETE", "CashTransaction", t.id, t, { by: "opening-cancel", reason });
        break;
      }
      case "STOCK": {
        const q = Number(o.qty ?? 0);
        await lockStock(tx); // sklad qulfi — qoldiq tekshiruvi bilan chiqim navbatda
        const left = await productStock(tx, o.productId!, o.warehouseId!);
        if (left - q < -0.0005) throw new OpeningError(`Skladda hozir ${left} qoldi — ${q} ni qaytarib bo'lmaydi (mahsulot sotilgan/jo'natilgan)`);
        const rev = await tx.stockMove.create({ data: { type: "ADJUSTMENT", date: new Date(), warehouseId: o.warehouseId!, productId: o.productId!, qty: -q, unitCost: o.unitCost, refType: OPENING_REF, refId: o.id, note: `${OPENING_CATEGORY} bekor qilindi${reason ? `: ${reason}` : ""}`, createdById: userId } });
        await audit(tx, userId, "CREATE", "StockMove", rev.id, undefined, rev);
        break;
      }
    }
    const after = await tx.openingBalance.update({ where: { id }, data: { activeKey: null, cancelledAt: new Date(), cancelledById: userId, cancelReason: reason.slice(0, 300) || null } });
    await audit(tx, userId, "STATUS_CHANGE", "OpeningBalance", id, { activeKey: o.activeKey }, { cancelled: true, reason, after });
    return {};
  }).catch((e: Error) => { if (e instanceof OpeningError) return { error: e.message }; throw e; });
}

// ───────────────────────── Yetkazuvchi qoldig'i (kreditorka) ─────────────────────────

export type SupplierOpeningDue = { id: string; supplierId: string; date: Date; amount: number; paid: number; left: number };

/**
 * Yetkazuvchilar bo'yicha faol boshlang'ich qoldiqlar va qolgan qarz (left).
 * `left` > 0 — bizning qarzimiz; < 0 — yetkazuvchiga bergan avansimiz (mol yoki pul qaytishi kerak).
 */
export async function supplierOpeningDues(supplierId?: string): Promise<SupplierOpeningDue[]> {
  const rows = await db.openingBalance.findMany({
    where: { kind: "SUPPLIER", cancelledAt: null, ...(supplierId ? { supplierId } : {}) },
    select: { id: true, supplierId: true, date: true, amount: true },
  });
  const paid = await supplierOpeningPaid(db, rows.map((r) => r.id));
  return rows.map((r) => {
    const p = paid.get(r.id) ?? 0;
    return { id: r.id, supplierId: r.supplierId!, date: r.date, amount: Number(r.amount), paid: p, left: r2(Number(r.amount) - p) };
  });
}

/** Yetkazuvchiga boshlang'ich qarzni to'lash (qisman ham bo'ladi): Kirim-Chiqimga chiqim yoziladi. */
export async function paySupplierOpening(id: string, cashAccountId: string, amount: number, userId: string): Promise<{ error?: string }> {
  if (!(amount > 0)) return { error: "Summa 0 dan katta bo'lsin" };
  return db.$transaction(async (tx) => {
    const o = await tx.openingBalance.findUnique({ where: { id }, include: { supplier: { select: { name: true } } } });
    if (!o || o.kind !== "SUPPLIER" || o.cancelledAt) throw new OpeningError("Qoldiq topilmadi");
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"opening:" + o.activeKey}))`;
    const acc = await tx.cashAccount.findFirst({ where: { id: cashAccountId, isActive: true }, select: { id: true } });
    if (!acc) throw new OpeningError("Kassa/hisob tanlanmagan");
    const left = Number(o.amount) - ((await supplierOpeningPaid(tx, [o.id])).get(o.id) ?? 0);
    if (amount > left + 0.005) throw new OpeningError(`Qolgan qarzdan ko'p: ${money(Math.max(0, left))}`);
    const err = await cashOutflowError(tx, acc.id, amount);
    if (err) throw new OpeningError(err);
    const t = await tx.cashTransaction.create({
      data: {
        type: "EXPENSE", date: new Date(), cashAccountId: acc.id, amount: r2(amount), category: "Xomashyo",
        supplierId: o.supplierId, counterparty: o.supplier?.name, note: `Boshlang'ich qarz to'lovi (${o.date.toLocaleDateString("ru-RU")} holatidagi qoldiq)`,
        refType: OPENING_REF, refId: o.id, createdById: userId,
      },
    });
    await audit(tx, userId, "CREATE", "CashTransaction", t.id, undefined, t);
    return {};
  }).catch((e: Error) => { if (e instanceof OpeningError) return { error: e.message }; throw e; });
}

export { OpeningError };
