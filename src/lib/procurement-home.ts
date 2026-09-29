import type { SupplyStatus } from "@/generated/prisma";
import { db } from "./db";
import { getCompany } from "./company";
import { materialOutlook } from "./dashboard";
import { totalPlanned, totalFact } from "./supply";

/**
 * Snabjeniye xodimining bosh sahifasi ("JBI Snabjeniye kabineti", 2-bo'lim):
 * kutilayotgan zayavkalar, shoshilinch xaridlar, ochiq buyurtmalar, kechikishlar, bugungi kirim,
 * oylik xarid summasi (byudjet va fakt), top yetkazuvchilar, kritik qoldiq.
 *
 * Hujjatdagi statuslar bizning ta'minot zanjiriga shunday tushadi:
 *   Pending (Submitted)      → NEW (narx kutmoqda) + PRICED (ma'sul xodim tasdig'i)
 *   Approved                 → APPROVED (moliya pul ajratishi kutilmoqda)
 *   Ordered / In Transit     → FUNDED (pul ajratildi — sotib olinadi, yo'lda)
 *   Received                 → RECEIVED
 *   Delayed                  → ochiq hujjat, "kerak sana" (needBy) o'tib ketgan
 * Prioritet alohida maydon emas — hisoblanadi: kritik xomashyo yoki sanasi o'tgan → Kritik,
 * 2 kun ichida kerak → Yuqori, qolgani → Oddiy.
 */

export const PROCUREMENT_HOME_ROLES = ["PROCUREMENT"] as const;

const OPEN: SupplyStatus[] = ["NEW", "PRICED", "APPROVED", "FUNDED"];
/** Xarid pullari Kirim-Chiqimda shu kategoriyada yoziladi (`fundSupplyRequest`). */
const CATEGORY = "Xomashyo";
const URGENT_DAYS = 2;
const TOP_DAYS = 90;

export type Priority = "critical" | "high" | "normal";
export const PRIORITY_LABEL: Record<Priority, string> = { critical: "Kritik", high: "Yuqori", normal: "Oddiy" };

const startOfDay = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const dayDiff = (a: Date, b: Date) => Math.round((startOfDay(a).getTime() - startOfDay(b).getTime()) / 86400000);

