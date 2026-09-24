import Link from "next/link";
import { Plus, ArrowRight, History, X, FileSpreadsheet, CheckCircle2, CornerDownRight } from "lucide-react";
import { db } from "@/lib/db";
import { customerMarks } from "@/lib/finance";
import { CustomerName } from "@/components/customer-name";
import { money, date, deliveryAt } from "@/lib/format";
import { fmtUnitTotals } from "@/lib/unit";
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
  // Bir xil mijoz + obyekt bo'yicha zayavkalar jadvalda yonma-yon tursin: aks holda
  // bitta obyektning bir necha zayavkasi ro'yxat bo'ylab sochilib ketadi va xodim
  // "shu obyektga yana nima olingan" deb qidirib chiqadi. Guruh ichida — yetkazish
  // sanasi bo'yicha (avval yaqini), guruhlar esa oxirgi kiritilgani tepada.
  const groupKey = (o: (typeof orders)[number]) => `${o.customerId}|${o.deliveryAddress.trim().toLowerCase().replace(/\s+/g, " ")}`;
  const groupMap = new Map<string, typeof orders>();
  for (const o of orders) {
    const g = groupMap.get(groupKey(o));
    if (g) g.push(o);
    else groupMap.set(groupKey(o), [o]);
  }
  const groups = [...groupMap.values()]
    .map((g) => [...g].sort((a, b) => a.deliveryDate.getTime() - b.deliveryDate.getTime()))
    .sort((a, b) => Math.max(...b.map((o) => o.createdAt.getTime())) - Math.max(...a.map((o) => o.createdAt.getTime())));
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
          <span className="text-slate-600">{date(day)} kuniga yetkazish: <b className="text-slate-900">{orders.length} ta zayavka</b> · {fmtUnitTotals(orders.flatMap((o) => o.items.map((i) => ({ unit: i.product.unit, qty: i.qtyM3 }))))}</span>
          <Link href="/orders" className="inline-flex items-center gap-1 font-medium text-slate-600 hover:text-slate-900 hover:underline"><X size={14} /> Kun filtrini olib tashlash</Link>
        </div>
      ) : (
        <Tabs current={st ?? ""} items={tabs} />
      )}
      <Table>
        <thead><tr><Th>№</Th><Th>Kiritildi</Th><Th>Yetkazish</Th><Th>Mijoz / obyekt</Th><Th>Mahsulot</Th><Th right>Hajm</Th><Th right>Summa</Th><Th>Kim</Th><Th>Holat</Th></tr></thead>
        <tbody>
          {orders.length === 0 && <Empty text="Kutayotgan zayavkalar yo'q" />}
          {groups.flatMap((g) => g.map((o, idx) => {
            // Hajm mahsulot birligida: beton m³, ustun/blok dona — aralashtirib qo'shilmaydi
            const vol = fmtUnitTotals(o.items.map((i) => ({ unit: i.product.unit, qty: i.qtyM3 })));
            const sum = o.items.reduce((s, i) => s + Number(i.qtyM3) * Number(i.price), 0);
            // Guruhning birinchi qatori — mijoz nomi, obyekt manzili va nechta zayavka ekani;
            // qolganlari o'sha guruhga tegishli ekani ko'rinib tursin deb ichkariroq chiziladi.
            const first = idx === 0;
            return (
              <Tr key={o.id} className={first && g.length > 1 ? "[&>td]:border-t-2 [&>td]:border-t-slate-200" : ""}>
                <Td><Link href={`/orders/${o.id}`} className="font-medium hover:underline">{o.orderNo}</Link></Td>
                <Td>{date(o.date)}</Td>
                <Td>{deliveryAt(o.deliveryDate, o.deliveryTime)}</Td>
                <Td>
                  {first ? (
                    <div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <CustomerName name={o.customer.name} blacklisted={marks.black.has(o.customerId)} contracted={marks.contract.has(o.customerId)} href={`/customers/${o.customerId}`} />
                        {g.length > 1 && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600">{g.length} ta zayavka · {fmtUnitTotals(g.flatMap((x) => x.items.map((i) => ({ unit: i.product.unit, qty: i.qtyM3 }))))}</span>}
                      </div>
                      <div className="mt-0.5 text-xs font-normal text-slate-500">{o.deliveryAddress}</div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5 pl-3 text-slate-400"><CornerDownRight size={14} className="shrink-0" /><span className="text-xs font-normal">{o.customer.name}</span></div>
                  )}
                </Td>
                <Td>{o.items.map((i) => i.product.code).join(", ")}{o.needsPump && " · nasos"}{!o.needsDelivery && " · o'zi oladi"}{o.isUrgent && <span className="ml-1 rounded bg-red-50 px-1.5 py-0.5 text-[11px] font-medium text-red-700">zarur</span>}{o.onCredit && <span className="ml-1 rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-700">qarzga</span>}</Td>
                <Td right className="whitespace-nowrap">{vol}</Td>
                <Td right>{money(sum)}</Td>
                <Td className="text-slate-500">{o.createdBy.fullName}</Td>
                <Td><OrderStatusBadge status={o.status} /></Td>
              </Tr>
            );
          }))}
        </tbody>
      </Table>
    </div>
  );
}
