import Link from "next/link";
import { Plus } from "lucide-react";
import { db } from "@/lib/db";
import { date, qty } from "@/lib/format";
import { unitLabel } from "@/lib/unit";
import { Empty, LinkButton, PageHeader, Table, Td, Th, Tr } from "@/components/ui";

export default async function ProductionPage() {
  const batches = await db.productionBatch.findMany({
    orderBy: { createdAt: "desc" }, take: 200,
    include: { product: true, order: { include: { customer: true } }, createdBy: true },
  });
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const todayM3 = batches.filter((b) => b.date >= today && b.product.unit === "m3").reduce((s, b) => s + Number(b.qtyM3), 0);

  return (
    <div>
      <PageHeader title="Ishlab chiqarish" subtitle={`Bugun: ${qty(todayM3)} m³`} action={<LinkButton href="/production/new"><Plus size={16} /> Zames</LinkButton>} />
      <Table>
        <thead><tr><Th>№</Th><Th>Sana</Th><Th>Smena</Th><Th>Mahsulot</Th><Th right>Miqdor</Th><Th>Zayavka</Th><Th>Kim</Th></tr></thead>
        <tbody>
          {batches.length === 0 && <Empty text="Zameslar yo'q" />}
          {batches.map((b) => (
            <Tr key={b.id}>
              <Td><Link href={`/production/${b.id}`} className="font-medium hover:underline">{b.batchNo}</Link></Td>
              <Td>{date(b.date)}</Td><Td>{b.shift}</Td><Td>{b.product.name}</Td><Td right>{qty(b.qtyM3)} <span className="text-slate-400">{unitLabel(b.product.unit)}</span></Td>
              <Td>{b.order ? <Link href={`/orders/${b.order.id}`} className="hover:underline">{b.order.orderNo} · {b.order.customer.name}</Link> : <span className="text-slate-400">—</span>}</Td>
              <Td>{b.createdBy.fullName}</Td>
            </Tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}
