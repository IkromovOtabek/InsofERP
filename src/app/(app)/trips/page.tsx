import Link from "next/link";
import { History, Plus, Trash2 } from "lucide-react";
import { db } from "@/lib/db";
import { customerMarks } from "@/lib/finance";
import { CustomerName } from "@/components/customer-name";
import { qty } from "@/lib/format";
import { unitLabel, soleUnit } from "@/lib/unit";
import { BackLink, Badge, Empty, LinkButton, PageHeader, Table, Td, Th, Tr, Tabs } from "@/components/ui";
import { TRIP_STATUS } from "./status";
import { tripPhase, VEHICLE_TYPE } from "@/lib/logistics";
import { tripLine } from "@/lib/trips";
import { PhaseBadge } from "../logistika/ui";
import { ecoEnabled } from "@/lib/eco/client";
import { ecoLabel } from "@/lib/eco/labels";
import { LiveDrivers } from "./live-drivers";
import { DriverList, DriverTrips } from "./driver-history";
import type { TripStatus } from "@/generated/prisma";
import { requirePage } from "@/lib/page-guard";
import { canDo } from "@/lib/permissions";
import { cancelTrip } from "./actions";
import { ConfirmButton } from "../payments/confirm-button";
import { SectionTabs } from "@/components/section-tabs";

export default async function TripsPage({ searchParams }: { searchParams: Promise<{ status?: string; q?: string; driver?: string }> }) {
  const s = await requirePage("/trips");
  const { status, q, driver } = await searchParams;
  // Reysni dispetcher va ishlab chiqarish ochadi; mexanik/ish boshqaruvchi faqat ko'radi (/trips/new ularga yopiq)
  const canCreate = ["LOGISTICS", "PRODUCTION", "DIRECTOR"].includes(s.role);
  // Rejalashtirilgan (yuklanmagan) reysni ro'yxatdan o'chirish — ruxsatlar daraxti bo'yicha (trips → cancel)
  const canCancel = canDo(s, "trips", "cancel");
  const newBtn = canCreate ? <LinkButton href="/trips/new"><Plus size={16} /> Reys</LinkButton> : undefined;
  const eco = ecoEnabled();
  // "Tarix" — holat emas, alohida ko'rinish: haydovchilar ro'yxati va ularning butun tarixi
  const history = status === "tarix";
  const tabItems = [
    { key: "", label: "Hammasi", href: "/trips" },
    // Bekor qilingan reys bazadan o'chiriladi (`lib/purge-cancelled.ts`) — uning tabi yo'q
    ...Object.entries(TRIP_STATUS).filter(([k]) => k !== "CANCELLED").map(([k, v]) => ({ key: k, label: v.label, href: `/trips?status=${k}` })),
    { key: "tarix", label: "Tarix", href: "/trips?status=tarix", icon: History },
  ];

  if (history) {
    return (
      <div>
        <PageHeader
          title="Reyslar / nakladnoy"
          subtitle={driver ? undefined : "Haydovchilar kesimida butun tarix"}
          action={newBtn}
        />
        <Tabs current="tarix" items={tabItems} />
        {driver ? (
          <>
            <BackLink href="/trips?status=tarix" label="Haydovchilar ro'yxati" className="mb-3" />
            <DriverTrips driverId={driver} />
          </>
        ) : <DriverList />}
      </div>
    );
  }

  const trips = await db.trip.findMany({
    where: {
      ...(status && status in TRIP_STATUS ? { status: status as TripStatus } : {}),
      ...(q ? { OR: [{ deliveryNoteNo: { contains: q, mode: "insensitive" } }, { ttn: { contains: q, mode: "insensitive" } }] } : {}),
    },
    orderBy: { createdAt: "desc" }, take: 200,
    // Mahsulot birligi ham kerak: reys miqdori zayavkadagi birlikda ko'rsatiladi (m³ / dona)
    include: { order: { include: { customer: true, items: { select: { productId: true, qtyM3: true, product: { select: { unit: true } } } } } }, vehicle: true, driver: true, issues: { where: { resolvedAt: null }, select: { id: true } } },
  });
  const marks = await customerMarks(trips.map((t) => t.order.customerId));
  return (
    <div>
      <SectionTabs section="reyslar" current="/trips" />
      <PageHeader title="Reyslar" action={newBtn} />
      {eco && <LiveDrivers />}
      <Tabs current={status ?? ""} items={tabItems} />
      <Table>
        <thead><tr><Th>Nakladnoy</Th><Th>Mijoz</Th><Th>Texnika</Th><Th>Haydovchi</Th><Th right>Miqdor</Th><Th>Bosqich</Th>{eco && <Th>ECO</Th>}{canCancel && <Th />}</tr></thead>
        <tbody>
          {trips.length === 0 && <Empty text="Reyslar yo'q" />}
          {trips.map((t) => (
            <Tr key={t.id}>
              <Td><Link href={`/trips/${t.id}`} className="font-medium hover:underline">{t.deliveryNoteNo}</Link>{t.ttn && <div className="text-xs text-slate-500 tabular">TTN {t.ttn}</div>}</Td>
              <Td><CustomerName name={t.order.customer.name} blacklisted={marks.black.has(t.order.customerId)} contracted={marks.contract.has(t.order.customerId)} href={`/orders/${t.orderId}`} /></Td><Td className="whitespace-nowrap">{t.vehicle.plate}<div className="text-xs text-slate-500">{VEHICLE_TYPE[t.vehicle.type] ?? t.vehicle.type}</div></Td><Td>{t.driver.fullName}</Td><Td right className="whitespace-nowrap">{(() => { const l = tripLine(t.order.items, t.vehicle.type); const u = "error" in l ? soleUnit(t.order.items.map((i) => ({ unit: i.product.unit, qty: i.qtyM3 }))) : l.unit; return u ? `${qty(t.qtyM3)} ${unitLabel(u)}` : qty(t.qtyM3); })()}</Td>
              {/* TZ bosqichi (obyektga keldi / tushirilmoqda / yopildi — vaqt belgilaridan) */}
              <Td><PhaseBadge phase={tripPhase(t)} />{t.issues.length > 0 && <div><Badge color="red">muammo</Badge></div>}</Td>
              {eco && <Td>{(() => { const st = ecoLabel(t.ecoStatus); return st ? <Badge color={st.color}>{st.label}</Badge> : t.ecoError ? <Badge color="red">xato</Badge> : <span className="text-xs text-slate-400">—</span>; })()}</Td>}
              {canCancel && <Td>{t.status === "PLANNED" && (
                <ConfirmButton action={cancelTrip.bind(null, t.id)} label="" title="O'chirish" icon={<Trash2 size={14} />} reason="optional" okText="O'chirildi"
                  question={`${t.deliveryNoteNo} reysi o'chirilsinmi? Haydovchiga xabar boradi`} className="h-7 px-1.5" />
              )}</Td>}
            </Tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}
