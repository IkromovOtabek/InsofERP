import { db } from "@/lib/db";
import { customerBalance } from "@/lib/receivables";
import { debtSales } from "@/lib/debt-sales";
import { unitLabel } from "@/lib/unit";

/**
 * Qarz varag'i (Tahlil → Mijozlar) tafsiloti — bitta mijoz yoki ta'minotchi bilan davrdagi barcha harakat, manbasi bilan.
 * Alohida modul (`fin-report/` tashqarisida): `invoices.ts → customerStatement` ham shundan o'qiydi, `fin-report/balance.ts` zanjiri
 * bilan aylanma import bo'lmasin. Raqamlar `receivables.ts` (mijoz) va `supplierPositions` (ta'minotchi) bilan bitta qoida: davr boshidagi qoldiq +
 * debet − kredit = davr oxiridagi qoldiq. Akt sverka (`invoices.ts → customerStatement`, `akt.ts`) ham shu qatorlardan.
 *
 * Mijoz: debet — boshlang'ich qoldiq (qarz), schyot, qarzga sotuv (Realizatsiya reestri «Qarz»), mijozga qaytarilgan pul,
 *        boshqa mijoz qarzini to'lagani; kredit — to'lov, kassa qarz to'lovi, uning qarzini boshqa mijoz to'lagani.
 * Ta'minotchi (ishora — `supplierPositions`: musbat = biz qarzmiz): debet — boshlang'ich qoldiq (qarzimiz), kirim hujjati;
 *        kredit — biz to'lagan pul; qaytarilgan pul — debet.
 */

export type LedgerKind = "OPENING" | "INVOICE" | "SALE" | "PAYMENT" | "CASH" | "REFUND" | "TRANSFER" | "RECEIPT";
/** Varaq ustuni: boshlang'ich qoldiq, sotuv (kirim), to'lov */
export type LedgerCol = "open" | "sold" | "paid";
export type LedgerRef =
  | { kind: "opening"; id: string }
  | { kind: "invoice"; id: string }
  | { kind: "entry"; id: string }
  | { kind: "order"; id: string }
  | { kind: "pay"; id: string }
  | { kind: "tx"; id: string }
  | { kind: "transfer"; id: string }
  | { kind: "receipt"; id: string };

export type LedgerItem = { name: string; unit: string; qty: number; price: number; delivery: number; vat: number; total: number };
export type LedgerLine = {
  key: string; kind: LedgerKind; col: LedgerCol; date: Date;
  /** Qarzga ta'siri: + qarz ortadi (mijoz bizga / biz ta'minotchiga), − kamayadi */
  amount: number;
  doc: string; no?: string | null; note?: string | null; href?: string;
  /** Sotuv / kirim tarkibi (mahsulot, miqdor, narx) */
  items?: LedgerItem[];
  /** Sotuv tafsiloti (reestr qatori) */
  ttn?: string | null; vehicle?: string | null; address?: string | null; pay?: string | null; seller?: string | null;
  /** To'lov tafsiloti */
  account?: string | null; counterparty?: string | null; by?: string | null;
  ref?: LedgerRef;
};
export type Ledger = {
  who: "customer" | "supplier"; id: string; name: string;
  from: Date; to: Date;
  /** Davr boshidagi qoldiq (musbat — ular bizga qarz / ta'minotchida — biz qarzmiz) */
  start: number; lines: LedgerLine[];
  open: number; sold: number; paid: number; closing: number;
};

const r2 = (n: number) => Math.round(n * 100) / 100;
const dayStart = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const nextDay = (d: Date) => { const x = dayStart(d); x.setDate(x.getDate() + 1); return x; };

export function finishLedger(l: Omit<Ledger, "open" | "sold" | "paid" | "closing">): Ledger {
  const lines = [...l.lines].sort((a, b) => a.date.getTime() - b.date.getTime() || (a.amount > 0 ? -1 : 1) - (b.amount > 0 ? -1 : 1) || a.key.localeCompare(b.key));
  const sum = (c: LedgerCol) => r2(lines.filter((x) => x.col === c).reduce((s, x) => s + x.amount, 0));
  const opening = sum("open"), sold = sum("sold"), paid = r2(-sum("paid"));
  return { ...l, lines, open: r2(l.start + opening), sold, paid, closing: r2(l.start + opening + sold - paid) };
}

