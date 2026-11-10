import { db } from "@/lib/db";
import type { Session } from "@/lib/auth";
import { canDo } from "@/lib/permissions";
import { cashActivity, type ActivityRow } from "@/lib/activity";
import { date, fmtNum, isoDate, money, opAt } from "@/lib/format";
import { TRANSFER_REF } from "@/lib/cash-tx";
import { SALES_MANBA } from "@/lib/cash-import";
import { cashEntryDeleteBlock, cashEntryEditBlock, cashEntryLocked, cashEntryLocks, cashEntrySig } from "@/lib/cash-entry";
import { paymentLocks, paymentSig } from "@/lib/payments";
import { transferSig } from "@/lib/cash-transfer";
import { payKindLabel } from "@/lib/sales-register";
import { registerEditRow } from "./register-table";
import type { CashEditEntry } from "./cash-edit";
import type { RegisterEditRow } from "./register-edit";

/**
 * Kassa / bank ro'yxatlarida qator bosilganda ochiladigan tafsilot (`cash-detail.tsx`): yozuvning barcha ustunlari,
 * kim va qachon kiritgani, amallar tarixi (AuditLog) va shu foydalanuvchiga ruxsat etilgan tugmalar — Tahrirlash,
 * Bekor qilish, O'chirish. Sahifaga har qator uchun oldindan yuborilmaydi: bosilganda `cashRowInfo` orqali o'qiladi.
 *
 * Qator turlari: `tx` — kirim/chiqim (CashTransaction), `pay` — mijoz to'lovi (Payment), `transfer` — perekit hujjati
 * (CashTransfer; jurnaldagi ikkala oyog'i ham shu hujjatni ochadi), `reg` — realizatsiya jurnali qatori (SalesRegister).
 */
export const CASH_ROW_KINDS = ["tx", "pay", "transfer", "reg"] as const;
export type CashRowKind = (typeof CASH_ROW_KINDS)[number];

/** Tugma: `false` — ko'rsatilmaydi (ruxsat yo'q yoki bu yozuvda bunday amal yo'q); `null` — bosiladi; matn — nega bosilmaydi. */
export type RowBtn = false | null | string;

export type CashRowDetail = {
  kind: CashRowKind;
  id: string;
  title: string;
  /** Summa va uning ishorasi: kirim yashil, chiqim qizil, perekit ko'k */
  amount: number;
  tone: "in" | "out" | "transfer";
  fields: { label: string; value: string; href?: string }[];
  createdBy: string | null;
  createdAt: Date;
  /** «sabab · kim · qachon» — bekor qilinmagan bo'lsa null */
  cancelled: string | null;
  history: ActivityRow[];
  /** Tahrir oynasi qiymatlari (ruxsat bo'lsa) */
  edit?: CashEditEntry;
  reg?: RegisterEditRow;
  buttons: { edit: RowBtn; cancel: RowBtn; remove: RowBtn };
  /** Bekor qilish va o'chirish shu yozuvda nima qilishi — tugmalar ostida */
  notes: string[];
};

const acc = (a: { name: string; type: "CASH" | "BANK" }) => `${a.name} (${a.type === "CASH" ? "naqd" : "bank"})`;
/** Ruxsat bo'lsa — to'siq (null yoki sabab), aks holda tugma ko'rinmaydi. */
const btn = (allowed: boolean, block: string | null): RowBtn => (allowed ? block : false);
const field = (label: string, value: string | null | undefined, href?: string) => (value ? [{ label, value, href }] : []);

export async function cashRowDetail(kind: CashRowKind, id: string, s: Session): Promise<CashRowDetail | null> {
  if (kind === "tx") return txDetail(id, s);
  if (kind === "pay") return payDetail(id, s);
  if (kind === "transfer") return transferDetail(id, s);
  return regDetail(id, s);
}

/* ───────── Kirim / chiqim ───────── */

