import type { SupplyDelivery, SupplyPriority, SupplyStatus } from "@/generated/prisma";
import { db } from "./db";
import { getCompany } from "./company";
import { materialOutlook } from "./dashboard";
import { totalPlanned } from "./supply";
import { needsDirector } from "./procurement";
import { DEPARTMENTS, REQUIRED_DOCS } from "./procurement-const";

/**
 * Snabjeniye bosh sahifasi — "Biton Snabjenya Dashboard" TZ:
 *   1-qator KPI: Ochiq talablar | Shoshilinch | Buyurtmalar | Yo'ldagi yuklar | Kechikkanlar
 *   2-qator: material qoldig'i grafigi | xarid summasi grafigi
 *   3-qator: shoshilinch talablar jadvali (A)      4-qator: yetkazib berish monitoringi (C)
 *   5-qator: yetkazib beruvchilar va kechikishlar (E) + materiallar zaxirasi (D)
 *   Yon panel: tezkor amallar + bildirishnomalar (TZ 7 — hisoblanadigan alertlar).
 * Xarid jarayoni (B) — zanjir bosqichlari bo'yicha voronka.
 *
 * Ustuvorlik = max(qo'lda qo'yilgan `priority`, hisoblangan): kritik xomashyo yoki sanasi o'tgan → Kritik,
 * 2 kun ichida kerak → Yuqori. Kechikish: buyurtma berilganda ETA bo'yicha, bo'lmasa "kerak sana" bo'yicha.
 * Hamma raqam shu yerda — UI o'zi hisoblamaydi. Mobil ilova dashboardi ham shu funksiyani chaqiradi.
 */

export const PROCUREMENT_HOME_ROLES = ["PROCUREMENT"] as const;

const OPEN: SupplyStatus[] = ["NEW", "PRICED", "APPROVED", "FUNDED"];
/** Xarid pullari Kirim-Chiqimda shu kategoriyada yoziladi (`fundSupplyRequest`). */
const CATEGORY = "Xomashyo";
const URGENT_DAYS = 2;
const RECENT_DAYS = 30;
const QTY_TOLERANCE = 1.02;

const RANK: Record<SupplyPriority, number> = { NORMAL: 0, HIGH: 1, CRITICAL: 2 };
const maxPriority = (a: SupplyPriority, b: SupplyPriority) => (RANK[a] >= RANK[b] ? a : b);

const startOfDay = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const dayDiff = (a: Date, b: Date) => Math.round((startOfDay(a).getTime() - startOfDay(b).getTime()) / 86400000);
const parseDay = (s?: string) => { if (!s) return null; const d = new Date(s); return Number.isNaN(d.getTime()) ? null : startOfDay(d); };

/** TZ 6-bo'lim filtrlari — URL parametrlari (`/dashboard?dept=…&late=1`). */
export type ProcFilters = {
  from?: string; to?: string; // sana oralig'i
  dept?: string; // bo'lim
  group?: string; // material turi (papka, ichidagilari bilan)
  q?: string; // material kodi/nomi, buyurtma raqami, shartnoma
  sup?: string; // yetkazib beruvchi
  pr?: string; // ustuvorlik
  st?: string; // status (NEW/PRICED/APPROVED/FUNDED) yoki yetkazish holati (d:IN_TRANSIT)
  late?: string; // "1" kechikkan, "0" kechikmagan
};
export const FILTER_KEYS: (keyof ProcFilters)[] = ["from", "to", "dept", "group", "q", "sup", "pr", "st", "late"];

export type AlertTone = "danger" | "warning" | "info";
export type ProcAlert = { key: string; tone: AlertTone; title: string; text: string; count: number; href: string; docs: { id: string; docNo: string }[] };

