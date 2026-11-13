import Link from "next/link";
import { ArrowRight, Clock, Gift, PhoneCall, Scale, UserCheck, UserPlus, Users, Wallet } from "lucide-react";
import { requirePage } from "@/lib/page-guard";
import { canSeeStaffAttendance } from "@/lib/permissions";
import { pathAllowed } from "@/lib/nav";
import { hrOverview, type HrEvent } from "@/lib/overview/hr";
import { ATTENDANCE_MARKS, monthTitle } from "@/lib/davomat";
import { lateText } from "@/lib/attendance-time";
import { date, money } from "@/lib/format";
import { CALL_STATUS_BADGE, CALL_STATUS_LABEL, PAYROLL_KIND_LABEL, PAYROLL_STATUS_BADGE, PAYROLL_STATUS_LABEL } from "@/lib/hr/labels";
import { Badge, Callout, Card, Empty, PageHeader, Section, StatCard, Table, Td, Th, Tr, type BadgeColor } from "@/components/ui";
import { DayRangeBar, parseDayRange } from "@/app/(app)/bi-tahlil/month-bar";

export const dynamic = "force-dynamic";

const BASE = "/otdel-kadr/umumiy";

const EVENT: Record<HrEvent["kind"], { label: string; color: BadgeColor }> = {
  BIRTHDAY: { label: "Tug'ilgan kun", color: "violet" },
  CONTRACT: { label: "Shartnoma muddati", color: "amber" },
  LICENSE: { label: "Guvohnoma muddati", color: "amber" },
  LEAVE: { label: "Ta'til / kasallik", color: "blue" },
};
const whenText = (e: HrEvent) =>
  e.kind === "LEAVE" && e.days <= 0 ? "davom etmoqda" : e.days < 0 ? `${-e.days} kun o'tdi` : e.days === 0 ? "bugun" : e.days === 1 ? "ertaga" : `${e.days} kundan keyin`;

function More({ href, label = "Batafsil" }: { href: string; label?: string }) {
  return <Link href={href} className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-900">{label} <ArrowRight size={14} /></Link>;
}

/**
 * Otdel kadr — umumiy ko'rinish: bugungi holat va tanlangan davr (sukut — shu oy) bo'yicha bo'limning barcha muhim
 * raqamlari bitta joyda; har blokdan batafsil sahifaga havola. Ma'lumot — `lib/overview/hr.ts`.
 * Boshqa xodimlar davomati faqat direktor va otdel kadrga (`canSeeStaffAttendance`), ish haqi — `/ish-haqi` ochiq bo'lsa.
 */
