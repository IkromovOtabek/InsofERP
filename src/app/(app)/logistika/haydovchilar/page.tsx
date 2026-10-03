import Link from "next/link";
import { Users } from "lucide-react";
import { db } from "@/lib/db";
import { requireRoles } from "@/lib/page-guard";
import { ACTIVE_TRIP, dayRange, delayLevel, driverEmployees, expiryLevel, logisticsSettings, tripDelayMin } from "@/lib/logistics";
import { date, qty } from "@/lib/format";
import { Badge, Card, Empty, PageHeader, Table, Td, Th, Tr } from "@/components/ui";
import { TripLink } from "../ui";

export const dynamic = "force-dynamic";

const ATT: Record<string, string> = { ABSENT: "Kelmadi", LEAVE: "Ta'tilda", SICK: "Kasal", DAYOFF: "Dam olish" };

/** Haydovchilar moduli (TZ 7): guvohnoma, transport, grafik, mavjudlik, reyslar, kechikish va muammolar. */
export default async function DriversPage() {
  await requireRoles(["LOGISTICS"], { module: "logistika" });
  const settings = await logisticsSettings();
  const drivers = await driverEmployees();
  const ids = drivers.map((d) => d.id);
  const { from: today, to: tomorrow } = dayRange();
  const monthFrom = new Date(today.getFullYear(), today.getMonth(), 1);
  const [trips, att, vehicles, issues] = await Promise.all([
    db.trip.findMany({
      where: { driverId: { in: ids }, status: { not: "CANCELLED" }, OR: [{ createdAt: { gte: monthFrom } }, { status: { in: ACTIVE_TRIP } }] },
      select: { id: true, deliveryNoteNo: true, driverId: true, status: true, qtyM3: true, createdAt: true, loadedAt: true, deliveredAt: true, plannedAt: true, order: { select: { deliveryDate: true, deliveryTime: true } } },
    }),
    db.attendance.findMany({ where: { employeeId: { in: ids }, date: today }, select: { employeeId: true, status: true } }),
    db.vehicle.findMany({ select: { id: true, plate: true } }),
    db.tripIssue.groupBy({ by: ["tripId"], where: { trip: { driverId: { in: ids } }, createdAt: { gte: monthFrom } }, _count: true }),
  ]);
  const plate = new Map(vehicles.map((v) => [v.id, v.plate]));
  const attBy = new Map(att.map((a) => [a.employeeId, a.status]));
  const issueTrips = new Set(issues.map((i) => i.tripId));

  const rows = drivers.map((d) => {
    const mine = trips.filter((t) => t.driverId === d.id);
    const active = mine.find((t) => ACTIVE_TRIP.includes(t.status));
    const month = mine.filter((t) => t.createdAt >= monthFrom);
    const todayN = mine.filter((t) => t.createdAt >= today && t.createdAt < tomorrow).length;
    const late = month.filter((t) => t.status === "DELIVERED" && delayLevel(tripDelayMin(t, t.order), settings) !== "ok").length;
    const a = attBy.get(d.id);
    const avail = !d.isActive ? { label: "Ishdan ketgan", color: "slate" as const }
      : active ? { label: "Reysda", color: "amber" as const }
      : a && a !== "PRESENT" ? { label: ATT[a] ?? a, color: "red" as const }
      : { label: "Bo'sh", color: "green" as const };
    return { d, active, month, todayN, late, avail, issues: month.filter((t) => issueTrips.has(t.id)).length };
  });

  return (
    <div>
      <PageHeader title="Haydovchilar" subtitle="Shaxsiy ma'lumot Otdel kadrda; guvohnoma, grafik va transport — shu yerda. Mavjudlik: reys + bugungi davomat" />
      <Card padded={false}>
        <Table>
          <thead><tr><Th>Haydovchi</Th><Th>Mavjudlik</Th><Th>Guvohnoma</Th><Th>Transport</Th><Th>Ish grafigi</Th><Th right>Bugun</Th><Th right>Oy: reys</Th><Th right>Oy: hajm</Th><Th right>Kechikish</Th><Th right>Muammo</Th></tr></thead>
          <tbody>
            {rows.length === 0 && <Empty text="Haydovchi lavozimidagi xodim yo'q (Otdel kadr → Ishchi lavozimlar)" icon={Users} />}
            {rows.map(({ d, active, month, todayN, late, avail, issues }) => {
              const lic = expiryLevel(d.licenseExpiry);
              return (
                <Tr key={d.id} className={d.isActive ? "" : "opacity-60"}>
                  <Td><Link href={`/logistika/haydovchilar/${d.id}`} className="font-medium hover:underline">{d.fullName}</Link><div className="text-xs text-slate-500 tabular">{d.phone ?? <span className="text-amber-700">telefon yo'q</span>}</div></Td>
                  <Td><Badge color={avail.color}>{avail.label}</Badge>{active && <div className="text-xs"><TripLink id={active.id} noteNo={active.deliveryNoteNo} /></div>}</Td>
                  <Td className="text-sm">{d.licenseNo ? <>{d.licenseCategory ?? ""} <span className="text-xs text-slate-500">{d.licenseNo}</span></> : <span className="text-xs text-amber-700">kiritilmagan</span>}
                    {d.licenseExpiry && <div className={`text-xs ${lic === "crit" ? "font-medium text-red-700" : lic === "warn" ? "font-medium text-amber-700" : "text-slate-500"}`}>{date(d.licenseExpiry)} gacha</div>}</Td>
                  <Td className="text-sm tabular">{d.vehicleId ? <Link href={`/logistika/transport/${d.vehicleId}`} className="hover:underline">{plate.get(d.vehicleId)}</Link> : <span className="text-slate-400">—</span>}</Td>
                  <Td className="text-sm">{d.workSchedule ?? <span className="text-slate-400">—</span>}</Td>
                  <Td right className="tabular">{todayN}</Td>
                  <Td right className="tabular">{month.length}</Td>
                  <Td right className="tabular">{qty(month.reduce((a, t) => a + Number(t.qtyM3), 0))}</Td>
                  <Td right className={late ? "font-medium text-amber-700" : "text-slate-400"}>{late}</Td>
                  <Td right className={issues ? "font-medium text-red-700" : "text-slate-400"}>{issues}</Td>
                </Tr>
              );
            })}
          </tbody>
        </Table>
      </Card>
      <p className="mt-3 text-xs text-slate-500">Haydovchi ilovasi (ECO) bilan ulanish — <Link href="/drivers" className="underline">Haydovchi ilovasi</Link> sahifasida.</p>
    </div>
  );
}
