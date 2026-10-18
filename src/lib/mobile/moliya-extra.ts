import { db } from "@/lib/db";
import type { OpeningKind, PayrollKind, Prisma } from "@/generated/prisma";
import { canDo } from "@/lib/permissions";
import { dateRu, fmtNum } from "@/lib/format";
import { accountBalances, linkPaymentToInvoice, reversePayment } from "@/lib/payments";
import { cancelCashEntry, cashEntryLocked, payReceiptEntry } from "@/lib/cash-entry";
import { CANCELLED_LABEL, cancelNote, cancellerNames } from "@/lib/cancelled";
import { unpaidReceipts } from "@/lib/receipt-payables";
import { cancelInvoice } from "@/lib/invoices";
import { companyVatPayer, inputVatReport } from "@/lib/receipt-vat";
import { KIND_LABEL, paySupplierOpening, supplierOpeningDues, supplierOpeningPayments } from "@/lib/opening-balances";
import { calculateRun, recalculateRun, type PayrollWho } from "@/lib/hr/payroll";
import { PAYROLL_KIND_LABEL } from "@/lib/hr/labels";
import { monthTitle, today as todayIso } from "@/lib/davomat";
import { receivablesReport } from "@/lib/receivables";
import { cashForecast7 } from "@/lib/bi/finance";
import { goLiveDate, startOfDay } from "@/lib/bi/core";
import { payKindLabel } from "@/lib/sales-register";
import { payAccounts } from "@/lib/mechanic-requests";
import { TRANSFER_REF, TX_TYPE_LABEL } from "@/lib/cash-tx";
import { unitShort } from "@/lib/unit";
import type { MobileUser } from "./auth";
import type { CreateForm, CreateResult } from "./create";
import type { DetailAction, DetailField, FormField, FormOption, MobileDetail } from "./detail";
import { can } from "./detail";
import type { HomeCard, HomeRow, HomeSection, Tone } from "./home";
import { ListError, SKLAD_PERIODS, skladPeriod, type ListFilter, type MobileList } from "./list";
import { payables } from "./payables";
import { money, short, shortSigned } from "./fmt";

/**
 * Moliya kabinetlari (kassir, buxgalteriya, moliya, sekretar) — vebdagi bilan tenglashtirish:
 *   · To'lovlar: filtr chiplari, storno (sabab bilan), taqsimlanmagan to'lovni schyotga bog'lash;
 *   · Kirim-chiqim: tur + davr chiplari, mijoz to'lovlari ham jurnalda, chiqimlar kategoriya bo'yicha, yozuvni o'chirish;
 *   · To'lanmagan kirimlar va kirim kartochkasida «To'lash»;
 *   · Schyotni bekor qilish; Kirim QQS reyestri; Boshlang'ich qoldiqlar (ko'rish) va yetkazuvchi boshlang'ich qarzini to'lash;
 *   · Ish haqi: vedomost hisoblash formasi, qayta hisoblash, tanlangan xodimlarga to'lash;
 *   · Moliya dashboardi: debitorka, kreditorka, 7 kunlik kassa prognozi; Realizatsiya jurnali.
 * Qoidalar `lib/*` da (veb bilan bitta funksiya) — bu yerda faqat ilova uchun shakl.
 */

const TAKE = 60;
const n = (v: unknown) => Number(v ?? 0);
const like = (q: string) => ({ contains: q, mode: "insensitive" as const });
const fail = (m: string, status = 400): never => { throw new ListError("ACTION_FAILED", m, status); };
const textOf = (p: Record<string, unknown>, key: string) => String(p[key] ?? "").trim();
/** Ilova raqamni satr qilib yuboradi ("12 500", "12,5") — bo'sh bo'lsa null. */
const numOrNull = (p: Record<string, unknown>, key: string) => {
  const t = textOf(p, key).replace(/\s+/g, "").replace(",", ".");
  return t === "" ? null : Number(t);
};

/** Kassa/bank tanlovi — qoldig'i bilan (chiqim qoldiqdan oshmasin, xodim oldindan ko'rsin). */
async function accountField(label = "Qaysi hisobdan"): Promise<FormField> {
  const acc = await payAccounts();
  return {
    name: "cashAccountId", label, type: "select", required: true, value: acc.find((a) => a.type === "CASH")?.id ?? acc[0]?.id,
    options: acc.map((a) => ({ value: a.id, label: `${a.name} · ${a.type === "CASH" ? "naqd kassa" : "bank"}`, hint: `qoldiq ${money(a.balance)}${a.type === "BANK" && a.allowOverdraft ? " · overdraft ruxsat" : ""}` })),
  };
}

// ───────────────────────── To'lovlar ─────────────────────────

/** Taqsimlanmagan to'lov — schyotga bog'lanmagan va realizatsiya jurnalidan yozilmagan (veb «taqsimlanmagan» / bog'lash formasi bilan bir xil). */
const PAY_UNALLOC: Prisma.PaymentWhereInput = { invoiceId: null, register: { is: null } };

/** «To'lovlar» — chiplar: Taqsimlanmagan / Bugun / Hafta / Hammasi (sukut), yangisi tepada. */
export async function paymentsList(title: string, q?: string, filter?: string): Promise<MobileList> {
  const tabs: { key: string; label: string; where: Prisma.PaymentWhereInput }[] = [
    { key: "unalloc", label: "Taqsimlanmagan", where: PAY_UNALLOC },
    { key: "today", label: "Bugun", where: { date: { gte: skladPeriod("today").from } } },
    { key: "week", label: "Hafta", where: { date: { gte: skladPeriod("week").from } } },
    { key: "all", label: "Hammasi", where: {} },
  ];
  const tab = tabs.find((t) => t.key === filter) ?? tabs[3]!;
  const search: Prisma.PaymentWhereInput = q ? { OR: [{ customer: { name: like(q) } }, { invoice: { invoiceNo: like(q) } }, { order: { orderNo: like(q) } }] } : {};
  const [rows, counts] = await Promise.all([
    db.payment.findMany({
      where: { AND: [tab.where, search] }, orderBy: [{ date: "desc" }, { createdAt: "desc" }], take: TAKE,
      include: { customer: { select: { name: true } }, cashAccount: { select: { name: true } }, invoice: { select: { invoiceNo: true } }, order: { select: { orderNo: true } }, register: { select: { id: true } } },
    }),
    Promise.all(tabs.map((t) => db.payment.count({ where: { AND: [t.where, search] } }))),
  ]);
  return {
    key: "payments", title,
    rows: rows.map((p) => {
      const free = !p.invoiceId && !p.register;
      const link = p.invoice?.invoiceNo ?? (p.register ? "realizatsiya" : p.order ? `avans · ${p.order.orderNo}` : null);
      return {
        id: p.id, title: p.customer.name,
        subtitle: [dateRu(p.date), p.cashAccount.name, link].filter(Boolean).join(" · "),
        right: `+${money(n(p.amount))}`,
        ...(free ? { status: p.order ? "Avans" : "Taqsimlanmagan", tone: (p.order ? "info" : "warning") as Tone } : { tone: "success" as Tone }),
      };
    }),
    filters: tabs.map((t, i) => ({ key: t.key, label: t.label, count: counts[i], active: t.key === tab.key })),
  };
}

