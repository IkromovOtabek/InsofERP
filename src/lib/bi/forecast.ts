import { db } from "@/lib/db";
import { sum, mean, std, linreg, safeDiv, addDays, startOfDay, series, ACTIVE_ORDER, loadSales, bucketLabel, WEEKDAYS } from "./core";
import { materialOverview } from "./stock";

/** Kunlik sotuv (m³) bashorati: chiziqli trend × hafta kuni indeksi. Backtest — oxirgi 14 kun. */
function forecastSeries(hist: number[], dates: Date[], horizon: number) {
  const n = hist.length;
  const wdIdx = WEEKDAYS.map((_, wd) => { const v = hist.filter((_, i) => dates[i].getDay() === wd); return mean(v); });
  const overall = mean(hist) || 1;
  const season = wdIdx.map((v) => (v > 0 ? v / overall : 1));
  const deseason = hist.map((v, i) => v / (season[dates[i].getDay()] || 1));
  const { a, b } = linreg(deseason);
  const pred = (i: number, d: Date) => Math.max(0, (a + b * i) * (season[d.getDay()] || 1));
  const future = Array.from({ length: horizon }, (_, k) => { const d = addDays(dates[n - 1], k + 1); return { date: d, value: pred(n + k, d) }; });
  // Backtest: oxirgi 14 kunni undan oldingi ma'lumotdan bashorat qilish
  const cut = Math.max(7, n - 14);
  const trainD = deseason.slice(0, cut); const lr = linreg(trainD);
  const test = hist.slice(cut).map((actual, k) => ({ actual, pred: Math.max(0, (lr.a + lr.b * (cut + k)) * (season[dates[cut + k].getDay()] || 1)) }));
  const mae = mean(test.map((t) => Math.abs(t.actual - t.pred)));
  const wape = safeDiv(sum(test.map((t) => Math.abs(t.actual - t.pred))), sum(test.map((t) => t.actual))) * 100;
  const bias = safeDiv(sum(test.map((t) => t.pred - t.actual)), sum(test.map((t) => t.actual))) * 100;
  return { future, mae, wape, bias, season, slope: b };
}

export async function forecastTab() {
  const today = startOfDay(new Date()), from60 = addDays(today, -60);
  const [sales, materials, batches, shares, products] = await Promise.all([
    loadSales(from60, addDays(today, 1)), materialOverview(),
    db.productionBatch.findMany({ where: { date: { gte: from60 } }, select: { date: true, qtyM3: true } }),
    db.orderItem.findMany({ where: { order: { date: { gte: addDays(today, -30) }, status: { in: ACTIVE_ORDER } } }, select: { productId: true, qtyM3: true } }),
    db.product.findMany({ where: { isActive: true }, include: { recipes: { where: { isActive: true }, include: { items: true } } } }),
  ]);
  const m3 = sales.filter((x) => x.unit === "m3");
  const daily = series(m3, from60, addDays(today, 1), "day", (x) => x.date, (x) => x.qty);
  const dates = daily.map((d) => new Date(d.key));
  const fc = forecastSeries(daily.map((d) => d.value), dates, 30);
  const next7 = sum(fc.future.slice(0, 7).map((f) => f.value)), next30 = sum(fc.future.map((f) => f.value));
  const revenueDaily = series(sales, from60, addDays(today, 1), "day", (x) => x.date, (x) => x.revenue);
  const avgPrice = safeDiv(sum(m3.map((x) => x.revenue)), sum(m3.map((x) => x.qty)));

  // Grafik: oxirgi 30 kun tarix + 14 kun bashorat
  const histTail = daily.slice(-30);
  const labels = [...histTail.map((d) => d.label), ...fc.future.slice(0, 14).map((f) => bucketLabel(`${f.date.getFullYear()}-${String(f.date.getMonth() + 1).padStart(2, "0")}-${String(f.date.getDate()).padStart(2, "0")}`, "day"))];
  const histVals: (number | null)[] = [...histTail.map((d) => d.value), ...Array(14).fill(null)];
  const fcVals: (number | null)[] = [...Array(29).fill(null), histTail.at(-1)?.value ?? 0, ...fc.future.slice(0, 14).map((f) => f.value)];

  // Xomashyo ehtiyoji — 14 kunlik bashorat × retsept aralashmasi (so'nggi 30 kun ulushi)
  const totalShare = sum(shares.map((s) => Number(s.qtyM3))) || 1;
  const mix = new Map<string, number>(); for (const s of shares) mix.set(s.productId, (mix.get(s.productId) ?? 0) + Number(s.qtyM3) / totalShare);
  const need14 = new Map<string, number>();
  const fc14 = sum(fc.future.slice(0, 14).map((f) => f.value));
  for (const p of products) { const sh = mix.get(p.id) ?? 0; if (!sh) continue; for (const ri of p.recipes[0]?.items ?? []) need14.set(ri.materialId, (need14.get(ri.materialId) ?? 0) + fc14 * sh * Number(ri.qtyPerM3)); }
  const matForecast = materials.map((m) => { const need = need14.get(m.id) ?? 0; const perDay = need / 14 || m.perDay; const daysLeft = perDay > 0 ? m.balance / perDay : null; return { ...m, need14, need, perDayFc: perDay, daysLeft, runsOut: daysLeft !== null ? addDays(today, Math.floor(daysLeft)) : null, orderQty: Math.max(0, need + m.minStock - m.balance) }; }).sort((a, b) => (a.daysLeft ?? 9999) - (b.daysLeft ?? 9999));

  // Ishlab chiqarish quvvati: o'rtacha kunlik va eng yuqori kun
  const prodDaily = series(batches, from60, addDays(today, 1), "day", (b) => b.date, (b) => Number(b.qtyM3)).map((x) => x.value);
  const capacity = { avg: mean(prodDaily.filter((v) => v > 0)), peak: Math.max(0, ...prodDaily), needPerDay: next7 / 7 };

  // Hafta kuni indeksi
  const weekday = WEEKDAYS.map((w, i) => ({ label: w, value: fc.season[i] * 100 }));

  const zones = { critical: matForecast.filter((m) => m.daysLeft !== null && m.daysLeft < 7).length, mid: matForecast.filter((m) => m.daysLeft !== null && m.daysLeft >= 7 && m.daysLeft < 14).length, ok: matForecast.filter((m) => m.daysLeft === null || m.daysLeft >= 14).length };
  return { next7, next30, next7Revenue: next7 * avgPrice, next30Revenue: next30 * avgPrice, mae: fc.mae, wape: fc.wape, bias: fc.bias, slope: fc.slope, labels, histVals, fcVals, matForecast, capacity, weekday, zones, revenueTrend: revenueDaily.slice(-30).map((x) => x.value), modelTrained: today, histDays: daily.length };
}

