import Link from "next/link";
import { ClipboardList, Factory, Truck, Wallet, ShieldAlert, ArrowRight, Layers } from "lucide-react";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { customerDebt, customerMarks } from "@/lib/finance";
import { CustomerName } from "@/components/customer-name";
import { materialOutlook, mixerStatus, todayTrips } from "@/lib/dashboard";
import { money, qty, fmtNum } from "@/lib/format";
import { Badge, Callout, Card, Empty, Progress, Section, StatCard, Table, Td, Th, Tr } from "@/components/ui";
import { TripStatusBadge } from "../trips/status";
import { OrderStatusBadge } from "../orders/status";

function startOfToday() { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }
function endOfToday() { const d = startOfToday(); d.setDate(d.getDate() + 1); return d; }
const greeting = () => { const h = new Date().getHours(); return h < 12 ? "Xayrli tong" : h < 18 ? "Xayrli kun" : "Xayrli kech"; };

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ denied?: string }> }) {
  const { denied } = await searchParams;
  const s = await getSession();
  const today = startOfToday(), tomorrow = endOfToday();

  const [ordersToday, producedToday, receivableRows, blocked, materials, mixers, trips, upcoming] = await Promise.all([
    db.order.findMany({ where: { deliveryDate: { gte: today, lt: tomorrow }, status: { notIn: ["CANCELLED", "DRAFT"] } }, include: { items: true } }),
    db.productionBatch.aggregate({ where: { date: { gte: today }, product: { unit: "m3" } }, _sum: { qtyM3: true } }),
    db.customer.findMany({ where: { invoices: { some: { status: { in: ["OPEN", "PARTIAL"] } } } }, select: { id: true, name: true } }),
    db.order.count({ where: { status: "BLOCKED" } }),
    materialOutlook(),
    mixerStatus(),
    todayTrips(),
    db.order.findMany({ where: { status: { in: ["CONFIRMED", "IN_PRODUCTION"] } }, include: { customer: true, items: { include: { product: true } }, batches: true, trips: true }, orderBy: { deliveryDate: "asc" }, take: 8 }),
  ]);
  const debts = (await Promise.all(receivableRows.map(async (c) => ({ ...c, debt: await customerDebt(c.id) })))).filter((c) => c.debt > 0).sort((a, b) => b.debt - a.debt);
  const marks = await customerMarks([...debts.map((c) => c.id), ...trips.map((t) => t.order.customerId), ...upcoming.map((o) => o.customerId), ...mixers.map((m) => m.active?.customerId).filter((x): x is string => !!x)]);
  const receivable = debts.reduce((x, c) => x + c.debt, 0);
  const todayM3 = ordersToday.reduce((x, o) => x + o.items.reduce((y, i) => y + Number(i.qtyM3), 0), 0);
  const deliveredToday = trips.filter((t) => t.status === "DELIVERED" && t.deliveredAt && t.deliveredAt >= today).reduce((x, t) => x + Number(t.qtyM3), 0);
  const busyMixers = mixers.filter((m) => m.active).length;

  return (
    <div>
      <div className="mb-6 animate-fade-up">
        <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">Bosh sahifa</div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">{greeting()}, {s?.fullName.split(" ")[0]}</h1>
      </div>
      {denied && <Callout tone="warning">Bu sahifa sizning bo'limingizga tegishli emas.</Callout>}

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-5">
        <StatCard label="Bugungi zayavkalar" value={`${ordersToday.length}`} hint={`${qty(todayM3)} m³ rejada`} icon={ClipboardList} tone="info" href="/orders" />
        <StatCard label="Ishlab chiqarildi" value={`${qty(producedToday._sum.qtyM3 ?? 0)} m³`} hint="bugun" icon={Factory} tone="brand" href="/production" />
        <StatCard label="Yetkazildi" value={`${qty(deliveredToday)} m³`} hint={`${busyMixers} / ${mixers.length} mikser yo'lda`} icon={Truck} tone="success" href="/trips" />
        <StatCard label="Debitorka" value={money(receivable)} hint={debts.length ? `${debts.length} ta qarzdor` : "qarz yo'q"} icon={Wallet} tone={receivable > 0 ? "warning" : "default"} href="/invoices" />
        <StatCard label="Bloklangan" value={String(blocked)} hint="kredit limit" icon={ShieldAlert} tone={blocked > 0 ? "danger" : "default"} href="/orders?status=BLOCKED" />
      </div>

      <Section title="Mikserlar" action={<Link href="/vehicles" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-900">Texnika <ArrowRight size={14} /></Link>}>
        {mixers.length === 0 ? (
          <Card className="text-sm text-slate-500">Texnika kiritilmagan — Texnika sahifasida mikser qo'shing.</Card>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {mixers.map((m) => (
              <Card key={m.id} className={m.active ? "border-amber-300 ring-2 ring-amber-100" : ""}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2"><div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 text-slate-600"><Truck size={15} /></div><span className="font-semibold tabular">{m.plate}</span></div>
                  {m.active ? <TripStatusBadge status={m.active.status} /> : <Badge color="green">Bo'sh</Badge>}
                </div>
                {m.active ? (
                  <div className="mt-3 text-sm">
                    <Link href={`/trips/${m.active.id}`} className="font-medium hover:underline">{m.active.noteNo}</Link> · {m.active.qtyM3} m³
                    <div className="mt-0.5 truncate text-slate-500"><CustomerName name={m.active.customer} blacklisted={marks.black.has(m.active.customerId)} contracted={marks.contract.has(m.active.customerId)} short /></div>
                    <div className="truncate text-slate-500">{m.active.driver}</div>
                  </div>
                ) : <div className="mt-3 text-sm text-slate-500">Sig'imi {m.capacityM3 ? `${m.capacityM3} m³` : "—"}</div>}
                <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-2 text-xs text-slate-500"><span>Bugun</span><span className="tabular">{m.todayCount} reys · {qty(m.todayM3)} m³</span></div>
              </Card>
            ))}
          </div>
        )}
      </Section>

      <div className="mt-8 grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Section title="Bugungi reyslar" className="mt-0" action={<Link href="/trips" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-900">Hammasi <ArrowRight size={14} /></Link>}>
          <Table>
            <thead><tr><Th>Nakladnoy</Th><Th>Mijoz</Th><Th>Mikser</Th><Th right>m³</Th><Th>Holat</Th></tr></thead>
            <tbody>
              {trips.length === 0 && <Empty text="Bugun reys yo'q" icon={Truck} />}
              {trips.map((t) => (
                <Tr key={t.id}>
                  <Td><Link href={`/trips/${t.id}`} className="hover:underline">{t.deliveryNoteNo}</Link></Td>
                  <Td><CustomerName name={t.order.customer.name} blacklisted={marks.black.has(t.order.customerId)} contracted={marks.contract.has(t.order.customerId)} short /></Td><Td className="tabular">{t.vehicle.plate}</Td><Td right>{qty(t.qtyM3)}</Td><Td><TripStatusBadge status={t.status} /></Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Section>

        <Section title="Navbatdagi zayavkalar" className="mt-0" action={<Link href="/orders" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-900">Hammasi <ArrowRight size={14} /></Link>}>
          <Table>
            <thead><tr><Th>№</Th><Th>Mijoz</Th><Th>Marka</Th><Th className="w-40">Bajarilishi</Th><Th>Holat</Th></tr></thead>
            <tbody>
              {upcoming.length === 0 && <Empty text="Tasdiqlangan zayavka yo'q" icon={ClipboardList} />}
              {upcoming.map((o) => {
                const total = o.items.reduce((x, i) => x + Number(i.qtyM3), 0);
                const done = o.batches.reduce((x, b) => x + Number(b.qtyM3), 0);
                const shipped = o.trips.filter((t) => t.status !== "CANCELLED").reduce((x, t) => x + Number(t.qtyM3), 0);
                return (
                  <Tr key={o.id}>
                    <Td><Link href={`/orders/${o.id}`} className="hover:underline">{o.orderNo}</Link></Td>
                    <Td><CustomerName name={o.customer.name} blacklisted={marks.black.has(o.customerId)} contracted={marks.contract.has(o.customerId)} short /></Td><Td>{o.items.map((i) => i.product.code).join(", ")}</Td>
                    <Td>
                      <div className="space-y-1.5">
                        <div className="flex justify-between text-[11px] text-slate-500"><span>Ishlab ch.</span><span className="tabular">{qty(done)}/{qty(total)}</span></div><Progress value={done} max={total} tone="default" />
                        <div className="flex justify-between text-[11px] text-slate-500"><span>Jo'natildi</span><span className="tabular">{qty(shipped)}/{qty(total)}</span></div><Progress value={shipped} max={total} tone="success" />
                      </div>
                    </Td>
                    <Td><OrderStatusBadge status={o.status} /></Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        </Section>
      </div>

      <Section title="Xomashyo: necha kunga yetadi" action={<Link href="/stock" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-900">Sklad <ArrowRight size={14} /></Link>}>
        <Card padded={false}>
          <div className="border-b border-slate-100 px-5 py-3 text-xs text-slate-500">Kunlik sarf — so'nggi 30 kun o'rtachasi. Rejadagi ehtiyoj — tasdiqlangan, hali ishlab chiqarilmagan zayavkalar uchun retsept bo'yicha.</div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr><Th>Xomashyo</Th><Th right>Qoldiq</Th><Th right>Kunlik sarf</Th><Th className="w-48">Yetadi</Th><Th right>Rejadagi ehtiyoj</Th><Th>Holat</Th></tr></thead>
              <tbody>
                {materials.map((m) => {
                  const level = m.short || (m.days !== null && m.days < 3) || m.balance < m.minStock ? "danger" : m.days !== null && m.days < 7 ? "warning" : "success";
                  const badge = { danger: "red", warning: "amber", success: "green" } as const;
                  const label = m.short ? "Zayavkalarga yetmaydi" : m.balance < m.minStock ? "Minimaldan kam" : level === "warning" ? "Buyurtma bering" : "Yetarli";
                  return (
                    <Tr key={m.id}>
                      <Td><span className="inline-flex items-center gap-2"><Layers size={14} className="text-slate-400" />{m.name}</span></Td>
                      <Td right>{qty(m.balance)} <span className="text-slate-400">{m.unit}</span></Td>
                      <Td right className="text-slate-500">{m.perDay > 0 ? `${fmtNum(m.perDay, 1)} ${m.unit}` : "—"}</Td>
                      <Td>
                        {m.days === null ? <span className="text-slate-400">—</span> : (
                          <div className="space-y-1">
                            <div className={`text-[13px] font-semibold tabular ${level === "danger" ? "text-red-600" : level === "warning" ? "text-amber-600" : "text-slate-900"}`}>{m.days > 999 ? ">999" : fmtNum(m.days, 1)} kun</div>
                            <Progress value={Math.min(m.days, 30)} max={30} tone={level} />
                          </div>
                        )}
                      </Td>
                      <Td right className={m.short ? "text-red-600" : ""}>{m.planned > 0 ? `${qty(m.planned)} ${m.unit}` : "—"}</Td>
                      <Td><Badge color={badge[level]}>{label}</Badge></Td>
                    </Tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      </Section>

      {debts.length > 0 && (
        <Section title="Qarzdor mijozlar">
          <Table>
            <thead><tr><Th>Mijoz</Th><Th right>Qarz</Th></tr></thead>
            <tbody>{debts.map((c) => <Tr key={c.id}><Td><CustomerName name={c.name} blacklisted={marks.black.has(c.id)} contracted={marks.contract.has(c.id)} href={`/customers/${c.id}`} /></Td><Td right className="font-semibold text-red-600">{money(c.debt)}</Td></Tr>)}</tbody>
          </Table>
        </Section>
      )}
    </div>
  );
}