/** To'lov kartochkasidagi tugmalar: schyotga bog'lash (taqsimlanmaganda) va storno — realizatsiya importidan yozilgani emas. */
export async function paymentActions(user: MobileUser, id: string): Promise<DetailAction[]> {
  const p = await db.payment.findUnique({ where: { id }, select: { invoiceId: true, customerId: true, amount: true, register: { select: { id: true } } } });
  if (!p || p.register) return [];
  const out: DetailAction[] = [];
  if (!p.invoiceId && can(user, "payment.link")) {
    // Eng eski schyot birinchi — FIFO (veb bog'lash formasi bilan bir xil tartib)
    const inv = await db.invoice.findMany({
      where: { customerId: p.customerId, status: { in: ["OPEN", "PARTIAL"] } }, orderBy: [{ date: "asc" }, { createdAt: "asc" }],
      include: { payments: { select: { amount: true } } },
    });
    const opts: FormOption[] = inv.map((i) => {
      const left = n(i.amount) - i.payments.reduce((s, x) => s + n(x.amount), 0);
      return { value: i.id, label: `${i.invoiceNo} · ${dateRu(i.date)}`, hint: `${i.isOpening ? "boshlang'ich qarz · " : ""}qoldiq ${money(left)}` };
    });
    out.push(opts.length
      ? { id: "payment.link", label: "Schyotga bog'lash", tone: "brand", form: [{ name: "invoiceId", label: "Schyot", type: "select", required: true, value: opts[0]!.value, options: opts, hint: "To'lov schyot qoldig'idan katta bo'lsa — ortgani taqsimlanmagan bo'lib qoladi" }] }
      : { id: "payment.link", label: "Schyotga bog'lash", disabled: true, hint: "Mijozning ochiq schyoti yo'q" });
  }
  if (can(user, "payment.storno")) {
    out.push({
      id: "payment.storno", label: "Bekor qilish", tone: "danger",
      form: [{ name: "reason", label: "Sabab", type: "text", required: true, placeholder: "Nega bekor qilinmoqda", hint: `${money(n(p.amount))} to'lov o'chiriladi, schyot va zayavka holati qayta hisoblanadi; oldingi holati auditda qoladi` }],
    });
  }
  return out;
}

// ───────────────────────── Kirim-chiqim ─────────────────────────

const CF_TYPES = [
  { key: "all", label: "Hammasi" },
  { key: "INCOME", label: "Kirim" },
  { key: "EXPENSE", label: "Chiqim" },
  { key: "TRANSFER", label: "O'tkazma" },
] as const;
type CfType = (typeof CF_TYPES)[number]["key"];
type CfKind = "INCOME" | "EXPENSE" | "TRANSFER";
/** `cancelled` — bekor qilingan yozuv: jurnalda «Bekor qilingan» bo'lib ko'rinadi, jamiga kirmaydi. */
type CfRow = { row: HomeRow; kind: CfKind; date: Date; amount: number; category: string; text: string; cancelled?: boolean };

/** «Kirim-chiqim» ro'yxati jami qatorining id prefiksi — kartochkasi shu faylda (`cashSumDetail`). */
export const CASH_SUM = "sum~";

/** Filtr kaliti `t~<tur>~<davr>` (tur chipi) yoki `p~<tur>~<davr>` (davr chipi) — ikkala tanlov bitta chip qatorida. */
function cfParse(filter?: string): { type: CfType; period: string } {
  const [, t, p] = (filter ?? "").split("~");
  return { type: CF_TYPES.find((x) => x.key === t)?.key ?? "all", period: skladPeriod(p).key };
}

/**
 * Davr jurnali — veb `/cashflow` bilan bir xil: mijoz to'lovlari (kirim) + boshqa kirimlar, chiqimlar va o'tkazmalar
 * (boshlang'ich qoldiqsiz; o'tkazma bitta qator — chiqish tomoni). To'lov qatori — to'lov kartochkasi (`payments:<id>`).
 */
async function cfRows(from: Date, to: Date): Promise<CfRow[]> {
  const [payments, txs] = await Promise.all([
    db.payment.findMany({ where: { date: { gte: from, lt: to } }, include: { customer: { select: { name: true } }, invoice: { select: { invoiceNo: true } }, cashAccount: { select: { name: true } } } }),
    // Boshlang'ich qoldiq jurnalga kirmaydi; o'tkazmaning kirgan tomoni — alohida qator emas (veb umumiy ko'rinishidagidek)
    db.cashTransaction.findMany({ where: { type: { notIn: ["OPENING", "TRANSFER_IN"] }, date: { gte: from, lt: to } }, include: { cashAccount: { select: { name: true } }, supplier: { select: { name: true } } } }),
  ]);
  const out: CfRow[] = payments.map((p) => {
    const category = p.invoice ? `Mijoz to'lovi · ${p.invoice.invoiceNo}` : "Mijoz avansi";
    return {
      kind: "INCOME", date: p.date, amount: n(p.amount), category, text: `${category} ${p.customer.name} ${p.cashAccount.name} ${p.note ?? ""}`,
      row: { id: `payments:${p.id}`, title: `${category} · ${p.customer.name}`, subtitle: `${dateRu(p.date)} · ${p.cashAccount.name}`, right: `+${money(n(p.amount))}`, tone: "success" },
    };
  });
  const cNames = await cancellerNames(txs);
  for (const t of txs) {
    if (t.type === "TRANSFER_OUT") {
      out.push({
        kind: "TRANSFER", date: t.date, amount: n(t.amount), category: "Perekit (hisoblararo)", text: `perekit ${t.category} ${t.cashAccount.name} ${t.counterparty ?? ""} ${t.note ?? ""}`,
        row: { id: t.id, title: `${t.category} · perekit (hisoblararo)`, subtitle: `${dateRu(t.date)} · ${`${t.cashAccount.name} ${t.counterparty ?? ""}`.trim()}`, right: `⇄ ${money(n(t.amount))}`, tone: "info" },
      });
      continue;
    }
    const kind = t.type === "EXPENSE" ? "EXPENSE" : "INCOME";
    // Hujjatdan yozilgan yozuv (kirim hujjati, sklad kirimi, ta'minot) — vebdagidek «Kirim · …» belgisi bilan
    const category = t.refType && t.refType !== TRANSFER_REF ? `Kirim · ${t.category}` : t.category;
    const who = t.supplier?.name ?? t.counterparty;
    const cancel = cancelNote(t, cNames);
    out.push({
      kind, date: t.date, amount: n(t.amount), category, text: `${category} ${who ?? ""} ${t.cashAccount.name} ${t.note ?? ""}`, cancelled: !!cancel,
      row: {
        id: t.id, title: `${category}${who ? ` · ${who}` : ""}`, subtitle: `${dateRu(t.date)} · ${t.cashAccount.name}${cancel ? ` · bekor qilindi: ${cancel}` : ""}`,
        right: `${kind === "EXPENSE" ? "−" : "+"}${money(n(t.amount))}`, tone: cancel || kind === "EXPENSE" ? "danger" : "success", ...(cancel ? { status: CANCELLED_LABEL } : {}),
      },
    });
  }
  return out.sort((a, b) => b.date.getTime() - a.date.getTime());
}

