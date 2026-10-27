import Link from "next/link";
import { notFound } from "next/navigation";
import { Fuel, Route, Coins, Gauge, Truck, Undo2, Wrench } from "lucide-react";
import { db } from "@/lib/db";
import { requireRoles } from "@/lib/page-guard";
import { canDo } from "@/lib/permissions";
import { pathAllowed } from "@/lib/nav";
import { ACTIVE_TRIP, mainDriverOf, vehicleFormDrivers, EXPENSE_KIND, FUEL_TYPE, SERVICE_KINDS, serviceDueLevel, tripPhase, VEHICLE_TYPE, vehicleLive, vehicleServiceDue } from "@/lib/logistics";
import { fuelConsumption } from "@/lib/logistics-costs";
import { date, dateTime, fmtNum, isoDate, money, moneyShort, qty } from "@/lib/format";
import { Badge, Callout, Card, CardHeader, Empty, PageHeader, StatCard, Table, Td, Th, Tr } from "@/components/ui";
import { ConfirmButton } from "../../../payments/confirm-button";
import { cancelNote, cancellerNames } from "@/lib/cancelled";
import { VehicleForm } from "../vehicle-form";
import { PhaseBadge, TripLink, VehicleLiveBadge } from "../../ui";
import { VehicleStatusForm } from "../../../drivers/vehicle-status-form";
import { cancelVehicleService } from "../../actions";
import { ServiceForm, VehicleExpenseForm } from "./service-forms";

export const dynamic = "force-dynamic";

