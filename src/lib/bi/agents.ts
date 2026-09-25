import { db } from "@/lib/db";
import { type Range, loadSales, sum, safeDiv, mean, kpi, addDays, startOfDay, WEEKDAYS, type SaleRow } from "./core";
import { operationsTab } from "./operations";

/**
 * Agentlar — Team24 "Agentlar" sahifasining beton zavodi ekvivalenti.
 * Agent = zayavka kiritadigan sotuvchi (User). "Tashrif" = kiritilgan zayavka, "sotuv" = tasdiqlangan zayavka tushumi.
 */
export type SellerRow = {
  id: string; name: string; role: string; orders: number; revenue: number; volume: number; customers: number; avgCheck: number;
  created: number; cancelled: number; cancelledRevenue: number; blocked: number; drafts: number; conversion: number; cancelRate: number;
  prevRevenue: number; delta: number | null; usualPerDay: number; nowPerDay: number; slowdown: number; slowReason: "Kam zayavka" | "Chek tushgan" | "Ikkalasi" | "Sabab noaniq" | null; slowDays: number;
  usualOrdersPerDay: number; nowOrdersPerDay: number; usualCheck: number; nowCheck: number;
  today: number; todayOrders: number; lastOrderAt: Date | null; offlineDays: number | null; plan: number | null; planPct: number | null; score: number; tier: "TOP" | "YAXSHI" | "O'RTA" | "PAST"; weekday: number[];
};

