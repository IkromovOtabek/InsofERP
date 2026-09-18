import { db } from "@/lib/db";
import { type Range, type Gran, loadSales, materialCosts, sum, safeDiv, kpi, series, addDays, startOfDay, std, mean, CAPITAL_RATE_DAY } from "./core";
import { materialOverview } from "./stock";
import { customerBase } from "./customers";

export type LossChannel = { key: string; title: string; sub: string; perDay: number; frozen?: number; periodTotal: number; kind: "ANIQ" | "TAXMIN" | "QISMAN"; flow: "OQIM" | "ZAXIRA"; count: string; text: string; action: string; href?: string };

/** Yo'qotish kanallari — kuniga qancha pul ketyapti (Team24 "Moliya" mantiqi, beton zavodiga moslangan). */
export async function lossChannels(r: Range) {
  const today = startOfDay(new Date());
  const [materials, customers, blocked, cancelled, cur, writeOffs] = await Promise.all([
    materialOverview(), customerBase(), loadSales(addDays(today, -365), addDays(today, 1), ["BLOCKED"]), loadSales(r.from, r.to, ["CANCELLED"]), loadSales(r.from, r.to),
    db.stockMove.findMany({ where: { type: "WRITE_OFF", date: { gte: r.from, lt: r.to } }, select: { qty: true, materialId: true } }),
  ]);
  const costOf = new Map(materials.map((m) => [m.id, m.avgCost]));
  const marginRate = safeDiv(sum(cur.map((x) => x.revenue - x.cost)), sum(cur.map((x) => x.revenue))) || 0.15;

  // 1. Stockout: xomashyo yetmasligi sabab ishlab chiqarilmaydigan zayavkalar (rejadagi ehtiyoj > qoldiq)
  const shortMats = materials.filter((m) => m.short);
  const shortValue = sum(shortMats.map((m) => (m.planned - m.balance) * m.avgCost));
  const stockoutPerDay = shortMats.length ? (shortValue / Math.max(1, marginRate)) * marginRate / 7 : 0;
  // 2. Debitorka: xarid to'xtatgan mijozlardagi qarz (At Risk / Lost)
  const riskyDebtors = customers.filter((c) => c.debt > 0 && (c.segment === "At Risk" || c.segment === "Lost"));
  const riskyDebt = sum(riskyDebtors.map((c) => c.debt));
  const overdueDebt = sum(customers.map((c) => c.overdueDebt));
  // 3. Dead stock
  const dead = materials.filter((m) => m.dead); const deadValue = sum(dead.map((m) => m.value));
  // 4. Bloklangan zayavkalar (kredit limit)
  const blockedRevenue = sum(blocked.map((x) => x.revenue)), blockedOrders = new Set(blocked.map((x) => x.orderId)).size;
  // 5. Bekor qilingan
  const cancelledRevenue = sum(cancelled.map((x) => x.revenue)), cancelledOrders = new Set(cancelled.map((x) => x.orderId)).size;
  // 6. Chegirma
  const discountRows = cur.filter((x) => x.basePrice > 0 && x.price < x.basePrice);
  const discount = sum(discountRows.map((x) => (x.basePrice - x.price) * x.qty));
  // 7. Write-off
  const woValue = sum(writeOffs.map((w) => Math.abs(Number(w.qty)) * (w.materialId ? costOf.get(w.materialId) ?? 0 : 0)));

  const channels = ([
    { key: "stockout", title: "Stockout", sub: "Xomashyo yetmasligidan to'xtagan ishlab chiqarish", perDay: stockoutPerDay, periodTotal: stockoutPerDay * r.days, kind: "TAXMIN", flow: "OQIM", count: `${shortMats.length} ta xomashyo yetmaydi`, text: shortMats.length ? `${shortMats.map((m) => m.name).slice(0, 4).join(", ")} — tasdiqlangan zayavkalar uchun qoldiq yetarli emas. Zayavka kechiksa mijoz raqobatchiga ketadi.` : "Barcha tasdiqlangan zayavkalar uchun xomashyo yetarli.", action: "Yetishmayotgan xomashyoni bugun buyurtma qiling — Ombor bo'limidagi buyurtma navbati tayyor.", href: "/receipts" },
    { key: "debt", title: "Debitorka", sub: "Ketayotgan mijozlarda qolgan qarz", perDay: riskyDebt * CAPITAL_RATE_DAY, frozen: riskyDebt, periodTotal: riskyDebt * CAPITAL_RATE_DAY * r.days, kind: "ANIQ", flow: "ZAXIRA", count: `${riskyDebtors.length} ta mijoz (At Risk / Lost)`, text: `${riskyDebtors.length} ta mijoz xarid qilishni to'xtatgan, lekin qarzi qolgan. Aloqa uzilgan sari bu pulni qaytarib olish qiyinlashadi. Muddati o'tgan qarz jami: ${Math.round(overdueDebt).toLocaleString("ru")} so'm.`, action: "Eng katta qarzdorlardan boshlab qo'ng'iroq qiling — Mijozlar bo'limida ro'yxat tayyor.", href: "/invoices" },
    { key: "blocked", title: "Bloklangan zayavkalar", sub: "Kredit limit sabab to'xtab turgan sotuv", perDay: blockedRevenue * marginRate / 30, periodTotal: blockedRevenue * marginRate, kind: "ANIQ", flow: "OQIM", count: `${blockedOrders} ta zayavka`, text: `${blockedOrders} ta zayavka kredit limiti oshgani uchun bloklangan — ${Math.round(blockedRevenue).toLocaleString("ru")} so'm sotuv kutmoqda.`, action: "Direktor limitni ko'rib chiqsin yoki mijoz oldindan to'lov qilsin.", href: "/orders?status=BLOCKED" },
    { key: "dead", title: "Dead Stock", sub: "Omborda muzlab qolgan xomashyo", perDay: deadValue * CAPITAL_RATE_DAY, frozen: deadValue, periodTotal: deadValue * CAPITAL_RATE_DAY * r.days, kind: "TAXMIN", flow: "ZAXIRA", count: `${dead.length} ta pozitsiya 90 kun ishlatilmagan`, text: dead.length ? `${dead.map((m) => m.name).slice(0, 4).join(", ")} — 90 kundan beri retseptga kirmagan. Pul kassada emas — omborda.` : "Muzlab qolgan xomashyo yo'q.", action: "Retseptga qaytaring, qaytarib bering yoki sotib yuboring — bu pul o'zi harakatga kelmaydi.", href: "/stock" },
    { key: "cancelled", title: "Bekor qilingan zayavkalar", sub: "Rasmiylashtirilib bekor qilingan", perDay: cancelledRevenue * marginRate / r.days, periodTotal: cancelledRevenue * marginRate, kind: "ANIQ", flow: "OQIM", count: `${cancelledOrders} ta zayavka`, text: `Davr ichida ${cancelledOrders} ta zayavka (${Math.round(cancelledRevenue).toLocaleString("ru")} so'm) bekor qilindi — yo'qolgan foyda ${Math.round(cancelledRevenue * marginRate).toLocaleString("ru")} so'm.`, action: "Bekor qilish sabablarini toifalab chiqing: narx, muddat, sifat yoki logistika.", href: "/orders?status=CANCELLED" },
    { key: "discount", title: "Chegirma", sub: "Bazaviy narxdan arzon sotilgan", perDay: discount / r.days, periodTotal: discount, kind: "QISMAN", flow: "OQIM", count: `${discountRows.length} ta pozitsiya`, text: `Bazaviy narxdan (marka narxi) past sotilgan pozitsiyalarda qo'ldan ketgan tushum — ${Math.round(discount).toLocaleString("ru")} so'm.`, action: "Chegirma berish qoidasini belgilang: o'lchanmagan chegirma — nazorat qilinmaydigan foyda teshigi." },
    { key: "writeoff", title: "Brak / Write-off", sub: "Hisobdan chiqarilgan xomashyo", perDay: woValue / r.days, periodTotal: woValue, kind: "ANIQ", flow: "OQIM", count: `${writeOffs.length} ta yozuv`, text: `Davr ichida ${writeOffs.length} ta hisobdan chiqarish — tannarxda ${Math.round(woValue).toLocaleString("ru")} so'm. Bu to'liq yo'qotish.`, action: "Sabablarini toifalang: saqlash sharti, muddat yoki ortiqcha buyurtma.", href: "/stock" },
  ] satisfies LossChannel[]).sort((a, b) => b.perDay - a.perDay) as LossChannel[];
  const totalPerDay = sum(channels.map((c) => c.perDay));
  const frozen = riskyDebt + deadValue;
  return { channels, totalPerDay, frozen, marginRate, biggest: channels[0], stockout: { count: shortMats.length, value: shortValue, items: shortMats }, riskyDebt, riskyDebtors: riskyDebtors.length, overdueDebt, deadValue, deadCount: dead.length, blockedRevenue, blockedOrders };
}

