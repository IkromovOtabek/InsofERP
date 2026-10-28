import Link from "next/link";
import { redirect } from "next/navigation";
import { CalendarDays, ChevronLeft, ChevronRight, Clock, Trash2 } from "lucide-react";
import { db } from "@/lib/db";
import { requirePage, requireRoles } from "@/lib/page-guard";
import { pathAllowed } from "@/lib/nav";
import { canDo } from "@/lib/permissions";
import { fmtNum } from "@/lib/format";
import { MONTHS } from "@/lib/fin-report/realizatsiya";
import { WEEKDAY_NAMES, countWorkDays, dayHours, dbDate, dbDateKey, monthKey, monthWorkDays, weekLabel, workCalendar } from "@/lib/work-calendar";
import { Badge, Card, CardHeader, Empty, PageHeader, Table, Td, Th, Tr } from "@/components/ui";
import { deleteCalendarDayAction } from "./actions";
import { CalendarDayForm, UzHolidaysButton, WorkWeekForm } from "./forms";

export const dynamic = "force-dynamic";

/**
 * Otdel kadr → «Ish tartibi va bayramlar»: haftalik tartib (6/1, 5/2…), ish vaqti, bayramlar va ko'chirilgan ish kunlari.
 * Hisobot va prognozlardagi ish kunlari shundan (`lib/work-calendar.ts`); davomat va ish haqi — xodim grafigi bo'yicha.
 */
