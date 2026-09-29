import Link from "next/link";
import {
  AlertTriangle, ArrowRight, CheckCircle2, ChevronLeft, ChevronRight, ClipboardList, Clock, Coins, Gauge, Layers, Route, Timer, Truck, Wrench,
} from "lucide-react";
import { logisticsDashboard, type DashOrder } from "@/lib/logistics-dashboard";
import { minutesLabel, VEHICLE_TYPE } from "@/lib/logistics";
import { date, fmtNum, isoDate, money, moneyShort, qty } from "@/lib/format";
import { Badge, Card, CardHeader, Empty, LinkButton, Progress, Section, StatCard, Table, Td, Th, Tr } from "@/components/ui";
import { LiveDrivers } from "../trips/live-drivers";
import { DelayText, LevelDot, OrderLogiBadge, PhaseBadge, TripLink, unitShort, VehicleLiveBadge } from "../logistika/ui";

/**
 * Logistika bosh sahifasi (Biton Logistika TZ, 3-bo'lim) — dispetcher va logistika rahbarining
 * bitta ekrani: bugungi reja, yo'ldagi mashinalar, kechikish, bo'sh transport, xarajat.
 * Raqamlar — `logisticsDashboard()` dan; bu fayl faqat chizadi.
 */

const hm = (d: Date | null) => (d ? `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}` : "—");

/** Kun jadvali (TZ 13): soat o'qi 06:00–22:00, har zayavka — qator, reyslar — bo'laklar. */
function Timeline({ orders, now, isToday }: { orders: DashOrder[]; now: Date; isToday: boolean }) {
  const H0 = 6, H1 = 22, span = (H1 - H0) * 60;
  const pos = (d: Date) => Math.max(0, Math.min(100, (((d.getHours() - H0) * 60 + d.getMinutes()) / span) * 100));
  const hours = Array.from({ length: (H1 - H0) / 2 + 1 }, (_, i) => H0 + i * 2);
  const nowPct = pos(now);
  const COLOR: Record<string, string> = {
    ASSIGNED: "bg-slate-300", LOADED: "bg-blue-500", ON_ROAD: "bg-amber-500", ARRIVED: "bg-violet-500", UNLOADING: "bg-violet-500", DELIVERED: "bg-emerald-500", CLOSED: "bg-emerald-600",
  };
  if (orders.length === 0) return <Empty text="Bu kunga dastavkali zayavka yo'q" />;
  return (
    <div className="overflow-x-auto">
      <div className="min-w-[720px]">
        <div className="relative ml-56 h-5 text-[11px] text-slate-400">
          {hours.map((h) => <span key={h} className="absolute -translate-x-1/2 tabular" style={{ left: `${((h - H0) / (H1 - H0)) * 100}%` }}>{String(h).padStart(2, "0")}</span>)}
        </div>
        <div className="divide-y divide-slate-100">
          {orders.map((o) => (
            <div key={o.id} className="flex items-center gap-2 py-1.5">
              <div className="w-54 shrink-0 truncate pr-2 text-xs">
                <Link href={`/orders/${o.id}`} className="font-medium text-slate-900 hover:underline">{o.orderNo}</Link>
                <span className="text-slate-500"> · {o.customer}</span>
                <div className="flex items-center gap-1 text-[11px] text-slate-500">
                  {o.deliveryTime ?? "soat yo'q"} · {qty(o.delivered)}/{qty(o.total)} {unitShort(o.unit)}
                  {o.isUrgent && <span className="font-semibold text-red-600">· shoshilinch</span>}
                  {o.needsPump && <span className="text-violet-700">· nasos</span>}
                </div>
              </div>
              <div className="relative h-6 flex-1 rounded bg-slate-50">
                {hours.map((h) => <span key={h} className="absolute top-0 h-full border-l border-slate-100" style={{ left: `${((h - H0) / (H1 - H0)) * 100}%` }} />)}
                {/* Rejadagi vaqt oynasi (±30 daq) — reyssiz qolgan qizil punktir */}
                {o.plannedAt && (
                  <span
                    className={`absolute top-0.5 h-5 rounded border ${o.remaining > 0.001 && !o.trips.length ? "border-dashed border-red-400 bg-red-50" : "border-slate-300"}`}
                    style={{ left: `${pos(new Date(o.plannedAt.getTime() - 30 * 60000))}%`, width: `${(60 / span) * 100}%` }}
                    title={`Reja: ${o.deliveryTime}`}
                  />
                )}
                {o.trips.map((t) => {
                  const a = t.loadedAt ?? t.plannedAt;
                  if (!a) return null;
                  const b = t.deliveredAt ?? (isToday && ["LOADED", "ON_ROAD"].includes(t.status) ? now : new Date(a.getTime() + 45 * 60000));
                  const l = pos(a), w = Math.max(1.2, pos(b) - l);
                  return (
                    <Link key={t.id} href={`/trips/${t.id}`} title={`${t.noteNo} · ${t.plate} · ${t.driver}`}
                      className={`absolute top-1 h-4 rounded ${COLOR[t.phase] ?? "bg-slate-300"} ${t.level === "crit" ? "ring-2 ring-red-500" : t.level === "warn" ? "ring-2 ring-amber-400" : ""}`}
                      style={{ left: `${l}%`, width: `${w}%` }} />
                  );
                })}
                {isToday && <span className="absolute top-0 h-full border-l-2 border-orange-500" style={{ left: `${nowPct}%` }} />}
              </div>
              <div className="w-44 shrink-0 text-right">
                {o.remaining > 0.001 && !["CANCELLED", "NEW"].includes(o.status)
                  ? <Link href={`/trips/new?orderId=${o.id}`} className="text-xs font-medium text-blue-700 hover:underline">+ Reys</Link>
                  : <OrderLogiBadge status={o.status} />}
              </div>
            </div>
          ))}
        </div>
        <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-slate-500">
          {[["bg-slate-300", "Yuklash kutilmoqda"], ["bg-blue-500", "Yuklandi"], ["bg-amber-500", "Yo'lda"], ["bg-violet-500", "Obyektda"], ["bg-emerald-500", "Yetkazildi"]].map(([c, l]) => (
            <span key={l} className="inline-flex items-center gap-1"><span className={`size-2.5 rounded-sm ${c}`} />{l}</span>
          ))}
          <span className="inline-flex items-center gap-1"><span className="h-2.5 w-4 rounded-sm border border-dashed border-red-400" />Reyssiz reja</span>
        </div>
      </div>
    </div>
  );
}

