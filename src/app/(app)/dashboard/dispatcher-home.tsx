import Link from "next/link";
import { AlertTriangle, ArrowRight, BellRing, CheckCircle2, CircleOff, Gauge, IdCard, ShieldAlert, Truck, UserCheck, UserX, Users, Wrench } from "lucide-react";
import { db } from "@/lib/db";
import { ACTIVE_TRIP, dayRange, driverEmployees, expiryLevel, ISSUE_KIND, VEHICLE_ISSUE_KINDS, vehicleLive, vehicleServiceDue, type VehicleLive } from "@/lib/logistics";
import { unpricedWhere } from "@/lib/driver-trip-pay";
import { date, dateTime, fmtNum } from "@/lib/format";
import { Badge, Card, Empty, Section, StatCard, Table, Td, Th, Tr } from "@/components/ui";

const more = (href: string, text: string) => (
  <Link href={href} className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-900">{text} <ArrowRight size={14} /></Link>
);

type Due = { key: string; href: string; who: string; what: string; until: Date; crit: boolean };

/**
 * Dispetcher bosh sahifasi — kabineti faqat haydovchilar va transport: kim bo'sh / reysda / kelmagan,
 * qaysi texnika saflda / ta'mirda, muddati o'tayotgan guvohnoma, texosmotr, sug'urta va texnik xizmat.
 * Hisob-kitob `lib/logistics.ts` dan (Haydovchilar va Transport sahifalari bilan bir xil qoida).
 */
