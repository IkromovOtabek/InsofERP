import { db } from "@/lib/db";
import { normalizePhone } from "@/lib/eco/client";
import { driverPositionNames } from "@/lib/positions";
import { customerMarks, markedName } from "@/lib/finance";
import { requireRoles } from "@/lib/page-guard";
import { PageHeader } from "@/components/ui";
import { TripForm } from "../trip-form";
import { unitLabel } from "@/lib/unit";
import { date } from "@/lib/format";
import { READINESS_INCLUDE, orderLines, orderReadiness } from "@/lib/trips";
import { ACTIVE_TRIP, VEHICLE_LIVE, orderPlannedAt, vehicleLive } from "@/lib/logistics";

const pad = (n: number) => String(n).padStart(2, "0");
/** Date → `<input type="datetime-local">` qiymati (mahalliy vaqt). */
const localInput = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

export default async function NewTrip({ searchParams }: { searchParams: Promise<{ orderId?: string }> }) {
  await requireRoles(["LOGISTICS", "PRODUCTION"], { module: "trips", actions: ["create"] });
  const { orderId } = await searchParams;
  const [orders, vehicles, drivers, settings, externals] = await Promise.all([
    db.order.findMany({
      where: { kind: "SALE", status: { in: ["CONFIRMED", "IN_PRODUCTION"] } }, orderBy: { deliveryDate: "asc" },
      // Reyslar texnika turi bilan — aralash zayavkada jo'natilgani beton/dona qatoriga bo'linadi (`orderLines`)
      include: { customer: true, ...READINESS_INCLUDE, trips: { select: { status: true, qtyM3: true, acceptedQty: true, returnedQty: true, vehicle: { select: { type: true } } } } },
    }),
    // Mikser ham, yuk mashina ham — dona mahsulot (plita, blok) mikserda ketmaydi; nasos yuk tashimaydi
    // Ta'mirdagi texnika reysga berilmaydi; band bo'lgani ro'yxatda qoladi, lekin holati yoziladi
    db.vehicle.findMany({ where: { isActive: true, status: { not: "REPAIR" }, type: { in: ["MIXER", "TRUCK"] } }, orderBy: [{ type: "asc" }, { plate: "asc" }], include: { trips: { where: { status: { in: ACTIVE_TRIP } }, select: { status: true } } } }),
    db.employee.findMany({ where: { isActive: true }, orderBy: { fullName: "asc" } }),
    db.companySettings.findUnique({ where: { id: "main" }, select: { bruNames: true } }),
    // Avval chaqirilgan ko'cha mashinalari — ro'yxatdan tanlanadi yoki raqam yozilganda haydovchi va sig'im o'zi to'ladi.
    // Ro'yxatdan olingani (hiddenAt) ko'rinmaydi
    db.vehicle.findMany({ where: { external: true, hiddenAt: null }, orderBy: { plate: "asc" }, select: { id: true, plate: true, type: true, capacityM3: true, drivers: { where: { external: true }, select: { fullName: true, phone: true }, take: 1 } } }),
  ]);
  // Otdel kadr "haydovchi ilovasiga chiqsin" deb belgilagan lavozimlar — reys faqat shularga ochiladi (`createTrip` ham tekshiradi)
  const driverNames = (await driverPositionNames()).map((n) => n.trim().toLowerCase());
  const driverOpts = drivers.filter((d) => driverNames.includes(d.position.trim().toLowerCase()));
  const marks = await customerMarks(orders.map((o) => o.customerId));
  // Haydovchi ilovasiga reys telefon raqami bo'yicha boradi — raqamsiz xodim ECO'da topilmaydi
  const driverList = driverOpts.map((d) => ({ id: d.id, fullName: d.fullName, vehicleId: d.vehicleId, phoneOk: !!normalizePhone(d.phone) }));
  // Ro'yxatda faqat brigada tayyorlab bergan (hali jo'natilmagan) miqdori bor zayavkalar —
  // qoldiq zayavkadagi mahsulot birligida (beton m³, ustun/blok dona)
  const all = orders.map((o) => {
    const rd = orderReadiness(o);
    const plan = orderPlannedAt(o);
    // Aralash zayavka (beton + dona): birlik texnika turidan — mikserda m³, yuk mashinada dona birligi
    const mixed = new Set(o.items.map((i) => i.product.unit === "m3")).size > 1;
    const pieceUnit = o.items.find((i) => i.product.unit !== "m3")?.product.unit ?? "dona";
    // Qator tayyori zayavka qoldig'idan oshmaydi — `createTrip` avval zayavka bo'yicha tekshiradi
    const lines = orderLines(o).map((l) => ({ ...l, available: Math.min(l.available, rd.available), unit: unitLabel(l.unit) }));
    return {
      plannedAt: plan ? localInput(plan) : "", id: o.id, date: date(o.deliveryDate), time: o.deliveryTime ?? null, customer: markedName(o.customer.name, o.customerId, marks), address: o.deliveryAddress,
      remainingM3: rd.available, inProduction: rd.inProduction, total: rd.total, shipped: rd.shipped, hasTasks: rd.hasTasks,
      unit: mixed ? "birlik" : unitLabel(rd.unit ?? "m3"), mixed, pieceUnit: unitLabel(pieceUnit), lines,
    };
  });
  const opts = all.filter((o) => o.remainingM3 > 0);
  // Qoldig'i bor, lekin tayyor mahsuloti yo'q zayavkalar — logist nima uchun ro'yxatda yo'qligini bilsin
  const waiting = all.filter((o) => o.remainingM3 <= 0 && o.total - o.shipped > 0.001);
  return (
    <div>
      <PageHeader back={{ href: "/trips", label: "Reyslar" }} title="Yangi reys" subtitle="Faqat brigada tayyorlab bergan miqdor reysga beriladi · nakladnoy raqami avtomatik" />
      <TripForm
        orders={opts}
        waiting={waiting.map((o) => ({ id: o.id, date: o.date, customer: o.customer, inProduction: o.inProduction, unit: o.unit, hasTasks: o.hasTasks }))}
        vehicles={vehicles.map((v) => ({ id: v.id, plate: v.plate, type: v.type, capacityM3: v.capacityM3 && v.capacityUnit === "M3" ? Number(v.capacityM3) : null, mainDriverId: v.mainDriverId, state: v.trips.length ? VEHICLE_LIVE[vehicleLive(v, v.trips)].label.toLowerCase() : undefined }))}
        drivers={driverList}
        bruNames={settings?.bruNames ?? []}
        externals={externals.map((v) => ({ id: v.id, plate: v.plate, type: v.type === "MIXER" ? "MIXER" : "TRUCK", capacity: v.capacityM3 != null ? Number(v.capacityM3) : null, driverName: v.drivers[0]?.fullName ?? "", driverPhone: v.drivers[0]?.phone ?? "" }))}
        initialOrderId={orderId}
      />
    </div>
  );
}