export async function financeTab(r: Range, gran: Gran, page: number, size: number, account?: string) {
  const today = startOfDay(new Date());
  const [loss, cur, prev, payments, prevPayments, accounts, allPay, openInv, receipts, prevReceipts, cust, wo, batches, prevBatches, tripsCur, tripsPrev] = await Promise.all([
    lossChannels(r), loadSales(r.from, r.to), loadSales(r.prevFrom, r.prevTo),
    db.payment.findMany({ where: { date: { gte: r.from, lt: r.to } }, include: { customer: { select: { name: true } }, cashAccount: true, invoice: { select: { invoiceNo: true } } }, orderBy: { date: "desc" } }),
    db.payment.findMany({ where: { date: { gte: r.prevFrom, lt: r.prevTo } }, select: { amount: true } }),
    db.cashAccount.findMany({ where: { isActive: true } }),
    db.payment.groupBy({ by: ["cashAccountId"], _sum: { amount: true } }),
    db.invoice.findMany({ where: { status: { in: ["OPEN", "PARTIAL"] } }, select: { amount: true, date: true, payments: { select: { amount: true } } } }),
    db.goodsReceiptItem.findMany({ where: { receipt: { date: { gte: r.from, lt: r.to } } }, select: { qty: true, price: true, receipt: { select: { supplier: { select: { name: true } } } } } }),
    db.goodsReceiptItem.findMany({ where: { receipt: { date: { gte: r.prevFrom, lt: r.prevTo } } }, select: { qty: true, price: true } }),
    customerBase(),
    db.stockMove.findMany({ where: { type: "WRITE_OFF", date: { gte: r.from, lt: r.to } }, select: { qty: true, materialId: true } }),
    db.productionBatch.aggregate({ where: { date: { gte: r.from, lt: r.to } }, _sum: { qtyM3: true } }),
    db.productionBatch.aggregate({ where: { date: { gte: r.prevFrom, lt: r.prevTo } }, _sum: { qtyM3: true } }),
    db.trip.findMany({ where: { createdAt: { gte: r.from, lt: r.to }, status: "DELIVERED" }, select: { qtyM3: true } }),
    db.trip.findMany({ where: { createdAt: { gte: r.prevFrom, lt: r.prevTo }, status: "DELIVERED" }, select: { qtyM3: true } }),
  ]);
  const revenue = sum(cur.map((x) => x.revenue)), prevRevenue = sum(prev.map((x) => x.revenue));
  const cogs = sum(cur.map((x) => x.cost)), prevCogs = sum(prev.map((x) => x.cost));
  const discount = sum(cur.filter((x) => x.basePrice > x.price).map((x) => (x.basePrice - x.price) * x.qty));
  const grossAtBase = revenue + discount;
  const gross = revenue - cogs, prevGross = prevRevenue - prevCogs;
  const materialsCost = await materialCosts();
  const writeOff = sum(wo.map((w) => Math.abs(Number(w.qty)) * (w.materialId ? materialsCost.get(w.materialId) ?? 0 : 0)));
  const profit = gross - writeOff;
  const cashIn = sum(payments.map((p) => Number(p.amount))), prevCashIn = sum(prevPayments.map((p) => Number(p.amount)));
  const purchases = sum(receipts.map((i) => Number(i.qty) * Number(i.price))), prevPurchases = sum(prevReceipts.map((i) => Number(i.qty) * Number(i.price)));
  const receivable = sum(openInv.map((i) => Math.max(0, Number(i.amount) - sum(i.payments.map((p) => Number(p.amount))))));
  const debtors = cust.filter((c) => c.debt > 0).length;

  // Kassa balanslari (barcha vaqt tushumlari)
  const balBy = new Map(allPay.map((a) => [a.cashAccountId, Number(a._sum.amount ?? 0)]));
  const accountRows = accounts.map((a) => ({ id: a.id, name: a.name, type: a.type, total: balBy.get(a.id) ?? 0, period: sum(payments.filter((p) => p.cashAccountId === a.id).map((p) => Number(p.amount))) }));
  const cashTotal = sum(accountRows.map((a) => a.total));

  // Cash forecast 7 kun — so'nggi 30 kun kunlik tushum asosida (o'rtacha ± σ)
  const last30 = await db.payment.findMany({ where: { date: { gte: addDays(today, -30) } }, select: { date: true, amount: true } });
  const daily = series(last30, addDays(today, -30), today, "day", (p) => p.date, (p) => Number(p.amount)).map((x) => x.value);
  const mu = mean(daily), sigma = std(daily);
  const forecast7 = Array.from({ length: 7 }, (_, i) => ({ label: `${String(addDays(today, i + 1).getDate()).padStart(2, "0")}.${String(addDays(today, i + 1).getMonth() + 1).padStart(2, "0")}`, base: Math.min(receivable, mu * (i + 1)), low: Math.max(0, (mu - sigma) * (i + 1)), high: (mu + sigma) * (i + 1) }));
  const cashForecast = { start: cashTotal, after7: cashTotal + forecast7[6].base, low7: cashTotal + forecast7[6].low, expectedIn: forecast7[6].base, perDay: mu, sigma, receivable, coverDays: mu > 0 ? receivable / mu : null, risk: sigma > mu ? "Yuqori" : sigma > mu / 2 ? "O'rta" : "Past", rows: forecast7 };

  // Cashflow trendi (davr) — tushum + kumulyativ
  const flow = series(payments, r.from, r.to, gran, (p) => p.date, (p) => Number(p.amount));
  let run = 0; const cumulative = flow.map((f) => (run += f.value));

  // Daromad vs xarajat — oxirgi 6 oy
  const from6 = new Date(today.getFullYear(), today.getMonth() - 5, 1);
  const [sales6, rec6, pay6] = await Promise.all([
    loadSales(from6, addDays(today, 1)),
    db.goodsReceiptItem.findMany({ where: { receipt: { date: { gte: from6 } } }, select: { qty: true, price: true, receipt: { select: { date: true } } } }),
    db.payment.findMany({ where: { date: { gte: from6 } }, select: { date: true, amount: true } }),
  ]);
  const rev6 = series(sales6, from6, addDays(today, 1), "month", (x) => x.date, (x) => x.revenue);
  const cost6 = series(rec6, from6, addDays(today, 1), "month", (x) => x.receipt.date, (x) => Number(x.qty) * Number(x.price));
  const pay6s = series(pay6, from6, addDays(today, 1), "month", (x) => x.date, (x) => Number(x.amount));
  const active6 = series(sales6, from6, addDays(today, 1), "month", (x) => x.date, () => 0).map((b) => ({ ...b, value: new Set(sales6.filter((x) => (x.date.getMonth() === Number(b.key.slice(5, 7)) - 1 && x.date.getFullYear() === Number(b.key.slice(0, 4)))).map((x) => x.customerId)).size }));

  // Xarajat tuzilmasi: yetkazuvchilar bo'yicha xaridlar + brak
  const bySup = new Map<string, number>();
  for (const i of receipts) bySup.set(i.receipt.supplier.name, (bySup.get(i.receipt.supplier.name) ?? 0) + Number(i.qty) * Number(i.price));
  const expenses = [...bySup.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
  if (writeOff > 0) expenses.push({ label: "Brak / write-off", value: writeOff });
  const expenseTotal = sum(expenses.map((e) => e.value));

  // Debitorka aging
  const aging = [0, 0, 0, 0];
  for (const inv of openInv) { const open = Number(inv.amount) - sum(inv.payments.map((p) => Number(p.amount))); if (open <= 0) continue; const age = (today.getTime() - startOfDay(inv.date).getTime()) / 86400000; aging[age <= 30 ? 0 : age <= 60 ? 1 : age <= 90 ? 2 : 3] += open; }

  // Top 10 to'lov
  const topPayments = [...payments].sort((a, b) => Number(b.amount) - Number(a.amount)).slice(0, 10);

  // Ko'rsatkichlar jadvali
  const produced = Number(batches._sum.qtyM3 ?? 0), prevProduced = Number(prevBatches._sum.qtyM3 ?? 0);
  const shipped = sum(tripsCur.map((t) => Number(t.qtyM3))), prevShipped = sum(tripsPrev.map((t) => Number(t.qtyM3)));
  const orders = new Set(cur.map((x) => x.orderId)).size, prevOrders = new Set(prev.map((x) => x.orderId)).size;
  const indicators = [
    { label: "Sotuv tushumi", unit: "so'm", ...kpi(revenue, prevRevenue) },
    { label: "Yalpi foyda", unit: "so'm", ...kpi(gross, prevGross) },
    { label: "Marja", unit: "%", ...kpi(safeDiv(gross, revenue) * 100, safeDiv(prevGross, prevRevenue) * 100) },
    { label: "Kassa tushumi", unit: "so'm", ...kpi(cashIn, prevCashIn) },
    { label: "Xomashyo xaridi", unit: "so'm", ...kpi(purchases, prevPurchases) },
    { label: "Zayavkalar", unit: "ta", ...kpi(orders, prevOrders) },
    { label: "O'rtacha chek", unit: "so'm", ...kpi(safeDiv(revenue, orders), safeDiv(prevRevenue, prevOrders)) },
    { label: "Ishlab chiqarish", unit: "m³", ...kpi(produced, prevProduced) },
    { label: "Yetkazildi", unit: "m³", ...kpi(shipped, prevShipped) },
    { label: "Chegirma", unit: "so'm", ...kpi(discount, sum(prev.filter((x) => x.basePrice > x.price).map((x) => (x.basePrice - x.price) * x.qty))) },
  ];

  // Tranzaksiyalar
  let list = payments; if (account) list = list.filter((p) => p.cashAccountId === account);
  const total = list.length, rows = list.slice((page - 1) * size, page * size);

  return {
    loss, kpis: { revenue: kpi(revenue, prevRevenue), gross: kpi(gross, prevGross), margin: safeDiv(gross, revenue) * 100, profit, cashIn: kpi(cashIn, prevCashIn), receivable, debtors, purchases: kpi(purchases, prevPurchases), cashTotal, activeCustomers: new Set(cur.map((x) => x.customerId)).size, totalCustomers: cust.length, discount, writeOff },
    waterfall: [{ label: "Bazaviy tushum", value: grossAtBase, total: true }, { label: "Chegirma", value: -discount }, { label: "Sof tushum", value: revenue, total: true }, { label: "Xomashyo tannarxi", value: -cogs }, { label: "Yalpi foyda", value: gross, total: true }, { label: "Brak", value: -writeOff }, { label: "Foyda*", value: profit, total: true }],
    accountRows, cashForecast, flow, cumulative, months: { labels: rev6.map((x) => x.label), revenue: rev6.map((x) => x.value), purchases: cost6.map((x) => x.value), cash: pay6s.map((x) => x.value), active: active6.map((x) => x.value) },
    expenses, expenseTotal, aging, topPayments, indicators, list: { rows, total, page, size }, accounts,
    activeRate: safeDiv(cust.filter((c) => c.recency !== null && c.recency < 30).length, cust.length) * 100,
  };
}
