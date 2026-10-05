import Link from "next/link";
import { Plus, Wallet } from "lucide-react";
import { db } from "@/lib/db";
import { customerMarks } from "@/lib/finance";
import { CustomerName } from "@/components/customer-name";
import { getSession } from "@/lib/auth";
import { money, date } from "@/lib/format";
import { Badge, Empty, LinkButton, PageHeader, Table, Td, Th, Tr, Tabs, StatCard } from "@/components/ui";
import { ConfirmButton } from "../payments/confirm-button";
import { INVOICE_STATUS, InvoiceStatusBadge } from "./status";
import { cancelInvoice } from "./actions";
import type { InvoiceStatus } from "@/generated/prisma";
import { receivablesReport } from "@/lib/receivables";

export default async function InvoicesPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status } = await searchParams;
  const s = await getSession();
  const [invoices, recv] = await Promise.all([
    db.invoice.findMany({
      where: status && status in INVOICE_STATUS ? { status: status as InvoiceStatus } : undefined,
      orderBy: { date: "desc" }, take: 300,
      include: { customer: true, order: true, payments: true },
    }),
    // Jami debitorka — yagona hisob: schyotlar − barcha to'lovlar (schyotga bog'lanmagan avans ham ayiriladi)
    receivablesReport(),
  ]);
  const marks = await customerMarks(invoices.map((i) => i.customerId));
  const receivable = recv.total;
  const tabs: Array<[string, string]> = [["", "Hammasi"], ...Object.entries(INVOICE_STATUS).map(([k, v]) => [k, v.label] as [string, string])];
  const canCancel = ["ACCOUNTING", "DIRECTOR"].includes(s?.role ?? "");
  // Schyot yozish — server ruxsatiga mos (buxgalteriya, sotuv, direktor); moliya faqat ko'radi
  const canCreate = ["ACCOUNTING", "SALES", "DIRECTOR"].includes(s?.role ?? "");

  return (
    <div>
      <PageHeader title="Schyotlar" action={canCreate ? <LinkButton href="/invoices/new"><Plus size={16} /> Schyot</LinkButton> : undefined} />
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3"><StatCard label="Jami debitorka" value={money(receivable)} icon={Wallet} tone={receivable > 0 ? "danger" : "success"} hint={[`${recv.debtors} ta qarzdor`, recv.overdue > 0 ? `muddati o'tgan ${money(recv.overdue)}` : "", recv.advance > 0.005 ? `avans ${money(recv.advance)}` : ""].filter(Boolean).join(" · ")} /></div>
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
                <Td>{i.order ? <Link href={`/orders/${i.order.id}`} className="hover:underline">{i.order.orderNo}</Link> : i.isOpening ? <Badge color="blue" dot={false}>Boshlang&apos;ich qoldiq</Badge> : "—"}</Td>
                <Td right>{money(i.amount)}</Td><Td right>{money(paid)}</Td>
                <Td right className={Number(i.amount) - paid > 0 && i.status !== "CANCELLED" ? "text-red-600" : ""}>{i.status === "CANCELLED" ? "—" : money(Number(i.amount) - paid)}</Td>
                <Td><InvoiceStatusBadge status={i.status} /></Td>
                <Td>{i.status === "OPEN" && paid === 0 && canCancel && !i.isOpening && <ConfirmButton action={cancelInvoice.bind(null, i.id)} label="Bekor" question={`${i.invoiceNo} bekor qilinsinmi?`} reason="optional" okText="Bekor qilindi" className="h-7 px-2 text-xs" />}</Td>
              </Tr>
            );
          })}
        </tbody>
      </Table>
    </div>
  );
}
