import { db } from "@/lib/db";
import { loadRevenue } from "@/lib/bi/core";
import { txSign } from "@/lib/cash-tx";
import { receivablesReport } from "@/lib/receivables";
import { money as fmt } from "@/lib/format";
import { cashCalendar, isOutKind, type CashCalendar, type CalItem } from "./calendar";
import { loadCategories, makeResolver, UNKNOWN_CATEGORY } from "./categories";
import { loanBalances } from "./loans";
import { pnlReport } from "./pnl";
import { monthKeyOf } from "./period";
import { r2 } from "./rows";
import { runChecks } from "@/lib/nazorat/checks";

/**
 * Direktor «Bugun» ekrani («Insof 2026» → Dashboard): 5 ta asosiy raqam, 30 kunlik kassa prognozi, e'tibor talab
 * qiladigan moliyaviy holatlar, pul qoldiqlari, 7 kunlik majburiy to'lovlar va oy natijasi (hisoblangan PNL).
 * Barcha raqamlar boshqa hisobotlar bilan bitta manbadan: kalendar, PNL, debitorka (FIFO), kreditlar.
 */
export type Attention = { key: string; level: "crit" | "warn" | "ok"; title: string; text: string; href: string };

export type TodayData = {
  cal: CashCalendar;
  cash: { total: number; inToday: number; outToday: number; accounts: { id: string; name: string; type: string; balance: number }[] };
  sales: { month: number; plan: number | null; pct: number | null };
  profit: { income: number; gross: number; operating: number; net: number; margin: number | null };
  receivable: { total: number; over60: number; debtors: number };
  payable: { suppliers: number; loans: number; total: number };
  attention: Attention[];
  week: CalItem[];
};

const DAY = 86_400_000;

