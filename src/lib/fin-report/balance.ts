import { db } from "@/lib/db";
import { txSign } from "@/lib/cash-tx";
import { customerBalances } from "@/lib/receivables";
import { avgUnitCosts } from "@/lib/stock";
import { finishedUnitCosts } from "@/lib/bi/core";
import { receiptTotal } from "@/lib/receipt-vat";
import { payablesSince, PAID_IMPORT_TOKEN } from "@/lib/receipt-payables";
import { activeAssets, assetStateAt } from "./assets";
import { loanBalances } from "./loans";
import { pnlReport } from "./pnl";
import { loadCategories, makeResolver } from "./categories";
import { type MonthKey, monthStart, monthEnd, addMonths, monthKeyOf } from "./period";
import { type FinRow, row, plus, neg, r2 } from "./rows";

/**
 * Balans — har oy OXIRIGA (`date < keyingi oy boshi`):
 *  AKTIV:  asosiy vositalar (qoldiq qiymat), xom-ashyo va tayyor mahsulot (StockMove miqdori × joriy o'rtacha
 *          tannarx — o'tgan oylar uchun taxminiy), debitorlik (mijozlar qarzi), ta'minotchiga berilgan avans,
 *          berilgan qarzlar, pul (hisoblar bo'yicha)
 *  PASSIV: ta'minotchiga qarz, mijozlar avansi, kreditlar va olingan qarzlar, shaxsiy kapital (= aktiv − qarzlar)
 * Kapitalni tekshirish: oldingi oy kapitali + shu oy taqsimlanmagan foydasi (hisoblangan PNL) + ta'sischi kiritmasi
 * = balansdagi kapital. Farq — balansga kirmagan narsa bor (boshlang'ich qoldiq, vosita, kredit to'liq emas…).
 *
 * Ta'minotchi bilan hisob — har yetkazuvchi bo'yicha sof qoldiq: boshlang'ich qoldiq + kirim hujjatlari (QQS va
 * dostavka bilan) − unga to'langan + undan qaytgan pul. Musbat — qarzimiz, manfiy — bergan avansimiz.
 * `payablesSince` dan oldingi kirim va to'lovlar (dastlabki import) hisobga olinmaydi — «To'lanmagan kirimlar» bilan bir xil.
 */
/** `labels` — ustun sarlavhalari: birinchisi davr boshi (01.MM.YYYY), keyin oy oxirlari; qiymatlar shu tartibda (n + 1 ta). */
export type BalanceReport = { months: MonthKey[]; labels: string[]; rows: FinRow[]; capitalRows: FinRow[]; notes: string[] };

type Snapshot = {
  assets: number; materials: number; finished: number; receivable: number; supplierAdvance: number; lent: number; cash: Map<string, number>;
  supplierDebt: number; customerAdvance: number; loans: number; borrowed: number;
};

/**
 * Ta'minotchilar bilan hisob — har yetkazuvchi bo'yicha sof qoldiq `asOf` paytiga: boshlang'ich qoldiq + kirim hujjatlari
 * (QQS va dostavka bilan) − unga to'langan + undan qaytgan pul. Musbat — qarzimiz, manfiy — bergan avansimiz.
 * `since` (payablesSince) dan oldingi kirim va to'lovlar hisobga olinmaydi. Bosh sahifadagi «Qarzlar» bloki ham shundan.
 */