export async function DispatcherHome() {
  const { from: today } = dayRange();
  const drivers = await driverEmployees({ activeOnly: true });
  const ids = drivers.map((d) => d.id);
  const [busy, att, vehicles, service, unpriced, issues] = await Promise.all([
    db.trip.findMany({ where: { driverId: { in: ids }, status: { in: ACTIVE_TRIP } }, select: { driverId: true } }),
    db.attendance.findMany({ where: { employeeId: { in: ids }, date: today, status: { not: "PRESENT" } }, select: { employeeId: true } }),
    db.vehicle.findMany({
      orderBy: { plate: "asc" },
      select: {
        id: true, plate: true, isActive: true, status: true, inspectionUntil: true, insuranceUntil: true,
        trips: { where: { OR: [{ status: { in: ACTIVE_TRIP } }, { deliveredAt: { gte: new Date(Date.now() - 3 * 3600_000) } }] }, select: { status: true, deliveredAt: true, returnedAt: true } },
      },
    }),
    vehicleServiceDue(),
    db.trip.count({ where: unpricedWhere() }),
    // Ochiq transport muammolari (buzilish, avariya) — dispetcher hal qiladi
    db.tripIssue.findMany({
      where: { resolvedAt: null, kind: { in: VEHICLE_ISSUE_KINDS } }, orderBy: { createdAt: "desc" }, take: 20,
      select: { id: true, kind: true, note: true, createdAt: true, trip: { select: { id: true, deliveryNoteNo: true, driver: { select: { fullName: true } }, vehicle: { select: { id: true, plate: true } } } } },
    }),
  ]);

  const onTrip = new Set(busy.map((t) => t.driverId));
  const absent = new Set(att.map((a) => a.employeeId).filter((id) => !onTrip.has(id)));
  const free = drivers.length - onTrip.size - absent.size;
  const live = vehicles.map((v) => vehicleLive(v, v.trips));
  const count = (l: VehicleLive[]) => live.filter((x) => l.includes(x)).length;

  // Muddati o'tgan yoki 30 kun ichida tugaydigan hujjatlar — avval o'tganlari
  const dues: Due[] = [];
  for (const d of drivers) {
    const l = expiryLevel(d.licenseExpiry);
    if (d.licenseExpiry && (l === "crit" || l === "warn")) dues.push({ key: `l${d.id}`, href: `/logistika/haydovchilar/${d.id}`, who: d.fullName, what: "Haydovchilik guvohnomasi", until: d.licenseExpiry, crit: l === "crit" });
  }
  for (const v of vehicles.filter((x) => x.isActive)) {
    for (const [what, until] of [["Texosmotr", v.inspectionUntil], ["Sug'urta", v.insuranceUntil]] as const) {
      const l = expiryLevel(until);
      if (until && (l === "crit" || l === "warn")) dues.push({ key: `${what}${v.id}`, href: `/logistika/transport/${v.id}`, who: v.plate, what, until, crit: l === "crit" });
    }
  }
  dues.sort((a, b) => a.until.getTime() - b.until.getTime());

  return (
    <div className="space-y-6">
      {unpriced > 0 && (
        <Link href="/logistika/tabel" className="flex items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 hover:bg-amber-100">
          <span className="flex items-center gap-2 font-medium"><BellRing size={16} /> Narx belgilanmagan reyslar: {unpriced} ta</span>
          <span className="inline-flex items-center gap-1">Tabelga o&apos;tish <ArrowRight size={14} /></span>
        </Link>
      )}
      {issues.length > 0 && (
        <Card padded={false} className="border-red-200">
          <div className="flex items-center gap-2 px-5 pt-4 text-sm font-semibold text-red-800"><AlertTriangle size={16} /> Ochiq transport muammolari ({issues.length})</div>
          <Table>
            <thead><tr><Th>Transport</Th><Th>Muammo</Th><Th>Haydovchi · reys</Th><Th>Qachon</Th></tr></thead>
            <tbody>
              {issues.map((i) => (
                <Tr key={i.id}>
                  <Td><Link href={`/logistika/transport/${i.trip.vehicle.id}`} className="font-medium tabular hover:underline">{i.trip.vehicle.plate}</Link></Td>
                  <Td className="text-sm"><Badge color="red">{ISSUE_KIND[i.kind]}</Badge>{i.note && <div className="mt-0.5 text-xs text-slate-600">{i.note}</div>}</Td>
                  <Td className="text-sm">{i.trip.driver.fullName} · <Link href={`/trips/${i.trip.id}`} className="tabular hover:underline">{i.trip.deliveryNoteNo}</Link></Td>
                  <Td className="text-sm tabular">{dateTime(i.createdAt)}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
          <p className="px-5 pb-3 text-xs text-slate-500">Hal qilish — reys sahifasida «Muammoni hal qilish».</p>
        </Card>
      )}
      <Section title="Haydovchilar" className="mt-0" action={more("/logistika/haydovchilar", "Haydovchilar")}>
        <div data-tour="stats" className="grid grid-cols-2 gap-3 xl:grid-cols-4 [&>*]:min-w-0">
          <StatCard label="Faol haydovchi" value={drivers.length} icon={Users} tone="info" href="/logistika/haydovchilar" />
          <StatCard label="Bo'sh" value={Math.max(0, free)} hint="reysga tayyor" icon={UserCheck} tone="success" />
          <StatCard label="Reysda" value={onTrip.size} icon={Truck} tone="brand" />
          <StatCard label="Kelmagan / ta'tilda" value={absent.size} hint="bugungi davomat" icon={UserX} tone={absent.size ? "warning" : "default"} />
        </div>
      </Section>

      <Section title="Transport" action={more("/logistika/transport", "Transport")}>
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4 [&>*]:min-w-0">
          <StatCard label="Bo'sh" value={count(["FREE"])} hint="reysga tayyor" icon={Gauge} tone="success" href="/logistika/transport?state=FREE" />
          <StatCard label="Reysda / yuklanmoqda" value={count(["ON_TRIP", "LOADING", "ASSIGNED", "RETURNING"])} icon={Truck} tone="brand" href="/logistika/transport?state=ON_TRIP" />
          <StatCard label="Ta'mirda" value={count(["REPAIR"])} icon={Wrench} tone={count(["REPAIR"]) ? "danger" : "default"} href="/logistika/transport?state=REPAIR" />
          <StatCard label="Faol emas / bekor" value={count(["INACTIVE", "IDLE"])} icon={CircleOff} href="/logistika/transport?state=IDLE" />
        </div>
      </Section>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2 [&>*]:min-w-0">
        <Section title="Hujjat muddati" className="mt-0">
          <Card padded={false}>
            <Table>
              <thead><tr><Th>Kim / nima</Th><Th>Hujjat</Th><Th>Muddat</Th></tr></thead>
              <tbody>
                {dues.length === 0 && <Empty text="30 kun ichida muddati tugaydigan hujjat yo'q" icon={IdCard} />}
                {dues.map((x) => (
                  <Tr key={x.key}>
                    <Td><Link href={x.href} className="font-medium hover:underline">{x.who}</Link></Td>
                    <Td className="text-sm">{x.what}</Td>
                    <Td><Badge color={x.crit ? "red" : "amber"}>{x.crit ? "O'tgan" : "Yaqin"}</Badge> <span className="text-sm tabular">{date(x.until)}</span></Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </Card>
        </Section>

        <Section title="Texnik xizmat muddati" className="mt-0">
          {service.length === 0 ? (
            <Card className="flex items-center gap-2 text-sm text-emerald-800"><CheckCircle2 size={16} /> Muddati o&apos;tgan yoki 14 kun / 1000 km ichida keladigan texnik xizmat yo&apos;q</Card>
          ) : (
            <Card padded={false}>
              <Table>
                <thead><tr><Th>Transport</Th><Th>Xizmat</Th><Th>Muddat</Th></tr></thead>
                <tbody>
                  {service.map((x) => (
                    <Tr key={x.serviceId}>
                      <Td><Link href={`/logistika/transport/${x.vehicleId}`} className="font-medium tabular hover:underline">{x.plate}</Link></Td>
                      <Td className="text-sm">{x.text}</Td>
                      <Td>
                        <Badge color={x.level === "crit" ? "red" : "amber"}>{x.level === "crit" ? "O'tgan" : "Yaqin"}</Badge>{" "}
                        <span className="text-sm tabular">{x.dueAt ? date(x.dueAt) : ""}{x.dueAt && x.dueKm != null ? " · " : ""}{x.dueKm != null ? `${fmtNum(x.dueKm, 0)} km` : ""}</span>
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </Card>
          )}
        </Section>
      </div>
      {dues.some((x) => x.crit) && <p className="flex items-center gap-1.5 text-xs text-red-700"><ShieldAlert size={14} /> Muddati o&apos;tgan hujjat bilan reysga chiqarish tavsiya etilmaydi.</p>}
    </div>
  );
}
