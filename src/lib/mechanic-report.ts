import { db } from "@/lib/db";
import { expiryLevel, VEHICLE_ISSUE_KINDS, type Level } from "@/lib/logistics";

/**
 * Tahlil → Mexanik: davr bo'yicha ta'mir tahlili (`to` — kirmaydi).
 *
 * Manbalar (bekor qilinganlarsiz):
 *  - transport ta'miri — `TransportExpense` (REPAIR + PARTS). To'langan TRANSPORT mexanik so'rovi o'zi shu yerga yoziladi,
 *    shuning uchun `MechanicRequest` summasi transportga qayta qo'shilmaydi;
 *  - zavod / boshqa ta'mir — to'langan `MechanicRequest` (FACTORY, OTHER), `paidAt` bo'yicha;
 *  - buzilish / YTH — `TripIssue` (BREAKDOWN, ACCIDENT), reys mashinasi bo'yicha; texnik xizmat — `VehicleService`;
 *  - ta'mirdagi texnika va hujjat muddati — joriy holat (davrga bog'liq emas).
 */

export type MechVehicleRow = { id: string; plate: string; repair: number; parts: number; total: number; issues: number; services: number };
export type MechRepairNow = { id: string; plate: string; type: string; note: string | null; since: Date | null; days: number | null };
export type MechDocDue = { vehicleId: string; plate: string; doc: "inspection" | "insurance"; until: Date; level: Exclude<Level, "ok"> };

export async function mechanicReport(from: Date, to: Date) {
  const range = { gte: from, lt: to };
  const [expenses, factory, issues, services, vehicles] = await Promise.all([
    db.transportExpense.groupBy({
      by: ["vehicleId", "kind"], where: { kind: { in: ["REPAIR", "PARTS"] }, cancelledAt: null, date: range },
      _sum: { amount: true }, _count: { _all: true },
    }),
    db.mechanicRequest.aggregate({
      where: { status: "PAID", paidAt: range, target: { in: ["FACTORY", "OTHER"] } },
      _sum: { amount: true }, _count: { _all: true },
    }),
    db.tripIssue.findMany({ where: { kind: { in: VEHICLE_ISSUE_KINDS }, createdAt: range }, select: { resolvedAt: true, trip: { select: { vehicleId: true } } } }),
    db.vehicleService.groupBy({ by: ["vehicleId"], where: { cancelledAt: null, date: range }, _count: { _all: true } }),
    db.vehicle.findMany({
      orderBy: { plate: "asc" },
      select: { id: true, plate: true, type: true, isActive: true, status: true, statusNote: true, statusSince: true, inspectionUntil: true, insuranceUntil: true },
    }),
  ]);

  // Texnika bo'yicha: ta'mir, zapchast, buzilish, texnik xizmat
  const rows = new Map<string, MechVehicleRow>();
  const plateOf = new Map(vehicles.map((v) => [v.id, v.plate]));
  const row = (id: string) => {
    let r = rows.get(id);
    if (!r) rows.set(id, (r = { id, plate: plateOf.get(id) ?? "—", repair: 0, parts: 0, total: 0, issues: 0, services: 0 }));
    return r;
  };
  let transport = 0, transportCount = 0;
  for (const e of expenses) {
    const sum = Number(e._sum.amount ?? 0);
    transport += sum; transportCount += e._count._all;
    if (!e.vehicleId) continue;
    const r = row(e.vehicleId);
    if (e.kind === "REPAIR") r.repair += sum; else r.parts += sum;
    r.total += sum;
  }
  for (const i of issues) row(i.trip.vehicleId).issues++;
  for (const s of services) row(s.vehicleId).services += s._count._all;
  const byVehicle = [...rows.values()]
    .filter((r) => r.total || r.issues || r.services)
    .sort((a, b) => b.total - a.total || b.issues - a.issues || a.plate.localeCompare(b.plate));
  const totals = byVehicle.reduce(
    (t, r) => ({ repair: t.repair + r.repair, parts: t.parts + r.parts, total: t.total + r.total, issues: t.issues + r.issues, services: t.services + r.services }),
    { repair: 0, parts: 0, total: 0, issues: 0, services: 0 },
  );

  // Joriy holat: ta'mirdagi texnika va hujjat muddati (faqat saflardagi)
  const now = new Date();
  const active = vehicles.filter((v) => v.isActive);
  const inRepair: MechRepairNow[] = active
    .filter((v) => v.status === "REPAIR")
    .map((v) => ({ id: v.id, plate: v.plate, type: v.type, note: v.statusNote, since: v.statusSince, days: v.statusSince ? Math.max(0, Math.floor((now.getTime() - v.statusSince.getTime()) / 86_400_000)) : null }))
    .sort((a, b) => (a.since?.getTime() ?? 0) - (b.since?.getTime() ?? 0));
  const docs: MechDocDue[] = [];
  for (const v of active) {
    for (const [doc, until] of [["inspection", v.inspectionUntil], ["insurance", v.insuranceUntil]] as const) {
      const level = expiryLevel(until, now);
      if (until && level && level !== "ok") docs.push({ vehicleId: v.id, plate: v.plate, doc, until, level });
    }
  }
  docs.sort((a, b) => (a.level === b.level ? a.until.getTime() - b.until.getTime() : a.level === "crit" ? -1 : 1));

  return {
    transport: { sum: transport, count: transportCount },
    factory: { sum: Number(factory._sum.amount ?? 0), count: factory._count._all },
    issues: { count: issues.length, open: issues.filter((i) => !i.resolvedAt).length },
    fleet: { active: active.length, repair: inRepair.length },
    inRepair, byVehicle, totals, docs,
  };
}
