import { db } from "@/lib/db";
import { loadRevenue } from "@/lib/bi/core";
import { FLOW_ONLY } from "@/lib/cash-tx";
import type { PnlLine } from "@/generated/prisma";
import { loadCategories, makeResolver, UNKNOWN_CATEGORY } from "./categories";
import { activeAssets, depreciationIn } from "./assets";
import { type MonthKey, monthStart, monthEnd, monthKeyOf } from "./period";
import { type FinRow, row, pctRow, zeros, addInto, neg, plus } from "./rows";

/**
 * Foyda va zarar (PNL) — oylar ustunda. Ikki rejim («Insof 2026» jadvalidagi «Foyda-Zarar» varag'idek):
 *
 *  HISOBLANGAN (accrual, asosiy):
 *   - daromad  = yetkazilgan mahsulot (`loadRevenue`, QQS'siz) mahsulot guruhlari bo'yicha + boshqa tushumlar (kassa)
 *   - tannarx  = retsept × xomashyo o'rtacha narxi; kassadagi «Xomashyo» to'lovi bu rejimda PNL'ga kirmaydi
 *     (u sklad qoldig'iga aylanadi, tannarxga sotilganda o'tadi — ikki marta hisoblanmasin)
 *   - ish haqi = shu oy uchun tasdiqlangan yakuniy vedomost (hisoblangan + ish beruvchi solig'i); vedomost
 *     bo'lmasa — kassadan to'langani. Kunbay ishchilar har doim kassadan.
 *   - amortizatsiya — asosiy vositalardan
 *  PUL ASOSIDA (cash): daromad = mijozlar to'lovi + boshqa tushumlar; tannarx = kassadagi xom-ashyo to'lovi;
 *   xarajatlar kassadan; amortizatsiya yo'q.
 *
 * Xarajatlar kassa kategoriyasining PNL qatori (`CashCategory.pnlLine`) bo'yicha guruhlanadi. Kredit tanasi,
 * asosiy vosita xaridi, qarz berish (`NONE`) PNL'ga kirmaydi. Loyihalar — zavod foydasidan keyin, divident — oxirida.
 */
export type PnlMode = "accrual" | "cash";
export type PnlReport = { months: MonthKey[]; mode: PnlMode; rows: FinRow[]; retained: number[]; notes: string[] };

/** Kunbay ishchilar sub manbasi — vedomostga kirmaydi, hisoblangan rejimda ham kassadan olinadi. */
const DAY_WORKERS_SUB = "Yollanma (kunbay) ishchilar";

/** Mahsulotning yuqori guruhi nomi (Plita, Stolba, Beton…); guruhsiz — «Boshqa mahsulotlar». */
async function productGroupNames(): Promise<Map<string, string>> {
  const [products, groups] = await Promise.all([
    db.product.findMany({ select: { id: true, groupId: true } }),
    db.productGroup.findMany({ select: { id: true, name: true, parentId: true } }),
  ]);
  const gById = new Map(groups.map((g) => [g.id, g]));
  const topName = (id: string | null): string => {
    let g = id ? gById.get(id) : undefined;
    for (let i = 0; g?.parentId && i < 10; i++) g = gById.get(g.parentId) ?? g;
    return g?.name ?? "Boshqa mahsulotlar";
  };
  return new Map(products.map((p) => [p.id, topName(p.groupId)]));
}

