import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { customerMarks } from "@/lib/finance";
import { CustomerName } from "@/components/customer-name";
import { date, qty } from "@/lib/format";
import { Card, PageHeader, Table, Td, Th, Tr } from "@/components/ui";
import { unitLabel } from "@/lib/unit";

export default async function BatchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const b = await db.productionBatch.findUnique({
    where: { id },
    include: { product: true, recipe: { include: { items: { include: { material: true } } } }, order: { include: { customer: true } }, createdBy: true },
  });
  if (!b) notFound();
  const marks = await customerMarks(b.order ? [b.order.customerId] : []);
  const moves = await db.stockMove.findMany({ where: { refType: "ProductionBatch", refId: id }, include: { material: true, product: true, warehouse: true } });

  return (
    <div>
      <PageHeader title={`Zames ${b.batchNo}`} subtitle={`${date(b.date)} · ${b.shift}-smena · ${b.createdBy.fullName}`} />
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card><div className="text-sm text-slate-500">Marka</div><div className="mt-1 text-lg font-semibold">{b.product.name}</div><div className="text-xs text-slate-500">retsept v{b.recipe.version}</div></Card>
        <Card><div className="text-sm text-slate-500">Miqdor</div><div className="mt-1 text-lg font-semibold">{qty(b.qtyM3)} {unitLabel(b.product.unit)}</div></Card>
        <Card><div className="text-sm text-slate-500">Zayavka</div><div className="mt-1 text-lg font-semibold">{b.order ? <Link href={`/orders/${b.order.id}`} className="hover:underline">{b.order.orderNo}</Link> : "—"}</div>{b.order && <div className="text-xs text-slate-500"><CustomerName name={b.order.customer.name} blacklisted={marks.black.has(b.order.customerId)} contracted={marks.contract.has(b.order.customerId)} /></div>}</Card>
      </div>
      <h2 className="mb-3 font-semibold">Sklad harakati</h2>
      <Table>
        <thead><tr><Th>Turi</Th><Th>Nomi</Th><Th right>Norma (1 {unitLabel(b.product.unit)})</Th><Th right>Miqdor</Th><Th>Sklad</Th></tr></thead>
        <tbody>
          {moves.map((m) => {
            const norm = b.recipe.items.find((i) => i.materialId === m.materialId);
            return (
              <Tr key={m.id}>
                <Td>{m.type === "PRODUCTION_CONSUME" ? "Chiqim" : "Kirim"}</Td>
                <Td>{m.material?.name ?? m.product?.name}</Td>
                <Td right>{norm ? `${qty(norm.qtyPerM3)} ${m.material?.unit}` : "—"}</Td>
                <Td right className={Number(m.qty) < 0 ? "text-red-600" : "text-emerald-700"}>{qty(m.qty)} {m.material?.unit ?? m.product?.unit}</Td>
                <Td>{m.warehouse.name}</Td>
              </Tr>
            );
          })}
        </tbody>
      </Table>
      {b.note && <p className="mt-4 text-sm text-slate-600">Izoh: {b.note}</p>}
    </div>
  );
}
