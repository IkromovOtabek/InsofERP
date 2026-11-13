import type { Prisma } from "@/generated/prisma";
import { db } from "@/lib/db";
import { fmtNum } from "@/lib/format";
import { DRILL_LIMIT, sortDrill, type Drill, type DrillItem } from "@/lib/drill";
import { EXPENSE_KIND, FUEL_TYPE } from "@/lib/logistics";

/**
 * Tahlil → Logistika raqamining manbasi (drill-down) — `lib/logistics-report.ts` bilan bir xil qoida:
 *   delivered — davrda yetkazilgan reyslar (`deliveredAt` davr ichida), cancelled — davrda ochilgan/yetkazilgan, bekor qilingan;
 *   cost — transport xarajati: yoqilg'i (`FuelLog`) + boshqa xarajat (`TransportExpense`), bekor qilinganlar kirmaydi.
 * Filtr: `driver` (haydovchi), `site` (obyekt id yoki «addr:<manzil>» — obyektsiz zayavka).
 */
export type LogiDrillKind = "delivered" | "cancelled" | "cost";
export const LOGI_DRILL_KINDS: readonly LogiDrillKind[] = ["delivered", "cancelled", "cost"];

export async function logiDrill(from: Date, to: Date, period: string, o: { kind: LogiDrillKind; driver?: string; site?: string }): Promise<Drill | null> {
  const driverName = o.driver ? (await db.employee.findUnique({ where: { id: o.driver }, select: { fullName: true } }))?.fullName : null;

  if (o.kind === "cost") {
    const by = o.driver ? { driverId: o.driver } : {};
    const [fuel, other] = await Promise.all([
      db.fuelLog.findMany({ where: { date: { gte: from, lt: to }, cancelledAt: null, ...by }, select: { date: true, amount: true, liters: true, fuelType: true, station: true, note: true, vehicle: { select: { plate: true } } } }),
      db.transportExpense.findMany({ where: { date: { gte: from, lt: to }, cancelledAt: null, ...by }, select: { date: true, amount: true, kind: true, note: true, vehicle: { select: { plate: true } }, driver: { select: { fullName: true } } } }),
    ]);
    const items: DrillItem[] = [
      ...fuel.map((f) => ({ date: f.date, title: `Yoqilg'i — ${f.vehicle.plate}`, sub: [`${FUEL_TYPE[f.fuelType]} ${fmtNum(Number(f.liters), 2)} l`, f.station, f.note?.trim()].filter(Boolean).join(" · "), amount: Number(f.amount), href: "/logistika/yoqilgi" })),
      ...other.map((e) => ({ date: e.date, title: `${EXPENSE_KIND[e.kind]}${e.vehicle ? ` — ${e.vehicle.plate}` : ""}`, sub: [e.driver?.fullName, e.note?.trim()].filter(Boolean).join(" · "), amount: Number(e.amount), href: "/logistika/xarajatlar" })),
    ];
    const shown = sortDrill(items);
    return {
      title: `Transport xarajati${driverName ? ` — ${driverName}` : ""}`, period, value: Math.round(items.reduce((s, i) => s + i.amount, 0) * 100) / 100, parts: [], items: shown.slice(0, DRILL_LIMIT),
      note: `Yoqilg'i ${fuel.length} ta, boshqa xarajat ${other.length} ta${shown.length > DRILL_LIMIT ? ` — eng so'nggi ${DRILL_LIMIT} tasi ko'rsatildi` : ""}.`,
    };
  }

  const site: Prisma.TripWhereInput = !o.site ? {} : o.site.startsWith("addr:") ? { order: { siteId: null, deliveryAddress: o.site.slice(5) } } : { order: { siteId: o.site } };
  const where: Prisma.TripWhereInput = o.kind === "delivered"
    ? { status: "DELIVERED", deliveredAt: { gte: from, lt: to }, ...(o.driver ? { driverId: o.driver } : {}), ...site }
    : { status: "CANCELLED", OR: [{ createdAt: { gte: from, lt: to } }, { deliveredAt: { gte: from, lt: to } }], ...(o.driver ? { driverId: o.driver } : {}), ...site };
  const trips = await db.trip.findMany({
    where, orderBy: { createdAt: "desc" },
    select: {
      id: true, deliveryNoteNo: true, qtyM3: true, createdAt: true, deliveredAt: true, vehicle: { select: { plate: true } }, driver: { select: { fullName: true } },
      order: { select: { customer: { select: { name: true } }, site: { select: { name: true } }, deliveryAddress: true, items: { select: { product: { select: { unit: true } } } } } },
    },
  });
  const items: DrillItem[] = trips.map((t) => {
    const unit = t.order.items.every((i) => i.product.unit === "m3") ? "m³" : "dona";
    return {
      date: t.deliveredAt ?? t.createdAt, title: `${t.deliveryNoteNo} — ${t.order.customer.name}`,
      sub: [t.order.site?.name ?? t.order.deliveryAddress, t.vehicle.plate, t.driver?.fullName, `${fmtNum(Number(t.qtyM3), 3)} ${unit}`].filter(Boolean).join(" · "),
      amount: 1, href: `/trips/${t.id}`,
    };
  });
  const m3 = trips.filter((t) => t.order.items.every((i) => i.product.unit === "m3")).reduce((s, t) => s + Number(t.qtyM3), 0);
  const pcs = trips.filter((t) => !t.order.items.every((i) => i.product.unit === "m3")).reduce((s, t) => s + Number(t.qtyM3), 0);
  const siteName = o.site ? trips[0]?.order.site?.name ?? (o.site.startsWith("addr:") ? o.site.slice(5) : null) : null;
  const shown = sortDrill(items);
  return {
    title: `${o.kind === "delivered" ? "Yetkazilgan reyslar" : "Bekor qilingan reyslar"}${driverName ? ` — ${driverName}` : ""}${siteName ? ` — ${siteName}` : ""}`,
    period, value: items.length, isQty: true, unit: "ta reys", parts: [], items: shown.slice(0, DRILL_LIMIT),
    note: [m3 ? `${fmtNum(m3, 1)} m³` : "", pcs ? `${fmtNum(pcs)} dona` : ""].filter(Boolean).join(" · ") || undefined,
  };
}
