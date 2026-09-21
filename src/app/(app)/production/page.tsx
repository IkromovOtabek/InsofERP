import Link from "next/link";
import { Plus, HardHat, CheckCircle2, XCircle, Zap, Truck, Factory, ClipboardList, AlarmClock, CalendarDays, ListTodo, CheckCheck, Layers } from "lucide-react";
import { db } from "@/lib/db";
import { customerMarks } from "@/lib/finance";
import { BlacklistMark, ContractMark, CustomerName } from "@/components/customer-name";
import { date, qty, deliveryAt } from "@/lib/format";
import { unitLabel } from "@/lib/unit";
import { Badge, Card, CardHeader, Empty, LinkButton, PageHeader, Table, Tabs, Td, Th, Tr } from "@/components/ui";
import { cn } from "@/lib/utils";
// Filtrlar va "muddati yaqin" qoidasi mobil ilova bilan bitta joyda — `lib/production.ts`
import { PRODUCTION_FILTERS, assigned, dueLabel, isOpen, isSoon, partlyAssigned, prodFilter, prodSort } from "@/lib/production";
import { OrderStatusBadge } from "../orders/status";
import { AssignForm } from "./assign-form";

/**
 * Ishlab chiqarish oynasi: saqlangan zayavkalar (qoralama, tasdiqlangan, ishlab chiqarilmoqda) shu yerga tushadi.
 * Har zayavkada brigada holati: yashil "Brigada tayinlangan" yoki qizil "Tayinlanmagan".
 * Tayinlash formasi shu oynaning o'zida ochiladi; "Tasdiqlash" bosilganda topshiriq brigadaga yuboriladi.
 */
