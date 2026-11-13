import { cache } from "react";
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
import { fmtNum } from "@/lib/format";
import { finDrill, own, type Drill, type DrillItem } from "@/lib/drill";
import { LOAN_KIND_LABEL } from "./loans";
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
  return balanceOnce(months.join(","));
}
/** Tahlil → Balans: KPI qatori va jadval bir sahifada bir xil hisobotni so'raydi — bir marta (`cache`, n + 1 ta og'ir snapshot). Natija o'zgartirilmaydi. */
const balanceOnce = cache((months: string) => buildBalance(months.split(",") as MonthKey[]));

async function buildBalance(months: MonthKey[]): Promise<BalanceReport> {
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

// ───────────────────────── Raqam manbasi (drill-down) ─────────────────────────

/** Jami qatorlar tarkibi («-kalit» — ayiriladi). Pul — hisoblar qatorlari (`cash:<id>`), pastda qo'shiladi. */
const BAL_COMPOSE: Record<string, string[]> = {
  "a:head": ["fixed", "current"], "a:total": ["fixed", "current"],
  current: ["stock", "debtors", "cash"],
  stock: ["stock:mat", "stock:fin"],
  debtors: ["deb:cust", "deb:sup", "deb:lent"],
  "p:head": ["equity", "liab"], "p:total": ["equity", "liab"],
  equity: ["a:total", "-liab"],
  liab: ["liab:sup", "liab:adv", "liab:tranzit", "liab:bank", "liab:borrow"],
  "cap:exp": ["cap:start", "cap:pnl", "cap:owner"],
  "cap:diff": ["equity", "-cap:exp"],
};
/** Yozuvlarga yoyiladigan qatorlar (mijoz, ta'minotchi, material, kredit, vosita bo'yicha). */
const BAL_ITEMS = new Set(["fixed", "stock:mat", "stock:fin", "deb:cust", "deb:sup", "deb:lent", "liab:sup", "liab:adv", "liab:bank", "liab:borrow", "cap:owner"]);

/** Balans katagi bosiladimi: tarkibi yoki yozuvlari bor qatorlar (oy natijasi — PNL'da, kapital oy boshida — oldingi ustunda). */
export const balanceDrillable = (key: string) => Object.hasOwn(BAL_COMPOSE, key) || BAL_ITEMS.has(key) || key === "cash" || /^cash:[^:]+$/.test(key);

const KIND_OF: Record<string, "BANK" | "BORROWED" | "LENT"> = { "liab:bank": "BANK", "liab:borrow": "BORROWED", "deb:lent": "LENT" };

/**
 * Balans katagining manbasi `col`-ustun sanasiga (0 — davr boshi, i — i-oy oxiri): jami qatorlar — tarkibi; qolganlari — kimdan /
 * nimadan iborat: har mijoz qarzi yoki avansi, har ta'minotchi, har material va mahsulot qoldig'i (miqdor × narx), har kredit,
 * har asosiy vosita; hisob qoldig'i — kirim, chiqim, mijoz to'lovlari va o'tkazmalar yig'indisi. Manbalar `snapshot` niki.
 */
export async function balanceDrill(months: MonthKey[], key: string, col: number): Promise<Drill | null> {
  if (col < 0 || col > months.length || !balanceDrillable(key)) return null;
  const rep = await balanceReport(months);
  const rows = [...rep.rows, ...rep.capitalRows];
  const month = col === 0 ? addMonths(months[0]!, -1) : months[col - 1]!;
  const asOf = monthEnd(month);
  const period = `${rep.labels[col]} holatiga`;
  const compose = own(BAL_COMPOSE, key) ?? (key === "cash" ? rep.rows.filter((r) => r.key.startsWith("cash:")).map((r) => r.key) : null);
  if (compose) return finDrill(rows, period, key, col, { parts: compose, items: [], compose: true, note: "Quyidagi qatorlar yig'indisi (ayiriladigani manfiy). Har birini bosib ichiga kiring." });

  const items: DrillItem[] = [];
  let note: string | undefined;
  if (key === "fixed") {
    for (const a of await activeAssets()) {
      const st = assetStateAt(a, month);
      if (st.net) items.push({ date: a.acquiredAt, title: a.name, sub: `${a.group} · narxi ${fmtNum(a.cost)} · amortizatsiya ${fmtNum(st.accumulated)}`, amount: st.net, href: "/moliya/asosiy-vositalar" });
    }
  } else if (key === "stock:mat" || key === "stock:fin") {
    const mat = key === "stock:mat";
    const [stock, cost] = await Promise.all([
      db.$queryRaw<{ materialId: string | null; productId: string | null; qty: unknown }[]>`
        SELECT "materialId", "productId", SUM("qty") AS "qty" FROM "StockMove" WHERE "date" < ${asOf} GROUP BY "materialId", "productId"`,
      mat ? avgUnitCosts() : finishedUnitCosts(),
    ]);
    const lines = stock.filter((x) => Number(x.qty) > 0 && (mat ? !!x.materialId : !x.materialId && !!x.productId));
    const ids = [...new Set(lines.map((x) => (mat ? x.materialId! : x.productId!)))];
    const names = new Map((mat
      ? await db.material.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, unit: true } })
      : await db.product.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, unit: true } })).map((x) => [x.id, x]));
    for (const x of lines) {
      const id = mat ? x.materialId! : x.productId!, q = Number(x.qty), price = cost.get(id) ?? 0, nm = names.get(id);
      items.push({ date: null, title: nm?.name ?? "—", sub: `${fmtNum(q, 3)} ${nm?.unit ?? ""} × ${fmtNum(price)}${price ? "" : " (narxi yo'q — hisobga kirmaydi)"}`, amount: q * price, href: mat ? "/stock" : "/stock/products" });
    }
    note = "Miqdor — sklad jurnalidan shu sanagacha, narx — joriy o'rtacha tannarx (o'tgan oylar uchun taxminiy).";
  } else if (key === "deb:cust" || key === "liab:adv") {
    const bal = await customerBalances({ asOf });
    const list = [...bal.values()].filter((c) => (key === "deb:cust" ? c.debt : c.advance) > 0);
    const names = new Map((await db.customer.findMany({ where: { id: { in: list.map((c) => c.customerId) } }, select: { id: true, name: true } })).map((c) => [c.id, c.name]));
    for (const c of list) items.push({ date: null, title: names.get(c.customerId) ?? "—", sub: `schyot ${fmtNum(c.invoiced)} · to'langan ${fmtNum(c.paid)}`, amount: key === "deb:cust" ? c.debt : c.advance, href: `/customers/${c.customerId}` });
  } else if (key === "deb:sup" || key === "liab:sup") {
    const pos = await supplierPositions(asOf);
    const list = [...pos.entries()].filter(([, v]) => (key === "liab:sup" ? v > 0 : v < 0));
    const names = new Map((await db.supplier.findMany({ where: { id: { in: list.map(([id]) => id) } }, select: { id: true, name: true } })).map((x) => [x.id, x.name]));
    for (const [id, v] of list) items.push({ date: null, title: names.get(id) ?? "—", sub: key === "liab:sup" ? "kirim hujjatlari − to'langan" : "to'langan − kelgan mol", amount: Math.abs(v), href: `/suppliers/${id}` });
  } else if (own(KIND_OF, key)) {
    const kind = KIND_OF[key];
    for (const l of (await loanBalances(asOf)).filter((x) => x.kind === kind)) {
      items.push({ date: l.openingDate, title: l.name, sub: `${LOAN_KIND_LABEL[l.kind]} · ${l.counterparty} · boshlang'ich ${fmtNum(l.opening)}`, amount: l.balance, href: "/moliya/kreditlar" });
    }
  } else if (key === "cap:owner") {
    if (col === 0) return null;
    const nodes = makeResolver(await loadCategories());
    const txs = await db.cashTransaction.findMany({
      where: { type: "INCOME", cancelledAt: null, date: { gte: monthStart(month), lt: asOf } },
      select: { date: true, amount: true, category: true, subCategory: true, counterparty: true, note: true, cashAccount: { select: { name: true } } },
    });
    for (const t of txs) {
      const r = nodes(t.category, t.subCategory);
      if (r?.top.flow !== "FINANCING" || r.top.needs) continue;
      items.push({ date: t.date, title: t.counterparty?.trim() || t.category, sub: [t.cashAccount.name, t.category, t.note?.trim()].filter(Boolean).join(" · "), amount: Number(t.amount) });
    }
  } else if (key.startsWith("cash:")) {
    // Hisob qoldig'i — shu sanagacha barcha harakatlar: kirim, chiqim, o'tkazmalar, boshlang'ich qoldiq va mijoz to'lovlari
    const id = key.slice(5);
    const [tx, pay] = await Promise.all([
      db.cashTransaction.groupBy({ by: ["type"], where: { cashAccountId: id, cancelledAt: null, date: { lt: asOf } }, _sum: { amount: true }, _count: { _all: true } }),
      db.payment.aggregate({ where: { cashAccountId: id, date: { lt: asOf } }, _sum: { amount: true }, _count: { _all: true } }),
    ]);
    const LABEL: Record<string, string> = { OPENING: "Boshlang'ich qoldiq", INCOME: "Kirim (kassa yozuvlari)", EXPENSE: "Chiqim (kassa yozuvlari)", TRANSFER_IN: "Ichki o'tkazma — kirdi", TRANSFER_OUT: "Ichki o'tkazma — chiqdi" };
    const href = `/payments?tab=kassa&account=${id}`;
    for (const g of tx) items.push({ date: null, title: LABEL[g.type] ?? g.type, sub: `${g._count._all} ta yozuv`, amount: txSign(g.type) * Number(g._sum.amount ?? 0), href });
    if (pay._count._all) items.push({ date: null, title: "Mijozlar to'lovi", sub: `${pay._count._all} ta to'lov`, amount: Number(pay._sum.amount ?? 0), href });
    note = "Hisob qoldig'i — shu sanagacha bo'lgan barcha harakatlar yig'indisi.";
  }
  return finDrill(rows, period, key, col, { parts: [], items, note });
}
