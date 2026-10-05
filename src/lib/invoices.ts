import { db } from "./db";
import { audit } from "./audit";
import { nextNo } from "./numbering";
import { customerBalance } from "./receivables";

/**
 * Schyot yozish qoidasi — veb (`app/(app)/invoices/actions.ts`) ham, mobil ilova ham shu
 * funksiyani chaqiradi: tasdiqlanmagan zayavkaga schyot yo'q, bitta zayavkaga bitta schyot,
 * oldindan olingan avans schyotga bog'lanadi.
 */
export type InvoiceResult = { id?: string; invoiceNo?: string; status?: string; error?: string };

export async function createInvoice(input: { orderId: string; amount: number; date: Date }, userId: string): Promise<InvoiceResult> {
  if (!(input.amount > 0)) return { error: "Summa 0 dan katta bo'lsin" };

  return db.$transaction(async (tx) => {
    // Zayavka qulflanadi va BARCHA tekshiruvlar qulf ostida o'qiladi: ikki marta bosish (yoki veb + ilova)
    // ikkita schyot ochmasin, shu payt bekor qilingan / o'zgargan zayavkaga schyot yozilmasin
    await tx.$executeRaw`SELECT 1 FROM "Order" WHERE id = ${input.orderId} FOR UPDATE`;
    const o = await tx.order.findUnique({ where: { id: input.orderId }, include: { invoices: { where: { status: { not: "CANCELLED" } }, select: { id: true } }, items: { select: { qtyM3: true, price: true } } } });
    if (!o) return { error: "Zayavka topilmadi" };
    // Schyot zayavka summasidan oshmaydi (narxda NDS bor — `lib/nds.ts`): xato raqam mijozni qarzdor/qora ro'yxatga tushirmasin
    const orderTotal = o.items.reduce((x, i) => x + Number(i.qtyM3) * Number(i.price), 0);
    if (input.amount > orderTotal + 0.005) return { error: `Schyot zayavka summasidan (${Math.round(orderTotal).toLocaleString("ru-RU")} so'm) ko'p bo'lolmaydi` };
    if (["DRAFT", "BLOCKED", "CANCELLED"].includes(o.status)) return { error: "Tasdiqlanmagan zayavkaga schyot yozib bo'lmaydi" };
    if (o.invoices.length) return { error: "Bu zayavkaga schyot allaqachon yozilgan" };
    const inv = await tx.invoice.create({ data: { invoiceNo: await nextNo(tx, "invoice", "S"), date: input.date, customerId: o.customerId, orderId: o.id, amount: input.amount } });
    await audit(tx, userId, "CREATE", "Invoice", inv.id, undefined, inv);
    // Zayavka ochilganda olingan oldindan to'lov (avans) shu schyotga bog'lanadi
    const advances = await tx.payment.findMany({ where: { orderId: o.id, invoiceId: null } });
    let status = "OPEN";
    if (advances.length) {
      await tx.payment.updateMany({ where: { id: { in: advances.map((a) => a.id) } }, data: { invoiceId: inv.id } });
      const paid = advances.reduce((x, a) => x + Number(a.amount), 0);
      status = paid >= input.amount - 0.005 ? "PAID" : paid > 0 ? "PARTIAL" : "OPEN";
      if (status !== "OPEN") await tx.invoice.update({ where: { id: inv.id }, data: { status: status as "PAID" | "PARTIAL" } });
      await audit(tx, userId, "UPDATE", "Invoice", inv.id, { status: "OPEN" }, { status, advances: paid });
    }
    return { id: inv.id, invoiceNo: inv.invoiceNo, status };
  });
}

// ───────────────────────── Akt sverki (mijoz bilan solishtirma dalolatnoma) ─────────────────────────

export type StatementLine = { date: Date; doc: string; kind: "INVOICE" | "PAYMENT"; debit: number; credit: number; note: string | null; href?: string };
export type Statement = { opening: number; lines: StatementLine[]; debit: number; credit: number; closing: number };

/**
 * Davr bo'yicha akt sverki: boshlang'ich qoldiq, davrdagi schyotlar (debet) va to'lovlar (kredit), yakuniy qoldiq.
 * Qoida `lib/finance.ts` dagi qarz hisobi bilan bir xil: bekor qilingan schyot kirmaydi, Realizatsiya jurnali
 * to'lovlari (o'z sotuvini yopadi, ERP schyotlariga tegmaydi) kirmaydi. Musbat qoldiq — mijoz qarzi, manfiy — avans.
 */
export async function customerStatement(customerId: string, from: Date, to: Date): Promise<Statement> {
  const invWhere = { customerId, status: { not: "CANCELLED" as const } };
  const payWhere = { customerId, register: { is: null } };
  const [before, invoices, payments] = await Promise.all([
    // Davr boshidagi qoldiq — yagona mijoz balansi (receivables.ts) o'sha paytga
    customerBalance(customerId, { asOf: from }),
    db.invoice.findMany({ where: { ...invWhere, date: { gte: from, lte: to } }, orderBy: { date: "asc" }, include: { order: { select: { orderNo: true } } } }),
    db.payment.findMany({ where: { ...payWhere, date: { gte: from, lte: to } }, orderBy: { date: "asc" }, include: { invoice: { select: { invoiceNo: true } }, order: { select: { orderNo: true } }, cashAccount: { select: { name: true } } } }),
  ]);
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const opening = before.balance;
  const lines: StatementLine[] = [
    ...invoices.map((i): StatementLine => i.isOpening
      // Boshlang'ich qoldiq: musbat — mijoz qarzi (debet), manfiy — mijoz avansi (kredit)
      ? { date: i.date, doc: `Boshlang'ich qoldiq ${i.invoiceNo}`, kind: "INVOICE", debit: Math.max(0, Number(i.amount)), credit: Math.max(0, -Number(i.amount)), note: "tizimga o'tish sanasidagi qoldiq", href: undefined }
      : { date: i.date, doc: `Schyot ${i.invoiceNo}`, kind: "INVOICE", debit: Number(i.amount), credit: 0, note: i.order ? `zayavka ${i.order.orderNo}` : null, href: i.orderId ? `/orders/${i.orderId}` : undefined }),
    ...payments.map((p): StatementLine => ({ date: p.date, doc: `To'lov · ${p.cashAccount.name}`, kind: "PAYMENT", debit: 0, credit: Number(p.amount), note: p.invoice ? `schyot ${p.invoice.invoiceNo}` : p.order ? `avans ${p.order.orderNo}` : p.note, href: undefined })),
  ].sort((a, b) => a.date.getTime() - b.date.getTime() || (a.kind === b.kind ? 0 : a.kind === "INVOICE" ? -1 : 1));
  const debit = r2(lines.reduce((s, l) => s + l.debit, 0));
  const credit = r2(lines.reduce((s, l) => s + l.credit, 0));
  return { opening, lines, debit, credit, closing: r2(opening + debit - credit) };
}