export default async function HrOverviewPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requirePage(BASE);
  const sp = await searchParams;
  const period = parseDayRange(sp);
  const att = canSeeStaffAttendance(s.role);
  const canPay = pathAllowed("/ish-haqi", s.role, s.perms);
  const o = await hrOverview({ from: period.from, to: period.to, attendance: att, payroll: canPay });
  const mt = monthTitle(o.month);
  const jarimaHref = `/otdel-kadr?tab=jarima-bonus&oy=${o.month}`;
  const t = o.today?.totals;
  const markCount = t ? { PRESENT: t.present, ABSENT: t.absent, LEAVE: t.leave, SICK: t.sick, DAYOFF: t.dayoff } : null;
  const d = o.discipline;

  return (
    <div className="min-w-0">
      <PageHeader title="Otdel kadr — umumiy ko'rinish" subtitle="Xodimlar, davomat, jarima va bonus, ish haqi, qo'ng'iroqlar va kadr taqvimi — bugungi holat va tanlangan davr bo'yicha." />
      <DayRangeBar base={BASE} range={period} />

      <div className="space-y-6">
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4 [&>*]:min-w-0">
          <StatCard label="Faol xodimlar" value={o.headcount.active} hint={`${o.headcount.departments.length} bo'lim · ${o.headcount.positions} lavozim`} icon={Users} tone="brand" href="/otdel-kadr?tab=xodimlar" />
          <StatCard label="Qabul / bo'shatish" value={`+${o.movement.hires} / −${o.movement.fires}`} hint="tanlangan davrda" icon={UserPlus} tone={o.movement.fires > o.movement.hires ? "warning" : "success"} href="/otdel-kadr?tab=xodimlar&holat=hammasi" />
          {t && <StatCard label="Bugun keldi" value={t.present} hint={`${t.total} tadan · belgilanmagan ${t.notMarked}`} icon={UserCheck} tone="success" href="/otdel-kadr?tab=davomat" />}
          {d && <StatCard label="Davrda kechikish" value={d.totals.lateDays} hint={`${d.totals.lateMinutes ? lateText(d.totals.lateMinutes) : "kechikish yo'q"} · sababsiz kelmadi ${d.totals.absent}`} icon={Clock} tone={d.totals.lateDays || d.totals.absent ? "warning" : "default"} href={`/otdel-kadr?tab=davomat&oy=${o.month}`} />}
          <StatCard label={`Jarima — ${mt}`} value={money(o.fines.penalty)} hint={`${o.fines.penaltyPeople} xodimga`} icon={Scale} tone={o.fines.penalty ? "danger" : "default"} href={jarimaHref} />
          <StatCard label={`Bonus — ${mt}`} value={money(o.fines.bonus)} hint={`${o.fines.bonusPeople} xodimga`} icon={Gift} tone={o.fines.bonus ? "success" : "default"} href={jarimaHref} />
          {canPay && (
            <StatCard label={`Ish haqi — ${mt}`} value={o.pay.final ? PAYROLL_STATUS_LABEL[o.pay.final.status] : "Hisoblanmagan"}
              hint={o.pay.final ? `qo'lga ${money(o.pay.final.net)} · to'langan ${money(o.pay.final.paid)}` : "oy yakuni vedomosti yo'q"}
              icon={Wallet} tone={o.pay.final?.status === "PAID" ? "success" : o.pay.waiting ? "warning" : "default"} href={o.pay.final ? `/ish-haqi/${o.pay.final.id}` : "/ish-haqi"} />
          )}
          <StatCard label="Qo'ng'iroqlar" value={o.calls.total} hint={`ishga olindi ${o.calls.hired} · bugun keladi ${o.calls.visitsToday}`} icon={PhoneCall} tone="info" href={`/otdel-kadr?tab=qongiroqlar&oy=${o.month}`} />
        </div>

        {t && markCount ? (
          <Card className="py-3">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-medium">Bugungi davomat:</span>
              {ATTENDANCE_MARKS.map((mk) => <Badge key={mk.value} color={mk.color}>{mk.label}: {markCount[mk.value]}</Badge>)}
              <Badge color="amber">Kechikdi: {t.late}</Badge>
              <Badge color="violet">Ishda (ketmagan): {t.inside}</Badge>
              <Badge color="slate">Belgilanmagan: {t.notMarked}</Badge>
              <span className="ml-auto"><More href="/otdel-kadr?tab=davomat" label="Davomatni belgilash" /></span>
            </div>
          </Card>
        ) : (
          <Callout tone="info">Xodimlar davomati, ta&apos;til va kasalligi faqat direktor va otdel kadrga ko&apos;rinadi.</Callout>
        )}

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2 [&>*]:min-w-0">
          <Section title="Bo'limlar bo'yicha xodimlar" className="mt-0" action={<More href="/otdel-kadr?tab=bolimlar" />}>
            <Table>
              <thead><tr><Th>Bo&apos;lim</Th><Th right>Xodim</Th>{t && <><Th right>Bugun keldi</Th><Th right>Kechikdi</Th><Th right>Kelmadi</Th></>}</tr></thead>
              <tbody>
                {o.headcount.departments.length === 0 && <Empty text="Faol xodim yo'q" />}
                {o.headcount.departments.map((x) => (
                  <Tr key={x.name}>
                    <Td className="font-medium">{x.name}</Td>
                    <Td right>{x.count}</Td>
                    {t && <><Td right>{x.present}</Td><Td right className={x.late ? "text-amber-700" : "text-slate-400"}>{x.late}</Td><Td right className={x.absent ? "text-red-700" : "text-slate-400"}>{x.absent}</Td></>}
                  </Tr>
                ))}
              </tbody>
            </Table>
          </Section>

          <Section title="Kadr harakati — davr" className="mt-0" action={<More href="/otdel-kadr?tab=xodimlar&holat=hammasi" />}>
            <Table>
              <thead><tr><Th>Xodim</Th><Th>Harakat</Th><Th>Sana</Th><Th>Sabab</Th></tr></thead>
              <tbody>
                {o.movement.list.length === 0 && <Empty text="Davrda ishga qabul ham, bo'shatish ham yo'q" />}
                {o.movement.list.slice(0, 10).map((x) => (
                  <Tr key={x.key}>
                    <Td className="font-medium"><Link href={`/employees/${x.id}`} className="hover:underline">{x.fullName}</Link><div className="text-xs font-normal text-slate-500">{x.position}</div></Td>
                    <Td>{x.hire ? <Badge color="green">Qabul qilindi</Badge> : <Badge color="red">Bo&apos;shatildi</Badge>}</Td>
                    <Td>{date(x.date)}</Td>
                    <Td className="text-sm text-slate-600">{x.reason ?? "—"}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
            {o.movement.list.length > 10 && <p className="mt-2 text-xs text-slate-500">Yana {o.movement.list.length - 10} ta yozuv — batafsil sahifada.</p>}
          </Section>
        </div>

        {o.today && d && (
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-2 [&>*]:min-w-0">
            <Section title="Bugun: kechikkan va kelmaganlar" className="mt-0" action={<More href="/otdel-kadr?tab=davomat" />}>
              <Table>
                <thead><tr><Th>Xodim</Th><Th>Holat</Th><Th right>Keldi</Th><Th right>Kechikish</Th></tr></thead>
                <tbody>
                  {o.today.rows.length === 0 && <Empty text="Bugun kechikkan ham, sababsiz kelmagan ham yo'q" />}
                  {o.today.rows.slice(0, 10).map((r) => (
                    <Tr key={r.id}>
                      <Td className="font-medium">{r.fullName}<div className="text-xs font-normal text-slate-500">{r.position}</div></Td>
                      <Td>{r.status === "ABSENT" ? <Badge color="red">Kelmadi</Badge> : <Badge color="amber">Kechikdi</Badge>}</Td>
                      <Td right>{r.checkIn ?? "—"}</Td>
                      <Td right className="text-amber-700">{r.lateMin ? lateText(r.lateMin) : "—"}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
              {o.today.rows.length > 10 && <p className="mt-2 text-xs text-slate-500">Yana {o.today.rows.length - 10} ta xodim — davomat sahifasida.</p>}
            </Section>

            <Section title="Davr intizomi" className="mt-0" action={<More href={`/otdel-kadr?tab=davomat&oy=${o.month}`} label="Oylik tabel" />}>
              <Table>
                <thead><tr><Th>Xodim</Th><Th right>Kechikdi</Th><Th right>Jami kechikish</Th><Th right>Kelmadi</Th></tr></thead>
                <tbody>
                  {d.offenders.length === 0 && <Empty text="Davrda kechikish ham, sababsiz kelmaslik ham yo'q" />}
                  {d.offenders.map((x) => (
                    <Tr key={x.id}>
                      <Td className="font-medium">{x.fullName}<div className="text-xs font-normal text-slate-500">{x.position}</div></Td>
                      <Td right>{x.lateDays ? `${x.lateDays} kun` : "—"}</Td>
                      <Td right className="text-amber-700">{x.lateMinutes ? lateText(x.lateMinutes) : "—"}</Td>
                      <Td right className={x.absent ? "text-red-700" : ""}>{x.absent ? `${x.absent} kun` : "—"}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
              <p className="mt-2 text-xs text-slate-500">
                Belgilar: keldi {d.totals.present} · ta&apos;til {d.totals.leave} · kasal {d.totals.sick} · dam {d.totals.dayoff}
                {d.offenderCount > d.offenders.length ? ` · yana ${d.offenderCount - d.offenders.length} xodim` : ""}
              </p>
            </Section>
          </div>
        )}

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2 [&>*]:min-w-0">
          <Section title={`Jarima va bonuslar — ${mt}`} className="mt-0" action={<More href={jarimaHref} />}>
            <Table>
              <thead><tr><Th>Xodim</Th><Th right>Bonus</Th><Th right>Jarima</Th></tr></thead>
              <tbody>
                {o.fines.top.length === 0 && <Empty text="Bu oyda jarima ham, bonus ham yo'q" />}
                {o.fines.top.map((x) => (
                  <Tr key={x.id}>
                    <Td className="font-medium">{x.fullName}<div className="text-xs font-normal text-slate-500">{x.position}</div></Td>
                    <Td right className="text-emerald-700">{x.bonus ? money(x.bonus) : "—"}</Td>
                    <Td right className="text-red-700">{x.penalty ? money(x.penalty) : "—"}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
            <p className="mt-2 text-xs text-slate-500">Qoidalar (davomatdan), KPI va qo&apos;lda yozilganlar — oy yakuni vedomostiga shunday tushadi.</p>
          </Section>

          {canPay && (
            <Section title={`Ish haqi — ${mt}`} className="mt-0" action={<More href="/ish-haqi" />}>
              {(o.pay.waiting > 0 || o.pay.toPay > 0) && (
                <Callout tone="warning">
                  {o.pay.waiting > 0 && <div>Direktor tasdig&apos;ida: {o.pay.waiting} ta vedomost</div>}
                  {o.pay.toPay > 0 && <div>Kassadan to&apos;lanishi kerak: {money(o.pay.toPay)}</div>}
                </Callout>
              )}
              <Table>
                <thead><tr><Th>Vedomost</Th><Th>Holat</Th><Th right>Xodim</Th><Th right>Qo&apos;lga</Th><Th right>To&apos;langan</Th></tr></thead>
                <tbody>
                  {o.pay.runs.length === 0 && <Empty text="Bu oy uchun vedomost hali hisoblanmagan" />}
                  {o.pay.runs.map((r) => (
                    <Tr key={r.id}>
                      <Td className="font-medium"><Link href={`/ish-haqi/${r.id}`} className="text-brand-700 hover:underline">{r.docNo}</Link><div className="text-xs font-normal text-slate-500">{PAYROLL_KIND_LABEL[r.kind]}</div></Td>
                      <Td><Badge color={PAYROLL_STATUS_BADGE[r.status]}>{PAYROLL_STATUS_LABEL[r.status]}</Badge></Td>
                      <Td right>{r.lines}</Td>
                      <Td right className="font-medium">{money(r.net)}</Td>
                      <Td right>{money(r.paid)}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </Section>
          )}
        </div>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2 [&>*]:min-w-0">
          <Section title="Qo'ng'iroqlar jurnali — davr" className="mt-0" action={<More href={`/otdel-kadr?tab=qongiroqlar&oy=${o.month}`} />}>
            {o.calls.visitsToday > 0 && <Callout tone="warning">Bugun suhbatga keladi: {o.calls.visitsToday} kishi</Callout>}
            <Table>
              <thead><tr><Th>Suhbat natijasi</Th><Th right>Soni</Th></tr></thead>
              <tbody>
                {o.calls.byStatus.map((x) => (
                  <Tr key={x.status}>
                    <Td><Badge color={CALL_STATUS_BADGE[x.status]}>{CALL_STATUS_LABEL[x.status]}</Badge></Td>
                    <Td right>{x.count}</Td>
                  </Tr>
                ))}
                <Tr><Td className="font-semibold">Jami</Td><Td right className="font-semibold">{o.calls.total}</Td></Tr>
              </tbody>
            </Table>
            {o.calls.positions.length > 0 && (
              <p className="mt-2 text-xs text-slate-500">Ko&apos;p so&apos;ralgan lavozimlar: {o.calls.positions.map((p) => `${p.position} (${p.count})`).join(", ")}</p>
            )}
          </Section>

          <Section title="Kadr taqvimi — yaqin 30 kun" className="mt-0" action={<More href="/otdel-kadr?tab=taqvim" />}>
            <Table>
              <thead><tr><Th>Xodim</Th><Th>Voqea</Th><Th>Sana</Th><Th right>Qachon</Th></tr></thead>
              <tbody>
                {o.events.length === 0 && <Empty text="Yaqin 30 kunda kadr voqeasi yo'q" />}
                {o.events.slice(0, 12).map((e) => (
                  <Tr key={e.key}>
                    <Td className="font-medium"><Link href={`/employees/${e.employeeId}`} className="hover:underline">{e.fullName}</Link><div className="text-xs font-normal text-slate-500">{e.position}</div></Td>
                    <Td><Badge color={EVENT[e.kind].color}>{EVENT[e.kind].label}</Badge>{e.detail && <div className="mt-0.5 text-xs text-slate-500">{e.detail}</div>}</Td>
                    <Td>{date(e.date)}</Td>
                    <Td right><span className={e.days < 0 && e.kind !== "LEAVE" ? "text-red-700" : e.days <= 7 ? "text-amber-700" : "text-slate-500"}>{whenText(e)}</span></Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
            {o.events.length > 12 && <p className="mt-2 text-xs text-slate-500">Yana {o.events.length - 12} ta voqea — Kadr taqvimi va xodim kartalarida.</p>}
          </Section>
        </div>
      </div>
    </div>
  );
}
