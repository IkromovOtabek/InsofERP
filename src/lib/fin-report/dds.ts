import { db } from "@/lib/db";
import { txSign } from "@/lib/cash-tx";
import type { LoanKind } from "@/generated/prisma";
import { loadCategories, makeResolver } from "./categories";
import { DDS_FIXED, sheetLine } from "./sheet-lines";
import { type MonthKey, monthStart, monthEnd, monthKeyOf } from "./period";
import { type FinRow, row, head, zeros, addInto, neg, plus, r2 } from "./rows";

/**
 * Pul mablag'lari harakati (DDS) — «Insof 2026» jadvalidagi «Cash Flow» varag'idek:
 *   joriy / moliyaviy / investitsion oqim kassa kategoriyasining `flow` turi bo'yicha, ichida manbalar;
 *   mijozlar to'lovi (`Payment`) — joriy oqimdagi «Savdo tushumi»;
 *   hisoblararo o'tkazmalar oqim emas — faqat hisoblar blokida ko'rinadi.
 * Pastda har hisob: boshlang'ich qoldiq, kirim, chiqim, ichki o'tkazma, yakuniy qoldiq.
 * Tekshiruv: hisoblar qoldig'i o'zgarishi − sof pul oqimi = 0 (o'tkazmalar ikki tomoni teng bo'lsa).
 */
export type DdsReport = { months: MonthKey[]; rows: FinRow[]; accountRows: FinRow[]; netFlow: number[]; check: number[] };

const SALES = "Savdo tushumi";
const PROJECTS_LINE = "Loyihalarga sarflangan pul";
const [TRANSFER_LINE, , , UNKNOWN_LINE] = DDS_FIXED.transfers;

/** Moliyaviy oqim qatori (jadval atamalari): bank krediti (tanasi va foizi birga), olingan / berilgan qarz, divident. */
function financingLine(category: string, type: string, loanKind: LoanKind | null): string {
  if (loanKind === "BANK") return "Kridit va kridit foizi";
  if (loanKind === "BORROWED") return type === "INCOME" ? "Qarz olindi" : "Qarz qaytarildi";
  if (loanKind === "LENT") return type === "EXPENSE" ? "Qarz berildi" : "Qarz qaytdi";
  if (category === "Kredit — asosiy qarz" || category === "Kredit foizi") return "Kridit va kridit foizi";
  if (category === "Kredit / qarz olindi") return "Qarz olindi";
  if (category === "Berilgan qarz qaytdi") return "Qarz qaytdi";
  return sheetLine(category);
}

