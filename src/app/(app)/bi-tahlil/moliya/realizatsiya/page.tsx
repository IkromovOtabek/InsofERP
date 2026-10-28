import Link from "next/link";
import { requirePage } from "@/lib/page-guard";
import { canDo } from "@/lib/permissions";
import { realizatsiyaReport, MONTHS } from "@/lib/fin-report/realizatsiya";
import { date, fmtNum, isoDate, pct } from "@/lib/format";
import { Card, Input, Table, Td, Th, Tr } from "@/components/ui";
import { cn } from "@/lib/utils";
import { biContext, BiPage, type SP } from "../../shell";
import { SalesRecordForm } from "./forms";

export const dynamic = "force-dynamic";

/** «KUNLIK REALIZATSIYA HISOBOTI» — Sheets varag'idagi 5 bo'lim (`lib/fin-report/realizatsiya.ts`). */
const n0 = (v: number | null | undefined) => (v === null || v === undefined || Math.abs(v) < 0.005 ? "–" : fmtNum(v));
const n1 = (v: number | null | undefined) => (v === null || v === undefined || Math.abs(v) < 0.0005 ? "–" : fmtNum(v, 1));
const p1 = (v: number | null) => (v === null ? "–" : pct(v));
const tone = (v: number | null) => (v === null ? undefined : v >= 100 ? "text-emerald-600" : v >= 70 ? "text-amber-600" : "text-red-600");

function Block({ title, children, id }: { title: string; children: React.ReactNode; id?: string }) {
  return (
    <section id={id} className="min-w-0">
      <h3 className="mb-2 rounded-lg bg-slate-900 px-3 py-1.5 text-[12px] font-bold uppercase tracking-[0.08em] text-white">{title}</h3>
      {children}
    </section>
  );
}
const TotalTr = ({ children }: { children: React.ReactNode }) => <tr className="bg-slate-50 font-bold text-slate-900 [&>td]:border-t [&>td]:border-slate-200 [&>td]:px-4 [&>td]:py-2.5 [&>td:not(:first-child)]:whitespace-nowrap [&>td:not(:first-child)]:text-right">{children}</tr>;

function parseDay(s?: string): Date | undefined {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return undefined;
  const d = new Date(`${s}T00:00:00`);
  return Number.isNaN(d.getTime()) || d > new Date() ? undefined : d;
}

