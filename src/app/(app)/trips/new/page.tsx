import { db } from "@/lib/db";
import { normalizePhone } from "@/lib/eco/client";
import { driverPositionNames } from "@/lib/positions";
import { customerMarks, markedName } from "@/lib/finance";
import { requireSession } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { TripForm } from "../trip-form";
import { unitLabel } from "@/lib/unit";
import { READINESS_INCLUDE, orderReadiness } from "@/lib/trips";

export default async function NewTrip() {
  await requireSession(["LOGISTICS", "PRODUCTION"]);
  const [orders, vehicles, drivers] = await Promise.all([
    db.order.findMany({ where: { kind: "SALE", status: { in: ["CONFIRMED", "IN_PRODUCTION"] } }, orderBy: { deliveryDate: "asc" }, include: { customer: true, ...READINESS_INCLUDE } }),
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
  // Ro'yxatda faqat brigada tayyorlab bergan (hali jo'natilmagan) miqdori bor zayavkalar —
  // qoldiq zayavkadagi mahsulot birligida (beton m³, ustun/blok dona)
  const all = orders.map((o) => {
    const rd = orderReadiness(o);
    return { id: o.id, orderNo: o.orderNo, customer: markedName(o.customer.name, o.customerId, marks), address: o.deliveryAddress, remainingM3: rd.available, inProduction: rd.inProduction, total: rd.total, shipped: rd.shipped, hasTasks: rd.hasTasks, unit: unitLabel(rd.unit ?? "m3") };
  });
  const opts = all.filter((o) => o.remainingM3 > 0);
  // Qoldig'i bor, lekin tayyor mahsuloti yo'q zayavkalar — logist nima uchun ro'yxatda yo'qligini bilsin
  const waiting = all.filter((o) => o.remainingM3 <= 0 && o.total - o.shipped > 0.001);
  return (
    <div>
      <PageHeader title="Yangi reys" subtitle="Faqat brigada tayyorlab bergan miqdor reysga beriladi · nakladnoy raqami avtomatik" />
      <TripForm orders={opts} waiting={waiting.map((o) => ({ id: o.id, orderNo: o.orderNo, customer: o.customer, inProduction: o.inProduction, unit: o.unit, hasTasks: o.hasTasks }))} vehicles={vehicles.map((v) => ({ id: v.id, plate: v.plate, type: v.type, capacityM3: v.capacityM3 ? Number(v.capacityM3) : null }))} drivers={driverList} />
    </div>
  );
}
