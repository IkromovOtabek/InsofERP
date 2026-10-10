import { db } from "@/lib/db";
import { receivablesReport } from "@/lib/receivables";
import { fmtNum } from "@/lib/format";
import { type Range, type Gran, type SaleRow, loadSales, loadRevenue, materialCosts, productCosts, sum, safeDiv, kpi, series, addDays, startOfDay, std, mean, goLiveDate, costedRows, grossOf, marginOf, CAPITAL_RATE_DAY } from "./core";
import { materialOverview } from "./stock";
import { customerBase } from "./customers";
import { txSign, FLOW_ONLY } from "@/lib/cash-tx";

/** Bazaviy narxdan (QQS'siz) past sotilgan qatorlar — NDS li qator narxi ham QQS'siz bilan solishtiriladi */
const netPrice = (x: SaleRow) => safeDiv(x.net, x.qty);
const discountOf = (rows: SaleRow[]) => { const d = rows.filter((x) => x.basePrice > 0 && x.qty > 0 && netPrice(x) < x.basePrice); return { rows: d, value: sum(d.map((x) => (x.basePrice - netPrice(x)) * x.qty)) }; };

/** Brak: xomashyo hisobdan chiqarilishi (o'rtacha tannarx) + tayyor mahsulot braki (ProductDefect, Egasi paneli bilan bir xil baho) */
async function writeOffValue(from: Date, to: Date) {
  const [wo, defects, matCost, pCost] = await Promise.all([
    db.stockMove.findMany({ where: { type: "WRITE_OFF", materialId: { not: null }, date: { gte: from, lt: to } }, select: { qty: true, materialId: true } }),
    db.productDefect.findMany({ where: { date: { gte: from, lt: to } }, select: { productId: true, qty: true } }),
    materialCosts(), productCosts(),
  ]);
  const value = sum(wo.map((w) => Math.abs(Number(w.qty)) * (matCost.get(w.materialId!) ?? 0)))
    + sum(defects.map((d) => Number(d.qty) * (pCost.get(d.productId)?.cost ?? pCost.get(d.productId)?.price ?? 0)));
  return { value, count: wo.length + defects.length };
}
import { companyVatPayer, lineCost } from "@/lib/receipt-vat";

export type LossChannel = { key: string; title: string; sub: string; perDay: number; frozen?: number; periodTotal: number; kind: "ANIQ" | "TAXMIN" | "QISMAN"; flow: "OQIM" | "ZAXIRA"; count: string; text: string; action: string; href?: string };