export async function procurementHome(f: ProcFilters = {}) {
  const today = startOfDay(new Date()), tomorrow = addDays(today, 1);
  const y = today.getFullYear(), m = today.getMonth();
  const monthStart = new Date(y, m, 1), monthEnd = new Date(y, m + 1, 1);
  // Sana oralig'i: berilmasa — joriy oy (statistika uchun); ochiq hujjatlar faqat aniq berilganda kesiladi
  const from = parseDay(f.from) ?? monthStart;
  const to = f.to && parseDay(f.to) ? addDays(parseDay(f.to)!, 1) : f.from ? tomorrow : monthEnd;
  const dated = !!(f.from || f.to);
  const recent = addDays(today, -RECENT_DAYS);

  const [company, open, received, receipts, budget, spent, materials, matMeta, groups, suppliers, quotesInRange, rejected] = await Promise.all([
    getCompany(),
    db.supplyRequest.findMany({
      where: { status: { in: OPEN } },
      orderBy: [{ needBy: "asc" }, { date: "asc" }],
      include: {
        items: { include: { material: { select: { code: true, groupId: true } } } },
        supplier: { select: { id: true, name: true } },
        createdBy: { select: { fullName: true } },
        responsible: { select: { fullName: true } },
        warehouse: { select: { name: true } },
        documents: { select: { kind: true } },
        incidents: { where: { resolvedAt: null }, select: { id: true, kind: true, note: true } },
        _count: { select: { quotes: true } },
      },
    }),
    db.supplyRequest.findMany({
      where: { status: "RECEIVED", updatedAt: { gte: dated ? from : recent, lt: dated ? to : tomorrow } },
      include: { items: true, documents: { select: { kind: true } }, supplier: { select: { id: true, name: true } } },
    }),
    db.goodsReceipt.findMany({
      where: { date: { gte: from, lt: to } },
      select: { id: true, docNo: true, date: true, supplier: { select: { id: true, name: true } }, items: { select: { qty: true, price: true } } },
      orderBy: { date: "asc" },
    }),
    db.expenseBudget.findFirst({ where: { year: y, month: m + 1, category: CATEGORY } }),
    db.cashTransaction.aggregate({ where: { type: "EXPENSE", category: CATEGORY, date: { gte: monthStart, lt: monthEnd } }, _sum: { amount: true } }),
    materialOutlook(),
    db.material.findMany({ where: { isActive: true }, select: { id: true, code: true, groupId: true } }),
    db.materialGroup.findMany({ where: { isActive: true }, select: { id: true, name: true, parentId: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    db.supplier.findMany({ where: { isActive: true }, select: { id: true, name: true, createdAt: true }, orderBy: { name: "asc" } }),
    db.supplyQuote.count({ where: { createdAt: { gte: from, lt: to } } }),
    db.supplyRequest.count({ where: { status: "REJECTED", updatedAt: { gte: from, lt: to } } }),
  ]);
  const limit = Number(company.supplyDirectorLimit);

  /* ── Material turi (papka) filtri: tanlangan papka va uning ichidagilari ── */
  const groupSet = (() => {
    if (!f.group) return null;
    const out = new Set([f.group]);
    let grew = true;
    while (grew) { grew = false; for (const g of groups) if (g.parentId && out.has(g.parentId) && !out.has(g.id)) { out.add(g.id); grew = true; } }
    return out;
  })();
  const q = f.q?.trim().toLowerCase() || "";
  const meta = new Map(matMeta.map((x) => [x.id, x]));

  /* ── D. Materiallar zaxirasi: qoldiq, minimal, rejalashtirilgan sarf, yetishmovchilik ── */
  const stockAll = materials.map((x) => {
    const mm = meta.get(x.id);
    const need = Math.max(x.minStock, x.planned); // shu miqdor omborda turishi kerak
    const shortage = Math.max(0, need - x.balance);
    const critical = x.short || (x.minStock > 0 && x.balance < x.minStock) || (x.days !== null && x.days < company.stockCritDays);
    const warn = !critical && x.days !== null && x.days < company.stockWarnDays;
    const reason = x.short ? "Rejadagi sarfga yetmaydi" : x.minStock > 0 && x.balance < x.minStock ? "Minimaldan kam" : critical ? `${company.stockCritDays} kundan kamga yetadi` : warn ? `${company.stockWarnDays} kundan kamga yetadi` : "Yetarli";
    return { ...x, code: mm?.code ?? "", groupId: mm?.groupId ?? null, shortage, level: critical ? ("critical" as const) : warn ? ("warn" as const) : ("ok" as const), reason, orderNeeded: critical || warn || shortage > 0 };
  });
  const criticalIds = new Set(stockAll.filter((x) => x.level === "critical").map((x) => x.id));
  const requested = new Set(open.flatMap((r) => r.items.map((i) => i.materialId).filter((id): id is string => !!id)));
  const stock = stockAll
    .filter((x) => (!groupSet || (x.groupId && groupSet.has(x.groupId))) && (!q || x.name.toLowerCase().includes(q) || x.code.toLowerCase().includes(q)))
    .map((x) => ({ ...x, requested: requested.has(x.id) }))
    .sort((a, b) => {
      const w = (x: typeof a) => (x.level === "critical" ? 0 : x.level === "warn" ? 1 : x.orderNeeded ? 2 : 3);
      return w(a) - w(b) || b.shortage - a.shortage || a.name.localeCompare(b.name);
    });

  /* ── Ochiq hujjatlar: ustuvorlik, kechikish, yetkazish ── */
  const rowsAll = open.map((r) => {
    const due = r.status === "FUNDED" && r.eta ? r.eta : r.needBy;
    const late = due ? dayDiff(today, due) : 0; // musbat — necha kun kechikdi
    const hasCritical = r.items.some((i) => i.materialId && criticalIds.has(i.materialId));
    const soon = !!r.needBy && r.needBy < addDays(today, URGENT_DAYS + 1);
    const computed: SupplyPriority = hasCritical || late > 0 ? "CRITICAL" : soon ? "HIGH" : "NORMAL";
    const total = totalPlanned(r);
    return {
      id: r.id, docNo: r.docNo, date: r.date, status: r.status, needBy: r.needBy, due, late: Math.max(0, late),
      priority: maxPriority(r.priority, computed), manualPriority: r.priority, hasCritical,
      department: r.department ?? r.warehouse.name, departmentSet: r.department,
      supplier: r.supplier?.name ?? null, supplierId: r.supplier?.id ?? null,
      by: r.createdBy.fullName, responsible: r.responsible?.fullName ?? null,
      contractNo: r.contractNo,
      lines: r.items.length,
      items: r.items.map((i) => ({ name: i.name, qty: Number(i.qty), unit: i.unit, code: i.material?.code ?? "", groupId: i.material?.groupId ?? null })),
      what: r.items.slice(0, 2).map((i) => i.name).join(", ") + (r.items.length > 2 ? ` +${r.items.length - 2}` : ""),
      qtyText: r.items.length === 1 ? `${Number(r.items[0].qty)} ${r.items[0].unit}` : `${r.items.length} nom`,
      total,
      waitDirector: r.status === "PRICED" && needsDirector(total, limit) && !r.directorOkAt,
      delivery: r.deliveryStatus, shippedAt: r.shippedAt, eta: r.eta, arrivedAt: r.arrivedAt, transport: r.deliveryProvider,
      quotes: r._count.quotes,
      docs: r.documents.map((d) => d.kind),
      incidents: r.incidents,
    };
  });
  type Row = (typeof rowsAll)[number];

  /* ── Filtrlar (TZ 6) ── */
  const match = (r: Row) => {
    if (dated && !(r.date >= from && r.date < to)) return false;
    if (f.dept && r.department !== f.dept) return false;
    if (f.sup && r.supplierId !== f.sup) return false;
    if (f.pr && r.priority !== f.pr) return false;
    if (f.st) {
      if (f.st.startsWith("d:")) { if (r.delivery !== f.st.slice(2)) return false; }
      else if (r.status !== f.st) return false;
    }
    if (f.late === "1" && !(r.late > 0)) return false;
    if (f.late === "0" && r.late > 0) return false;
    if (groupSet && !r.items.some((i) => i.groupId && groupSet.has(i.groupId))) return false;
    if (q && !(r.docNo.toLowerCase().includes(q) || (r.contractNo ?? "").toLowerCase().includes(q) || r.items.some((i) => i.name.toLowerCase().includes(q) || i.code.toLowerCase().includes(q)))) return false;
    return true;
  };
  const rows = rowsAll.filter(match);
  const filtered = FILTER_KEYS.some((k) => !!f[k]);

  const by = (s: SupplyStatus) => rows.filter((r) => r.status === s);
  const orders = by("FUNDED");
  const inTransit = orders.filter((r) => r.delivery === "IN_TRANSIT");
  const delayed = rows.filter((r) => r.late > 0).sort((a, b) => b.late - a.late);
  const urgent = rows.filter((r) => r.priority !== "NORMAL").sort((a, b) =>
    RANK[b.priority] - RANK[a.priority] || (a.due?.getTime() ?? Infinity) - (b.due?.getTime() ?? Infinity));
  const deliveries = [...orders].sort((a, b) => b.late - a.late || (a.eta?.getTime() ?? a.needBy?.getTime() ?? Infinity) - (b.eta?.getTime() ?? b.needBy?.getTime() ?? Infinity));

  /* ── B. Xarid jarayoni: har bosqichda nechta hujjat ── */
  const DELIVERING: (SupplyDelivery | null)[] = ["IN_TRANSIT", "PROBLEM"];
  const pipeline = [
    { key: "request", label: "Talab", hint: "narx/taklif kutmoqda", count: by("NEW").filter((r) => !r.quotes).length, href: "/snabjeniye?tab=NEW" },
    { key: "quote", label: "Narx taklifi", hint: "takliflar yig'ilmoqda", count: by("NEW").filter((r) => r.quotes > 0).length, href: "/snabjeniye?tab=NEW" },
    { key: "approve", label: "Tasdiqlashda", hint: "direktor / ma'sul / moliya", count: by("PRICED").length + by("APPROVED").length, href: "/snabjeniye?tab=PRICED" },
    { key: "order", label: "Buyurtma berildi", hint: "jo'natilishi kutilmoqda", count: orders.filter((r) => !r.delivery || r.delivery === "PLANNED").length, href: "/snabjeniye?tab=FUNDED" },
    { key: "delivery", label: "Yetkazilmoqda", hint: "yo'lda / muammo", count: orders.filter((r) => DELIVERING.includes(r.delivery)).length, href: "/snabjeniye?tab=FUNDED" },
    { key: "receive", label: "Qabul qilinmoqda", hint: "zavodga keldi", count: orders.filter((r) => r.delivery === "ARRIVED" || r.delivery === "RECEIVING").length, href: "/snabjeniye?tab=FUNDED" },
    { key: "stock", label: "Omborga kirim", hint: dated ? "davrda" : `so'nggi ${RECENT_DAYS} kun`, count: received.length, href: "/snabjeniye?tab=RECEIVED" },
  ];

  /* ── 2-qator grafiklari ── */
  const receiptSum = (g: (typeof receipts)[number]) => g.items.reduce((s, i) => s + Number(i.qty) * Number(i.price), 0);
  const days = Math.max(1, Math.round((to.getTime() - from.getTime()) / 86400000));
  const weekly = days > 45;
  const buckets = new Map<string, { label: string; value: number }>();
  for (let d = new Date(from); d < to; d = addDays(d, weekly ? 7 : 1)) {
    buckets.set(bucketKey(d, from, weekly), { label: weekly ? `${d.getDate()}.${d.getMonth() + 1}` : String(d.getDate()), value: 0 });
  }
  for (const g of receipts) {
    const b = buckets.get(bucketKey(g.date, from, weekly));
    if (b) b.value += receiptSum(g);
  }
  const purchaseBars = [...buckets.values()];
  const purchaseTotal = receipts.reduce((s, g) => s + receiptSum(g), 0);

  /* ── E. Yetkazib beruvchilar ── */
  const sup = new Map<string, { id: string; name: string; sum: number; count: number; last: Date; delayed: number; open: number }>();
  for (const g of receipts) {
    const cur = sup.get(g.supplier.id) ?? { id: g.supplier.id, name: g.supplier.name, sum: 0, count: 0, last: g.date, delayed: 0, open: 0 };
    cur.sum += receiptSum(g); cur.count += 1;
    if (g.date > cur.last) cur.last = g.date;
    sup.set(g.supplier.id, cur);
  }
  for (const r of rowsAll) {
    if (!r.supplierId || r.status !== "FUNDED") continue;
    const cur = sup.get(r.supplierId) ?? { id: r.supplierId, name: r.supplier!, sum: 0, count: 0, last: r.date, delayed: 0, open: 0 };
    cur.open += 1;
    if (r.late > 0) cur.delayed += 1;
    sup.set(r.supplierId, cur);
  }
  const supplierRows = [...sup.values()].sort((a, b) => b.delayed - a.delayed || b.sum - a.sum).slice(0, 8);
  const openFunded = rowsAll.filter((r) => r.status === "FUNDED" || r.status === "APPROVED");
  const supplierStats = {
    active: suppliers.length,
    fresh: suppliers.filter((s) => s.createdAt >= from && s.createdAt < to).length,
    quotes: quotesInRange,
    deliveries: receipts.length,
    delayed: rowsAll.filter((r) => r.status === "FUNDED" && r.late > 0).length,
    withContract: openFunded.filter((r) => r.contractNo).length,
    noContract: openFunded.filter((r) => !r.contractNo).length,
  };

  /* ── TZ 7. Bildirishnomalar — dashboardda alohida alert sifatida ── */
  const docsOf = (xs: { id: string; docNo: string }[]) => xs.slice(0, 5).map((x) => ({ id: x.id, docNo: x.docNo }));
  const belowMin = stockAll.filter((x) => (x.minStock > 0 && x.balance < x.minStock) || x.short);
  const urgentNotBought = rowsAll.filter((r) => r.priority !== "NORMAL" && r.status !== "FUNDED");
  const dueToday = rowsAll.filter((r) => r.status === "FUNDED" && r.due && r.due >= today && r.due < tomorrow);
  const lateDeliveries = rowsAll.filter((r) => r.status === "FUNDED" && r.late > 0);
  const waitApproval = rowsAll.filter((r) => r.status === "PRICED" || r.status === "APPROVED");
  const bigWait = waitApproval.filter((r) => r.waitDirector);
  const docTargets = [
    ...rowsAll.filter((r) => r.status === "FUNDED" && (r.delivery === "ARRIVED" || r.delivery === "RECEIVING")),
    ...received.map((r) => ({ id: r.id, docNo: r.docNo, docs: r.documents.map((d) => d.kind) })),
  ];
  const missingDocs = docTargets.filter((r) => REQUIRED_DOCS.some((k) => !r.docs.includes(k)));
  const qtyDiff = received.filter((r) => r.items.some((i) => i.factQty != null && Number(i.factQty) < Number(i.qty) / QTY_TOLERANCE - 0.001));
  const incidents = rowsAll.filter((r) => r.incidents.length > 0);

  const alerts: ProcAlert[] = [
    { key: "incident", tone: "danger" as const, title: "Ochiq muammolar", count: incidents.length, href: "/snabjeniye?tab=open", docs: docsOf(incidents),
      text: incidents.length ? incidents.slice(0, 2).map((r) => `${r.docNo}: ${r.incidents[0].note}`).join(" · ") : "" },
    { key: "min", tone: "danger" as const, title: "Material minimal qoldiqdan past", count: belowMin.length, href: "#zaxira", docs: [],
      text: belowMin.slice(0, 4).map((x) => x.name).join(", ") + (belowMin.length > 4 ? ` +${belowMin.length - 4}` : "") + (belowMin.some((x) => !requested.has(x.id)) ? ` — ${belowMin.filter((x) => !requested.has(x.id)).length} tasi so'ralmagan` : "") },
    { key: "urgent", tone: "danger" as const, title: "Shoshilinch talab hali xarid qilinmagan", count: urgentNotBought.length, href: "?pr=CRITICAL#shoshilinch", docs: docsOf(urgentNotBought), text: "" },
    { key: "late", tone: "danger" as const, title: "Yetkazib berish kechikdi", count: lateDeliveries.length, href: "?late=1#yetkazish", docs: docsOf(lateDeliveries),
      text: lateDeliveries.length ? `eng ko'pi ${Math.max(...lateDeliveries.map((r) => r.late))} kun` : "" },
    { key: "today", tone: "warning" as const, title: "Yetkazib berish muddati bugun", count: dueToday.length, href: "#yetkazish", docs: docsOf(dueToday), text: "" },
    { key: "approval", tone: "warning" as const, title: "Xarid tasdiqlashni kutmoqda", count: waitApproval.length, href: "/snabjeniye?tab=PRICED", docs: docsOf(waitApproval),
      text: bigWait.length ? `${bigWait.length} tasi katta xarid — direktor tasdig'ida` : "" },
    { key: "docs", tone: "warning" as const, title: "Yetkazib beruvchi hujjati yetishmayapti", count: missingDocs.length, href: "/snabjeniye?tab=RECEIVED", docs: docsOf(missingDocs), text: REQUIRED_DOCS.join(" / ") },
    { key: "qty", tone: "warning" as const, title: "Qabul qilingan miqdor buyurtmadan farq qiladi", count: qtyDiff.length, href: "/snabjeniye?tab=RECEIVED", docs: docsOf(qtyDiff), text: `so'nggi ${RECENT_DAYS} kun` },
  ].filter((a) => a.count > 0);

  /* ── Oylik xarid: byudjet (reja) vs Kirim-Chiqimdagi xarid chiqimi (fakt) ── */
  const money = {
    budget: budget ? Number(budget.amount) : null,
    spent: Number(spent._sum.amount ?? 0),
    purchaseTotal,
    ordered: orders.reduce((s, r) => s + r.total, 0),
    pipeline: rows.filter((r) => r.status !== "FUNDED").reduce((s, r) => s + r.total, 0),
  };

  return {
    today, from, to: addDays(to, -1), dated, filtered, limit,
    thresholds: { warn: company.stockWarnDays, crit: company.stockCritDays },
    counts: {
      open: rows.length,
      urgent: urgent.length, critical: urgent.filter((r) => r.priority === "CRITICAL").length,
      orders: orders.length, inTransit: inTransit.length,
      delayed: delayed.length,
      priceWait: by("NEW").length, approveWait: by("PRICED").length + by("APPROVED").length,
      received: received.length, rejected,
      stockCritical: criticalIds.size, stockUnrequested: [...criticalIds].filter((id) => !requested.has(id)).length,
    },
    pipeline, urgent, deliveries, delayed,
    stock, stockChart: stock.filter((x) => x.level !== "ok" || x.shortage > 0).slice(0, 8),
    purchaseBars, weekly,
    supplierRows, supplierStats, alerts, money,
    options: {
      departments: [...new Set([...DEPARTMENTS, ...rowsAll.map((r) => r.departmentSet).filter((x): x is string => !!x)])],
      suppliers: suppliers.map((s) => ({ id: s.id, name: s.name })),
      groups: groups.map((g) => ({ id: g.id, name: g.name, parentId: g.parentId })),
    },
  };
}

function bucketKey(d: Date, from: Date, weekly: boolean) {
  const n = Math.floor((startOfDay(d).getTime() - startOfDay(from).getTime()) / 86400000);
  return String(weekly ? Math.floor(n / 7) : n);
}

export type ProcurementHome = Awaited<ReturnType<typeof procurementHome>>;
