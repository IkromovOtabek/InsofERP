import Link from "next/link";
import { CalendarCheck, ChevronLeft, ChevronRight } from "lucide-react";
import { myAttendanceMonth } from "@/lib/self-attendance";
import { ListError } from "@/lib/mobile/list";
import { hoursShort, hoursText, markOf } from "@/lib/davomat";
import { lateText } from "@/lib/attendance-time";
import { money } from "@/lib/format";
import { activeFine, fineFor, fineText, getLateFine, monthFine } from "@/lib/hr/late-fine";
import { Callout, Card, CardHeader, Table, Td, Th, Tr } from "@/components/ui";
import { cn } from "@/lib/utils";

/**
 * "Mening davomatim" — xodim vebda faqat O'Z davomatini ko'radi (mobil "Men" tabi bilan bir xil manba:
 * `myAttendanceMonth`, login bo'yicha). Umumiy tabel — faqat otdel kadr va direktorda (`/otdel-kadr?tab=davomat`).
 * Kechikish jarimasi faol bo'lsa — kun va oy bo'yicha summa ham ko'rinadi (`lib/hr/late-fine.ts`).
 */
export async function MyAttendanceCard({ userId, month }: { userId: string; month: string | null }) {
  let data: Awaited<ReturnType<typeof myAttendanceMonth>>;
  try {
    data = await myAttendanceMonth({ id: userId }, month);
  } catch (e) {
    if (e instanceof ListError && e.code === "NOT_LINKED") {
      return (
        <Card>
          <CardHeader icon={CalendarCheck} title="Mening davomatim" />
          <Callout tone="info" title="Davomat ko'rinmaydi">Loginingiz xodim kartasiga bog&apos;lanmagan — otdel kadrga murojaat qiling.</Callout>
        </Card>
      );
    }
    throw e;
  }
  const fine = await getLateFine();
  const active = activeFine(fine);
  const m = data.month;
  const total = monthFine(m.days.map((d) => d.lateMin), fine);
  const href = (ym: string) => `/hisobim?oy=${ym}`;
  const nav = "flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 hover:text-slate-900";

  return (
    <Card>
      <CardHeader icon={CalendarCheck} title="Mening davomatim"
        description={`Smena ${m.shift.start}–${m.shift.end}. ${active ? `Kechikish jarimasi: ${fineText(fine)}.` : "Kechikish jarimasi belgilanmagan."}`}
        action={
          <div className="flex items-center gap-1">
            <Link href={href(m.prev)} aria-label="Oldingi oy" className={nav}><ChevronLeft size={16} /></Link>
            <span className="min-w-[120px] text-center text-sm font-semibold text-slate-900">{m.title}</span>
            {m.next ? <Link href={href(m.next)} aria-label="Keyingi oy" className={nav}><ChevronRight size={16} /></Link>
              : <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-100 text-slate-300"><ChevronRight size={16} /></span>}
          </div>
        } />

      <div className="mb-3 flex flex-wrap gap-2 text-xs text-slate-600">
        <span className="rounded-md bg-slate-50 px-2 py-1">Keldi: <b className="tabular text-slate-900">{m.totals.present}</b> kun</span>
        <span className="rounded-md bg-slate-50 px-2 py-1">Ishladi: <b className="tabular text-slate-900">{hoursText(m.totals.minutes)}</b></span>
        {m.totals.absent > 0 && <span className="rounded-md bg-red-50 px-2 py-1 text-red-700">Kelmadi: <b className="tabular">{m.totals.absent}</b> kun</span>}
        {m.totals.sick + m.totals.leave + m.totals.dayoff > 0 && <span className="rounded-md bg-slate-50 px-2 py-1">Kasal / ta&apos;til / dam: <b className="tabular text-slate-900">{m.totals.sick + m.totals.leave + m.totals.dayoff}</b></span>}
        <span className={cn("rounded-md px-2 py-1", m.totals.lateDays ? "bg-amber-50 text-amber-800" : "bg-slate-50")}>Kechikish: <b className="tabular">{m.totals.lateDays ? `${m.totals.lateDays} kun · ${lateText(m.totals.lateMinutes)}` : "yo'q"}</b></span>
        {active && <span className={cn("rounded-md px-2 py-1", total.total ? "bg-red-50 text-red-700" : "bg-slate-50")}>Jarima: <b className="tabular">{money(total.total)}</b>{total.capped && " (oylik chegara)"}</span>}
      </div>

      <Table maxHeight={420}>
        <thead>
          <Tr><Th>Kun</Th><Th>Holat</Th><Th right>Keldi</Th><Th right>Ketdi</Th><Th right>Soat</Th><Th right>Kechikish</Th>{active && <Th right>Jarima</Th>}</Tr>
        </thead>
        <tbody>
          {m.days.map((d) => {
            const mk = d.status ? markOf(d.status) : null;
            const f = fineFor(d.lateMin, fine);
            return (
              <Tr key={d.date} className={cn(d.weekend && "bg-slate-50/60")}>
                <Td><span className="tabular font-medium text-slate-900">{d.day}</span> <span className="text-xs text-slate-500">{d.weekday}</span></Td>
                <Td>{mk ? <span className={cn("inline-flex h-6 items-center rounded px-1.5 text-[11px] font-semibold ring-1 ring-inset", mk.cell)}>{mk.label}</span> : <span className="text-slate-300">—</span>}</Td>
                <Td right>{d.checkIn ?? "—"}</Td>
                <Td right>{d.checkOut ?? "—"}</Td>
                <Td right>{d.minutes != null ? hoursShort(d.minutes) : "—"}</Td>
                <Td right className={d.lateMin ? "text-amber-700" : undefined}>{d.lateMin ? lateText(d.lateMin) : "—"}</Td>
                {active && <Td right className={f ? "text-red-700" : undefined}>{f ? money(f) : "—"}</Td>}
              </Tr>
            );
          })}
        </tbody>
      </Table>
      <p className="mt-2 text-xs text-slate-500">Belgini otdel kadr, sex boshlig&apos;i yoki yuz skaneri qo&apos;yadi; xato bo&apos;lsa otdel kadrga murojaat qiling.</p>
    </Card>
  );
}