export async function ddsReport(months: MonthKey[]): Promise<DdsReport> {
  const n = months.length;
  const from = monthStart(months[0]!), to = monthEnd(months[n - 1]!);
  const idx = new Map(months.map((m, i) => [m, i]));
  const at = (d: Date) => idx.get(monthKeyOf(d));

  const [nodes, txs, pays, accounts, txBefore, payBefore] = await Promise.all([
    loadCategories(),
    db.cashTransaction.findMany({
      where: { cancelledAt: null, date: { gte: from, lt: to } },
      select: { date: true, type: true, amount: true, category: true, subCategory: true, cashAccountId: true, project: { select: { name: true } }, loan: { select: { kind: true } } },
    }),
    db.payment.findMany({ where: { date: { gte: from, lt: to } }, select: { date: true, amount: true, cashAccountId: true } }),
    db.cashAccount.findMany({ orderBy: [{ type: "asc" }, { name: "asc" }], select: { id: true, name: true, isActive: true } }),
    db.cashTransaction.groupBy({ by: ["cashAccountId", "type"], where: { cancelledAt: null, date: { lt: from } }, _sum: { amount: true } }),
    db.payment.groupBy({ by: ["cashAccountId"], where: { date: { lt: from } }, _sum: { amount: true } }),
  ]);
  const resolve = makeResolver(nodes);

  // ── Oqimlar: jadval («Cash Flow») qatorlari bo'yicha — qator nomi → oylar (ishora bilan: kirim +, chiqim −) ──
  type Bucket = Map<string, number[]>;
  const opIn: Bucket = new Map(), opOut: Bucket = new Map(), fin: Bucket = new Map(), inv: Bucket = new Map(), trf: Bucket = new Map();
  const put = (b: Bucket, name: string, i: number, v: number) => { if (!b.has(name)) b.set(name, zeros(n)); addInto(b.get(name)!, i, v); };
  const sales = zeros(n);
  for (const p of pays) { const i = at(p.date); if (i !== undefined) addInto(sales, i, Number(p.amount)); }
  opIn.set(SALES, sales);
  const projectNames = new Set<string>();

  // Hisoblar bloki uchun: hisob → [kirim, chiqim, o'tkazma, boshlang'ich kiritildi] oylar bo'yicha
  const acc = new Map(accounts.map((a) => [a.id, { inn: zeros(n), out: zeros(n), tr: zeros(n), opening: zeros(n) }]));
  for (const p of pays) { const i = at(p.date); const a = acc.get(p.cashAccountId); if (i !== undefined && a) addInto(a.inn, i, Number(p.amount)); }

  for (const t of txs) {
    const i = at(t.date);
    if (i === undefined) continue;
    const v = Number(t.amount), a = acc.get(t.cashAccountId);
    if (t.type === "OPENING") { if (a) addInto(a.opening, i, v); continue; }
    if (t.type === "TRANSFER_IN" || t.type === "TRANSFER_OUT") { if (a) addInto(a.tr, i, txSign(t.type) * v); put(trf, TRANSFER_LINE, i, txSign(t.type) * v); continue; }
    if (a) addInto(t.type === "INCOME" ? a.inn : a.out, i, v);
    const sv = t.type === "INCOME" ? v : -v;
    const r = resolve(t.category, t.subCategory);
    if (!r) { put(trf, UNKNOWN_LINE, i, sv); continue; }
    if (r.top.flow === "OPERATING") {
      if (t.type === "INCOME") put(opIn, sheetLine(r.top.name, r.sub?.name), i, v);
      else put(opOut, sheetLine(r.top.name, r.sub?.name), i, v);
    } else if (r.top.flow === "FINANCING") {
      put(fin, financingLine(r.top.name, t.type, t.loan?.kind ?? null), i, sv);
    } else if (r.top.needs === "PROJECT") {
      if (t.project?.name) projectNames.add(t.project.name);
      put(inv, PROJECTS_LINE, i, sv);
    } else put(inv, sheetLine(r.top.name, r.sub?.name), i, sv);
  }

  const total = (b: Bucket) => plus(zeros(n), ...b.values());
  const sorted = (b: Bucket) => [...b.entries()].sort((x, y) => Math.abs(y[1].reduce((s, v) => s + v, 0)) - Math.abs(x[1].reduce((s, v) => s + v, 0)));
  /** Jadvaldagi qat'iy qatorlar (nol bo'lsa ham) + qo'shimchalar (nol bo'lmasa). */
  const lines = (b: Bucket, order: readonly string[], key: string, sign: FinRow["sign"], flip = false) => [
    ...order.map((name) => row(`${key}:${name}`, name, "sub", flip ? neg(b.get(name) ?? zeros(n)) : b.get(name) ?? zeros(n), { sign })),
    ...sorted(b).filter(([name, v]) => !order.includes(name) && v.some((x) => x !== 0)).map(([name, v]) => row(`${key}:${name}`, name, "sub", flip ? neg(v) : v, { sign })),
  ];
  const opNet = plus(total(opIn), neg(total(opOut))), finNet = total(fin), invNet = total(inv), trfNet = total(trf);
  const projLabel = `Loyihalarga sarflangan pul${projectNames.size ? ` (${[...projectNames].join(", ")})` : ""}`;
  const invRows = lines(inv, [...DDS_FIXED.investing, PROJECTS_LINE], "INVESTING", "±").map((r) => (r.label === PROJECTS_LINE ? { ...r, label: projLabel } : r));
  const rows: FinRow[] = [
    head("h:OPERATING", "Joriy pul oqimlari", n),
    row("OPERATING:in", "Jami tushum", "line", total(opIn), { sign: "+" }),
    ...lines(opIn, DDS_FIXED.operatingIn, "OPERATING:in", "+"),
    row("OPERATING:out", "Jami chiqim", "line", neg(total(opOut)), { sign: "−" }),
    ...lines(opOut, DDS_FIXED.operatingOut, "OPERATING:out", "−", true),
    row("OPERATING:net", "Joriy pul oqimi", "total", opNet, { sign: "=" }),
    head("h:FINANCING", "Moliyaviy pul oqimlari", n),
    ...lines(fin, DDS_FIXED.financing, "FINANCING", "±"),
    row("FINANCING:net", "Moliyaviy pul oqimi", "total", finNet, { sign: "=" }),
    head("h:INVESTING", "Investitsion pul oqimlari", n),
    ...invRows,
    row("INVESTING:net", "Investitsion pul oqimi", "total", invNet, { sign: "=" }),
    head("h:TRANSFERS", "Hisoblar orasidagi", n),
    ...lines(trf, DDS_FIXED.transfers, "TRANSFERS", "±"),
  ];
  const netFlow = plus(opNet, finNet, invNet, trfNet);
  rows.push(row("net", "SOF PUL OQIMI (NET CF)", "total", netFlow, { sign: "=" }));

  // ── Hisoblar: boshlang'ich qoldiq oy boshigacha (barcha turlar + mijoz to'lovlari) ──
  const startBal = new Map<string, number>();
  for (const g of txBefore) startBal.set(g.cashAccountId, (startBal.get(g.cashAccountId) ?? 0) + txSign(g.type) * Number(g._sum.amount ?? 0));
  for (const g of payBefore) startBal.set(g.cashAccountId, (startBal.get(g.cashAccountId) ?? 0) + Number(g._sum.amount ?? 0));

  const accountRows: FinRow[] = [];
  const tot = { open: zeros(n), inn: zeros(n), out: zeros(n), tr: zeros(n), close: zeros(n) };
  for (const a of accounts) {
    const m = acc.get(a.id)!;
    let bal = startBal.get(a.id) ?? 0;
    const open = zeros(n), close = zeros(n);
    for (let i = 0; i < n; i++) {
      open[i] = r2(bal + m.opening[i]!); // oy ichida kiritilgan boshlang'ich qoldiq — oqim emas, ochilishga qo'shiladi
      bal = open[i]! + m.inn[i]! - m.out[i]! + m.tr[i]!;
      close[i] = r2(bal);
    }
    const moved = [m.inn, m.out, m.tr, m.opening].some((x) => x.some((v) => v !== 0)) || open.some((v) => v !== 0);
    if (!moved && !a.isActive) continue;
    accountRows.push(head(`acc:${a.id}`, a.name, n));
    accountRows.push(row(`acc:${a.id}:open`, "Boshlang'ich qoldiq", "line", open, { total: open[0] ?? 0 }));
    accountRows.push(row(`acc:${a.id}:in`, "Kirim (oborot)", "sub", m.inn, { sign: "+" }));
    accountRows.push(row(`acc:${a.id}:out`, "Chiqim (oborot)", "sub", neg(m.out), { sign: "−" }));
    accountRows.push(row(`acc:${a.id}:tr`, "Ichki o'tkazma (oborotga kirmaydi)", "sub", m.tr, { sign: "±" }));
    accountRows.push(row(`acc:${a.id}:close`, "Yakuniy qoldiq", "total", close, { total: close[n - 1] ?? 0, sign: "=" }));
    for (let i = 0; i < n; i++) {
      tot.open[i]! += open[i]!; tot.inn[i]! += m.inn[i]!; tot.out[i]! += m.out[i]!; tot.tr[i]! += m.tr[i]!; tot.close[i]! += close[i]!;
    }
  }
  const change = plus(tot.close, neg(tot.open));
  const check = plus(change, neg(netFlow)).map((v) => (Math.abs(v) < 0.01 ? 0 : v));
  accountRows.push(head("acc:all", "JAMI", n));
  accountRows.push(row("all:open", "Boshlang'ich qoldiq", "line", tot.open, { total: tot.open[0] ?? 0 }));
  accountRows.push(row("all:in", "Kirim (oborot)", "sub", tot.inn, { sign: "+" }));
  accountRows.push(row("all:out", "Chiqim (oborot)", "sub", neg(tot.out), { sign: "−" }));
  accountRows.push(row("all:tr", "Ichki o'tkazma (oborotga kirmaydi)", "sub", tot.tr, { sign: "±" }));
  accountRows.push(row("all:change", "O'zgarish", "sub", change, { sign: "±" }));
  accountRows.push(row("all:close", "Yakuniy qoldiq", "total", tot.close, { total: tot.close[n - 1] ?? 0, sign: "=" }));
  accountRows.push(row("all:check", "Tekshiruv: o'zgarish − sof pul oqimi (0 bo'lishi kerak)", "check", check));

  return { months, rows, accountRows, netFlow, check };
}
