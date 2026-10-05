import { db } from "@/lib/db";
import { getCompany } from "@/lib/company";
import { loadRevenue, productCosts, materialCosts, sum, safeDiv, addDays, startOfDay, monthForecast, workingDays, type Range, type SaleRow } from "@/lib/bi/core";
import { lossChannels } from "@/lib/bi/finance";
import { materialOverview } from "@/lib/bi/stock";
import { MONTHS_SHORT } from "@/lib/bi/plans";
import { EXPENSE_CATEGORIES } from "@/app/(app)/cashflow/categories";
import { ROLE_LABELS } from "@/lib/nav";
import { customersCredit, type CustomerCredit } from "@/lib/finance";
import { receivablesReport, OWNER_EDGES } from "@/lib/receivables";
import { totalPlanned } from "@/lib/supply";
import { needsDirector } from "@/lib/procurement";
import { moneyShort, qty as fq } from "@/lib/format";
import { unitLabel } from "@/lib/unit";
import { txSign, FLOW_ONLY } from "@/lib/cash-tx";

/**
 * Egasi dashbordi (TZ "Owner Dashboard v2.0") — bitta chaqiruvda hamma blok.
 * Har raqam "nima bo'ldi → nega → qancha pul → kim javobgar → nima qilish" savoliga javob berishi kerak,
 * shuning uchun bloklar bir-biriga bog'liq: xarajat byudjeti → foyda plani → qaror bloki.
 *
 * Manbalar: tushum (yetkazilgan reyslar, `deliveredAt` bo'yicha — `loadRevenue`), tannarx (retsept × xomashyo
 * miqdorga tortilgan o'rtacha kirim narxi),
 * kassa (Payment + CashTransaction), byudjet (ExpenseBudget), plan (SalesPlan, ProductionPlan),
 * sklad (StockMove), transport (Vehicle/Trip), ta'minot (SupplyRequest — kreditorka).
 */

export type Level = "ok" | "warn" | "crit";
export const LEVEL_LABEL: Record<Level, string> = { ok: "Norma", warn: "E'tibor", crit: "Kritik" };

/** Kirim-Chiqim kategoriyasi — `EXPENSE_CATEGORIES` dagi aniq matn (indeks bo'yicha emas: ro'yxat tartibi o'zgarsa ham to'g'ri). */
const cat = (name: string) => {
  if (!EXPENSE_CATEGORIES.includes(name)) throw new Error(`EXPENSE_CATEGORIES da "${name}" yo'q`);
  return name;
};
/** Xomashyo kategoriyasi — tannarxga kiradi, operatsion xarajatga qo'shilmaydi (ikki marta hisoblanmasin). */
export const COGS_CATEGORY = cat("Xomashyo");
/** Yoqilg'i kategoriyasi — transport blokidagi "fakt / norma". */
const FUEL_CATEGORY = cat("Transport / yoqilg'i");
const REPAIR_CATEGORY = cat("Ta'mirlash / ehtiyot qism");

/**
 * Oyiga bir marta to'lanadigan toifalar (ish haqi, ijara, soliq, kommunal hisob): oyning 5-kunida to'langan
 * ijara "kunlik sur'at × 30" bilan 6 barobar prognoz qilinmasin. Ularning prognozi — max(fakt, reja).
 * Qolganlari (xomashyo, yoqilg'i, ta'mir, ofis…) kun sayin sarflanadi — proporsional prognoz.
 */
export const MONTHLY_ONE_OFF_CATEGORIES: readonly string[] = [cat("Ish haqi"), cat("Ijara"), cat("Soliq va to'lovlar"), cat("Kommunal (elektr, suv, gaz)")];

/**
 * Eski / qo'lda yozilgan toifa nomlari → `EXPENSE_CATEGORIES` dagi kanonik nom. Kirim-Chiqimda toifa erkin matn
 * bo'lgan davrdan "Yoqilg'i", "Avans", "Elektr energiya" kabi yozuvlar qolgan — ular o'z toifasiga qo'shilsin.
 * Kalit — kichik harf, apostrof turlari bir xil (`normCat`).
 */