/* ───────────── Anomaliyalar (qoida asosida) ───────────── */

export type Anomaly = { id: string; date: Date; level: "High" | "Medium" | "Low"; score: number; source: "Sotuv" | "To'lov" | "Ishlab chiqarish" | "Sklad" | "Logistika"; pattern: string; title: string; detail: string; amount: number; href?: string; who?: string };

export async function anomaliesTab(filter: { level?: string; source?: string; pattern?: string; days: number }) {
  const today = startOfDay(new Date()), since = addDays(today, -Math.max(7, filter.days));
  const [items, payments, batches, adjustments, trips] = await Promise.all([
    db.orderItem.findMany({ where: { order: { date: { gte: since } } }, include: { product: { select: { code: true, price: true } }, order: { select: { id: true, orderNo: true, date: true, status: true, customer: { select: { name: true } }, createdBy: { select: { fullName: true } } } } } }),
    db.payment.findMany({ where: { date: { gte: since } }, include: { customer: { select: { name: true } }, cashAccount: { select: { name: true } } } }),
    db.productionBatch.findMany({ where: { date: { gte: since } }, include: { product: { select: { code: true } }, createdBy: { select: { fullName: true } } } }),
    db.stockMove.findMany({ where: { date: { gte: since }, type: { in: ["ADJUSTMENT", "WRITE_OFF"] } }, include: { material: { select: { name: true } }, product: { select: { code: true } }, createdBy: { select: { fullName: true } } } }),
    db.trip.findMany({ where: { createdAt: { gte: since }, status: "CANCELLED" }, include: { vehicle: true, driver: true, order: { select: { orderNo: true } } } }),
  ]);
  const out: Anomaly[] = [];
  const qtys = items.map((i) => Number(i.qtyM3)); const qMean = mean(qtys), qStd = std(qtys);
  for (const i of items) {
    const price = Number(i.price), base = Number(i.product.price), qty = Number(i.qtyM3);
    if (base > 0 && Math.abs(price - base) / base > 0.2) out.push({ id: `p-${i.id}`, date: i.order.date, level: Math.abs(price - base) / base > 0.4 ? "High" : "Medium", score: Math.min(99, Math.round(50 + (Math.abs(price - base) / base) * 100)), source: "Sotuv", pattern: "Narx chetlanishi", title: `${i.product.code}: ${price < base ? "arzon" : "qimmat"} narx (${Math.round(((price - base) / base) * 100)}%)`, detail: `${i.order.orderNo} · ${i.order.customer.name} · bazaviy ${base.toLocaleString("ru")} → ${price.toLocaleString("ru")} so'm`, amount: Math.abs(price - base) * qty, href: `/orders/${i.order.id}`, who: i.order.createdBy.fullName });
    if (qStd > 0 && qty > qMean + 3 * qStd) out.push({ id: `q-${i.id}`, date: i.order.date, level: "Medium", score: 70, source: "Sotuv", pattern: "G'ayrioddiy hajm", title: `${i.product.code}: ${qty} ${i.product.code === "m3" ? "" : ""}— o'rtachadan ${((qty - qMean) / qStd).toFixed(1)}σ yuqori`, detail: `${i.order.orderNo} · ${i.order.customer.name}`, amount: qty * price, href: `/orders/${i.order.id}`, who: i.order.createdBy.fullName });
  }
  const amounts = payments.map((p) => Number(p.amount)); const aMean = mean(amounts), aStd = std(amounts);
  const dupKey = new Map<string, typeof payments>();
  for (const p of payments) {
    const h = p.date.getHours(), wd = p.date.getDay(), amt = Number(p.amount);
    if (h >= 20 || h < 7) out.push({ id: `t-${p.id}`, date: p.date, level: amt > aMean + aStd ? "High" : "Low", score: amt > aMean + aStd ? 85 : 40, source: "To'lov", pattern: "Ish vaqtidan tashqari", title: `${amt.toLocaleString("ru")} so'm — soat ${String(h).padStart(2, "0")}:${String(p.date.getMinutes()).padStart(2, "0")}`, detail: `${p.customer.name} · ${p.cashAccount.name}`, amount: amt, href: "/payments" });
    if (wd === 0 || wd === 6) out.push({ id: `w-${p.id}`, date: p.date, level: "Low", score: 35, source: "To'lov", pattern: "Dam olish kuni", title: `${amt.toLocaleString("ru")} so'm — ${WEEKDAYS[wd]}`, detail: `${p.customer.name} · ${p.cashAccount.name}`, amount: amt, href: "/payments" });
    if (aStd > 0 && amt > aMean + 3 * aStd) out.push({ id: `b-${p.id}`, date: p.date, level: "High", score: 90, source: "To'lov", pattern: "G'ayrioddiy summa", title: `${amt.toLocaleString("ru")} so'm — o'rtachadan ${((amt - aMean) / aStd).toFixed(1)}σ yuqori`, detail: `${p.customer.name} · ${p.cashAccount.name}`, amount: amt, href: "/payments" });
    if (amt >= 1_000_000 && amt % 1_000_000 === 0) out.push({ id: `r-${p.id}`, date: p.date, level: "Low", score: 30, source: "To'lov", pattern: "Yaxlit summa", title: `${amt.toLocaleString("ru")} so'm — 1 mln ga qoldiqsiz`, detail: `${p.customer.name}`, amount: amt, href: "/payments" });
    const k = `${p.customerId}|${amt}|${startOfDay(p.date).toISOString()}`; const arr = dupKey.get(k) ?? []; arr.push(p); dupKey.set(k, arr);
  }
  for (const [, arr] of dupKey) if (arr.length >= 2) out.push({ id: `d-${arr[0].id}`, date: arr[0].date, level: arr.length >= 3 ? "High" : "Medium", score: arr.length >= 3 ? 88 : 65, source: "To'lov", pattern: "Takrorlangan bir xil summa", title: `${arr[0].customer.name}: ${Number(arr[0].amount).toLocaleString("ru")} so'm × ${arr.length} marta bir kunda`, detail: `${arr[0].cashAccount.name} — dublikat bo'lishi mumkin`, amount: Number(arr[0].amount) * arr.length, href: "/payments" });
  const bq = batches.map((b) => Number(b.qtyM3)); const bMean = mean(bq), bStd = std(bq);
  for (const b of batches) {
    if (!b.orderId) out.push({ id: `n-${b.id}`, date: b.date, level: "Low", score: 35, source: "Ishlab chiqarish", pattern: "Zayavkasiz zames", title: `${b.batchNo}: ${Number(b.qtyM3)} m³ ${b.product.code} — zayavkasiz`, detail: "Omborga ishlab chiqarilgan", amount: 0, href: "/production", who: b.createdBy.fullName });
    if (bStd > 0 && Number(b.qtyM3) > bMean + 3 * bStd) out.push({ id: `bq-${b.id}`, date: b.date, level: "Medium", score: 65, source: "Ishlab chiqarish", pattern: "G'ayrioddiy hajm", title: `${b.batchNo}: ${Number(b.qtyM3)} m³ — o'rtachadan ${((Number(b.qtyM3) - bMean) / bStd).toFixed(1)}σ`, detail: b.product.code, amount: 0, href: "/production", who: b.createdBy.fullName });
    const h = b.date.getHours(); if (h >= 22 || h < 5) out.push({ id: `bh-${b.id}`, date: b.date, level: "Low", score: 30, source: "Ishlab chiqarish", pattern: "Ish vaqtidan tashqari", title: `${b.batchNo}: soat ${String(h).padStart(2, "0")}:00 da zames`, detail: b.product.code, amount: 0, href: "/production", who: b.createdBy.fullName });
  }
  for (const m of adjustments) out.push({ id: `s-${m.id}`, date: m.date, level: m.type === "WRITE_OFF" ? "Medium" : Math.abs(Number(m.qty)) > 100 ? "High" : "Medium", score: m.type === "WRITE_OFF" ? 60 : 75, source: "Sklad", pattern: m.type === "WRITE_OFF" ? "Hisobdan chiqarish" : "Inventarizatsiya farqi", title: `${m.material?.name ?? m.product?.code ?? "?"}: ${Number(m.qty) > 0 ? "+" : ""}${Number(m.qty)}`, detail: m.note ?? "—", amount: 0, href: "/stock", who: m.createdBy.fullName });
  for (const t of trips) out.push({ id: `c-${t.id}`, date: t.createdAt, level: "Low", score: 40, source: "Logistika", pattern: "Bekor qilingan reys", title: `${t.deliveryNoteNo}: ${Number(t.qtyM3)} m³ bekor qilindi`, detail: `${t.vehicle.plate} · ${t.driver.fullName} · ${t.order.orderNo}`, amount: 0, href: `/trips/${t.id}` });

  const all = out.sort((a, b) => b.score - a.score || b.date.getTime() - a.date.getTime());
  let list = all;
  if (filter.level) list = list.filter((a) => a.level === filter.level);
  if (filter.source) list = list.filter((a) => a.source === filter.source);
  if (filter.pattern) list = list.filter((a) => a.pattern === filter.pattern);
  const last7 = all.filter((a) => a.date >= addDays(today, -7)).length, prev7 = all.filter((a) => a.date >= addDays(today, -14) && a.date < addDays(today, -7)).length;
  const patterns = [...new Set(all.map((a) => a.pattern))].map((p) => ({ pattern: p, count: all.filter((a) => a.pattern === p).length, high: all.filter((a) => a.pattern === p && a.level === "High").length, amount: sum(all.filter((a) => a.pattern === p).map((a) => a.amount)), source: all.find((a) => a.pattern === p)!.source }));
  const trend = series(all, since, addDays(today, 1), filter.days > 62 ? "week" : "day", (a) => a.date, () => 1);
  const trendHigh = series(all.filter((a) => a.level === "High"), since, addDays(today, 1), filter.days > 62 ? "week" : "day", (a) => a.date, () => 1);
  const byWeekday = WEEKDAYS.map((w, i) => ({ label: w, value: all.filter((a) => a.date.getDay() === i).length }));
  const byHour = Array.from({ length: 24 }, (_, h) => ({ label: String(h), value: all.filter((a) => a.source === "To'lov" && a.date.getHours() === h).length }));
  const who = [...new Set(all.map((a) => a.who).filter(Boolean))].map((w) => ({ label: w as string, value: all.filter((a) => a.who === w).length, high: all.filter((a) => a.who === w && a.level === "High").length })).sort((a, b) => b.value - a.value).slice(0, 8);
  return {
    cards: { total: all.length, high: all.filter((a) => a.level === "High").length, medium: all.filter((a) => a.level === "Medium").length, low: all.filter((a) => a.level === "Low").length, money: sum(all.filter((a) => a.level === "High").map((a) => a.amount)), last7, prev7, offHours: all.filter((a) => a.pattern === "Ish vaqtidan tashqari").length },
    patterns, trend, trendHigh, byWeekday, byHour, who, list: list.slice(0, 200), sources: [...new Set(all.map((a) => a.source))],
  };
}
