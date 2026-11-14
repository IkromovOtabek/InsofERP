import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/db";
import { ecoEnabled, normalizePhone } from "@/lib/eco/client";
import { ecoLabel } from "@/lib/eco/labels";
import { driverPositionNames } from "@/lib/positions";
import { customerMarks, markedName } from "@/lib/finance";
import { requirePage } from "@/lib/page-guard";
import { canDo } from "@/lib/permissions";
import { Callout, PageHeader } from "@/components/ui";
import { TripForm } from "../../trip-form";
import { unitLabel } from "@/lib/unit";
import { date } from "@/lib/format";
import { ECO_EDITABLE, READINESS_INCLUDE, orderLines, orderReadiness } from "@/lib/trips";
import { ACTIVE_TRIP, VEHICLE_LIVE, vehicleLive } from "@/lib/logistics";

const pad = (n: number) => String(n).padStart(2, "0");
/** Date → `<input type="datetime-local">` qiymati (mahalliy vaqt). */
const localInput = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

/**
 * Rejadagi (hali yuklanmagan) reysni tahrirlash — «Yangi reys» formasi shu reys qiymatlari bilan.
 * Zayavka, nakladnoy raqami va TTN o'zgarmaydi; qoidalar `lib/trips.ts` (`updatePlannedTrip`).
 */