export async function todayData(now: Date = new Date()): Promise<TodayData> {
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today.getTime() + DAY);
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const month = monthKeyOf(today);

  const [cal, accounts, txBal, payBal, todayTx, todayPay, revenue, plans, pnl, recv, loans, nodes, catUse] = await Promise.all([
    cashCalendar(now),
    db.cashAccount.findMany({ orderBy: [{ type: "asc" }, { name: "asc" }], select: { id: true, name: true, type: true, isActive: true } }),
    db.cashTransaction.groupBy({ by: ["cashAccountId", "type"], where: { cancelledAt: null }, _sum: { amount: true } }),
    db.payment.groupBy({ by: ["cashAccountId"], _sum: { amount: true } }),
    db.cashTransaction.findMany({ where: { cancelledAt: null, type: { in: ["INCOME", "EXPENSE"] }, date: { gte: today, lt: tomorrow } }, select: { type: true, amount: true } }),
    db.payment.aggregate({ where: { date: { gte: today, lt: tomorrow } }, _sum: { amount: true } }),
    loadRevenue(monthStart, tomorrow),
    db.salesPlan.findMany({ where: { year: today.getFullYear(), month: today.getMonth() + 1 }, select: { sellerId: true, amount: true } }),
    pnlReport([month], "accrual"),
    receivablesReport({ edges: [30, 60] }),
    loanBalances(),
    loadCategories(),
    db.cashTransaction.groupBy({ by: ["category"], where: { cancelledAt: null, type: { in: ["INCOME", "EXPENSE"] }, date: { gte: new Date(today.getFullYear(), today.getMonth() - 2, 1) } }, _count: { _all: true }, _sum: { amount: true } }),
  ]);
  // Kredit / asosiy vosita kategoriyasidagi, lekin kreditga / kartochkaga bog'lanmagan yozuvlar (nom va alias'lar bo'yicha)
  const namesOf = (needs: "LOAN" | "ASSET") => nodes.filter((n) => n.needs === needs).flatMap((n) => [n.name, ...n.aliases]);
  const [loanUnlinked, assetUnlinked] = await Promise.all([
    loans.length ? db.cashTransaction.count({ where: { cancelledAt: null, loanId: null, type: { in: ["INCOME", "EXPENSE"] }, category: { in: namesOf("LOAN"), mode: "insensitive" } } }) : Promise.resolve(0),
    db.cashTransaction.count({ where: { cancelledAt: null, type: "EXPENSE", fixedAsset: null, category: { in: namesOf("ASSET"), mode: "insensitive" } } }),
  ]);

  // ── Pul ──
  const bal = new Map<string, number>();
  for (const g of txBal) bal.set(g.cashAccountId, (bal.get(g.cashAccountId) ?? 0) + txSign(g.type) * Number(g._sum.amount ?? 0));
  for (const g of payBal) bal.set(g.cashAccountId, (bal.get(g.cashAccountId) ?? 0) + Number(g._sum.amount ?? 0));
  const accRows = accounts.map((a) => ({ id: a.id, name: a.name, type: a.type, balance: r2(bal.get(a.id) ?? 0), isActive: a.isActive })).filter((a) => a.isActive || Math.abs(a.balance) >= 1);
  const inToday = r2(Number(todayPay._sum.amount ?? 0) + todayTx.filter((t) => t.type === "INCOME").reduce((s, t) => s + Number(t.amount), 0));
  const outToday = r2(todayTx.filter((t) => t.type === "EXPENSE").reduce((s, t) => s + Number(t.amount), 0));

  // ── Sotuv (yetkazilgan, QQS bilan — Egasi paneli bilan bir xil) va reja ──
  const salesMonth = r2(revenue.reduce((s, r) => s + r.revenue, 0));
  const companyPlan = plans.find((p) => p.sellerId === null);
  const plan = companyPlan ? Number(companyPlan.amount) : plans.reduce((s, p) => s + Number(p.amount), 0) || null;

  // ── Oy natijasi (hisoblangan PNL, joriy oy) ──
  const v = (k: string) => pnl.rows.find((r) => r.key === k)?.values[0] ?? 0;
  const income = v("income"), net = v("net");

  // ── Qarzlar ──
  const over60 = r2(recv.buckets[2] ?? 0);
  const suppliers = r2(cal.suppliers.reduce((s, x) => s + x.debt, 0));
  const loanDebt = r2(loans.filter((l) => l.kind !== "LENT" && !l.closedAt).reduce((s, l) => s + l.balance, 0));

  // ── E'tibor bering ──
  const attention: Attention[] = [];
  const neg = cal.days.find((d) => d.balance < 0);
  const dd = (d: Date) => `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}`;
  if (neg) attention.push({ key: "gap", level: "crit", title: `${dd(neg.date)} da pul yetmaydi`, text: `Prognoz qoldig'i ${fmt(neg.balance)} — tushumni tezlashtirish yoki to'lovlarni surish kerak`, href: "/moliya/kalendar" });
  const overdueOut = cal.items.filter((i) => i.overdue && isOutKind(i.kind));
  if (overdueOut.length) attention.push({ key: "overdue", level: "warn", title: "Muddati o'tgan to'lovlar", text: `${overdueOut.length} ta, ${fmt(overdueOut.reduce((s, i) => s + i.amount, 0))} — ta'minotchilar kutmoqda`, href: "/moliya/kalendar" });
  if (cal.dividend.left < 0) attention.push({ key: "div", level: "crit", title: "Divident limitdan oshdi", text: `Shu oy ${fmt(cal.dividend.taken)} olindi, limit ${fmt(cal.dividend.limit)}`, href: "/moliya/kalendar" });
  if (over60 > 0) attention.push({ key: "debt60", level: "warn", title: "60 kundan eski mijoz qarzi", text: `${fmt(over60)} — undirish rejasi kerak`, href: "/bi-tahlil/mijozlar" });
  const resolve = makeResolver(nodes);
  const unknown = catUse.filter((c) => !resolve(c.category));
  if (unknown.length) attention.push({ key: "unknown", level: "warn", title: UNKNOWN_CATEGORY, text: `${unknown.reduce((s, c) => s + c._count._all, 0)} ta kassa yozuvi hisobotga to'g'ri tushmayapti`, href: "/moliya/kategoriyalar" });
  if (loanUnlinked) attention.push({ key: "loan", level: "warn", title: "Kreditga bog'lanmagan to'lovlar", text: `${loanUnlinked} ta yozuv — kredit qoldig'i noto'g'ri chiqadi`, href: "/moliya/kreditlar" });
  if (assetUnlinked) attention.push({ key: "asset", level: "warn", title: "Asosiy vosita kartochkasi ochilmagan", text: `${assetUnlinked} ta xarid — amortizatsiya hisoblanmayapti`, href: "/moliya/asosiy-vositalar" });
  // Nazoratning qizil bandlari (kassa yopilmagan, sklad sanalmagan…) — batafsili «Nazorat» tabida
  for (const c of (await runChecks({ now })).filter((x) => x.status === "crit")) {
    attention.push({ key: `nazorat-${c.key}`, level: "crit", title: c.title, text: `${c.value} — ${c.owner}`, href: "/dashboard?view=nazorat" });
  }
  if (!attention.length) attention.push({ key: "ok", level: "ok", title: "Moliyada shoshilinch masala yo'q", text: "30 kun ichida pul yetadi, muddati o'tgan to'lov yo'q", href: "/moliya/kalendar" });

  return {
    cal,
    cash: { total: cal.start, inToday, outToday, accounts: accRows },
    sales: { month: salesMonth, plan, pct: plan ? (salesMonth / plan) * 100 : null },
    profit: { income, gross: v("gross"), operating: v("operating"), net, margin: income ? (net / income) * 100 : null },
    receivable: { total: r2(recv.total), over60, debtors: recv.debtors },
    payable: { suppliers, loans: loanDebt, total: r2(suppliers + loanDebt) },
    attention,
    week: cal.items.filter((i) => i.day < 7 && isOutKind(i.kind)),
  };
}