/** Tur chipi bo'yicha — vebdagi tab: «Chiqim» da umumiy ko'rinishdagi o'tkazmalar ham chiqadi (veb `/cashflow` kabi). */
const cfMatch = (r: CfRow, type: CfType) => type === "all" || r.kind === type || (type === "EXPENSE" && r.kind === "TRANSFER");

function cfTotals(rows: CfRow[]) {
  const inc = rows.filter((r) => r.kind === "INCOME" && !r.cancelled).reduce((s, r) => s + r.amount, 0);
  const exp = rows.filter((r) => r.kind === "EXPENSE" && !r.cancelled).reduce((s, r) => s + r.amount, 0);
  const byCat = new Map<string, number>();
  for (const r of rows.filter((x) => x.kind === "EXPENSE" && !x.cancelled)) byCat.set(r.category, (byCat.get(r.category) ?? 0) + r.amount);
  return { inc, exp, byCat: [...byCat.entries()].sort((a, b) => b[1] - a[1]) };
}

/**
 * «Kirim-chiqim» — tur (Hammasi / Kirim / Chiqim / O'tkazma, sonlari bilan) va davr (Bugun / Hafta / Oy / O'tgan oy) chiplari.
 * Birinchi qator — davr jami (bosilsa: kirim, chiqim, sof oqim, chiqimlar kategoriya bo'yicha, hisoblar qoldig'i).
 */
export async function cashflowList(title: string, q?: string, filter?: string): Promise<MobileList> {
  const f = cfParse(filter);
  const p = skladPeriod(f.period);
  const s = q?.toLowerCase();
  const all = (await cfRows(p.from, p.to)).filter((r) => !s || r.text.toLowerCase().includes(s));
  const rows = all.filter((r) => cfMatch(r, f.type));
  const t = cfTotals(rows);
  const top = t.byCat[0];
  const head: HomeRow = {
    id: `${CASH_SUM}${f.type}~${p.key}`,
    title: `Kirim ${short(t.inc)} · Chiqim ${short(t.exp)} · Sof ${shortSigned(t.inc - t.exp)}`,
    subtitle: `${p.label}: ${p.range}${top ? ` · eng katta chiqim: ${top[0]} ${short(top[1])}` : ""}`,
    right: "Batafsil", tone: t.inc - t.exp >= 0 ? "success" : "danger",
  };
  const filters: ListFilter[] = [
    ...CF_TYPES.map((x) => ({ key: `t~${x.key}~${p.key}`, label: x.label, count: all.filter((r) => cfMatch(r, x.key)).length, active: x.key === f.type })),
    ...SKLAD_PERIODS.map((x) => ({ key: `p~${f.type}~${x.key}`, label: x.label, active: x.key === p.key })),
  ];
  return { key: "cashflow", title: `${title} · ${p.label}`, rows: [head, ...rows.slice(0, TAKE - 1).map((r) => r.row)], filters };
}

/** Jami qatori kartochkasi — veb `/cashflow` tepasidagi kartalar va «Chiqimlar kategoriya bo'yicha». */
export async function cashSumDetail(id: string): Promise<MobileDetail> {
  const [type, period] = id.slice(CASH_SUM.length).split("~");
  const f = cfParse(`t~${type ?? ""}~${period ?? ""}`);
  const p = skladPeriod(f.period);
  const [rows, accounts, bal] = await Promise.all([cfRows(p.from, p.to), db.cashAccount.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }), accountBalances()]);
  const t = cfTotals(rows.filter((r) => cfMatch(r, f.type)));
  const total = accounts.reduce((s, a) => s + (bal.get(a.id) ?? 0), 0);
  return {
    key: "cashflow", id, title: `Kirim-chiqim · ${p.label}`, subtitle: p.range,
    fields: [
      { label: "Kirim (davr)", value: money(t.inc), tone: "success" },
      { label: "Chiqim (davr)", value: money(t.exp), tone: t.exp > 0 ? "danger" : undefined },
      { label: "Sof oqim", value: money(t.inc - t.exp), tone: t.inc - t.exp >= 0 ? "success" : "danger" },
      { label: "Hisoblar qoldig'i (hozir)", value: money(total), tone: total < 0 ? "danger" : "info" },
      ...(f.type !== "all" ? [{ label: "Filtr", value: CF_TYPES.find((x) => x.key === f.type)!.label }] : []),
    ],
    sections: [
      { title: "Chiqimlar kategoriya bo'yicha", empty: "Davrda chiqim yo'q", icon: "chart-pie", rows: t.byCat.map(([k, v]) => ({ id: k, title: k, right: money(v), subtitle: t.exp > 0 ? `${Math.round((v / t.exp) * 100)}%` : undefined })) },
      { title: "Hisoblar qoldig'i", empty: "Hisob yo'q", icon: "landmark", rows: accounts.map((a) => { const v = bal.get(a.id) ?? 0; return { id: a.id, title: a.name, subtitle: a.type === "CASH" ? "naqd kassa" : "bank", right: money(v), tone: (v < 0 ? "danger" : "info") as Tone }; }) },
    ],
    actions: [],
  };
}

/**
 * Kirim-chiqim yozuvi kartochkasidagi «Bekor qilish» — veb jadvalidagi kabi: qo'lda yozilgan kirim/chiqim yoki kirim hujjatiga
 * to'lov. Yozuv o'chirilmaydi — «Bekor qilingan» bo'lib qoladi; bekor qilinganida tugma yo'q (`cashEntryLocked`).
 */
