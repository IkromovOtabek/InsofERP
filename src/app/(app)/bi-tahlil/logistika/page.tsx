import Link from "next/link";
import { AlertTriangle, Clock, Coins, Gauge, Package, Timer, Truck, Wallet } from "lucide-react";
import { biContext, BiPage } from "../shell";
import { requirePage } from "@/lib/page-guard";
import { db } from "@/lib/db";
import { avgMin, cost, logisticsReport, onTimePct } from "@/lib/logistics-report";
import { ISSUE_KIND, minutesLabel } from "@/lib/logistics";
import { fmtNum, money, moneyShort } from "@/lib/format";
import { Empty, Section, StatCard, Table, Td, Th, Tr } from "@/components/ui";
import { SkladLogistika } from "@/app/(app)/dashboard/mechanic-home";
import { DayRangeBar, parseDayRange } from "../month-bar";

export const dynamic = "force-dynamic";

/** Hajm: m³ va dona birga — «120,5 m³ · 300 dona» */
const vol = (m3: number, pieces: number) => [m3 ? `${fmtNum(m3, 1)} m³` : "", pieces ? `${fmtNum(pieces)} dona` : ""].filter(Boolean).join(" · ") || "—";
const pctLabel = (p: number | null) => (p != null ? `${p}%` : "—");

/** Logistika tahlili — davr bo'yicha reys/hajm/o'z vaqtida/xarajat, pastda kunlik zayavka, jo'natish va transport ehtiyoji (texnika — Tahlil → Mexanik). */
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requirePage("/bi-tahlil/logistika");
  const { sp, range } = await biContext(searchParams);
  const period = parseDayRange(sp);
  const [rep, issues] = await Promise.all([
    logisticsReport(period.from, period.to),
    db.tripIssue.groupBy({ by: ["kind"], where: { createdAt: { gte: period.from, lt: period.to } }, _count: true }),
  ]);
  const t = rep.total;
  const onTime = onTimePct(t);
  const tCost = cost(t);
  // Bandlik — nasossiz, analitika sahifasidagi kabi
  const util = rep.byVehicle.filter((v) => v.type !== "PUMP");
  const avgUtil = util.length ? Math.round(util.reduce((a, v) => a + v.utilization, 0) / util.length) : null;
  const drivers = rep.byDriver.filter((d) => d.delivered > 0).slice(0, 10);
  const sites = rep.bySite.filter((s) => s.delivered > 0).slice(0, 10);
  const issueRows = issues.sort((a, b) => b._count - a._count);
  // Karta va «Muammo turlari» bir xil sanasin: davrda ochilgan muammolar
  const issueTotal = issueRows.reduce((a, i) => a + i._count, 0);

  // Davr parametrlari: Avtotransport havolasi va kunlik navigatsiya davrni yo'qotmasin
  const periodQs = new URLSearchParams(Object.entries({ davr: sp.davr, dan: sp.dan, gacha: sp.gacha, oy: sp.oy }).filter((kv): kv is [string, string] => !!kv[1])).toString();
  const withPeriod = (path: string) => (periodQs ? `${path}?${periodQs}` : path);

  return (
    <BiPage title="Logistika" subtitle="Davr tahlili (reys, hajm, o'z vaqtida, xarajat), bugungi va ertangi zayavkalar, jo'natish va transport ehtiyoji" tab="logistics" range={range} period={false}>
      <DayRangeBar base="/bi-tahlil/logistika" range={period} keep={{ date: sp.date }} />

      <Section title="Davr tahlili" className="mt-0"
        action={<Link href={withPeriod("/bi-tahlil/logistika/avtotransport")} className="text-[13px] font-medium text-blue-700 hover:underline">Har bir mashina — Avtotransport tahlili</Link>}>
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4 [&>*]:min-w-0">
          <StatCard label="Reyslar" value={`${fmtNum(t.delivered)} ta`} hint={`bekor ${fmtNum(t.cancelled)} ta`} icon={Truck} />
          <StatCard label="Yetkazilgan hajm" value={vol(t.m3, t.pieces)} icon={Package} />
          <StatCard label="O'z vaqtida" value={pctLabel(onTime)} hint={`kechikkan ${fmtNum(t.late)} ta`} icon={Clock}
            tone={onTime == null ? "default" : onTime >= 90 ? "success" : onTime >= 70 ? "warning" : "danger"} />
          <StatCard label="O'rtacha yetkazish" value={minutesLabel(avgMin(t))} hint="yuklashdan topshirishgacha" icon={Timer} />
          <StatCard label="Transport xarajati" value={moneyShort(tCost)} hint={`yoqilg'i ${moneyShort(t.fuel)} · boshqa ${moneyShort(t.other)}`} icon={Wallet} />
          <StatCard label="1 m³ ga xarajat" value={t.m3 > 0 ? money(tCost / t.m3) : "—"} icon={Coins} />
          <StatCard label="Transport bandligi" value={pctLabel(avgUtil)} hint={`ish kunlari: ${rep.workDays}`} icon={Gauge} />
          <StatCard label="Muammolar" value={`${fmtNum(issueTotal)} ta`} hint="davrda ochilgan" icon={AlertTriangle} tone={issueTotal > 0 ? "danger" : "default"} />
        </div>
      </Section>

      <div className="grid grid-cols-1 gap-x-5 xl:grid-cols-2 [&>*]:min-w-0">
        <Section title="Haydovchilar">
          {drivers.length ? (
            <Table>
              <thead><tr><Th>Haydovchi</Th><Th right>Reys</Th><Th right>Hajm</Th><Th right>O&apos;z vaqtida</Th><Th right>Km</Th></tr></thead>
              <tbody>
                {drivers.map((d) => (
                  <Tr key={d.id}>
                    <Td>{d.name}</Td>
                    <Td right>{fmtNum(d.delivered)}</Td>
                    <Td right>{vol(d.m3, d.pieces)}</Td>
                    <Td right>{pctLabel(onTimePct(d))}</Td>
                    <Td right>{d.km ? fmtNum(d.km) : "—"}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          ) : <Empty text="Davrda yetkazilgan reys yo'q" />}
        </Section>

        <Section title="Obyektlar">
          {sites.length ? (
            <Table>
              <thead><tr><Th>Obyekt</Th><Th right>Reys</Th><Th right>Hajm</Th><Th right>O&apos;z vaqtida</Th></tr></thead>
              <tbody>
                {sites.map((s) => (
                  <Tr key={s.id}>
                    <Td>{s.name}<div className="text-xs font-normal text-slate-500">{s.customer}</div></Td>
                    <Td right>{fmtNum(s.delivered)}</Td>
                    <Td right>{vol(s.m3, s.pieces)}</Td>
                    <Td right>{pctLabel(onTimePct(s))}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          ) : <Empty text="Davrda yetkazilgan reys yo'q" />}
        </Section>
      </div>

      {issueRows.length > 0 && (
        <Section title="Muammo turlari">
          <Table className="xl:max-w-xl">
            <thead><tr><Th>Turi</Th><Th right>Soni</Th></tr></thead>
            <tbody>
              {issueRows.map((i) => (
                <Tr key={i.kind}><Td>{ISSUE_KIND[i.kind]}</Td><Td right>{fmtNum(i._count)} ta</Td></Tr>
              ))}
            </tbody>
          </Table>
        </Section>
      )}

      <div className="mt-10">
        <SkladLogistika day={sp.date} unit={sp.birlik} base={withPeriod("/bi-tahlil/logistika")} />
      </div>
    </BiPage>
  );
}
