import { db } from "@/lib/db";
import { lineTotal, lineVat, receiptTotal } from "@/lib/receipt-vat";
import { payablesSince, PAID_IMPORT_TOKEN } from "@/lib/receipt-payables";
import { unitLabel } from "@/lib/unit";
import { finishLedger, type Ledger, type LedgerLine } from "@/lib/customer-ledger";
import { supplierPositions } from "./balance";

/**
 * Qarz varag'i tafsiloti — ta'minotchi tomoni; mijoz tomoni va umumiy tiplar `lib/customer-ledger.ts` da.
 */
export { customerLedger, type Ledger, type LedgerLine, type LedgerKind, type LedgerCol, type LedgerRef, type LedgerItem } from "@/lib/customer-ledger";

const r2 = (n: number) => Math.round(n * 100) / 100;
const dayStart = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const nextDay = (d: Date) => { const x = dayStart(d); x.setDate(x.getDate() + 1); return x; };

/** Ta'minotchi bilan `from`…`to` kunlari harakatlari (ishora — `supplierPositions`). */
export async function supplierLedger(id: string, from: Date, to: Date): Promise<Ledger | null> {
  const s = await db.supplier.findUnique({ where: { id }, select: { id: true, name: true } });
  if (!s) return null;
  const since = await payablesSince();
  const a = dayStart(from), b = nextDay(to);
  const [openMap, receipts, openings, txs] = await Promise.all([
    supplierPositions(a, since),
    db.goodsReceipt.findMany({
      where: { supplierId: id, cancelledAt: null, date: { gte: a, lt: b }, createdAt: { gte: since }, OR: [{ clientToken: null }, { NOT: { clientToken: { startsWith: PAID_IMPORT_TOKEN } } }] },
      select: {
        id: true, docNo: true, date: true, waybillNo: true, note: true, createdBy: { select: { fullName: true } },
        items: { select: { qty: true, price: true, vatAmount: true, deliveryCost: true, material: { select: { name: true, unit: true } } } },
      },
    }),
    db.openingBalance.findMany({ where: { kind: "SUPPLIER", supplierId: id, cancelledAt: null, date: { gte: a, lt: b } }, select: { id: true, date: true, amount: true, note: true } }),
    db.cashTransaction.findMany({
      where: { supplierId: id, cancelledAt: null, type: { in: ["INCOME", "EXPENSE"] }, date: { gte: a > since ? a : since, lt: b } },
      select: { id: true, date: true, type: true, amount: true, category: true, counterparty: true, note: true, cashAccount: { select: { name: true } }, createdBy: { select: { fullName: true } } },
    }),
  ]);
  const lines: LedgerLine[] = [
    ...openings.map((o): LedgerLine => ({ key: `ob:${o.id}`, kind: "OPENING", col: "open", date: o.date, amount: Number(o.amount), doc: "Boshlang'ich qoldiq", note: o.note, ref: { kind: "opening", id: o.id } })),
    ...receipts.map((r): LedgerLine => ({
      key: `gr:${r.id}`, kind: "RECEIPT", col: "sold", date: r.date, amount: receiptTotal(r.items), doc: "Kirim hujjati", no: r.docNo,
      note: [r.waybillNo && `yuk xati ${r.waybillNo}`, r.note].filter(Boolean).join(" · ") || null, by: r.createdBy?.fullName ?? null, href: `/receipts/${r.id}`,
      items: r.items.map((i) => { const qty = Number(i.qty); return { name: i.material.name, unit: unitLabel(i.material.unit), qty, price: Number(i.price), delivery: Number(i.deliveryCost), vat: lineVat(i), total: r2(lineTotal(i)) }; }),
      ref: { kind: "receipt", id: r.id },
    })),
    ...txs.map((t): LedgerLine => ({
      key: `tx:${t.id}`, kind: t.type === "EXPENSE" ? "PAYMENT" : "REFUND", col: "paid", date: t.date,
      amount: t.type === "EXPENSE" ? -Number(t.amount) : Number(t.amount),
      doc: t.type === "EXPENSE" ? `To'lov · ${t.category}` : `Qaytarilgan pul · ${t.category}`, note: t.note,
      account: t.cashAccount.name, counterparty: t.counterparty, by: t.createdBy.fullName, ref: { kind: "tx", id: t.id },
    })),
  ];
  return finishLedger({ who: "supplier", id: s.id, name: s.name, from: a, to: dayStart(to), start: openMap.get(id) ?? 0, lines });
}