export default async function IshTartibiPage({ searchParams }: { searchParams: Promise<{ yil?: string }> }) {
  const s = await requirePage("/settings/ish-tartibi");
  await requireRoles(["HR"]);
  if (!pathAllowed("/otdel-kadr", s.role, s.perms)) redirect("/dashboard?denied=1");
  const canEdit = canDo(s, "employees", "calendar");

  const curYear = new Date().getFullYear();
  const { yil } = await searchParams;
  const year = /^\d{4}$/.test(yil ?? "") && Number(yil) >= 2020 && Number(yil) <= 2100 ? Number(yil) : curYear;
  const [cal, days] = await Promise.all([
    workCalendar(),
    db.workCalendarDay.findMany({ where: { date: { gte: dbDate(`${year}-01-01`), lte: dbDate(`${year}-12-31`) } }, orderBy: { date: "asc" } }),
  ]);
  const months = MONTHS.map((name, i) => {
    const from = new Date(year, i, 1), to = new Date(year, i + 1, 1);
    const key = `${year}-${String(i + 1).padStart(2, "0")}`;
    const hol = days.filter((d) => d.kind === "HOLIDAY" && dbDateKey(d.date).startsWith(key)).length;
    return { name, work: monthWorkDays(cal, year, i + 1), auto: countWorkDays(cal, from, to), manual: cal.monthDays.has(monthKey(year, i + 1)), total: Math.round((to.getTime() - from.getTime()) / 86400000), hol };
  });
  const yearWork = months.reduce((a, m) => a + m.work, 0);
  const hours = dayHours(cal);
  const restText = [...cal.restDays].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map((d) => WEEKDAY_NAMES[d]!.toLowerCase()).join(", ") || "yo'q";
  const yearHref = (y: number) => `/settings/ish-tartibi?yil=${y}`;

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Otdel kadr" title="Ish tartibi va bayramlar"
        subtitle={`${weekLabel(cal.restDays)} · ${cal.workStart}–${cal.workEnd}${cal.lunchStart ? ` (tushlik ${cal.lunchStart}–${cal.lunchEnd})` : ""} · kuniga ${fmtNum(hours, 1)} soat · dam olish: ${restText}`} />

      <Card>
        <CardHeader icon={Clock} title="Haftalik ish tartibi va ish vaqti"
          description="Zavod standarti. Realizatsiya hisoboti, reja nazorati, Egasi paneli va logistika prognozlaridagi ish kunlari shundan hisoblanadi. Davomat va ish haqi xodimning o'z grafigi bo'yicha ishlaydi — bunga bog'lanmagan." />
        <WorkWeekForm restDays={[...cal.restDays]} workStart={cal.workStart} workEnd={cal.workEnd} lunchStart={cal.lunchStart} lunchEnd={cal.lunchEnd} disabled={!canEdit} />
        {!canEdit && <p className="mt-3 text-[13px] text-slate-500">Faqat ko&apos;rish: o&apos;zgartirish huquqi otdel kadrda (direktor Ruxsatlarda boshqaga berishi mumkin).</p>}
      </Card>

      <Card>
        <CardHeader icon={CalendarDays} title={`Bayramlar va ko'chirilgan kunlar — ${year}`}
          description="Bayram — ish kuni hisoblanmaydi. Ko'chirilgan ish kuni — dam olish kuni bo'lsa ham ishlanadi (hukumat qarori bilan ko'chirilgan kunlar)."
          action={<div className="flex items-center gap-1">
            <Link href={yearHref(year - 1)} aria-label="Oldingi yil" className="rounded-lg border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-50"><ChevronLeft size={16} /></Link>
            <span className="px-2 text-sm font-semibold tabular">{year}</span>
            <Link href={yearHref(year + 1)} aria-label="Keyingi yil" className="rounded-lg border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-50"><ChevronRight size={16} /></Link>
          </div>} />
        {canEdit && <div className="mb-4 space-y-3 rounded-lg border border-slate-100 bg-slate-50/60 p-3"><UzHolidaysButton year={year} /><CalendarDayForm year={year} /></div>}
        {days.length === 0 ? <Empty text={`${year}-yil uchun bayram kiritilmagan`} icon={CalendarDays} /> : (
          <Table>
            <thead><tr><Th>Sana</Th><Th>Hafta kuni</Th><Th>Turi</Th><Th>Nomi</Th>{canEdit && <Th />}</tr></thead>
            <tbody>
              {days.map((d) => {
                const k = dbDateKey(d.date), local = new Date(`${k}T00:00:00`);
                return (
                  <Tr key={d.id}>
                    <Td className="tabular">{`${k.slice(8)}.${k.slice(5, 7)}.${k.slice(0, 4)}`}</Td>
                    <Td>{WEEKDAY_NAMES[local.getDay()]}</Td>
                    <Td>{d.kind === "HOLIDAY" ? <Badge color="red">Bayram / dam olish</Badge> : <Badge color="green">Ko&apos;chirilgan ish kuni</Badge>}</Td>
                    <Td>{d.name ?? "—"}</Td>
                    {canEdit && <Td right><form action={deleteCalendarDayAction}><input type="hidden" name="id" value={d.id} /><button title="O'chirish" aria-label="O'chirish" className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"><Trash2 size={15} /></button></form></Td>}
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>

      <Card padded={false}>
        <div className="p-5 pb-0"><CardHeader icon={CalendarDays} title={`Oylar bo'yicha ish kunlari — ${year}`} description={`Yil bo'yicha jami ${yearWork} ish kuni, ${fmtNum(yearWork * hours, 0)} ish soati.`} /></div>
        <Table>
          <thead><tr><Th>Oy</Th><Th right>Kalendar kun</Th><Th right>Ish kuni</Th><Th right>Bayram</Th><Th right>Ish soati</Th></tr></thead>
          <tbody>
            {months.map((m) => <Tr key={m.name}><Td>{m.name}</Td><Td right>{m.total}</Td><Td right className="font-semibold">{m.work}{m.manual && <span className="ml-1 text-[11px] font-normal text-amber-700" title={`Qo'lda kiritilgan (Kunlik realizatsiya hisoboti → Reja); kalendar bo'yicha ${m.auto}`}>qo&apos;lda</span>}</Td><Td right>{m.hol || "–"}</Td><Td right>{fmtNum(m.work * hours, 0)}</Td></Tr>)}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}
