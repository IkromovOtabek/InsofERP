import Link from "next/link";
import { AlertTriangle, CheckCircle2, Clock, Factory, FileClock, Hammer, Truck, Wallet, Wrench } from "lucide-react";
import { biContext, BiPage } from "../shell";
import { requirePage } from "@/lib/page-guard";
import { MechanicTech } from "@/app/(app)/dashboard/mechanic-home";
import { DayRangeBar, parseDayRange } from "../month-bar";
import { mechanicReport } from "@/lib/mechanic-report";
import { VEHICLE_TYPE } from "@/lib/logistics";
import { mechanicCounts, mechanicList, mechSubject, MECH_STATUS_COLOR, MECH_STATUS_SHORT } from "@/lib/mechanic-requests";
import { date, dateTime, fmtNum, money, moneyShort } from "@/lib/format";
import { Badge, Empty, Section, StatCard, Table, Td, Th, Tr } from "@/components/ui";
import { cn } from "@/lib/utils";
import { DRILL_LINK, DrillPanel } from "@/components/drill-panel";
import { MECH_DRILL_KINDS, mechDrill, type MechDrillKind } from "@/lib/mechanic-drill";

export const dynamic = "force-dynamic";

// Hujjat muddati kartalari — MechanicTech dagi texnik xizmat kartalari bilan bir xil rang
const DOC_CLS = { crit: "border-red-200 bg-red-50/70 text-red-900", warn: "border-amber-200 bg-amber-50/70 text-amber-900" } as const;
const DOC_LABEL = { inspection: "Texnik ko'rik", insurance: "Sug'urta" } as const;

