import Link from "next/link";
import { Plus } from "lucide-react";
import { db } from "@/lib/db";
import { qty } from "@/lib/format";
import { Empty, LinkButton, PageHeader, Table, Td, Th, Tr, Tabs } from "@/components/ui";
import { TRIP_STATUS, TripStatusBadge } from "./status";
import type { TripStatus } from "@/generated/prisma";

export default async function TripsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status } = await searchParams;
  const trips = await db.trip.findMany({
    where: status && status in TRIP_STATUS ? { status: status as TripStatus } : undefined,
    orderBy: { createdAt: "desc" }, take: 200,
    include: { order: { include: { customer: true } }, vehicle: true, driver: true },
  });
  const tabs: Array<[string, string]> = [["", "Hammasi"], ...Object.entries(TRIP_STATUS).map(([k, v]) => [k, v.label] as [string, string])];
  return (
    <div>
      <PageHeader title="Reyslar / nakladnoy" action={<LinkButton href="/trips/new"><Plus size={16} /> Reys</LinkButton>} />
      <Tabs current={status ?? ""} items={tabs.map(([k, l]) => ({ key: k, label: l, href: k ? `/trips?status=${k}` : "/trips" }))} />
      <Table>
        <thead><tr><Th>Nakladnoy</Th><Th>Zayavka</Th><Th>Mijoz</Th><Th>Mikser</Th><Th>Haydovchi</Th><Th right>m³</Th><Th>Holat</Th></tr></thead>
        <tbody>
          {trips.length === 0 && <Empty text="Reyslar yo'q" />}
          {trips.map((t) => (
            <Tr key={t.id}>
              <Td><Link href={`/trips/${t.id}`} className="font-medium hover:underline">{t.deliveryNoteNo}</Link></Td>
              <Td><Link href={`/orders/${t.orderId}`} className="hover:underline">{t.order.orderNo}</Link></Td>
              <Td>{t.order.customer.name}</Td><Td>{t.vehicle.plate}</Td><Td>{t.driver.fullName}</Td><Td right>{qty(t.qtyM3)}</Td>
              <Td><TripStatusBadge status={t.status} /></Td>
            </Tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}