/** Transport kartasi: ma'lumot, oxirgi reyslar, yoqilg'i (haqiqiy sarf vs norma), xarajatlar. */
export default async function VehiclePage({ params }: { params: Promise<{ id: string }> }) {
  const s = await requireRoles(["LOGISTICS", "MECHANIC", "DISPATCHER"], { module: "logistika" });
  const { id } = await params;
  const monthFrom = new Date(); monthFrom.setDate(1); monthFrom.setHours(0, 0, 0, 0);
  const v = await db.vehicle.findUnique({
    where: { id },
    include: {
      drivers: { where: { isActive: true }, select: { id: true, fullName: true } },
      trips: { orderBy: { createdAt: "desc" }, take: 30, include: { order: { select: { deliveryAddress: true, customer: { select: { name: true } } } }, driver: { select: { fullName: true } } } },
      fuelLogs: { orderBy: { date: "desc" }, take: 30, include: { driver: { select: { fullName: true } } } },
      expenses: { orderBy: { date: "desc" }, take: 30 },
      services: { orderBy: [{ date: "desc" }, { createdAt: "desc" }], take: 50, include: { createdBy: { select: { fullName: true } } } },
    },
  });
  if (!v) notFound();
  const drivers = await vehicleFormDrivers(v.id);
  const live = vehicleLive(v, v.trips);

  // Bekor qilingan yozuvlar jadvalda belgisi bilan qoladi, lekin sarf, xarajat va xizmat muddatiga kirmaydi
  const fuelOk = v.fuelLogs.filter((f) => !f.cancelledAt);
  const names = await cancellerNames([...v.fuelLogs, ...v.expenses, ...v.services]);
  // Haqiqiy sarf: yoqilg'i sahifasi bilan bitta funksiya (to'liq bak usuli, birinchi quyish litrisiz)
  // «Dizel + metan»: har yoqilg'i o'z zapravkalari va o'z normasi bilan alohida solishtiriladi
  const dual = v.fuelType === "DIESEL_METHANE";
  const unit = v.fuelType === "METHANE" ? "m³" : "l";
  const per100 = fuelConsumption(dual ? fuelOk.filter((f) => f.fuelType === "DIESEL") : fuelOk).per100;
  const gasPer100 = dual ? fuelConsumption(fuelOk.filter((f) => f.fuelType === "METHANE")).per100 : null;
  const gasNorm = v.gasNormPer100 ? Number(v.gasNormPer100) : null;
  const due = await vehicleServiceDue({ vehicleId: v.id });
  const norm = v.fuelNormL100 ? Number(v.fuelNormL100) : null;
  const monthFuel = fuelOk.filter((f) => f.date >= monthFrom);
  const monthExp = v.expenses.filter((e) => !e.cancelledAt && e.date >= monthFrom);
  const monthTrips = v.trips.filter((t) => t.createdAt >= monthFrom && t.status !== "CANCELLED");
  const monthQty = monthTrips.reduce((a, t) => a + Number(t.qtyM3), 0);
  const monthCost = monthFuel.reduce((a, f) => a + Number(f.amount), 0) + monthExp.reduce((a, e) => a + Number(e.amount), 0);
  const current = v.trips.find((t) => ACTIVE_TRIP.includes(t.status));
  const canEdit = canDo(s, "logistika", "vehicle");
  // Mexanik: holat (ta'mir/bekor), texnik xizmat jurnali va ta'mir xarajati. Yoqilg'i/xarajat sahifalari unga yopiq.
  const canService = canDo(s, "logistika", "service");
  const isMechanic = s.role === "MECHANIC";
  // Dispetcherga Yoqilg'i / Transport xarajatlari sahifalari yopiq — «Qo'shish» havolasi faqat ruxsat bo'lsa
  const fuelOpen = !isMechanic && pathAllowed("/logistika/yoqilgi", s.role, s.perms);
  const tripsClosed = !pathAllowed("/trips", s.role, s.perms);
  const expenseOpen = !isMechanic && pathAllowed("/logistika/xarajatlar", s.role, s.perms);

  return (
    <div>
      <PageHeader back={{ href: "/logistika/transport", label: "Transport" }} title={v.plate}
        subtitle={<>{VEHICLE_TYPE[v.type]}{v.brand ? ` · ${v.brand} ${v.model ?? ""}` : ""}{v.year ? ` · ${v.year}` : ""} · <VehicleLiveBadge live={live} note={v.statusNote} />{current && <> · <TripLink id={current.id} noteNo={current.deliveryNoteNo} plain={tripsClosed} /></>}</>} />

      {due.length > 0 && (
        <Callout tone={due.some((d) => d.level === "crit") ? "danger" : "warning"} title="Texnik xizmat muddati">
          <ul className="space-y-0.5">{due.map((d) => <li key={d.serviceId}>{d.text}</li>)}</ul>
        </Callout>
      )}

      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4 [&>*]:min-w-0">
        <StatCard label="Shu oy reyslar" value={monthTrips.length} hint={`${qty(monthQty)} yetkazildi/yuklandi`} icon={Route} tone="brand" href="#oxirgi-reyslar" />
        <StatCard label="Shu oy xarajat" value={moneyShort(monthCost)} hint={monthTrips.length ? `reysga ${moneyShort(monthCost / monthTrips.length)}` : undefined} icon={Coins} href="#yoqilgi" />
        {dual ? (
          <StatCard label="Yoqilg'i sarfi, 100 km ga" icon={Fuel} href="#yoqilgi"
            value={`${per100 != null ? fmtNum(per100, 1) : "—"} l · ${gasPer100 != null ? fmtNum(gasPer100, 1) : "—"} m³`}
            hint={`norma: dizel ${norm ? `${fmtNum(norm, 1)} l` : "—"}, metan ${gasNorm ? `${fmtNum(gasNorm, 1)} m³` : "—"}`}
            tone={(per100 != null && norm && per100 > norm * 1.1) || (gasPer100 != null && gasNorm && gasPer100 > gasNorm * 1.1) ? "danger" : (per100 != null && norm) || (gasPer100 != null && gasNorm) ? "success" : "default"} />
        ) : (
          <StatCard label="Yoqilg'i sarfi" value={per100 != null ? `${fmtNum(per100, 1)} ${unit}/100` : "—"} hint={norm ? `norma ${fmtNum(norm, 1)} ${unit}/100` : "norma kiritilmagan"} icon={Fuel} href="#yoqilgi"
            tone={per100 != null && norm ? (per100 > norm * 1.1 ? "danger" : "success") : "default"} />
        )}
        <StatCard label="Probeg" value={v.odometerKm != null ? `${fmtNum(v.odometerKm)} km` : "—"} hint="oxirgi zapravkada yozilgan" icon={Gauge} href="#yoqilgi" />
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-5 [&>*]:min-w-0">
        <Card className="xl:col-span-3">
          <CardHeader title="Transport kartasi" icon={Truck}
            action={canService && v.isActive ? <VehicleStatusForm vehicleId={v.id} status={v.status} note={v.statusNote} /> : undefined} />
          {canEdit ? (
            <VehicleForm drivers={drivers} v={{
              id: v.id, plate: v.plate, type: v.type, brand: v.brand, model: v.model, year: v.year,
              capacityM3: v.capacityM3 ? Number(v.capacityM3) : null, capacityUnit: v.capacityUnit, fuelType: v.fuelType, fuelNormL100: v.fuelNormL100 ? Number(v.fuelNormL100) : null,
              idleNormPerHour: v.idleNormPerHour ? Number(v.idleNormPerHour) : null,
              gasNormPer100: v.gasNormPer100 ? Number(v.gasNormPer100) : null, gasIdlePerHour: v.gasIdlePerHour ? Number(v.gasIdlePerHour) : null,
              odometerKm: v.odometerKm, hasGps: v.hasGps, inspectionUntil: v.inspectionUntil ? isoDate(v.inspectionUntil) : "",
              insuranceCompany: v.insuranceCompany, insurancePolicy: v.insurancePolicy, insuranceUntil: v.insuranceUntil ? isoDate(v.insuranceUntil) : "",
              isActive: v.isActive, note: v.note, driverId: mainDriverOf(v)?.id ?? "",
              shiftDriverIds: v.drivers.filter((d) => d.id !== mainDriverOf(v)?.id).map((d) => d.id),
            }} />
          ) : <p className="text-sm text-slate-500">Karta ma&apos;lumotini logistika tahrirlaydi. Ta&apos;mir / bekor turish holati — yuqoridagi belgidan.</p>}
        </Card>

        <div className="space-y-5 xl:col-span-2">
          <Card padded={false}>
            <div id="yoqilgi" className="scroll-mt-20 px-5 pt-5"><CardHeader title="Yoqilg'i" icon={Fuel} action={!fuelOpen ? undefined : <Link href={`/logistika/yoqilgi?vehicleId=${v.id}`} className="text-sm text-slate-500 hover:text-slate-900">Qo'shish →</Link>} /></div>
            <Table>
              <thead><tr><Th>Sana</Th><Th right>Litr</Th><Th right>Summa</Th><Th right>Probeg</Th></tr></thead>
              <tbody>
                {v.fuelLogs.length === 0 && <Empty text="Zapravka yozilmagan" />}
                {v.fuelLogs.slice(0, 10).map((f) => (
                  <Tr key={f.id} className={f.cancelledAt ? "text-slate-400" : undefined}><Td className="text-sm">{date(f.date)}<div className="text-xs text-slate-500">{FUEL_TYPE[f.fuelType]}{f.driver ? ` · ${f.driver.fullName}` : ""}</div>{f.cancelledAt && <div className="mt-1"><Badge color="red">Bekor qilingan</Badge><div className="mt-0.5 text-xs text-slate-500">{cancelNote(f, names)}</div></div>}</Td><Td right className="tabular">{fmtNum(Number(f.liters), 1)}</Td><Td right className={`tabular ${f.cancelledAt ? "line-through" : ""}`}>{moneyShort(Number(f.amount))}</Td><Td right className="tabular">{f.odometerKm != null ? fmtNum(f.odometerKm) : "—"}</Td></Tr>
                ))}
              </tbody>
            </Table>
          </Card>
          <Card padded={false}>
            <div className="px-5 pt-5"><CardHeader title="Boshqa xarajatlar" icon={Coins} action={!expenseOpen ? undefined : <Link href={`/logistika/xarajatlar?vehicleId=${v.id}`} className="text-sm text-slate-500 hover:text-slate-900">Qo'shish →</Link>} /></div>
            {isMechanic && <VehicleExpenseForm vehicleId={v.id} />}
            <Table>
              <thead><tr><Th>Sana</Th><Th>Turi</Th><Th right>Summa</Th></tr></thead>
              <tbody>
                {v.expenses.length === 0 && <Empty text="Xarajat yozilmagan" />}
                {v.expenses.slice(0, 10).map((e) => <Tr key={e.id} className={e.cancelledAt ? "text-slate-400" : undefined}><Td className="text-sm">{date(e.date)}</Td><Td className="text-sm">{EXPENSE_KIND[e.kind]}{e.note ? <div className="text-xs text-slate-500">{e.note}</div> : null}{e.cancelledAt && <div className="mt-1"><Badge color="red">Bekor qilingan</Badge><div className="mt-0.5 text-xs text-slate-500">{cancelNote(e, names)}</div></div>}</Td><Td right className={`tabular ${e.cancelledAt ? "line-through" : ""}`}>{money(Number(e.amount))}</Td></Tr>)}
              </tbody>
            </Table>
          </Card>
        </div>
      </div>

      <Card padded={false} className="mt-5">
        <div className="px-5 pt-5"><CardHeader title="Texnik xizmat jurnali" description="Moy, ta'mir, shina, ko'rik — keyingi xizmat sanasi/probegi bilan; muddati yaqinlashsa ogohlantiriladi" icon={Wrench} /></div>
        {canService && <div className="px-5 pb-4"><ServiceForm vehicleId={v.id} kinds={SERVICE_KINDS} odometerKm={v.odometerKm} /></div>}
        <Table>
          <thead><tr><Th>Sana</Th><Th>Xizmat</Th><Th right>Probeg</Th><Th right>Narx</Th><Th>Keyingisi</Th><Th>Kim</Th>{canService && <Th />}</tr></thead>
          <tbody>
            {v.services.length === 0 && <Empty text="Xizmat yozilmagan" />}
            {v.services.map((x) => {
              const lv = x.cancelledAt ? null : serviceDueLevel(x, v.odometerKm);
              return (
                <Tr key={x.id} className={x.cancelledAt ? "bg-slate-50/60 text-slate-400" : undefined}>
                  <Td className="text-sm tabular">{date(x.date)}</Td>
                  <Td className="text-sm">{x.kind}{x.note ? <div className="max-w-xs text-xs text-slate-500">{x.note}</div> : null}{x.cancelledAt && <div className="mt-1"><Badge color="red">Bekor qilingan</Badge><div className="mt-0.5 max-w-xs text-xs text-slate-500">{cancelNote(x, names)}</div></div>}</Td>
                  <Td right className="tabular">{x.odometerKm != null ? fmtNum(x.odometerKm) : "—"}</Td>
                  <Td right className="tabular">{x.cost != null ? money(Number(x.cost)) : "—"}</Td>
                  <Td className="text-sm">
                    {x.nextDueAt || x.nextDueKm != null ? <>{[x.nextDueAt ? date(x.nextDueAt) : null, x.nextDueKm != null ? `${fmtNum(x.nextDueKm)} km` : null].filter(Boolean).join(" / ")}{lv && <> <Badge color={lv.level === "crit" ? "red" : "amber"}>{lv.level === "crit" ? "o'tgan" : "yaqin"}</Badge></>}</> : "—"}
                  </Td>
                  <Td className="text-xs text-slate-500">{x.createdBy.fullName}</Td>
                  {canService && <Td>{!x.cancelledAt && <ConfirmButton action={cancelVehicleService.bind(null, x.id)} reason="required" label="" title="Bekor qilish" icon={<Undo2 size={14} />} question={`«${x.kind} ${date(x.date)}» bekor qilinsinmi?`} okText="Bekor qilindi" className="h-7 px-1.5" />}</Td>}
                </Tr>
              );
            })}
          </tbody>
        </Table>
      </Card>

      <Card padded={false} className="mt-5">
        <div id="oxirgi-reyslar" className="scroll-mt-20 px-5 pt-5"><CardHeader title="Oxirgi reyslar" icon={Route} /></div>
        <Table>
          <thead><tr><Th>Nakladnoy</Th><Th>Mijoz / manzil</Th><Th>Haydovchi</Th><Th right>Hajm</Th><Th>Bosqich</Th><Th>Yuklandi</Th><Th>Yetkazildi</Th></tr></thead>
          <tbody>
            {v.trips.length === 0 && <Empty text="Reys yo'q" />}
            {v.trips.map((t) => (
              <Tr key={t.id}>
                <Td><TripLink id={t.id} noteNo={t.deliveryNoteNo} plain={tripsClosed} /></Td>
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