const CATEGORY_ALIAS: Record<string, string> = {
  "yoqilg'i": FUEL_CATEGORY, "yoqilgi": FUEL_CATEGORY, "transport": FUEL_CATEGORY, "benzin": FUEL_CATEGORY, "dizel": FUEL_CATEGORY, "solyarka": FUEL_CATEGORY,
  "ta'mir": REPAIR_CATEGORY, "ta'mirlash": REPAIR_CATEGORY, "ehtiyot qism": REPAIR_CATEGORY, "zapchast": REPAIR_CATEGORY,
  "avans": cat("Ish haqi"), "oylik": cat("Ish haqi"), "maosh": cat("Ish haqi"),
  "elektr": cat("Kommunal (elektr, suv, gaz)"), "elektr energiya": cat("Kommunal (elektr, suv, gaz)"), "gaz": cat("Kommunal (elektr, suv, gaz)"), "suv": cat("Kommunal (elektr, suv, gaz)"), "kommunal": cat("Kommunal (elektr, suv, gaz)"),
  "soliq": cat("Soliq va to'lovlar"), "soliqlar": cat("Soliq va to'lovlar"),
  "ofis": cat("Ofis / xo'jalik"), "xo'jalik": cat("Ofis / xo'jalik"), "reklama": cat("Marketing"),
};
const normCat = (s: string) => s.trim().toLowerCase().replace(/[ʻʼ’‘`]/g, "'").replace(/\s+/g, " ");
const CANON = new Map(EXPENSE_CATEGORIES.map((c) => [normCat(c), c]));
/** Chiqim toifasining kanonik nomi: aniq moslik → alias → o'zi (yangi, ro'yxatda yo'q toifa alohida qoladi). */
export function expenseCategoryOf(raw: string): string {
  const k = normCat(raw);
  return CANON.get(k) ?? CATEGORY_ALIAS[k] ?? raw.trim();
}

/** "Byudjetdan oshdi" — bitta ta'rif (dashbord, qaror bloki, kunlik matn, byudjet sahifasi): fakt rejadan YOKI limitdan katta. 100% teng — oshmagan. */
export const isOverBudget = (fact: number, plan: number | null, limit: number | null) => (plan !== null && fact > plan) || (limit !== null && fact > limit);

/** Toifa prognozi: bir martalik oylik toifa — max(fakt, reja); kunlik toifa — `project(fakt)` (proporsional). */
export function expenseForecast(category: string, fact: number, plan: number | null, project: (fact: number) => number) {
  return MONTHLY_ONE_OFF_CATEGORIES.includes(expenseCategoryOf(category)) ? Math.max(fact, plan ?? fact) : project(fact);
}

type Sum = Map<string, number>;
const add = (m: Sum, k: string, v: number) => m.set(k, (m.get(k) ?? 0) + v);
const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

/**
 * Xarajat toifasi holati: kritik — faqat haqiqatan oshganda (`isOverBudget`); e'tibor — fakt rejaning
 * `warnPct` foiziga yetdi yoki prognoz rejadan oshadi; byudjetsiz xarajat — e'tibor.
 */
export function expenseLevel(fact: number, plan: number | null, limit: number | null, forecast: number, warnPct: number): Level {
  if (plan === null) return fact > 0 ? "warn" : "ok";
  if (isOverBudget(fact, plan, limit)) return "crit";
  return (plan > 0 && (fact / plan) * 100 >= warnPct) || forecast > plan ? "warn" : "ok";
}
/** Teskari: bajarilish foizi past bo'lsa yomon (tushum, ishlab chiqarish). */
const levelByShortfall = (pct: number | null): Level => (pct === null ? "ok" : pct >= 90 ? "ok" : pct >= 70 ? "warn" : "crit");
const worst = (...ls: Level[]): Level => (ls.includes("crit") ? "crit" : ls.includes("warn") ? "warn" : "ok");

export type Decision = { key: string; problem: string; amount: number; effect: string; owner: string; due: string; decision: string; href: string; level: Level };

export async function ownerDashboard() {
  const today = startOfDay(new Date()), tomorrow = addDays(today, 1);
  const y = today.getFullYear(), m = today.getMonth();
  const monthStart = new Date(y, m, 1), monthEnd = new Date(y, m + 1, 1), prevMonthStart = new Date(y, m - 1, 1);
  const from3 = new Date(y, m - 2, 1); // joriy + 2 oldingi oy — trend
  const from90 = addDays(today, -90);
  const daysInMonth = Math.round((monthEnd.getTime() - monthStart.getTime()) / 86400000);
  const daysPassed = Math.round((today.getTime() - monthStart.getTime()) / 86400000) + 1;
  const wdTotal = workingDays(monthStart, monthEnd), wdPassed = workingDays(monthStart, tomorrow);
  const project = (fact: number) => monthForecast(fact, today); // oy oxirigacha prognoz — BI va AI chat bilan bitta formula
  const range: Range = { period: "month", from: monthStart, to: tomorrow, prevFrom: prevMonthStart, prevTo: monthStart, days: daysPassed, label: "Joriy oy", prevLabel: "O'tgan oy" };

  const [
    company, sales90, salesPlans, budgets, txMonth, txPrev3, payMonth, pay30, allPay, allTx, accounts, recv,
    supplyOpen, receiptsMonth, prodPlans, batchesMonth, outputsMonth, ordersMonth, overdueOrders, tripsToday, tripsMonth, vehicles,
    materials, recipes, consumeMonth, loss, defectsMonth, overdueTasks, costs, matCost,
  ] = await Promise.all([
    getCompany(),
    // Tushum — yetkazilgan reyslar (realizatsiya) bo'yicha; zayavka qabul qilingani hali tushum emas
    loadRevenue(from90 < from3 ? from90 : from3, tomorrow),
    db.salesPlan.findMany({ where: { year: y, month: m + 1 } }),
    db.expenseBudget.findMany({ where: { year: y, month: m + 1 } }),
    db.cashTransaction.findMany({ where: { ...FLOW_ONLY, date: { gte: monthStart, lt: tomorrow } }, include: { cashAccount: { select: { name: true, type: true } }, supplier: { select: { name: true } }, createdBy: { select: { fullName: true, role: true } } }, orderBy: { amount: "desc" } }),
    db.cashTransaction.findMany({ where: { type: "EXPENSE", date: { gte: new Date(y, m - 3, 1), lt: monthStart } }, select: { category: true, amount: true, date: true } }),
    db.payment.findMany({ where: { date: { gte: monthStart, lt: tomorrow } }, include: { customer: { select: { name: true } }, cashAccount: { select: { name: true, type: true } } }, orderBy: { amount: "desc" } }),
    db.payment.findMany({ where: { date: { gte: addDays(today, -30), lt: tomorrow } }, select: { amount: true } }),
    db.payment.groupBy({ by: ["cashAccountId"], _sum: { amount: true } }),
    db.cashTransaction.groupBy({ by: ["cashAccountId", "type"], _sum: { amount: true } }),
    // Nofaol hisob ham olinadi: qoldig'i bor hisob yopilsa pul jami summadan "yo'qolmasin" (pastda faqat qoldig'i borlari ko'rsatiladi)
    db.cashAccount.findMany({ orderBy: { name: "asc" } }),
    // Debitorka — yagona hisob (schyotlar − barcha to'lovlar, FIFO aging), overdue chegarasi sozlamadan
    getCompany().then((c) => receivablesReport({ edges: OWNER_EDGES, overdueDays: c.overdueDays })),
    db.supplyRequest.findMany({ where: { status: { in: ["PRICED", "APPROVED"] } }, include: { items: { select: { qty: true, price: true } }, supplier: { select: { name: true } }, createdBy: { select: { fullName: true } } } }),
    db.goodsReceiptItem.findMany({ where: { receipt: { cancelledAt: null, date: { gte: monthStart, lt: tomorrow } } }, select: { qty: true, price: true, receipt: { select: { supplier: { select: { name: true } } } } } }),
    db.productionPlan.findMany({ where: { year: y, month: m + 1 }, include: { product: { select: { id: true, code: true, name: true, unit: true } } } }),
    db.productionBatch.findMany({ where: { cancelledAt: null, date: { gte: from3, lt: tomorrow } }, select: { date: true, qtyM3: true, productId: true, product: { select: { unit: true } } } }),
    db.stockMove.findMany({ where: { type: "PRODUCTION_OUTPUT", productId: { not: null }, date: { gte: monthStart, lt: tomorrow } }, select: { productId: true, qty: true, date: true } }),
    db.order.findMany({
      where: { kind: "SALE", date: { gte: monthStart, lt: tomorrow }, status: { in: ["CONFIRMED", "IN_PRODUCTION", "DELIVERED", "CLOSED"] } },
      select: { id: true, orderNo: true, status: true, deliveryDate: true, customerId: true, customer: { select: { name: true } }, items: { select: { qtyM3: true, price: true } }, invoices: { where: { status: { not: "CANCELLED" } }, select: { payments: { select: { id: true, amount: true } } } }, payments: { select: { id: true, amount: true } } },
    }),
    db.order.findMany({ where: { kind: "SALE", status: { in: ["CONFIRMED", "IN_PRODUCTION"] }, deliveryDate: { lt: today } }, select: { id: true, orderNo: true, deliveryDate: true, customer: { select: { name: true } }, items: { select: { qtyM3: true, price: true } } } }),
    db.trip.findMany({ where: { OR: [{ createdAt: { gte: today } }, { status: { in: ["LOADED", "ON_ROAD"] } }], status: { not: "CANCELLED" } }, select: { status: true, qtyM3: true, vehicleId: true, deliveredAt: true } }),
    db.trip.findMany({ where: { status: "DELIVERED", deliveredAt: { gte: monthStart, lt: tomorrow } }, select: { qtyM3: true, vehicleId: true } }),
    db.vehicle.findMany({ where: { isActive: true }, select: { id: true, plate: true, type: true, status: true, statusNote: true, statusSince: true } }),
    materialOverview(),
    db.recipe.findMany({ where: { isActive: true }, select: { productId: true, items: { select: { materialId: true, qtyPerM3: true } } } }),
    db.stockMove.groupBy({ by: ["materialId"], where: { type: "PRODUCTION_CONSUME", date: { gte: monthStart, lt: tomorrow } }, _sum: { qty: true } }),
    lossChannels(range),
    db.productDefect.findMany({ where: { date: { gte: monthStart, lt: tomorrow } }, select: { productId: true, qty: true, reason: true } }),
    db.brigadeTask.count({ where: { status: { in: ["NEW", "IN_PROGRESS"] }, dueDate: { lt: today } } }),
    productCosts(),
    materialCosts(),
  ]);
  const T = { warn: company.alertWarnPct, crit: company.alertCritPct, stockWarn: company.stockWarnDays, stockCrit: company.stockCritDays, overdue: company.overdueDays };

  /* ───────────────────────── Sotuv → tushum, tannarx, marja ───────────────────────── */
  const inMonth = (r: SaleRow) => r.date >= monthStart;
  const salesMonth = sales90.filter(inMonth), salesToday = salesMonth.filter((r) => r.date >= today);
  const rev = (rows: SaleRow[]) => sum(rows.map((r) => r.revenue)), cogsOf = (rows: SaleRow[]) => sum(rows.map((r) => r.cost));
  const revenueToday = rev(salesToday), revenueMonth = rev(salesMonth);
  const cogsToday = cogsOf(salesToday), cogsMonth = cogsOf(salesMonth);
  const companyPlanRow = salesPlans.find((p) => p.sellerId === null);
  const revenuePlan = companyPlanRow ? Number(companyPlanRow.amount) : sum(salesPlans.map((p) => Number(p.amount))) || null;
  const revenueForecast = project(revenueMonth);
  const revenuePct = revenuePlan ? (revenueMonth / revenuePlan) * 100 : null;
  const revenueExpected = revenuePlan ? (revenuePlan / wdTotal) * wdPassed : null; // shu kungacha bo'lishi kerak edi

  // Marja — mahsulot bo'yicha (asosiy yo'nalishlar)
  const byProduct = new Map<string, { code: string; name: string; unit: string; revenue: number; cost: number; qty: number }>();
  for (const r of salesMonth) {
    const cur = byProduct.get(r.productId) ?? { code: r.code, name: r.product, unit: r.unit, revenue: 0, cost: 0, qty: 0 };
    cur.revenue += r.revenue; cur.cost += r.cost; cur.qty += r.qty; byProduct.set(r.productId, cur);
  }
  const marginByProduct = [...byProduct.entries()].map(([id, p]) => ({ id, ...p, margin: safeDiv(p.revenue - p.cost, p.revenue) * 100, unitCost: costs.get(id)?.cost ?? null, price: costs.get(id)?.price ?? 0 })).sort((a, b) => b.revenue - a.revenue);
  const marginTotal = safeDiv(revenueMonth - cogsMonth, revenueMonth) * 100;

  /* ───────────────────────── Xarajatlar va byudjet ───────────────────────── */
  // Toifalar kanonik nomga keltiriladi (eski "Yoqilg'i", "Avans"… → EXPENSE_CATEGORIES); bir toifaga tushgan bir nechta byudjet qo'shiladi
  const expMonth = txMonth.filter((t) => t.type === "EXPENSE").map((t) => ({ ...t, category: expenseCategoryOf(t.category) }));
  const budgetOf = new Map<string, { amount: number; limit: number }>();
  for (const b of budgets) {
    const k = expenseCategoryOf(b.category), cur = budgetOf.get(k) ?? { amount: 0, limit: 0 };
    budgetOf.set(k, { amount: cur.amount + Number(b.amount), limit: cur.limit + Number(b.limit ?? b.amount) });
  }
  const prev3ByCat = new Map<string, Sum>(); // kategoriya → oy → summa (anomaliya uchun tarixiy norma)
  for (const t of txPrev3) { const k = expenseCategoryOf(t.category); const mm = prev3ByCat.get(k) ?? new Map(); add(mm, monthKey(t.date), Number(t.amount)); prev3ByCat.set(k, mm); }
  const categories = [...new Set([...EXPENSE_CATEGORIES, ...expMonth.map((t) => t.category), ...budgetOf.keys()])].map((cat) => {
    const rows = expMonth.filter((t) => t.category === cat);
    const month = sum(rows.map((t) => Number(t.amount))), day = sum(rows.filter((t) => t.date >= today).map((t) => Number(t.amount)));
    const b = budgetOf.get(cat);
    const plan = b ? b.amount : null, limit = b ? b.limit : null;
    const oneOff = MONTHLY_ONE_OFF_CATEGORIES.includes(cat);
    const forecast = expenseForecast(cat, month, plan, project);
    const pct = plan ? (month / plan) * 100 : null;
    const hist = prev3ByCat.get(cat); const histAvg = hist && hist.size ? sum([...hist.values()]) / hist.size : null;
    const over = isOverBudget(month, plan, limit);
    const level = expenseLevel(month, plan, limit, forecast, T.warn);
    // Kim yaratgan — eng katta yozuv egasi (javobgar)
    const top = rows[0];
    return { cat, day, month, plan, limit, deviation: plan !== null ? month - plan : null, pct, forecast, oneOff, forecastOver: plan !== null ? Math.max(0, forecast - plan) : null, over, level, unplanned: plan === null && month > 0, anomaly: histAvg !== null && histAvg > 0 && month > histAvg * 1.5, histAvg, count: rows.length, by: top ? top.createdBy.fullName : null, byRole: top ? ROLE_LABELS[top.createdBy.role] : null };
  }).sort((a, b) => b.month - a.month);
  const expenseMonth = sum(categories.map((c) => c.month)), expenseToday = sum(categories.map((c) => c.day));
  const expensePlan = budgetOf.size ? sum([...budgetOf.values()].map((b) => b.amount)) : null;
  const expenseForecastTotal = sum(categories.map((c) => c.forecast));
  const opexMonth = expenseMonth - (categories.find((c) => c.cat === COGS_CATEGORY)?.month ?? 0); // xomashyo tannarxda — operatsionga kirmaydi
  const opexToday = expenseToday - (categories.find((c) => c.cat === COGS_CATEGORY)?.day ?? 0);
  const cogsBudget = budgetOf.get(COGS_CATEGORY)?.amount ?? null;
  const opexPlan = expensePlan !== null ? expensePlan - (cogsBudget ?? 0) : null;
  const overspent = categories.filter((c) => c.over);
  const unplanned = categories.filter((c) => c.unplanned);
  const anomalies = categories.filter((c) => c.anomaly);
  const top10 = expMonth.slice(0, 10).map((t) => ({ id: t.id, date: t.date, category: t.category, amount: Number(t.amount), who: t.supplier?.name ?? t.counterparty ?? "—", by: t.createdBy.fullName, account: t.cashAccount.name, note: t.note, href: t.refType === "GoodsReceipt" && t.refId ? `/receipts/${t.refId}` : `/cashflow?tab=EXPENSE&category=${encodeURIComponent(t.category)}` }));
  // Takroriy to'lov: bir kunda bir kontragentga bir xil summa ikki marta
  const dupKey = new Map<string, number>();
  for (const t of expMonth) add(dupKey, `${t.supplierId ?? t.counterparty ?? "?"}|${Number(t.amount)}|${startOfDay(t.date).getTime()}`, 1);
  const duplicates = expMonth.filter((t) => (dupKey.get(`${t.supplierId ?? t.counterparty ?? "?"}|${Number(t.amount)}|${startOfDay(t.date).getTime()}`) ?? 0) > 1);
  const duplicateSum = sum(duplicates.map((t) => Number(t.amount))) / 2;

  /* ───────────────────────── Foyda ───────────────────────── */
  const grossToday = revenueToday - cogsToday, grossMonth = revenueMonth - cogsMonth;
  const netToday = grossToday - opexToday, netMonth = grossMonth - opexMonth;
  // Foyda rejasi faqat REJALARDAN: sotuv plani − xomashyo byudjeti − operatsion byudjet. Ilgari tannarx rejasi
  // joriy faktdagi tannarx ulushidan olinardi — fakt yomonlashsa reja ham "yomonlashib", manfiy reja chiqardi.
  // Xomashyo byudjeti kiritilmagan bo'lsa yoki natija ≤ 0 bo'lsa (reja to'liq/izchil emas) — reja ko'rsatilmaydi.
  const cogsPlan = revenuePlan !== null ? cogsBudget : null;
  const grossPlanRaw = revenuePlan !== null && cogsPlan !== null ? revenuePlan - cogsPlan : null;
  const netPlanRaw = grossPlanRaw !== null && opexPlan !== null ? grossPlanRaw - opexPlan : null;
  const grossPlan = grossPlanRaw !== null && grossPlanRaw > 0 ? grossPlanRaw : null;
  const netPlan = netPlanRaw !== null && netPlanRaw > 0 ? netPlanRaw : null;
  const profitPlanNote = revenuePlan === null ? "Sotuv plani kiritilmagan" : cogsPlan === null ? "Xomashyo byudjeti kiritilmagan — foyda rejasi hisoblanmaydi" : netPlanRaw !== null && netPlanRaw <= 0 ? "Byudjet sotuv planidan katta — foyda rejasi izchil emas" : null;
  // Sof foyda prognozi = tushum prognozi − tannarx (joriy ulushda) − xarajat prognozi (toifa qoidalari bilan)
  const netForecast = revenueForecast - project(cogsMonth) - (expenseForecastTotal - (categories.find((c) => c.cat === COGS_CATEGORY)?.forecast ?? 0));
  const profitTable = [
    { key: "revenue", label: "Tushum", today: revenueToday, month: revenueMonth, plan: revenuePlan, invert: false },
    { key: "cogs", label: "Tannarx (xomashyo, retsept bo'yicha; reja — xomashyo byudjeti)", today: cogsToday, month: cogsMonth, plan: cogsPlan, invert: true },
    { key: "gross", label: "Yalpi foyda", today: grossToday, month: grossMonth, plan: grossPlan, invert: false },
    { key: "opex", label: "Operatsion xarajatlar", today: opexToday, month: opexMonth, plan: opexPlan, invert: true },
    { key: "net", label: "Sof foyda", today: netToday, month: netMonth, plan: netPlan, invert: false },
  ].map((r) => ({ ...r, deviation: r.plan !== null ? r.month - r.plan : null, pct: r.plan ? (r.month / r.plan) * 100 : null }));
  const marginPlan = revenuePlan && netPlan !== null ? (netPlan / revenuePlan) * 100 : null;

  /* ───────────────────────── Pul va cash flow ───────────────────────── */
  const bal = new Map<string, number>();
  for (const p of allPay) add(bal, p.cashAccountId, Number(p._sum.amount ?? 0));
  for (const t of allTx) add(bal, t.cashAccountId, txSign(t.type) * Number(t._sum.amount ?? 0));
  const accountRows = accounts.map((a) => ({ id: a.id, name: a.name, type: a.type, isActive: a.isActive, balance: bal.get(a.id) ?? 0 })).filter((a) => a.isActive || Math.abs(a.balance) >= 1);
  const cashTotal = sum(accountRows.map((a) => a.balance));
  const cashOnHand = sum(accountRows.filter((a) => a.type === "CASH").map((a) => a.balance)), bankTotal = cashTotal - cashOnHand;
  const payToday = payMonth.filter((p) => p.date >= today), incToday = txMonth.filter((t) => t.type === "INCOME" && t.date >= today);
  const inToday = sum(payToday.map((p) => Number(p.amount))) + sum(incToday.map((t) => Number(t.amount)));
  const outToday = expenseToday;
  const startOfDayBalance = cashTotal - inToday + outToday;
  const avgDailyIn = sum(pay30.map((p) => Number(p.amount))) / 30;
  const avgDailyOut = daysPassed > 0 ? expenseMonth / daysPassed : 0;
  // Yaqin to'lovlar: tasdiqlangan (moliya kutayotgan) ta'minot zayavkalari — needBy bo'yicha
  const supplyRows = supplyOpen.map((s) => ({ id: s.id, docNo: s.docNo, supplier: s.supplier?.name ?? "—", amount: sum(s.items.map((i) => Number(i.qty) * Number(i.price))) + Number(s.deliveryCost), needBy: s.needBy, status: s.status, by: s.createdBy.fullName, overdue: !!s.needBy && s.needBy < today }));
  const committed = supplyRows.filter((s) => s.status === "APPROVED");
  const plannedWithin = (days: number) => sum(committed.filter((s) => !s.needBy || s.needBy < addDays(today, days)).map((s) => s.amount));
  const planned = { d7: plannedWithin(7), d14: plannedWithin(14), d30: plannedWithin(30), rows: [...supplyRows].sort((a, b) => (a.needBy?.getTime() ?? 0) - (b.needBy?.getTime() ?? 0)) };
  // Kassa uzilishi prognozi: qoldiq + o'rtacha tushum×kun − o'rtacha chiqim×kun − yaqin to'lovlar
  const gap = [7, 14, 30].map((d) => ({ days: d, balance: cashTotal + avgDailyIn * d - avgDailyOut * d - plannedWithin(d) }));
  const gapDay = gap.find((g) => g.balance < 0)?.days ?? null;
  const topIn = payMonth.slice(0, 5).map((p) => ({ id: p.id, date: p.date, who: p.customer.name, amount: Number(p.amount), account: p.cashAccount.name, href: `/customers/${p.customerId}` }));

  /* ───────────────────────── Debitorka / kreditorka ───────────────────────── */
  // Yagona debitorka (receivables.ts): mijoz balansi, to'lovlar FIFO bilan eng eski schyotlarga taqsimlangan
  const aging = recv.buckets; // 0–7 / 8–30 / 31–60 / 60+
  const debtByCustomer = new Map(recv.rows.map((r) => [r.customerId, { id: r.customerId, name: r.name, debt: r.debt, overdue: r.overdue, oldest: r.oldestDays ?? 0 }]));
  const receivable = recv.total, overdueReceivable = recv.overdue;
  const topDebtors = [...debtByCustomer.values()].sort((a, b) => b.debt - a.debt).slice(0, 10);
  const payableTotal = sum(committed.map((s) => s.amount)), payableOverdue = sum(committed.filter((s) => s.overdue).map((s) => s.amount));
  const bySupplier = new Map<string, number>();
  for (const i of receiptsMonth) add(bySupplier, i.receipt.supplier.name, Number(i.qty) * Number(i.price));
  const topSuppliers = [...bySupplier.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 5);

  /* ───────────────────────── Ishlab chiqarish ───────────────────────── */
  const outByProduct: Sum = new Map(), outTodayByProduct: Sum = new Map();
  for (const o of outputsMonth) { add(outByProduct, o.productId!, Number(o.qty)); if (o.date >= today) add(outTodayByProduct, o.productId!, Number(o.qty)); }
  const concreteMonth = sum(batchesMonth.filter((b) => b.date >= monthStart && b.product.unit === "m3").map((b) => Number(b.qtyM3)));
  const concreteToday = sum(batchesMonth.filter((b) => b.date >= today && b.product.unit === "m3").map((b) => Number(b.qtyM3)));
  const concretePlan = sum(prodPlans.filter((p) => p.product.unit === "m3").map((p) => Number(p.monthQty))) || null;
  const planRows = prodPlans.map((p) => {
    const plan = Number(p.monthQty), fact = outByProduct.get(p.productId) ?? 0;
    const dayPlan = p.dayQty !== null ? Number(p.dayQty) : wdTotal ? plan / wdTotal : 0;
    const expected = Math.min(plan, dayPlan * wdPassed);
    return { id: p.productId, code: p.product.code, name: p.product.name, unit: p.product.unit, plan, fact, factDay: outTodayByProduct.get(p.productId) ?? 0, dayPlan, pct: plan ? (fact / plan) * 100 : null, behind: Math.max(0, expected - fact), level: levelByShortfall(expected > 0 ? (fact / expected) * 100 : null) };
  }).sort((a, b) => a.code.localeCompare(b.code));
  const piecesPlan = planRows.filter((r) => r.unit !== "m3");
  const capacity = company.dailyCapacityM3 ? Number(company.dailyCapacityM3) : null;
  const capacityPct = capacity ? (concreteToday / capacity) * 100 : null;
  // Xomashyo sarfi normadan chetlanishi: fakt (PRODUCTION_CONSUME) vs retsept × ishlab chiqarilgan
  const normNeed: Sum = new Map();
  const recipeOf = new Map(recipes.map((r) => [r.productId, r.items]));
  for (const b of batchesMonth.filter((x) => x.date >= monthStart)) for (const i of recipeOf.get(b.productId) ?? []) if (i.materialId) add(normNeed, i.materialId, Number(i.qtyPerM3) * Number(b.qtyM3));
  const consumed = new Map(consumeMonth.map((c) => [c.materialId as string, -Number(c._sum.qty ?? 0)]));
  const normRows = [...normNeed.entries()].map(([id, norm]) => { const fact = consumed.get(id) ?? 0; const mat = materials.find((x) => x.id === id); return { id, name: mat?.name ?? "?", unit: mat?.unit ?? "", norm, fact, dev: fact - norm, devPct: norm > 0 ? ((fact - norm) / norm) * 100 : 0, cost: Math.max(0, fact - norm) * (matCost.get(id) ?? 0) }; }).filter((r) => r.norm > 0);
  const materialOverspend = sum(normRows.map((r) => r.cost));

  /* ───────────────────────── Otgruzka va voronka ───────────────────────── */
  const orderSum = (o: { items: { qtyM3: unknown; price: unknown }[] }) => sum(o.items.map((i) => Number(i.qtyM3) * Number(i.price)));
  const orderPaid = (o: { invoices: { payments: { id: string; amount: unknown }[] }[]; payments: { id: string; amount: unknown }[] }) => { const seen = new Map<string, number>(); for (const p of [...o.payments, ...o.invoices.flatMap((i) => i.payments)]) seen.set(p.id, Number(p.amount)); return sum([...seen.values()]); };
  const stage = (statuses: string[]) => { const rows = ordersMonth.filter((o) => statuses.includes(o.status)); return { count: rows.length, sum: sum(rows.map(orderSum)) }; };
  const paidOrders = ordersMonth.filter((o) => { const s = orderSum(o); return s > 0 && orderPaid(o) >= s - 1; });
  const funnel = [
    { key: "order", label: "Zayavka", ...stage(["CONFIRMED", "IN_PRODUCTION", "DELIVERED", "CLOSED"]), href: "/sales" },
    { key: "production", label: "Ishlab chiqarishda", ...stage(["IN_PRODUCTION"]), href: "/sales?status=IN_PRODUCTION" },
    { key: "ready", label: "Yetkazildi", ...stage(["DELIVERED", "CLOSED"]), href: "/sales?status=DELIVERED" },
    { key: "closed", label: "Yopildi", ...stage(["CLOSED"]), href: "/sales?status=CLOSED" },
    { key: "paid", label: "To'landi", count: paidOrders.length, sum: sum(paidOrders.map(orderSum)), href: "/customers" },
  ];
  const unpaidShipments = ordersMonth.filter((o) => ["DELIVERED", "CLOSED"].includes(o.status) && orderPaid(o) < orderSum(o) - 1).map((o) => ({ id: o.id, orderNo: o.orderNo, customer: o.customer.name, customerId: o.customerId, left: orderSum(o) - orderPaid(o) }));
  const stuck = overdueOrders.map((o) => ({ id: o.id, orderNo: o.orderNo, customer: o.customer.name, deliveryDate: o.deliveryDate, sum: orderSum(o), days: Math.floor((today.getTime() - startOfDay(o.deliveryDate).getTime()) / 86400000) }));
  const shippedToday = sum(tripsToday.filter((t) => t.status === "DELIVERED" && t.deliveredAt && t.deliveredAt >= today).map((t) => Number(t.qtyM3)));
  const shippedMonth = sum(tripsMonth.map((t) => Number(t.qtyM3)));
  const soldM3Month = sum(salesMonth.filter((r) => r.unit === "m3").map((r) => r.qty)); // otgruzka plani = sotilgan hajm

  /* ───────────────────────── Sklad ───────────────────────── */
  const stockRows = materials.map((mt) => ({
    id: mt.id, name: mt.name, unit: mt.unit, balance: mt.balance, value: mt.value, perDay: mt.perDay, days: mt.days, minStock: mt.minStock, short: mt.short,
    level: (mt.short || (mt.days !== null && mt.days < T.stockCrit) ? "crit" : mt.balance < mt.minStock || (mt.days !== null && mt.days < T.stockWarn) ? "warn" : "ok") as Level,
    normDev: normRows.find((n) => n.id === mt.id)?.devPct ?? null,
  })).sort((a, b) => (a.days ?? 9999) - (b.days ?? 9999));
  const stockValue = sum(stockRows.map((r) => r.value));
  const stockCritical = stockRows.filter((r) => r.level === "crit");
  const minDays = stockRows.reduce<{ name: string; days: number } | null>((acc, r) => (r.days !== null && (!acc || r.days < acc.days) ? { name: r.name, days: r.days } : acc), null);

  /* ───────────────────────── Transport ───────────────────────── */
  const onTrip = new Set(tripsToday.filter((t) => ["LOADED", "ON_ROAD"].includes(t.status)).map((t) => t.vehicleId));
  const fuel = categories.find((c) => c.cat === FUEL_CATEGORY), repair = categories.find((c) => c.cat === REPAIR_CATEGORY);
  const transport = {
    total: vehicles.length, working: vehicles.filter((v) => v.status === "ACTIVE" && onTrip.has(v.id)).length, free: vehicles.filter((v) => v.status === "ACTIVE" && !onTrip.has(v.id)).length,
    repair: vehicles.filter((v) => v.status === "REPAIR"), idle: vehicles.filter((v) => v.status === "IDLE"),
    tripsToday: tripsToday.filter((t) => t.deliveredAt ? t.deliveredAt >= today : true).length, tripsMonth: tripsMonth.length,
    avgM3: tripsMonth.length ? shippedMonth / tripsMonth.length : 0,
    fuelFact: fuel?.month ?? 0, fuelNorm: fuel?.plan ?? null, fuelOver: fuel?.deviation !== null && fuel?.deviation !== undefined ? Math.max(0, fuel.deviation) : 0,
    repairFact: repair?.month ?? 0,
    idleDays: sum(vehicles.filter((v) => v.status !== "ACTIVE").map((v) => v.statusSince ? Math.max(1, Math.floor((today.getTime() - startOfDay(v.statusSince).getTime()) / 86400000) + 1) : 1)),
  };

  /* ───────────────────────── Pul oqib ketishi: yo'qotish (fakt) va xavf (muzlagan pul) ───────────────────────── */
  // Ikki xil narsa bitta "Jami" ga qo'shilmaydi: yo'qotish — pul allaqachon ketdi (qaytmaydi);
  // xavf — pul hali bizniki, lekin muzlagan yoki ketish xavfi bor (debitorka, yetishmayotgan xomashyo, bekor texnika).
  const defectValue = sum(defectsMonth.map((d) => Number(d.qty) * (costs.get(d.productId)?.cost ?? costs.get(d.productId)?.price ?? 0)));
  type Leak = { key: string; title: string; amount: number; text: string; href: string; level: Level };
  const leakLoss: Leak[] = [
    { key: "defect", title: "Brak", amount: defectValue, text: defectsMonth.length ? `${defectsMonth.length} ta yozuv · ${fq(sum(defectsMonth.map((d) => Number(d.qty))))} birlik (tannarxda)` : "Brak yo'q", href: "/dashboard?view=production", level: defectValue > 0 ? "warn" : "ok" },
    { key: "material", title: "Xomashyo ortiqcha sarfi", amount: materialOverspend, text: normRows.filter((r) => r.dev > 0).map((r) => `${r.name} +${fq(r.dev)} ${r.unit}`).join(", ") || "Norma ichida", href: "/stock", level: materialOverspend > 0 ? "warn" : "ok" },
    { key: "fuel", title: "Yoqilg'i normadan (byudjetdan) ortig'i", amount: transport.fuelOver, text: fuel?.plan ? `Fakt ${moneyShort(fuel.month)} / norma ${moneyShort(fuel.plan)}` : "Yoqilg'i normasi (byudjeti) belgilanmagan", href: `/cashflow?tab=EXPENSE&category=${encodeURIComponent(FUEL_CATEGORY)}`, level: transport.fuelOver > 0 ? "warn" : "ok" },
    { key: "dup", title: "Takroriy to'lov", amount: duplicateSum, text: duplicates.length ? `${duplicates.length} ta bir xil yozuv (kontragent, summa, kun)` : "Topilmadi", href: "/cashflow?tab=EXPENSE", level: duplicateSum > 0 ? "crit" : "ok" },
  ];
  // Bekor texnika so'mda baholanmaydi: ilgari "oylik tushum ÷ kun ÷ texnika soni" uydirma stavka bilan pulga aylantirilardi —
  // texnika-kun (aniq fakt) ko'rsatiladi, summaga qo'shilmaydi
  const leakRisk: (Omit<Leak, "amount"> & { amount: number | null })[] = [
    { key: "stockout", title: "Xomashyo yetishmasligi (to'xtash xavfi)", amount: loss.stockout.value, text: loss.stockout.count ? `${loss.stockout.count} ta xomashyo tasdiqlangan zayavkalarga yetmaydi — yetishmayotgan qism qiymati` : "Yetarli", href: "/stock", level: loss.stockout.count ? "crit" : "ok" },
    { key: "overdue", title: "Muddati o'tgan debitorka", amount: overdueReceivable, text: `${[...debtByCustomer.values()].filter((c) => c.overdue > 0).length} mijoz · ${T.overdue} kundan eski schyotlar`, href: "/customers", level: overdueReceivable > 0 ? "crit" : "ok" },
    { key: "idle", title: "Bekor turgan texnika", amount: null, text: transport.repair.length + transport.idle.length ? `${transport.repair.length} ta'mirda, ${transport.idle.length} bekor · ${transport.idleDays} texnika-kun` : "Hamma texnika safda", href: "/drivers", level: transport.repair.length + transport.idle.length > 0 ? "warn" : "ok" },
  ];
  leakLoss.sort((a, b) => b.amount - a.amount);
  leakRisk.sort((a, b) => (b.amount ?? -1) - (a.amount ?? -1));
  const leakLossTotal = sum(leakLoss.map((l) => l.amount)), leakRiskTotal = sum(leakRisk.map((l) => l.amount ?? 0));

  /* ───────────────────────── Trend: 3 oy va 30/60/90 kun ───────────────────────── */
  const months = [2, 1, 0].map((k) => { const s = new Date(y, m - k, 1), e = new Date(y, m - k + 1, 1); return { key: monthKey(s), label: MONTHS_SHORT[s.getMonth()], s, e }; });
  const trend = months.map(({ key, label, s, e }) => {
    const rows = sales90.filter((r) => r.date >= s && r.date < e);
    const r = rev(rows), c = cogsOf(rows);
    const opex = key === monthKey(monthStart) ? opexMonth : sum(txPrev3.filter((t) => t.date >= s && t.date < e && t.category !== COGS_CATEGORY).map((t) => Number(t.amount)));
    return { key, label, revenue: r, profit: r - c - opex, expenses: c + opex, production: sum(batchesMonth.filter((b) => b.date >= s && b.date < e && b.product.unit === "m3").map((b) => Number(b.qtyM3))) };
  });
  const dyn = [30, 60, 90].map((d) => { const cur = rev(sales90.filter((r) => r.date >= addDays(today, -d))); const prev = rev(sales90.filter((r) => r.date >= addDays(today, -2 * d) && r.date < addDays(today, -d))); return { days: d, revenue: cur, delta: prev > 0 ? ((cur - prev) / prev) * 100 : null }; });

  /* ───────────────────────── Holatlar (yuqori panel) ───────────────────────── */
  const levels = {
    revenue: levelByShortfall(revenueExpected ? (revenueMonth / revenueExpected) * 100 : null),
    profit: netMonth < 0 ? "crit" as Level : netPlan ? levelByShortfall((netMonth / (netPlan / wdTotal * wdPassed)) * 100) : "ok" as Level,
    expenses: worst(...categories.map((c) => c.level)),
    cash: gapDay !== null ? (gapDay <= 7 ? "crit" : "warn") as Level : "ok" as Level,
    receivable: overdueReceivable > 0 ? (revenueMonth > 0 && overdueReceivable > revenueMonth * 0.3 ? "crit" : "warn") as Level : "ok" as Level,
    payable: payableOverdue > 0 ? "warn" as Level : "ok" as Level,
    production: worst(...planRows.map((r) => r.level)),
    stock: worst(...stockRows.map((r) => r.level)),
    transport: transport.repair.length ? "warn" as Level : "ok" as Level,
  };

  /* ───────────────────────── Egasi qarori kerak ───────────────────────── */
  const decisions: Decision[] = [];
  if (materialOverspend > 0) decisions.push({ key: "material", problem: "Xomashyo normadan ortiq sarflandi", amount: materialOverspend, effect: `Foydaga −${moneyShort(materialOverspend)}`, owner: ROLE_LABELS.PRODUCTION, due: "3 kun", decision: `Retsept va tarozini tekshirish: ${normRows.filter((r) => r.dev > 0).slice(0, 3).map((r) => r.name).join(", ")}`, href: "/stock", level: "warn" });
  if (gapDay !== null) decisions.push({ key: "gap", problem: `Kassa uzilishi xavfi — ${gapDay} kun ichida`, amount: -Math.min(...gap.map((g) => g.balance)), effect: `Qoldiq ${gapDay} kunda ${moneyShort(gap.find((g) => g.days === gapDay)!.balance)}`, owner: ROLE_LABELS.FINANCE, due: "bugun", decision: "Debitorkani undirish rejasi yoki to'lovlarni kechiktirish / kredit liniyasi", href: "/cashflow", level: "crit" });
  for (const c of topDebtors.filter((d) => d.overdue > 0).slice(0, 2)) decisions.push({ key: `debt-${c.id}`, problem: `Katta muddati o'tgan qarz — ${c.name}`, amount: c.overdue, effect: `${c.oldest} kun · pul muzlagan`, owner: ROLE_LABELS.SALES, due: "7 kun", decision: "Undirish rejasi: qo'ng'iroq → yozma talab → yetkazishni to'xtatish", href: `/customers/${c.id}`, level: c.oldest > T.overdue * 2 ? "crit" : "warn" });
  for (const v of transport.repair) decisions.push({ key: `repair-${v.id}`, problem: `Texnika ta'mirda — ${v.plate}`, amount: 0, effect: `${v.statusSince ? Math.max(1, Math.floor((today.getTime() - startOfDay(v.statusSince).getTime()) / 86400000) + 1) : 1} kun · ${v.statusNote ?? "sabab yozilmagan"}`, owner: ROLE_LABELS.LOGISTICS, due: "3 kun", decision: "Ta'mir smetasini tasdiqlash yoki ijaraga texnika olish", href: "/drivers", level: "warn" });
  for (const c of unplanned.slice(0, 2)) decisions.push({ key: `unplanned-${c.cat}`, problem: `Rejalashtirilmagan xarajat — ${c.cat}`, amount: c.month, effect: `${c.count} ta yozuv · ${c.by ?? "—"}`, owner: c.byRole ?? ROLE_LABELS.ACCOUNTING, due: "7 kun", decision: "Byudjet belgilash yoki xarajatni to'xtatish", href: "/dashboard/byudjet", level: "warn" });
  for (const c of overspent.slice(0, 2)) decisions.push({ key: `over-${c.cat}`, problem: `Byudjet oshdi — ${c.cat}`, amount: Math.max(0, c.deviation ?? 0), effect: `${Math.round(c.pct ?? 0)}% · prognoz ${moneyShort(c.forecast)}`, owner: c.byRole ?? ROLE_LABELS.ACCOUNTING, due: "bugun", decision: "Xarajatni muzlatish yoki byudjetni qayta ko'rib chiqish", href: `/cashflow?tab=EXPENSE&category=${encodeURIComponent(c.cat)}`, level: "crit" });
  if (stockCritical.length) decisions.push({ key: "stock", problem: `Xomashyo tugash arafasida — ${stockCritical.slice(0, 3).map((s) => s.name).join(", ")}`, amount: loss.stockout.value, effect: minDays ? `${minDays.name}: ${minDays.days.toFixed(1)} kun` : "", owner: ROLE_LABELS.WAREHOUSE, due: "bugun", decision: "Ta'minot zayavkasini tasdiqlash va to'lash", href: "/taminot", level: "crit" });
  if (duplicateSum > 0) decisions.push({ key: "dup", problem: "Takroriy to'lov shubhasi", amount: duplicateSum, effect: `${duplicates.length} ta yozuv`, owner: ROLE_LABELS.ACCOUNTING, due: "bugun", decision: "Yozuvlarni tekshirish, ortiqchasini qaytarish", href: "/cashflow?tab=EXPENSE", level: "crit" });
  decisions.sort((a, b) => (a.level === b.level ? b.amount - a.amount : a.level === "crit" ? -1 : 1));

  // Yuqori paneldagi 3–5 muammo
  const problems = decisions.slice(0, 5).map((d) => ({ key: d.key, text: d.problem, amount: d.amount, level: d.level, href: d.href }));

  /* ───────────────────────── Direktor nazorati ───────────────────────── */
  const directorControl = [
    { label: "Tushum", plan: revenuePlan, fact: revenueMonth, unit: "so'm", pct: revenuePct, level: levels.revenue, href: "/bi-tahlil/reja" },
    { label: "Foyda (sof)", plan: netPlan, fact: netMonth, unit: "so'm", pct: netPlan ? (netMonth / netPlan) * 100 : null, level: levels.profit, href: "/bi-tahlil/moliya" },
    { label: "Xarajat", plan: expensePlan, fact: expenseMonth, unit: "so'm", pct: expensePlan ? (expenseMonth / expensePlan) * 100 : null, level: levels.expenses, href: "/dashboard/byudjet", invert: true },
    { label: "Ishlab chiqarish (beton)", plan: concretePlan, fact: concreteMonth, unit: "m³", pct: concretePlan ? (concreteMonth / concretePlan) * 100 : null, level: levels.production, href: "/dashboard?view=production" },
    { label: "Otgruzka (beton)", plan: soldM3Month || null, fact: shippedMonth, unit: "m³", pct: soldM3Month ? (shippedMonth / soldM3Month) * 100 : null, level: levelByShortfall(soldM3Month ? (shippedMonth / soldM3Month) * 100 : null), href: "/trips" },
    { label: "Debitorka (muddati o'tgan)", plan: 0, fact: overdueReceivable, unit: "so'm", pct: null, level: levels.receivable, href: "/customers", invert: true },
    { label: "Brak", plan: 0, fact: defectValue, unit: "so'm", pct: null, level: (defectValue > 0 ? "warn" : "ok") as Level, href: "/dashboard?view=production", invert: true },
    { label: "Texnika bekor turishi", plan: 0, fact: transport.idleDays, unit: "texnika-kun", pct: null, level: levels.transport, href: "/drivers", invert: true },
    { label: "Kechikkan topshiriq / zayavka", plan: 0, fact: overdueTasks + stuck.length, unit: "ta", pct: null, level: (overdueTasks + stuck.length > 0 ? "warn" : "ok") as Level, href: "/tasks", invert: true },
  ];

  /* ───────────────────────── Kunlik hisobot matni (TZ §21) ───────────────────────── */
  const overList = overspent.map((c) => `${c.cat.toLowerCase()} +${moneyShort(c.deviation!)}`).join(", ");
  const reportText = [
    `Tushum: ${moneyShort(revenueToday)} so'm (oyda ${moneyShort(revenueMonth)}${revenuePlan ? `, plan ${moneyShort(revenuePlan)} — ${Math.round(revenuePct ?? 0)}%` : ""}).`,
    `Xarajatlar: ${moneyShort(expenseToday)} so'm (oyda ${moneyShort(expenseMonth)}). Sof natija oyda: ${moneyShort(netMonth)} so'm.`,
    `Pul: ${moneyShort(cashTotal)} so'm (kassa ${moneyShort(cashOnHand)}, bank ${moneyShort(bankTotal)}).`,
    `Debitorka: ${moneyShort(receivable)} so'm, shundan muddati o'tgan ${moneyShort(overdueReceivable)}.`,
    `Ishlab chiqarish: beton ${fq(concreteToday)} m³ bugun${concretePlan ? `, oyda ${fq(concreteMonth)} / ${fq(concretePlan)} m³` : ""}${piecesPlan.length ? `; ${piecesPlan.map((p) => `${p.code} ${fq(p.fact)}/${fq(p.plan)} ${unitLabel(p.unit)}`).join(", ")}` : ""}.`,
    overList ? `Byudjetdan oshgan: ${overList}.` : "Byudjetdan oshgan xarajat yo'q.",
    minDays ? `Asosiy xavf: ${minDays.name} zaxirasi ${minDays.days.toFixed(1)} kun.` : "",
    decisions.length ? `Qaror kerak: ${decisions.slice(0, 2).map((d) => d.problem.toLowerCase()).join("; ")}.` : "Egasi qarorini talab qiladigan masala yo'q.",
  ].filter(Boolean).join(" ");

  return {
    today, monthStart, daysPassed, daysInMonth, wdPassed, wdTotal, thresholds: T, levels, problems, reportText,
    summary: {
      revenue: { today: revenueToday, month: revenueMonth, plan: revenuePlan, forecast: revenueForecast, pct: revenuePct, expected: revenueExpected },
      profit: { today: netToday, month: netMonth, plan: netPlan, forecast: netForecast, gross: grossMonth },
      expenses: { today: expenseToday, month: expenseMonth, plan: expensePlan, deviation: expensePlan !== null ? expenseMonth - expensePlan : null, ratio: safeDiv(expenseMonth, revenueMonth) * 100 },
      cash: { total: cashTotal, cash: cashOnHand, bank: bankTotal, gapDay },
      receivable: { total: receivable, overdue: overdueReceivable, debtors: debtByCustomer.size },
      payable: { total: payableTotal, overdue: payableOverdue, d7: planned.d7 },
      production: { concreteToday, concreteMonth, concretePlan, pieces: piecesPlan, capacityPct },
      shipment: { today: shippedToday, month: shippedMonth, plan: soldM3Month, tripsToday: transport.tripsToday },
      margin: { total: marginTotal, plan: marginPlan, byProduct: marginByProduct.slice(0, 4) },
    },
    cashflow: { startOfDay: startOfDayBalance, inToday, outToday, endOfDay: cashTotal, accounts: accountRows, planned, gap, avgDailyIn, avgDailyOut, topIn, topOut: top10.slice(0, 5) },
    profitTable, marginTotal, marginPlan, profitPlanNote,
    expenses: { categories, total: expenseMonth, plan: expensePlan, ratio: safeDiv(expenseMonth, revenueMonth) * 100, top10, unplanned, anomalies, overspent, forecast: expenseForecastTotal, duplicates: duplicates.length, duplicateSum },
    production: { concrete: { plan: concretePlan, fact: concreteMonth, today: concreteToday, dev: concretePlan !== null ? concreteMonth - concretePlan : null }, rows: planRows, capacityPct, capacity, unitCosts: marginByProduct, norm: normRows, materialOverspend },
    funnel: { stages: funnel, stuck, unpaidShipments },
    debt: { receivable, overdue: overdueReceivable, aging, topDebtors, payable: { total: payableTotal, overdue: payableOverdue, rows: planned.rows }, topSuppliers },
    stock: { rows: stockRows, value: stockValue, critical: stockCritical, minDays },
    transport,
    leaks: { loss: leakLoss, lossTotal: leakLossTotal, risk: leakRisk, riskTotal: leakRiskTotal },
    directorControl,
    decisions,
    trend, dyn,
  };
}

