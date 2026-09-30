import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { materialOutlook } from "@/lib/dashboard";
import { productionDay } from "@/lib/production-day";
import { dayUtc, isoDay, markOf, today } from "@/lib/davomat";
import { fmtUnitTotals, unitLabel } from "@/lib/unit";
import { notifyAfter, notifyRoles } from "@/lib/notify";
import type { Prisma } from "@/generated/prisma";

/**
 * Ishlab chiqarishning kunlik hisoboti (elektron varaq).
 *
 * Jonli hisobot (`/dashboard/hisobot`) ham, saqlangan nusxa ham bitta `ReportSnapshot` dan chiziladi:
 * "Qayd etish" bosilganda aynan shu obyekt `ProductionReport.data` ga yoziladi va keyin o'zgarmaydi —
 * ertasi kuni zames yoki davomat tuzatilsa ham direktor ko'rgan raqam tarixda qoladi.
 */

export type StockLevel = "short" | "low" | "ok";
export type ReportSnapshot = {
  v: 1;
  iso: string;
  ym: string;
  staff: {
    total: number; present: number; absent: number; sick: number; leave: number; dayoff: number; notMarked: number; unassigned: number;
    groups: { name: string; total: number; present: number }[];
    away: { name: string; status: string }[];
    presentList: { name: string; brigade: string | null; checkIn: string | null; checkOut: string | null }[];
  };
  plan: {
    workDays: number; elapsed: number;
    rows: { code: string; name: string; unit: string; day: number; dayPlan: number | null; month: number; monthPlan: number | null; monthPct: number | null; behind: number | null; defectDay: number; defectMonth: number }[];
  };
  producedToday: string;
  load: { total: string; orders: { orderNo: string; time: string | null; customer: string; items: string; shipped: number; left: number }[] };
  brigades: { name: string; leader: string | null; today: string; month: string; open: number; overdue: number }[];
  defects: { time: string; code: string; qty: number; unit: string; reason: string; brigade: string | null; by: string }[];
  stock: { name: string; unit: string; balance: number; perDay: number; days: number | null; planned: number; minStock: number; need: number; level: StockLevel }[];
};

const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

/**
 * Xomashyo holati: kam qolgani va qancha kerakligi.
 * `need` — zayavkalarga yetishi va minimal qoldiqqa chiqishi uchun yetishmayotgan miqdor.
 * `short` — tasdiqlangan zayavkalarga yetmaydi yoki 3 kunga yetmaydi; `low` — minimaldan kam yoki 7 kundan kam.
 */
export async function stockStatus() {
  const rows = await materialOutlook();
  return rows
    .map((m) => {
      const need = Math.max(0, m.planned - m.balance, m.minStock - m.balance);
      const level: StockLevel = m.short || (m.days !== null && m.days < 3) ? "short" : m.balance < m.minStock || (m.days !== null && m.days < 7) ? "low" : "ok";
      return { name: m.name, unit: m.unit, balance: m.balance, perDay: m.perDay, days: m.days, planned: m.planned, minStock: m.minStock, need, level, id: m.id };
    })
    .sort((a, b) => ({ short: 0, low: 1, ok: 2 })[a.level] - ({ short: 0, low: 1, ok: 2 })[b.level] || (a.days ?? 1e9) - (b.days ?? 1e9) || a.name.localeCompare(b.name));
}
/** Ko'rsatish uchun: kam qolganlarning hammasi + yetarlilardan eng tez tugaydiganlari (`okTake` ta). */
export function stockHighlights<T extends { level: StockLevel; days: number | null }>(list: T[], okTake = 10) {
  const low = list.filter((m) => m.level !== "ok");
  const ok = list.filter((m) => m.level === "ok" && m.days !== null).slice(0, okTake);
  return { low, ok, rest: list.length - low.length - ok.length };
}
export const STOCK_LEVEL_LABEL: Record<StockLevel, string> = { short: "Yetmaydi", low: "Kam qoldi", ok: "Yetarli" };

