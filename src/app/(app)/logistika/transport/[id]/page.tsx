import Link from "next/link";
import { notFound } from "next/navigation";
import { Fuel, Route, Coins, Gauge, Truck } from "lucide-react";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { ACTIVE_TRIP, driverEmployees, EXPENSE_KIND, FUEL_TYPE, tripPhase, VEHICLE_TYPE, vehicleLive } from "@/lib/logistics";
import { date, dateTime, fmtNum, isoDate, money, moneyShort, qty } from "@/lib/format";
import { Card, CardHeader, Empty, PageHeader, StatCard, Table, Td, Th, Tr } from "@/components/ui";
import { VehicleForm } from "../vehicle-form";
import { PhaseBadge, TripLink, VehicleLiveBadge } from "../../ui";

export const dynamic = "force-dynamic";

/** Transport kartasi: ma'lumot, oxirgi reyslar, yoqilg'i (haqiqiy sarf vs norma), xarajatlar. */
export default async function VehiclePage({ params }: { params: Promise<{ id: string }> }) {
  const s = await requireSession(["LOGISTICS"]);
  const { id } = await params;
  const monthFrom = new Date(); monthFrom.setDate(1); monthFrom.setHours(0, 0, 0, 0);
  const v = await db.vehicle.findUnique({
    where: { id },
    include: {
      drivers: { where: { isActive: true }, select: { id: true, fullName: true } },
      trips: { orderBy: { createdAt: "desc" }, take: 30, include: { order: { select: { orderNo: true, deliveryAddress: true, customer: { select: { name: true } } } }, driver: { select: { fullName: true } } } },
      fuelLogs: { orderBy: { date: "desc" }, take: 30, include: { driver: { select: { fullName: true } } } },
      expenses: { orderBy: { date: "desc" }, take: 30 },
    },
  });
  if (!v) notFound();
  const drivers = await driverEmployees({ activeOnly: true });
  const live = vehicleLive(v, v.trips);

  // Haqiqiy sarf: ikki zapravka orasidagi probeg va shu oraliqda quyilgan litr (to'liq bak usuli)
  const withOdo = v.fuelLogs.filter((f) => f.odometerKm != null).sort((a, b) => a.odometerKm! - b.odometerKm!);
  let per100: number | null = null;
  if (withOdo.length >= 2) {
    const km = withOdo[withOdo.length - 1].odometerKm! - withOdo[0].odometerKm!;
    const liters = withOdo.slice(1).reduce((a, f) => a + Number(f.liters), 0);
    if (km > 0) per100 = (liters / km) * 100;
  }
  const norm = v.fuelNormL100 ? Number(v.fuelNormL100) : null;
  const monthFuel = v.fuelLogs.filter((f) => f.date >= monthFrom);
  const monthExp = v.expenses.filter((e) => e.date >= monthFrom);
  const monthTrips = v.trips.filter((t) => t.createdAt >= monthFrom && t.status !== "CANCELLED");
  const monthQty = monthTrips.reduce((a, t) => a + Number(t.qtyM3), 0);
  const monthCost = monthFuel.reduce((a, f) => a + Number(f.amount), 0) + monthExp.reduce((a, e) => a + Number(e.amount), 0);
  const current = v.trips.find((t) => ACTIVE_TRIP.includes(t.status));
  const canEdit = s.role === "LOGISTICS";

  return (
    <div>
      <PageHeader back={{ href: "/logistika/transport", label: "Transport" }} title={v.plate}
        subtitle={<>{VEHICLE_TYPE[v.type]}{v.brand ? ` · ${v.brand} ${v.model ?? ""}` : ""}{v.year ? ` · ${v.year}` : ""} · <VehicleLiveBadge live={live} note={v.statusNote} />{current && <> · <TripLink id={current.id} noteNo={current.deliveryNoteNo} /></>}</>} />

      <div className="mb-5 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatCard label="Shu oy reyslar" value={monthTrips.length} hint={`${qty(monthQty)} yetkazildi/yuklandi`} icon={Route} tone="brand" />
        <StatCard label="Shu oy xarajat" value={moneyShort(monthCost)} hint={monthTrips.length ? `reysga ${moneyShort(monthCost / monthTrips.length)}` : undefined} icon={Coins} />
        <StatCard label="Yoqilg'i sarfi" value={per100 != null ? `${fmtNum(per100, 1)} l/100` : "—"} hint={norm ? `norma ${fmtNum(norm, 1)} l/100` : "norma kiritilmagan"} icon={Fuel}
          tone={per100 != null && norm ? (per100 > norm * 1.1 ? "danger" : "success") : "default"} />
        <StatCard label="Probeg" value={v.odometerKm != null ? `${fmtNum(v.odometerKm)} km` : "—"} hint="oxirgi zapravkada yozilgan" icon={Gauge} />
      </div>

      <div className="grid gap-5 xl:grid-cols-5">
        <Card className="xl:col-span-3">
          <CardHeader title="Transport kartasi" icon={Truck} />
          {canEdit ? (
            <VehicleForm drivers={drivers.map((d) => ({ id: d.id, name: d.fullName }))} v={{
              id: v.id, plate: v.plate, type: v.type, brand: v.brand, model: v.model, year: v.year,
              capacityM3: v.capacityM3 ? Number(v.capacityM3) : null, fuelType: v.fuelType, fuelNormL100: v.fuelNormL100 ? Number(v.fuelNormL100) : null,
              odometerKm: v.odometerKm, hasGps: v.hasGps, inspectionUntil: v.inspectionUntil ? isoDate(v.inspectionUntil) : "",
              insuranceCompany: v.insuranceCompany, insurancePolicy: v.insurancePolicy, insuranceUntil: v.insuranceUntil ? isoDate(v.insuranceUntil) : "",
              isActive: v.isActive, note: v.note, driverId: v.drivers[0]?.id ?? "",
            }} />
          ) : <p className="text-sm text-slate-500">Faqat logistika tahrirlaydi.</p>}
        </Card>

        <div className="space-y-5 xl:col-span-2">
          <Card padded={false}>
            <div className="px-5 pt-5"><CardHeader title="Yoqilg'i" icon={Fuel} action={<Link href={`/logistika/yoqilgi?vehicleId=${v.id}`} className="text-sm text-slate-500 hover:text-slate-900">Qo'shish →</Link>} /></div>
            <Table>
              <thead><tr><Th>Sana</Th><Th right>Litr</Th><Th right>Summa</Th><Th right>Probeg</Th></tr></thead>
              <tbody>
                {v.fuelLogs.length === 0 && <Empty text="Zapravka yozilmagan" />}
                {v.fuelLogs.slice(0, 10).map((f) => (
                  <Tr key={f.id}><Td className="text-sm">{date(f.date)}<div className="text-xs text-slate-500">{FUEL_TYPE[f.fuelType]}{f.driver ? ` · ${f.driver.fullName}` : ""}</div></Td><Td right className="tabular">{fmtNum(Number(f.liters), 1)}</Td><Td right className="tabular">{moneyShort(Number(f.amount))}</Td><Td right className="tabular">{f.odometerKm != null ? fmtNum(f.odometerKm) : "—"}</Td></Tr>
                ))}
              </tbody>
            </Table>
          </Card>
          <Card padded={false}>
            <div className="px-5 pt-5"><CardHeader title="Boshqa xarajatlar" icon={Coins} action={<Link href={`/logistika/xarajatlar?vehicleId=${v.id}`} className="text-sm text-slate-500 hover:text-slate-900">Qo'shish →</Link>} /></div>
            <Table>
              <thead><tr><Th>Sana</Th><Th>Turi</Th><Th right>Summa</Th></tr></thead>
              <tbody>
                {v.expenses.length === 0 && <Empty text="Xarajat yozilmagan" />}
                {v.expenses.slice(0, 10).map((e) => <Tr key={e.id}><Td className="text-sm">{date(e.date)}</Td><Td className="text-sm">{EXPENSE_KIND[e.kind]}{e.note ? <div className="text-xs text-slate-500">{e.note}</div> : null}</Td><Td right className="tabular">{money(Number(e.amount))}</Td></Tr>)}
              </tbody>
            </Table>
          </Card>
        </div>
      </div>

      <Card padded={false} className="mt-5">
        <div className="px-5 pt-5"><CardHeader title="Oxirgi reyslar" icon={Route} /></div>
        <Table>
          <thead><tr><Th>Nakladnoy</Th><Th>Mijoz / manzil</Th><Th>Haydovchi</Th><Th right>Hajm</Th><Th>Bosqich</Th><Th>Yuklandi</Th><Th>Yetkazildi</Th></tr></thead>
          <tbody>
            {v.trips.length === 0 && <Empty text="Reys yo'q" />}
            {v.trips.map((t) => (
              <Tr key={t.id}>
                <Td><TripLink id={t.id} noteNo={t.deliveryNoteNo} /><div className="text-xs text-slate-500">{t.order.orderNo}</div></Td>
                <Td><div className="text-sm">{t.order.customer.name}</div><div className="max-w-xs truncate text-xs text-slate-500">{t.order.deliveryAddress}</div></Td>
                <Td className="text-sm">{t.driver.fullName}</Td>
                <Td right className="tabular">{qty(t.qtyM3)}</Td>
                <Td><PhaseBadge phase={tripPhase(t)} /></Td>
                <Td className="text-sm tabular">{t.loadedAt ? dateTime(t.loadedAt) : "—"}</Td>
                <Td className="text-sm tabular">{t.deliveredAt ? dateTime(t.deliveredAt) : "—"}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}