export async function cashflowActions(user: MobileUser, t: { id: string; type: string; amount: unknown; refType: string | null; cancelledAt: Date | null }): Promise<DetailAction[]> {
  if (!(t.type === "INCOME" || t.type === "EXPENSE") || !can(user, "cashflow.cancel") || (await cashEntryLocked(t))) return [];
  const what = `${t.type === "INCOME" ? "Kirim" : "Chiqim"} ${money(n(t.amount))}`;
  return [{
    id: "cashflow.cancel", label: "Bekor qilish", tone: "danger",
    form: [{
      name: "reason", label: "Sabab", type: "text", required: true, placeholder: "Nega bekor qilinmoqda",
      hint: t.refType === "GoodsReceipt" ? `${what} bekor qilinadi. Bu kirim hujjatiga to'lov — kirim yana «to'lanmagan» bo'ladi.` : `${what} bekor qilinadi — yozuv «Bekor qilingan» bo'lib qoladi, qoldiq va hisobotlarga kirmaydi; holati auditda.`,
    }],
  }];
}

// ───────────────────────── To'lanmagan kirimlar ─────────────────────────

/** Sklad/snabjeniye yozgan, yetkazuvchiga hali to'liq to'lanmagan kirimlar (veb Kirim-Chiqim → «To'lanmagan kirimlar»). */
export async function unpaidReceiptsList(title: string, q?: string): Promise<MobileList> {
  const s = q?.toLowerCase();
  const all = (await unpaidReceipts()).filter((r) => !s || r.docNo.toLowerCase().includes(s) || r.supplier.toLowerCase().includes(s));
  const left = all.reduce((x, r) => x + r.left, 0);
  return {
    key: "unpaid-receipts", title: all.length ? `${title} · ${all.length} · ${short(left)}` : title,
    rows: all.slice(0, TAKE).map((r) => ({
      id: `receipts:${r.id}`, title: `${r.docNo} · ${r.supplier}`,
      subtitle: `${dateRu(r.date)} · ${r.lines} qator${r.paid > 0.005 ? ` · jami ${money(r.total)}, to'langan ${money(r.paid)}` : ""}`,
      right: money(r.left), tone: "warning" as Tone,
    })),
  };
}

