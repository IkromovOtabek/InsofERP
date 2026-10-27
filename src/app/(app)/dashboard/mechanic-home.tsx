import Link from "next/link";
import {
  AlertTriangle, ArrowRight, Bell, CalendarClock, CheckCircle2, ChevronLeft, ChevronRight, ClipboardList, Package, PackageCheck, PackageX, Send, ShoppingBasket, Truck, Warehouse,
} from "lucide-react";
import { db } from "@/lib/db";
import { SUPPLY_COLOR, SUPPLY_LABEL, SUPPLY_OWNER } from "@/lib/supply";
import { skladLogistika, type SlTone } from "@/lib/sklad-logistika";
import { vehicleServiceDue } from "@/lib/logistics";
import { TRIP_STEP } from "@/lib/trips";
import { date, fmtNum, isoDate } from "@/lib/format";
import { unitLabel } from "@/lib/unit";
import { Badge, Card, CardHeader, Empty, LinkButton, Section, StatCard, Table, Td, Th, Tr } from "@/components/ui";
import { cn } from "@/lib/utils";

const more = (href: string, text: string) => (
  <Link href={href} className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-900">{text} <ArrowRight size={14} /></Link>
);
const ALERT_CLS: Record<SlTone, string> = {
  danger: "border-red-200 bg-red-50/70 text-red-900",
  warning: "border-amber-200 bg-amber-50/70 text-amber-900",
  info: "border-blue-200 bg-blue-50/70 text-blue-900",
  success: "border-emerald-200 bg-emerald-50/70 text-emerald-900",
};
const q = (v: number, unit: string) => `${fmtNum(v, 2)} ${unitLabel(unit)}`;

/**
 * Mexanik bosh sahifasi — "ERP — Sklad & Logistika Dashboard" PDF bo'limlari tartibida:
 * bugungi nazorat → ertangi kun → mahsulot bo'yicha → avtomatik ogohlantirish → ish jarayoni.
 * Hamma raqam `skladLogistika()` dan — UI o'zi hisoblamaydi.
 */
