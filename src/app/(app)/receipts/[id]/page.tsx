import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { date, money, qty } from "@/lib/format";
import { Card, PageHeader, Table, Td, Th, Tr } from "@/components/ui";

export default async function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = await db.goodsReceipt.findUnique({ where: { id }, include: { supplier: true, warehouse: true, createdBy: true, items: { include: { material: true } } } });
  if (!r) notFound();
  const total = r.items.reduce((s, i) => s + Number(i.qty) * Number(i.price), 0);
  return (
    <div>
      <PageHeader back={{ href: "/receipts", label: "Kirim" }} title={`Kirim ${r.docNo}`} subtitle={`${date(r.date)} · ${r.supplier.name} → ${r.warehouse.name}${r.createdBy ? ` · kiritdi: ${r.createdBy.fullName}` : ""}`} />
      <Card className="mb-6 inline-block"><div className="text-sm text-slate-500">Jami</div><div className="mt-1 text-xl font-semibold">{money(total)}</div></Card>
      <Table>
        <thead><tr><Th>Xomashyo</Th><Th right>Miqdor</Th><Th right>Narx</Th><Th right>Summa</Th></tr></thead>
        <tbody>{r.items.map((i) => <Tr key={i.id}><Td>{i.material.name}</Td><Td right>{qty(i.qty)} {i.material.unit}</Td><Td right>{money(i.price)}</Td><Td right>{money(Number(i.qty) * Number(i.price))}</Td></Tr>)}</tbody>
      </Table>
      {r.note && <p className="mt-4 text-sm text-slate-600">Izoh: {r.note}</p>}
    </div>
  );
}
