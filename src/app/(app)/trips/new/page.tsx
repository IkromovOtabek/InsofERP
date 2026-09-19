import { db } from "@/lib/db";
import { customerMarks, markedName } from "@/lib/finance";
import { requireSession } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { TripForm } from "../trip-form";

export default async function NewTrip() {
  await requireSession(["LOGISTICS", "PRODUCTION"]);
  const [orders, vehicles, drivers] = await Promise.all([
    db.order.findMany({ where: { status: { in: ["CONFIRMED", "IN_PRODUCTION"] } }, orderBy: { deliveryDate: "asc" }, include: { customer: true, items: true, trips: true } }),
    db.vehicle.findMany({ where: { isActive: true, type: "MIXER" }, orderBy: { plate: "asc" } }),
    db.employee.findMany({ where: { isActive: true }, orderBy: { fullName: "asc" } }),
  ]);
  // Haydovchilar birinchi; agar lavozimda "haydovchi" bo'lganlar bo'lsa — faqat ular
  const driversOnly = drivers.filter((d) => /haydovchi|driver|водитель/i.test(d.position));
  const driverOpts = driversOnly.length ? driversOnly : drivers;
  const marks = await customerMarks(orders.map((o) => o.customerId));
  const opts = orders.map((o) => {
    const total = o.items.reduce((s, i) => s + Number(i.qtyM3), 0);
    const shipped = o.trips.filter((t) => t.status !== "CANCELLED").reduce((s, t) => s + Number(t.qtyM3), 0);
    return { id: o.id, orderNo: o.orderNo, customer: markedName(o.customer.name, o.customerId, marks), address: o.deliveryAddress, remainingM3: Math.round((total - shipped) * 1000) / 1000 };
  }).filter((o) => o.remainingM3 > 0);
  return (
    <div>
      <PageHeader title="Yangi reys" subtitle="Nakladnoy raqami avtomatik beriladi" />
      <TripForm orders={opts} vehicles={vehicles.map((v) => ({ id: v.id, plate: v.plate, capacityM3: v.capacityM3 ? Number(v.capacityM3) : null }))} drivers={driverOpts.map((d) => ({ id: d.id, fullName: d.fullName }))} />
    </div>
  );
}
