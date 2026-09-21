import Link from "next/link";
import { History, Plus } from "lucide-react";
import { db } from "@/lib/db";
import { customerMarks } from "@/lib/finance";
import { CustomerName } from "@/components/customer-name";
import { qty } from "@/lib/format";
import { Badge, Empty, LinkButton, PageHeader, Table, Td, Th, Tr, Tabs } from "@/components/ui";
import { TRIP_STATUS, TripStatusBadge } from "./status";
import { ecoEnabled } from "@/lib/eco/client";
import { ecoLabel } from "@/lib/eco/labels";
import { LiveDrivers } from "./live-drivers";
import { DriverList, DriverTrips } from "./driver-history";
import type { TripStatus } from "@/generated/prisma";

export default async function TripsPage({ searchParams }: { searchParams: Promise<{ status?: string; q?: string; driver?: string }> }) {
  const { status, q, driver } = await searchParams;
  const eco = ecoEnabled();
  // "Tarix" — holat emas, alohida ko'rinish: haydovchilar ro'yxati va ularning butun tarixi
  const history = status === "tarix";
  const tabItems = [
    { key: "", label: "Hammasi", href: "/trips" },
    ...Object.entries(TRIP_STATUS).map(([k, v]) => ({ key: k, label: v.label, href: `/trips?status=${k}` })),
    { key: "tarix", label: "Tarix", href: "/trips?status=tarix", icon: History },
  ];

  if (history) {
    return (
      <div>
        <PageHeader
          title="Reyslar / nakladnoy"
          subtitle={driver ? undefined : "Haydovchilar kesimida butun tarix"}
          action={<LinkButton href="/trips/new"><Plus size={16} /> Reys</LinkButton>}
        />
        <Tabs current="tarix" items={tabItems} />
        {driver ? (
          <>
            <Link href="/trips?status=tarix" className="mb-3 inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-900">← Haydovchilar ro&apos;yxati</Link>
            <DriverTrips driverId={driver} />
          </>
        ) : <DriverList />}
      </div>
    );
  }

  const trips = await db.trip.findMany({
    where: {
      ...(status && status in TRIP_STATUS ? { status: status as TripStatus } : {}),
      ...(q ? { deliveryNoteNo: { contains: q, mode: "insensitive" } } : {}),
    },
    orderBy: { createdAt: "desc" }, take: 200,
    include: { order: { include: { customer: true } }, vehicle: true, driver: true },
  });
  const marks = await customerMarks(trips.map((t) => t.order.customerId));
  return (
    <div>
      <PageHeader title="Reyslar / nakladnoy" action={<LinkButton href="/trips/new"><Plus size={16} /> Reys</LinkButton>} />
      {eco && <LiveDrivers />}
      <Tabs current={status ?? ""} items={tabItems} />
      <Table>
        <thead><tr><Th>Nakladnoy</Th><Th>Zayavka</Th><Th>Mijoz</Th><Th>Mikser</Th><Th>Haydovchi</Th><Th right>m³</Th><Th>Holat</Th>{eco && <Th>ECO</Th>}</tr></thead>
        <tbody>
          {trips.length === 0 && <Empty text="Reyslar yo'q" />}
          {trips.map((t) => (
            <Tr key={t.id}>
              <Td><Link href={`/trips/${t.id}`} className="font-medium hover:underline">{t.deliveryNoteNo}</Link></Td>
              <Td><Link href={`/orders/${t.orderId}`} className="hover:underline">{t.order.orderNo}</Link></Td>
              <Td><CustomerName name={t.order.customer.name} blacklisted={marks.black.has(t.order.customerId)} contracted={marks.contract.has(t.order.customerId)} /></Td><Td>{t.vehicle.plate}</Td><Td>{t.driver.fullName}</Td><Td right>{qty(t.qtyM3)}</Td>
              <Td><TripStatusBadge status={t.status} /></Td>
              {eco && <Td>{(() => { const st = ecoLabel(t.ecoStatus); return st ? <Badge color={st.color}>{st.label}</Badge> : t.ecoError ? <Badge color="red">xato</Badge> : <span className="text-xs text-slate-400">—</span>; })()}</Td>}
            </Tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}