async function txDetail(id: string, s: Session): Promise<CashRowDetail | null> {
  const t = await db.cashTransaction.findUnique({
    where: { id },
    include: {
      cashAccount: { select: { name: true, type: true } }, supplier: { select: { name: true } }, createdBy: { select: { fullName: true } },
      project: { select: { name: true } }, loan: { select: { name: true } },
    },
  });
  if (!t) return null;
  // Perekit oyog'i — hujjatning o'zi ochiladi (tahrir, storno hujjat bo'yicha)
  if (t.refType === TRANSFER_REF && t.refId && (t.type === "TRANSFER_IN" || t.type === "TRANSFER_OUT")) {
    const doc = await transferDetail(t.refId, s);
    if (doc) return doc;
  }
  const inc = t.type === "INCOME" || t.type === "TRANSFER_IN";
  const canEdit = canDo(s, "cashflow", "edit");
  const canDelete = canDo(s, "cashflow", "delete");
  const [history, cancelledBy, cancelBlock, deleteBlock] = await Promise.all([
    cashActivity([{ entity: "CashTransaction", ids: [t.id] }]),
    t.cancelledById ? db.user.findUnique({ where: { id: t.cancelledById }, select: { fullName: true } }) : null,
    canDelete ? cashEntryLocked(t) : null,
    canDelete ? cashEntryDeleteBlock(t) : null,
  ]);
  const editBlock = cashEntryEditBlock(t);
  const href = t.refType === "GoodsReceipt" && t.refId ? `/receipts/${t.refId}`
    : t.refType === "StockIn" && t.refId ? `/stock?tab=moves&ref=${t.refId}`
    : t.refType === "MechanicRequest" && t.refId ? `/mexanik-sorovlar/${t.refId}`
    : undefined;
  const who = t.counterparty ?? t.supplier?.name ?? null;
  const manual = t.type === "INCOME" || t.type === "EXPENSE";
  return {
    kind: "tx", id: t.id,
    title: t.type === "INCOME" ? "Kirim" : t.type === "EXPENSE" ? "Chiqim" : t.type === "OPENING" ? "Boshlang'ich qoldiq" : "Perekit yozuvi",
    amount: Number(t.amount), tone: inc ? "in" : "out",
    fields: [
      { label: "Sana", value: opAt(t.date, t.createdAt) },
      { label: "Hisob", value: acc(t.cashAccount) },
      { label: "Manba", value: t.category },
      ...field("Sub manba", t.subCategory),
      ...field(inc ? "Kimdan" : "Kimga", who),
      ...field("Loyiha", t.project?.name),
      ...field("Kredit", t.loan?.name),
      ...field("Hujjat", href ? "Hujjatni ochish →" : null, href),
      ...field("Izoh", t.note),
    ],
    createdBy: t.createdBy.fullName, createdAt: t.createdAt,
    cancelled: t.cancelledAt ? [t.cancelReason, cancelledBy?.fullName, opAt(t.cancelledAt, t.cancelledAt)].filter(Boolean).join(" · ") : null,
    history,
    edit: canEdit && manual && !editBlock ? {
      kind: "tx", id: t.id, type: t.type as "INCOME" | "EXPENSE", date: isoDate(t.date), cashAccountId: t.cashAccountId, amount: Number(t.amount),
      category: t.category, subCategory: t.subCategory ?? "", counterparty: who ?? "", note: t.note ?? "", sig: cashEntrySig(t), lock: cashEntryLocks(t),
    } : undefined,
    buttons: {
      edit: btn(canEdit, editBlock),
      cancel: btn(canDelete && manual, cancelBlock),
      remove: btn(canDelete && manual, deleteBlock),
    },
    notes: manual ? ["Bekor qilingan yozuv jurnalda kulrang bo'lib qoladi (qoldiq va jamiga kirmaydi); o'chirilgan yozuv jurnaldan butunlay olinadi. Ikkalasi ham Amallar tarixida saqlanadi."] : [],
  };
}