export type OwnerDashboard = Awaited<ReturnType<typeof ownerDashboard>>;

/* ───────────────────────── Direktor tasdig'ini kutayotganlar ───────────────────────── */

export type QueueOrder = {
  id: string; orderNo: string; date: Date; deliveryDate: Date; customerId: string; customer: string; seller: string; amount: number;
  limit: number; used: number; free: number;
  /** Mijoz holati yaxshilangan (to'lov qildi, limit oshirildi): zayavka hozir qabul qilinsa bloklanmaydi */
  fitsNow: boolean;
};
export type QueueSupply = { id: string; docNo: string; supplier: string; by: string; amount: number; needBy: Date | null; createdAt: Date };

/**
 * Direktor bosh sahifasidagi "Sizning tasdig'ingiz kutilmoqda" navbati:
 *   · BLOCKED zayavkalar — kredit limiti yetmagan; yonida mijozning hozirgi limit holati;
 *   · katta xarid — narx qo'yilgan (PRICED), summasi `supplyDirectorLimit` dan katta, direktor hali tasdiqlamagan.
 * Kredit holati `customersCredit` dan faqat O'QILADI (hisob qoidasi `lib/finance.ts` da). "Limit endi yetadi"
 * sharti zayavka qabul qilishdagi bilan bir xil (`lib/orders.ts`): max(0, net) + summa ≤ limit YOKI net + summa ≤ limit.
 */
