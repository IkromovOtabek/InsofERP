import Link from "next/link";
import { Wallet, CheckCircle2, Clock, FileText } from "lucide-react";
import { db } from "@/lib/db";
import { customerMarks } from "@/lib/finance";
import { CustomerName } from "@/components/customer-name";
import { getSession } from "@/lib/auth";
import { money, deliveryAt, isoDate } from "@/lib/format";
import { fmtUnitTotals } from "@/lib/unit";
import { Button, Empty, Input, PageHeader, StatCard, Table, Td, Th, Tr, Tabs } from "@/components/ui";
import { ORDER_STATUS, OrderStatusBadge, SALES_STATUSES } from "../orders/status";
import { StockSnapshotCard } from "@/components/stock-snapshot";
import type { Prisma, OrderStatus } from "@/generated/prisma";
import { receivablesReport } from "@/lib/receivables";

export default async function SalesPage({ searchParams }: { searchParams: Promise<{ status?: string; customer?: string; from?: string; to?: string }> }) {
  const { status, customer, from: fromQ, to: toQ } = await searchParams;
  const s = await getSession();
  const st = status && SALES_STATUSES.includes(status as OrderStatus) ? (status as OrderStatus) : undefined;
  // Davr — zayavka sanasi bo'yicha; sukut: joriy oy
  const now = new Date();
  const parsed = (v: string | undefined) => { const d = v ? new Date(v) : null; return d && Number.isFinite(d.getTime()) ? d : null; };
  const from = parsed(fromQ) ?? new Date(now.getFullYear(), now.getMonth(), 1);
  const to = parsed(toQ) ?? new Date(now); to.setHours(23, 59, 59, 999);
  const orderWhere: Prisma.OrderWhereInput = { kind: "SALE", status: st ?? { in: SALES_STATUSES }, date: { gte: from, lte: to }, ...(customer ? { customerId: customer } : {}) };

  const statuses = st ? [st] : SALES_STATUSES;
  const [orders, totalRow, paidAgg, recv, noInvoice] = await Promise.all([
    db.order.findMany({
      where: orderWhere,
      orderBy: [{ updatedAt: "desc" }],
      include: {
        customer: true, items: { include: { product: true } },
        invoices: { where: { status: { not: "CANCELLED" } }, include: { payments: { select: { amount: true } } } },
        payments: { where: { invoiceId: null }, select: { amount: true } }, // avanslar (schyotga hali bog'lanmagan)
      },
      take: 200,
    }),
    // KPI butun davr bo'yicha (ro'yxatdagi 200 qator emas)
    db.$queryRaw<{ total: unknown; n: bigint }[]>`
      SELECT COALESCE(SUM(i."qtyM3" * i."price"), 0) AS total, COUNT(DISTINCT o."id") AS n
      FROM "OrderItem" i JOIN "Order" o ON o."id" = i."orderId"
      WHERE o."kind"::text = 'SALE' AND o."status"::text = ANY(${statuses as string[]})
        AND o."date" >= ${from} AND o."date" <= ${to}
        AND (${customer ?? null}::text IS NULL OR o."customerId" = ${customer ?? null}::text)`,
    // To'langan: schyot to'lovlari + schyotsiz avanslar
    db.payment.aggregate({
      where: { OR: [{ invoice: { status: { not: "CANCELLED" }, order: orderWhere } }, { invoiceId: null, order: orderWhere }] },
      _sum: { amount: true },
    }),
    // Debitorka — joriy holat, yagona hisob (schyotlar − barcha to'lovlar, schyotsiz avans ham); davrga bog'liq emas
    receivablesReport(customer ? { ids: [customer] } : {}),
    // Schyot yozilmagan (yopilganidan tashqari) tasdiqlangan zayavkalar
    db.order.count({ where: { ...orderWhere, status: { in: statuses.filter((x) => x !== "CLOSED") }, invoices: { none: { status: { not: "CANCELLED" } } } } }),
  ]);
  const marks = await customerMarks(orders.map((o) => o.customerId));
  const rows = orders.map((o) => {
    // Hajm mahsulot birligida (beton m³, ustun dona) — zayavka kartochkasi bilan bir xil
    const vol = fmtUnitTotals(o.items.map((i) => ({ unit: i.product.unit, qty: i.qtyM3 })));
    const sum = o.items.reduce((s, i) => s + Number(i.qtyM3) * Number(i.price), 0);
    // To'langan = schyot to'lovlari + zayavkaga olingan avans (hali schyotga bog'lanmagan)
    const paid = o.invoices.reduce((s, i) => s + i.payments.reduce((p, x) => p + Number(x.amount), 0), 0)
      + o.payments.reduce((p, x) => p + Number(x.amount), 0);
    return { o, vol, sum, paid };
  });
  const total = Number(totalRow[0]?.total ?? 0);
  const count = Number(totalRow[0]?.n ?? 0);
  const paid = Number(paidAgg._sum.amount ?? 0);
  const receivable = recv.total;
  const canInvoice = ["ACCOUNTING", "SALES", "DIRECTOR"].includes(s?.role ?? "");
  const period = (k: string) => `${k ? `status=${k}&` : ""}from=${isoDate(from)}&to=${isoDate(to)}${customer ? `&customer=${customer}` : ""}`;

  const tabs = [{ key: "", label: "Hammasi", href: `/sales?${period("")}` }, ...SALES_STATUSES.map((k) => ({ key: k, label: ORDER_STATUS[k].label, href: `/sales?${period(k)}` }))];

  return (
    <div>
      <PageHeader title="Sotuv" subtitle="Qabul qilingan zayavkalar. Yangi zayavka Zayavkalar bo'limida yaratiladi va qabul qilingach shu yerga o'tadi." />
      <div className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatCard label="Sotuv summasi (davr)" value={money(total)} icon={Wallet} hint={`${count} ta zayavka`} />
        <StatCard label="To'langan" value={money(paid)} icon={CheckCircle2} tone="success" hint="schyot to'lovlari + avanslar" />
        <StatCard label="Debitorka (joriy)" value={money(receivable)} icon={Clock} tone={receivable > 0 ? "danger" : "success"} hint={[recv.overdue > 0 ? `muddati o'tgan ${money(recv.overdue)}` : `${recv.debtors} ta qarzdor`, recv.advance > 0.005 ? `avans ${money(recv.advance)}` : ""].filter(Boolean).join(" · ")} />
        <StatCard label="Schyot yozilmagan" value={String(noInvoice)} icon={FileText} tone={noInvoice > 0 ? "warning" : "default"} hint="tasdiqlangan, schyotsiz" href={canInvoice ? "/invoices/new" : undefined} />
      </div>
      <form className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        {st && <input type="hidden" name="status" value={st} />}
        {customer && <input type="hidden" name="customer" value={customer} />}
        <Input name="from" type="date" defaultValue={isoDate(from)} className="h-9 w-40" aria-label="Davr boshi" />
        <span className="text-slate-400">—</span>
        <Input name="to" type="date" defaultValue={isoDate(to)} className="h-9 w-40" aria-label="Davr oxiri" />
        <Button variant="secondary" className="h-9 text-sm">Ko&apos;rsatish</Button>
        {(fromQ || toQ) && <Link href={st ? `/sales?status=${st}` : "/sales"} className="text-xs text-slate-500 hover:underline">joriy oy</Link>}
      </form>
      <Tabs current={st ?? ""} items={tabs} />
      {count > rows.length && <p className="mb-2 text-xs text-slate-500">Ro&apos;yxatda oxirgi {rows.length} ta zayavka (davrda {count} ta) — ko&apos;rsatkichlar butun davr bo&apos;yicha.</p>}
      <Table>
        <thead><tr><Th>№</Th><Th>Yetkazish</Th><Th>Mijoz</Th><Th>Mahsulot</Th><Th right>Hajm</Th><Th right>Summa</Th><Th right>To'langan</Th><Th>Holat</Th></tr></thead>
        <tbody>
          {rows.length === 0 && <Empty text="Qabul qilingan zayavkalar yo'q" />}
          {rows.map(({ o, vol, sum, paid }) => (
            <Tr key={o.id}>
              <Td><Link href={`/orders/${o.id}`} className="font-medium hover:underline">{o.orderNo}</Link></Td>
              <Td className="whitespace-nowrap">{deliveryAt(o.deliveryDate, o.deliveryTime)}</Td>
              <Td><CustomerName name={o.customer.name} blacklisted={marks.black.has(o.customerId)} contracted={marks.contract.has(o.customerId)} href={`/customers/${o.customerId}`} /></Td>
              <Td>{o.items.map((i) => i.product.code).join(", ")}{o.needsPump && " · nasos"}{!o.needsDelivery && " · o'zi oladi"}{o.isUrgent && <span className="ml-1 rounded bg-red-50 px-1.5 py-0.5 text-[11px] font-medium text-red-700">zarur</span>}{o.onCredit && <span className="ml-1 rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-700">qarzga</span>}</Td>
              <Td right className="whitespace-nowrap">{vol}</Td>
              <Td right className="whitespace-nowrap">{money(sum)}</Td>
              <Td right className={"whitespace-nowrap " + (paid >= sum && sum > 0 ? "text-emerald-700" : paid > 0 ? "text-amber-700" : "text-slate-400")}>{money(paid)}</Td>
              <Td><OrderStatusBadge status={o.status} /></Td>
            </Tr>
          ))}
        </tbody>
      </Table>

      <div className="mt-6">
        <StockSnapshotCard show={["pieces"]} />
      </div>
    </div>
  );
}