export default async function EditTrip({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await requirePage("/trips");
  const t = await db.trip.findUnique({ where: { id }, include: { vehicle: true, driver: true } });
  if (!t) notFound();
  // Ruxsat — reys ochish bilan bir xil (`updateTrip` ham tekshiradi); yuklangan reys tahrirlanmaydi
  if (t.status !== "PLANNED" || !canDo(s, "trips", "create")) redirect(`/trips/${id}`);

  const ownVehicle = t.vehicle.external ? null : t.vehicleId;
  const [order, vehicles, drivers, settings, externals] = await Promise.all([
    db.order.findUniqueOrThrow({
      where: { id: t.orderId },
      include: { customer: true, ...READINESS_INCLUDE, trips: { select: { id: true, status: true, qtyM3: true, acceptedQty: true, returnedQty: true, vehicle: { select: { type: true } } } } },
    }),
    // Reysning hozirgi texnikasi ta'mirda yoki nofaol bo'lsa ham ro'yxatda turadi — forma uni jimgina boshqasiga almashtirmasin
    // (saqlashda server sababini aytadi). Band holati shu reyssiz hisoblanadi
    db.vehicle.findMany({
      where: { OR: [{ isActive: true, status: { not: "REPAIR" }, type: { in: ["MIXER", "TRUCK"] } }, ...(ownVehicle ? [{ id: ownVehicle }] : [])] },
      orderBy: [{ type: "asc" }, { plate: "asc" }],
      include: { trips: { where: { status: { in: ACTIVE_TRIP }, id: { not: id } }, select: { status: true } } },
    }),
    db.employee.findMany({ where: { OR: [{ isActive: true }, { id: t.driverId }] }, orderBy: { fullName: "asc" } }),
    db.companySettings.findUnique({ where: { id: "main" }, select: { bruNames: true } }),
    db.vehicle.findMany({ where: { external: true, hiddenAt: null }, orderBy: { plate: "asc" }, select: { id: true, plate: true, type: true, capacityM3: true, drivers: { where: { external: true }, select: { fullName: true, phone: true }, take: 1 } } }),
  ]);
  // Haydovchi lavozimidagilar (`createTrip` qoidasi) + reysning hozirgi haydovchisi — xuddi texnika kabi
  const driverNames = (await driverPositionNames()).map((n) => n.trim().toLowerCase());
  const driverOpts = drivers.filter((d) => (d.id === t.driverId && !t.vehicle.external) || (d.isActive && driverNames.includes(d.position.trim().toLowerCase())));
  const marks = await customerMarks([order.customerId]);

  // Reysning o'z miqdori qoldiqqa qaytadi: «tayyor» — shu reysga berish mumkin bo'lgan eng ko'p miqdor
  const rest = { ...order, trips: order.trips.filter((x) => x.id !== id) };
  const rd = orderReadiness(rest);
  const mixed = new Set(order.items.map((i) => i.product.unit === "m3")).size > 1;
  const pieceUnit = order.items.find((i) => i.product.unit !== "m3")?.product.unit ?? "dona";
  const lines = orderLines(rest).map((l) => ({ ...l, available: Math.min(l.available, rd.available), unit: unitLabel(l.unit) }));
  const opt = {
    plannedAt: t.plannedAt ? localInput(t.plannedAt) : "", id: order.id, date: date(order.deliveryDate), time: order.deliveryTime ?? null,
    customer: markedName(order.customer.name, order.customerId, marks), address: order.deliveryAddress,
    remainingM3: rd.available, inProduction: rd.inProduction, unit: mixed ? "birlik" : unitLabel(rd.unit ?? "m3"), mixed, pieceUnit: unitLabel(pieceUnit), lines,
  };

  // Haydovchi ilovasi: reys yuborilgan bo'lsa — haydovchi qabul qilguncha yangilanadi, keyin faqat BRU o'zgaradi
  const ecoSent = ecoEnabled() && !!t.ecoDeliveryId && !t.vehicle.external;
  const ecoLocked = ecoSent && !!t.ecoStatus && !ECO_EDITABLE.includes(t.ecoStatus);
  const v = t.vehicle;

  return (
    <div>
      <PageHeader back={{ href: `/trips/${id}`, label: `Nakladnoy ${t.deliveryNoteNo}` }} title={`Reysni tahrirlash — ${t.deliveryNoteNo}`} info="Faqat rejalashtirilgan (hali yuklanmagan) reys · zayavka va TTN o'zgarmaydi" />
      {ecoLocked && (
        <Callout tone="warning" title={`Haydovchi ilovasida: ${ecoLabel(t.ecoStatus)?.label ?? t.ecoStatus}`}>
          Haydovchi reysni qabul qilgan — ilovadagi reys endi o&apos;zgarmaydi. Bu yerda faqat BRU ni o&apos;zgartirish mumkin; texnika, haydovchi, miqdor, vaqt yoki izoh uchun reysni o&apos;chirib, yangisini oching.
        </Callout>
      )}
      {ecoSent && !ecoLocked && (
        <Callout tone="info">Saqlangandan keyin reys haydovchi ilovasiga (ECO) qayta yuboriladi; haydovchi almashtirilsa — reys yangi haydovchiga o&apos;tadi.</Callout>
      )}
      <TripForm
        orders={[opt]}
        vehicles={vehicles.map((x) => ({ id: x.id, plate: x.plate, type: x.type, capacityM3: x.capacityM3 && x.capacityUnit === "M3" ? Number(x.capacityM3) : null, mainDriverId: x.mainDriverId, state: x.status === "REPAIR" ? "ta'mirda" : !x.isActive ? "nofaol" : x.trips.length ? VEHICLE_LIVE[vehicleLive(x, x.trips)].label.toLowerCase() : undefined }))}
        drivers={driverOpts.map((d) => ({ id: d.id, fullName: d.fullName, vehicleId: d.vehicleId, phoneOk: !!normalizePhone(d.phone) }))}
        bruNames={settings?.bruNames ?? []}
        externals={externals.map((x) => ({ id: x.id, plate: x.plate, type: x.type === "MIXER" ? "MIXER" : "TRUCK", capacity: x.capacityM3 != null ? Number(x.capacityM3) : null, driverName: x.drivers[0]?.fullName ?? "", driverPhone: x.drivers[0]?.phone ?? "" }))}
        initialOrderId={order.id}
        edit={{
          tripId: id, vehicleId: t.vehicleId, driverId: t.driverId, qty: Number(t.qtyM3), bru: t.bru ?? "", note: t.note ?? "", driverReason: t.driverReason ?? "",
          external: v.external
            ? { type: v.type === "MIXER" ? "MIXER" : "TRUCK", plate: v.plate, capacity: v.capacityM3 != null ? String(Number(v.capacityM3)) : "", driverName: t.driver.fullName, driverPhone: t.driver.phone ?? "" }
            : null,
          externalLocked: ecoSent ? "Reys haydovchi ilovasiga yuborilgan — ko'chadan mashinaga o'tkazish uchun reysni o'chirib, yangisini oching" : undefined,
        }}
      />
    </div>
  );
}