export async function LogisticsHome({ day }: { day?: Date }) {
  const d = await logisticsDashboard(day);
  const k = d.kpi;
  const now = new Date();
  const prev = new Date(d.day); prev.setDate(prev.getDate() - 1);
  const next = new Date(d.day); next.setDate(next.getDate() + 1);
  const link = (x: Date) => `/dashboard?view=logistics&date=${isoDate(x)}`;
  const onTripOrLoading = d.vehicles.filter((v) => ["ON_TRIP", "LOADING", "ASSIGNED", "RETURNING"].includes(v.live)).length;
  const maxWeek = Math.max(1, ...d.week.map((w) => w.m3));
  const pumpFleet = d.vehicles.filter((v) => v.type === "PUMP" && v.live !== "INACTIVE");

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1 text-sm">
          <Link href={link(prev)} className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100" aria-label="Oldingi kun"><ChevronLeft size={16} /></Link>
          <span className="font-medium tabular">{date(d.day)}</span>
          <Link href={link(next)} className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100" aria-label="Keyingi kun"><ChevronRight size={16} /></Link>
          {!d.isToday && <Link href="/dashboard?view=logistics" className="ml-2 text-xs text-blue-700 hover:underline">Bugun</Link>}
          {!d.isToday && <Badge>hisobot rejimi</Badge>}
        </div>
        <div className="flex flex-wrap gap-2">
          <LinkButton href="/logistika/kalendar" variant="secondary" size="sm"><Clock size={14} /> Kalendar</LinkButton>
          <LinkButton href="/trips/new" size="sm"><Route size={14} /> Yangi reys</LinkButton>
        </div>
      </div>

      {/* ── KPI (TZ 3-bo'lim: 9 ko'rsatkich) ── */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <StatCard label="Bugungi reyslar" value={k.trips} hint={`reja ${qty(k.planM3)} m³`} icon={ClipboardList} tone="info" href="/trips" />
        <StatCard label="Yo'ldagi transport" value={k.onRoad} hint={`${onTripOrLoading} band · ${k.totalVehicles} jami`} icon={Truck} tone="brand" href="/logistika/monitoring" />
        <StatCard label="Yakunlangan reyslar" value={k.done} hint={`${k.closed} tasi yopilgan`} icon={CheckCircle2} tone="success" href="/logistika/yetkazish" />
        <StatCard label="Kutayotgan buyurtmalar" value={k.waitingOrders} hint={k.waitingQty > 0 ? `${qty(k.waitingQty)} reysga berilmagan` : "hammasi biriktirilgan"} icon={Layers} tone={k.waitingOrders ? "warning" : "default"} href="/logistika/buyurtmalar?filter=waiting" />
        <StatCard label="Kechikayotgan reyslar" value={k.late} hint={k.onTimePct != null ? `o'z vaqtida: ${k.onTimePct}%` : `chegara ${d.settings.lateWarnMin} daq`} icon={AlertTriangle} tone={k.late ? "danger" : "default"} href="/trips?status=ON_ROAD" />
        <StatCard label="Bo'sh transport" value={`${k.freeVehicles} / ${k.totalVehicles}`} hint="reysga biriktirilmagan" icon={Gauge} tone={k.freeVehicles ? "success" : "warning"} href="/logistika/transport" />
        <StatCard label="Bugungi beton" value={`${qty(k.concreteM3)} m³`} hint={k.pieceQty ? `+ ${fmtNum(k.pieceQty)} dona mahsulot` : `rejadan ${k.planM3 ? Math.round((k.concreteM3 / k.planM3) * 100) : 0}%`} icon={Truck} tone="brand" href="/logistika/yetkazish" />
        <StatCard label="Transport xarajati" value={moneyShort(k.cost)} hint={k.cost ? `yoqilg'i ${moneyShort(k.fuelCost)}` : "bugun kiritilmagan"} icon={Coins} href="/logistika/xarajatlar?period=day" />
        <StatCard label="O'rtacha yetkazish" value={minutesLabel(k.avgDeliveryMin)} hint="yuklashdan topshirishgacha" icon={Timer} href="/logistika/analitika" />
      </div>

      {/* ── Ogohlantirishlar + jonli xarita ── */}
      <div className="grid gap-5 xl:grid-cols-5">
        <Card className="xl:col-span-2">
          <CardHeader title="Ogohlantirishlar" description={d.alerts.length ? `${d.alerts.length} ta — kritiklar yuqorida` : "Hammasi joyida"} icon={AlertTriangle} />
          {d.alerts.length === 0 ? (
            <p className="text-sm text-emerald-700">Kechikish, reyssiz zayavka yoki muammo yo'q.</p>
          ) : (
            <ul className="max-h-[420px] space-y-2 overflow-y-auto pr-1">
              {d.alerts.slice(0, 30).map((a, i) => (
                <li key={i}>
                  <Link href={a.href} className={`block rounded-lg border px-3 py-2 text-sm hover:shadow-sm ${a.level === "crit" ? "border-red-200 bg-red-50" : a.level === "warn" ? "border-amber-200 bg-amber-50" : "border-slate-200"}`}>
                    <div className="flex items-center gap-2 font-medium text-slate-900"><LevelDot level={a.level} />{a.title}</div>
                    <div className="mt-0.5 text-xs text-slate-600">{a.text}</div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <div className="xl:col-span-3">
          {d.isToday ? <LiveDrivers title="Jonli xarita" /> : <Card><p className="text-sm text-slate-500">Jonli xarita faqat bugungi kunda. O'tgan kun izi — reys kartasida.</p></Card>}
          {d.gpsError && <p className="mt-2 text-xs text-amber-700">ECO GPS: {d.gpsError}</p>}
        </div>
      </div>

      {/* ── Kun jadvali ── */}
      <Card>
        <CardHeader title="Kun jadvali" description="Zayavkalar soat bo'yicha: ramka — rejadagi vaqt, bo'laklar — reyslar (yuklashdan topshirishgacha)" icon={Clock}
          action={<Link href="/logistika/kalendar" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-900">Kalendar <ArrowRight size={14} /></Link>} />
        <Timeline orders={d.orders} now={now} isToday={d.isToday} />
      </Card>

      {/* ── Yo'ldagi reyslar ── */}
      <Section title="Faol reyslar" action={<Link href="/trips" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-900">Hammasi <ArrowRight size={14} /></Link>}>
        <Card padded={false}>
          <Table>
            <thead><tr><Th>Nakladnoy</Th><Th>Mijoz / obyekt</Th><Th>Transport</Th><Th>Bosqich</Th><Th>Reja</Th><Th>ETA</Th><Th>Kechikish</Th></tr></thead>
            <tbody>
              {d.trips.filter((t) => ["PLANNED", "LOADED", "ON_ROAD"].includes(t.status)).length === 0 && <Empty text="Faol reys yo'q" />}
              {d.trips.filter((t) => ["PLANNED", "LOADED", "ON_ROAD"].includes(t.status)).map((t) => (
                <Tr key={t.id}>
                  <Td><TripLink id={t.id} noteNo={t.noteNo} />{t.openIssues > 0 && <div><Badge color="red">muammo</Badge></div>}</Td>
                  <Td><div className="font-medium">{t.customer}</div><div className="max-w-[16rem] truncate text-xs text-slate-500">{t.address}</div></Td>
                  <Td><div className="tabular">{t.plate}</div><div className="text-xs text-slate-500">{t.driver}</div></Td>
                  <Td><PhaseBadge phase={t.phase} /></Td>
                  <Td className="tabular">{hm(t.plannedAt)}</Td>
                  <Td className="tabular">{t.fix?.etaMin != null && t.phase === "ON_ROAD" ? `${t.fix.etaMin} daq` : "—"}{t.fix?.remainingKm != null && t.phase === "ON_ROAD" ? <div className="text-xs text-slate-500">{t.fix.remainingKm.toFixed(1)} km</div> : null}</Td>
                  <Td><DelayText min={t.delayMin} level={t.level} /></Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Card>
      </Section>

      {/* ── Transport + haydovchilar ── */}
      <div className="grid gap-5 xl:grid-cols-2">
        <Card padded={false}>
          <div className="px-5 pt-5"><CardHeader title="Transport holati" description="Bandlik — smena ichida yuklashdan qaytishgacha o'tgan vaqt" icon={Wrench}
            action={<Link href="/logistika/transport" className="text-sm text-slate-500 hover:text-slate-900">Transport →</Link>} /></div>
          <Table>
            <thead><tr><Th>Raqam</Th><Th>Holat</Th><Th>Haydovchi</Th><Th right>Reys</Th><Th>Bandlik</Th></tr></thead>
            <tbody>
              {d.vehicles.filter((v) => v.live !== "INACTIVE").map((v) => {
                const shift = (d.settings.shiftEndHour - d.settings.shiftStartHour) * 60;
                return (
                  <Tr key={v.id}>
                    <Td><Link href={`/logistika/transport/${v.id}`} className="font-medium tabular hover:underline">{v.plate}</Link><div className="text-xs text-slate-500">{VEHICLE_TYPE[v.type]}{v.capacity ? ` · ${v.capacity} m³` : ""}{v.docs === "crit" ? " · hujjat o'tgan" : ""}</div></Td>
                    <Td><VehicleLiveBadge live={v.live} note={v.statusNote} />{v.trip && <div className="text-xs text-slate-500"><TripLink id={v.trip.id} noteNo={v.trip.noteNo} /></div>}</Td>
                    <Td className="text-sm">{v.driver ?? <span className="text-slate-400">—</span>}</Td>
                    <Td right className="tabular">{v.todayTrips}</Td>
                    <Td className="w-32"><Progress value={v.busyMin} max={shift} tone={v.busyMin / shift > 0.8 ? "success" : "default"} /><div className="text-[11px] text-slate-500 tabular">{Math.round((v.busyMin / shift) * 100)}%</div></Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        </Card>

        <Card padded={false}>
          <div className="px-5 pt-5"><CardHeader title="Haydovchilar (bugun)" icon={Truck} action={<Link href="/logistika/haydovchilar" className="text-sm text-slate-500 hover:text-slate-900">Haydovchilar →</Link>} /></div>
          <Table>
            <thead><tr><Th>Haydovchi</Th><Th right>Reys</Th><Th right>Hajm</Th><Th right>O'rt. vaqt</Th><Th right>Kechikish</Th><Th right>Muammo</Th></tr></thead>
            <tbody>
              {d.drivers.length === 0 && <Empty text="Bugun reys yo'q" />}
              {d.drivers.map((x) => (
                <Tr key={x.id}>
                  <Td><Link href={`/logistika/haydovchilar/${x.id}`} className="font-medium hover:underline">{x.name}</Link>{x.active && <span className="ml-1.5 text-xs text-amber-700">· yo'lda</span>}</Td>
                  <Td right className="tabular">{x.trips}</Td>
                  <Td right className="tabular">{qty(x.qty)}</Td>
                  <Td right className="tabular">{minutesLabel(x.avgMin)}</Td>
                  <Td right className={x.late ? "font-medium text-amber-700" : "text-slate-400"}>{x.late}</Td>
                  <Td right className={x.issues ? "font-medium text-red-700" : "text-slate-400"}>{x.issues}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Card>
      </div>

      {/* ── Tendensiya + nasoslar ── */}
      <div className="grid gap-5 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="So'nggi 14 kun" description="Kunlik yetkazilgan beton (m³) va o'z vaqtida yetkazish foizi" icon={Gauge} />
          <div className="flex h-40 items-end gap-1.5">
            {d.week.map((w) => (
              <div key={w.day.toISOString()} className="flex flex-1 flex-col items-center gap-1" title={`${date(w.day)}: ${qty(w.m3)} m³, ${w.trips} reys${w.onTime != null ? `, o'z vaqtida ${w.onTime}%` : ""}`}>
                <span className="text-[10px] text-slate-500 tabular">{w.m3 ? Math.round(w.m3) : ""}</span>
                <div className={`w-full rounded-t ${w.onTime != null && w.onTime < 75 ? "bg-amber-400" : "bg-slate-800"}`} style={{ height: `${Math.max(2, (w.m3 / maxWeek) * 110)}px` }} />
                <span className="text-[10px] text-slate-400 tabular">{w.day.getDate()}</span>
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs text-slate-500">Sariq ustun — o'z vaqtida yetkazish 75% dan past kun.</p>
        </Card>
        <Card>
          <CardHeader title="Nasoslar" description={`Nasos kerak: ${d.pumps.length} zayavka · nasoslar: ${pumpFleet.filter((v) => v.live === "FREE").length} bo'sh / ${pumpFleet.length}`} icon={Truck} />
          {d.pumps.length === 0 ? <p className="text-sm text-slate-500">Nasos kerak bo'lgan ochiq zayavka yo'q.</p> : (
            <ul className="space-y-2 text-sm">
              {d.pumps.map((p) => (
                <li key={p.orderId} className="flex items-center justify-between gap-2">
                  <span><Link href={`/orders/${p.orderId}`} className="font-medium hover:underline">{p.orderNo}</Link> <span className="text-slate-500">· {p.customer}</span></span>
                  <span className="tabular text-slate-600">{p.time ?? "—"}</span>
                </li>
              ))}
            </ul>
          )}
          {d.pumps.length > pumpFleet.filter((v) => v.live === "FREE" || v.live === "IDLE").length && <p className="mt-2 text-xs font-medium text-amber-700">Nasos yetishmasligi mumkin — ijaraga oling yoki vaqtni suring.</p>}
          <p className="mt-3 text-xs text-slate-500">Xarajat bugun: {money(k.cost)}</p>
        </Card>
      </div>
    </div>
  );
}
