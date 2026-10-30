import { db } from "@/lib/db";
import { customerStatement } from "@/lib/invoices";
import { receiptTotal } from "@/lib/receipt-vat";
import { payablesSince, PAID_IMPORT_TOKEN } from "@/lib/receipt-payables";
import { dateRu } from "@/lib/format";
import { supplierPositions } from "./balance";

/**
 * Akt sverka (o'zaro hisob-kitoblarni solishtirish dalolatnomasi) — korxona buxgalteriyasi nuqtai nazaridan:
 *  · xaridor: Debet — hisob-faktura (sotuv), Kredit — mijoz to'lovi (`customerStatement` bilan bir hisob);
 *  · ta'minotchi: Debet — biz to'lagan pul, Kredit — kirim hujjati (QQS va dostavka bilan) (`supplierPositions` bilan bir hisob).
 * Saldo ishorasi ikkalasida bir xil: musbat — ular bizga qarz (debet saldo), manfiy — biz ularga qarzmiz (kredit saldo).
 * Qarz varaqlari (Tahlil → Mijozlar) va mijoz kartasidagi akt shu yerdan o'qiydi.
 */

export type AktWho = "customer" | "supplier";
export type AktLine = { date: Date; doc: string; debit: number; credit: number; href?: string };
export type Akt = {
  who: AktWho; id: string; name: string; contractNo: string | null;
  from: Date; to: Date;
  opening: number; lines: AktLine[]; debit: number; credit: number; closing: number;
};

const r2 = (n: number) => Math.round(n * 100) / 100;
const dayStart = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const nextDay = (d: Date) => { const x = dayStart(d); x.setDate(x.getDate() + 1); return x; };

/** `from` / `to` — davr kunlari (kun boshi); `to` kuni ham davrga kiradi. */
export async function customerAkt(id: string, from: Date, to: Date): Promise<Akt | null> {
  const c = await db.customer.findUnique({ where: { id }, select: { id: true, name: true } });
  if (!c) return null;
  const toEnd = new Date(nextDay(to).getTime() - 1);
  const [st, contract] = await Promise.all([
    customerStatement(id, dayStart(from), toEnd),
    db.order.findFirst({ where: { customerId: id, contractNo: { not: null }, status: { not: "CANCELLED" } }, orderBy: { date: "desc" }, select: { contractNo: true } }),
  ]);
  const lines = st.lines.map((l): AktLine => ({
    date: l.date, debit: l.debit, credit: l.credit, href: l.href,
    doc: l.kind === "PAYMENT"
      ? `To'lov ${dateRu(l.date)}${l.account ? ` (${l.account})` : ""}`
      : l.doc.startsWith("Boshlang'ich") ? "Boshlang'ich qoldiq (tizimga o'tish)" : `Hisob-faktura № ${l.no ?? ""} (${dateRu(l.date)})`,
  }));
  return { who: "customer", id: c.id, name: c.name, contractNo: contract?.contractNo ?? null, from: dayStart(from), to: dayStart(to), opening: st.opening, lines, debit: st.debit, credit: st.credit, closing: st.closing };
}

export async function supplierAkt(id: string, from: Date, to: Date): Promise<Akt | null> {
  const s = await db.supplier.findUnique({ where: { id }, select: { id: true, name: true } });
  if (!s) return null;
  const since = await payablesSince();
  const a = dayStart(from), b = nextDay(to);
  const [openMap, receipts, openings, txs, contract] = await Promise.all([
    supplierPositions(a, since),
    db.goodsReceipt.findMany({
      where: { supplierId: id, cancelledAt: null, date: { gte: a, lt: b }, createdAt: { gte: since }, OR: [{ clientToken: null }, { NOT: { clientToken: { startsWith: PAID_IMPORT_TOKEN } } }] },
      orderBy: { date: "asc" },
      select: { id: true, docNo: true, date: true, waybillNo: true, items: { select: { qty: true, price: true, vatAmount: true, deliveryCost: true } } },
    }),
    db.openingBalance.findMany({ where: { kind: "SUPPLIER", supplierId: id, cancelledAt: null, date: { gte: a, lt: b } }, select: { date: true, amount: true } }),
    db.cashTransaction.findMany({
      where: { supplierId: id, cancelledAt: null, type: { in: ["INCOME", "EXPENSE"] }, date: { gte: a > since ? a : since, lt: b } },
      orderBy: { date: "asc" },
      select: { date: true, type: true, amount: true, cashAccount: { select: { name: true } } },
    }),
    db.supplyRequest.findFirst({ where: { supplierId: id, contractNo: { not: null } }, orderBy: { createdAt: "desc" }, select: { contractNo: true } }),
  ]);
  // supplierPositions: musbat — qarzimiz → akt saldosida manfiy (kredit)
  const opening = r2(-(openMap.get(id) ?? 0));
  const lines: AktLine[] = [
    ...openings.map((o): AktLine => { const v = Number(o.amount); return { date: o.date, doc: "Boshlang'ich qoldiq (tizimga o'tish)", debit: v < 0 ? -v : 0, credit: v > 0 ? v : 0 }; }),
    ...receipts.map((r): AktLine => ({ date: r.date, doc: `Kirim № ${r.docNo}${r.waybillNo ? `, yuk xati ${r.waybillNo}` : ""} (${dateRu(r.date)})`, debit: 0, credit: receiptTotal(r.items), href: `/receipts/${r.id}` })),
    ...txs.map((t): AktLine => t.type === "EXPENSE"
      ? { date: t.date, doc: `To'lov ${dateRu(t.date)} (${t.cashAccount.name})`, debit: Number(t.amount), credit: 0 }
      : { date: t.date, doc: `Qaytarilgan pul ${dateRu(t.date)} (${t.cashAccount.name})`, debit: 0, credit: Number(t.amount) }),
  ].sort((x, y) => x.date.getTime() - y.date.getTime() || y.credit - x.credit);
  const debit = r2(lines.reduce((v, l) => v + l.debit, 0));
  const credit = r2(lines.reduce((v, l) => v + l.credit, 0));
  return { who: "supplier", id: s.id, name: s.name, contractNo: contract?.contractNo ?? null, from: a, to: dayStart(to), opening, lines, debit, credit, closing: r2(opening + debit - credit) };
}

/** Davr parametrlari (YYYY-MM-DD): sukut — `dan` joriy oy boshi, `gacha` bugun; teskari bo'lsa almashtiriladi. */
export function parseAktRange(dan?: string, gacha?: string): { from: Date; to: Date } {
  const today = dayStart(new Date());
  const p = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T00:00:00`) : null);
  const ok = (d: Date | null) => (d && !Number.isNaN(d.getTime()) ? d : null);
  let to = ok(p(gacha)) ?? today;
  if (to > today) to = today;
  let from = ok(p(dan)) ?? new Date(to.getFullYear(), to.getMonth(), 1);
  if (from > to) [from, to] = [to, from];
  return { from, to };
}