/** Kun raqamlari → hisobot obyekti (serializatsiyaga tayyor). */
export async function buildReport(iso = today()): Promise<ReportSnapshot> {
  const [d, stock] = await Promise.all([productionDay(iso), stockStatus()]);
  const ids = [...new Set([...d.plan.rows.map((p) => p.product.id), ...d.produced.map((r) => r.product.id)])];
  return {
    v: 1, iso, ym: d.ym,
    staff: {
      total: d.staff.total, present: d.attendance.present.length, absent: d.attendance.absent, sick: d.attendance.sick, leave: d.attendance.leave,
      dayoff: d.attendance.dayoff, notMarked: d.attendance.notMarked.length, unassigned: d.staff.unassigned,
      groups: d.staff.groups.filter((g) => g.total > 0).map((g) => ({ name: g.name, total: g.total, present: g.present })),
      away: d.attendance.away.map((e) => ({ name: e.fullName, status: markOf(e.status).label })),
      presentList: d.attendance.present.map((e) => ({ name: e.fullName, brigade: e.brigade, checkIn: e.checkIn, checkOut: e.checkOut })),
    },
    plan: {
      workDays: d.plan.workDays, elapsed: d.plan.elapsed,
      rows: ids.map((id) => {
        const p = d.plan.rows.find((x) => x.product.id === id);
        const r = d.produced.find((x) => x.product.id === id);
        const prod = p?.product ?? r!.product;
        return {
          code: prod.code, name: prod.name, unit: prod.unit,
          day: r?.day ?? 0, dayPlan: p ? p.dayQty : null, month: r?.month ?? 0, monthPlan: p ? p.monthQty : null,
          monthPct: p ? p.monthPct : null, behind: p ? p.behind : null, defectDay: r?.defectDay ?? 0, defectMonth: r?.defectMonth ?? 0,
        };
      }),
    },
    producedToday: fmtUnitTotals(d.produced.filter((r) => r.day > 0).map((r) => ({ unit: r.product.unit, qty: r.day }))),
    load: {
      total: d.load.products.map((p) => `${p.code} ${+p.need.toFixed(2)} ${unitLabel(p.unit)}`).join(" · "),
      orders: d.load.orders.map((o) => ({ orderNo: o.orderNo, time: o.time, customer: o.customer, items: o.items.map((i) => `${i.code} ${+i.qty.toFixed(2)} ${unitLabel(i.unit)}`).join(", "), shipped: o.shipped, left: o.left })),
    },
    brigades: d.brigades.map((b) => ({
      name: b.name, leader: b.leader, today: b.today.map((t) => `${t.product} ${+t.qty.toFixed(2)} ${unitLabel(t.unit)}`).join("; "),
      month: b.monthText, open: b.openCount, overdue: b.overdue,
    })),
    defects: d.defects.today.map((r) => ({ time: hhmm(r.date), code: r.product.code, qty: r.qty, unit: r.product.unit, reason: r.note ? `${r.reason} · ${r.note}` : r.reason, brigade: r.brigade, by: r.by })),
    // Varaqqa hamma xomashyo emas: kam qolganlar + eng tez tugaydigan 10 tasi
    stock: (() => { const h = stockHighlights(stock); return [...h.low, ...h.ok].map((s) => ({ name: s.name, unit: s.unit, balance: s.balance, perDay: s.perDay, days: s.days, planned: s.planned, minStock: s.minStock, need: s.need, level: s.level })); })(),
  };
}

/** Bir qatorli xulosa — direktor ro'yxatda birinchi shuni o'qiydi. */
export function reportSummary(r: ReportSnapshot) {
  const lagging = r.plan.rows.filter((p) => (p.behind ?? 0) > 0).length;
  const shortStock = r.stock.filter((s) => s.level !== "ok").length;
  return [
    `ishda ${r.staff.present}/${r.staff.total}`,
    r.producedToday && r.producedToday !== "0" ? `chiqarildi ${r.producedToday}` : "ishlab chiqarish qayd qilinmagan",
    r.defects.length ? `brak ${r.defects.length} ta` : null,
    lagging ? `${lagging} mahsulot plandan orqada` : null,
    shortStock ? `${shortStock} xomashyo kam` : null,
  ].filter(Boolean).join(" · ");
}

/** "Qayd etish": hozirgi raqamlarni muzlatib saqlaydi va direktorga xabar beradi. */
export async function submitReport(userId: string, iso: string, note: string | null) {
  if (iso > today()) return { error: "Kelajak kunga hisobot yozib bo'lmaydi" } as const;
  const snap = await buildReport(iso);
  const summary = reportSummary(snap);
  const rep = await db.$transaction(async (tx) => {
    const r = await tx.productionReport.create({ data: { date: dayUtc(iso), data: snap as unknown as Prisma.InputJsonValue, summary, note, createdById: userId } });
    await audit(tx, userId, "CREATE", "ProductionReport", r.id, undefined, { kun: iso, summary });
    return r;
  });
  notifyAfter(() => notifyRoles(["DIRECTOR"], {
    type: "PRODUCTION_REPORT", title: `Ishlab chiqarish hisoboti · ${iso.split("-").reverse().join(".")}`, body: summary,
    link: { key: "prod-report", id: rep.id }, channel: "oddiy",
  }));
  return { ok: true, id: rep.id, summary } as const;
}

/** Tarix — oxirgi hisobotlar (kun ichida bir necha nusxa bo'lsa, hammasi). */
export async function reportHistory(take = 30) {
  const rows = await db.productionReport.findMany({
    orderBy: [{ date: "desc" }, { createdAt: "desc" }], take,
    select: { id: true, date: true, summary: true, note: true, createdAt: true, seenAt: true, createdBy: { select: { fullName: true } } },
  });
  // Bir kunning nechanchi nusxasi — eng oxirgisi asosiy, oldingilari "avvalgi nusxa"
  const seen = new Map<string, number>();
  return rows.map((r) => {
    const iso = isoDay(r.date);
    const n = (seen.get(iso) ?? 0) + 1; seen.set(iso, n);
    return { ...r, iso, latest: n === 1, by: r.createdBy.fullName };
  });
}

/** Saqlangan hisobot; direktor ochsa — "ko'rildi" belgisi qo'yiladi. */
export async function loadReport(id: string, viewer?: { userId: string; role: string }) {
  const r = await db.productionReport.findUnique({ where: { id }, include: { createdBy: { select: { fullName: true } } } });
  if (!r) return null;
  if (viewer?.role === "DIRECTOR" && !r.seenAt) {
    await db.productionReport.update({ where: { id }, data: { seenAt: new Date(), seenById: viewer.userId } }).catch(() => undefined);
  }
  return { ...r, snap: r.data as unknown as ReportSnapshot, iso: isoDay(r.date), by: r.createdBy.fullName };
}
