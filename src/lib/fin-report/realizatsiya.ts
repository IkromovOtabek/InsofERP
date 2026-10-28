import { db } from "@/lib/db";
import { addDays, goLiveDate, loadRevenue, sum, workingDays } from "@/lib/bi/core";
import { isoDate } from "@/lib/format";
import { PAY_GROUPS, type PayGroupKey } from "@/lib/order-day-sheet";
import { unitLabel } from "@/lib/unit";
import { countWorkDays, monthWorkDays, workCalendar, weekLabel, type WorkCalendar } from "@/lib/work-calendar";
import { groupsOf } from "./panel";
import { r2 } from "./rows";

/**
 * «KUNLIK REALIZATSIYA HISOBOTI» (Sheets varag'i) — tanlangan kun va oy boshidan:
 * to'lov turi bo'yicha summa, guruhlar hajmi va rekord oy, realizatsiya rejasi, sotuvchilar, shu kungi sotuvlar.
 *
 * Sotuv — yetkazilgan reyslar (`loadRevenue`, Tahlil va Bosh sahifa bilan bir raqam). Dastavka zayavkadan
 * reysga yetkazilgan ulushi bo'yicha bo'linadi va QQS'siz summaga qo'shiladi (`order-day-sheet` kabi, QQS'siz).
 * To'lov turi — `order-day-sheet` qoidasi: qarzga → «Qarz», keyin `payMethod`; usul yozilmagan zayavka NDS'li
 * bo'lsa perechisleniyega, aks holda naqdga tushadi va «Nazorat» qatorida ko'rsatiladi.
 * Reja va sotuvchilar — QQS bilan, dastavkasiz (Reja nazorati bilan bir xil). Ish kuni — Dushanba–Shanba.
 */
export type RzRow = {
  pay: PayGroupKey; payLabel: string; seller: string; customer: string; product: string; unit: string;
  qty: number; price: number; delivery: number; net: number; vat: number; total: number; address: string;
};
export type RzPay = { key: PayGroupKey; label: string; net: number; delivery: number; vat: number; total: number; month: number; share: number };
export type RzGroup = {
  group: string; unit: string; today: number; month: number;
  record: { qty: number; label: string; workDays: number; fromErp: boolean } | null;
  manual: { qty: number; year: number; month: number; workDays: number | null; autoWorkDays: number } | null;
  recordPct: number | null; forecast: number; dayPlan: number | null; dayPct: number | null;
};
export type RzSeller = { id: string; name: string; today: number; month: number; plan: number | null; pct: number | null };

export type Realizatsiya = {
  day: Date; isToday: boolean; wdPassed: number; wdTotal: number;
  /** Ish tartibi: "6/1" va shu oydagi bayramlar */
  week: string; holidays: { date: string; name: string }[];
  /** Oydagi ish kuni qo'lda kiritilganmi va kalendar bo'yicha qancha */
  wdManual: boolean; wdAuto: number;
  pay: RzPay[]; payTotal: Omit<RzPay, "key" | "label">; unset: { today: number; month: number; orders: number };
  groups: RzGroup[];
  /** Rekord kiritish uchun barcha yuqori guruhlar (shu oy sotilmaganlari ham) */
  allGroups: { group: string; unit: string }[];
  plan: { year: number; mon: number; companySet: boolean; month: number; day: number; factMonth: number; factDay: number; pctMonth: number | null; pctDay: number | null; forecast: number; forecastPct: number | null; avgDay: number };
  sellers: RzSeller[]; sellersTotal: { today: number; month: number; plan: number };
  rows: RzRow[];
};

export const MONTHS = ["Yanvar", "Fevral", "Mart", "Aprel", "May", "Iyun", "Iyul", "Avgust", "Sentabr", "Oktabr", "Noyabr", "Dekabr"];
const monthLabel = (y: number, m: number) => `${MONTHS[m - 1]} ${y}`;
const monthWd = (cal: WorkCalendar, y: number, m: number) => monthWorkDays(cal, y, m);

