import type { Prisma } from "@/generated/prisma";
import { db } from "@/lib/db";
import { money } from "@/lib/format";
import { DRILL_LIMIT, sortDrill, type Drill, type DrillItem } from "@/lib/drill";
import { EXPENSE_KIND, ISSUE_KIND, VEHICLE_ISSUE_KINDS } from "@/lib/logistics";

/**
 * Tahlil → Mexanik raqamining manbasi (drill-down) — `lib/mechanic-report.ts` bilan bir xil qoida:
 *   repair / parts / total — transport xarajati (ta'mir, zapchast), bekor qilinmagan; factory — to'langan zavod/boshqa so'rovlar;
 *   issues — reysdagi buzilish va YTH; services — texnik xizmatlar. `vehicle`: texnika id, «*» — texnikasi ko'rsatilganlar (jadval jami).
 */
export type MechDrillKind = "repair" | "parts" | "total" | "factory" | "issues" | "services";
export const MECH_DRILL_KINDS: readonly MechDrillKind[] = ["repair", "parts", "total", "factory", "issues", "services"];

const TITLE: Record<MechDrillKind, string> = { repair: "Ta'mir xarajati", parts: "Zapchast xarajati", total: "Ta'mir + zapchast", factory: "Zavod / boshqa ta'mir (to'langan so'rovlar)", issues: "Buzilish / YTH", services: "Texnik xizmat" };

export async function mechDrill(from: Date, to: Date, period: string, o: { kind: MechDrillKind; vehicle?: string }): Promise<Drill | null> {
  const range = { gte: from, lt: to };
  const veh = (o.vehicle === "*" ? { vehicleId: { not: null } } : o.vehicle ? { vehicleId: o.vehicle } : {}) as { vehicleId?: string | { not: null } };
  const plate = o.vehicle && o.vehicle !== "*" ? (await db.vehicle.findUnique({ where: { id: o.vehicle }, select: { plate: true } }))?.plate : null;
  let items: DrillItem[] = [];
  let count = false;

  if (o.kind === "repair" || o.kind === "parts" || o.kind === "total") {
    const kinds = o.kind === "total" ? (["REPAIR", "PARTS"] as const) : o.kind === "repair" ? (["REPAIR"] as const) : (["PARTS"] as const);
    const rows = await db.transportExpense.findMany({
      where: { kind: { in: [...kinds] }, cancelledAt: null, date: range, ...veh } as Prisma.TransportExpenseWhereInput,
      select: { date: true, kind: true, amount: true, note: true, vehicle: { select: { plate: true } }, driver: { select: { fullName: true } } },
    });
    items = rows.map((e) => ({ date: e.date, title: `${EXPENSE_KIND[e.kind]}${e.vehicle ? ` — ${e.vehicle.plate}` : ""}`, sub: [e.driver?.fullName, e.note?.trim()].filter(Boolean).join(" · "), amount: Number(e.amount), href: "/logistika/xarajatlar" }));
  } else if (o.kind === "factory") {
    const rows = await db.mechanicRequest.findMany({
      where: { status: "PAID", paidAt: range, target: { in: ["FACTORY", "OTHER"] } },
      select: { id: true, docNo: true, problem: true, amount: true, paidAt: true, createdBy: { select: { fullName: true } } },
    });
    items = rows.map((r) => ({ date: r.paidAt, title: `${r.docNo} — ${r.problem}`, sub: r.createdBy.fullName, amount: Number(r.amount), href: `/mexanik-sorovlar/${r.id}` }));
  } else if (o.kind === "issues") {
    count = true;
    const rows = await db.tripIssue.findMany({
      where: { kind: { in: VEHICLE_ISSUE_KINDS }, createdAt: range, ...(o.vehicle && o.vehicle !== "*" ? { trip: { vehicleId: o.vehicle } } : {}) },
      select: { createdAt: true, kind: true, note: true, resolvedAt: true, trip: { select: { id: true, deliveryNoteNo: true, vehicle: { select: { plate: true } } } } },
    });
    items = rows.map((i) => ({ date: i.createdAt, title: `${ISSUE_KIND[i.kind]} — ${i.trip.vehicle.plate}`, sub: [`Reys ${i.trip.deliveryNoteNo}`, i.resolvedAt ? "hal qilingan" : "hal qilinmagan", i.note?.trim()].filter(Boolean).join(" · "), amount: 1, href: `/trips/${i.trip.id}` }));
  } else {
    count = true;
    const rows = await db.vehicleService.findMany({
      where: { cancelledAt: null, date: range, ...(o.vehicle && o.vehicle !== "*" ? { vehicleId: o.vehicle } : {}) },
      select: { date: true, kind: true, cost: true, note: true, vehicleId: true, vehicle: { select: { plate: true } } },
    });
    items = rows.map((s) => ({ date: s.date, title: `${s.kind} — ${s.vehicle.plate}`, sub: [s.cost != null ? money(Number(s.cost)) : null, s.note?.trim()].filter(Boolean).join(" · "), amount: 1, href: `/logistika/transport/${s.vehicleId}` }));
  }

  const shown = sortDrill(items);
  return {
    title: `${TITLE[o.kind]}${plate ? ` — ${plate}` : ""}`, period, value: Math.round(items.reduce((s, i) => s + i.amount, 0) * 100) / 100,
    ...(count ? { isQty: true, unit: "ta" } : {}), parts: [], items: shown.slice(0, DRILL_LIMIT),
    note: shown.length > DRILL_LIMIT ? `${shown.length} ta yozuvdan eng so'nggi ${DRILL_LIMIT} tasi ko'rsatildi.` : undefined,
  };
}