export async function supplierPositions(asOf: Date, since?: Date): Promise<Map<string, number>> {
  const from = since ?? (await payablesSince());
  const [recItems, openings, supTx] = await Promise.all([
    db.goodsReceiptItem.findMany({
      where: { receipt: { cancelledAt: null, date: { lt: asOf }, createdAt: { gte: from }, OR: [{ clientToken: null }, { NOT: { clientToken: { startsWith: PAID_IMPORT_TOKEN } } }] } },
      select: { qty: true, price: true, vatAmount: true, deliveryCost: true, receipt: { select: { supplierId: true } } },
    }),
    db.openingBalance.findMany({ where: { kind: "SUPPLIER", cancelledAt: null, date: { lt: asOf } }, select: { supplierId: true, amount: true } }),
    db.cashTransaction.groupBy({ by: ["supplierId", "type"], where: { supplierId: { not: null }, cancelledAt: null, type: { in: ["INCOME", "EXPENSE"] }, date: { gte: from, lt: asOf } }, _sum: { amount: true } }),
  ]);
  const sup = new Map<string, number>();
  const addSup = (id: string | null, v: number) => { if (id) sup.set(id, (sup.get(id) ?? 0) + v); };
  const bySupplier = new Map<string, typeof recItems>();
  for (const it of recItems) { const k = it.receipt.supplierId; if (!bySupplier.has(k)) bySupplier.set(k, []); bySupplier.get(k)!.push(it); }
  for (const [k, items] of bySupplier) addSup(k, receiptTotal(items));
  for (const o of openings) addSup(o.supplierId, Number(o.amount));
  for (const t of supTx) addSup(t.supplierId, (t.type === "EXPENSE" ? -1 : 1) * Number(t._sum.amount ?? 0));
  return sup;
}

async function snapshot(asOf: Date, ctx: { matCost: Map<string, number>; prodCost: Map<string, number | null>; since: Date; assets: Awaited<ReturnType<typeof activeAssets>> }): Promise<Snapshot> {
  const month = monthKeyOf(new Date(asOf.getTime() - 1));
  const [stock, cust, sup, txBal, payBal, loans] = await Promise.all([
    db.$queryRaw<{ materialId: string | null; productId: string | null; qty: unknown }[]>`
      SELECT "materialId", "productId", SUM("qty") AS "qty" FROM "StockMove" WHERE "date" < ${asOf} GROUP BY "materialId", "productId"`,
    customerBalances({ asOf }),
    supplierPositions(asOf, ctx.since),
    db.cashTransaction.groupBy({ by: ["cashAccountId", "type"], where: { cancelledAt: null, date: { lt: asOf } }, _sum: { amount: true } }),
    db.payment.groupBy({ by: ["cashAccountId"], where: { date: { lt: asOf } }, _sum: { amount: true } }),
    loanBalances(asOf),
  ]);

  let materials = 0, finished = 0;
  for (const s of stock) {
    const q = Number(s.qty);
    if (q <= 0) continue;
    if (s.materialId) materials += q * (ctx.matCost.get(s.materialId) ?? 0);
    else if (s.productId) finished += q * (ctx.prodCost.get(s.productId) ?? 0);
  }

  let receivable = 0, customerAdvance = 0;
  for (const c of cust.values()) { receivable += c.debt; customerAdvance += c.advance; }

  let supplierDebt = 0, supplierAdvance = 0;
  for (const v of sup.values()) { if (v > 0) supplierDebt += v; else supplierAdvance += -v; }

  const cash = new Map<string, number>();
  for (const g of txBal) cash.set(g.cashAccountId, (cash.get(g.cashAccountId) ?? 0) + txSign(g.type) * Number(g._sum.amount ?? 0));
  for (const g of payBal) cash.set(g.cashAccountId, (cash.get(g.cashAccountId) ?? 0) + Number(g._sum.amount ?? 0));

  let loansSum = 0, borrowed = 0, lent = 0;
  for (const l of loans) {
    if (l.kind === "BANK") loansSum += l.balance;
    else if (l.kind === "BORROWED") borrowed += l.balance;
    else lent += l.balance;
  }

  const assets = ctx.assets.reduce((s, a) => s + assetStateAt(a, month).net, 0);
  return { assets, materials, finished, receivable, supplierAdvance, lent, cash, supplierDebt, customerAdvance, loans: loansSum, borrowed };
}