/* ───────── Mijoz to'lovi ───────── */

async function payDetail(id: string, s: Session): Promise<CashRowDetail | null> {
  const p = await db.payment.findUnique({
    where: { id },
    include: {
      customer: { select: { name: true } }, invoice: { select: { invoiceNo: true } }, order: { select: { deliveryDate: true } },
      cashAccount: { select: { name: true, type: true } }, createdBy: { select: { fullName: true } }, register: { select: { id: true } },
    },
  });
  if (!p) return null;
  const canEdit = canDo(s, "cashflow", "edit");
  const canStorno = canDo(s, "payments", "storno");
  const history = await cashActivity([{ entity: "Payment", ids: [p.id] }, ...(p.register ? [{ entity: "SalesRegister", ids: [p.register.id] }] : [])]);
  return {
    kind: "pay", id: p.id, title: "Mijoz to'lovi", amount: Number(p.amount), tone: "in",
    fields: [
      { label: "Sana", value: opAt(p.date, p.createdAt) },
      { label: "Hisob", value: acc(p.cashAccount) },
      { label: "Manba", value: SALES_MANBA },
      { label: "Mijoz", value: p.customer.name, href: `/customers/${p.customerId}` },
      { label: "Nimaga", value: p.invoice ? `Schyot ${p.invoice.invoiceNo}` : p.register ? "Realizatsiya jurnali qatori" : p.order ? `Zayavka avansi · ${date(p.order.deliveryDate)}` : "Mijoz avansi (taqsimlanmagan)", href: p.orderId && !p.invoice ? `/orders/${p.orderId}` : undefined },
      ...field("Izoh", p.note),
    ],
    createdBy: p.createdBy?.fullName ?? null, createdAt: p.createdAt, cancelled: null, history,
    edit: canEdit ? {
      kind: "pay", id: p.id, date: isoDate(p.date), cashAccountId: p.cashAccountId, amount: Number(p.amount), customerId: p.customerId,
      customerName: p.customer.name, note: p.note ?? "", sig: paymentSig(p), lock: paymentLocks(p),
    } : undefined,
    buttons: {
      edit: btn(canEdit, null),
      // To'lovda «bekor qilingan» holati yo'q: storno yozuvni o'chiradi
      cancel: false,
      remove: btn(canStorno, p.register ? "Realizatsiya jurnalidan yozilgan to'lov — o'sha qator bilan birga o'chiriladi" : null),
    },
    notes: ["To'lov o'chirilsa (storno) pul hisobdan chiqadi, schyot qayta ochiladi; oldingi holati Amallar tarixida qoladi."],
  };
}

/* ───────── Perekit (o'tkazma hujjati) ───────── */

