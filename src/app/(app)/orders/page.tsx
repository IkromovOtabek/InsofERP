import Link from "next/link";
import { Plus } from "lucide-react";
import { db } from "@/lib/db";
import { money, date, qty } from "@/lib/format";
import { Empty, LinkButton, PageHeader, Table, Td, Th, Tr, Tabs } from "@/components/ui";
import { ORDER_STATUS, OrderStatusBadge } from "./status";
import type { OrderStatus } from "@/generated/prisma";

export default async function OrdersPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status } = await searchParams;
  const orders = await db.order.findMany({
    where: status && status in ORDER_STATUS ? { status: status as OrderStatus } : undefined,
    orderBy: [{ deliveryDate: "desc" }, { createdAt: "desc" }],
    include: { customer: true, items: { include: { product: true } } },
    take: 200,
  });
  const tabs: Array<[string, string]> = [["", "Hammasi"], ...Object.entries(ORDER_STATUS).map(([k, v]) => [k, v.label] as [string, string])];

  return (
    <div>
      <PageHeader title="Zayavkalar" action={<LinkButton href="/orders/new"><Plus size={16} /> Yangi zayavka</LinkButton>} />
      <Tabs current={status ?? ""} items={tabs.map(([k, label]) => ({ key: k, label, href: k ? `/orders?status=${k}` : "/orders" }))} />
      <Table>
        <thead><tr><Th>№</Th><Th>Yetkazish</Th><Th>Mijoz</Th><Th>Mahsulot</Th><Th right>m³</Th><Th right>Summa</Th><Th>Holat</Th></tr></thead>
        <tbody>
          {orders.length === 0 && <Empty text="Zayavkalar yo'q" />}
          {orders.map((o) => {
            const m3 = o.items.reduce((s, i) => s + Number(i.qtyM3), 0);
            const sum = o.items.reduce((s, i) => s + Number(i.qtyM3) * Number(i.price), 0);
            return (
              <Tr key={o.id}>
                <Td><Link href={`/orders/${o.id}`} className="font-medium hover:underline">{o.orderNo}</Link></Td>
                <Td>{date(o.deliveryDate)}</Td>
                <Td>{o.customer.name}</Td>
                <Td>{o.items.map((i) => i.product.code).join(", ")}{o.needsPump && " · nasos"}</Td>
                <Td right>{qty(m3)}</Td>
                <Td right>{money(sum)}</Td>
                <Td><OrderStatusBadge status={o.status} /></Td>
              </Tr>
            );
          })}
        </tbody>
      </Table>
    </div>
  );
}