/** Mijoz bilan `from`…`to` kunlari (ikkalasi ham kiradi) harakatlari. */
export async function customerLedger(id: string, from: Date, to: Date): Promise<Ledger | null> {
  const c = await db.customer.findUnique({ where: { id }, select: { id: true, name: true } });
  if (!c) return null;
  const a = dayStart(from), b = nextDay(to);
  const date = { gte: a, lt: b };
  const [before, invoices, sales, payments, cash, transfers] = await Promise.all([
    customerBalance(id, { asOf: a }),
    db.invoice.findMany({
      where: { customerId: id, status: { not: "CANCELLED" }, date },
      select: {
        id: true, invoiceNo: true, date: true, amount: true, isOpening: true, orderId: true,
        opening: { select: { id: true, note: true } },
        order: { select: { orderNo: true, deliveryDate: true, deliveryAddress: true, items: { select: { qtyM3: true, price: true, product: { select: { name: true, unit: true } } } } } },
      },
    }),
    debtSales({ ids: [id] }).then((l) => l.filter((x) => x.date >= a && x.date < b)),
    db.payment.findMany({
      where: { customerId: id, register: { is: null }, date },
      select: { id: true, date: true, amount: true, note: true, invoice: { select: { invoiceNo: true } }, cashAccount: { select: { name: true } }, createdBy: { select: { fullName: true } } },
    }),
    db.cashTransaction.findMany({
      where: { customerId: id, cancelledAt: null, type: { in: ["INCOME", "EXPENSE"] }, date },
      select: { id: true, date: true, type: true, amount: true, category: true, counterparty: true, note: true, cashAccount: { select: { name: true } }, createdBy: { select: { fullName: true } } },
    }),
    db.customerDebtTransfer.findMany({
      where: { cancelledAt: null, date, OR: [{ debtorId: id }, { payerId: id }] },
      select: { id: true, docNo: true, date: true, amount: true, note: true, debtorId: true, debtor: { select: { name: true } }, payer: { select: { name: true } }, createdBy: { select: { fullName: true } } },
    }),
  ]);

  const lines: LedgerLine[] = [
    ...invoices.map((i): LedgerLine => i.isOpening
      ? { key: `inv:${i.id}`, kind: "OPENING", col: "open", date: i.date, amount: Number(i.amount), doc: "Boshlang'ich qoldiq", no: i.invoiceNo, note: i.opening?.note ?? null, ref: i.opening ? { kind: "opening", id: i.opening.id } : undefined }
      : {
        key: `inv:${i.id}`, kind: "INVOICE", col: "sold", date: i.date, amount: Number(i.amount), doc: "Schyot", no: i.invoiceNo,
        note: i.order ? `zayavka ${i.order.orderNo}` : null, href: i.orderId ? `/orders/${i.orderId}` : undefined, address: i.order?.deliveryAddress ?? null,
        items: i.order?.items.map((x) => { const qty = Number(x.qtyM3), price = Number(x.price); return { name: x.product.name, unit: unitLabel(x.product.unit), qty, price, delivery: 0, vat: 0, total: r2(qty * price) }; }),
        ref: { kind: "invoice", id: i.id },
      }),
    ...sales.map(({ row: r, ...x }): LedgerLine => ({
      key: `rz:${x.key}`, kind: "SALE", col: "sold", date: x.date, amount: x.total,
      doc: r.source === "MANUAL" ? "Realizatsiya (qo'lda)" : "Realizatsiya (reys)", no: r.ttn ? `TTN ${r.ttn}` : null, note: r.note || null,
      items: [{ name: r.product, unit: r.unit, qty: r.qty, price: r.price, delivery: r.delivery, vat: r.vat, total: r.total }],
      ttn: r.ttn, vehicle: r.vehicle, address: r.destination || null, pay: r.payLabel, seller: r.seller || null,
      href: r.orderId ? `/orders/${r.orderId}` : undefined,
      ref: r.source === "MANUAL" ? { kind: "entry", id: r.ref } : r.orderId ? { kind: "order", id: r.orderId } : undefined,
    })),
    ...payments.map((p): LedgerLine => ({
      key: `pay:${p.id}`, kind: "PAYMENT", col: "paid", date: p.date, amount: -Number(p.amount), doc: "To'lov", no: p.invoice ? `schyot ${p.invoice.invoiceNo}` : null,
      note: p.note, account: p.cashAccount.name, by: p.createdBy?.fullName ?? null, ref: { kind: "pay", id: p.id },
    })),
    ...cash.map((t): LedgerLine => t.type === "INCOME"
      ? { key: `tx:${t.id}`, kind: "CASH", col: "paid", date: t.date, amount: -Number(t.amount), doc: `Kassa kirimi · ${t.category}`, note: t.note, account: t.cashAccount.name, counterparty: t.counterparty, by: t.createdBy.fullName, ref: { kind: "tx", id: t.id } }
      : { key: `tx:${t.id}`, kind: "REFUND", col: "paid", date: t.date, amount: Number(t.amount), doc: `Mijozga qaytarilgan pul · ${t.category}`, note: t.note, account: t.cashAccount.name, counterparty: t.counterparty, by: t.createdBy.fullName, ref: { kind: "tx", id: t.id } }),
    ...transfers.map((t): LedgerLine => t.debtorId === id
      ? { key: `qo:${t.id}`, kind: "TRANSFER", col: "paid", date: t.date, amount: -Number(t.amount), doc: `Qarzini ${t.payer.name} to'ladi`, no: t.docNo, note: t.note, counterparty: t.payer.name, by: t.createdBy.fullName, ref: { kind: "transfer", id: t.id } }
      : { key: `qo:${t.id}`, kind: "TRANSFER", col: "paid", date: t.date, amount: Number(t.amount), doc: `${t.debtor.name} qarzini to'ladi`, no: t.docNo, note: t.note, counterparty: t.debtor.name, by: t.createdBy.fullName, ref: { kind: "transfer", id: t.id } }),
  ];
  return finishLedger({ who: "customer", id: c.id, name: c.name, from: a, to: dayStart(to), start: before.balance, lines });
}
