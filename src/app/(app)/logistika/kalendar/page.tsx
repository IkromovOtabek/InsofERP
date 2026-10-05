import Link from "next/link";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { db } from "@/lib/db";
import { requireRoles } from "@/lib/page-guard";
import { ACTIVE_TRIP, dayRange, orderLogistics, orderPlannedAt, parseDay, tripPhase, tripPlannedAt, VEHICLE_TYPE } from "@/lib/logistics";
import { date, isoDate, qty } from "@/lib/format";
import { Card, CardHeader, LinkButton, PageHeader } from "@/components/ui";
import { unitShort } from "../ui";

export const dynamic = "force-dynamic";

const SLOT = 30; // daqiqa
/** Bir reys mashinani taxminan shuncha band qiladi (yuklash + yo'l + tushirish + qaytish) — reja uchun. */
const DEFAULT_TURN_MIN = 120;
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

/**
 * Dispetcher kalendari (TZ 13): kun 30 daqiqalik oraliqlarga bo'lingan — har oraliqda qaysi
 * zayavkaga nechta mixer kerak, nechtasi band va nechtasi bo'sh. Transport ustunlari — kim
 * qachon band (reys rejasi / haqiqiy vaqtlar).
 */
export default async function DispatchCalendar({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  await requireRoles(["LOGISTICS"], { module: "logistika" });
  const { date: dp } = await searchParams;
  const day = parseDay(dp);
  const { from, to } = dayRange(day);
  const s = await db.companySettings.findUnique({ where: { id: "main" }, select: { shiftStartHour: true, shiftEndHour: true } });
  const H0 = s?.shiftStartHour ?? 8, H1 = s?.shiftEndHour ?? 20;

  const isToday = from <= new Date() && new Date() < to;
  const [orders, vehicles, backlog] = await Promise.all([
    db.order.findMany({
      where: { kind: "SALE", needsDelivery: true, status: { notIn: ["CANCELLED", "DRAFT"] }, deliveryDate: { gte: from, lt: to } },
      include: {
        customer: { select: { name: true } },
        items: { select: { qtyM3: true, product: { select: { unit: true } } } },
        trips: { where: { status: { not: "CANCELLED" } }, select: { status: true, qtyM3: true, plannedAt: true, deliveredAt: true, closedAt: true } },
      },
      orderBy: { deliveryTime: "asc" },
    }),
    db.vehicle.findMany({
      where: { isActive: true, type: { in: ["MIXER", "TRUCK", "PUMP"] } }, orderBy: [{ type: "asc" }, { plate: "asc" }],
      include: {
        trips: {
          where: { status: { not: "CANCELLED" }, OR: [{ plannedAt: { gte: from, lt: to } }, { loadedAt: { gte: from, lt: to } }, { createdAt: { gte: from, lt: to } }, { status: { in: ACTIVE_TRIP } }] },
          include: { order: { select: { orderNo: true, deliveryDate: true, deliveryTime: true, customer: { select: { name: true } } } } },
        },
      },
    }),
    // Oldingi kunlardan qolib ketgan ochiq zayavkalar — bugungi rejaga qo'shilishi kerak
    isToday ? db.order.findMany({
      where: { kind: "SALE", needsDelivery: true, status: { in: ["CONFIRMED", "IN_PRODUCTION"] }, deliveryDate: { lt: from } },
      include: { customer: { select: { name: true } }, items: { select: { qtyM3: true } }, trips: { where: { status: { not: "CANCELLED" } }, select: { status: true, qtyM3: true } } },
      orderBy: { deliveryDate: "asc" },
    }) : Promise.resolve([]),
  ]);
  const slots: number[] = [];
  for (let m = H0 * 60; m < H1 * 60; m += SLOT) slots.push(m);
  const minOf = (d: Date) => (d < from ? H0 * 60 : d >= to ? H1 * 60 : d.getHours() * 60 + d.getMinutes());

  // Transport bandligi: [boshlanish, tugash] daqiqada
  const busy = vehicles.map((v) => ({
    v,
    spans: v.trips.map((t) => {
      const start = t.loadedAt ?? (tripPlannedAt(t, t.order) ? new Date(tripPlannedAt(t, t.order)!.getTime() - 45 * 60000) : null);
      if (!start) return null;
      const end = t.returnedAt ?? (t.deliveredAt ? new Date(t.deliveredAt.getTime() + 40 * 60000) : new Date(start.getTime() + DEFAULT_TURN_MIN * 60000));
      return { a: minOf(start), b: minOf(end), label: `${t.order.orderNo} · ${t.order.customer.name}`, phase: tripPhase(t), id: t.id };
    }).filter((x): x is NonNullable<typeof x> => !!x),
  }));
  const mixers = busy.filter((b) => b.v.type === "MIXER");
  const freeAt = (m: number) => mixers.filter((b) => b.v.status !== "REPAIR" && !b.spans.some((s) => s.a <= m && m < s.b)).length;
  // Talab: rejadagi vaqti shu oraliqda bo'lgan zayavkaning hali biriktirilmagan hajmi ÷ mikser sig'imi
  const avgCap = mixers.length ? mixers.reduce((a, b) => a + Number(b.v.capacityM3 ?? 8), 0) / mixers.length : 8;
  const need = (m: number) => orders.reduce((n, o) => {
    const p = orderPlannedAt(o);
    if (!p || minOf(p) < m || minOf(p) >= m + SLOT) return n;
    const l = orderLogistics(o);
    return n + Math.ceil(l.remaining / avgCap);
  }, 0);
  const noTime = orders.filter((o) => !o.deliveryTime);
  const prev = new Date(from); prev.setDate(prev.getDate() - 1);
  const next = new Date(from); next.setDate(next.getDate() + 1);
  const PH: Record<string, string> = { ASSIGNED: "bg-slate-300", LOADED: "bg-blue-500", ON_ROAD: "bg-amber-500", ARRIVED: "bg-violet-500", UNLOADING: "bg-violet-500", DELIVERED: "bg-emerald-500", CLOSED: "bg-emerald-600" };
  const W = 100 / slots.length;

  return (
    <div>
      <PageHeader title="Dispetcher kalendari" subtitle="30 daqiqalik oraliqlar: qaysi vaqtga nechta mixer kerak, nechtasi bo'sh; transport bandligi"
        action={<LinkButton href="/trips/new"><Plus size={16} /> Reys</LinkButton>} />
      <div className="mb-4 flex items-center gap-1 text-sm">
        <Link href={`/logistika/kalendar?date=${isoDate(prev)}`} aria-label="Oldingi kun" className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100"><ChevronLeft size={16} /></Link>
        <span className="font-medium tabular">{date(from)}</span>
        <Link href={`/logistika/kalendar?date=${isoDate(next)}`} aria-label="Keyingi kun" className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100"><ChevronRight size={16} /></Link>
        <Link href="/logistika/kalendar" className="ml-2 text-xs text-blue-700 hover:underline">Bugun</Link>
      </div>

      <Card className="mb-5" padded={false}>
        <div className="overflow-x-auto p-5">
          <div className="min-w-[900px]">
            {/* Soat sarlavhasi */}
            <div className="ml-40 flex text-[11px] text-slate-400">{slots.map((m) => <div key={m} style={{ width: `${W}%` }} className="tabular">{m % 60 === 0 ? hhmm(m) : ""}</div>)}</div>
            {/* Talab / bo'sh mixer qatori */}
            <div className="mt-1 flex items-center">
              <div className="w-40 shrink-0 text-xs font-medium">Kerak / bo'sh mixer</div>
              <div className="flex flex-1">
                {slots.map((m) => {
                  const n = need(m), f = freeAt(m);
                  return (
                    <div key={m} style={{ width: `${W}%` }} className={`mx-px rounded py-1 text-center text-[11px] tabular ${n > f ? "bg-red-100 text-red-800" : n ? "bg-amber-50 text-amber-800" : "bg-slate-50 text-slate-500"}`} title={`${hhmm(m)}: kerak ${n}, bo'sh ${f}`}>
                      {n ? `${n}/` : ""}{f}
                    </div>
                  );
                })}
              </div>
            </div>
            {/* Zayavkalar */}
            <div className="mt-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Zayavkalar</div>
            {orders.length === 0 && <p className="mt-1 text-sm text-slate-500">Bu kunga dastavkali zayavka yo'q.</p>}
            {orders.filter((o) => o.deliveryTime).map((o) => {
              const p = orderPlannedAt(o)!;
              const l = orderLogistics(o);
              const unit = o.items.every((i) => i.product.unit === "m3") ? "m3" : o.items[0]?.product.unit ?? "m3";
              const left = ((minOf(p) - H0 * 60) / ((H1 - H0) * 60)) * 100;
              return (
                <div key={o.id} className="mt-1 flex items-center">
                  <div className="w-40 shrink-0 truncate pr-2 text-xs"><Link href={`/orders/${o.id}`} className="font-medium hover:underline">{o.orderNo}</Link> <span className="text-slate-500">{o.customer.name}</span></div>
                  <div className="relative h-6 flex-1 rounded bg-slate-50">
                    <Link href={l.remaining > 0.001 ? `/trips/new?orderId=${o.id}` : `/orders/${o.id}`}
                      className={`absolute top-0.5 flex h-5 items-center whitespace-nowrap rounded px-1.5 text-[11px] font-medium ${l.remaining > 0.001 ? "border border-dashed border-red-400 bg-red-50 text-red-800" : "bg-emerald-100 text-emerald-800"}`}
                      style={{ left: `${Math.max(0, Math.min(95, left))}%` }}>
                      {o.deliveryTime} · {qty(l.assigned)}/{qty(l.total)} {unitShort(unit)}{l.remaining > 0.001 ? " · + reys" : ""}
                    </Link>
                  </div>
                </div>
              );
            })}
            {/* Transport */}
            <div className="mt-4 text-xs font-semibold uppercase tracking-wide text-slate-400">Transport</div>
            {busy.map(({ v, spans }) => (
              <div key={v.id} className="mt-1 flex items-center">
                <div className="w-40 shrink-0 truncate pr-2 text-xs"><Link href={`/logistika/transport/${v.id}`} className="font-medium tabular hover:underline">{v.plate}</Link> <span className="text-slate-500">{VEHICLE_TYPE[v.type]}{v.status === "REPAIR" ? " · ta'mirda" : ""}</span></div>
                <div className={`relative h-6 flex-1 rounded ${v.status === "REPAIR" ? "bg-red-50" : "bg-slate-50"}`}>
                  {spans.map((sp) => (
                    <Link key={sp.id} href={`/trips/${sp.id}`} title={sp.label}
                      className={`absolute top-1 h-4 rounded ${PH[sp.phase] ?? "bg-slate-300"}`}
                      style={{ left: `${((sp.a - H0 * 60) / ((H1 - H0) * 60)) * 100}%`, width: `${Math.max(1, ((sp.b - sp.a) / ((H1 - H0) * 60)) * 100)}%` }} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </Card>
      {noTime.length > 0 && (
        <Card>
          <CardHeader title="Soati ko'rsatilmagan zayavkalar" description="Kalendarga tushmaydi — reys ochishda rejadagi vaqtni belgilang" />
          <ul className="space-y-1 text-sm">{noTime.map((o) => <li key={o.id}><Link href={`/trips/new?orderId=${o.id}`} className="font-medium hover:underline">{o.orderNo}</Link> · {o.customer.name} · {qty(orderLogistics(o).remaining)} qoldi</li>)}</ul>
        </Card>
      )}
      {backlog.length > 0 && (
        <Card className="mt-5">
          <CardHeader title="Oldingi kunlardan qolgan" description="Yetkazish sanasi o'tgan, hali to'liq biriktirilmagan zayavkalar — bugungi rejaga qo'shing" />
          <ul className="space-y-1 text-sm">
            {backlog.map((o) => ({ o, l: orderLogistics({ ...o, items: o.items, trips: o.trips }) })).filter((x) => x.l.remaining > 0.001).map(({ o, l }) => (
              <li key={o.id}><Link href={`/trips/new?orderId=${o.id}`} className="font-medium hover:underline">{o.orderNo}</Link> · {o.customer.name} · {date(o.deliveryDate)}{o.deliveryTime ? ` ${o.deliveryTime}` : ""} · <span className="text-amber-700">{qty(l.remaining)} qoldi</span></li>
            ))}
          </ul>
        </Card>
      )}
      <p className="mt-3 text-xs text-slate-500">"kerak/bo'sh": qizil — shu oraliqda mixer yetishmaydi. Band vaqti: yuklashdan qaytishgacha; hali yuklanmagan reys — rejadan 45 daq oldin boshlanib, {DEFAULT_TURN_MIN} daq davom etadi deb olinadi.</p>
    </div>
  );
}