async function transferDetail(id: string, s: Session): Promise<CashRowDetail | null> {
  const t = await db.cashTransfer.findUnique({
    where: { id },
    include: {
      fromAccount: { select: { name: true, type: true } }, toAccount: { select: { name: true, type: true } },
      createdBy: { select: { fullName: true } }, cancelledBy: { select: { fullName: true } },
    },
  });
  if (!t) return null;
  const canEdit = canDo(s, "cashflow", "edit");
  const canStorno = canDo(s, "cashflow", "transfer_storno");
  const history = await cashActivity([{ entity: "CashTransfer", ids: [t.id] }]);
  const fee = Number(t.fee ?? 0);
  return {
    kind: "transfer", id: t.id, title: `Perekit ${t.docNo}`, amount: Number(t.amount), tone: "transfer",
    fields: [
      { label: "Sana", value: opAt(t.date, t.createdAt) },
      { label: "Qayerdan", value: acc(t.fromAccount) },
      { label: "Qayerga", value: acc(t.toAccount) },
      ...field("Komissiya", fee > 0 ? money(fee) : null),
      ...field("Izoh", t.note),
    ],
    createdBy: t.createdBy.fullName, createdAt: t.createdAt,
    cancelled: t.cancelledAt ? [t.cancelReason, t.cancelledBy?.fullName, opAt(t.cancelledAt, t.cancelledAt)].filter(Boolean).join(" · ") : null,
    history,
    edit: canEdit && !t.cancelledAt ? {
      kind: "transfer", id: t.id, docNo: t.docNo, date: isoDate(t.date), fromAccountId: t.fromAccountId, toAccountId: t.toAccountId,
      amount: Number(t.amount), note: t.note ?? "", sig: transferSig(t), feeLock: fee > 0,
    } : undefined,
    buttons: {
      edit: btn(canEdit, t.cancelledAt ? "Bekor qilingan o'tkazma tahrirlanmaydi" : null),
      cancel: btn(canStorno, t.cancelledAt ? "Bu o'tkazma allaqachon bekor qilingan" : null),
      remove: btn(canStorno, null),
    },
    notes: ["Bekor qilinsa ikkala hisobdagi yozuv o'chadi, hujjat Kirim-Chiqim → O'tkazmalarda «bekor qilingan» bo'lib qoladi; o'chirilsa hujjat ham qolmaydi. Ikkalasi ham Amallar tarixida saqlanadi."],
  };
}

/* ───────── Realizatsiya jurnali qatori ───────── */

async function regDetail(id: string, s: Session): Promise<CashRowDetail | null> {
  const r = await db.salesRegister.findUnique({
    where: { id },
    include: { customer: { select: { name: true } }, cashAccount: { select: { name: true, type: true } }, createdBy: { select: { fullName: true } }, payment: { select: { id: true } } },
  });
  if (!r) return null;
  const canEdit = canDo(s, "cashflow", "edit");
  const canDelete = canDo(s, "cashflow", "delete");
  const history = await cashActivity([{ entity: "SalesRegister", ids: [r.id] }, ...(r.paymentId ? [{ entity: "Payment", ids: [r.paymentId] }] : [])]);
  const num = (label: string, v: unknown) => field(label, Number(v) ? fmtNum(Number(v)) : null);
  return {
    kind: "reg", id: r.id, title: "Realizatsiya qatori", amount: Number(r.total), tone: "in",
    fields: [
      { label: "Sana", value: opAt(r.date, r.createdAt) },
      { label: "Mijoz", value: r.customer.name, href: `/payments/mijoz/${r.customerId}` },
      { label: "Mahsulot", value: r.productName },
      { label: "Miqdor", value: `${fmtNum(Number(r.qty), 3)} ${r.unit}` },
      ...field("Mashina №", r.vehicleNo),
      ...field("TTN", r.ttn),
      ...field("Kimdan", r.fromWho),
      { label: "Deniga", value: payKindLabel(r.payType) },
      ...num("Dostavka", r.deliveryFee),
      ...num("Narx", r.price),
      ...num("Summa (NDS'siz)", r.sum),
      ...num("NDS", r.nds),
      ...field("Manzil", r.address),
      ...field("Shartnoma", r.contractNo),
      ...field("Schyot", r.invoiceNo),
      ...field("Oy", r.monthNo),
      { label: "Kassaga kirim", value: r.payment ? (r.cashAccount ? `yozilgan — ${acc(r.cashAccount)}` : "yozilgan") : "yozilmagan (faqat jurnal)" },
      ...field("Izoh", r.note),
    ],
    createdBy: r.createdBy.fullName, createdAt: r.createdAt, cancelled: null, history,
    reg: canEdit ? registerEditRow(r) : undefined,
    buttons: { edit: btn(canEdit, null), cancel: false, remove: btn(canDelete, null) },
    notes: [r.payment ? "Qator o'chirilsa undan kassaga yozilgan kirim ham birga o'chadi; oldingi holati Amallar tarixida qoladi." : "O'chirilgan qator Amallar tarixida qoladi."],
  };
}
