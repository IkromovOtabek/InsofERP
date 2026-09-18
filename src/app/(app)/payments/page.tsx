import Link from "next/link";
import { db } from "@/lib/db";
import { money, date } from "@/lib/format";
import { Card, Empty, PageHeader, Table, Td, Th, Tr } from "@/components/ui";
import { PaymentForm } from "./payment-form";

export default async function PaymentsPage() {
  const [payments, accounts, customers, openInvoices] = await Promise.all([
    db.payment.findMany({ orderBy: { date: "desc" }, take: 200, include: { customer: true, invoice: true, cashAccount: true } }),
    db.cashAccount.findMany({ where: { isActive: true }, include: { payments: { select: { amount: true } } } }),
    db.customer.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.invoice.findMany({ where: { status: { in: ["OPEN", "PARTIAL"] } }, include: { payments: true } }),
  ]);
  const invOpts = openInvoices.map((i) => ({ id: i.id, invoiceNo: i.invoiceNo, customerId: i.customerId, remaining: Number(i.amount) - i.payments.reduce((s, p) => s + Number(p.amount), 0) }));

  return (
    <div>
      <PageHeader title="Kassa / bank" />
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        {accounts.map((a) => (
          <Card key={a.id}><div className="text-sm text-slate-500">{a.name} <span className="text-xs">({a.type === "CASH" ? "naqd" : "bank"})</span></div><div className="mt-1 text-xl font-semibold">{money(a.payments.reduce((s, p) => s + Number(p.amount), 0))}</div><div className="text-xs text-slate-500">kirimlar jami</div></Card>
        ))}
      </div>
      <Card className="mb-6"><h2 className="mb-3 font-semibold">Yangi to'lov (kirim)</h2><PaymentForm customers={customers} invoices={invOpts} accounts={accounts.map((a) => ({ id: a.id, name: a.name }))} /></Card>
      <h2 className="mb-3 font-semibold">So'nggi to'lovlar</h2>
      <Table>
        <thead><tr><Th>Sana</Th><Th>Mijoz</Th><Th>Schyot</Th><Th>Kassa/hisob</Th><Th right>Summa</Th><Th>Izoh</Th></tr></thead>
        <tbody>
          {payments.length === 0 && <Empty text="To'lovlar yo'q" />}
          {payments.map((p) => (
            <Tr key={p.id}>
              <Td>{date(p.date)}</Td>
              <Td><Link href={`/customers/${p.customerId}`} className="hover:underline">{p.customer.name}</Link></Td>
              <Td>{p.invoice?.invoiceNo ?? <span className="text-slate-400">avans</span>}</Td>
              <Td>{p.cashAccount.name}</Td><Td right className="font-medium text-emerald-700">+{money(p.amount)}</Td><Td className="text-slate-500">{p.note ?? ""}</Td>
            </Tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}