/** Yo'qotish kanallari — kuniga qancha pul ketyapti (Team24 "Moliya" mantiqi, beton zavodiga moslangan). */
export async function lossChannels(r: Range) {
  const today = startOfDay(new Date());
  const [materials, customers, blocked, cancelled, cur, wo] = await Promise.all([
    materialOverview(), customerBase(), loadSales(addDays(today, -365), addDays(today, 1), ["BLOCKED"]), loadSales(r.from, r.to, ["CANCELLED"]), loadRevenue(r.from, r.to),
    writeOffValue(r.from, r.to),
  ]);
  // Marja stavkasi yo'qotilgan foydani baholash uchun: manfiy bo'lsa "yo'qotish" ham manfiy chiqib,
  // jami yo'qotishni kamaytirardi. Shuning uchun [0; 1] oralig'ida; sotuv yo'q bo'lsa — 15% taxmin.
  // Faqat tannarxi ma'lum qatorlar bo'yicha (retseptsiz mahsulot 100% marja bermasin)
  const costedRevenue = sum(costedRows(cur).map((x) => x.net));
  const marginRate = costedRevenue > 0 ? Math.min(1, Math.max(0, marginOf(cur) / 100)) : 0.15;

  // 1. Stockout: xomashyo yetmasligi sabab ishlab chiqarilmaydigan zayavkalar (rejadagi ehtiyoj > qoldiq)
  const shortMats = materials.filter((m) => m.short);
  const shortValue = sum(shortMats.map((m) => (m.planned - m.balance) * m.avgCost));
  const stockoutPerDay = shortMats.length ? Math.max(0, shortValue) * marginRate / 7 : 0;
  // 2. Debitorka: xarid to'xtatgan mijozlardagi qarz (At Risk / Lost)
  // Eski qarzdor (xaridi yo'q, faqat boshlang'ich qoldiqdagi qarz) — muddati o'tgach xavf ostida; "yangi mijoz" emas
  const riskyDebtors = customers.filter((c) => c.debt > 0 && (c.segment === "At Risk" || c.segment === "Lost" || (c.segment === "Eski qarzdor" && c.overdueDebt > 0)));
  const riskyDebt = sum(riskyDebtors.map((c) => c.debt));
  const overdueDebt = sum(customers.map((c) => c.overdueDebt));
  // 3. Dead stock
  const dead = materials.filter((m) => m.dead); const deadValue = sum(dead.map((m) => m.value));
  // 4. Bloklangan zayavkalar (kredit limit)
  const blockedRevenue = sum(blocked.map((x) => x.revenue)), blockedOrders = new Set(blocked.map((x) => x.orderId)).size;
  // 5. Bekor qilingan
  const cancelledRevenue = sum(cancelled.map((x) => x.revenue)), cancelledOrders = new Set(cancelled.map((x) => x.orderId)).size;
  // 6. Chegirma
  const { rows: discountRows, value: discount } = discountOf(cur);
  // 7. Write-off (xomashyo + tayyor mahsulot braki)
  const woValue = wo.value, woCount = wo.count;

  const channels = ([
    { key: "stockout", title: "Stockout", sub: "Xomashyo yetmasligidan to'xtagan ishlab chiqarish", perDay: stockoutPerDay, periodTotal: stockoutPerDay * r.days, kind: "TAXMIN", flow: "OQIM", count: `${shortMats.length} ta xomashyo yetmaydi`, text: shortMats.length ? `${shortMats.map((m) => m.name).slice(0, 4).join(", ")} — tasdiqlangan zayavkalar uchun qoldiq yetarli emas. Zayavka kechiksa mijoz raqobatchiga ketadi.` : "Barcha tasdiqlangan zayavkalar uchun xomashyo yetarli.", action: "Yetishmayotgan xomashyoni bugun buyurtma qiling — Ombor bo'limidagi buyurtma navbati tayyor.", href: "/receipts" },
    { key: "debt", title: "Debitorka", sub: "Ketayotgan mijozlarda qolgan qarz", perDay: riskyDebt * CAPITAL_RATE_DAY, frozen: riskyDebt, periodTotal: riskyDebt * CAPITAL_RATE_DAY * r.days, kind: "ANIQ", flow: "ZAXIRA", count: `${riskyDebtors.length} ta mijoz (At Risk / Lost / eski qarz)`, text: `${riskyDebtors.length} ta mijoz xarid qilishni to'xtatgan, lekin qarzi qolgan. Aloqa uzilgan sari bu pulni qaytarib olish qiyinlashadi. Muddati o'tgan qarz jami: ${fmtNum(overdueDebt)} so'm.`, action: "Eng katta qarzdorlardan boshlab qo'ng'iroq qiling — Mijozlar bo'limida ro'yxat tayyor.", href: "/invoices" },
    { key: "blocked", title: "Bloklangan zayavkalar", sub: "Kredit limit sabab to'xtab turgan sotuv", perDay: blockedRevenue * marginRate / 30, periodTotal: blockedRevenue * marginRate, kind: "ANIQ", flow: "OQIM", count: `${blockedOrders} ta zayavka`, text: `${blockedOrders} ta zayavka kredit limiti oshgani uchun bloklangan — ${fmtNum(blockedRevenue)} so'm sotuv kutmoqda.`, action: "Direktor limitni ko'rib chiqsin yoki mijoz oldindan to'lov qilsin.", href: "/orders?status=BLOCKED" },
    { key: "dead", title: "Dead Stock", sub: "Omborda muzlab qolgan xomashyo", perDay: deadValue * CAPITAL_RATE_DAY, frozen: deadValue, periodTotal: deadValue * CAPITAL_RATE_DAY * r.days, kind: "TAXMIN", flow: "ZAXIRA", count: `${dead.length} ta pozitsiya 90 kun ishlatilmagan`, text: dead.length ? `${dead.map((m) => m.name).slice(0, 4).join(", ")} — 90 kundan beri retseptga kirmagan. Pul kassada emas — omborda.` : "Muzlab qolgan xomashyo yo'q.", action: "Retseptga qaytaring, qaytarib bering yoki sotib yuboring — bu pul o'zi harakatga kelmaydi.", href: "/stock" },
    { key: "cancelled", title: "Bekor qilingan zayavkalar", sub: "Rasmiylashtirilib bekor qilingan", perDay: cancelledRevenue * marginRate / r.days, periodTotal: cancelledRevenue * marginRate, kind: "ANIQ", flow: "OQIM", count: `${cancelledOrders} ta zayavka`, text: `Davr ichida ${cancelledOrders} ta zayavka (${fmtNum(cancelledRevenue)} so'm) bekor qilindi — yo'qolgan foyda ${fmtNum(cancelledRevenue * marginRate)} so'm.`, action: "Bekor qilish sabablarini toifalab chiqing: narx, muddat, sifat yoki logistika.", href: "/orders?status=CANCELLED" },
    { key: "discount", title: "Chegirma", sub: "Bazaviy narxdan arzon sotilgan", perDay: discount / r.days, periodTotal: discount, kind: "QISMAN", flow: "OQIM", count: `${discountRows.length} ta pozitsiya`, text: `Bazaviy narxdan (marka narxi) past sotilgan pozitsiyalarda qo'ldan ketgan tushum — ${fmtNum(discount)} so'm.`, action: "Chegirma berish qoidasini belgilang: o'lchanmagan chegirma — nazorat qilinmaydigan foyda teshigi." },
    { key: "writeoff", title: "Brak / Write-off", sub: "Hisobdan chiqarilgan xomashyo va tayyor mahsulot braki", perDay: woValue / r.days, periodTotal: woValue, kind: "ANIQ", flow: "OQIM", count: `${woCount} ta yozuv`, text: `Davr ichida ${woCount} ta hisobdan chiqarish va brak — tannarxda ${fmtNum(woValue)} so'm. Bu to'liq yo'qotish.`, action: "Sabablarini toifalang: saqlash sharti, muddat yoki ortiqcha buyurtma.", href: "/stock" },
  ] satisfies LossChannel[])
    // Har kanal kunlik qiymati ≥ 0: manfiy "yo'qotish" jami summani yolg'on kamaytirmasin
    .map((c) => ({ ...c, perDay: Math.max(0, c.perDay), periodTotal: Math.max(0, c.periodTotal) }))
    .sort((a, b) => b.perDay - a.perDay) as LossChannel[];
  const totalPerDay = sum(channels.map((c) => c.perDay));
  // Eng katta teshik — faqat haqiqatan pul ketayotgan kanal; hammasi 0 bo'lsa null
  const biggest: LossChannel | null = channels[0] && channels[0].perDay > 0 ? channels[0] : null;
  const frozen = riskyDebt + deadValue;
  return { channels, totalPerDay, frozen, marginRate, biggest, stockout: { count: shortMats.length, value: shortValue, items: shortMats }, riskyDebt, riskyDebtors: riskyDebtors.length, overdueDebt, deadValue, deadCount: dead.length, blockedRevenue, blockedOrders };
}

