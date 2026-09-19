import Link from "next/link";
import { Wallet, CheckCircle2, Clock, FileText } from "lucide-react";
import { db } from "@/lib/db";
import { customerMarks } from "@/lib/finance";
import { CustomerName } from "@/components/customer-name";
import { getSession } from "@/lib/auth";
import { money, qty, deliveryAt } from "@/lib/format";
import { Empty, PageHeader, StatCard, Table, Td, Th, Tr, Tabs } from "@/components/ui";
import { ORDER_STATUS, OrderStatusBadge, SALES_STATUSES } from "../orders/status";
import { StockSnapshotCard } from "@/components/stock-snapshot";
import type { OrderStatus } from "@/generated/prisma";

export default async function SalesPage({ searchParams }: { searchParams: Promise<{ status?: string; customer?: string }> }) {
  const { status, customer } = await searchParams;
  const s = await getSession();
  const st = status && SALES_STATUSES.includes(status as OrderStatus) ? (status as OrderStatus) : undefined;
  const orders = await db.order.findMany({
    where: { status: st ?? { in: SALES_STATUSES }, ...(customer ? { customerId: customer } : {}) },
    orderBy: [{ updatedAt: "desc" }],
    include: { customer: true, items: { include: { product: true } }, invoices: { where: { status: { not: "CANCELLED" } }, include: { payments: true } } },
    take: 200,
  });
  const marks = await customerMarks(orders.map((o) => o.customerId));
  const rows = orders.map((o) => {
    const m3 = o.items.reduce((s, i) => s + Number(i.qtyM3), 0);
    const sum = o.items.reduce((s, i) => s + Number(i.qtyM3) * Number(i.price), 0);
    const invoiced = o.invoices.reduce((s, i) => s + Number(i.amount), 0);
    const paid = o.invoices.reduce((s, i) => s + i.payments.reduce((p, x) => p + Number(x.amount), 0), 0);
    return { o, m3, sum, invoiced, paid };
  });
  const total = rows.reduce((a, r) => a + r.sum, 0);
  const paid = rows.reduce((a, r) => a + r.paid, 0);
  const receivable = rows.reduce((a, r) => a + Math.max(0, r.invoiced - r.paid), 0);
  const noInvoice = rows.filter((r) => r.o.invoices.length === 0 && r.o.status !== "CLOSED").length;
  const canInvoice = ["ACCOUNTING", "SALES", "DIRECTOR"].includes(s?.role ?? "");

  const tabs = [{ key: "", label: "Hammasi", href: "/sales" }, ...SALES_STATUSES.map((k) => ({ key: k, label: ORDER_STATUS[k].label, href: `/sales?status=${k}` }))];

  return (
    <div>
      <PageHeader title="Sotuv" subtitle="Qabul qilingan zayavkalar. Yangi zayavka Zayavkalar bo'limida yaratiladi va qabul qilingach shu yerga o'tadi." />
      <div className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatCard label="Sotuv summasi" value={money(total)} icon={Wallet} hint={`${rows.length} ta zayavka`} />
        <StatCard label="To'langan" value={money(paid)} icon={CheckCircle2} tone="success" />
        <StatCard label="Debitorka (schyot bo'yicha)" value={money(receivable)} icon={Clock} tone={receivable > 0 ? "danger" : "success"} />
        <StatCard label="Schyot yozilmagan" value={String(noInvoice)} icon={FileText} tone={noInvoice > 0 ? "warning" : "default"} hint="tasdiqlangan, schyotsiz" href={canInvoice ? "/invoices/new" : undefined} />
      </div>
      <Tabs current={st ?? ""} items={tabs} />
      <Table>
        <thead><tr><Th>№</Th><Th>Yetkazish</Th><Th>Mijoz</Th><Th>Mahsulot</Th><Th right>Hajm</Th><Th right>Summa</Th><Th right>To'langan</Th><Th>Holat</Th></tr></thead>
        <tbody>
          {rows.length === 0 && <Empty text="Qabul qilingan zayavkalar yo'q" />}
          {rows.map(({ o, m3, sum, paid }) => (
            <Tr key={o.id}>
              <Td><Link href={`/orders/${o.id}`} className="font-medium hover:underline">{o.orderNo}</Link></Td>
              <Td>{deliveryAt(o.deliveryDate, o.deliveryTime)}</Td>
              <Td><CustomerName name={o.customer.name} blacklisted={marks.black.has(o.customerId)} contracted={marks.contract.has(o.customerId)} href={`/customers/${o.customerId}`} /></Td>
              <Td>{o.items.map((i) => i.product.code).join(", ")}{o.needsPump && " · nasos"}{!o.needsDelivery && " · o'zi oladi"}{o.isUrgent && <span className="ml-1 rounded bg-red-50 px-1.5 py-0.5 text-[11px] font-medium text-red-700">zarur</span>}{o.onCredit && <span className="ml-1 rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-700">qarzga</span>}</Td>
              <Td right>{qty(m3)}</Td>
              <Td right>{money(sum)}</Td>
              <Td right className={paid >= sum && sum > 0 ? "text-emerald-700" : paid > 0 ? "text-amber-700" : "text-slate-400"}>{money(paid)}</Td>
              <Td><OrderStatusBadge status={o.status} /></Td>
            </Tr>
          ))}
        </tbody>
      </Table>

      <div className="mt-6">
        <StockSnapshotCard />
      </div>
    </div>
  );
}
