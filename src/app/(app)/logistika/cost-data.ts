import { db } from "@/lib/db";
import { driverEmployees, mainDriverOf, refuelDefault } from "@/lib/logistics";

/** Yoqilg'i va xarajat formalari uchun tanlovlar: transport, haydovchi, oxirgi 7 kun reyslari. */
export async function costOptions() {
  const since = new Date(); since.setDate(since.getDate() - 7);
  const [vehicles, drivers, trips] = await Promise.all([
    db.vehicle.findMany({ where: { isActive: true }, orderBy: { plate: "asc" }, include: { drivers: { where: { isActive: true }, select: { id: true } } } }),
    driverEmployees({ activeOnly: true }),
    db.trip.findMany({ where: { createdAt: { gte: since }, status: { not: "CANCELLED" } }, orderBy: { createdAt: "desc" }, select: { id: true, deliveryNoteNo: true, vehicleId: true, order: { select: { customer: { select: { name: true } } } } } }),
  ]);
  return {
    vehicles: vehicles.map((v) => ({ id: v.id, label: v.plate, fuelType: refuelDefault(v.fuelType), driverId: mainDriverOf(v)?.id ?? null })),
    drivers: drivers.map((d) => ({ id: d.id, label: d.fullName })),
    trips: trips.map((t) => ({ id: t.id, vehicleId: t.vehicleId, label: `${t.deliveryNoteNo} · ${t.order.customer.name}` })),
  };
}