export async function financeTab(r: Range, gran: Gran, page: number, size: number, account?: string) {
  const today = startOfDay(new Date());
  const [loss, cur, prev, payments, prevPayments, accounts, allPay, recv, receipts, prevReceipts, cust, wo, batches, prevBatches, tripsCur, tripsPrev, incomeTx, prevIncomeTx, since] = await Promise.all([
    // Tushum va tannarx — yetkazilgan reyslar bo'yicha (realizatsiya), zayavka sanasi bo'yicha emas
    lossChannels(r), loadRevenue(r.from, r.to), loadRevenue(r.prevFrom, r.prevTo),
    db.payment.findMany({ where: { date: { gte: r.from, lt: r.to } }, include: { customer: { select: { name: true } }, cashAccount: true, invoice: { select: { invoiceNo: true } } }, orderBy: { date: "desc" } }),
    db.payment.findMany({ where: { date: { gte: r.prevFrom, lt: r.prevTo } }, select: { amount: true } }),
    db.cashAccount.findMany({ where: { isActive: true } }),
    db.payment.groupBy({ by: ["cashAccountId"], _sum: { amount: true } }),
    receivablesReport(), // yagona debitorka (schyotlar − barcha to'lovlar, FIFO aging)
    db.goodsReceiptItem.findMany({ where: { receipt: { cancelledAt: null, date: { gte: r.from, lt: r.to } } }, select: { qty: true, price: true, vatAmount: true, receipt: { select: { supplier: { select: { name: true } } } } } }),
    db.goodsReceiptItem.findMany({ where: { receipt: { cancelledAt: null, date: { gte: r.prevFrom, lt: r.prevTo } } }, select: { qty: true, price: true, vatAmount: true } }),
    customerBase(),
    writeOffValue(r.from, r.to),
    // Hajm ko'rsatkichlari — faqat beton (m³): dona zameslari va yuk mashinadagi dona reyslar m³ ga qo'shilmaydi
    db.productionBatch.aggregate({ where: { cancelledAt: null, product: { unit: "m3" }, date: { gte: r.from, lt: r.to } }, _sum: { qtyM3: true } }),
    db.productionBatch.aggregate({ where: { cancelledAt: null, product: { unit: "m3" }, date: { gte: r.prevFrom, lt: r.prevTo } }, _sum: { qtyM3: true } }),
    db.trip.findMany({ where: { deliveredAt: { gte: r.from, lt: r.to }, status: "DELIVERED", vehicle: { type: "MIXER" } }, select: { qtyM3: true } }),
    db.trip.findMany({ where: { deliveredAt: { gte: r.prevFrom, lt: r.prevTo }, status: "DELIVERED", vehicle: { type: "MIXER" } }, select: { qtyM3: true } }),
    // Boshqa kirimlar (Kirim-Chiqim → Kirim): kassa tushumi Kirim-Chiqim sahifasi bilan bir xil bo'lsin
    db.cashTransaction.findMany({ where: { type: "INCOME", date: { gte: r.from, lt: r.to } }, select: { date: true, amount: true } }),
    db.cashTransaction.findMany({ where: { type: "INCOME", date: { gte: r.prevFrom, lt: r.prevTo } }, select: { amount: true } }),
    goLiveDate(),
  ]);
  const revenue = sum(cur.map((x) => x.revenue)), prevRevenue = sum(prev.map((x) => x.revenue));
  // Yalpi foyda = QQS'siz tushum − tannarx, faqat tannarxi ma'lum qatorlar bo'yicha.
  // Sharshara: Sof tushum − QQS − tannarxi noma'lum tushum − tannarx = Yalpi foyda (qadamlar yig'indisi mos keladi)
  const cogs = sum(costedRows(cur).map((x) => x.cost));
  const vat = sum(cur.map((x) => x.revenue - x.net)), uncostedNet = sum(cur.filter((x) => !x.costKnown).map((x) => x.net));
  const discount = discountOf(cur).value;
  const grossAtBase = revenue + discount;
  const gross = grossOf(cur), prevGross = grossOf(prev);
  // Xarid xarajati: QQS to'lovchisi korxonada QQS'siz (kirim QQS'i qaytariladi), aks holda QQS bilan
  const vatPayer = await companyVatPayer();
  const writeOff = wo.value;
  const profit = gross - writeOff;
  const otherIn = sum(incomeTx.map((t) => Number(t.amount)));
  const cashIn = sum(payments.map((p) => Number(p.amount))) + otherIn, prevCashIn = sum(prevPayments.map((p) => Number(p.amount))) + sum(prevIncomeTx.map((t) => Number(t.amount)));
  const purchases = sum(receipts.map((i) => lineCost(i, vatPayer))), prevPurchases = sum(prevReceipts.map((i) => lineCost(i, vatPayer)));
  const receivable = recv.total;
  const debtors = cust.filter((c) => c.debt > 0).length;

  // Kassa balanslari: mijoz to'lovlari + boshqa kirimlar − chiqimlar (Kirim-Chiqim va direktor paneli bilan bir xil).
  // Ilgari faqat to'lovlar yig'ilardi — qoldiq va 7 kunlik prognoz chiqimlarsiz shishib chiqardi.
  const balBy = new Map(allPay.map((a) => [a.cashAccountId, Number(a._sum.amount ?? 0)]));
  for (const t of await db.cashTransaction.groupBy({ by: ["cashAccountId", "type"], _sum: { amount: true } })) {
    balBy.set(t.cashAccountId, (balBy.get(t.cashAccountId) ?? 0) + txSign(t.type) * Number(t._sum.amount ?? 0));
  }
  const accountRows = accounts.map((a) => ({ id: a.id, name: a.name, type: a.type, total: balBy.get(a.id) ?? 0, period: sum(payments.filter((p) => p.cashAccountId === a.id).map((p) => Number(p.amount))) }));
  const cashTotal = sum(accountRows.map((a) => a.total));

  // Cash forecast 7 kun — so'nggi 30 kun (tizimga o'tilgan bo'lsa o'tish sanasidan) kunlik tushum (o'rtacha ± σ)
  // minus kunlik o'rtacha chiqim. O'tishdan oldingi "bo'sh" kunlar o'rtachani tushirib, σ ni shishirmasin.
  const fcFrom = since && since > addDays(today, -30) ? since : addDays(today, -30);
  const fcTo = fcFrom < today ? today : addDays(today, 1); // o'tish bugun bo'lsa — bugungi kun bilan
  const [last30, last30Inc, last30Exp] = await Promise.all([
    db.payment.findMany({ where: { date: { gte: fcFrom, lt: fcTo } }, select: { date: true, amount: true } }),
    db.cashTransaction.findMany({ where: { type: "INCOME", date: { gte: fcFrom, lt: fcTo } }, select: { date: true, amount: true } }),
    db.cashTransaction.aggregate({ where: { ...FLOW_ONLY, type: "EXPENSE", date: { gte: fcFrom, lt: fcTo } }, _sum: { amount: true } }),
  ]);
  const daily = series([...last30, ...last30Inc], fcFrom, fcTo, "day", (p) => p.date, (p) => Number(p.amount)).map((x) => x.value);
  const mu = mean(daily), sigma = std(daily), outPerDay = Number(last30Exp._sum.amount ?? 0) / Math.max(1, daily.length);
  const forecast7 = Array.from({ length: 7 }, (_, i) => ({ label: `${String(addDays(today, i + 1).getDate()).padStart(2, "0")}.${String(addDays(today, i + 1).getMonth() + 1).padStart(2, "0")}`, base: Math.min(receivable, mu * (i + 1)) - outPerDay * (i + 1), low: Math.max(0, (mu - sigma) * (i + 1)) - outPerDay * (i + 1), high: (mu + sigma) * (i + 1) - outPerDay * (i + 1) }));
  const cashForecast = { start: cashTotal, after7: cashTotal + forecast7[6].base, low7: cashTotal + forecast7[6].low, expectedIn: Math.min(receivable, mu * 7), expectedOut: outPerDay * 7, outPerDay, histDays: daily.length, perDay: mu, sigma, receivable, coverDays: mu > 0 ? receivable / mu : null, risk: sigma > mu ? "Yuqori" : sigma > mu / 2 ? "O'rta" : "Past", rows: forecast7 };

  // Cashflow trendi (davr) — tushum + kumulyativ
  const flow = series([...payments.map((p) => ({ date: p.date, amount: p.amount })), ...incomeTx], r.from, r.to, gran, (p) => p.date, (p) => Number(p.amount));
  let run = 0; const cumulative = flow.map((f) => (run += f.value));

  // Daromad vs xarajat — oxirgi 6 oy
  const from6 = new Date(today.getFullYear(), today.getMonth() - 5, 1);
  const [sales6, rec6, pay6, inc6] = await Promise.all([
    loadRevenue(from6, addDays(today, 1)),
    db.goodsReceiptItem.findMany({ where: { receipt: { cancelledAt: null, date: { gte: from6 } } }, select: { qty: true, price: true, vatAmount: true, receipt: { select: { date: true } } } }),
    db.payment.findMany({ where: { date: { gte: from6 } }, select: { date: true, amount: true } }),
    db.cashTransaction.findMany({ where: { type: "INCOME", date: { gte: from6 } }, select: { date: true, amount: true } }),
  ]);
  const rev6 = series(sales6, from6, addDays(today, 1), "month", (x) => x.date, (x) => x.revenue);
  const cost6 = series(rec6, from6, addDays(today, 1), "month", (x) => x.receipt.date, (x) => lineCost(x, vatPayer));
  const pay6s = series([...pay6, ...inc6], from6, addDays(today, 1), "month", (x) => x.date, (x) => Number(x.amount));
  const active6 = series(sales6, from6, addDays(today, 1), "month", (x) => x.date, () => 0).map((b) => ({ ...b, value: new Set(sales6.filter((x) => (x.date.getMonth() === Number(b.key.slice(5, 7)) - 1 && x.date.getFullYear() === Number(b.key.slice(0, 4)))).map((x) => x.customerId)).size }));

  // Xarajat tuzilmasi: yetkazuvchilar bo'yicha xaridlar + brak
  const bySup = new Map<string, number>();
  for (const i of receipts) bySup.set(i.receipt.supplier.name, (bySup.get(i.receipt.supplier.name) ?? 0) + lineCost(i, vatPayer));
  const expenses = [...bySup.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
  if (writeOff > 0) expenses.push({ label: "Brak / write-off", value: writeOff });
  const expenseTotal = sum(expenses.map((e) => e.value));

  // Debitorka aging
  const aging = recv.buckets; // 0–30 / 31–60 / 61–90 / 90+

  // Top 10 to'lov
  const topPayments = [...payments].sort((a, b) => Number(b.amount) - Number(a.amount)).slice(0, 10);

  // Ko'rsatkichlar jadvali
  const produced = Number(batches._sum.qtyM3 ?? 0), prevProduced = Number(prevBatches._sum.qtyM3 ?? 0);
  const shipped = sum(tripsCur.map((t) => Number(t.qtyM3))), prevShipped = sum(tripsPrev.map((t) => Number(t.qtyM3)));
  const orders = new Set(cur.map((x) => x.orderId)).size, prevOrders = new Set(prev.map((x) => x.orderId)).size;
  const indicators = [
    { label: "Sotuv tushumi", unit: "so'm", ...kpi(revenue, prevRevenue) },
    { label: "Yalpi foyda", unit: "so'm", ...kpi(gross, prevGross) },
    { label: "Marja", unit: "%", ...kpi(marginOf(cur), marginOf(prev)) },
    { label: "Kassa tushumi", unit: "so'm", ...kpi(cashIn, prevCashIn) },
    { label: "Xomashyo xaridi", unit: "so'm", ...kpi(purchases, prevPurchases) },
    { label: "Yetkazilgan zayavkalar", unit: "ta", ...kpi(orders, prevOrders) },
    { label: "O'rtacha chek", unit: "so'm", ...kpi(safeDiv(revenue, orders), safeDiv(prevRevenue, prevOrders)) },
    { label: "Beton ishlab chiqarish", unit: "m³", ...kpi(produced, prevProduced) },
    { label: "Beton yetkazildi", unit: "m³", ...kpi(shipped, prevShipped) },
    { label: "Chegirma", unit: "so'm", ...kpi(discount, discountOf(prev).value) },
  ];

  // Tranzaksiyalar
  let list = payments; if (account) list = list.filter((p) => p.cashAccountId === account);
  const total = list.length, rows = list.slice((page - 1) * size, page * size);

  return {
    loss, kpis: { revenue: kpi(revenue, prevRevenue), gross: kpi(gross, prevGross), margin: marginOf(cur), uncosted: sum(cur.filter((x) => !x.costKnown).map((x) => x.revenue)), otherIn, profit, cashIn: kpi(cashIn, prevCashIn), receivable, debtors, purchases: kpi(purchases, prevPurchases), cashTotal, activeCustomers: new Set(cur.map((x) => x.customerId)).size, totalCustomers: cust.length, discount, writeOff },
    waterfall: [{ label: "Bazaviy tushum", value: grossAtBase, total: true }, { label: "Chegirma", value: -discount }, { label: "Sof tushum", value: revenue, total: true }, ...(vat > 0 ? [{ label: "QQS", value: -vat }] : []), ...(uncostedNet > 0 ? [{ label: "Tannarxi noma'lum", value: -uncostedNet }] : []), { label: "Xomashyo tannarxi", value: -cogs }, { label: "Yalpi foyda", value: gross, total: true }, { label: "Brak", value: -writeOff }, { label: "Foyda*", value: profit, total: true }],
    accountRows, cashForecast, flow, cumulative, months: { labels: rev6.map((x) => x.label), revenue: rev6.map((x) => x.value), purchases: cost6.map((x) => x.value), cash: pay6s.map((x) => x.value), active: active6.map((x) => x.value) },
    expenses, expenseTotal, aging, topPayments, indicators, list: { rows, total, page, size }, accounts,
    activeRate: safeDiv(cust.filter((c) => c.recency !== null && c.recency < 30).length, cust.length) * 100,
  };
}
