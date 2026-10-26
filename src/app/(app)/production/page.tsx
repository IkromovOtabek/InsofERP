import Link from "next/link";
import { Plus, HardHat, Zap, Truck, Factory, AlarmClock, CalendarDays, ListTodo, CheckCheck, Layers } from "lucide-react";
import { db } from "@/lib/db";
import { customerMarks } from "@/lib/finance";
import { BlacklistMark, ContractMark } from "@/components/customer-name";
import { date, qty, deliveryAt } from "@/lib/format";
import { unitLabel } from "@/lib/unit";
import { Badge, Card, CardHeader, Empty, LinkButton, PageHeader, Table, Tabs, Td, Th, Tr } from "@/components/ui";
// Filtrlar va "muddati yaqin" qoidasi mobil ilova bilan bitta joyda — `lib/production.ts`
import { PRODUCTION_FILTERS, assigned, dueLabel, isDone, isOpen, isSoon, itemTasks, partlyAssigned, prodFilter, prodSort } from "@/lib/production";
import { AssignForm, type Capacity } from "./assign-form";
import { brigadeStocks } from "@/lib/brigade-stock";
import { requirePage } from "@/lib/page-guard";
import { productionMatrix } from "@/lib/production-matrix";
import { ProductionMatrixView, type BoardOrder } from "./matrix";

/**
 * Ishlab chiqarish oynasi: saqlangan zayavkalar (qoralama, tasdiqlangan, ishlab chiqarilmoqda) shu yerga tushadi.
 * Matritsa (sklad × zayavka) va uning ostida filtrli «Zayavkalar doskasi» — har kartada brigada holati
 * (tayinlangan / qisman / tayinlanmagan).
 * Tayinlash formasi shu oynaning o'zida ochiladi; "Tasdiqlash" bosilganda topshiriq brigadaga yuboriladi.
 */
