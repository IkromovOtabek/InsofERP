import { db } from "@/lib/db";
import { type Range, loadSales, productCosts, sum, safeDiv, abc, xyz, addDays, startOfDay, bucketsFor, bucketKey, bucketLabel, median, ACTIVE_ORDER } from "./core";

export type Quadrant = "Yulduzlar" | "Barqaror daromad" | "Ixtisoslashgan" | "Kam samarali";

export async function productsTab(r: Range) {
  const today = startOfDay(new Date()), from6 = new Date(today.getFullYear(), today.getMonth() - 5, 1);
  const [cur, prev, costs, hist, stockSums] = await Promise.all([
    loadSales(r.from, r.to), loadSales(r.prevFrom, r.prevTo), productCosts(),
    db.orderItem.findMany({ where: { order: { date: { gte: from6 }, status: { in: ACTIVE_ORDER } } }, select: { productId: true, qtyM3: true, price: true, order: { select: { date: true } } } }),
    db.stockMove.groupBy({ by: ["productId"], where: { productId: { not: null } }, _sum: { qty: true } }),
  ]);
  const stock = new Map(stockSums.map((s) => [s.productId as string, Number(s._sum.qty ?? 0)]));
  const months = bucketsFor(from6, addDays(today, 1), "month");

  const ids = [...costs.keys()];
  const rows = ids.map((id) => {
    const c = costs.get(id)!;
    const cRows = cur.filter((x) => x.productId === id), pRows = prev.filter((x) => x.productId === id);
    const revenue = sum(cRows.map((x) => x.revenue)), qty = sum(cRows.map((x) => x.qty)), gross = sum(cRows.map((x) => x.revenue - x.cost));
    const prevRevenue = sum(pRows.map((x) => x.revenue));
    const monthly = months.map((m) => sum(hist.filter((h) => h.productId === id && bucketKey(h.order.date, "month") === m).map((h) => Number(h.qtyM3))));
    const monthlyRev = months.map((m) => sum(hist.filter((h) => h.productId === id && bucketKey(h.order.date, "month") === m).map((h) => Number(h.qtyM3) * Number(h.price))));
    const avgPrice = safeDiv(revenue, qty);
    const cmUnit = c.cost === null ? null : (avgPrice || c.price) - c.cost;
    const first = monthly.slice(0, 3), last = monthly.slice(3);
    const trend = safeDiv(sum(last) - sum(first), sum(first) || sum(last) || 1) * 100;
    return { id, code: c.code, name: c.name, unit: c.unit, isActive: c.isActive, price: c.price, cost: c.cost, revenue, qty, gross, margin: safeDiv(gross, revenue) * 100, prevRevenue, growth: safeDiv(revenue - prevRevenue, prevRevenue || revenue || 1) * 100, monthly, monthlyRev, xyz: xyz(monthly), cmUnit, avgPrice, trend, stock: stock.get(id) ?? 0, velocity: sum(monthly) / Math.max(1, (today.getTime() - from6.getTime()) / 86400000) };
  });
  const totalRevenue = sum(rows.map((x) => x.revenue));
  const abcMap = abc(rows, (x) => x.revenue);
  const withAbc = rows.map((x) => ({ ...x, abc: abcMap.get(x) ?? "C", share: safeDiv(x.revenue, totalRevenue) * 100 })).sort((a, b) => b.revenue - a.revenue);

  // ABC × XYZ matritsa
  const matrix = (["A", "B", "C"] as const).map((a) => (["X", "Y", "Z", "N"] as const).map((z) => withAbc.filter((x) => x.abc === a && x.xyz === z)));

  // Foydalilik kvadrantlari: daromad × marja, mediana bo'yicha
  const sold = withAbc.filter((x) => x.revenue > 0);
  const medRev = median(sold.map((x) => x.revenue)), medMargin = median(sold.map((x) => x.margin));
  const quadrant = (x: { revenue: number; margin: number }): Quadrant => x.revenue >= medRev ? (x.margin >= medMargin ? "Yulduzlar" : "Barqaror daromad") : x.margin >= medMargin ? "Ixtisoslashgan" : "Kam samarali";
  const quadrants = withAbc.map((x) => ({ ...x, quadrant: x.revenue > 0 ? quadrant(x) : null }));
  const scatter = sold.map((x) => ({ x: x.revenue, y: x.margin, r: x.qty, label: `${x.code} — ${x.name}`, color: { Yulduzlar: "#ffa800", "Barqaror daromad": "#0d78ff", Ixtisoslashgan: "#00cb80", "Kam samarali": "#fa1636" }[quadrant(x)] }));

  // Klasterlar (tezlik × barqarorlik) — qoida asosida
  const clusterOf = (x: typeof withAbc[number]) => {
    if (x.revenue <= 0) return "Sotilmagan";
    if (x.abc === "A" && x.trend > 10) return "Stars";
    if (x.abc === "A") return "Cash Cows";
    if (x.trend > 10) return "Rising";
    if (x.xyz === "X" || x.xyz === "Y") return "Niche";
    return "Dogs";
  };
  const CLUSTER_META: Record<string, { title: string; sub: string; advice: string; color: string }> = {
    Stars: { title: "Stars", sub: "TEZ + O'SUVCHI", advice: "Xomashyo zaxirasini oldindan oshiring — tugab qolish eng qimmatga tushadigan guruh.", color: "#ffa800" },
    "Cash Cows": { title: "Cash Cows", sub: "TEZ + BARQAROR", advice: "Pul oqimi shu yerda. Chegirma bermang — u savdoni oshirmaydi, faqat marjani yeydi.", color: "#00cb80" },
    Rising: { title: "Rising", sub: "O'RTA + O'SUVCHI", advice: "O'sish bor, hajm kichik. To'g'ri qo'llab-quvvatlansa Stars ga o'tadi.", color: "#0d78ff" },
    Niche: { title: "Niche", sub: "SEKIN + BARQAROR", advice: "Doimiy, lekin kichik talab. Buyurtma bo'yicha ishlab chiqaring, katta zaxira qilmang.", color: "#8b2fff" },
    Dogs: { title: "Dogs", sub: "SEKIN + PAST", advice: "Assortimentdan chiqarish nomzodlari — avval «yo'lakay» sotilishini tekshiring.", color: "#fa1636" },
    Sotilmagan: { title: "Sotilmagan", sub: "DAVRDA SOTUV YO'Q", advice: "Narx yoki talabni qayta ko'rib chiqing.", color: "#93a3bd" },
  };
  const clusters = Object.keys(CLUSTER_META).map((k) => { const list = withAbc.filter((x) => clusterOf(x) === k); return { key: k, ...CLUSTER_META[k], count: list.length, revenue: sum(list.map((x) => x.revenue)), share: safeDiv(sum(list.map((x) => x.revenue)), totalRevenue) * 100, margin: safeDiv(sum(list.map((x) => x.gross)), sum(list.map((x) => x.revenue))) * 100, products: list.map((x) => x.code) }; }).filter((c) => c.count);

  // Pareto
  let acc = 0; const pareto = withAbc.filter((x) => x.revenue > 0).map((x) => { acc += x.revenue; return { label: x.code, value: acc / (totalRevenue || 1) * 100 }; });
  const paretoCount = Math.max(1, pareto.findIndex((p) => p.value >= 80) + 1);

  // Mahsulot × oy (hajm)
  const monthLabels = months.map((m) => bucketLabel(m, "month"));

  const cards = {
    sku: rows.filter((x) => x.isActive).length, aaa: withAbc.filter((x) => x.abc === "A" && x.xyz === "X").length,
    avgMargin: safeDiv(sum(withAbc.map((x) => x.gross)), totalRevenue) * 100,
    noRecipe: rows.filter((x) => x.cost === null && x.isActive).length,
    frozen: sum(withAbc.filter((x) => x.unit !== "m3" && x.stock > 0).map((x) => x.stock * (x.cost ?? 0))),
    growing: withAbc.filter((x) => x.trend > 10 && x.revenue > 0).length,
    lowMargin: withAbc.filter((x) => x.revenue > 0 && x.margin < 10).length,
  };
  const productsWithClusters = quadrants.map((x) => ({ ...x, cluster: clusterOf(x) }));
  return { rows: productsWithClusters, matrix, scatter, medRev, medMargin, clusters, pareto, paretoCount, monthLabels, cards, totalRevenue };
}
