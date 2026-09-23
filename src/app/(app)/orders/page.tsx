import Link from "next/link";
import { Plus, ArrowRight, History, X, FileSpreadsheet, CheckCircle2 } from "lucide-react";
import { db } from "@/lib/db";
import { customerMarks } from "@/lib/finance";
import { CustomerName } from "@/components/customer-name";
import { money, date, qty, deliveryAt } from "@/lib/format";
import { Empty, LinkButton, PageHeader, Table, Td, Th, Tr, Tabs } from "@/components/ui";
import { StockSnapshotCard } from "@/components/stock-snapshot";
import { OrderLoadCalendar } from "./load-calendar";
import { SupplyApprovals } from "@/components/supply-approvals";
import { requireSession } from "@/lib/auth";
import { ORDER_STATUS, OrderStatusBadge, PENDING_STATUSES as PENDING } from "./status";
import type { OrderStatus } from "@/generated/prisma";

export default async function OrdersPage({ searchParams }: { searchParams: Promise<{ status?: string; customer?: string; kun?: string; imported?: string }> }) {
  const { status, customer, kun, imported } = await searchParams;
  const s = await requireSession();
  // Ta'minot zayavkasini tasdiqlash shu oynada: narx qo'yilgach ma'sul (sotuv) xodim ko'radi
  const canApproveSupply = ["SALES", "DIRECTOR"].includes(s.role);
  const st = status && PENDING.includes(status as OrderStatus) ? (status as OrderStatus) : undefined;
  // Taqvimdan kun tanlansa — o'sha kunga yetkazilishi kerak bo'lgan barcha zayavkalar (holatidan qat'i nazar)
  const day = kun && /^\d{4}-\d{2}-\d{2}$/.test(kun) ? new Date(`${kun}T00:00:00`) : null;
  const dayEnd = day ? new Date(day.getTime() + 864e5) : null;
  const orders = await db.order.findMany({
    where: day
      ? { deliveryDate: { gte: day, lt: dayEnd! }, ...(customer ? { customerId: customer } : {}) }
      : { status: st ?? { in: PENDING }, ...(customer ? { customerId: customer } : {}) },
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
        action={<div className="flex flex-wrap gap-2"><LinkButton href="/orders/tarix" variant="ghost"><History size={16} /> Tarix</LinkButton><LinkButton href="/sales" variant="secondary">Sotuv <ArrowRight size={16} /></LinkButton><LinkButton href="/orders/import" variant="secondary"><FileSpreadsheet size={16} /> Excel orqali</LinkButton><LinkButton href="/orders/new"><Plus size={16} /> Yangi zayavka</LinkButton></div>}
      />
      {/* Excel importidan keyin: nechta zayavka ochilgani — hammasi qoralama, quyidagi ro'yxatda turadi */}
      {imported && /^\d+$/.test(imported) && (
        <div className="mb-4 inline-flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-800">
          <CheckCircle2 size={16} /> Excel&apos;dan <b>{imported} ta</b> qoralama zayavka ochildi — tekshirib qabul qilasiz.
        </div>
      )}
      {/* Zayavka qabul qilayotgan xodim korxonada nima borligini shu yerda ko'radi:
          Hovlidagi dona mahsulot, beton va Skladdagi xomashyo. */}
      <div className="mb-5">
        <StockSnapshotCard layout="grid" title="Korxona qoldig'i — zayavka qabul qilishdan oldin" />
      </div>
      {canApproveSupply && <SupplyApprovals mode="sales" />}
      {/* 10 kunlik ish tartibi: qaysi kunga zayavka ko'p, qaysi kun bo'sh */}
      <OrderLoadCalendar />
      {day ? (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm">
          <span className="text-slate-600">{date(day)} kuniga yetkazish: <b className="text-slate-900">{orders.length} ta zayavka</b> · {qty(orders.reduce((s, o) => s + o.items.reduce((x, i) => x + Number(i.qtyM3), 0), 0))} m³</span>
          <Link href="/orders" className="inline-flex items-center gap-1 font-medium text-slate-600 hover:text-slate-900 hover:underline"><X size={14} /> Kun filtrini olib tashlash</Link>
        </div>
      ) : (
        <Tabs current={st ?? ""} items={tabs} />
      )}
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
