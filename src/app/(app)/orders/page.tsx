import Link from "next/link";
import { Plus, ArrowRight } from "lucide-react";
import { db } from "@/lib/db";
import { customerMarks } from "@/lib/finance";
import { CustomerName } from "@/components/customer-name";
import { money, date, qty, deliveryAt } from "@/lib/format";
import { Empty, LinkButton, PageHeader, Table, Td, Th, Tr, Tabs } from "@/components/ui";
import { ORDER_STATUS, OrderStatusBadge, PENDING_STATUSES as PENDING } from "./status";
import type { OrderStatus } from "@/generated/prisma";

export default async function OrdersPage({ searchParams }: { searchParams: Promise<{ status?: string; customer?: string }> }) {
  const { status, customer } = await searchParams;
  const st = status && PENDING.includes(status as OrderStatus) ? (status as OrderStatus) : undefined;
  const orders = await db.order.findMany({
    where: { status: st ?? { in: PENDING }, ...(customer ? { customerId: customer } : {}) },
    orderBy: [{ createdAt: "desc" }],
    include: { customer: true, createdBy: true, items: { include: { product: true } } },
    take: 200,
  });
  const marks = await customerMarks(orders.map((o) => o.customerId));
  const tabs = [{ key: "", label: "Hammasi", href: "/orders" }, ...PENDING.map((k) => ({ key: k, label: ORDER_STATUS[k].label, href: `/orders?status=${k}` }))];

  return (
    <div>
      <PageHeader
        title="Zayavkalar"
        subtitle="Yangi kiritilgan va qabul qilinmagan zayavkalar. Qabul qilingach zayavka Sotuv bo'limiga o'tadi."
        action={<div className="flex flex-wrap gap-2"><LinkButton href="/sales" variant="secondary">Sotuv <ArrowRight size={16} /></LinkButton><LinkButton href="/orders/new"><Plus size={16} /> Yangi zayavka</LinkButton></div>}
      />
      <Tabs current={st ?? ""} items={tabs} />
      <Table>
        <thead><tr><Th>№</Th><Th>Kiritildi</Th><Th>Yetkazish</Th><Th>Mijoz</Th><Th>Mahsulot</Th><Th right>Hajm</Th><Th right>Summa</Th><Th>Kim</Th><Th>Holat</Th></tr></thead>
        <tbody>
          {orders.length === 0 && <Empty text="Kutayotgan zayavkalar yo'q" />}
          {orders.map((o) => {
            const m3 = o.items.reduce((s, i) => s + Number(i.qtyM3), 0);
            const sum = o.items.reduce((s, i) => s + Number(i.qtyM3) * Number(i.price), 0);
            return (
              <Tr key={o.id}>
                <Td><Link href={`/orders/${o.id}`} className="font-medium hover:underline">{o.orderNo}</Link></Td>
                <Td>{date(o.date)}</Td>
                <Td>{deliveryAt(o.deliveryDate, o.deliveryTime)}</Td>
                <Td><CustomerName name={o.customer.name} blacklisted={marks.black.has(o.customerId)} contracted={marks.contract.has(o.customerId)} href={`/customers/${o.customerId}`} /></Td>
                <Td>{o.items.map((i) => i.product.code).join(", ")}{o.needsPump && " · nasos"}{!o.needsDelivery && " · o'zi oladi"}{o.isUrgent && <span className="ml-1 rounded bg-red-50 px-1.5 py-0.5 text-[11px] font-medium text-red-700">zarur</span>}{o.onCredit && <span className="ml-1 rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-700">qarzga</span>}</Td>
                <Td right>{qty(m3)}</Td>
                <Td right>{money(sum)}</Td>
                <Td className="text-slate-500">{o.createdBy.fullName}</Td>
                <Td><OrderStatusBadge status={o.status} /></Td>
              </Tr>
            );
          })}
        </tbody>
      </Table>
    </div>
  );
}