export async function agentsTab(r: Range) {
  const today = startOfDay(new Date()), tomorrow = addDays(today, 1);
  const [cur, prev, allCreated, last35, users, plans, ops, tomorrowOrders, vehicles] = await Promise.all([
    loadSales(r.from, r.to), loadSales(r.prevFrom, r.prevTo),
    db.order.findMany({ where: { kind: "SALE", date: { gte: r.from, lt: r.to } }, select: { id: true, status: true, createdById: true, items: { select: { qtyM3: true, price: true } } } }),
    loadSales(addDays(today, -35), tomorrow),
    db.user.findMany({ where: { isActive: true }, select: { id: true, fullName: true, role: true } }),
    db.salesPlan.findMany({ where: { year: today.getFullYear(), month: today.getMonth() + 1 } }),
    operationsTab(r, "day"),
    db.order.findMany({ where: { kind: "SALE", deliveryDate: { gte: tomorrow, lt: addDays(tomorrow, 1) }, status: { in: ["CONFIRMED", "IN_PRODUCTION"] } }, include: { customer: { select: { name: true } }, items: { select: { qtyM3: true } }, trips: { where: { status: { not: "CANCELLED" } }, select: { qtyM3: true } } }, orderBy: { deliveryAddress: "asc" } }),
    db.vehicle.findMany({ where: { isActive: true, type: "MIXER" }, select: { capacityM3: true } }),
  ]);
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const monthSales = last35.filter((x) => x.date >= monthStart);
  const rev = (rows: SaleRow[]) => sum(rows.map((x) => x.revenue));
  const sellerIds = new Set<string>([...cur.map((x) => x.sellerId), ...allCreated.map((o) => o.createdById), ...last35.map((x) => x.sellerId), ...users.filter((u) => u.role === "SALES").map((u) => u.id)]);
  const nameOf = new Map(users.map((u) => [u.id, u]));

  const sellers: SellerRow[] = [...sellerIds].map((id) => {
    const u = nameOf.get(id); const name = u?.fullName ?? cur.find((x) => x.sellerId === id)?.seller ?? "Noma'lum";
    const rows = cur.filter((x) => x.sellerId === id), prows = prev.filter((x) => x.sellerId === id);
    const created = allCreated.filter((o) => o.createdById === id);
    const cancelled = created.filter((o) => o.status === "CANCELLED"), blocked = created.filter((o) => o.status === "BLOCKED"), drafts = created.filter((o) => o.status === "DRAFT");
    const orders = new Set(rows.map((x) => x.orderId)).size, revenue = rev(rows);
    // Odatiy temp: oxirgi 28 kun (7 kun oldingi) vs oxirgi 7 kun
    const base = last35.filter((x) => x.sellerId === id && x.date >= addDays(today, -35) && x.date < addDays(today, -7));
    const now = last35.filter((x) => x.sellerId === id && x.date >= addDays(today, -7));
    const usualPerDay = rev(base) / 28, nowPerDay = rev(now) / 7;
    const usualOrdersPerDay = new Set(base.map((x) => x.orderId)).size / 28, nowOrdersPerDay = new Set(now.map((x) => x.orderId)).size / 7;
    const usualCheck = safeDiv(rev(base), new Set(base.map((x) => x.orderId)).size), nowCheck = safeDiv(rev(now), new Set(now.map((x) => x.orderId)).size);
    const slowdown = usualPerDay > 0 ? (nowPerDay - usualPerDay) / usualPerDay : 0;
    const fewer = usualOrdersPerDay > 0 && nowOrdersPerDay < usualOrdersPerDay * 0.85, lower = usualCheck > 0 && nowCheck < usualCheck * 0.85;
    const slowReason: SellerRow["slowReason"] = slowdown < -0.15 ? (fewer && lower ? "Ikkalasi" : fewer ? "Kam zayavka" : lower ? "Chek tushgan" : "Sabab noaniq") : null;
    // Necha kundan beri past: oxirgi kunlardan orqaga, kunlik tushum odatiydan past bo'lgan ketma-ket kunlar
    let slowDays = 0; for (let d = 0; d < 7; d++) { const day = addDays(today, -d); const v = rev(last35.filter((x) => x.sellerId === id && x.date >= day && x.date < addDays(day, 1))); if (usualPerDay > 0 && v < usualPerDay * 0.85) slowDays++; else break; }
    const todayRows = last35.filter((x) => x.sellerId === id && x.date >= today);
    const lastOrderAt = last35.filter((x) => x.sellerId === id).sort((a, b) => b.date.getTime() - a.date.getTime())[0]?.date ?? null;
    const offlineDays = lastOrderAt ? Math.floor((today.getTime() - startOfDay(lastOrderAt).getTime()) / 86400000) : null;
    const plan = plans.find((p) => p.sellerId === id); const monthRev = rev(monthSales.filter((x) => x.sellerId === id));
    const weekday = WEEKDAYS.map((_, wd) => last35.filter((x) => x.sellerId === id && x.date >= addDays(today, -27) && x.date.getDay() === wd).length);
    const conversion = safeDiv(created.length - cancelled.length - drafts.length, created.length) * 100;
    return {
      id, name, role: u?.role ?? "—", orders, revenue, volume: sum(rows.filter((x) => x.unit === "m3").map((x) => x.qty)), customers: new Set(rows.map((x) => x.customerId)).size, avgCheck: safeDiv(revenue, orders),
      created: created.length, cancelled: cancelled.length, cancelledRevenue: sum(cancelled.map((o) => sum(o.items.map((i) => Number(i.qtyM3) * Number(i.price))))), blocked: blocked.length, drafts: drafts.length, conversion, cancelRate: safeDiv(cancelled.length, created.length) * 100,
      prevRevenue: rev(prows), delta: rev(prows) === 0 ? (revenue ? null : 0) : ((revenue - rev(prows)) / rev(prows)) * 100,
      usualPerDay, nowPerDay, slowdown, slowReason, slowDays, usualOrdersPerDay, nowOrdersPerDay, usualCheck, nowCheck,
      today: rev(todayRows), todayOrders: new Set(todayRows.map((x) => x.orderId)).size, lastOrderAt, offlineDays,
      plan: plan ? Number(plan.amount) : null, planPct: plan && Number(plan.amount) > 0 ? (monthRev / Number(plan.amount)) * 100 : null, score: 0, tier: "O'RTA" as SellerRow["tier"], weekday,
    };
  }).filter((s) => s.created > 0 || s.orders > 0 || s.role === "SALES");

  const maxRev = Math.max(1, ...sellers.map((s) => s.revenue));
  for (const s of sellers) {
    const score = Math.round(0.45 * (s.revenue / maxRev) * 100 + 0.25 * s.conversion + 0.15 * Math.max(0, 100 - s.cancelRate * 4) + 0.15 * Math.min(100, Math.max(0, 50 + (s.delta ?? 0))));
    s.score = score; s.tier = score >= 75 ? "TOP" : score >= 55 ? "YAXSHI" : score >= 35 ? "O'RTA" : "PAST";
  }
  sellers.sort((a, b) => b.revenue - a.revenue);

  const working = sellers.filter((s) => s.orders > 0);
  const avgRevenue = mean(working.map((s) => s.revenue));
  const top = working.slice(0, 5), bottom = [...working].reverse().slice(0, Math.min(5, Math.max(0, working.length - 5)));
  const offline = sellers.filter((s) => s.offlineDays !== null && s.offlineDays >= 3);
  const neverActive = sellers.filter((s) => s.offlineDays === null);
  const slow = sellers.filter((s) => s.slowReason).sort((a, b) => (b.usualPerDay - b.nowPerDay) - (a.usualPerDay - a.nowPerDay));
  const slowLoss = sum(slow.map((s) => s.usualPerDay - s.nowPerDay));
  const reasons = (["Kam zayavka", "Chek tushgan", "Ikkalasi", "Sabab noaniq"] as const).map((k) => ({ key: k, list: slow.filter((s) => s.slowReason === k), loss: sum(slow.filter((s) => s.slowReason === k).map((s) => s.usualPerDay - s.nowPerDay)) }));

  // Zayavka sifati (Visit Quality analogi): kiritilgan zayavkalardan nechtasi tasdiqlanib sotuvga aylandi
  const totalCreated = sum(sellers.map((s) => s.created)), totalCancelled = sum(sellers.map((s) => s.cancelled)), totalDrafts = sum(sellers.map((s) => s.drafts));
  const quality = { pct: safeDiv(totalCreated - totalCancelled - totalDrafts, totalCreated) * 100, created: totalCreated, converted: totalCreated - totalCancelled - totalDrafts, perOrder: safeDiv(sum(sellers.map((s) => s.revenue)), sum(sellers.map((s) => s.orders))), revenue: sum(sellers.map((s) => s.revenue)) };
  const qualified = sellers.filter((s) => s.created >= 3);
  const medianConv = qualified.length ? [...qualified.map((s) => s.conversion)].sort((a, b) => a - b)[Math.floor(qualified.length / 2)] : 0;
  const lowQ = qualified.filter((s) => s.conversion < medianConv).sort((a, b) => a.conversion - b.conversion).slice(0, 5);
  const highQ = [...qualified].sort((a, b) => b.conversion - a.conversion).slice(0, 5);
  const upside = sum(lowQ.map((s) => Math.max(0, (medianConv - s.conversion) / 100) * s.created * s.avgCheck));

  // Reja holati (joriy oy)
  const planned = sellers.filter((s) => s.plan !== null);
  const planStatus = { withPlan: planned.length, total: sellers.length, done: planned.filter((s) => (s.planPct ?? 0) >= 100).length, behind: planned.filter((s) => (s.planPct ?? 0) < 70).length, pct: safeDiv(sum(planned.map((s) => s.plan! * Math.min(1.5, (s.planPct ?? 0) / 100))), sum(planned.map((s) => s.plan!))) * 100 };

  // Ertangi yetkazish rejasi (Route Optimization analogi)
  const cap = mean(vehicles.map((v) => Number(v.capacityM3 ?? 0)).filter((v) => v > 0)) || 8;
  const route = tomorrowOrders.map((o) => { const m3 = sum(o.items.map((i) => Number(i.qtyM3))), planned = sum(o.trips.map((t) => Number(t.qtyM3))); return { id: o.id, orderNo: o.orderNo, customer: o.customer.name, address: o.deliveryAddress, m3, planned, trips: Math.ceil(Math.max(0, m3 - planned) / cap), pump: o.needsPump }; });
  const routeTotal = sum(route.map((x) => x.m3)), routeTrips = sum(route.map((x) => x.trips));

  const kpis = {
    active: kpi(working.length, new Set(prev.map((x) => x.sellerId)).size), created: totalCreated, converted: quality.converted,
    revenue: kpi(sum(cur.map((x) => x.revenue)), sum(prev.map((x) => x.revenue))), perAgent: kpi(safeDiv(sum(cur.map((x) => x.revenue)), working.length), safeDiv(sum(prev.map((x) => x.revenue)), new Set(prev.map((x) => x.sellerId)).size)),
    todayRevenue: sum(sellers.map((s) => s.today)), todayOrders: sum(sellers.map((s) => s.todayOrders)), cancelledRevenue: sum(sellers.map((s) => s.cancelledRevenue)),
  };
  const heat = { rows: sellers.slice(0, 10).map((s) => s.name), cols: WEEKDAYS, cells: sellers.slice(0, 10).map((s) => s.weekday) };
  return { sellers, top, bottom, offline, neverActive, avgRevenue, slow, slowLoss, reasons, quality, medianConv, lowQ, highQ, upside, planStatus, route, routeTotal, routeTrips, mixerCap: cap, mixers: ops.mixers.length, drivers: ops.drivers, kpis, heat, best: working[0] ?? null };
}
