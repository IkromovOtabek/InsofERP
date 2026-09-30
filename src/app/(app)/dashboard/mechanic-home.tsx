import Link from "next/link";
import {
  AlertTriangle, ArrowRight, Bell, CalendarClock, CheckCircle2, ChevronLeft, ChevronRight, ClipboardList, Package, PackageCheck, PackageX, Send, Truck, Warehouse,
} from "lucide-react";
import { skladLogistika, type SlTone } from "@/lib/sklad-logistika";
import { date, fmtNum, isoDate } from "@/lib/format";
import { unitLabel } from "@/lib/unit";
import { Badge, Card, CardHeader, Empty, Section, StatCard, Table, Td, Th, Tr } from "@/components/ui";
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
  const d = await skladLogistika(day);
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
          <StatCard label="Kunlik zayavka" value={`${t.orders} ta`} hint={t.drafts ? `${t.drafts} tasi tasdiqlanmagan` : "bekor qilinganlarsiz"} icon={ClipboardList} tone="info" />
          <StatCard label="Zayavka bo'yicha mahsulot" value={t.volume} hint="bugun yetkaziladigan" icon={Package} tone="brand" href="/stock" />
          <StatCard label="Jo'natilgan" value={`${t.shipped} ta`} hint={t.shippedVolume} icon={Send} tone={t.shipped ? "success" : "default"} href="/trips" />
          <StatCard label="Qolgan zayavka" value={`${t.left} ta`} hint={t.leftVolume} icon={CalendarClock} tone={t.left ? "warning" : "success"} />
          <StatCard label="Muammoli / kechikkan" value={`${t.problem} ta`} hint={t.overdue ? `${t.overdue} tasi oldingi kunlardan` : "kechikish, blok, reys muammosi"} icon={AlertTriangle} tone={t.problem ? "danger" : "success"} />
        </div>
      </Section>

      {/* ── 2. Ertangi kun ── */}
      <Section title={`2. ${nextName} kun nazorati`} action={more("/logistika/transport", "Transport")}>
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-5">
          <StatCard label="Ertangi zayavka" value={`${n.orders} ta`} hint={n.drafts ? `${n.drafts} tasi tasdiqlanmagan` : date(d.next)} icon={ClipboardList} tone="info" />
          <StatCard label="Kerak bo'ladigan mahsulot" value={n.need} icon={Package} tone="brand" />
          <StatCard label="Skladda mavjud" value={n.available} hint="bugungi jo'natishdan keyin" icon={Warehouse} tone="default" href="/stock" />
          <StatCard label="Yetishmaydigan mahsulot" value={n.short} hint={n.shortCount ? `${n.shortCount} xil mahsulot` : "hammasi yetarli"} icon={n.shortCount ? PackageX : PackageCheck} tone={n.shortCount ? "danger" : "success"} />
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
        <Section title="3. Mahsulot bo'yicha nazorat" className="mt-0 xl:col-span-2" action={more("/stock", "Sklad")}>
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
            <div className="border-b border-slate-100 px-4 py-3"><CardHeader title={`${d.alerts.length} ta ogohlantirish`} icon={Bell} /></div>
            <div className="space-y-2 p-3">
              {d.alerts.length === 0 && (
                <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50/70 p-3 text-sm text-emerald-900"><CheckCircle2 size={16} /> Hammasi joyida — yetishmovchilik yo&apos;q</div>
              )}
              {d.alerts.map((a) => (
                <Link key={a.key} href={a.href} className={cn("block rounded-lg border p-3 text-sm transition hover:brightness-95", ALERT_CLS[a.tone])}>
                  <div className="font-semibold">{a.title}</div>
                  <div className="mt-0.5 text-[13px] opacity-90">{a.text}</div>
                </Link>
              ))}
            </div>
          </Card>
        </Section>
      </div>

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

      <Section title="Bugungi va kechikkan zayavkalar" action={more("/trips", "Reyslar")}>
        <Table>
          <thead><tr><Th>№</Th><Th>Mijoz</Th><Th>Vaqt</Th><Th>Mahsulot</Th><Th right>Jo&apos;natildi</Th><Th>Holat</Th></tr></thead>
          <tbody>
            {d.orders.length === 0 && <Empty text="Zayavka yo'q" icon={ClipboardList} />}
            {d.orders.map((o) => (
              <Tr key={o.id}>
                <Td className="font-medium">{o.orderNo}</Td>
                <Td className="max-w-56 truncate">{o.customer}</Td>
                <Td className="tabular">{o.time ?? "—"}</Td>
                <Td>{o.products}</Td>
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
