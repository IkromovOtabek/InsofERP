import type { Prisma } from "@/generated/prisma";
import { db } from "@/lib/db";
import { fmtNum } from "@/lib/format";
import { DRILL_LIMIT, sortDrill, type Drill, type DrillItem } from "@/lib/drill";
import type { Range } from "./core";

/**
 * Tahlil → Ishlab chiqarish raqamining manbasi (drill-down) — `lib/bi/operations.ts` bilan bir xil qoida:
 *   reys sanasi — yetkazilgan bo'lsa `deliveredAt`, aks holda `createdAt`; bekor qilingan reys hisobga kirmaydi;
 *   beton m³ — faqat mikser reyslari; zames — bekor qilinmagan, m³ mahsulot.
 *   trips — reyslar soni, delivered — yetkazilgan reyslar, m3 — reyslardagi m³, deliveredM3 — yetkazilgan mikser m³,
 *   produced — zameslar (m³). Filtr: `vehicle` (mikser), `driver` (haydovchi), `product` (marka).
 */
export type OpsDrillKind = "trips" | "delivered" | "m3" | "deliveredM3" | "produced";
export const OPS_DRILL_KINDS: readonly OpsDrillKind[] = ["trips", "delivered", "m3", "deliveredM3", "produced"];

const TITLE: Record<OpsDrillKind, string> = { trips: "Reyslar", delivered: "Yetkazilgan reyslar", m3: "Reyslardagi beton, m³", deliveredM3: "Yetkazilgan beton, m³", produced: "Ishlab chiqarilgan beton (zameslar)" };
const STATUS: Record<string, string> = { PLANNED: "rejada", LOADING: "yuklanmoqda", LOADED: "yuklandi", ON_ROAD: "yo'lda", DELIVERED: "yetkazildi", CANCELLED: "bekor" };

export async function opsDrill(r: Range, o: { kind: OpsDrillKind; vehicle?: string; driver?: string; product?: string }): Promise<Drill | null> {
  const period = r.label;
  if (o.kind === "produced") {
    const where: Prisma.ProductionBatchWhereInput = { cancelledAt: null, product: { unit: "m3" }, date: { gte: r.from, lt: r.to }, ...(o.product ? { productId: o.product } : {}) };
    const [agg, rows] = await Promise.all([
      db.productionBatch.aggregate({ where, _sum: { qtyM3: true }, _count: { _all: true } }),
      db.productionBatch.findMany({ where, orderBy: { date: "desc" }, take: DRILL_LIMIT, select: { date: true, qtyM3: true, shift: true, product: { select: { name: true } }, order: { select: { id: true, orderNo: true, customer: { select: { name: true } } } } } }),
    ]);
    const items: DrillItem[] = rows.map((b) => ({
      date: b.date, title: b.order ? `${b.product.name} — ${b.order.customer.name}` : `${b.product.name} — zayavkasiz`,
      sub: [b.order ? `Zayavka ${b.order.orderNo}` : null, b.shift ? `${b.shift}-smena` : null].filter(Boolean).join(" · "),
      amount: Number(b.qtyM3), href: b.order ? `/orders/${b.order.id}` : "/production",
    }));
    const name = o.product ? rows[0]?.product.name ?? (await db.product.findUnique({ where: { id: o.product }, select: { name: true } }))?.name : null;
    return {
      title: `${TITLE.produced}${name ? ` — ${name}` : ""}`, period, value: Math.round(Number(agg._sum.qtyM3 ?? 0) * 1000) / 1000, isQty: true, unit: "m³", parts: [], items: sortDrill(items),
      note: `${agg._count._all} ta zames${agg._count._all > DRILL_LIMIT ? ` — eng so'nggi ${DRILL_LIMIT} tasi ko'rsatildi` : ""}.`,
    };
  }

  const where: Prisma.TripWhereInput = {
    status: o.kind === "delivered" || o.kind === "deliveredM3" ? "DELIVERED" : { not: "CANCELLED" },
    OR: [{ deliveredAt: { gte: r.from, lt: r.to } }, { deliveredAt: null, createdAt: { gte: r.from, lt: r.to } }],
    ...(o.vehicle ? { vehicleId: o.vehicle } : {}), ...(o.driver ? { driverId: o.driver } : {}),
    // m³ — faqat mikser reyslari (beton faqat mikserda), `operations.ts` dagi `m3Of`
    ...(o.kind === "deliveredM3" || o.kind === "m3" ? { vehicle: { type: "MIXER" } } : {}),
  };
  const trips = await db.trip.findMany({
    where, select: {
      id: true, deliveryNoteNo: true, status: true, qtyM3: true, createdAt: true, deliveredAt: true,
      vehicle: { select: { plate: true } }, driver: { select: { fullName: true } }, order: { select: { customer: { select: { name: true } } } },
    },
  });
  const count = o.kind === "trips" || o.kind === "delivered";
  const items: DrillItem[] = trips.map((t) => ({
    date: t.deliveredAt ?? t.createdAt, title: `${t.deliveryNoteNo} — ${t.order.customer.name}`,
    sub: [t.vehicle.plate, t.driver?.fullName, `${fmtNum(Number(t.qtyM3), 3)} m³`, STATUS[t.status] ?? t.status].filter(Boolean).join(" · "),
    amount: count ? 1 : Number(t.qtyM3), href: `/trips/${t.id}`,
  }));
  const who = o.vehicle ? (await db.vehicle.findUnique({ where: { id: o.vehicle }, select: { plate: true } }))?.plate
    : o.driver ? (await db.employee.findUnique({ where: { id: o.driver }, select: { fullName: true } }))?.fullName : null;
  const value = Math.round(items.reduce((s, i) => s + i.amount, 0) * 1000) / 1000;
  const shown = sortDrill(items);
  return {
    title: `${TITLE[o.kind]}${who ? ` — ${who}` : ""}`, period, value, isQty: true, unit: count ? "ta reys" : "m³", parts: [], items: shown.slice(0, DRILL_LIMIT),
    note: shown.length > DRILL_LIMIT ? `${shown.length} ta reysdan eng so'nggi ${DRILL_LIMIT} tasi ko'rsatildi.` : "Reys sanasi — yetkazilgan payt (yetkazilmagan bo'lsa ochilgan payt); bekor qilingan reys kirmaydi.",
  };
}
