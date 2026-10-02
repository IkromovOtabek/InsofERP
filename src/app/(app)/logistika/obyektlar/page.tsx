import Link from "next/link";
import { MapPin, Plus } from "lucide-react";
import { db } from "@/lib/db";
import { requireRoles } from "@/lib/page-guard";
import { date, qty } from "@/lib/format";
import { Badge, Card, Empty, LinkButton, PageHeader, Table, Tabs, Td, Th, Tr } from "@/components/ui";

export const dynamic = "force-dynamic";

/** Obyektlar moduli (TZ 8): mijozlarning qurilish maydonlari va har biriga yetkazish tarixi. */
export default async function SitesPage({ searchParams }: { searchParams: Promise<{ q?: string; all?: string }> }) {
  await requireRoles(["LOGISTICS", "SALES"]);
  const { q, all } = await searchParams;
  const sites = await db.site.findMany({
    where: {
      ...(all ? {} : { isActive: true }),
      ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { address: { contains: q, mode: "insensitive" } }, { customer: { name: { contains: q, mode: "insensitive" } } }] } : {}),
    },
    include: {
      customer: { select: { name: true } },
      orders: { where: { status: { not: "CANCELLED" } }, select: { status: true, deliveryDate: true, trips: { where: { status: "DELIVERED" }, select: { qtyM3: true } } }, orderBy: { deliveryDate: "desc" } },
    },
    orderBy: { updatedAt: "desc" },
    take: 300,
  });
  const rows = sites.map((s) => ({
    s,
    orders: s.orders.length,
    open: s.orders.filter((o) => ["CONFIRMED", "IN_PRODUCTION", "BLOCKED", "DRAFT"].includes(o.status)).length,
    delivered: s.orders.reduce((a, o) => a + o.trips.reduce((b, t) => b + Number(t.qtyM3), 0), 0),
    last: s.orders[0]?.deliveryDate ?? null,
  })).sort((a, b) => b.open - a.open || (b.last?.getTime() ?? 0) - (a.last?.getTime() ?? 0));

  return (
    <div>
      <PageHeader title="Obyektlar" subtitle="Zayavka ochilganda mijoz + manzil bo'yicha avtomatik yaratiladi — kontakt va ko'rsatmani shu yerda to'ldiring"
        action={<LinkButton href="/logistika/obyektlar/new"><Plus size={16} /> Obyekt</LinkButton>} />
      <form className="mb-3"><input name="q" defaultValue={q} placeholder="Obyekt, manzil yoki mijoz…" className="h-9 w-72 rounded-lg border border-slate-200 px-3 text-sm" /></form>
      <Tabs current={all ? "all" : ""} items={[{ key: "", label: "Faol", href: "/logistika/obyektlar" }, { key: "all", label: "Hammasi", href: "/logistika/obyektlar?all=1" }]} />
      <Card padded={false}>
        <Table>
          <thead><tr><Th>Obyekt</Th><Th>Mijoz</Th><Th>Kontakt</Th><Th>Qabul vaqti</Th><Th>Nuqta</Th><Th right>Zayavka</Th><Th right>Yetkazilgan</Th><Th>Oxirgi</Th></tr></thead>
          <tbody>
            {rows.length === 0 && <Empty text="Obyekt yo'q" icon={MapPin} />}
            {rows.map(({ s, orders, open, delivered, last }) => (
              <Tr key={s.id} className={s.isActive ? "" : "opacity-60"}>
                <Td><Link href={`/logistika/obyektlar/${s.id}`} className="font-medium hover:underline">{s.name}</Link>{s.name !== s.address && <div className="max-w-xs truncate text-xs text-slate-500">{s.address}</div>}{s.instructions && <div className="text-xs text-violet-700">ko'rsatma bor</div>}</Td>
                <Td className="text-sm">{s.customer.name}</Td>
                <Td className="text-sm">{s.contactName ?? ""}{s.contactPhone && <div className="text-xs text-slate-500 tabular">{s.contactPhone}</div>}{!s.contactName && !s.contactPhone && <span className="text-xs text-amber-700">yo'q</span>}</Td>
                <Td className="text-sm">{s.deliveryHours ?? "—"}</Td>
                <Td>{s.lat != null ? <Badge color="green">bor</Badge> : <Badge color="amber">yo'q</Badge>}</Td>
                <Td right className="tabular">{orders}{open > 0 && <span className="text-xs text-blue-700"> ({open} ochiq)</span>}</Td>
                <Td right className="tabular">{qty(delivered)}</Td>
                <Td className="text-sm tabular">{last ? date(last) : "—"}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}