export default async function ProductionPage({ searchParams }: { searchParams: Promise<{ order?: string; tab?: string; item?: string }> }) {
  const session = await requirePage("/production");
  const canBatch = session.role === "PRODUCTION" || session.role === "DIRECTOR";
  const { order: selectedId, tab = "open", item: focusItem } = await searchParams;
  const [allOrders, brigades, batches, matrix] = await Promise.all([
    db.order.findMany({
      where: { status: { not: "CANCELLED" } },
      orderBy: [{ deliveryDate: "asc" }],
      include: { customer: true, items: { include: { product: true, tasks: { include: { brigade: { select: { name: true } } }, orderBy: { createdAt: "asc" } } } } },
      take: 400,
    }),
    db.brigade.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, include: { leader: true } }),
    db.productionBatch.findMany({ orderBy: { createdAt: "desc" }, take: 200, include: { product: true, order: { include: { customer: true } }, createdBy: true } }),
    productionMatrix(),
  ]);
  const marks = await customerMarks([...allOrders.map((o) => o.customerId), ...batches.map((b) => b.order?.customerId).filter((x): x is string => !!x)]);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const todayM3 = batches.filter((b) => !b.cancelledAt && b.date >= today && b.product.unit === "m3").reduce((s, b) => s + Number(b.qtyM3), 0);
  const FILTER_ICON: Record<string, typeof Layers> = { open: ListTodo, today: CalendarDays, soon: AlarmClock, unassigned: HardHat, urgent: Zap, done: CheckCheck, all: Layers };
  const filter = prodFilter(tab);
  const orders = prodSort(allOrders.filter(filter.test));
  const unassignedCount = allOrders.filter((o) => isOpen(o) && !assigned(o)).length;
  const soonCount = allOrders.filter(isSoon).length;
  const selected = selectedId ? allOrders.find((o) => o.id === selectedId) : undefined;
  // «Zayavkalar doskasi» — tanlangan filtr bo'yicha (avvalgi jadval o'rniga): ustun topshiriqlardan, brigada holati — qatorlardan
  const board: BoardOrder[] = orders.map((o) => {
    const st = o.items.map((i) => itemTasks(i.qtyM3, i.tasks));
    return {
      id: o.id, customer: o.customer.name, deliveryDate: o.deliveryDate.toISOString(), deliveryTime: o.deliveryTime, dateUnknown: o.dateUnknown, isUrgent: o.isUrgent,
      draft: o.status === "DRAFT", pickup: !o.needsDelivery, blacklisted: marks.black.has(o.customerId), soon: isSoon(o),
      due: isOpen(o) && !o.dateUnknown ? dueLabel(o.deliveryDate) : null,
      col: isDone(o) ? "ready" : st.some((x) => x.any) ? "pour" : "queue",
      assign: assigned(o) ? "full" : partlyAssigned(o) ? "part" : "none",
      brigades: [...new Set(o.items.flatMap((i) => i.tasks.filter((t) => t.status !== "CANCELLED").map((t) => t.brigade.name)))],
      items: o.items.map((i, n) => ({ itemId: i.id, productId: i.productId, name: i.product.name, unit: i.product.unit, qty: Number(i.qtyM3), left: st[n]!.left })),
    };
  });
  const bOpts = brigades.map((b) => ({ id: b.id, name: b.name, leader: b.leader?.fullName ?? null }));
  // Brigada tayinlashda kerak: qaysi brigada qo'lidagi xomashyo bilan qanchasini chiqara oladi
  const capacity: Capacity = {};
  if (selected) {
    for (const b of await brigadeStocks()) {
      for (const m of b.makes) {
        (capacity[m.productId] ??= {})[b.id] = {
          canMake: m.canMake,
          limiting: m.limiting ? `${m.limiting.name} — brigadada ${qty(m.limiting.balance)} ${m.limiting.unit}, normasi ${qty(m.limiting.perUnit)}` : null,
          items: m.items.map((x) => ({ name: x.name, unit: x.unit, perUnit: x.perUnit, have: x.balance })),
        };
      }
    }
  }

  return (
    <div>
      <PageHeader title="Ishlab chiqarish" subtitle={`Bugun: ${qty(todayM3)} m³ · brigada kutayotgan: ${unassignedCount} · muddati yaqin (≤ 2 kun): ${soonCount}`} action={canBatch ? <LinkButton href="/production/new"><Plus size={16} /> Zames</LinkButton> : undefined} />

      {selected && (
        <Card padded={false} className="mb-5 border-brand-500/40">
          <div className="px-5 pt-5">
            <CardHeader
              icon={HardHat}
              title={`Brigada tayinlash · ${selected.orderNo} · ${selected.customer.name}`}
              description={`Yetkazish ${selected.dateUnknown ? "sanasi aniq emas" : deliveryAt(selected.deliveryDate, selected.deliveryTime)} · ${selected.deliveryAddress}`}
              action={<span className="inline-flex items-center gap-2">{marks.black.has(selected.customerId) && <BlacklistMark />}{marks.contract.has(selected.customerId) && <ContractMark />}{selected.isUrgent && <Badge color="red"><Zap size={11} /> Zarur</Badge>}{!selected.needsDelivery && <Badge color="slate"><Truck size={11} /> O&apos;zi oladi</Badge>}<Link href={`/orders/${selected.id}`} className="text-sm text-slate-500 hover:text-slate-900">Zayavka</Link><Link href={filter.key !== "open" ? `/production?tab=${filter.key}` : "/production"} className="text-sm text-slate-500 hover:text-slate-900">Yopish</Link></span>}
            />
          </div>
          {brigades.length === 0 && <p className="px-5 pb-3 text-sm text-red-600">Brigadalar yo&apos;q — avval <Link href="/brigades" className="underline">Brigadalar</Link> sahifasida qo&apos;shing.</p>}
          {/* Qoralama zayavka ishlab chiqarishga berilmaydi — avval sotuv tasdiqlaydi (server ham rad etadi) */}
          {selected.status === "DRAFT" && <p className="px-5 pb-5 text-sm text-amber-700">Zayavka hali tasdiqlanmagan (qoralama). Sotuv bo&apos;limi qabul qilgach brigada tayinlanadi.</p>}
          {selected.status !== "DRAFT" && <AssignForm orderId={selected.id} brigades={bOpts} capacity={capacity}
            focus={focusItem}
            items={selected.items.map((i) => ({
              id: i.id, product: i.product.name, productId: i.productId, qty: qty(i.qtyM3), qtyNum: Number(i.qtyM3), unit: unitLabel(i.product.unit),
              left: itemTasks(i.qtyM3, i.tasks).left,
              tasks: i.tasks.filter((t) => t.status !== "CANCELLED").map((t) => ({ taskNo: t.taskNo, brigade: t.brigade.name, qty: qty(t.qty), status: t.status })),
            }))} />}
        </Card>
      )}

      <ProductionMatrixView data={matrix} board={board} tab={filter.key}
        filters={<Tabs current={filter.key} className="mb-3" items={PRODUCTION_FILTERS.map((f) => ({ key: f.key, label: f.label, icon: FILTER_ICON[f.key] ?? Layers, href: f.key === "open" ? "/production" : `/production?tab=${f.key}`, count: allOrders.filter(f.test).length }))} />} />

      <h2 className="mb-3 inline-flex items-center gap-2 font-semibold"><Factory size={16} className="text-slate-400" /> Zameslar</h2>
      <Table>
        <thead><tr><Th>№</Th><Th>Sana</Th><Th>Smena</Th><Th>Mahsulot</Th><Th right>Miqdor</Th><Th>Zayavka</Th><Th>Kim</Th></tr></thead>
        <tbody>
          {batches.length === 0 && <Empty text="Zameslar yo'q" />}
          {batches.map((b) => (
            <Tr key={b.id}>
              <Td><Link href={`/production/${b.id}`} className="font-medium hover:underline">{b.batchNo}</Link>{b.cancelledAt && <> <Badge color="red">Bekor qilingan</Badge></>}</Td>
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