export async function balanceReport(months: MonthKey[]): Promise<BalanceReport> {
  const n = months.length;
  const prev = addMonths(months[0]!, -1);
  const [matCost, prodCost, since, assets, accounts, pnl, nodes, contrib] = await Promise.all([
    avgUnitCosts(), finishedUnitCosts(), payablesSince(), activeAssets(),
    db.cashAccount.findMany({ orderBy: [{ type: "asc" }, { name: "asc" }], select: { id: true, name: true } }),
    pnlReport(months, "accrual"),
    loadCategories(),
    db.cashTransaction.findMany({ where: { type: "INCOME", cancelledAt: null, date: { gte: monthStart(months[0]!), lt: monthEnd(months[n - 1]!) } }, select: { date: true, amount: true, category: true, subCategory: true } }),
  ]);
  const ctx = { matCost, prodCost, since, assets };
  // Oldingi oy oxiri ham kerak — birinchi oyning «kapital oy boshida» qatori uchun
  // Ketma-ket: har snapshot 6 ta og'ir so'rov — 13 tasi birdan ulanish pulini (connection_limit) to'ldirib, P2024 beradi
  const snaps: Snapshot[] = [];
  for (const m of [prev, ...months]) snaps.push(await snapshot(monthEnd(m), ctx));

  // Ustunlar (jadvaldagidek): birinchi — davr boshi (01.MM.YYYY), keyin har oy oxiri (30.09.2026 …)
  const pick = (f: (s: Snapshot) => number) => snaps.map(f);
  const cashTotal = (s: Snapshot) => [...s.cash.values()].reduce((a, b) => a + b, 0);
  const assetsTotal = (s: Snapshot) => s.assets + s.materials + s.finished + s.receivable + s.supplierAdvance + s.lent + cashTotal(s);
  const liabTotal = (s: Snapshot) => s.supplierDebt + s.customerAdvance + s.loans + s.borrowed;
  const equity = (s: Snapshot) => assetsTotal(s) - liabTotal(s);
  const opt = { total: null };

  const A = pick(assetsTotal), L = pick(liabTotal), E = pick(equity);
  const stockSum = plus(pick((s) => s.materials), pick((s) => s.finished));
  const debtors = plus(pick((s) => s.receivable), pick((s) => s.supplierAdvance), pick((s) => s.lent));
  const cashSum = pick(cashTotal);
  const current = plus(stockSum, debtors, cashSum);
  const keep = new Set(["deb:cust", "deb:sup", "stock:mat", "stock:fin", "liab:sup", "liab:adv", "liab:tranzit", "liab:bank"]);

  const rows: FinRow[] = [
    row("a:head", "AKTIV", "total", A, opt),
    row("fixed", "Asosiy vositalar", "sub", pick((s) => s.assets), opt),
    row("current", "Aylanma mablag'lar", "line", current, opt),
    row("stock", "Ombor", "line", stockSum, opt),
    row("stock:mat", "Xom-ashyo (sklad qoldig'i, QQSsiz)", "sub", pick((s) => s.materials), { ...opt, hint: "Miqdor jurnaldan, narx — joriy o'rtacha tannarx" }),
    row("stock:fin", "Tayyor mahsulot (tannarxda)", "sub", pick((s) => s.finished), opt),
    row("debtors", "Debitorlik (haqqimiz)", "line", debtors, opt),
    row("deb:cust", "Xaridorlardan", "sub", pick((s) => s.receivable), opt),
    row("deb:sup", "Ta'minotchilarga berilgan avans", "sub", pick((s) => s.supplierAdvance), opt),
    row("deb:lent", "Berilgan qarzlar", "sub", pick((s) => s.lent), opt),
    row("cash", "Pul mablag'lari", "line", cashSum, opt),
    ...accounts.map((a) => row(`cash:${a.id}`, a.name, "sub", pick((s) => s.cash.get(a.id) ?? 0), opt)).filter((r) => r.values.some((v) => (v ?? 0) !== 0)),
    row("a:total", "BALANS (aktiv)", "total", A, opt),
    row("p:head", "PASSIV", "total", plus(E, L), opt),
    row("equity", "Shaxsiy kapital (aktiv − qarzlar)", "line", E, opt),
    row("liab", "Kreditorlik (qarzimiz)", "line", L, opt),
    row("liab:sup", "Ta'minotchilarga qarz", "sub", pick((s) => s.supplierDebt), opt),
    row("liab:adv", "Xaridorlar avansi (tovar qarzimiz)", "sub", pick((s) => s.customerAdvance), opt),
    row("liab:tranzit", "Tranzit pul qoldig'i (boshqalar puli bizda; minus — biz ortiqcha berdik)", "sub", pick(() => 0), opt),
    row("liab:bank", "Bank kreditlari", "sub", pick((s) => s.loans), opt),
    row("liab:borrow", "Olingan qarzlar", "sub", pick((s) => s.borrowed), opt),
    row("p:total", "BALANS (passiv)", "total", plus(E, L), opt),
    row("retained", "Oy davomida taqsimlanmagan foyda (PNL)", "line", [null, ...pnl.retained], opt),
  ].filter((r) => r.kind !== "sub" || keep.has(r.key) || r.key === "fixed" || r.values.some((v) => (v ?? 0) !== 0));

  // ── Kapitalni tekshirish ──
  const resolve = makeResolver(nodes);
  const ownerIn = months.map(() => 0);
  for (const t of contrib) {
    const r = resolve(t.category, t.subCategory);
    if (r?.top.flow !== "FINANCING" || r.top.needs) continue; // kredit/qarz emas — ta'sischi kiritmasi kabi
    const i = months.indexOf(monthKeyOf(t.date));
    if (i >= 0) ownerIn[i]! += Number(t.amount);
  }
  const startEq = snaps.slice(0, n).map(equity);
  const expected = plus(startEq, pnl.retained, ownerIn);
  const diff = plus(E.slice(1), neg(expected)).map((v) => (Math.abs(v) < 1 ? 0 : r2(v)));
  const lead = <T,>(v: T[]) => [null, ...v];
  const capitalRows: FinRow[] = [
    row("cap:start", "Kapital oy boshida (oldingi balansdan)", "line", lead(startEq), opt),
    row("cap:pnl", "Qo'shiladi: oy natijasi (PNL, taqsimlanmagan foyda)", "line", lead(pnl.retained), opt),
    ...(ownerIn.some((v) => v) ? [row("cap:owner", "Qo'shiladi: ta'sischi kiritmasi", "line", lead(ownerIn), opt)] : []),
    row("cap:exp", "Kapital hisob bo'yicha (bo'lishi kerak)", "total", lead(expected), opt),
    row("cap:diff", "FARQ: balansdagi kapital − hisob bo'yicha (0 bo'lishi kerak)", "check", lead(diff), opt),
  ];

  const notes = [
    "Debitor va kreditor qarzlar — mijoz va ta'minotchi hisob-kitobidan (boshlang'ich qoldiq bilan), xom-ashyo — sklad jurnalidan QQSsiz, pul — «Pul oqimi (DDS)» dan, asosiy vositalar — «Asosiy vositalar» sahifasidan, bank krediti — boshlang'ich qoldiq minus kassadan to'langan asosiy qarz.",
    "Xom-ashyo va tayyor mahsulot qoldig'i jurnaldan aniq, narxi — joriy o'rtacha tannarx: o'tgan oylar uchun taxminiy.",
    "Farq katta bo'lsa — balansga kirmagan narsa bor: asosiy vositalar to'ldirilmagan, qarz yoki ombor qoldig'i to'liq emas, kassada manba noto'g'ri yozilgan yoki boshlang'ich qoldiq to'liq emas.",
  ];
  const fmt = (d: Date) => `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;
  const labels = [fmt(monthStart(months[0]!)), ...months.map((m) => fmt(new Date(monthEnd(m).getTime() - 86_400_000)))];
  return { months, labels, rows, capitalRows, notes };
}
