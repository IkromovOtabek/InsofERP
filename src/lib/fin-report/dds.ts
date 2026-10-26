import { db } from "@/lib/db";
import { txSign } from "@/lib/cash-tx";
import type { CashFlowKind } from "@/generated/prisma";
import { loadCategories, makeResolver, FLOW_LABEL, UNKNOWN_CATEGORY } from "./categories";
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

const FLOWS: CashFlowKind[] = ["OPERATING", "FINANCING", "INVESTING"];
const SALES = "Savdo tushumi (mijozlar to'lovi)";

export async function ddsReport(months: MonthKey[]): Promise<DdsReport> {
  const n = months.length;
  const from = monthStart(months[0]!), to = monthEnd(months[n - 1]!);
  const idx = new Map(months.map((m, i) => [m, i]));
  const at = (d: Date) => idx.get(monthKeyOf(d));

  const [nodes, txs, pays, accounts, txBefore, payBefore] = await Promise.all([
    loadCategories(),
    db.cashTransaction.findMany({
      where: { cancelledAt: null, date: { gte: from, lt: to } },
      select: { date: true, type: true, amount: true, category: true, subCategory: true, cashAccountId: true, project: { select: { name: true } } },
    }),
    db.payment.findMany({ where: { date: { gte: from, lt: to } }, select: { date: true, amount: true, cashAccountId: true } }),
    db.cashAccount.findMany({ orderBy: [{ type: "asc" }, { name: "asc" }], select: { id: true, name: true, isActive: true } }),
    db.cashTransaction.groupBy({ by: ["cashAccountId", "type"], where: { cancelledAt: null, date: { lt: from } }, _sum: { amount: true } }),
    db.payment.groupBy({ by: ["cashAccountId"], where: { date: { lt: from } }, _sum: { amount: true } }),
  ]);
  const resolve = makeResolver(nodes);

  // ── Oqimlar: flow → yo'nalish → manba → oylar ──
  type Bucket = Map<string, number[]>;
  const flows = new Map<CashFlowKind, { in: Bucket; out: Bucket }>(FLOWS.map((f) => [f, { in: new Map(), out: new Map() }]));
  const put = (b: Bucket, name: string, i: number, v: number) => { if (!b.has(name)) b.set(name, zeros(n)); addInto(b.get(name)!, i, v); };
  const sales = zeros(n);
  for (const p of pays) { const i = at(p.date); if (i !== undefined) addInto(sales, i, Number(p.amount)); }
  flows.get("OPERATING")!.in.set(SALES, sales);

  // Hisoblar bloki uchun: hisob → [kirim, chiqim, o'tkazma, boshlang'ich kiritildi] oylar bo'yicha
  const acc = new Map(accounts.map((a) => [a.id, { inn: zeros(n), out: zeros(n), tr: zeros(n), opening: zeros(n) }]));
  for (const p of pays) { const i = at(p.date); const a = acc.get(p.cashAccountId); if (i !== undefined && a) addInto(a.inn, i, Number(p.amount)); }

  for (const t of txs) {
    const i = at(t.date);
    if (i === undefined) continue;
    const v = Number(t.amount), a = acc.get(t.cashAccountId);
    if (t.type === "OPENING") { if (a) addInto(a.opening, i, v); continue; }
    if (t.type === "TRANSFER_IN" || t.type === "TRANSFER_OUT") { if (a) addInto(a.tr, i, txSign(t.type) * v); continue; }
    if (a) addInto(t.type === "INCOME" ? a.inn : a.out, i, v);
    const r = resolve(t.category, t.subCategory);
    const flow = r?.top.flow ?? "OPERATING";
    const name = !r ? UNKNOWN_CATEGORY : r.top.needs === "PROJECT" ? `${r.top.name}: ${t.project?.name ?? "loyiha tanlanmagan"}` : r.top.name;
    put(t.type === "INCOME" ? flows.get(flow)!.in : flows.get(flow)!.out, name, i, v);
  }

  const total = (b: Bucket) => plus(zeros(n), ...b.values());
  const sorted = (b: Bucket) => [...b.entries()].sort((x, y) => y[1].reduce((s, v) => s + v, 0) - x[1].reduce((s, v) => s + v, 0));
  const rows: FinRow[] = [];
  const flowNet = new Map<CashFlowKind, number[]>();
  for (const f of FLOWS) {
    const { in: inn, out } = flows.get(f)!;
    const net = plus(total(inn), neg(total(out)));
    flowNet.set(f, net);
    if (!inn.size && !out.size) continue;
    rows.push(head(`h:${f}`, FLOW_LABEL[f], n));
    if (inn.size) {
      rows.push(row(`${f}:in`, "Tushum", "line", total(inn)));
      for (const [name, v] of sorted(inn)) if (v.some((x) => x !== 0) || name === SALES) rows.push(row(`${f}:in:${name}`, name, "sub", v));
    }
    if (out.size) {
      rows.push(row(`${f}:out`, "Chiqim", "line", neg(total(out))));
      for (const [name, v] of sorted(out)) if (v.some((x) => x !== 0)) rows.push(row(`${f}:out:${name}`, name, "sub", neg(v)));
    }
    rows.push(row(`${f}:net`, `${FLOW_LABEL[f]} bo'yicha pul oqimi`, "total", net));
  }
  const netFlow = plus(...FLOWS.map((f) => flowNet.get(f)!));
  rows.push(row("net", "SOF PUL OQIMI", "total", netFlow));

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
    accountRows.push(row(`acc:${a.id}:in`, "Kirim (oborot)", "sub", m.inn));
    accountRows.push(row(`acc:${a.id}:out`, "Chiqim (oborot)", "sub", neg(m.out)));
    accountRows.push(row(`acc:${a.id}:tr`, "Ichki o'tkazma (oborotga kirmaydi)", "sub", m.tr));
    accountRows.push(row(`acc:${a.id}:close`, "Yakuniy qoldiq", "total", close, { total: close[n - 1] ?? 0 }));
    for (let i = 0; i < n; i++) {
      tot.open[i]! += open[i]!; tot.inn[i]! += m.inn[i]!; tot.out[i]! += m.out[i]!; tot.tr[i]! += m.tr[i]!; tot.close[i]! += close[i]!;
    }
  }
  const change = plus(tot.close, neg(tot.open));
  const check = plus(change, neg(netFlow)).map((v) => (Math.abs(v) < 0.01 ? 0 : v));
  accountRows.push(head("acc:all", "JAMI (barcha hisoblar)", n));
  accountRows.push(row("all:open", "Boshlang'ich qoldiq", "line", tot.open, { total: tot.open[0] ?? 0 }));
  accountRows.push(row("all:in", "Kirim (oborot)", "sub", tot.inn));
  accountRows.push(row("all:out", "Chiqim (oborot)", "sub", neg(tot.out)));
  accountRows.push(row("all:tr", "Ichki o'tkazma (jami 0 bo'lishi kerak)", "sub", tot.tr));
  accountRows.push(row("all:close", "Yakuniy qoldiq", "total", tot.close, { total: tot.close[n - 1] ?? 0 }));
  accountRows.push(row("all:check", "Tekshiruv: qoldiq o'zgarishi − sof pul oqimi (0 bo'lishi kerak)", "check", check));

  return { months, rows, accountRows, netFlow, check };
}