export async function realizatsiyaReport(dayIn?: Date): Promise<Realizatsiya> {
  const nowDay = new Date(); nowDay.setHours(0, 0, 0, 0);
  const day = dayIn ? new Date(dayIn) : new Date(nowDay); day.setHours(0, 0, 0, 0);
  const next = addDays(day, 1);
  const y = day.getFullYear(), mo = day.getMonth() + 1;
  const monthStart = new Date(y, mo - 1, 1), monthEnd = new Date(y, mo, 1);
  const cal = await workCalendar();
  const wdPassed = workingDays(monthStart, next, cal), wdTotal = monthWorkDays(cal, y, mo);
  const wdAuto = countWorkDays(cal, monthStart, monthEnd), wdManual = cal.monthDays.has(`${y}-${String(mo).padStart(2, "0")}`);
  const holidays = [...cal.holidays].filter(([k]) => k >= isoDate(monthStart) && k < isoDate(monthEnd)).map(([k, name]) => ({ date: k, name }));
  const live = await goLiveDate();
  // Rekord uchun ERP tarixi — tizimga o'tilgan oydan (bo'lmasa bir yil oldin) tanlangan kungacha
  const histFrom = live ? new Date(live.getFullYear(), live.getMonth(), 1) : new Date(y - 1, mo - 1, 1);

  const [revMonth, hist, prods, records, plans, users] = await Promise.all([
    loadRevenue(monthStart, next),
    loadRevenue(histFrom < monthStart ? histFrom : monthStart, monthStart),
    groupsOf(),
    db.salesRecord.findMany({ orderBy: { createdAt: "asc" } }),
    db.salesPlan.findMany({ where: { year: y, month: mo } }),
    db.user.findMany({ select: { id: true, fullName: true } }),
  ]);
  const orders = await db.order.findMany({
    where: { id: { in: [...new Set(revMonth.map((r) => r.orderId))] } },
    select: { id: true, payMethod: true, onCredit: true, deliveryFee: true, deliveryAddress: true, site: { select: { name: true } }, items: { select: { qtyM3: true, nds: true } } },
  });
  const orderOf = new Map(orders.map((o) => [o.id, o]));
  const isDay = (d: Date) => d >= day && d < next;
  const payLabel = new Map(PAY_GROUPS.map((p) => [p.key, p.label]));

  // ── Qatorlar: dastavka ulushi, QQS, to'lov turi ──
  const all = revMonth.map((r) => {
    const o = orderOf.get(r.orderId);
    const totalQty = o ? sum(o.items.map((i) => Number(i.qtyM3))) : 0;
    const delivery = o && totalQty > 0 ? (Number(o.deliveryFee) * r.qty) / totalQty : 0;
    const pay: PayGroupKey = o?.onCredit ? "DEBT" : o?.payMethod ? (o.payMethod === "BANK" ? "BANK" : "CASH") : o?.items.some((i) => i.nds) ? "BANK" : "CASH";
    return {
      src: r, unset: !!o && !o.onCredit && !o.payMethod, group: prods.get(r.productId)?.group ?? "Boshqalar",
      row: {
        pay, payLabel: payLabel.get(pay) ?? pay, seller: r.seller, customer: r.customer, product: r.product, unit: unitLabel(r.unit),
        qty: r.qty, price: r.qty ? r.net / r.qty : r.price, delivery, net: r.net + delivery, vat: r.revenue - r.net, total: r.revenue + delivery,
        address: o?.site?.name || o?.deliveryAddress || "",
      } satisfies RzRow,
    };
  });
  const today = all.filter((x) => isDay(x.src.date));

  // ── 1. To'lov turi bo'yicha ──
  const monthTotal = sum(all.map((x) => x.row.total));
  const pay: RzPay[] = PAY_GROUPS.map(({ key, label }) => {
    const d = today.filter((x) => x.row.pay === key).map((x) => x.row), m = all.filter((x) => x.row.pay === key);
    const month = sum(m.map((x) => x.row.total));
    return { key, label, net: r2(sum(d.map((x) => x.net))), delivery: r2(sum(d.map((x) => x.delivery))), vat: r2(sum(d.map((x) => x.vat))), total: r2(sum(d.map((x) => x.total))), month: r2(month), share: monthTotal ? (month / monthTotal) * 100 : 0 };
  });
  const payTotal = { net: r2(sum(pay.map((p) => p.net))), delivery: r2(sum(pay.map((p) => p.delivery))), vat: r2(sum(pay.map((p) => p.vat))), total: r2(sum(pay.map((p) => p.total))), month: r2(monthTotal), share: monthTotal ? 100 : 0 };
  const unsetRows = all.filter((x) => x.unset);
  const unset = { today: r2(sum(unsetRows.filter((x) => isDay(x.src.date)).map((x) => x.row.total))), month: r2(sum(unsetRows.map((x) => x.row.total))), orders: new Set(unsetRows.map((x) => x.src.orderId)).size };

  // ── 2. Hajm va reja: guruhlar, rekord oy (qo'lda yoki ERP'dagi kattaroq oy) ──
  const units = new Map<string, Map<string, number>>();
  for (const p of prods.values()) { const u = units.get(p.group) ?? new Map<string, number>(); u.set(p.unit, (u.get(p.unit) ?? 0) + 1); units.set(p.group, u); }
  const unitOf = (g: string) => unitLabel([...(units.get(g) ?? new Map<string, number>())].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "");
  const erpMonths = new Map<string, Map<string, number>>(); // guruh → "YYYY-M" → miqdor
  for (const r of [...hist, ...revMonth]) {
    const g = prods.get(r.productId)?.group ?? "Boshqalar", k = `${r.date.getFullYear()}-${r.date.getMonth() + 1}`;
    const m = erpMonths.get(g) ?? new Map<string, number>(); m.set(k, (m.get(k) ?? 0) + r.qty); erpMonths.set(g, m);
  }
  const groupNames = [...records.map((r) => r.group), ...[...new Set(all.map((x) => x.group))].filter((g) => !records.some((r) => r.group === g)).sort((a, b) => sum(all.filter((x) => x.group === b).map((x) => x.src.qty)) - sum(all.filter((x) => x.group === a).map((x) => x.src.qty)))];
  const groups: RzGroup[] = groupNames.map((g) => {
    const rec = records.find((r) => r.group === g);
    const manual = rec ? { qty: Number(rec.qty), year: rec.year, month: rec.month, workDays: rec.workDays, autoWorkDays: monthWd(cal, rec.year, rec.month) } : null;
    const erpTop = [...(erpMonths.get(g) ?? new Map<string, number>())].sort((a, b) => b[1] - a[1])[0];
    let record: RzGroup["record"] = manual ? { qty: manual.qty, label: monthLabel(manual.year, manual.month), workDays: manual.workDays ?? monthWd(cal, manual.year, manual.month), fromErp: false } : null;
    if (erpTop && erpTop[1] > (record?.qty ?? 0)) {
      const [ey, em] = erpTop[0].split("-").map(Number) as [number, number];
      record = { qty: r2(erpTop[1]), label: monthLabel(ey, em), workDays: monthWd(cal, ey, em), fromErp: true };
    }
    const todayQ = r2(sum(today.filter((x) => x.group === g).map((x) => x.src.qty))), monthQ = r2(sum(all.filter((x) => x.group === g).map((x) => x.src.qty)));
    const dayPlan = record && record.workDays > 0 ? record.qty / record.workDays : null;
    return {
      group: g, unit: unitOf(g), today: todayQ, month: monthQ, record, manual,
      recordPct: record?.qty ? (monthQ / record.qty) * 100 : null,
      forecast: wdPassed > 0 ? (monthQ / wdPassed) * wdTotal : 0,
      dayPlan, dayPct: dayPlan ? (todayQ / dayPlan) * 100 : null,
    };
  });

  // ── 3. Realizatsiya rejasi (QQS bilan, dastavkasiz) ──
  const companyRow = plans.find((p) => p.sellerId === null);
  const sellerPlans = plans.filter((p) => p.sellerId !== null);
  const planMonth = companyRow ? Number(companyRow.amount) : sum(sellerPlans.map((p) => Number(p.amount)));
  const factMonth = r2(sum(revMonth.map((r) => r.revenue))), factDay = r2(sum(today.map((x) => x.src.revenue)));
  const planDay = wdTotal > 0 ? planMonth / wdTotal : 0;
  const forecast = wdPassed > 0 ? (factMonth / wdPassed) * wdTotal : 0;
  const plan = {
    year: y, mon: mo, companySet: !!companyRow, month: planMonth, day: r2(planDay), factMonth, factDay,
    pctMonth: planMonth > 0 ? (factMonth / planMonth) * 100 : null, pctDay: planDay > 0 ? (factDay / planDay) * 100 : null,
    forecast: r2(forecast), forecastPct: planMonth > 0 ? (forecast / planMonth) * 100 : null, avgDay: wdPassed > 0 ? r2(factMonth / wdPassed) : 0,
  };

  // ── 4. Sotuvchilar ──
  const nameOf = new Map(users.map((u) => [u.id, u.fullName]));
  const sellerIds = [...new Set([...sellerPlans.map((p) => p.sellerId as string), ...revMonth.map((r) => r.sellerId)])];
  const sellers: RzSeller[] = sellerIds.map((id) => {
    const rows = revMonth.filter((r) => r.sellerId === id);
    const p = sellerPlans.find((x) => x.sellerId === id); const planS = p ? Number(p.amount) : null;
    const month = r2(sum(rows.map((r) => r.revenue)));
    return { id, name: nameOf.get(id) ?? rows[0]?.seller ?? "Noma'lum", today: r2(sum(rows.filter((r) => isDay(r.date)).map((r) => r.revenue))), month, plan: planS, pct: planS ? (month / planS) * 100 : null };
  }).sort((a, b) => (b.plan ?? 0) - (a.plan ?? 0) || b.month - a.month);
  const sellersTotal = { today: r2(sum(sellers.map((s) => s.today))), month: r2(sum(sellers.map((s) => s.month))), plan: sum(sellers.map((s) => s.plan ?? 0)) };

  // ── 5. Shu kundagi sotuvlar ──
  const order = new Map(PAY_GROUPS.map((p, i) => [p.key, i]));
  const rows = today.map((x) => x.row).sort((a, b) => (order.get(a.pay)! - order.get(b.pay)!) || a.seller.localeCompare(b.seller) || a.customer.localeCompare(b.customer));

  const allGroups = [...new Set([...groupNames, ...[...prods.values()].map((p) => p.group).sort((a, b) => a.localeCompare(b))])].map((g) => ({ group: g, unit: unitOf(g) }));
  return { day, isToday: day.getTime() === nowDay.getTime(), wdPassed, wdTotal, wdManual, wdAuto, week: weekLabel(cal.restDays), holidays, pay, payTotal, unset, groups, allGroups, plan, sellers, sellersTotal, rows };
}
