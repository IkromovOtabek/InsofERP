import { db } from "@/lib/db";
import { isoDate } from "@/lib/format";
import { ORDER_STATUS } from "./status";
import { CalendarView, type DayCell } from "./calendar-view";
import { fmtUnitTotals } from "@/lib/unit";
import { orderTotal } from "@/lib/order-total";

/**
 * Haftalik ish tartibi uchun ma'lumot: qaysi kunga qancha hajm olingan va qanday zayavkalar bor.
 * Ko'rinish — `calendar-view.tsx` (klient): kun tanlanganda sahifa yangilanmaydi.
 * Kunlik limit (quvvat): m³ (sukut 200) va dona — taqvim tepasidan (direktor) yoki Sozlamalar → Limitlar.
 */
const WEEKDAYS = ["Yak", "Dush", "Sesh", "Chor", "Pay", "Jum", "Shan"];
const MONTHS = ["yan", "fev", "mar", "apr", "may", "iyun", "iyul", "avg", "sen", "okt", "noy", "dek"];

export async function OrderLoadCalendar({ days = 7, canEdit = false }: { days?: number; canEdit?: boolean }) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const until = new Date(today); until.setDate(until.getDate() + days);

  const [orders, settings] = await Promise.all([
    db.order.findMany({
      where: { status: { not: "CANCELLED" }, dateUnknown: false, deliveryDate: { gte: today, lt: until } },
      orderBy: [{ deliveryTime: "asc" }],
      select: {
        id: true, orderNo: true, deliveryDate: true, deliveryTime: true, isUrgent: true, status: true,
        customer: { select: { name: true } },
        deliveryFee: true, items: { select: { qtyM3: true, price: true, product: { select: { unit: true } } } },
      },
    }),
    db.companySettings.findUnique({ where: { id: "main" }, select: { dailyCapacityM3: true, dailyCapacityPcs: true } }),
  ]);
  const capacity = Math.max(1, Number(settings?.dailyCapacityM3 ?? 200));
  // Dona limiti ixtiyoriy: belgilanmagan bo'lsa kartada faqat jami dona ko'rinadi, rangga ta'sir qilmaydi
  const capacityPcs = settings?.dailyCapacityPcs && settings.dailyCapacityPcs > 0 ? settings.dailyCapacityPcs : null;

  const byDay = new Map<string, DayCell["list"]>();
  for (const o of orders) {
    const key = isoDate(o.deliveryDate);
    byDay.set(key, [...(byDay.get(key) ?? []), {
      id: o.id, orderNo: o.orderNo, customer: o.customer.name, time: o.deliveryTime,
      status: o.status, statusLabel: ORDER_STATUS[o.status].label, urgent: o.isUrgent,
      // m3 — faqat beton: ustun balandligi kunlik beton quvvatiga nisbatan o'lchanadi
      m3: o.items.reduce((s, i) => s + (i.product.unit === "m3" ? Number(i.qtyM3) : 0), 0),
      // pcs — dona mahsulot (ustun, blok): kunlik dona limitiga nisbatan
      pcs: o.items.reduce((s, i) => s + (i.product.unit === "dona" ? Number(i.qtyM3) : 0), 0),
      // vol — zayavkaning to'liq hajmi mahsulot birligida ("12 m³ · 500 dona")
      vol: fmtUnitTotals(o.items.map((i) => ({ unit: i.product.unit, qty: i.qtyM3 }))),
      sum: orderTotal(o),
    }]);
  }

  const cells: DayCell[] = Array.from({ length: days }, (_, n) => {
    const d = new Date(today); d.setDate(d.getDate() + n);
    const key = isoDate(d);
    const list = byDay.get(key) ?? [];
    const m3 = list.reduce((s, o) => s + o.m3, 0);
    const pcs = list.reduce((s, o) => s + o.pcs, 0);
    const pctM3 = Math.min(100, (m3 / capacity) * 100);
    const pctPcs = capacityPcs ? Math.min(100, (pcs / capacityPcs) * 100) : 0;
    // Kun rangi — ikkala limitdan qaysi biri ko'proq to'lgan bo'lsa, shunga qarab
    const pct = Math.max(pctM3, pctPcs);
    return {
      key, label: `${d.getDate()} ${MONTHS[d.getMonth()]}`,
      weekday: WEEKDAYS[d.getDay()], list, m3, pcs, pctM3, pctPcs, pct, count: list.length,
      urgent: list.filter((o) => o.urgent).length,
      state: list.length === 0 ? "free" : pct >= 90 ? "full" : "busy",
      isToday: n === 0,
    };
  });

  return <CalendarView cells={cells} capacity={capacity} capacityPcs={capacityPcs} canEdit={canEdit} />;
}