/** Mexanik tahlili — faqat texnika: davr bo'yicha ta'mir tahlili, ta'mir pul so'rovlari, ehtiyot qism zayavkalari, texnik xizmat. Zayavka/reys nazorati — Tahlil → Logistika. */
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requirePage("/bi-tahlil/mexanik");
  const { sp, range } = await biContext(searchParams);
  const period = parseDayRange(sp);
  // Raqam manbasi: `drill` — ta'mir / zapchast / jami / zavod / buzilish / texnik xizmat, `v` — texnika («*» — jadval jami)
  const kind = MECH_DRILL_KINDS.find((k) => k === sp.drill) as MechDrillKind | undefined;
  const [r, c, open, drill] = await Promise.all([
    mechanicReport(period.from, period.to), mechanicCounts(), mechanicList({ status: ["NEW", "APPROVED"], take: 10 }),
    kind ? mechDrill(period.from, period.to, period.label, { kind, vehicle: sp.v }) : null,
  ]);
  const periodQs = Object.fromEntries(Object.entries({ davr: sp.davr, dan: sp.dan, gacha: sp.gacha }).filter((kv): kv is [string, string] => !!kv[1]));
  const dh = (k: MechDrillKind, v?: string) => `/bi-tahlil/mexanik?${new URLSearchParams({ ...periodQs, drill: k, ...(v ? { v } : {}) })}`;
  const close = `/bi-tahlil/mexanik${Object.keys(periodQs).length ? `?${new URLSearchParams(periodQs)}` : ""}`;
  const DL = ({ href, children }: { href: string; children: React.ReactNode }) => <Link href={href} scroll={false} title="Qayerdan kelgan — bosing" className={DRILL_LINK}>{children}</Link>;
  return (
    <BiPage title="Mexanik" info="Texnika: ta'mir uchun pul so'rovlari, ehtiyot qism zayavkalari va texnik xizmat muddati" tab="mechanic" range={range} period={false}>
      <DayRangeBar base="/bi-tahlil/mexanik" range={period} />

      {/* ── Davr bo'yicha ta'mir tahlili ── */}
      <Section title="Ta'mir tahlili" className="mt-0">
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <StatCard label="Transport ta'miri" value={moneyShort(r.transport.sum)} hint={`${r.transport.count} ta yozuv · ta'mir + zapchast`} icon={Truck} tone="info" href={dh("total")} />
          <StatCard label="Zavod / boshqa ta'mir" value={moneyShort(r.factory.sum)} hint={`${r.factory.count} ta to'langan so'rov`} icon={Factory} tone="brand" href={dh("factory")} />
          <StatCard label="Ta'mirdagi texnika" value={`${r.fleet.repair} ta`} hint={`safda ${r.fleet.active} ta · hozirgi holat`} icon={Hammer} tone={r.fleet.repair ? "warning" : "default"} />
          <StatCard label="Buzilish / YTH" value={`${r.issues.count} ta`} hint={r.issues.open ? `${r.issues.open} tasi hal qilinmagan` : "hammasi hal qilingan"} icon={AlertTriangle} tone={r.issues.open ? "danger" : "default"} href={dh("issues")} />
        </div>
      </Section>

      {r.inRepair.length > 0 && (
        <Section title="Ta'mirdagi texnika">
          <Table>
            <thead><tr><Th>Texnika</Th><Th>Turi</Th><Th>Sababi</Th><Th>Qachondan</Th></tr></thead>
            <tbody>
              {r.inRepair.map((v) => (
                <Tr key={v.id}>
                  <Td><Link href={`/logistika/transport/${v.id}`} className="font-medium tabular hover:underline">{v.plate}</Link></Td>
                  <Td>{VEHICLE_TYPE[v.type] ?? v.type}</Td>
                  <Td className="text-sm">{v.note || "—"}</Td>
                  <Td className="tabular text-sm">{v.since ? <>{dateTime(v.since)} <span className="text-slate-500">· {v.days} kun</span></> : "—"}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Section>
      )}

      <Section title="Texnika bo'yicha ta'mir xarajati">
        <Table>
          <thead><tr><Th>Texnika</Th><Th right>Ta&apos;mir</Th><Th right>Zapchast</Th><Th right>Jami</Th><Th right>Buzilishlar</Th><Th right>Texnik xizmat</Th></tr></thead>
          <tbody>
            {r.byVehicle.length === 0 && <Empty text="Bu davrda texnika ta'miri, buzilish yoki texnik xizmat yo'q" icon={Wrench} />}
            {r.byVehicle.map((v) => (
              <Tr key={v.id}>
                <Td><Link href={`/logistika/transport/${v.id}`} className="font-medium tabular hover:underline">{v.plate}</Link></Td>
                <Td right>{v.repair ? <DL href={dh("repair", v.id)}>{money(v.repair)}</DL> : "—"}</Td>
                <Td right>{v.parts ? <DL href={dh("parts", v.id)}>{money(v.parts)}</DL> : "—"}</Td>
                <Td right className="font-semibold text-slate-900">{v.total ? <DL href={dh("total", v.id)}>{money(v.total)}</DL> : money(0)}</Td>
                <Td right>{v.issues ? <DL href={dh("issues", v.id)}>{fmtNum(v.issues)}</DL> : "—"}</Td>
                <Td right>{v.services ? <DL href={dh("services", v.id)}>{fmtNum(v.services)}</DL> : "—"}</Td>
              </Tr>
            ))}
            {r.byVehicle.length > 0 && (
              <tr className="bg-slate-50 font-semibold text-slate-900">
                <Td>Jami</Td>
                <Td right>{r.totals.repair ? <DL href={dh("repair", "*")}>{money(r.totals.repair)}</DL> : money(0)}</Td>
                <Td right>{r.totals.parts ? <DL href={dh("parts", "*")}>{money(r.totals.parts)}</DL> : money(0)}</Td>
                <Td right>{r.totals.total ? <DL href={dh("total", "*")}>{money(r.totals.total)}</DL> : money(0)}</Td>
                <Td right>{r.totals.issues ? <DL href={dh("issues")}>{fmtNum(r.totals.issues)}</DL> : 0}</Td>
                <Td right>{r.totals.services ? <DL href={dh("services")}>{fmtNum(r.totals.services)}</DL> : 0}</Td>
              </tr>
            )}
          </tbody>
        </Table>
      </Section>

      {r.docs.length > 0 && (
        <Section title="Hujjat muddati">
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3 [&>*]:min-w-0">
            {r.docs.map((d) => (
              <Link key={`${d.vehicleId}-${d.doc}`} href={`/logistika/transport/${d.vehicleId}`} className={cn("block rounded-lg border p-3 text-sm transition hover:brightness-95", DOC_CLS[d.level])}>
                <div className="flex items-center justify-between gap-2 font-semibold"><span className="tabular">{d.plate}</span><Badge color={d.level === "crit" ? "red" : "amber"}>{d.level === "crit" ? "Muddati o'tgan" : "Yaqinlashdi"}</Badge></div>
                <div className="mt-0.5 flex items-center gap-1.5 text-[13px] opacity-90"><FileClock size={14} /> {DOC_LABEL[d.doc]}: {date(d.until)}</div>
              </Link>
            ))}
          </div>
        </Section>
      )}

      <Section title="Mexanik so'rovlari (ta'mir, ehtiyot qism uchun pul)"
        action={<Link href="/mexanik-sorovlar" className="text-sm text-slate-500 hover:text-slate-900">Hammasi</Link>}>
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <StatCard label="Tasdiq kutilmoqda" value={`${c.counts.NEW} ta`} hint={moneyShort(c.sums.NEW)} icon={Clock} tone={c.counts.NEW ? "warning" : "default"} href="/mexanik-sorovlar?tab=NEW" />
          <StatCard label="Kassa kutilmoqda" value={`${c.counts.APPROVED} ta`} hint={moneyShort(c.sums.APPROVED)} icon={Wallet} tone={c.counts.APPROVED ? "info" : "default"} href="/mexanik-sorovlar?tab=APPROVED" />
          <StatCard label="Pul berilgan" value={`${c.counts.PAID} ta`} hint={moneyShort(c.sums.PAID)} icon={CheckCircle2} tone="success" href="/mexanik-sorovlar?tab=PAID" />
          <StatCard label="Rad / bekor" value={`${c.counts.REJECTED + c.counts.CANCELLED} ta`} hint={`jami ${c.total} ta so'rov`} icon={Wrench} href="/mexanik-sorovlar?tab=REJECTED" />
        </div>
        <div className="mt-3">
          <Table>
            <thead><tr><Th>Hujjat</Th><Th>Nima uchun</Th><Th>Muammo</Th><Th right>Summa</Th><Th>Holat</Th></tr></thead>
            <tbody>
              {open.length === 0 && <Empty text="Ochiq so'rov yo'q" icon={Wrench} />}
              {open.map((r) => (
                <Tr key={r.id}>
                  <Td>
                    <Link href={`/mexanik-sorovlar/${r.id}`} className="font-medium tabular hover:underline">{r.docNo}</Link>
                    <div className="text-xs text-slate-500">{dateTime(r.createdAt)} · {r.createdBy.fullName}</div>
                  </Td>
                  <Td className="tabular">{mechSubject(r)}</Td>
                  <Td className="text-sm">{r.problem}{r.urgent && <span className="ml-1.5"><Badge color="red">Shoshilinch</Badge></span>}</Td>
                  <Td right className="tabular">{money(r.amount)}</Td>
                  <Td><Badge color={MECH_STATUS_COLOR[r.status]}>{MECH_STATUS_SHORT[r.status]}</Badge></Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </div>
      </Section>
      {drill && <DrillPanel drill={drill} closeHref={close} />}
      <MechanicTech period={{ from: period.from, to: period.to, label: period.label, qs: new URLSearchParams(Object.entries({ davr: sp.davr, dan: sp.dan, gacha: sp.gacha }).filter((kv): kv is [string, string] => !!kv[1])).toString() }} />
    </BiPage>
  );
}