export async function pnlReport(months: MonthKey[], mode: PnlMode = "accrual"): Promise<PnlReport> {
  const n = months.length;
  const from = monthStart(months[0]!), to = monthEnd(months[n - 1]!);
  const idx = new Map(months.map((m, i) => [m, i]));
  const at = (d: Date) => idx.get(monthKeyOf(d));

  const [nodes, txs, revenue, payments, groups, payroll, assets] = await Promise.all([
    loadCategories(),
    db.cashTransaction.findMany({
      where: { ...FLOW_ONLY, cancelledAt: null, date: { gte: from, lt: to } },
      select: { date: true, type: true, amount: true, category: true, subCategory: true, project: { select: { name: true } } },
    }),
    mode === "accrual" ? loadRevenue(from, to) : Promise.resolve([]),
    mode === "cash" ? db.payment.findMany({ where: { date: { gte: from, lt: to } }, select: { date: true, amount: true } }) : Promise.resolve([]),
    mode === "accrual" ? productGroupNames() : Promise.resolve(new Map<string, string>()),
    mode === "accrual"
      ? db.payrollRun.findMany({ where: { month: { in: months }, kind: "FINAL", status: { in: ["APPROVED", "PAID"] } }, select: { month: true, gross: true, employerTax: true } })
      : Promise.resolve([]),
    mode === "accrual" ? activeAssets() : Promise.resolve([]),
  ]);
  const resolve = makeResolver(nodes);
  const notes: string[] = [];

  // ── Daromad ──
  const sales = new Map<string, number[]>(); // guruh → oylar
  const cogs = zeros(n), uncosted = zeros(n);
  for (const r of revenue) {
    const i = at(r.date);
    if (i === undefined) continue;
    const g = groups.get(r.productId) ?? "Boshqa mahsulotlar";
    if (!sales.has(g)) sales.set(g, zeros(n));
    addInto(sales.get(g)!, i, r.net);
    if (r.costKnown) addInto(cogs, i, r.cost);
    else addInto(uncosted, i, r.net);
  }
  if (mode === "cash") {
    const s = zeros(n);
    for (const p of payments) { const i = at(p.date); if (i !== undefined) addInto(s, i, Number(p.amount)); }
    sales.set("Savdo tushumi (mijozlar to'lovi)", s);
  }

  // ── Kassa: PNL qatori → manba → oylar (xarajat musbat; teskari yozuv — qaytgan pul — ayiriladi) ──
  const byLine = new Map<PnlLine | "UNKNOWN", Map<string, number[]>>();
  const put = (line: PnlLine | "UNKNOWN", name: string, i: number, v: number) => {
    let m = byLine.get(line);
    if (!m) byLine.set(line, (m = new Map()));
    if (!m.has(name)) m.set(name, zeros(n));
    addInto(m.get(name)!, i, v);
  };
  const accruedMonths = new Set(payroll.map((p) => p.month));
  for (const t of txs) {
    const i = at(t.date);
    if (i === undefined) continue;
    const a = Number(t.amount);
    const r = resolve(t.category, t.subCategory);
    if (!r) { put("UNKNOWN", UNKNOWN_CATEGORY, i, t.type === "EXPENSE" ? a : -a); continue; }
    const line = r.top.pnlLine;
    if (line === "NONE") continue;
    if (line === "MATERIALS" && mode === "accrual") continue;
    if (line === "PAYROLL" && mode === "accrual" && accruedMonths.has(months[i]!) && r.sub?.name !== DAY_WORKERS_SUB) continue;
    // Kategoriya turiga ko'ra ishora: kirim kategoriyasida kirim (+), xarajat kategoriyasida chiqim (+)
    const v = (r.top.type === "INCOME") === (t.type === "INCOME") ? a : -a;
    const name = line === "PROJECT" ? (t.project?.name ?? "Loyiha tanlanmagan") : line === "PAYROLL" && r.sub ? r.sub.name : r.top.name;
    put(line, name, i, v);
  }
  if (mode === "accrual") {
    for (const p of payroll) {
      const i = idx.get(p.month);
      if (i !== undefined) put("PAYROLL", "Ish haqi (hisoblangan vedomost)", i, Number(p.gross) + Number(p.employerTax));
    }
    for (const a of assets) for (const m of months) { const v = depreciationIn(a, m); if (v) put("PRODUCTION", "Amortizatsiya", idx.get(m)!, v); }
    if (uncosted.some((v) => v > 0)) notes.push("Ba'zi mahsulotlarning retsepti yoki xomashyo narxi yo'q — ularning tushumi tannarxsiz kirdi («Tannarxi noma'lum tushum» qatori).");
    notes.push("Daromad — yetkazilgan mahsulot, QQS'siz; dostavka summasi kirmaydi. Tannarx retsept bo'yicha (haqiqiy ÷ me'yor koeffitsiyenti keyingi bosqichda).");
  } else {
    notes.push("Pul asosida: daromad — mijozlar to'lovi (QQS bilan), tannarx — kassadan xom-ashyoga to'langan pul.");
  }

  const lineMap = (l: PnlLine | "UNKNOWN") => byLine.get(l) ?? new Map<string, number[]>();
  const lineSum = (...ls: (PnlLine | "UNKNOWN")[]) => plus(zeros(n), ...ls.flatMap((l) => [...lineMap(l).values()]));
  const subRows = (l: PnlLine, keyPrefix: string, sign = -1) =>
    [...lineMap(l).entries()].sort((a, b) => b[1].reduce((s, v) => s + v, 0) - a[1].reduce((s, v) => s + v, 0)).map(([name, v]) => row(`${keyPrefix}:${name}`, name, "sub", sign < 0 ? neg(v) : v));

  const salesTotal = plus(zeros(n), ...sales.values());
  const otherIncome = lineSum("OTHER_INCOME");
  const income = plus(salesTotal, otherIncome);
  const cogsTotal = mode === "accrual" ? cogs : lineSum("MATERIALS");
  const gross = plus(income, neg(cogsTotal));
  const prodLines: PnlLine[] = ["PRODUCTION", "PAYROLL", "TRANSPORT"];
  const prod = lineSum(...prodLines), admin = lineSum("ADMIN"), comm = lineSum("COMMERCIAL"), unknown = lineSum("UNKNOWN");
  const operating = plus(gross, neg(prod), neg(admin), neg(comm), neg(unknown));
  const tax = lineSum("TAX"), interest = lineSum("INTEREST");
  const net = plus(operating, neg(tax), neg(interest));
  const projects = lineSum("PROJECT");
  const result = plus(net, neg(projects));
  const dividend = lineSum("DIVIDEND");
  const retained = plus(result, neg(dividend));

  const rows: FinRow[] = [
    row("income", "Daromad", "total", income),
    ...[...sales.entries()].sort((a, b) => b[1].reduce((s, v) => s + v, 0) - a[1].reduce((s, v) => s + v, 0)).map(([g, v]) => row(`sales:${g}`, g, "sub", v)),
    row("other-income", "Boshqa tushumlar", "sub", otherIncome),
    ...(mode === "accrual" && uncosted.some((v) => v > 0) ? [row("uncosted", "shundan tannarxi noma'lum tushum", "sub", uncosted, { hint: "Retsepti yoki xomashyo narxi yo'q mahsulotlar" })] : []),
    row("cogs", mode === "accrual" ? "Sotuv tannarxi (retsept bo'yicha)" : "Xom-ashyoga to'langan", "line", neg(cogsTotal)),
    pctRow("cogs-pct", "Tannarx ulushi, %", cogsTotal, income),
    row("gross", "YALPI FOYDA", "total", gross),
    pctRow("gross-pct", "Yalpi marja, %", gross, income),
    row("prod", "Ishlab chiqarish xarajatlari", "line", neg(prod)),
    ...prodLines.flatMap((l) => subRows(l, l)),
    pctRow("prod-pct", "Ishlab chiqarish xarajatlari ulushi, %", prod, income),
    row("admin", "Ma'muriy xarajatlar", "line", neg(admin)),
    ...subRows("ADMIN", "ADMIN"),
    row("comm", "Tijoriy xarajatlar", "line", neg(comm)),
    ...subRows("COMMERCIAL", "COMMERCIAL"),
    row("unknown", "Manbasi aniqlanmagan pul (0 bo'lishi kerak)", "check", neg(unknown), { hint: "Kategoriyasi daraxtda topilmagan kassa yozuvlari — Moliya → Kategoriyalar" }),
    row("operating", "OPERATSION FOYDA", "total", operating),
    pctRow("operating-pct", "Operatsion foyda rentabelligi, %", operating, income),
    row("tax", "Soliqlar", "line", neg(tax)),
    row("interest", "Kredit foizi (asosiy qarz to'lovi xarajat emas — balansda)", "line", neg(interest)),
    row("net", "ZAVOD SOF FOYDASI", "total", net),
    pctRow("net-pct", "Sof foyda rentabelligi, %", net, income),
    row("projects", "Loyihalar (zavod foydasiga kirmaydi)", "line", neg(projects)),
    ...subRows("PROJECT", "PROJECT"),
    row("result", "JAMI NATIJA (zavod + loyihalar)", "total", result),
    row("dividend", "Divident (egasiga olingan pul)", "line", neg(dividend)),
    row("retained", "TAQSIMLANMAGAN FOYDA", "total", retained),
  ];
  // Bo'sh ichki qatorlarni chiqarmaymiz (0 summali sub), asosiy qatorlar doim turadi
  const visible = rows.filter((r) => r.kind !== "sub" || r.values.some((v) => (v ?? 0) !== 0));
  return { months, mode, rows: visible, retained, notes };
}
