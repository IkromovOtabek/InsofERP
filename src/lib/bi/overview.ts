import { db } from "@/lib/db";
import { loadSales, sum, safeDiv, delta, kpi, series, addDays, startOfDay, CAPITAL_RATE_DAY, type Range } from "./core";
import { lossChannels } from "./finance";
import { customerBase } from "./customers";
import { materialOverview } from "./stock";

export type Task = { n: number; money: number; title: string; text: string; href: string; tone: "danger" | "warning" | "info" };

export async function overviewTab(r: Range) {
  const today = startOfDay(new Date()), tomorrow = addDays(today, 1), yesterday = addDays(today, -1);
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1), prevMonthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 1);
  const [todayS, yestS, monthS, prevMonthS, cur, prev, loss, customers, materials, mixers, overdueOrders, blockedCount, last30, cashAgg, prevCashAgg, tripsToday] = await Promise.all([
    loadSales(today, tomorrow), loadSales(yesterday, today), loadSales(monthStart, tomorrow), loadSales(prevMonthStart, monthStart), loadSales(r.from, r.to), loadSales(r.prevFrom, r.prevTo),
    lossChannels(r), customerBase(), materialOverview(),
    db.vehicle.findMany({ where: { isActive: true, type: "MIXER" }, include: { trips: { where: { createdAt: { gte: addDays(today, -7) } }, select: { id: true } } } }),
    db.order.findMany({ where: { kind: "SALE", status: { in: ["CONFIRMED", "IN_PRODUCTION"] }, deliveryDate: { lt: today } }, include: { customer: true, items: true, trips: { where: { status: { not: "CANCELLED" } } } } }),
    db.order.count({ where: { status: "BLOCKED" } }),
    loadSales(addDays(today, -29), tomorrow),
    db.payment.aggregate({ where: { date: { gte: r.from, lt: r.to } }, _sum: { amount: true } }),
    db.payment.aggregate({ where: { date: { gte: r.prevFrom, lt: r.prevTo } }, _sum: { amount: true } }),
    db.trip.findMany({ where: { createdAt: { gte: today } }, select: { status: true, qtyM3: true } }),
  ]);

  const rev = (rows: { revenue: number }[]) => sum(rows.map((x) => x.revenue));
  const todayRevenue = rev(todayS), yestRevenue = rev(yestS), monthRevenue = rev(monthS), prevMonthRevenue = rev(prevMonthS);
  const daysPassed = Math.max(1, Math.round((today.getTime() - monthStart.getTime()) / 86400000) + 1);
  const daysInMonth = Math.round((monthEnd.getTime() - monthStart.getTime()) / 86400000);
  const planPerDay = prevMonthRevenue / Math.max(1, Math.round((monthStart.getTime() - prevMonthStart.getTime()) / 86400000));
  const monthForecast = (monthRevenue / daysPassed) * daysInMonth;

  const revenue = rev(cur), prevRevenue = rev(prev);
  const gross = sum(cur.map((x) => x.revenue - x.cost)), prevGross = sum(prev.map((x) => x.revenue - x.cost));
  const margin = safeDiv(gross, revenue) * 100, prevMargin = safeDiv(prevGross, prevRevenue) * 100;
  const cashIn = Number(cashAgg._sum.amount ?? 0), prevCashIn = Number(prevCashAgg._sum.amount ?? 0);
  const receivable = sum(customers.map((c) => c.debt));
  const active = customers.filter((c) => c.recency !== null && c.recency < 30).length;
  const lostCount = customers.filter((c) => c.segment === "Lost").length;
  const spark = series(last30, addDays(today, -29), tomorrow, "day", (x) => x.date, (x) => x.revenue).map((x) => x.value);

  // Biznes salomatligi — 5 komponent × 20 ball
  const overdueDebt = sum(customers.map((c) => c.overdueDebt));
  const debtRatio = safeDiv(overdueDebt, Math.max(1, monthRevenue || prevMonthRevenue));
  const stockOk = safeDiv(materials.filter((m) => m.zone === "Yaxshi" || m.zone === "Ma'lumot yo'q").length, Math.max(1, materials.length));
  const delivered = tripsToday.filter((t) => t.status === "DELIVERED").length;
  const growth = safeDiv(revenue - prevRevenue, prevRevenue || revenue || 1);
  const blockedShare = safeDiv(blockedCount, Math.max(1, new Set(cur.map((x) => x.orderId)).size + blockedCount));
  // Ma'lumoti yo'q ko'rsatkich ballanmaydi (`null`) — aks holda bo'sh baza "yaxshi" ko'rinadi:
  // qarz yo'q = 20 ball, bloklangan zayavka yo'q = 20 ball → jami 50/100 "E'tibor talab".
  const ordersInRange = new Set(cur.map((x) => x.orderId)).size;
  const components: { label: string; score: number | null; text: string }[] = [
    { label: "Debitorka nazorati", score: customers.length ? Math.round(20 * Math.max(0, 1 - Math.min(1, debtRatio))) : null,
      text: customers.length ? `Muddati o'tgan qarz oylik sotuvning ${Math.round(debtRatio * 100)}%i` : "Mijoz bazasi bo'sh" },
    { label: "Xomashyo zaxirasi", score: materials.length ? Math.round(20 * stockOk) : null,
      text: materials.length ? `${materials.filter((m) => m.zone === "Kritik" || m.zone === "Xavfli").length} ta xomashyo xavf zonasida` : "Xomashyo spravochnigi bo'sh" },
    { label: "Marja", score: revenue > 0 ? Math.round(20 * Math.min(1, Math.max(0, margin / 25))) : null,
      text: revenue > 0 ? `Yalpi marja ${margin.toFixed(1)}% (maqsad ≥25%)` : "Davr ichida sotuv yo'q" },
    { label: "Sotuv o'sishi", score: revenue > 0 || prevRevenue > 0 ? Math.round(20 * Math.min(1, Math.max(0, 0.5 + growth))) : null,
      text: revenue > 0 || prevRevenue > 0 ? `Oldingi davrga nisbatan ${growth >= 0 ? "▲" : "▼"} ${Math.abs(growth * 100).toFixed(1)}%` : "Taqqoslash uchun sotuv yo'q" },
    { label: "Zayavka oqimi", score: ordersInRange + blockedCount + overdueOrders.length > 0 ? Math.round(20 * (1 - Math.min(1, blockedShare * 3)) * (overdueOrders.length ? 0.6 : 1)) : null,
      text: ordersInRange + blockedCount + overdueOrders.length > 0 ? `${blockedCount} ta bloklangan, ${overdueOrders.length} ta muddati o'tgan zayavka` : "Davr ichida zayavka yo'q" },
  ];
  // Ball mavjud ko'rsatkichlar bo'yicha normallashtiriladi (3 tasi bo'lsa — 60 balldan emas, 100 balldan).
  // 3 tadan kam bo'lsa umuman ko'rsatilmaydi: "qarz yo'q + xomashyo ogohlantirishi yo'q" ham
  // 100 ball berardi, holbuki bu shunchaki hali ish boshlanmagani.
  const MIN_COMPONENTS = 3;
  const scored = components.filter((c): c is { label: string; score: number; text: string } => c.score !== null);
  const health = scored.length >= MIN_COMPONENTS ? Math.round(safeDiv(sum(scored.map((c) => c.score)), 20 * scored.length) * 100) : null;
  const healthLabel = health !== null ? (health >= 75 ? "Sog'lom" : health >= 50 ? "E'tibor talab" : "Xavfli") : scored.length ? "Ma'lumot yetarli emas" : "Ma'lumot yo'q";

  // Xavf ostidagi pul
  const risk = {
    debt: loss.riskyDebt, debtCount: loss.riskyDebtors,
    lostProfit: loss.blockedRevenue * loss.marginRate + loss.stockout.value, lostCount: loss.blockedOrders + loss.stockout.count,
    frozen: loss.deadValue, frozenCount: loss.deadCount,
  };
  const riskTotal = risk.debt + risk.lostProfit + risk.frozen;

  // Bugungi vazifalar — pul bo'yicha
  const tasks: Task[] = [];
  const queue = materials.filter((m) => m.suggestQty > 0 && (m.zone === "Kritik" || m.short)).sort((a, b) => b.suggestCost - a.suggestCost);
  if (queue.length) tasks.push({ n: 0, money: sum(queue.map((m) => m.suggestCost)), title: `${queue.length} ta xomashyoni bugun buyurtma qiling`, text: `${queue.slice(0, 3).map((m) => m.name).join(", ")} — ${queue[0].zone === "Kritik" ? "7 kundan kam qoldi" : "tasdiqlangan zayavkalarga yetmaydi"}.`, href: "/receipts/new", tone: "danger" });
  const debtors = customers.filter((c) => c.overdueDebt > 0).sort((a, b) => b.overdueDebt - a.overdueDebt);
  if (debtors.length) tasks.push({ n: 0, money: sum(debtors.map((c) => c.overdueDebt)), title: `${debtors.length} ta qarzdorga qo'ng'iroq qiling`, text: `Eng kattalari: ${debtors.slice(0, 3).map((c) => c.name).join(", ")} — muddati 30 kundan oshgan.`, href: "/invoices", tone: "danger" });
  if (blockedCount) tasks.push({ n: 0, money: loss.blockedRevenue, title: `${blockedCount} ta bloklangan zayavkani ko'rib chiqing`, text: "Kredit limit oshgan — direktor ochishi yoki mijoz oldindan to'lashi kerak.", href: "/orders?status=BLOCKED", tone: "warning" });
  if (overdueOrders.length) tasks.push({ n: 0, money: sum(overdueOrders.map((o) => sum(o.items.map((i) => Number(i.qtyM3) * Number(i.price))))), title: `${overdueOrders.length} ta zayavka muddati o'tgan`, text: overdueOrders.slice(0, 3).map((o) => `${o.orderNo} (${o.customer.name})`).join(", "), href: "/orders", tone: "danger" });
  const atRisk = customers.filter((c) => c.segment === "At Risk").sort((a, b) => b.avgMonthly - a.avgMonthly);
  if (atRisk.length) tasks.push({ n: 0, money: sum(atRisk.map((c) => c.avgMonthly)), title: `${atRisk.length} ta mijoz ketish arafasida`, text: `45+ kun buyurtma yo'q: ${atRisk.slice(0, 3).map((c) => c.name).join(", ")} — oyiga ${Math.round(sum(atRisk.map((c) => c.avgMonthly)) / 1e6)} mln so'm keltirardi.`, href: "/bi-tahlil/mijozlar?segment=At+Risk", tone: "warning" });
  const idle = mixers.filter((m) => m.trips.length === 0);
  if (idle.length) tasks.push({ n: 0, money: 0, title: `${idle.length} ta mikser 7 kundan beri bo'sh`, text: idle.map((m) => m.plate).join(", "), href: "/drivers", tone: "info" });
  if (loss.deadCount) tasks.push({ n: 0, money: loss.deadValue, title: `${loss.deadCount} ta muzlagan xomashyoni harakatga keltiring`, text: "90 kundan beri retseptga kirmagan — qaytaring yoki soting.", href: "/stock", tone: "info" });
  if (margin < 15 && revenue > 0) tasks.push({ n: 0, money: revenue * ((15 - margin) / 100), title: `Marja past: ${margin.toFixed(1)}%`, text: `Har 100 so'm sotuvdan ${margin.toFixed(1)} so'm qolyapti — narx siyosati yoki retsept tannarxini ko'ring.`, href: "/bi-tahlil/mahsulotlar", tone: "warning" });
  const topTasks = tasks.sort((a, b) => b.money - a.money).slice(0, 5).map((t, i) => ({ ...t, n: i + 1 }));

  const goodNews: string[] = [];
  if (todayRevenue > planPerDay && planPerDay > 0) goodNews.push(`Bugungi sotuv o'tgan oy o'rtachasidan ${Math.round(((todayRevenue - planPerDay) / planPerDay) * 100)}% yuqori.`);
  if (monthForecast > prevMonthRevenue && prevMonthRevenue > 0) goodNews.push(`Hozirgi temp bilan oy oxirida o'tgan oydan ${Math.round(((monthForecast - prevMonthRevenue) / prevMonthRevenue) * 100)}% ko'p sotiladi.`);
  if (margin >= 25) goodNews.push(`Yalpi marja ${margin.toFixed(1)}% — sog'lom darajada.`);
  const topProduct = [...new Set(cur.map((x) => x.code))].map((c) => ({ c, v: sum(cur.filter((x) => x.code === c).map((x) => x.revenue)) })).sort((a, b) => b.v - a.v)[0];

  return {
    todayRevenue, yestRevenue, todayDelta: delta(todayRevenue, yestRevenue), todayM3: sum(todayS.filter((x) => x.unit === "m3").map((x) => x.qty)), delivered, tripsToday: tripsToday.filter((t) => t.status !== "CANCELLED").length,
    month: { revenue: monthRevenue, prev: prevMonthRevenue, forecast: monthForecast, planPerDay, perDay: monthRevenue / daysPassed, daysPassed, daysLeft: daysInMonth - daysPassed, delta: delta(monthRevenue, prevMonthRevenue) },
    kpis: { revenue: kpi(revenue, prevRevenue), gross: kpi(gross, prevGross), margin: kpi(margin, prevMargin), cashIn: kpi(cashIn, prevCashIn), receivable, debtors: customers.filter((c) => c.debt > 0).length, active, total: customers.length, lost: lostCount, activeRate: safeDiv(active, customers.length) * 100 },
    spark, health, healthLabel, healthBasis: scored.length, components, risk, riskTotal, capitalCost30: riskTotal * CAPITAL_RATE_DAY * 30, loss, tasks: topTasks, goodNews, topProduct, materialsAtRisk: materials.filter((m) => m.zone === "Kritik" || m.zone === "Xavfli").length,
  };
}
