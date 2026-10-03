import Link from "next/link";
import { FileText, Printer, QrCode } from "lucide-react";
import { db } from "@/lib/db";
import { requireRoles } from "@/lib/page-guard";
import { tripPhase } from "@/lib/logistics";
import { dateTime, qty } from "@/lib/format";
import { Badge, Card, Empty, PageHeader, Table, Td, Th, Tr } from "@/components/ui";
import { PeriodTabs, PhaseBadge, RangeForm, periodRange, unitShort } from "../ui";

export const dynamic = "force-dynamic";

const hm = (d: Date | null) => (d ? dateTime(d) : "—");

/**
 * Nakladnoy moduli (TZ 10): raqam, mijoz, obyekt, transport, haydovchi, marka va miqdor,
 * yuklash/jo'nash/yetib borish vaqtlari, qabul qiluvchi, tasdiq, QR orqali tekshirish.
 * Nakladnoy = reys (Trip.deliveryNoteNo) — chop etish va QR tekshiruv mavjud sahifalarda.
 */
export default async function WaybillsPage({ searchParams }: { searchParams: Promise<{ period?: string; from?: string; to?: string; q?: string }> }) {
  await requireRoles(["LOGISTICS", "ACCOUNTING"], { module: "logistika" });
  const sp = await searchParams;
  const r = periodRange(sp, "week");
  const trips = await db.trip.findMany({
    where: {
      createdAt: { gte: r.from, lt: r.to },
      ...(sp.q ? { OR: [{ deliveryNoteNo: { contains: sp.q, mode: "insensitive" } }, { order: { customer: { name: { contains: sp.q, mode: "insensitive" } } } }, { vehicle: { plate: { contains: sp.q, mode: "insensitive" } } }] } : {}),
    },
    include: {
      order: { select: { orderNo: true, deliveryAddress: true, customer: { select: { name: true } }, items: { select: { product: { select: { name: true, code: true, unit: true } } } } } },
      vehicle: { select: { plate: true } }, driver: { select: { fullName: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 500,
  });
  return (
    <div>
      <PageHeader title="Nakladnoylar" subtitle={`${r.label}: ${trips.length} ta · har biri QR bilan tekshiriladi (mijoz telefonidan ham)`} />
      <PeriodTabs base="/logistika/nakladnoylar" current={r.period} />
      <RangeForm base="/logistika/nakladnoylar" from={r.from} to={r.to} />
      <form className="mb-3"><input type="hidden" name="period" value={r.period} /><input name="q" defaultValue={sp.q} placeholder="Nakladnoy, mijoz yoki davlat raqami…" className="h-9 w-72 rounded-lg border border-slate-200 px-3 text-sm" /></form>
      <Card padded={false}>
        <Table>
          <thead><tr><Th>Nakladnoy</Th><Th>Mijoz / obyekt</Th><Th>Transport / haydovchi</Th><Th>Marka</Th><Th right>Miqdor</Th><Th>Yuklandi</Th><Th>Jo'nadi</Th><Th>Yetib keldi</Th><Th>Qabul qiluvchi</Th><Th>Tasdiq</Th><Th /></tr></thead>
          <tbody>
            {trips.length === 0 && <Empty text="Nakladnoy yo'q" icon={FileText} />}
            {trips.map((t) => {
              const p = t.order.items[0]?.product;
              const phase = tripPhase(t);
              return (
                <Tr key={t.id} className={t.status === "CANCELLED" ? "opacity-50" : ""}>
                  <Td><Link href={`/trips/${t.id}`} className="font-medium tabular hover:underline">{t.deliveryNoteNo}</Link><div className="text-xs text-slate-500">{t.order.orderNo}</div></Td>
                  <Td><div className="text-sm">{t.order.customer.name}</div><div className="max-w-[14rem] truncate text-xs text-slate-500">{t.order.deliveryAddress}</div></Td>
                  <Td className="text-sm"><span className="tabular">{t.vehicle.plate}</span><div className="text-xs text-slate-500">{t.driver.fullName}</div></Td>
                  <Td className="text-sm">{p?.code ?? p?.name ?? "—"}</Td>
                  <Td right className="tabular">{qty(t.qtyM3)} {unitShort(p?.unit ?? "m3")}</Td>
                  <Td className="text-xs tabular">{hm(t.loadedAt)}</Td>
                  <Td className="text-xs tabular">{hm(t.departedAt)}</Td>
                  <Td className="text-xs tabular">{hm(t.arrivedAt)}</Td>
                  <Td className="text-sm">{t.receiverName ?? "—"}</Td>
                  <Td>{t.status === "DELIVERED" ? (t.ecoStatus === "COMPLETED" ? <Badge color="green">imzo (ilova)</Badge> : <Badge color="green">qabul qilindi</Badge>) : <PhaseBadge phase={phase} />}</Td>
                  <Td>
                    <div className="flex gap-2 text-slate-500">
                      <Link href={`/trips/${t.id}/print`} title="Chop etish" className="hover:text-slate-900"><Printer size={15} /></Link>
                      <Link href={`/verify/${encodeURIComponent(t.deliveryNoteNo)}${t.verifyToken ? `?k=${t.verifyToken}` : ""}`} title="QR tekshiruv sahifasi" className="hover:text-slate-900"><QrCode size={15} /></Link>
                    </div>
                  </Td>
                </Tr>
              );
            })}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}
