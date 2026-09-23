import Link from "next/link";
import { CalendarDays, ClipboardList, Layers, Percent, TrendingUp, XCircle } from "lucide-react";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { money, moneyShort, date, isoDate, qty as q, fmtNum, pct } from "@/lib/format";
import { Badge, Button, Card, CardHeader, Empty, Input, PageHeader, StatCard, Table, Td, Th, Tr } from "@/components/ui";
import { BarChart, DonutChart, HBarList } from "@/components/ui/charts";
import { ORDER_STATUS } from "../status";
import type { OrderStatus } from "@/generated/prisma";
import { cn } from "@/lib/utils";

/**
 * Zayavkalar tarixi: kun bo'yicha nechta zayavka bo'lgan, qanchasi yopilgan,
 * jarayonda va bekor qilingan. Sotuvchi "qaysi kun band bo'ladi" ni o'tgan
 * kunlar bo'yicha ham ko'radi — ish tartibi taqvimining tarixiy tomoni.
 */
export default async function OrdersHistoryPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; by?: string }> }) {
  await requireSession(["SALES", "PRODUCTION", "SUPERVISOR", "LOGISTICS", "ACCOUNTING", "FINANCE"]);
  const sp = await searchParams;
  const now = new Date();
  const from = new Date(sp.from ?? isoDate(new Date(now.getTime() - 29 * 864e5)));
  from.setHours(0, 0, 0, 0);
  const to = new Date(sp.to ?? isoDate(now)); to.setHours(23, 59, 59, 999);
  const by = sp.by === "delivery" ? "delivery" : "created"; // kiritilgan sana yoki yetkazish sanasi

  const [orders, settings] = await Promise.all([
    db.order.findMany({
      where: by === "delivery" ? { deliveryDate: { gte: from, lte: to } } : { date: { gte: from, lte: to } },
      include: { customer: { select: { id: true, name: true } }, createdBy: { select: { fullName: true } }, items: { include: { product: { select: { code: true, unit: true } } } } },
      orderBy: { date: "desc" },
      take: 2000,
    }),
    db.companySettings.findUnique({ where: { id: "main" }, select: { dailyCapacityM3: true } }),
  ]);
  const capacity = Math.max(1, Number(settings?.dailyCapacityM3 ?? 200));

  const sum = (o: (typeof orders)[number]) => o.items.reduce((s, i) => s + Number(i.qtyM3) * Number(i.price), 0);
  const m3 = (o: (typeof orders)[number]) => o.items.reduce((s, i) => s + (i.product.unit === "m3" ? Number(i.qtyM3) : 0), 0);
  const keyOf = (o: (typeof orders)[number]) => isoDate(by === "delivery" ? o.deliveryDate : o.date);

  // Kun bo'yicha yig'indi
  type Day = { key: string; d: Date; count: number; m3: number; sum: number; closed: number; active: number; cancelled: number; blocked: number };
  const days = new Map<string, Day>();
  for (let t = new Date(from); t <= to; t.setDate(t.getDate() + 1)) {
    const k = isoDate(t);
    days.set(k, { key: k, d: new Date(t), count: 0, m3: 0, sum: 0, closed: 0, active: 0, cancelled: 0, blocked: 0 });
  }
  const byStatus = new Map<OrderStatus, number>();
  const byCustomer = new Map<string, { name: string; count: number; sum: number }>();
  for (const o of orders) {
    const d = days.get(keyOf(o));
    byStatus.set(o.status, (byStatus.get(o.status) ?? 0) + 1);
    const c = byCustomer.get(o.customerId) ?? { name: o.customer.name, count: 0, sum: 0 };
    c.count += 1; c.sum += sum(o); byCustomer.set(o.customerId, c);
    if (!d) continue;
    d.count += 1; d.m3 += m3(o); d.sum += sum(o);
    if (o.status === "CLOSED" || o.status === "DELIVERED") d.closed += 1;
    else if (o.status === "CANCELLED") d.cancelled += 1;
    else if (o.status === "BLOCKED") d.blocked += 1;
    else d.active += 1;
  }
  const list = [...days.values()];
  const totals = list.reduce((a, d) => ({ count: a.count + d.count, m3: a.m3 + d.m3, sum: a.sum + d.sum, closed: a.closed + d.closed, cancelled: a.cancelled + d.cancelled, active: a.active + d.active }),
    { count: 0, m3: 0, sum: 0, closed: 0, cancelled: 0, active: 0 });
  const workDays = list.filter((d) => d.count > 0).length || 1;
  const busiest = list.reduce((m, d) => (d.count > m.count ? d : m), list[0]);
  const qs = (o: Record<string, string>) => `/orders/tarix?${new URLSearchParams({ from: isoDate(from), to: isoDate(to), by, ...o })}`;

  return (
    <div>
      <PageHeader back={{ href: "/orders", label: "Zayavkalar" }} title="Zayavkalar tarixi"
        subtitle={`${date(from)} — ${date(to)} · ${by === "delivery" ? "yetkazish sanasi bo'yicha" : "kiritilgan sana bo'yicha"}`} />

      <form className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        <Input name="from" type="date" defaultValue={isoDate(from)} className="h-9 w-40" />
        <span className="text-slate-400">—</span>
        <Input name="to" type="date" defaultValue={isoDate(to)} className="h-9 w-40" />
        <select name="by" defaultValue={by} className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm">
          <option value="created">Kiritilgan sana bo&apos;yicha</option>
          <option value="delivery">Yetkazish sanasi bo&apos;yicha</option>
        </select>
        <Button variant="secondary" className="h-9 text-sm">Ko&apos;rsatish</Button>
        <span className="ml-2 flex flex-wrap gap-1.5 text-xs">
          <Link href={qs({ from: isoDate(new Date(now.getTime() - 6 * 864e5)), to: isoDate(now) })} className="rounded-md border border-slate-200 px-2 py-1 hover:bg-slate-50">7 kun</Link>
          <Link href={qs({ from: isoDate(new Date(now.getTime() - 29 * 864e5)), to: isoDate(now) })} className="rounded-md border border-slate-200 px-2 py-1 hover:bg-slate-50">30 kun</Link>
          <Link href={qs({ from: isoDate(new Date(now.getFullYear(), now.getMonth(), 1)), to: isoDate(now) })} className="rounded-md border border-slate-200 px-2 py-1 hover:bg-slate-50">Shu oy</Link>
        </span>
      </form>

      <div className="mb-5 grid grid-cols-2 gap-3 xl:grid-cols-5">
        <StatCard label="Zayavkalar" value={`${totals.count} ta`} hint={`kuniga o'rtacha ${fmtNum(totals.count / workDays, 1)} ta`} icon={ClipboardList} />
        <StatCard label="Hajm" value={`${q(totals.m3)} m³`} hint={`kuniga ${fmtNum(totals.m3 / workDays, 1)} m³ · quvvat ${fmtNum(capacity)} m³`} icon={Layers} />
        <StatCard label="Summa" value={moneyShort(totals.sum)} hint={money(totals.sum)} icon={TrendingUp} tone="success" />
        <StatCard label="Yopilgan / yetkazilgan" value={`${totals.closed} ta`} hint={pct(totals.count ? (totals.closed / totals.count) * 100 : 0)} icon={Percent} tone="brand" />
        <StatCard label="Bekor qilingan" value={`${totals.cancelled} ta`} hint={pct(totals.count ? (totals.cancelled / totals.count) * 100 : 0)} icon={XCircle} tone={totals.cancelled ? "danger" : "default"} />
      </div>

      <div className="mb-5 grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader icon={CalendarDays} title="Kun bo'yicha zayavkalar" description="Ustun balandligi — shu kungi hajm (m³); qizil ustun quvvatdan oshgan kun" />
          <BarChart height={180} labelEvery={Math.max(1, Math.round(list.length / 12))} formatValue={(v) => `${fmtNum(v, 1)} m³`}
            data={list.map((d) => ({ label: `${d.d.getDate()}/${d.d.getMonth() + 1}`, value: d.m3, tone: d.m3 > capacity ? "danger" : d.m3 > capacity * 0.6 ? "warning" : "success" }))} />
          {busiest?.count > 0 && <p className="mt-2 text-xs text-slate-500">Eng band kun: <b>{date(busiest.d)}</b> — {busiest.count} ta zayavka, {q(busiest.m3)} m³ ({pct((busiest.m3 / capacity) * 100, 0)} quvvatdan).</p>}
        </Card>
        <Card>
          <CardHeader title="Holatlar" description="Davrdagi zayavkalar taqsimoti" />
          <div className="flex items-center justify-center">
            <DonutChart size={170} center={{ value: String(totals.count), label: "zayavka" }} formatValue={(v) => `${v} ta`}
              data={[...byStatus.entries()].map(([k, v]) => ({ label: ORDER_STATUS[k].label, value: v }))} />
          </div>
          <ul className="mt-3 space-y-1 text-[13px]">
            {[...byStatus.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => (
              <li key={k} className="flex items-center justify-between gap-2">
                <Badge color={ORDER_STATUS[k].color}>{ORDER_STATUS[k].label}</Badge>
                <span className="tabular text-slate-600">{v} ta · {pct(totals.count ? (v / totals.count) * 100 : 0, 0)}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <div className="mb-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Eng ko'p zayavka bergan mijozlar" description="Davr bo'yicha summa" />
          {byCustomer.size === 0 ? <p className="text-sm text-slate-500">Ma&apos;lumot yo&apos;q</p> : (
            <HBarList formatValue={moneyShort}
              data={[...byCustomer.values()].sort((a, b) => b.sum - a.sum).slice(0, 8).map((c) => ({ label: c.name, value: c.sum, sub: `${c.count} ta` }))} />
          )}
        </Card>
        <Card>
          <CardHeader title="Hafta kunlari bo'yicha yuk" description="Qaysi kun odatda bandroq — reja tuzishda asqotadi" />
          <HBarList tone="brand" formatValue={(v) => `${fmtNum(v, 1)} m³`}
            data={["Dush", "Sesh", "Chor", "Pay", "Jum", "Shan", "Yak"].map((label, i) => {
              const idx = (i + 1) % 7;
              const dd = list.filter((d) => d.d.getDay() === idx);
              const avg = dd.length ? dd.reduce((s, d) => s + d.m3, 0) / dd.length : 0;
              return { label, value: avg, sub: `${dd.reduce((s, d) => s + d.count, 0)} ta zayavka` };
            })} />
        </Card>
      </div>

      <Table>
        <thead><tr><Th>Sana</Th><Th right>Zayavka</Th><Th right>Hajm</Th><Th right>Summa</Th><Th right>Yopilgan</Th><Th right>Jarayonda</Th><Th right>Bekor</Th><Th>Bandlik</Th></tr></thead>
        <tbody>
          {list.filter((d) => d.count > 0).length === 0 && <Empty text="Davrda zayavka yo'q" icon={ClipboardList} />}
          {list.filter((d) => d.count > 0).reverse().map((d) => {
            const load = (d.m3 / capacity) * 100;
            return (
              <Tr key={d.key}>
                <Td><Link href={`/orders?kun=${d.key}`} className="font-medium hover:underline">{date(d.d)}</Link></Td>
                <Td right>{d.count}</Td>
                <Td right>{q(d.m3)} m³</Td>
                <Td right>{money(d.sum)}</Td>
                <Td right className="text-emerald-700">{d.closed || "—"}</Td>
                <Td right className="text-blue-700">{d.active || "—"}</Td>
                <Td right className={d.cancelled ? "text-red-600" : "text-slate-400"}>{d.cancelled || "—"}</Td>
                <Td className="min-w-32">
                  <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                    <div className={cn("h-full rounded-full", load >= 95 ? "bg-red-500" : load >= 60 ? "bg-amber-500" : "bg-emerald-500")} style={{ width: `${Math.min(100, load)}%` }} />
                  </div>
                  <span className="text-[11px] text-slate-500">{pct(load, 0)}</span>
                </Td>
              </Tr>
            );
          })}
        </tbody>
      </Table>
      <p className="mt-2 text-xs text-slate-500">Bandlik — kunlik quvvatga nisbatan hajm (Sozlamalar → kunlik quvvat: {fmtNum(capacity)} m³). Sanani bosib, o&apos;sha kungi zayavkalarni ko&apos;rasiz.</p>
    </div>
  );
}
