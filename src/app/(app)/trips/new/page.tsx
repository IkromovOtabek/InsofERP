import { db } from "@/lib/db";
import { normalizePhone } from "@/lib/eco/client";
import { driverPositionNames } from "@/lib/positions";
import { customerMarks, markedName } from "@/lib/finance";
import { requireSession } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { TripForm } from "../trip-form";
import { unitLabel, soleUnit } from "@/lib/unit";

export default async function NewTrip() {
  await requireSession(["LOGISTICS", "PRODUCTION"]);
  const [orders, vehicles, drivers] = await Promise.all([
    db.order.findMany({ where: { status: { in: ["CONFIRMED", "IN_PRODUCTION"] } }, orderBy: { deliveryDate: "asc" }, include: { customer: true, items: { include: { product: true } }, trips: true } }),
    // Mikser ham, yuk mashina ham — dona mahsulot (plita, blok) mikserda ketmaydi; nasos yuk tashimaydi
    db.vehicle.findMany({ where: { isActive: true, type: { in: ["MIXER", "TRUCK"] } }, orderBy: [{ type: "asc" }, { plate: "asc" }] }),
    db.employee.findMany({ where: { isActive: true }, orderBy: { fullName: "asc" } }),
  ]);
  // Otdel kadr "haydovchi ilovasiga chiqsin" deb belgilagan lavozimlar; birorta ham bo'lmasa — hamma xodim
  const driverNames = (await driverPositionNames()).map((n) => n.toLowerCase());
  const driversOnly = drivers.filter((d) => driverNames.includes(d.position.trim().toLowerCase()));
  const driverOpts = driversOnly.length ? driversOnly : drivers;
  const marks = await customerMarks(orders.map((o) => o.customerId));
  // Haydovchi ilovasiga reys telefon raqami bo'yicha boradi — raqamsiz xodim ECO'da topilmaydi
  const driverList = driverOpts.map((d) => ({ id: d.id, fullName: d.fullName, vehicleId: d.vehicleId, phoneOk: !!normalizePhone(d.phone) }));
  const opts = orders.map((o) => {
    const total = o.items.reduce((s, i) => s + Number(i.qtyM3), 0);
    const shipped = o.trips.filter((t) => t.status !== "CANCELLED").reduce((s, t) => s + Number(t.qtyM3), 0);
    // Qoldiq zayavkadagi mahsulot birligida ko'rsatiladi (beton m³, ustun/blok dona)
    const u = soleUnit(o.items.map((i) => ({ unit: i.product.unit, qty: i.qtyM3 })));
    return { id: o.id, orderNo: o.orderNo, customer: markedName(o.customer.name, o.customerId, marks), address: o.deliveryAddress, remainingM3: Math.round((total - shipped) * 1000) / 1000, unit: unitLabel(u ?? "m3") };
  }).filter((o) => o.remainingM3 > 0);
  return (
    <div>
      <PageHeader title="Yangi reys" subtitle="Nakladnoy raqami avtomatik beriladi" />
      <TripForm orders={opts} vehicles={vehicles.map((v) => ({ id: v.id, plate: v.plate, type: v.type, capacityM3: v.capacityM3 ? Number(v.capacityM3) : null }))} drivers={driverList} />
    </div>
  );
}