/** Kirim kartochkasidagi «To'lash» — kirim to'lanmaganlar ro'yxatida bo'lsa (ta'minot zanjiridan emas, storno emas, qoldiq bor). */
export async function receiptPayActions(user: MobileUser, receiptId: string): Promise<{ actions: DetailAction[]; fields: DetailField[] }> {
  if (!can(user, "receipt.pay")) return { actions: [], fields: [] };
  const r = (await unpaidReceipts()).find((x) => x.id === receiptId);
  if (!r) return { actions: [], fields: [] };
  return {
    fields: [{ label: "To'lanishi kerak", value: `${money(r.left)}${r.paid > 0.005 ? ` (to'langan ${money(r.paid)})` : ""}`, tone: "warning" }],
    actions: [{
      id: "receipt.pay", label: `To'lash · ${money(r.left)}`, tone: "success",
      form: [
        await accountField(),
        { name: "amount", label: "Summa (so'm)", type: "number", placeholder: String(r.left), hint: `Bo'sh qolsa — qolgani to'liq (${money(r.left)}); qisman to'lash uchun summani yozing` },
      ],
    }],
  };
}

// ───────────────────────── Schyot ─────────────────────────

/** Schyot kartochkasidagi «Bekor qilish» — faqat ochiq, to'lovsiz, boshlang'ich qoldiq bo'lmagan schyot (veb Schyotlar jadvali). */
export function invoiceCancelActions(user: MobileUser, inv: { status: string; isOpening: boolean; invoiceNo: string }, paid: number): DetailAction[] {
  if (inv.status !== "OPEN" || paid > 0 || inv.isOpening || !can(user, "invoice.cancel")) return [];
  return [{ id: "invoice.cancel", label: "Bekor qilish", tone: "danger", form: [{ name: "reason", label: "Sabab (ixtiyoriy)", type: "text", placeholder: "Nega bekor qilinmoqda", hint: `${inv.invoiceNo} bekor qilinadi — mijoz qarzidan chiqadi, holati auditda qoladi` }] }];
}

// ───────────────────────── Kirim QQS reyestri ─────────────────────────

const TZ = 5 * 3_600_000;
const DAY = 86_400_000;
const tashkent = (s: string) => new Date(`${s}T00:00:00+05:00`);
const QQS_PERIODS = [
  { key: "month", label: "Bu oy" },
  { key: "prev", label: "O'tgan oy" },
  { key: "quarter", label: "Chorak" },
  { key: "year", label: "Yil" },
] as const;
/** Davr — Toshkent kuni bo'yicha (veb `/kirim-qqs` kabi), `to` kirmaydi. Sukut — yil boshidan bugungacha (vebdagi standart). */
function qqsPeriod(key?: string) {
  const p = QQS_PERIODS.find((x) => x.key === key) ?? QQS_PERIODS[3];
  const t = new Date(Date.now() + TZ).toISOString().slice(0, 10);
  const y = Number(t.slice(0, 4)), m = Number(t.slice(5, 7));
  const ym = (yy: number, mm: number) => `${yy}-${String(mm).padStart(2, "0")}-01`;
  let from = tashkent(`${y}-01-01`), to = new Date(tashkent(t).getTime() + DAY);
  if (p.key === "month") from = tashkent(ym(y, m));
  else if (p.key === "prev") { from = tashkent(m === 1 ? ym(y - 1, 12) : ym(y, m - 1)); to = tashkent(ym(y, m)); }
  else if (p.key === "quarter") from = tashkent(ym(y, Math.floor((m - 1) / 3) * 3 + 1));
  return { key: p.key, label: p.label, from, to, range: `${dateRu(new Date(from.getTime() + TZ))} — ${dateRu(new Date(to.getTime() - DAY + TZ))}` };
}
const QQS_MONTHS = ["yanvar", "fevral", "mart", "aprel", "may", "iyun", "iyul", "avgust", "sentabr", "oktabr", "noyabr", "dekabr"];
const qqsMonth = (k: string) => `${QQS_MONTHS[Number(k.slice(5, 7)) - 1] ?? k.slice(5, 7)} ${k.slice(0, 4)}`;

/** «Kirim QQS» — davrdagi kirim hujjatlari (storno qilinganlar kirmaydi), birinchi qator — jami (oy va yetkazuvchi kesimi). */
export async function kirimQqsList(title: string, q?: string, filter?: string): Promise<MobileList> {
  const p = qqsPeriod(filter);
  const d = await inputVatReport(p.from, p.to);
  const s = q?.toLowerCase();
  const docs = d.docs.filter((x) => !s || x.docNo.toLowerCase().includes(s) || x.supplier.toLowerCase().includes(s) || (x.inn ?? "").includes(s));
  const t = d.totals;
  const head: HomeRow = {
    id: `${CASH_SUM}${p.key}`, title: `QQS ${money(t.vat)} · ${t.docs} hujjat`,
    subtitle: `QQS'siz ${short(t.base)} · Jami ${short(t.total)} · ${p.range}`, right: "Batafsil", tone: "brand",
  };
  return {
    key: "kirim-qqs", title: `${title} · ${p.label}`,
    rows: [head, ...docs.slice(0, TAKE - 1).map((r) => ({
      id: `receipts:${r.id}`, title: `${r.docNo} · ${r.supplier}`,
      subtitle: [dateRu(r.date), r.inn ? `INN ${r.inn}` : null, `QQS'siz ${money(r.base)}`].filter(Boolean).join(" · "),
      right: `QQS ${money(r.vat)}`, tone: (r.vat > 0 ? "brand" : "info") as Tone,
    }))],
    filters: QQS_PERIODS.map((x) => ({ key: x.key, label: x.label, active: x.key === p.key })),
  };
}

/** Jami kartochkasi — oylar va yetkazuvchilar bo'yicha (veb `/kirim-qqs` jadvallari). */
export async function kirimQqsDetail(user: MobileUser, id: string): Promise<MobileDetail> {
  if (!id.startsWith(CASH_SUM)) throw new ListError("NOT_FOUND", "Kartochka topilmadi", 404);
  const p = qqsPeriod(id.slice(CASH_SUM.length));
  const [d, vatPayer] = await Promise.all([inputVatReport(p.from, p.to), companyVatPayer()]);
  const t = d.totals;
  // Yetkazuvchi kartochkasi kimga ochiq bo'lsa — o'shanga havola (`detail.ts` DETAIL_ROLES.suppliers)
  const supTarget = user.role === "DIRECTOR" || ["WAREHOUSE", "PROCUREMENT", "ACCOUNTING"].includes(user.role) ? "suppliers" : undefined;
  return {
    key: "kirim-qqs", id, title: `Kirim QQS · ${p.label}`, subtitle: p.range,
    fields: [
      { label: "QQS'siz summa", value: money(t.base) },
      { label: "Kirim QQS", value: money(t.vat), tone: "brand" },
      { label: "Jami (QQS bilan)", value: money(t.total) },
      { label: "Hujjatlar", value: `${t.docs} ta kirim` },
      { label: "Korxona", value: vatPayer ? "QQS to'lovchi — kirim QQS hisobga olinadi" : "QQS to'lovchisi emas — QQS tannarxda", tone: vatPayer ? "success" : "info" },
    ],
    sections: [
      { title: "Oylar bo'yicha", empty: "Davrda kirim yo'q", icon: "calendar-days", rows: d.months.map((m) => ({ id: m.key, title: qqsMonth(m.key), subtitle: `${m.docs} hujjat · QQS'siz ${money(m.base)} · jami ${money(m.total)}`, right: money(m.vat) })) },
      { title: "Yetkazuvchilar bo'yicha", empty: "Davrda kirim yo'q", icon: "store", target: supTarget, rows: d.suppliers.map((x) => ({ id: x.key, title: `${x.label}${x.vatPayer ? "" : " · QQS'siz"}`, subtitle: `${x.inn ? `INN ${x.inn} · ` : ""}${x.docs} hujjat · QQS'siz ${money(x.base)}`, right: money(x.vat) })) },
    ],
    actions: [],
  };
}

// ───────────────────────── Boshlang'ich qoldiqlar ─────────────────────────

const OPENING_KINDS: OpeningKind[] = ["CUSTOMER", "SUPPLIER", "CASH", "STOCK"];
const openingInclude = {
  customer: { select: { id: true, name: true, inn: true } }, supplier: { select: { id: true, name: true, inn: true } },
  cashAccount: { select: { name: true, type: true } }, product: { select: { code: true, name: true, unit: true } }, warehouse: { select: { name: true } },
  invoice: { select: { id: true, invoiceNo: true, status: true, payments: { select: { amount: true } } } },
} as const;
type OpeningRowT = Prisma.OpeningBalanceGetPayload<{ include: typeof openingInclude }>;
const openingWho = (r: OpeningRowT) =>
  r.customer ? r.customer.name : r.supplier ? r.supplier.name : r.cashAccount ? `${r.cashAccount.name} (${r.cashAccount.type === "CASH" ? "naqd" : "bank"})` : r.product ? `${r.product.code} · ${r.product.name} · ${r.warehouse?.name ?? ""}` : "—";
const signedMoney = (v: number) => (v < 0 ? `−${money(-v)}` : money(v));

/** «Boshlang'ich qoldiqlar» — faqat ko'rish (kiritish/tahrir vebda): tur chiplari, faol yozuvlar; yetkazuvchida — qolgan qarz. */
export async function openingsList(title: string, q?: string, filter?: string): Promise<MobileList> {
  const kind: OpeningKind = OPENING_KINDS.find((k) => k === filter) ?? "CUSTOMER";
  const search: Prisma.OpeningBalanceWhereInput = q ? { OR: [{ customer: { name: like(q) } }, { supplier: { name: like(q) } }, { cashAccount: { name: like(q) } }, { product: { name: like(q) } }, { note: like(q) }] } : {};
  const [rows, counts] = await Promise.all([
    db.openingBalance.findMany({ where: { kind, cancelledAt: null, ...search }, orderBy: { createdAt: "desc" }, take: 200, include: openingInclude }),
    db.openingBalance.groupBy({ by: ["kind"], where: { cancelledAt: null }, _count: true }),
  ]);
  const dues = kind === "SUPPLIER" ? new Map((await supplierOpeningDues()).map((d) => [d.id, d])) : new Map<string, { left: number }>();
  return {
    key: "openings", title,
    rows: rows.map((r) => {
      const amount = n(r.amount);
      const due = dues.get(r.id);
      const paidCust = r.invoice ? r.invoice.payments.reduce((s, p) => s + n(p.amount), 0) : 0;
      return {
        id: r.id, title: openingWho(r),
        subtitle: [dateRu(r.date), r.invoice?.invoiceNo, kind === "STOCK" && r.qty != null && r.product ? `${fmtNum(n(r.qty), 3)} ${unitShort(r.product.unit)}` : null, kind === "CUSTOMER" && paidCust ? `to'langan ${money(paidCust)}` : null, r.note].filter(Boolean).join(" · "),
        right: due ? `qoldi ${money(due.left)}` : signedMoney(amount),
        tone: (due ? (due.left > 0.005 ? "danger" : "success") : amount < 0 ? "warning" : "info") as Tone,
      };
    }),
    filters: OPENING_KINDS.map((k) => ({ key: k, label: KIND_LABEL[k], count: counts.find((c) => c.kind === k)?._count ?? 0, active: k === kind })),
  };
}

/** Yetkazuvchi boshlang'ich qarzini to'lash formasi — qolgan qarz bo'yicha (qisman ham). */
async function openingPayAction(left: number): Promise<DetailAction> {
  return {
    id: "supplier.opening.pay", label: `Boshlang'ich qarzni to'lash · ${money(left)}`, tone: "success",
    form: [await accountField(), { name: "amount", label: "Summa (so'm)", type: "number", required: true, value: String(left), hint: "Kirim-Chiqimga «Xomashyo» chiqimi bo'lib yoziladi; qolgan qarzdan oshmaydi" }],
  };
}

/** Boshlang'ich qoldiq kartochkasi — ko'rish; yetkazuvchi qarzida to'lovlar va «To'lash». */
export async function openingDetail(user: MobileUser, id: string): Promise<MobileDetail> {
  const r = await db.openingBalance.findUnique({ where: { id }, include: openingInclude });
  if (!r) throw new ListError("NOT_FOUND", "Qoldiq topilmadi", 404);
  const amount = n(r.amount);
  const due = r.kind === "SUPPLIER" && !r.cancelledAt ? (await supplierOpeningDues(r.supplierId ?? undefined)).find((d) => d.id === r.id) : undefined;
  const pays = r.kind === "SUPPLIER" ? (await supplierOpeningPayments([r.id])).get(r.id) ?? [] : [];
  const paidCust = r.invoice ? r.invoice.payments.reduce((s, p) => s + n(p.amount), 0) : 0;
  const actions: DetailAction[] = [];
  if (due && due.left > 0.005 && can(user, "supplier.opening.pay")) actions.push(await openingPayAction(due.left));
  const sections: HomeSection[] = [];
  if (r.kind === "SUPPLIER") sections.push({ title: "To'lovlar", empty: "Hali to'lanmagan", target: "cashflow", rows: pays.map((p) => ({ id: p.id, title: `−${money(p.amount)}`, subtitle: `${dateRu(p.date)} · ${p.account}`, right: money(p.amount), tone: "danger" as Tone })) });
  if (r.invoice) sections.push({ title: "Boshlang'ich schyot", empty: "", target: "invoices", rows: [{ id: r.invoice.id, title: r.invoice.invoiceNo, subtitle: `to'langan ${money(paidCust)}`, right: money(amount), status: r.invoice.status }] });
  return {
    key: "openings", id: r.id, title: openingWho(r), subtitle: `${KIND_LABEL[r.kind]} · ${dateRu(r.date)} holatiga`,
    status: r.cancelledAt ? "Bekor" : "Faol",
    fields: [
      { label: r.kind === "STOCK" ? "Qiymat (tannarx)" : "Summa", value: signedMoney(amount), tone: amount < 0 ? "warning" : "brand" },
      ...(r.kind === "STOCK" && r.qty != null ? [{ label: "Miqdor", value: `${fmtNum(n(r.qty), 3)} ${r.product ? unitShort(r.product.unit) : ""}`.trim() }, { label: "Tannarx", value: r.unitCost == null ? "—" : money(n(r.unitCost)) }] : []),
      ...(r.kind === "CUSTOMER" ? [{ label: "To'langan", value: money(paidCust) }] : []),
      ...(due ? [{ label: "Qolgan qarz", value: money(due.left), tone: (due.left > 0.005 ? "danger" : "success") as Tone }] : []),
      ...(r.customer?.inn || r.supplier?.inn ? [{ label: "INN", value: (r.customer?.inn ?? r.supplier?.inn)! }] : []),
      ...(r.note ? [{ label: "Izoh", value: r.note }] : []),
      ...(r.cancelledAt ? [{ label: "Bekor qilingan", value: `${dateRu(r.cancelledAt)}${r.cancelReason ? ` · ${r.cancelReason}` : ""}`, tone: "danger" as Tone }] : []),
    ],
    sections, actions,
  };
}

/** Yetkazuvchi kartochkasiga: boshlang'ich qarz bo'limi va «To'lash» (yetkazuvchining bitta faol qoldig'i). */
export async function supplierOpeningExtra(user: MobileUser, supplierId: string): Promise<{ sections: HomeSection[]; actions: DetailAction[] }> {
  const due = (await supplierOpeningDues(supplierId))[0];
  if (!due) return { sections: [], actions: [] };
  const target = user.role === "DIRECTOR" || ["ACCOUNTING", "FINANCE"].includes(user.role) ? "openings" : undefined;
  return {
    sections: [{ title: "Boshlang'ich qoldiq", empty: "", target, rows: [{ id: due.id, title: `${dateRu(due.date)} holatiga · ${signedMoney(due.amount)}`, subtitle: due.paid ? `to'langan ${money(due.paid)}` : "hali to'lanmagan", right: due.left > 0.005 ? `qoldi ${money(due.left)}` : due.left < -0.005 ? `avans ${money(-due.left)}` : "yopilgan", tone: due.left > 0.005 ? "danger" : "success" }] }],
    actions: due.left > 0.005 && can(user, "supplier.opening.pay") ? [await openingPayAction(due.left)] : [],
  };
}

// ───────────────────────── Realizatsiya jurnali ─────────────────────────

/** Davr chiplari + «Hammasi». Funksiya: `list.ts` bilan aylanma import — modul yuklanishida uning qiymatlari hali tayyor emas. */
const regPeriods = () => [...SKLAD_PERIODS, { key: "all", label: "Hammasi" }] as const;

/** «Realizatsiya jurnali» — Excel'dan yuklangan kunlik jo'natma jadvali (faqat ko'rish), davr chiplari; sukut — hammasi (veb kabi). */
export async function realizatsiyaList(title: string, q?: string, filter?: string): Promise<MobileList> {
  const periods = regPeriods();
  const pk = periods.find((x) => x.key === filter)?.key ?? "all";
  const p = pk === "all" ? null : skladPeriod(pk);
  const where: Prisma.SalesRegisterWhereInput = {
    ...(p ? { date: { gte: p.from, lt: p.to } } : {}),
    ...(q ? { OR: [{ customer: { name: like(q) } }, { productName: like(q) }, { ttn: like(q) }, { vehicleNo: like(q) }] } : {}),
  };
  const [rows, t] = await Promise.all([
    db.salesRegister.findMany({ where, orderBy: [{ date: "desc" }, { createdAt: "desc" }], take: TAKE, include: { customer: { select: { name: true } } } }),
    db.salesRegister.aggregate({ where, _sum: { total: true }, _count: { _all: true } }),
  ]);
  const cnt = t._count._all;
  return {
    key: "realizatsiya", title: cnt ? `${title} · ${cnt} qator · ${short(n(t._sum.total))}` : title,
    rows: rows.map((r) => ({
      id: r.id, title: `${r.customer.name} · ${r.productName}`,
      subtitle: [dateRu(r.date), `${fmtNum(n(r.qty), 3)} ${r.unit}`, payKindLabel(r.payType), r.ttn ? `TTN ${r.ttn}` : null].filter(Boolean).join(" · "),
      right: money(n(r.total)), tone: "success" as Tone,
    })),
    filters: periods.map((x) => ({ key: x.key, label: x.label, active: x.key === pk })),
  };
}

export async function realizatsiyaDetail(id: string): Promise<MobileDetail> {
  const r = await db.salesRegister.findUnique({ where: { id }, include: { customer: { select: { name: true } }, cashAccount: { select: { name: true } }, createdBy: { select: { fullName: true } } } });
  if (!r) throw new ListError("NOT_FOUND", "Qator topilmadi", 404);
  const opt = (label: string, v: string | null | undefined): DetailField[] => (v ? [{ label, value: v }] : []);
  return {
    key: "realizatsiya", id: r.id, title: r.productName, subtitle: `${r.customer.name} · ${dateRu(r.date)}`,
    fields: [
      { label: "Miqdor", value: `${fmtNum(n(r.qty), 3)} ${r.unit}` },
      { label: "Narx", value: money(n(r.price)) },
      { label: "Summa (NDS'siz)", value: money(n(r.sum)) },
      { label: "NDS", value: money(n(r.nds)) },
      ...(n(r.deliveryFee) ? [{ label: "Dostavka", value: money(n(r.deliveryFee)) }] : []),
      { label: "Itogo (NDS bilan)", value: money(n(r.total)), tone: "brand" },
      { label: "Pul", value: payKindLabel(r.payType) },
      ...opt("Kassa / hisob", r.cashAccount?.name),
      ...opt("Mashina №", r.vehicleNo), ...opt("TTN", r.ttn), ...opt("Kimdan", r.fromWho), ...opt("Manzil", r.address),
      ...opt("Shartnoma", r.contractNo), ...opt("Schyot-faktura", r.invoiceNo), ...opt("Oy", r.monthNo), ...opt("Izoh", r.note),
      { label: "Yukladi", value: `${r.createdBy.fullName} · ${dateRu(r.createdAt)}` },
    ],
    sections: [], actions: [],
  };
}

// ───────────────────────── Ish haqi ─────────────────────────

const who = (user: MobileUser): PayrollWho => ({ userId: user.id, role: user.role, perms: user.perms });

/** Vedomost hisoblash formasi — veb «Ish haqi» → «Hisoblash» bilan bir xil (oy + tur; bor qoralama qayta hisoblanadi). */
export function payrollForm(): CreateForm {
  const cur = todayIso().slice(0, 7);
  const y = Number(cur.slice(0, 4)), m = Number(cur.slice(5, 7));
  const months = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    const k = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    return { value: k, label: monthTitle(k) };
  });
  return {
    key: "ish-haqi", title: "Ish haqini hisoblash", submitLabel: "Hisoblash",
    fields: [
      { name: "month", label: "Oy", type: "select", required: true, value: cur, options: months },
      { name: "kind", label: "Vedomost turi", type: "select", required: true, value: "FINAL", options: (["ADVANCE", "FINAL"] as const).map((k) => ({ value: k, label: PAYROLL_KIND_LABEL[k] })), hint: "Shu oy uchun qoralama bo'lsa — qayta hisoblanadi" },
    ],
  };
}

export async function payrollCreate(user: MobileUser, payload: unknown): Promise<CreateResult> {
  const p = (payload ?? {}) as Record<string, unknown>;
  const kind = textOf(p, "kind") as PayrollKind;
  if (kind !== "ADVANCE" && kind !== "FINAL") throw new Error("Vedomost turini tanlang");
  const r = await calculateRun(textOf(p, "month"), kind, who(user));
  if (r.error || !r.id) throw new Error(r.error ?? "Hisoblanmadi");
  return { key: "ish-haqi", id: r.id, message: r.note ?? "Hisoblandi" };
}

/** Qoralama vedomostda «Qayta hisoblash» (alohida to'lovdan tashqari). */
export function payrollRecalcActions(user: MobileUser, r: { status: string; kind: string }): DetailAction[] {
  if (r.status !== "DRAFT" || r.kind === "EXTRA" || !canDo(user, "payroll", "calc")) return [];
  return [{ id: "payroll.recalc", label: "Qayta hisoblash", tone: "brand", confirm: "Davomat, jarima va bonuslar bo'yicha vedomost qayta hisoblansinmi?" }];
}

export async function payrollRecalc(user: MobileUser, id: string): Promise<{ error?: string; note?: string }> {
  return recalculateRun(id, who(user));
}

/** To'lov formasiga — har to'lanmagan xodim uchun belgi (`line_<id>`): vebdagi kabi tanlanganlargagina to'lash mumkin. */
export function payLineFields(lines: { id: string; net: unknown; employee: { fullName: string } }[]): FormField[] {
  return lines.map((l) => ({ name: `line_${l.id}`, label: `${l.employee.fullName} · ${money(n(l.net))}`, type: "switch" as const, value: "true" }));
}

/** Formadan tanlangan qatorlar: belgilar bo'lmasa (eski ilova) — null, ya'ni hammasi; hech biri tanlanmasa — xato. */
export function payLineIds(payload: Record<string, unknown>): string[] | null {
  const keys = Object.keys(payload).filter((k) => k.startsWith("line_"));
  if (!keys.length) return null;
  const ids = keys.filter((k) => payload[k] === true || payload[k] === "true").map((k) => k.slice(5));
  if (!ids.length) fail("Kamida bitta xodimni tanlang");
  return ids;
}

// ───────────────────────── Moliya dashboardi ─────────────────────────

/** Kassa prognozi (7 kun) — BI «Moliya» tabi bilan bitta hisob (`lib/bi/finance.ts` → `cashForecast7`). */
async function forecast(receivable?: number) {
  const [rep, accounts, since] = await Promise.all([
    receivable == null ? receivablesReport() : Promise.resolve(null),
    db.cashAccount.findMany({ where: { isActive: true }, select: { id: true } }),
    goLiveDate(),
  ]);
  const bal = await accountBalances(db, accounts.map((a) => a.id));
  const cashTotal = accounts.reduce((s, a) => s + (bal.get(a.id) ?? 0), 0);
  return cashForecast7({ today: startOfDay(new Date()), since, receivable: receivable ?? rep!.total, cashTotal });
}

/**
 * Moliya bosh sahifasiga: debitorka, kreditorka va 7 kunlik kassa prognozi kartalari — hozirgi holat (davrga bog'lanmaydi),
 * bosilsa batafsil `dash-detail.ts` (FINANCE → receivable / payable / forecast; «month» — joriy davr, ya'ni hozirgi qarz).
 */
export async function financeExtraCards(): Promise<HomeCard[]> {
  const [rep, pay] = await Promise.all([receivablesReport(), payables()]);
  const fc = await forecast(rep.total);
  return [
    { key: "receivable", label: "Debitorka", value: short(rep.total), hint: `${rep.debtors} ta qarzdor${rep.overdue > 0 ? ` · muddati o'tgan ${short(rep.overdue)}` : ""}`, tone: rep.total > 0 ? "danger" : "success", icon: "receipt", open: { key: "dash", id: "receivable.month" } },
    { key: "payable", label: "Kreditorka", value: short(pay.total), hint: `${pay.receipts.count} ta to'lanmagan kirim`, tone: pay.total > 0 ? "warning" : "success", icon: "store", open: { key: "dash", id: "payable.month" } },
    { key: "forecast", label: "Kassa prognozi (7 kun)", value: shortSigned(fc.after7), hint: `tushum ${short(fc.expectedIn)} · chiqim ${short(fc.expectedOut)}`, tone: fc.after7 < 0 ? "danger" : "info", icon: "trending-up", open: { key: "dash", id: "forecast.month" } },
  ];
}

/** 7 kunlik kassa prognozi batafsili — `dash/forecast.<davr>` (davr ta'sir qilmaydi: prognoz bugundan oldinga). */
export async function forecastDetail(): Promise<Pick<MobileDetail, "title" | "subtitle" | "fields" | "sections">> {
  const fc = await forecast();
  return {
    title: "Kassa prognozi — 7 kun",
    subtitle: `So'nggi ${fc.histDays} kun o'rtachasi bo'yicha; tushum ochiq debitorkadan oshmaydi`,
    fields: [
      { label: "Hozirgi qoldiq", value: money(fc.start), tone: fc.start < 0 ? "danger" : "info" },
      { label: "7 kundan keyin", value: money(fc.after7), tone: fc.after7 < 0 ? "danger" : "success" },
      { label: "Yomon stsenariy", value: money(fc.low7), tone: fc.low7 < 0 ? "danger" : "warning" },
      { label: "Kutilayotgan tushum", value: money(fc.expectedIn), tone: "success" },
      { label: "Kutilayotgan chiqim", value: money(fc.expectedOut), tone: "warning" },
      { label: "Kunlik o'rtacha tushum", value: `${money(fc.perDay)} ± ${money(fc.sigma)}` },
      { label: "Debitorka", value: `${money(fc.receivable)}${fc.coverDays != null ? ` · ~${Math.round(fc.coverDays)} kunlik tushum` : ""}` },
      { label: "Xavf", value: fc.risk, tone: fc.risk === "Yuqori" ? "danger" : fc.risk === "O'rta" ? "warning" : "success" },
      ...(fc.histDays < 14 ? [{ label: "Eslatma", value: `Tarix ${fc.histDays} kun — prognoz hali ishonchli emas`, tone: "warning" as Tone }] : []),
    ],
    sections: [{
      title: "Kunlar bo'yicha (qoldiq)", empty: "Ma'lumot yo'q", icon: "chart-column",
      rows: fc.rows.map((r) => ({ id: r.label, title: r.label, subtitle: `yomon ${shortSigned(fc.start + r.low)} · yaxshi ${shortSigned(fc.start + r.high)}`, right: money(fc.start + r.base), tone: (fc.start + r.base < 0 ? "danger" : "info") as Tone })),
    }],
  };
}

// ───────────────────────── Amallar ─────────────────────────

/** `runMobileAction` → moliya amallari. Rol va veb ruxsati (`can`) chaqiruvchida tekshirilgan; qoida `lib/*` ichida yana tekshiriladi. */
export async function moliyaAction(user: MobileUser, action: string, id: string, payload: Record<string, unknown>): Promise<{ ok: true; message: string }> {
  switch (action) {
    case "payment.storno": {
      const r = await reversePayment(id, textOf(payload, "reason").slice(0, 300), user.id);
      if (r.error) fail(r.error);
      return { ok: true, message: "Bekor qilindi" };
    }
    case "payment.link": {
      const invoiceId = textOf(payload, "invoiceId");
      if (!invoiceId) fail("Schyot tanlanmagan");
      const r = await linkPaymentToInvoice(id, invoiceId, user.id);
      if (r.error) fail(r.error);
      return { ok: true, message: r.rest && r.rest > 0 ? `Bog'landi; ortgan ${money(r.rest)} taqsimlanmagan qoldi` : "Schyotga bog'landi" };
    }
    case "cashflow.cancel": {
      const t = await db.cashTransaction.findUnique({ where: { id }, select: { type: true } });
      if (t && t.type !== "INCOME" && t.type !== "EXPENSE") fail(`${TX_TYPE_LABEL[t.type]} yozuvi bu yerdan bekor qilinmaydi`);
      const r = await cancelCashEntry(id, textOf(payload, "reason"), user.id);
      if (r.error) fail(r.error);
      return { ok: true, message: "Bekor qilindi" };
    }
    case "receipt.pay": {
      const amount = numOrNull(payload, "amount");
      const r = await payReceiptEntry(id.split("~")[0]!, { cashAccountId: textOf(payload, "cashAccountId"), amount }, user.id);
      if (r.error) fail(r.error);
      return { ok: true, message: r.paid ? `To'landi: ${money(r.paid)}${r.left && r.left > 0.005 ? ` · qoldi ${money(r.left)}` : ""}` : "Kirim allaqachon to'liq to'langan" };
    }
    case "invoice.cancel": {
      const r = await cancelInvoice(id, textOf(payload, "reason"), user.id);
      if (r.error) fail(r.error);
      return { ok: true, message: "Schyot bekor qilindi" };
    }
    case "supplier.opening.pay": {
      // Kartochka id'si — qoldiq (Boshlang'ich qoldiqlar) yoki yetkazuvchi (yetkazuvchi kartasi: uning faol qoldig'i)
      const o = await db.openingBalance.findFirst({ where: { kind: "SUPPLIER", cancelledAt: null, OR: [{ id }, { supplierId: id }] }, select: { id: true } });
      if (!o) fail("Boshlang'ich qoldiq topilmadi", 404);
      const amount = numOrNull(payload, "amount");
      if (amount == null || !Number.isFinite(amount)) fail("Summani kiriting");
      const r = await paySupplierOpening(o!.id, textOf(payload, "cashAccountId"), amount!, user.id);
      if (r.error) fail(r.error);
      return { ok: true, message: `To'lov yozildi: ${money(amount!)}` };
    }
  }
  return fail("Bunday amal yo'q", 404);
}
