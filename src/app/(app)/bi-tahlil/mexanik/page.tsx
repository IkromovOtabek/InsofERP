import Link from "next/link";
import { AlertTriangle, CheckCircle2, Clock, Factory, FileClock, Hammer, Truck, Wallet, Wrench } from "lucide-react";
import { biContext, BiPage } from "../shell";
import { requirePage } from "@/lib/page-guard";
import { MechanicTech } from "@/app/(app)/dashboard/mechanic-home";
import { DayRangeBar, parseDayRange } from "../month-bar";
import { mechanicReport } from "@/lib/mechanic-report";
import { VEHICLE_TYPE } from "@/lib/logistics";
import { mechanicCounts, mechanicList, mechSubject, MECH_STATUS_COLOR, MECH_STATUS_SHORT } from "@/lib/mechanic-requests";
import { date, fmtNum, money, moneyShort } from "@/lib/format";
import { Badge, Empty, Section, StatCard, Table, Td, Th, Tr } from "@/components/ui";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

// Hujjat muddati kartalari — MechanicTech dagi texnik xizmat kartalari bilan bir xil rang
const DOC_CLS = { crit: "border-red-200 bg-red-50/70 text-red-900", warn: "border-amber-200 bg-amber-50/70 text-amber-900" } as const;
const DOC_LABEL = { inspection: "Texnik ko'rik", insurance: "Sug'urta" } as const;

/** Mexanik tahlili — faqat texnika: davr bo'yicha ta'mir tahlili, ta'mir pul so'rovlari, ehtiyot qism zayavkalari, texnik xizmat. Zayavka/reys nazorati — Tahlil → Logistika. */
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requirePage("/bi-tahlil/mexanik");
  const { sp, range } = await biContext(searchParams);
  const period = parseDayRange(sp);
  const [r, c, open] = await Promise.all([mechanicReport(period.from, period.to), mechanicCounts(), mechanicList({ status: ["NEW", "APPROVED"], take: 10 })]);
  return (
    <BiPage title="Mexanik" subtitle="Texnika: ta'mir uchun pul so'rovlari, ehtiyot qism zayavkalari va texnik xizmat muddati" tab="mechanic" range={range} period={false}>
      <DayRangeBar base="/bi-tahlil/mexanik" range={period} />

      {/* ── Davr bo'yicha ta'mir tahlili ── */}
      <Section title="Ta'mir tahlili" className="mt-0">
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <StatCard label="Transport ta'miri" value={moneyShort(r.transport.sum)} hint={`${r.transport.count} ta yozuv · ta'mir + zapchast`} icon={Truck} tone="info" />
          <StatCard label="Zavod / boshqa ta'mir" value={moneyShort(r.factory.sum)} hint={`${r.factory.count} ta to'langan so'rov`} icon={Factory} tone="brand" />
          <StatCard label="Ta'mirdagi texnika" value={`${r.fleet.repair} ta`} hint={`saflda ${r.fleet.active} ta · hozirgi holat`} icon={Hammer} tone={r.fleet.repair ? "warning" : "default"} />
          <StatCard label="Buzilish / YTH" value={`${r.issues.count} ta`} hint={r.issues.open ? `${r.issues.open} tasi hal qilinmagan` : "hammasi hal qilingan"} icon={AlertTriangle} tone={r.issues.open ? "danger" : "default"} />
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
                  <Td className="tabular text-sm">{v.since ? <>{date(v.since)} <span className="text-slate-500">· {v.days} kun</span></> : "—"}</Td>
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
                <Td right>{v.repair ? money(v.repair) : "—"}</Td>
                <Td right>{v.parts ? money(v.parts) : "—"}</Td>
                <Td right className="font-semibold text-slate-900">{money(v.total)}</Td>
                <Td right>{v.issues ? fmtNum(v.issues) : "—"}</Td>
                <Td right>{v.services ? fmtNum(v.services) : "—"}</Td>
              </Tr>
            ))}
            {r.byVehicle.length > 0 && (
              <tr className="bg-slate-50 font-semibold text-slate-900">
                <Td>Jami</Td>
                <Td right>{money(r.totals.repair)}</Td>
                <Td right>{money(r.totals.parts)}</Td>
                <Td right>{money(r.totals.total)}</Td>
                <Td right>{fmtNum(r.totals.issues)}</Td>
                <Td right>{fmtNum(r.totals.services)}</Td>
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
                    <div className="text-xs text-slate-500">{date(r.createdAt)} · {r.createdBy.fullName}</div>
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
      <MechanicTech period={{ from: period.from, to: period.to, label: period.label, qs: new URLSearchParams(Object.entries({ davr: sp.davr, dan: sp.dan, gacha: sp.gacha }).filter((kv): kv is [string, string] => !!kv[1])).toString() }} />
    </BiPage>
  );
}
