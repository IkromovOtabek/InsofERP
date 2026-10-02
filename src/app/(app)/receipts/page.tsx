import Link from "next/link";
import { Plus, ScanLine } from "lucide-react";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { date, money } from "@/lib/format";
import { Empty, LinkButton, PageHeader, Table, Td, Th, Tr } from "@/components/ui";

export default async function ReceiptsPage() {
  const s = await getSession();
  const canCreate = ["PROCUREMENT", "WAREHOUSE", "DIRECTOR"].includes(s?.role ?? "");
  const receipts = await db.goodsReceipt.findMany({ orderBy: { date: "desc" }, take: 200, include: { supplier: true, warehouse: true, createdBy: true, items: { include: { material: true } } } });
  return (
    <div>
      <PageHeader title="Kirim" subtitle={canCreate ? undefined : "Sklad xodimlari kiritgan kirimlar — kim, nima, qancha. Faqat ko'rish."} action={canCreate ? <div className="flex flex-wrap gap-2"><LinkButton href="/receipts/import" variant="secondary"><ScanLine size={16} /> Nakladnoy skaneri / Excel</LinkButton><LinkButton href="/receipts/new"><Plus size={16} /> Kirim</LinkButton></div> : undefined} />
      <Table>
        <thead><tr><Th>№</Th><Th>Sana</Th><Th>Yetkazuvchi</Th><Th>Sklad</Th><Th>Tarkib</Th><Th right>Summa</Th><Th>Kim kiritdi</Th></tr></thead>
        <tbody>
          {receipts.length === 0 && <Empty text="Kirimlar yo'q" />}
          {receipts.map((r) => (
            <Tr key={r.id}>
              <Td><Link href={`/receipts/${r.id}`} className="font-medium hover:underline">{r.docNo}</Link></Td>
              <Td>{date(r.date)}</Td><Td>{r.supplier.name}</Td><Td>{r.warehouse.name}</Td>
              <Td className="text-slate-600">{r.items.map((i) => `${i.material.name} ${Number(i.qty)} ${i.material.unit}`).join(", ")}</Td>
              <Td right>{money(r.items.reduce((s, i) => s + Number(i.qty) * Number(i.price), 0))}</Td>
              <Td className="text-slate-600">{r.createdBy?.fullName ?? "—"}</Td>
            </Tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}
