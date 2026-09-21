import Link from "next/link";
import { notFound } from "next/navigation";
import { Boxes, UserCheck, PackageOpen, AlertTriangle, Factory, History } from "lucide-react";
import { ostatkaDetail } from "@/lib/ostatka";
import { qty, date, dateTime } from "@/lib/format";
import { unitLabel } from "@/lib/unit";
import { Badge, Callout, Card, CardHeader, Empty, PageHeader, StatCard, Td, Th, Tr } from "@/components/ui";
import { OrderStatusBadge } from "../../../orders/status";

const MOVE: Record<string, string> = { PRODUCTION_OUTPUT: "Ishlab chiqarildi", SHIPMENT: "Jo'natildi", ADJUSTMENT: "Qo'lda qo'shildi", WRITE_OFF: "Hisobdan chiqarildi" };

export default async function StockProductDetail({ params }: { params: Promise<{ productId: string }> }) {
  const { productId } = await params;
  const d = await ostatkaDetail(productId);
  if (!d) notFound();
  const u = unitLabel(d.product.unit);

  return (
    <div>
      <PageHeader back={{ href: "/stock?tab=capacity", label: "Sklad" }} title={d.product.name} subtitle={`${d.product.code} · birlik: ${u}`} />
      {d.shortage > 0 && <Callout tone="danger" title="Zayavkalarga tayyor mahsulot yetishmaydi">Band qilingan miqdor qoldiqdan {qty(d.shortage)} {u} ko'p — ishlab chiqarish rejalashtiring.</Callout>}

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatCard label="Jami tayyor" value={`${qty(d.total)} ${u}`} icon={Boxes} tone="brand" />
        <StatCard label="Egasi bor" value={`${qty(d.owned)} ${u}`} hint={`${d.owners.length} ta zayavka`} icon={UserCheck} tone="info" />
        <StatCard label="Egasi yo'q" value={`${qty(d.free)} ${u}`} hint="sotuvga tayyor" icon={PackageOpen} tone="success" />
        <StatCard label="Yetishmaydi" value={`${qty(d.shortage)} ${u}`} icon={AlertTriangle} tone={d.shortage ? "danger" : "default"} />
      </div>

      <Card padded={false} className="mt-5">
        <div className="px-5 pt-5"><CardHeader title="Kimniki" description="Har bir qator — zayavkaga band qilingan mahsulot. Oxirgi qator — egasi yo'q (erkin) qoldiq." icon={UserCheck} /></div>
        <table className="w-full text-sm">
          <thead><tr><Th>Egasi</Th><Th>Zayavka</Th><Th>Telefon</Th><Th>Yetkazish</Th><Th right>Buyurtma</Th><Th right>Jo'natildi</Th><Th right>Band</Th><Th>Holat</Th></tr></thead>
          <tbody>
            {d.owners.map((o) => (
              <Tr key={o.orderId}>
                <Td className="whitespace-nowrap">{o.customer}</Td>
                <Td><Link href={`/orders/${o.orderId}`} className="whitespace-nowrap hover:underline">{o.orderNo}</Link></Td>
                <Td>{o.phone ?? "—"}</Td><Td>{date(o.deliveryDate)}</Td>
                <Td right>{qty(o.qty)}</Td><Td right className="text-slate-500">{qty(o.shipped)}</Td>
                <Td right className="font-semibold text-blue-700">{qty(o.reserved)}</Td>
                <Td><OrderStatusBadge status={o.status} /></Td>
              </Tr>
            ))}
            <tr className="bg-emerald-50/60">
              <Td className="font-semibold text-emerald-800">Egasi yo'q</Td><Td colSpan={5} className="text-emerald-700">Erkin — istalgan mijozga sotish mumkin</Td>
              <Td right className="font-semibold text-emerald-700">{qty(d.free)}</Td><Td><Badge color="green">Erkin</Badge></Td>
            </tr>
            <tr className="bg-slate-50/70">
              <Td className="font-semibold">Jami</Td><Td colSpan={5} />
              <Td right className="whitespace-nowrap font-semibold">{qty(d.total)} {u}</Td><Td />
            </tr>
          </tbody>
        </table>
      </Card>

      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card padded={false}>
          <div className="px-5 pt-5"><CardHeader title="Ishlab chiqarilgan partiyalar" icon={Factory} /></div>
          <table className="w-full text-sm">
            <thead><tr><Th>№</Th><Th>Sana</Th><Th right>Miqdor</Th><Th>Zayavka</Th><Th>Kim</Th></tr></thead>
            <tbody>
              {d.batches.length === 0 && <Empty text="Hali ishlab chiqarilmagan" icon={Factory} />}
              {d.batches.map((b) => <Tr key={b.id}><Td><Link href={`/production/${b.id}`} className="hover:underline">{b.batchNo}</Link></Td><Td>{date(b.date)}</Td><Td right>{qty(b.qtyM3)}</Td><Td>{b.order ? <Link href={`/orders/${b.order.id}`} className="hover:underline">{b.order.orderNo}</Link> : <span className="text-slate-400">sklad uchun</span>}</Td><Td>{b.createdBy.fullName}</Td></Tr>)}
            </tbody>
          </table>
        </Card>
        <Card padded={false}>
          <div className="px-5 pt-5"><CardHeader title="Harakat tarixi" icon={History} /></div>
          <table className="w-full text-sm">
            <thead><tr><Th>Vaqt</Th><Th>Turi</Th><Th right>Miqdor</Th><Th>Kim</Th></tr></thead>
            <tbody>
              {d.moves.length === 0 && <Empty text="Harakat yo'q" icon={History} />}
              {d.moves.map((m) => <Tr key={m.id}><Td className="whitespace-nowrap font-normal">{dateTime(m.createdAt)}</Td><Td>{MOVE[m.type] ?? m.type}</Td><Td right className={Number(m.qty) < 0 ? "text-red-600" : "text-emerald-700"}>{Number(m.qty) > 0 ? "+" : ""}{qty(m.qty)}</Td><Td>{m.createdBy.fullName}</Td></Tr>)}
            </tbody>
          </table>
        </Card>
      </div>
    </div>
  );
}
