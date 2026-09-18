import Link from "next/link";
import { notFound } from "next/navigation";
import { Wallet, ClipboardList, CreditCard, ArrowRight } from "lucide-react";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { customerDebt, customerOpenOrdersTotal } from "@/lib/finance";
import { money, date } from "@/lib/format";
import { Card, CardHeader, Empty, PageHeader, StatCard, Td, Th, Tr } from "@/components/ui";
import { CustomerForm } from "../customer-form";
import { OrderStatusBadge } from "../../orders/status";

export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await requireSession(["SALES", "ACCOUNTING", "FINANCE"]);
  const c = await db.customer.findUnique({ where: { id }, include: { orders: { orderBy: { date: "desc" }, take: 10, include: { items: true } } } });
  if (!c) notFound();
  const [debt, open] = await Promise.all([customerDebt(id), customerOpenOrdersTotal(id)]);
  const limit = Number(c.creditLimit);
  const free = limit - debt - open;

  return (
    <div>
      <PageHeader back={{ href: "/customers", label: "Mijozlar" }} title={c.name} subtitle={[c.inn && `INN ${c.inn}`, c.phone].filter(Boolean).join(" · ") || undefined} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label="Qarz (debitorka)" value={money(debt)} icon={Wallet} tone={debt > 0 ? "danger" : "success"} />
        <StatCard label="Ochiq zayavkalar" value={money(open)} icon={ClipboardList} hint="schyot yozilmagan" />
        <StatCard label="Bo'sh limit" value={money(free)} icon={CreditCard} tone={free < 0 ? "danger" : "info"} hint={`limit ${money(limit)}`} />
      </div>

      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Ma'lumotlar" />
          <CustomerForm customer={{ ...c, creditLimit: c.creditLimit.toString() }} canEditLimit={["FINANCE", "DIRECTOR"].includes(s.role)} />
        </Card>
        <Card padded={false}>
          <div className="px-5 pt-5"><CardHeader title="So'nggi zayavkalar" action={<Link href={`/orders?customer=${id}`} className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-900">Hammasi <ArrowRight size={14} /></Link>} /></div>
          <table className="w-full text-sm">
            <thead><tr><Th>№</Th><Th>Sana</Th><Th right>Summa</Th><Th>Holat</Th></tr></thead>
            <tbody>
              {c.orders.length === 0 && <Empty text="Zayavkalar yo'q" icon={ClipboardList} />}
              {c.orders.map((o) => (
                <Tr key={o.id}>
                  <Td><Link href={`/orders/${o.id}`} className="hover:underline">{o.orderNo}</Link></Td>
                  <Td>{date(o.deliveryDate)}</Td>
                  <Td right>{money(o.items.reduce((s, i) => s + Number(i.qtyM3) * Number(i.price), 0))}</Td>
                  <Td><OrderStatusBadge status={o.status} /></Td>
                </Tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
    </div>
  );
}
