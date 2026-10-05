import Link from "next/link";
import { Plus } from "lucide-react";
import { db } from "@/lib/db";
import { requireRoles } from "@/lib/page-guard";
import { ORDER_LOGI, orderLogistics, type OrderLogiStatus } from "@/lib/logistics";
import { deliveryAt, qty } from "@/lib/format";
import { Card, Empty, LinkButton, PageHeader, Table, Tabs, Td, Th, Tr } from "@/components/ui";
import { OrderLogiBadge, unitShort } from "../ui";

export const dynamic = "force-dynamic";

type Filter = "open" | "waiting" | "onroad" | "late" | "problem" | "done" | "all";

/**
 * Buyurtmalar moduli (TZ 4): zayavkalar logistika ko'zi bilan — kim, qayerga, qancha, qachon,
 * qanchasi transportga biriktirilgan va yetkazilgan. Holat reyslardan chiqadi (`orderLogistics`).
 */
export default async function LogisticsOrdersPage({ searchParams }: { searchParams: Promise<{ filter?: string; q?: string }> }) {
  await requireRoles(["LOGISTICS"], { module: "logistika" });
  const sp = await searchParams;
  const filter = (["open", "waiting", "onroad", "late", "problem", "done", "all"].includes(sp.filter ?? "") ? sp.filter : "open") as Filter;
  const now = new Date();
  const from = new Date(now); from.setDate(from.getDate() - 14); from.setHours(0, 0, 0, 0);
  const to = new Date(now); to.setDate(to.getDate() + 30);

  const orders = await db.order.findMany({
    where: {
      kind: "SALE", needsDelivery: true,
      ...(sp.q ? { OR: [{ orderNo: { contains: sp.q, mode: "insensitive" } }, { customer: { name: { contains: sp.q, mode: "insensitive" } } }, { deliveryAddress: { contains: sp.q, mode: "insensitive" } }] } : {}),
      // Ochiqlari sanasidan qat'i nazar; yopilganlari — oxirgi 14 kun
      OR: [
        { status: { in: ["DRAFT", "BLOCKED", "CONFIRMED", "IN_PRODUCTION"] } },
        { deliveryDate: { gte: from, lt: to } },
      ],
    },
    include: {
      customer: { select: { name: true } }, site: { select: { id: true, name: true, contactPhone: true } },
      createdBy: { select: { fullName: true } },
      items: { select: { qtyM3: true, product: { select: { name: true, code: true, unit: true } } } },
      trips: { select: { status: true, qtyM3: true, plannedAt: true, deliveredAt: true, closedAt: true, issues: { select: { resolvedAt: true } } } },
    },
    orderBy: [{ deliveryDate: "asc" }, { deliveryTime: "asc" }],
    take: 400,
  });
  const rows = orders.map((o) => ({ o, l: orderLogistics(o, now) }));
  const OPEN: OrderLogiStatus[] = ["NEW", "CONFIRMED", "PLANNED", "ASSIGNED", "LOADING", "ON_ROAD"];
  const match: Record<Filter, (r: (typeof rows)[number]) => boolean> = {
    open: (r) => OPEN.includes(r.l.status),
    waiting: (r) => ["CONFIRMED", "PLANNED", "ASSIGNED", "LOADING", "ON_ROAD"].includes(r.l.status) && r.l.remaining > 0.001,
    onroad: (r) => ["LOADING", "ON_ROAD"].includes(r.l.status),
    late: (r) => r.l.late,
    problem: (r) => r.l.problem,
    done: (r) => ["DELIVERED", "CLOSED"].includes(r.l.status),
    all: () => true,
  };
  const shown = rows.filter(match[filter]);
  const tab = (k: Filter, label: string) => ({ key: k, label, href: `/logistika/buyurtmalar?filter=${k}${sp.q ? `&q=${encodeURIComponent(sp.q)}` : ""}`, count: rows.filter(match[k]).length });

  return (
    <div>
      <PageHeader title="Buyurtmalar" subtitle="Dastavkali zayavkalar: yetkazish holati, biriktirilgan va yetkazilgan hajm"
        action={<LinkButton href="/trips/new"><Plus size={16} /> Reys</LinkButton>} />
      <form className="mb-3"><input type="hidden" name="filter" value={filter} /><input name="q" aria-label="Qidirish" defaultValue={sp.q} placeholder="Zayavka, mijoz yoki manzil…" className="h-9 w-72 rounded-lg border border-slate-200 px-3 text-sm" /></form>
      <Tabs current={filter} items={[tab("open", "Ochiq"), tab("waiting", "Transport kutmoqda"), tab("onroad", "Yo'lda"), tab("late", "Kechikmoqda"), tab("problem", "Muammo"), tab("done", "Yetkazilgan"), tab("all", "Hammasi")]} />
      <Card padded={false}>
        <Table>
          <thead><tr><Th>Zayavka</Th><Th>Mijoz / obyekt</Th><Th>Marka</Th><Th right>Hajm</Th><Th right>Biriktirildi</Th><Th right>Yetkazildi</Th><Th>Yetkazish</Th><Th>Holat</Th><Th>Mas'ul</Th><Th /></tr></thead>
          <tbody>
            {shown.length === 0 && <Empty text="Bu filtrda zayavka yo'q" />}
            {shown.map(({ o, l }) => {
              const unit = o.items.every((i) => i.product.unit === "m3") ? "m3" : o.items[0]?.product.unit ?? "m3";
              return (
                <Tr key={o.id}>
                  <Td><Link href={`/orders/${o.id}`} className="font-medium tabular hover:underline">{o.orderNo}</Link>{o.isUrgent && <div className="text-xs font-semibold text-red-600">shoshilinch</div>}</Td>
                  <Td>
                    <div className="font-medium">{o.customer.name}</div>
                    {o.site ? <Link href={`/logistika/obyektlar/${o.site.id}`} className="block max-w-[16rem] truncate text-xs text-slate-500 hover:underline">{o.deliveryAddress}</Link> : <div className="max-w-[16rem] truncate text-xs text-slate-500">{o.deliveryAddress}</div>}
                    {o.lat == null && <div className="text-xs text-amber-700">xaritada nuqta yo'q</div>}
                  </Td>
                  <Td className="text-sm">{o.items.map((i) => i.product.code ?? i.product.name).join(", ")}{o.needsPump && <div className="text-xs text-violet-700">+ nasos</div>}</Td>
                  <Td right className="tabular">{qty(l.total)} {unitShort(unit)}</Td>
                  <Td right className={`tabular ${l.remaining > 0.001 ? "text-amber-700" : ""}`}>{qty(l.assigned)}</Td>
                  <Td right className="tabular">{qty(l.delivered)}</Td>
                  <Td className="text-sm tabular">{deliveryAt(o.deliveryDate, o.deliveryTime)}</Td>
                  <Td><OrderLogiBadge status={l.status} late={l.late} problem={l.problem} /></Td>
                  <Td className="text-xs text-slate-500">{o.createdBy.fullName}</Td>
                  <Td>{l.remaining > 0.001 && ["CONFIRMED", "PLANNED", "ASSIGNED", "LOADING", "ON_ROAD"].includes(l.status) && <Link href={`/trips/new?orderId=${o.id}`} className="whitespace-nowrap text-xs font-medium text-blue-700 hover:underline">+ Reys</Link>}</Td>
                </Tr>
              );
            })}
          </tbody>
        </Table>
      </Card>
      <p className="mt-3 text-xs text-slate-500">Holatlar: {Object.values(ORDER_LOGI).map((x) => x.label).join(" → ")}. "Kechikmoqda" — yetkazish vaqti o'tgan, hammasi yetkazilmagan; "Muammo mavjud" — reysda hal qilinmagan muammo bor.</p>
    </div>
  );
}