export default async function ProductionPage({ searchParams }: { searchParams: Promise<{ order?: string; tab?: string }> }) {
  const { order: selectedId, tab = "open" } = await searchParams;
  const [allOrders, brigades, batches] = await Promise.all([
    db.order.findMany({
      where: { status: { not: "CANCELLED" } },
      orderBy: [{ deliveryDate: "asc" }],
      include: { customer: true, items: { include: { product: true, brigade: true, task: true } } },
      take: 400,
    }),
    db.brigade.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, include: { leader: true } }),
    db.productionBatch.findMany({ orderBy: { createdAt: "desc" }, take: 200, include: { product: true, order: { include: { customer: true } }, createdBy: true } }),
  ]);
  const marks = await customerMarks([...allOrders.map((o) => o.customerId), ...batches.map((b) => b.order?.customerId).filter((x): x is string => !!x)]);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const todayM3 = batches.filter((b) => b.date >= today && b.product.unit === "m3").reduce((s, b) => s + Number(b.qtyM3), 0);
  const FILTER_ICON: Record<string, typeof Layers> = { open: ListTodo, today: CalendarDays, soon: AlarmClock, unassigned: HardHat, urgent: Zap, done: CheckCheck, all: Layers };
  const filter = prodFilter(tab);
  const orders = prodSort(allOrders.filter(filter.test));
  const unassignedCount = allOrders.filter((o) => isOpen(o) && !assigned(o)).length;
  const soonCount = allOrders.filter(isSoon).length;
  const selected = selectedId ? allOrders.find((o) => o.id === selectedId) : undefined;
  const bOpts = brigades.map((b) => ({ id: b.id, name: b.name, leader: b.leader?.fullName ?? null }));

  return (
    <div>
      <PageHeader title="Ishlab chiqarish" subtitle={`Bugun: ${qty(todayM3)} m³ · brigada kutayotgan: ${unassignedCount} · muddati yaqin (≤ 2 kun): ${soonCount}`} action={<LinkButton href="/production/new"><Plus size={16} /> Zames</LinkButton>} />

      {selected && (
        <Card padded={false} className="mb-5 border-brand-500/40">
          <div className="px-5 pt-5">
            <CardHeader
              icon={HardHat}
              title={`Brigada tayinlash · ${selected.orderNo} · ${selected.customer.name}`}
              description={`Yetkazish ${deliveryAt(selected.deliveryDate, selected.deliveryTime)} · ${selected.deliveryAddress}`}
              action={<span className="inline-flex items-center gap-2">{marks.black.has(selected.customerId) && <BlacklistMark />}{marks.contract.has(selected.customerId) && <ContractMark />}{selected.isUrgent && <Badge color="red"><Zap size={11} /> Zarur</Badge>}{!selected.needsDelivery && <Badge color="slate"><Truck size={11} /> O&apos;zi oladi</Badge>}<Link href={`/orders/${selected.id}`} className="text-sm text-slate-500 hover:text-slate-900">Zayavka</Link><Link href={filter.key !== "open" ? `/production?tab=${filter.key}` : "/production"} className="text-sm text-slate-500 hover:text-slate-900">Yopish</Link></span>}
            />
          </div>
          {brigades.length === 0 && <p className="px-5 pb-3 text-sm text-red-600">Brigadalar yo&apos;q — avval <Link href="/brigades" className="underline">Brigadalar</Link> sahifasida qo&apos;shing.</p>}
          <AssignForm orderId={selected.id} brigades={bOpts} items={selected.items.map((i) => ({ id: i.id, product: i.product.name, qty: qty(i.qtyM3), unit: unitLabel(i.product.unit), taskNo: i.task?.taskNo ?? null, brigade: i.brigade?.name ?? null }))} />
        </Card>
      )}

      <h2 className="mb-3 inline-flex items-center gap-2 font-semibold"><ClipboardList size={16} className="text-slate-400" /> Zayavkalar</h2>
      <Tabs current={filter.key} items={PRODUCTION_FILTERS.map((f) => ({ key: f.key, label: f.label, icon: FILTER_ICON[f.key] ?? Layers, href: f.key === "open" ? "/production" : `/production?tab=${f.key}`, count: allOrders.filter(f.test).length }))} />
      <Table className="mb-8">
        <thead><tr><Th>№</Th><Th>Yetkazish</Th><Th>Mijoz</Th><Th>Mahsulot</Th><Th right>Miqdor</Th><Th>Holat</Th><Th>Brigada</Th><Th></Th></tr></thead>
        <tbody>
          {orders.length === 0 && <Empty text={`"${filter.label}" bo'yicha zayavka yo'q`} icon={ClipboardList} />}
          {orders.map((o) => {
            const ok = assigned(o);
            const partial = partlyAssigned(o);
            const isSel = o.id === selectedId;
            const soon = isSoon(o);
            const due = dueLabel(o.deliveryDate);
            return (
              <Tr key={o.id} className={cn(soon && "bg-red-50/70 [&>td]:text-red-900", isSel && !soon && "bg-brand-50/60")}>
                <Td><Link href={`/orders/${o.id}`} className={cn("font-medium hover:underline", soon && "text-red-700")}>{o.orderNo}</Link>{o.isUrgent && <span className="ml-1 rounded bg-red-100 px-1.5 py-0.5 text-[11px] font-medium text-red-700">zarur</span>}</Td>
                <Td><span className={soon ? "font-semibold text-red-700" : ""}>{date(o.deliveryDate)}</span>{o.deliveryTime && <span className={cn("ml-1.5 rounded px-1.5 py-0.5 text-[12px] font-semibold tabular-nums", soon ? "bg-red-100 text-red-800" : "bg-slate-100 text-slate-700")}>{o.deliveryTime}</span>}{isOpen(o) && (soon ? <div className="mt-0.5 inline-flex items-center gap-1 text-[11px] font-semibold text-red-700"><AlarmClock size={12} /> {due}</div> : <div className="mt-0.5 text-[11px] text-slate-500">{due}</div>)}</Td>
                <Td><CustomerName name={o.customer.name} blacklisted={marks.black.has(o.customerId)} contracted={marks.contract.has(o.customerId)} /></Td>
                <Td className="text-slate-600">{o.items.map((i) => i.product.code).join(", ")}{!o.needsDelivery && " · o'zi oladi"}</Td>
                <Td right>{qty(o.items.reduce((s, i) => s + Number(i.qtyM3), 0))}</Td>
                <Td><OrderStatusBadge status={o.status} /></Td>
                <Td>
                  {ok ? (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200"><CheckCircle2 size={14} /> Brigada tayinlangan</span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-700 ring-1 ring-red-200"><XCircle size={14} /> {partial ? "Qisman tayinlangan" : "Brigada tayinlanmagan"}</span>
                  )}
                  {ok && <div className="mt-1 text-[11px] text-slate-500">{[...new Set(o.items.map((i) => i.brigade?.name).filter(Boolean))].join(", ")}</div>}
                </Td>
                <Td>{ok ? <Link href="/tasks" className="text-sm text-slate-500 hover:text-slate-900">Topshiriqlar</Link> : <Link href={`/production?order=${o.id}${filter.key !== "open" ? `&tab=${filter.key}` : ""}`} className="inline-flex items-center gap-1 text-sm font-medium text-slate-900 hover:underline"><HardHat size={14} /> Tayinlash</Link>}</Td>
              </Tr>
            );
          })}
        </tbody>
      </Table>

      <h2 className="mb-3 inline-flex items-center gap-2 font-semibold"><Factory size={16} className="text-slate-400" /> Zameslar</h2>
      <Table>
        <thead><tr><Th>№</Th><Th>Sana</Th><Th>Smena</Th><Th>Mahsulot</Th><Th right>Miqdor</Th><Th>Zayavka</Th><Th>Kim</Th></tr></thead>
        <tbody>
          {batches.length === 0 && <Empty text="Zameslar yo'q" />}
          {batches.map((b) => (
            <Tr key={b.id}>
              <Td><Link href={`/production/${b.id}`} className="font-medium hover:underline">{b.batchNo}</Link></Td>
              <Td>{date(b.date)}</Td><Td>{b.shift}</Td><Td>{b.product.name}</Td><Td right>{qty(b.qtyM3)} <span className="text-slate-400">{unitLabel(b.product.unit)}</span></Td>
              <Td>{b.order ? <span className="inline-flex items-center gap-1.5"><Link href={`/orders/${b.order.id}`} className="hover:underline">{b.order.orderNo} · {b.order.customer.name}</Link>{marks.black.has(b.order.customerId) && <BlacklistMark short />}{marks.contract.has(b.order.customerId) && <ContractMark short />}</span> : <span className="text-slate-400">—</span>}</Td>
              <Td>{b.createdBy.fullName}</Td>
            </Tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}
