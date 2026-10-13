import Link from "next/link";
import { Plus, ScanLine, Sheet as SheetIcon } from "lucide-react";
import { db } from "@/lib/db";
import { requirePage } from "@/lib/page-guard";
import { date, money } from "@/lib/format";
import { receiptAmounts } from "@/lib/receipt-vat";
import { resolveReceiptPayments, waybillFromNote } from "@/lib/receipts";
import { Badge, Empty, LinkButton, PageHeader, Table, Td, Th, Tr } from "@/components/ui";

export default async function ReceiptsPage() {
  const s = await requirePage("/receipts");
  const canCreate = ["PROCUREMENT", "WAREHOUSE", "DIRECTOR"].includes(s?.role ?? "");
  const receipts = await db.goodsReceipt.findMany({ orderBy: { date: "desc" }, take: 200, include: { supplier: true, warehouse: true, createdBy: true, buyer: { select: { fullName: true } }, items: { include: { material: true } } } });
  // To'lov turi (Деньги): kirimda belgilangani, bo'lmasa bog'langan to'lov hisobining turi — «Приход» jurnali bilan bir xil
  const pays = await resolveReceiptPayments(receipts.map((r) => ({ id: r.id, payment: r.payment })));
  return (
    <div>
      <PageHeader title="Kirim" subtitle={canCreate ? undefined : "Sklad xodimlari kiritgan kirimlar — kim, nima, qancha. Faqat ko'rish."} action={canCreate ? <div className="flex flex-wrap gap-2"><LinkButton href="/stock/prixod" variant="secondary"><SheetIcon size={16} /> Jurnal (Приход)</LinkButton><LinkButton href="/receipts/import" variant="secondary"><ScanLine size={16} /> Nakladnoy skaneri / Excel</LinkButton><LinkButton href="/receipts/new"><Plus size={16} /> Kirim</LinkButton></div> : undefined} />
      <Table>
        <thead><tr><Th>№</Th><Th>Sana</Th><Th>Yetkazuvchi</Th><Th>Sklad</Th><Th>Tarkib</Th><Th>Nakladnoy</Th><Th>To&apos;lov</Th><Th right>QQS</Th><Th right>Jami (QQS bilan)</Th><Th>Kim kiritdi</Th></tr></thead>
        <tbody>
          {receipts.length === 0 && <Empty text="Kirimlar yo'q" />}
          {receipts.map((r) => {
            const a = receiptAmounts(r.items);
            const pay = pays.get(r.id) ?? null;
            const buyer = r.buyer?.fullName;
            return (
              <Tr key={r.id}>
                <Td><Link href={`/receipts/${r.id}`} className="font-medium hover:underline">{r.docNo}</Link>{r.cancelledAt && <> <Badge color="red">Storno</Badge></>}</Td>
                <Td>{date(r.date)}</Td><Td>{r.supplier.name}</Td><Td>{r.warehouse.name}</Td>
                <Td className="text-slate-600">{r.items.map((i) => `${i.material.name} ${Number(i.qty)} ${i.material.unit}`).join(", ")}</Td>
                <Td className="whitespace-nowrap text-slate-600">{r.waybillNo ?? waybillFromNote(r.note) ?? "—"}</Td>
                <Td>{pay ? <Badge color={pay === "BANK" ? "blue" : "amber"} dot={false}>{pay === "BANK" ? "O'tkazma" : "Naqd"}</Badge> : <span className="text-slate-400">—</span>}</Td>
                <Td right className="text-slate-500">{money(a.vat)}</Td>
                <Td right>{money(a.total)}{a.delivery > 0 && <div className="text-xs text-slate-500">dostavka {money(a.delivery)}</div>}</Td>
                <Td className="text-slate-600">{r.createdBy?.fullName ?? "—"}{buyer && buyer !== r.createdBy?.fullName && <div className="text-xs text-slate-500">snab.: {buyer}</div>}</Td>
              </Tr>
            );
          })}
        </tbody>
      </Table>
    </div>
  );
}
