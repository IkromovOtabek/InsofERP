import { db } from "@/lib/db";
import { isoDate } from "@/lib/format";
import { ORDER_STATUS } from "./status";
import { CalendarView, type DayCell } from "./calendar-view";
import { fmtUnitTotals } from "@/lib/unit";

/**
 * 10 kunlik ish tartibi uchun ma'lumot: qaysi kunga qancha hajm olingan va qanday zayavkalar bor.
 * Ko'rinish — `calendar-view.tsx` (klient): kun tanlanganda sahifa yangilanmaydi.
 * Kunlik quvvat: Sozlamalar → «Kunlik quvvat (m³)» (sukut 200).
 */
const WEEKDAYS = ["Yak", "Dush", "Sesh", "Chor", "Pay", "Jum", "Shan"];

export async function OrderLoadCalendar({ days = 10 }: { days?: number }) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const until = new Date(today); until.setDate(until.getDate() + days);

  const [orders, settings] = await Promise.all([
    db.order.findMany({
      where: { status: { not: "CANCELLED" }, deliveryDate: { gte: today, lt: until } },
      orderBy: [{ deliveryTime: "asc" }],
      select: {
        id: true, orderNo: true, deliveryDate: true, deliveryTime: true, isUrgent: true, status: true,
        customer: { select: { name: true } },
        items: { select: { qtyM3: true, price: true, product: { select: { unit: true } } } },
      },
    }),
    db.companySettings.findUnique({ where: { id: "main" }, select: { dailyCapacityM3: true } }),
  ]);
  const capacity = Math.max(1, Number(settings?.dailyCapacityM3 ?? 200));

  const byDay = new Map<string, DayCell["list"]>();
  for (const o of orders) {
    const key = isoDate(o.deliveryDate);
    byDay.set(key, [...(byDay.get(key) ?? []), {
      id: o.id, orderNo: o.orderNo, customer: o.customer.name, time: o.deliveryTime,
      status: o.status, statusLabel: ORDER_STATUS[o.status].label, urgent: o.isUrgent,
      // m3 — faqat beton: ustun balandligi kunlik beton quvvatiga nisbatan o'lchanadi
      m3: o.items.reduce((s, i) => s + (i.product.unit === "m3" ? Number(i.qtyM3) : 0), 0),
      // vol — zayavkaning to'liq hajmi mahsulot birligida ("12 m³ · 500 dona")
      vol: fmtUnitTotals(o.items.map((i) => ({ unit: i.product.unit, qty: i.qtyM3 }))),
      sum: o.items.reduce((s, i) => s + Number(i.qtyM3) * Number(i.price), 0),
    }]);
  }

  const cells: DayCell[] = Array.from({ length: days }, (_, n) => {
    const d = new Date(today); d.setDate(d.getDate() + n);
    const key = isoDate(d);
    const list = byDay.get(key) ?? [];
    const m3 = list.reduce((s, o) => s + o.m3, 0);
    const pct = Math.min(100, (m3 / capacity) * 100);
    return {
      key, label: n === 0 ? "Bugun" : `${d.getDate()}/${String(d.getMonth() + 1).padStart(2, "0")}`,
      weekday: WEEKDAYS[d.getDay()], list, m3, pct, count: list.length,
      urgent: list.filter((o) => o.urgent).length,
      state: list.length === 0 ? "free" : pct >= 95 ? "full" : "busy",
      isToday: n === 0,
    };
  });

  return <CalendarView cells={cells} capacity={capacity} />;
}
