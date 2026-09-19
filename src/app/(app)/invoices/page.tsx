import Link from "next/link";
import { Plus, Wallet } from "lucide-react";
import { db } from "@/lib/db";
import { customerMarks } from "@/lib/finance";
import { CustomerName } from "@/components/customer-name";
import { getSession } from "@/lib/auth";
import { money, date } from "@/lib/format";
import { Button, Empty, LinkButton, PageHeader, Table, Td, Th, Tr, Tabs, StatCard } from "@/components/ui";
import { INVOICE_STATUS, InvoiceStatusBadge } from "./status";
import { cancelInvoice } from "./actions";
import type { InvoiceStatus } from "@/generated/prisma";

export default async function InvoicesPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status } = await searchParams;
  const s = await getSession();
  const invoices = await db.invoice.findMany({
    where: status && status in INVOICE_STATUS ? { status: status as InvoiceStatus } : undefined,
    orderBy: { date: "desc" }, take: 300,
    include: { customer: true, order: true, payments: true },
  });
  const marks = await customerMarks(invoices.map((i) => i.customerId));
  const open = invoices.filter((i) => ["OPEN", "PARTIAL"].includes(i.status));
  const receivable = open.reduce((s, i) => s + Number(i.amount) - i.payments.reduce((p, x) => p + Number(x.amount), 0), 0);
  const tabs: Array<[string, string]> = [["", "Hammasi"], ...Object.entries(INVOICE_STATUS).map(([k, v]) => [k, v.label] as [string, string])];
  const canCancel = ["ACCOUNTING", "DIRECTOR"].includes(s?.role ?? "");

  return (
    <div>
      <PageHeader title="Schyotlar" action={<LinkButton href="/invoices/new"><Plus size={16} /> Schyot</LinkButton>} />
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3"><StatCard label="Jami debitorka (ro'yxat bo'yicha)" value={money(receivable)} icon={Wallet} tone={receivable > 0 ? "danger" : "success"} hint={`${open.length} ta ochiq schyot`} /></div>
      <Tabs current={status ?? ""} items={tabs.map(([k, l]) => ({ key: k, label: l, href: k ? `/invoices?status=${k}` : "/invoices" }))} />
      <Table>
        <thead><tr><Th>№</Th><Th>Sana</Th><Th>Mijoz</Th><Th>Zayavka</Th><Th right>Summa</Th><Th right>To'langan</Th><Th right>Qoldiq</Th><Th>Holat</Th><Th></Th></tr></thead>
        <tbody>
          {invoices.length === 0 && <Empty text="Schyotlar yo'q" />}
          {invoices.map((i) => {
            const paid = i.payments.reduce((p, x) => p + Number(x.amount), 0);
            return (
              <Tr key={i.id}>
                <Td className="font-medium">{i.invoiceNo}</Td><Td>{date(i.date)}</Td>
                <Td><CustomerName name={i.customer.name} blacklisted={marks.black.has(i.customerId)} contracted={marks.contract.has(i.customerId)} href={`/customers/${i.customerId}`} /></Td>
                <Td>{i.order ? <Link href={`/orders/${i.order.id}`} className="hover:underline">{i.order.orderNo}</Link> : "—"}</Td>
                <Td right>{money(i.amount)}</Td><Td right>{money(paid)}</Td>
                <Td right className={Number(i.amount) - paid > 0 && i.status !== "CANCELLED" ? "text-red-600" : ""}>{i.status === "CANCELLED" ? "—" : money(Number(i.amount) - paid)}</Td>
                <Td><InvoiceStatusBadge status={i.status} /></Td>
                <Td>{i.status === "OPEN" && paid === 0 && canCancel && <form action={cancelInvoice.bind(null, i.id)}><Button variant="secondary" className="px-2 py-1 text-xs">Bekor</Button></form>}</Td>
              </Tr>
            );
          })}
        </tbody>
      </Table>
    </div>
  );
}