export default async function Page({ searchParams }: { searchParams: Promise<SP> }) {
  await requirePage("/bi-tahlil/moliya/realizatsiya");
  const { s, sp, range } = await biContext(searchParams);
  const r = await realizatsiyaReport(parseDay(sp.sana));
  const canEdit = canDo(s, "bi-tahlil", "plan");
  const base = "/bi-tahlil/moliya/realizatsiya";

  return (
    <BiPage title="Moliya" subtitle="Kunlik realizatsiya hisoboti — to'lov turi, hajm, reja va sotuvchilar" tab="finance" range={range} period={false}>
      <div className="space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-3 rounded-(--radius-card) border border-slate-200/80 bg-white px-4 py-3 shadow-(--shadow-card)">
          <div className="min-w-0">
            <div className="text-[15px] font-extrabold uppercase tracking-[0.06em] text-slate-900">Kunlik realizatsiya hisoboti</div>
            <div className="mt-1 flex flex-wrap gap-x-5 gap-y-1 text-[13px] text-slate-500">
              <span>Hisobot sanasi: <b className="text-slate-800">{date(r.day)}</b></span>
              <span>Bugungi ish kuni: <b className="text-slate-800">{r.wdPassed}</b></span>
              <span>Oydagi ish kuni: <b className="text-slate-800">{r.wdTotal}</b></span>
              <span>Ish tartibi: <b className="text-slate-800">{r.week}</b>{r.holidays.length > 0 && <> · bayramlar: {r.holidays.map((h) => `${h.date.slice(8)}.${h.date.slice(5, 7)} ${h.name}`).join(", ")}</>}</span>
            </div>
          </div>
          <form method="get" className="flex items-center gap-2">
            <Input type="date" name="sana" defaultValue={isoDate(r.day)} max={isoDate()} className="h-9 w-44" aria-label="Sana" />
            <button className="h-9 rounded-lg bg-slate-900 px-3 text-sm font-medium text-white hover:bg-slate-800">Ko&apos;rsatish</button>
            {!r.isToday && <Link href={base} className="h-9 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">Bugun</Link>}
          </form>
        </div>

        <Block title="1. To'lov turi bo'yicha summa (so'm)">
          <Table>
            <thead><tr><Th>To&apos;lov turi</Th><Th right>Summa QQSsiz</Th><Th right>Shu jumladan dostavka</Th><Th right>QQS 12%</Th><Th right>Bugun jami</Th><Th right>Oy boshidan jami</Th><Th right>Oydagi ulushi</Th></tr></thead>
            <tbody>
              {r.pay.map((p) => <Tr key={p.key}><Td>{p.label}</Td><Td right>{n0(p.net)}</Td><Td right>{n0(p.delivery)}</Td><Td right>{n0(p.vat)}</Td><Td right className="font-semibold">{n0(p.total)}</Td><Td right>{n0(p.month)}</Td><Td right>{pct(p.share)}</Td></Tr>)}
              <TotalTr><td>JAMI</td><td>{n0(r.payTotal.net)}</td><td>{n0(r.payTotal.delivery)}</td><td>{n0(r.payTotal.vat)}</td><td>{n0(r.payTotal.total)}</td><td>{n0(r.payTotal.month)}</td><td>{pct(r.payTotal.share)}</td></TotalTr>
              <tr className={cn("text-[13px] italic [&>td]:border-t [&>td]:border-slate-100 [&>td]:px-4 [&>td]:py-2", r.unset.month ? "text-red-600" : "text-slate-400")}>
                <td colSpan={4}>Nazorat: to&apos;lov turi yozilmagan{r.unset.orders ? ` (${r.unset.orders} ta zayavka — NDS bo'yicha taxminan joylandi)` : ""}</td>
                <td className="text-right">{n0(r.unset.today)}</td><td className="text-right">{n0(r.unset.month)}</td><td />
              </tr>
            </tbody>
          </Table>
        </Block>

        <Block title="2. Hajm va reja (sotilgan miqdor)">
          <Table>
            <thead><tr><Th>Mahsulot</Th><Th>O&apos;lchov</Th><Th right>Bugun</Th><Th right>Oy boshidan</Th><Th right>Rekord oy hajmi</Th><Th>Rekord oy</Th><Th right>Ish kuni</Th><Th right>Rekorddan %</Th><Th right>Oylik prognoz</Th><Th right>Kunlik reja</Th><Th right>Bugun reja %</Th></tr></thead>
            <tbody>
              {r.groups.length === 0 && <tr><td colSpan={11} className="px-4 py-3 text-sm text-slate-500">Oy boshidan yetkazilgan sotuv yo&apos;q</td></tr>}
              {r.groups.map((g) => (
                <Tr key={g.group}>
                  <Td>{g.group}</Td><Td>{g.unit}</Td><Td right>{n1(g.today)}</Td><Td right>{n1(g.month)}</Td>
                  <Td right className="bg-amber-50 font-semibold">{n1(g.record?.qty)}</Td>
                  <Td className="bg-amber-50 font-semibold">{g.record ? <>{g.record.label}{g.record.fromErp && <span className="ml-1.5 rounded bg-emerald-100 px-1.5 py-0.5 text-[11px] font-semibold text-emerald-700" title="ERP'dagi oy qo'lda kiritilgan rekorddan oshgan">ERP</span>}</> : "–"}</Td>
                  <Td right>{g.record?.workDays ?? "–"}</Td>
                  <Td right>{p1(g.recordPct)}</Td><Td right>{n1(g.forecast)}</Td><Td right>{n1(g.dayPlan)}</Td><Td right className={cn("font-semibold", tone(g.dayPct))}>{p1(g.dayPct)}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
          <p className="mt-2 text-[12.5px] text-slate-500">Kunlik reja = rekord hajmi ÷ rekord oy ish kuni. Oylik prognoz = oy boshidan ÷ {r.wdPassed} × {r.wdTotal} ish kuni.</p>
          {canEdit && (
            <Card className="mt-3">
              <div className="mb-3 text-sm font-semibold text-slate-800">Rekord oylar (ERP&apos;gacha bo&apos;lgan) — hajm, oy, ish kuni</div>
              <div className="space-y-2">
                {r.allGroups.map((g) => {
                  const m = r.groups.find((x) => x.group === g.group)?.manual;
                  return <SalesRecordForm key={g.group} group={g.group} unit={g.unit} qty={m?.qty ?? null} ym={m ? `${m.year}-${String(m.month).padStart(2, "0")}` : ""} workDays={m?.workDays ?? null} autoWd={m?.autoWorkDays ?? null} />;
                })}
              </div>
              <p className="mt-3 text-[12px] text-slate-400">ERP&apos;dagi biror oy shu rekorddan oshsa, hisobotda o&apos;sha oy rekord bo&apos;lib ko&apos;rinadi. Ish kuni bo&apos;sh — Dushanba–Shanba bo&apos;yicha.</p>
            </Card>
          )}
        </Block>

        <div className="grid gap-6 xl:grid-cols-2">
          <Block title="3. Realizatsiya rejasi (so'm, QQS bilan)">
            <Table>
              <thead><tr><Th>Ko&apos;rsatkich</Th><Th right>Oylik</Th><Th right>Bugun</Th></tr></thead>
              <tbody>
                <Tr><Td>Reja</Td><Td right className="bg-amber-50 font-semibold">{n0(r.plan.month)}</Td><Td right>{n0(r.plan.day)}</Td></Tr>
                <Tr><Td>Fakt</Td><Td right>{n0(r.plan.factMonth)}</Td><Td right>{n0(r.plan.factDay)}</Td></Tr>
                <Tr><Td>Bajarilish %</Td><Td right className={cn("font-semibold", tone(r.plan.pctMonth))}>{p1(r.plan.pctMonth)}</Td><Td right className={cn("font-semibold", tone(r.plan.pctDay))}>{p1(r.plan.pctDay)}</Td></Tr>
                <Tr><Td>Oylik prognoz %</Td><Td right className={cn("font-semibold", tone(r.plan.forecastPct))}>{p1(r.plan.forecastPct)}</Td><Td /></Tr>
                <Tr><Td>Prognoz summa</Td><Td right>{n0(r.plan.forecast)}</Td><Td /></Tr>
                <Tr><Td>O&apos;rtacha kunlik fakt</Td><Td right>{n0(r.plan.avgDay)}</Td><Td /></Tr>
              </tbody>
            </Table>
            <p className="mt-2 text-[12.5px] text-slate-500">Reja — <Link href="/bi-tahlil/reja" className="font-medium text-blue-600 hover:underline">Reja nazorati</Link>da ({MONTHS[r.day.getMonth()]} {r.day.getFullYear()}). Fakt — yetkazilgan mahsulot, dastavkasiz.</p>
          </Block>

          <Block title="4. Sotuvchilar (so'm, QQS bilan)">
            <Table>
              <thead><tr><Th>Sotuvchi</Th><Th right>Bugun</Th><Th right>Oy boshidan</Th><Th right>Oylik reja</Th><Th right>Bajarilish %</Th></tr></thead>
              <tbody>
                {r.sellers.length === 0 && <tr><td colSpan={5} className="px-4 py-3 text-sm text-slate-500">Sotuv va reja yo&apos;q</td></tr>}
                {r.sellers.map((x) => <Tr key={x.id}><Td>{x.name}</Td><Td right>{n0(x.today)}</Td><Td right>{n0(x.month)}</Td><Td right>{n0(x.plan)}</Td><Td right className={cn("font-semibold", tone(x.pct))}>{p1(x.pct)}</Td></Tr>)}
                <TotalTr><td>JAMI</td><td>{n0(r.sellersTotal.today)}</td><td>{n0(r.sellersTotal.month)}</td><td>{n0(r.sellersTotal.plan)}</td><td>{r.sellersTotal.plan ? pct((r.sellersTotal.month / r.sellersTotal.plan) * 100) : "–"}</td></TotalTr>
              </tbody>
            </Table>
          </Block>
        </div>

        <Block title="5. Shu kundagi sotuvlar ro'yxati" id="sotuvlar">
          <Table>
            <thead><tr><Th>To&apos;lov turi</Th><Th>Sotuvchi</Th><Th>Xaridor</Th><Th>Mahsulot</Th><Th>O&apos;lchov</Th><Th right>Miqdor</Th><Th right>Narx (QQSsiz)</Th><Th right>Dostavka</Th><Th right>Summa QQSsiz</Th><Th right>QQS</Th><Th right>Jami</Th><Th>Manzil</Th></tr></thead>
            <tbody>
              {r.rows.length === 0 && <tr><td colSpan={12} className="px-4 py-3 text-sm text-slate-500">Shu kuni yetkazilgan sotuv yo&apos;q</td></tr>}
              {r.rows.map((x, i) => (
                <Tr key={i}><Td>{x.payLabel}</Td><Td>{x.seller}</Td><Td>{x.customer}</Td><Td>{x.product}</Td><Td>{x.unit}</Td><Td right>{fmtNum(x.qty, 3)}</Td><Td right>{n0(x.price)}</Td><Td right>{n0(x.delivery)}</Td><Td right>{n0(x.net)}</Td><Td right>{n0(x.vat)}</Td><Td right className="font-semibold">{n0(x.total)}</Td><Td className="min-w-48 text-[13px] text-slate-500">{x.address}</Td></Tr>
              ))}
              {r.rows.length > 0 && <TotalTr><td colSpan={5}>JAMI</td><td /><td /><td>{n0(r.payTotal.delivery)}</td><td>{n0(r.payTotal.net)}</td><td>{n0(r.payTotal.vat)}</td><td>{n0(r.payTotal.total)}</td><td /></TotalTr>}
            </tbody>
          </Table>
        </Block>
      </div>
    </BiPage>
  );
}