export async function MechanicHome({ day, base = "/dashboard" }: { day?: string; base?: string }) {
  // Texnik xizmat muddati — logistika moduli hisoblaydi (`vehicleServiceDue`), bu yerda faqat ko'rsatiladi
  // Snabjenetsga zayavkalar (texnika ehtiyoji): bo'limi «Texnika» yoki mexanik yuborgani — hali yopilmaganlari
  const [d, service, supply] = await Promise.all([
    skladLogistika(day), vehicleServiceDue(),
    db.supplyRequest.findMany({
      where: { status: { in: ["NEW", "PRICED", "APPROVED", "FUNDED"] }, OR: [{ department: "Texnika" }, { createdBy: { role: "MECHANIC" } }] },
      orderBy: { date: "desc" }, take: 10,
      select: { id: true, docNo: true, date: true, status: true, needBy: true, items: { select: { name: true }, orderBy: { sortOrder: "asc" } }, createdBy: { select: { fullName: true } } },
    }),
  ]);
  const alerts = d.alerts;
  const t = d.today, n = d.tomorrow;
  const prev = new Date(d.day); prev.setDate(prev.getDate() - 1);
  const link = (x: Date) => `${base}${base.includes("?") ? "&" : "?"}date=${isoDate(x)}`;
  const dayName = d.isToday ? "Bugungi" : `${date(d.day)} —`;
  const nextName = d.isToday ? "Ertangi" : `${date(d.next)} —`;
  const flowMax = Math.max(1, d.flow[0]?.count ?? 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-1 text-sm">
        <Link href={link(prev)} className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100" aria-label="Oldingi kun"><ChevronLeft size={16} /></Link>
        <span className="font-medium tabular">{date(d.day)}</span>
        <Link href={link(d.next)} className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100" aria-label="Keyingi kun"><ChevronRight size={16} /></Link>
        {!d.isToday && <Link href={base} className="ml-2 text-xs text-blue-700 hover:underline">Bugun</Link>}
        {!d.isToday && <Badge>boshqa kun</Badge>}
      </div>

      {/* ── 1. Bugungi nazorat ── */}
      <Section title={`1. ${dayName} nazorat`} className="mt-0" action={more("/trips", "Reyslar")}>
        <div data-tour="stats" className="grid grid-cols-2 gap-3 xl:grid-cols-5">
          {/* Kunlik zayavka — son emas, hajm (m³ · dona); bosilsa pastdagi batafsil jadvalga o'tadi */}
          <StatCard label="Kunlik zayavka" value={t.volume} hint={`${t.orders} ta zayavka · batafsil ko'rish`} icon={ClipboardList} tone="info" href="#kunlik-zayavka" />
          <StatCard label="Zayavkalar soni" value={`${t.orders} ta`} hint={t.drafts ? `${t.drafts} tasi tasdiqlanmagan` : "bekor qilinganlarsiz"} icon={Package} tone="brand" href="#kunlik-zayavka" />
          <StatCard label="Jo'natilgan" value={`${t.shipped} ta`} hint={t.shippedVolume} icon={Send} tone={t.shipped ? "success" : "default"} href="/trips" />
          <StatCard label="Qolgan zayavka" value={`${t.left} ta`} hint={t.leftVolume} icon={CalendarClock} tone={t.left ? "warning" : "success"} href="#kunlik-zayavka" />
          <StatCard label="Muammoli / kechikkan" value={`${t.problem} ta`} hint={t.overdue ? `${t.overdue} tasi oldingi kunlardan` : "kechikish, blok, reys muammosi"} icon={AlertTriangle} tone={t.problem ? "danger" : "success"} href="#kunlik-zayavka" />
        </div>
      </Section>

      {/* ── 2. Ertangi kun ── */}
      <Section title={`2. ${nextName} kun nazorati`} action={more("/logistika/transport", "Transport")}>
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-5">
          <StatCard label="Ertangi zayavka" value={`${n.orders} ta`} hint={n.drafts ? `${n.drafts} tasi tasdiqlanmagan` : date(d.next)} icon={ClipboardList} tone="info" href={`${link(d.next)}#kunlik-zayavka`} />
          <StatCard label="Kerak bo'ladigan mahsulot" value={n.need} icon={Package} tone="brand" href="#mahsulot" />
          <StatCard label="Skladda mavjud" value={n.available} hint="bugungi jo'natishdan keyin" icon={Warehouse} tone="default" href="/stock" />
          <StatCard label="Yetishmaydigan mahsulot" value={n.short} hint={n.shortCount ? `${n.shortCount} xil mahsulot` : "hammasi yetarli"} icon={n.shortCount ? PackageX : PackageCheck} tone={n.shortCount ? "danger" : "success"} href="#mahsulot" />
          <StatCard
            label="Ertangi transport ehtiyoji" value={`${n.trips} ta mashina`}
            hint={[n.mixerTrips && `${n.mixerTrips} mikser`, n.truckTrips && `${n.truckTrips} yuk`, n.pumps && `${n.pumps} nasos`, `saflda ${n.vehicles.mixer + n.vehicles.truck}`].filter(Boolean).join(" · ")}
            icon={Truck} tone={n.trips > n.vehicles.mixer + n.vehicles.truck ? "warning" : "info"} href="/logistika/transport"
          />
        </div>
        <p className="mt-2 text-xs text-slate-500">
          Transport — reys soni: beton mikser sig&apos;imiga bo&apos;linadi, dona mahsulot zayavkasiga bitta yuk mashina. Biriktirilgan reys: {n.assigned} ta
          {n.vehicles.repair ? ` · ta'mirda ${n.vehicles.repair} ta texnika` : ""}.
        </p>
      </Section>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        {/* ── 3. Mahsulot bo'yicha ── */}
        <Section id="mahsulot" title="3. Mahsulot bo'yicha nazorat" className="mt-0 xl:col-span-2" action={more("/stock", "Sklad")}>
          <Table>
            <thead><tr><Th>Mahsulot</Th><Th right>Bugun</Th><Th right>Ertaga</Th><Th right>Skladda</Th><Th right>Holat</Th></tr></thead>
            <tbody>
              {d.products.length === 0 && <Empty text="Bugun va ertaga zayavka yo'q" icon={Package} />}
              {d.products.map((p) => {
                const short = p.balance < -0.001;
                const tight = !short && p.tomorrow > 0 && p.balance < p.tomorrow * 0.1;
                return (
                  <Tr key={p.id}>
                    <Td>
                      <Link href={`/stock/products/${p.id}`} className="font-medium hover:underline">{p.code}</Link>
                      <div className="text-xs text-slate-500">{p.name}</div>
                    </Td>
                    <Td right className="tabular">
                      {p.today ? q(p.today, p.unit) : "—"}
                      {p.todayLeft > 0.001 && p.todayLeft !== p.today && <div className="text-xs text-slate-500">qoldi {q(p.todayLeft, p.unit)}</div>}
                    </Td>
                    <Td right className="tabular">{p.tomorrow ? q(p.tomorrow, p.unit) : "—"}</Td>
                    <Td right className="tabular">
                      {q(p.onHand, p.unit)}
                      <div className="text-xs text-slate-500">{p.stocked ? (p.canMake ? `+${fmtNum(p.canMake, 0)} chiqarsa bo'ladi` : "hovlida") : "xomashyodan"}</div>
                    </Td>
                    <Td right>
                      {p.tomorrow === 0 ? <span className="text-slate-400">—</span>
                        : short ? <Badge color="red">{fmtNum(p.balance, 2)} {unitLabel(p.unit)}</Badge>
                        : <Badge color={tight ? "amber" : "green"}>Yetarli</Badge>}
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
          <p className="mt-2 text-xs text-slate-500">Skladda: dona mahsulot — hovlidagi qoldiq; beton — xomashyo qoldig&apos;i bilan retsept bo&apos;yicha chiqadigani. Holat = skladda − bugungi jo&apos;natilmagan − ertaga.</p>
        </Section>

        {/* ── 4. Avtomatik ogohlantirish ── */}
        <Section title="4. Avtomatik ogohlantirish" className="mt-0">
          <Card padded={false}>
            <div className="border-b border-slate-100 px-4 py-3"><CardHeader title={`${alerts.length} ta ogohlantirish`} icon={Bell} /></div>
            <div className="space-y-2 p-3">
              {alerts.length === 0 && (
                <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50/70 p-3 text-sm text-emerald-900"><CheckCircle2 size={16} /> Hammasi joyida — yetishmovchilik yo&apos;q</div>
              )}
              {alerts.map((a) => (
                <Link key={a.key} href={a.href} className={cn("block rounded-lg border p-3 text-sm transition hover:brightness-95", ALERT_CLS[a.tone])}>
                  <div className="font-semibold">{a.title}</div>
                  <div className="mt-0.5 text-[13px] opacity-90">{a.text}</div>
                </Link>
              ))}
            </div>
          </Card>
        </Section>
      </div>

      {/* ── Snabjenetsga zayavka: ehtiyot qism, moy, shina — sklad kabi «Kerakli mahsulotlar» jadvali ── */}
      <Section title="Snabjenetsga zayavkalar"
        action={<div className="flex items-center gap-3">{more("/taminot", "Hammasi")}<LinkButton href="/stock/supply/new" size="sm"><ShoppingBasket size={15} /> Zayavka yuborish</LinkButton></div>}>
        <Table>
          <thead><tr><Th>Hujjat</Th><Th>Nima kerak</Th><Th>Kerak sana</Th><Th>Holat</Th></tr></thead>
          <tbody>
            {supply.length === 0 && <Empty text="Ochiq zayavka yo'q — texnikaga kerakli narsani «Zayavka yuborish» orqali so'rang" icon={ShoppingBasket} />}
            {supply.map((r) => (
              <Tr key={r.id}>
                <Td>
                  <Link href={`/taminot/${r.id}`} className="font-medium tabular hover:underline">{r.docNo}</Link>
                  <div className="text-xs text-slate-500">{date(r.date)} · {r.createdBy.fullName}</div>
                </Td>
                <Td className="max-w-72 truncate text-sm">{r.items.map((i) => i.name).join(", ")}</Td>
                <Td className="tabular text-sm">{r.needBy ? date(r.needBy) : "—"}</Td>
                <Td><Badge color={SUPPLY_COLOR[r.status]}>{SUPPLY_LABEL[r.status]}</Badge><div className="mt-0.5 text-xs text-slate-500">{SUPPLY_OWNER[r.status]}</div></Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </Section>

      {/* ── Texnik xizmat muddati (moy, filtr, ko'rik…) ── */}
      <Section title="Texnik xizmat muddati" action={more("/logistika/transport", "Transport")}>
        {service.length === 0 ? (
          <Card className="flex items-center gap-2 text-sm text-emerald-800"><CheckCircle2 size={16} /> Muddati o&apos;tgan yoki 14 kun / 1000 km ichida keladigan texnik xizmat yo&apos;q</Card>
        ) : (
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3 [&>*]:min-w-0">
            {service.map((x) => (
              <Link key={x.serviceId} href={`/logistika/transport/${x.vehicleId}`} className={cn("block rounded-lg border p-3 text-sm transition hover:brightness-95", ALERT_CLS[x.level === "crit" ? "danger" : "warning"])}>
                <div className="flex items-center justify-between gap-2 font-semibold"><span className="tabular">{x.plate}</span><Badge color={x.level === "crit" ? "red" : "amber"}>{x.level === "crit" ? "Muddati o'tgan" : "Yaqinlashdi"}</Badge></div>
                <div className="mt-0.5 text-[13px] opacity-90">{x.text}</div>
                {(x.dueAt || x.dueKm != null) && <div className="mt-0.5 text-xs opacity-75">{x.dueAt ? `muddat ${date(x.dueAt)}` : ""}{x.dueAt && x.dueKm != null ? " · " : ""}{x.dueKm != null ? `${fmtNum(x.dueKm, 0)} km da` : ""}</div>}
              </Link>
            ))}
          </div>
        )}
      </Section>

      {/* ── 5. Asosiy ish jarayoni ── */}
      <Section title={`5. Ish jarayoni (${d.isToday ? "bugun" : date(d.day)})`}>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
          {d.flow.map((s, i) => (
            <div key={s.key} className="relative rounded-xl border border-slate-200 bg-white p-3 shadow-xs">
              <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-900 text-[11px] text-white">{i + 1}</span>{s.label}
              </div>
              <div className="mt-2 text-2xl font-semibold tabular">{s.count}</div>
              <div className="text-xs text-slate-500">{s.hint}</div>
              <div className="mt-2 h-1.5 rounded-full bg-slate-100">
                <div className={cn("h-1.5 rounded-full", s.key === "need" ? "bg-red-400" : "bg-emerald-500")} style={{ width: `${Math.min(100, (s.count / flowMax) * 100)}%` }} />
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section id="kunlik-zayavka" title={`Kunlik va kechikkan zayavkalar — batafsil (bugun: ${t.volume})`} action={more("/trips", "Reyslar")}>
        <Table>
          <thead><tr><Th>Mijoz</Th><Th>Vaqt</Th><Th>Mahsulot — necha m³ / dona</Th><Th>Qayerga</Th><Th>Kimdan (kiritgan)</Th><Th>Reyslar</Th><Th right>Jo&apos;natildi</Th><Th>Holat</Th></tr></thead>
          <tbody>
            {d.orders.length === 0 && <Empty text="Zayavka yo'q" icon={ClipboardList} />}
            {d.orders.map((o) => (
              <Tr key={o.id} className="align-top">
                <Td className="min-w-44">
                  <div className="font-semibold text-slate-900">{o.customer}</div>
                  {o.phone && <div className="text-xs font-normal text-slate-500">{o.phone}</div>}
                </Td>
                <Td className="tabular">{o.time ?? "—"}</Td>
                <Td className="min-w-52">
                  <ul className="space-y-0.5">
                    {o.items.map((i, k) => (
                      <li key={k} className="flex justify-between gap-3">
                        <span className="truncate" title={i.name}><b className="text-slate-900">{i.code}</b> <span className="text-slate-500">{i.name !== i.code ? i.name : ""}</span></span>
                        <span className="shrink-0 font-semibold tabular text-slate-900">{q(i.qty, i.unit)}</span>
                      </li>
                    ))}
                  </ul>
                  {o.items.length > 1 && <div className="mt-1 border-t border-slate-100 pt-1 text-right text-xs font-semibold text-slate-600">Jami: {o.volume}</div>}
                  {o.pump && <div className="mt-1"><Badge color="violet">Nasos kerak</Badge></div>}
                </Td>
                <Td className="min-w-48 text-[13px]">{o.address || "—"}{o.note && <div className="mt-0.5 text-xs text-slate-500">{o.note}</div>}</Td>
                <Td className="whitespace-nowrap text-[13px]">{o.createdBy}</Td>
                <Td className="min-w-40 text-[13px]">
                  {o.trips.length === 0 ? <span className="text-slate-400">biriktirilmagan</span> : (
                    <ul className="space-y-0.5">{o.trips.map((r, k) => <li key={k}><b className="tabular">{r.plate}</b> · {r.driver} <span className="text-slate-500">· {fmtNum(r.qty, 2)} · {TRIP_STEP[r.status] ?? r.status}</span></li>)}</ul>
                  )}
                </Td>
                <Td right className="tabular">{fmtNum(o.shipped, 2)} / {fmtNum(o.total, 2)}{o.unit ? ` ${unitLabel(o.unit)}` : ""}</Td>
                <Td>
                  <div className="flex flex-wrap gap-1">
                    <Badge color={o.done ? "green" : o.blocked ? "red" : o.late ? "amber" : "blue"}>{o.statusLabel}</Badge>
                    {o.late && !o.done && o.statusLabel !== "Muddati o'tgan" && <Badge color="amber">Kechikmoqda</Badge>}
                    {o.problem && <Badge color="red">Muammo</Badge>}
                  </div>
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </Section>
    </div>
  );
}