export async function directorQueue() {
  const company = await getCompany();
  const limit = Number(company.supplyDirectorLimit);
  const [blocked, priced] = await Promise.all([
    db.order.findMany({
      where: { kind: "SALE", status: "BLOCKED" }, orderBy: { date: "asc" }, take: 50,
      select: { id: true, orderNo: true, date: true, deliveryDate: true, customerId: true, customer: { select: { name: true } }, createdBy: { select: { fullName: true } }, items: { select: { qtyM3: true, price: true } } },
    }),
    limit > 0
      ? db.supplyRequest.findMany({
        where: { status: "PRICED", directorOkAt: null }, orderBy: { createdAt: "asc" },
        select: { id: true, docNo: true, needBy: true, createdAt: true, deliveryCost: true, items: { select: { qty: true, price: true } }, supplier: { select: { name: true } }, createdBy: { select: { fullName: true } } },
      })
      : Promise.resolve([]),
  ]);
  const credit = blocked.length ? await customersCredit([...new Set(blocked.map((o) => o.customerId))], { includeInternal: true }) : new Map<string, CustomerCredit>();
  const orders: QueueOrder[] = blocked.map((o) => {
    const amount = sum(o.items.map((i) => Number(i.qtyM3) * Number(i.price)));
    const c = credit.get(o.customerId);
    const fitsNow = !!c && !(Math.max(0, c.net) + amount > c.limit && c.net + amount > c.limit);
    return { id: o.id, orderNo: o.orderNo, date: o.date, deliveryDate: o.deliveryDate, customerId: o.customerId, customer: o.customer.name, seller: o.createdBy.fullName, amount, limit: c?.limit ?? 0, used: c?.used ?? 0, free: c?.free ?? 0, fitsNow };
  });
  const supply: QueueSupply[] = priced
    .map((r) => ({ id: r.id, docNo: r.docNo, supplier: r.supplier?.name ?? "—", by: r.createdBy.fullName, amount: totalPlanned(r), needBy: r.needBy, createdAt: r.createdAt }))
    .filter((r) => needsDirector(r.amount, limit));
  return { orders, supply, limit, total: orders.length + supply.length };
}
export type DirectorQueue = Awaited<ReturnType<typeof directorQueue>>;