export async function procurementHome() {
  const today = startOfDay(new Date()), tomorrow = addDays(today, 1);
  const y = today.getFullYear(), m = today.getMonth();
  const monthStart = new Date(y, m, 1), monthEnd = new Date(y, m + 1, 1);

  const [company, open, receivedMonth, receipts, budget, spent, materials, rejectedMonth] = await Promise.all([
    getCompany(),
    db.supplyRequest.findMany({
      where: { status: { in: OPEN } },
      orderBy: [{ needBy: "asc" }, { date: "asc" }],
      include: { items: true, supplier: { select: { id: true, name: true } }, createdBy: { select: { fullName: true } } },
    }),
    db.supplyRequest.findMany({
      where: { status: "RECEIVED", updatedAt: { gte: monthStart, lt: monthEnd } },
      include: { items: true, supplier: { select: { name: true } } },
    }),
    // Kirim hujjatlari (ta'minotdan tashqari to'g'ridan-to'g'ri kirimlar ham) — top yetkazuvchi va bugungi kirim uchun
    db.goodsReceipt.findMany({
      where: { date: { gte: addDays(today, -TOP_DAYS) } },
      select: { id: true, docNo: true, date: true, supplier: { select: { id: true, name: true } }, items: { select: { qty: true, price: true, material: { select: { name: true, unit: true } } } } },
      orderBy: { date: "desc" },
    }),
    db.expenseBudget.findFirst({ where: { year: y, month: m + 1, category: CATEGORY } }),
    db.cashTransaction.aggregate({ where: { type: "EXPENSE", category: CATEGORY, date: { gte: monthStart, lt: monthEnd } }, _sum: { amount: true } }),
    materialOutlook(),
    db.supplyRequest.count({ where: { status: "REJECTED", updatedAt: { gte: monthStart, lt: monthEnd } } }),
  ]);

  /* ── Kritik qoldiq: zayavkalarga yetmaydi, minimaldan kam yoki kritik kundan kamga yetadi ── */
  const stock = materials
    .map((x) => {
      const critical = x.short || (x.minStock > 0 && x.balance < x.minStock) || (x.days !== null && x.days < company.stockCritDays);
      const warn = !critical && x.days !== null && x.days < company.stockWarnDays;
      const reason = x.short ? "Zayavkalarga yetmaydi" : x.minStock > 0 && x.balance < x.minStock ? "Minimaldan kam" : critical ? `${company.stockCritDays} kundan kamga yetadi` : "Buyurtma bering";
      return { ...x, level: critical ? ("critical" as const) : warn ? ("warn" as const) : ("ok" as const), reason };
    })
    .filter((x) => x.level !== "ok")
    .sort((a, b) => (a.level === b.level ? (a.days ?? 0) - (b.days ?? 0) : a.level === "critical" ? -1 : 1));
  const criticalIds = new Set(stock.filter((x) => x.level === "critical").map((x) => x.id));
  // Shu kritik xomashyo ochiq zayavkada so'ralganmi — so'ralmagan bo'lsa snabjeniye o'zi boshlashi kerak
  const requested = new Set(open.flatMap((r) => r.items.map((i) => i.materialId).filter((id): id is string => !!id)));

  /* ── Ochiq hujjatlar: prioritet, kechikish ── */
  const rows = open.map((r) => {
    const late = r.needBy ? dayDiff(today, r.needBy) : 0; // musbat — necha kun kechikdi
    const hasCritical = r.items.some((i) => i.materialId && criticalIds.has(i.materialId));
    const soon = !!r.needBy && r.needBy < addDays(today, URGENT_DAYS + 1);
    const priority: Priority = hasCritical || late > 0 ? "critical" : soon ? "high" : "normal";
    return {
      id: r.id, docNo: r.docNo, date: r.date, status: r.status, needBy: r.needBy, late,
      priority, hasCritical,
      supplier: r.supplier?.name ?? null, supplierId: r.supplier?.id ?? null,
      by: r.createdBy.fullName,
      lines: r.items.length,
      what: r.items.slice(0, 3).map((i) => i.name).join(", ") + (r.items.length > 3 ? ` +${r.items.length - 3}` : ""),
      total: totalPlanned(r),
      updatedAt: r.updatedAt,
    };
  });
  const by = (s: SupplyStatus) => rows.filter((r) => r.status === s);
  const pending = [...by("NEW"), ...by("PRICED")];
  const approved = by("APPROVED");
  const ordered = by("FUNDED");
  const delayed = rows.filter((r) => r.late > 0).sort((a, b) => b.late - a.late);
  const urgent = rows.filter((r) => r.priority !== "normal").sort((a, b) => (a.priority === b.priority ? (a.needBy?.getTime() ?? Infinity) - (b.needBy?.getTime() ?? Infinity) : a.priority === "critical" ? -1 : 1));
  const expectedToday = ordered.filter((r) => r.needBy && r.needBy >= today && r.needBy < tomorrow);

  /* ── Bugun qabul qilingan kirimlar ── */
  const receivedToday = receipts
    .filter((g) => g.date >= today && g.date < tomorrow)
    .map((g) => ({ id: g.id, docNo: g.docNo, supplier: g.supplier.name, lines: g.items.map((i) => `${i.material.name} ${Number(i.qty)} ${i.material.unit}`).join(", "), total: g.items.reduce((s, i) => s + Number(i.qty) * Number(i.price), 0) }));

  /* ── Top yetkazuvchilar: so'nggi 90 kun kirimlari bo'yicha ── */
  const sup = new Map<string, { id: string; name: string; sum: number; count: number; last: Date }>();
  for (const g of receipts) {
    const cur = sup.get(g.supplier.id) ?? { id: g.supplier.id, name: g.supplier.name, sum: 0, count: 0, last: g.date };
    cur.sum += g.items.reduce((s, i) => s + Number(i.qty) * Number(i.price), 0);
    cur.count += 1;
    if (g.date > cur.last) cur.last = g.date;
    sup.set(g.supplier.id, cur);
  }
  const delaysBySupplier = new Map<string, number>();
  for (const r of delayed) if (r.supplierId) delaysBySupplier.set(r.supplierId, (delaysBySupplier.get(r.supplierId) ?? 0) + 1);
  const topSuppliers = [...sup.values()].sort((a, b) => b.sum - a.sum).slice(0, 6).map((s) => ({ ...s, delayed: delaysBySupplier.get(s.id) ?? 0 }));

  /* ── Oylik xarid summasi: byudjet (reja) vs Kirim-Chiqimdagi xarid chiqimi (fakt) ── */
  const monthReceipts = receipts.filter((g) => g.date >= monthStart);
  const money = {
    budget: budget ? Number(budget.amount) : null,
    spent: Number(spent._sum.amount ?? 0), // moliya ajratgan (reja summada, qabulda faktga tuzatiladi)
    received: receivedMonth.reduce((s, r) => s + totalFact(r), 0),
    receiptsSum: monthReceipts.reduce((s, g) => s + g.items.reduce((x, i) => x + Number(i.qty) * Number(i.price), 0), 0),
    pipeline: rows.filter((r) => r.status !== "FUNDED").reduce((s, r) => s + r.total, 0), // hali pul chiqmagan, lekin keladigan xarajat
    ordered: ordered.reduce((s, r) => s + r.total, 0),
  };

  /* ── Zanjir bosqichlari: nechta hujjat, qancha pul, kim ushlab turibdi ── */
  const stages = (["NEW", "PRICED", "APPROVED", "FUNDED"] as const).map((s) => ({ status: s, count: by(s).length, sum: by(s).reduce((x, r) => x + r.total, 0) }));

  return {
    today,
    thresholds: { warn: company.stockWarnDays, crit: company.stockCritDays },
    counts: {
      pending: pending.length, priceWait: by("NEW").length, approveWait: by("PRICED").length,
      approved: approved.length, ordered: ordered.length,
      receivedMonth: receivedMonth.length, receiptsMonth: monthReceipts.length, rejectedMonth,
      delayed: delayed.length, critical: criticalIds.size, criticalUnrequested: [...criticalIds].filter((id) => !requested.has(id)).length,
      expectedToday: expectedToday.length, receivedToday: receivedToday.length,
    },
    stages, urgent, delayed, ordered, expectedToday, receivedToday,
    stock: stock.map((x) => ({ ...x, requested: requested.has(x.id) })),
    topSuppliers, money,
  };
}

export type ProcurementHome = Awaited<ReturnType<typeof procurementHome>>;
