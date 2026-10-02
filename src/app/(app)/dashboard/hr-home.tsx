import Link from "next/link";
import { AlertTriangle, ArrowRight, Cake, CalendarCheck, FileClock, IdCard, UserCheck, UserX, Users } from "lucide-react";
import { db } from "@/lib/db";
import { ATTENDANCE_MARKS, dayUtc, today as todayIso } from "@/lib/davomat";
import { date } from "@/lib/format";
import { Badge, Card, Section, StatCard } from "@/components/ui";

const DAY = 86400000;
/** Tug'ilgan kungacha necha kun qoldi (bugun — 0). Yil hisobga olinmaydi; 29-fevral kabisa bo'lmagan yilda 1-martga tushadi. */
function daysToBirthday(birth: Date, from: Date) {
  const next = new Date(from.getFullYear(), birth.getMonth(), birth.getDate());
  if (next < from) next.setFullYear(from.getFullYear() + 1);
  return Math.round((next.getTime() - from.getTime()) / DAY);
}
const left = (d: Date, from: Date) => Math.floor((d.getTime() - from.getTime()) / DAY);

/**
 * Otdel kadr (HR) bosh sahifasi: xodimlar soni, bugungi davomat (kelgan / kelmagan / belgilanmagan),
 * yaqin tug'ilgan kunlar, muddati o'tayotgan haydovchilik guvohnomalari va muddatli mehnat shartnomalari.
 * Ilgari HR bosh sahifada operatsion (debitorka, reyslar) ko'rinishni ko'rardi — bu uning ishi emas.
 */
export async function HrHome() {
  const now = new Date(); now.setHours(0, 0, 0, 0);
  const in30 = new Date(now.getTime() + 30 * DAY);
  const day = dayUtc(todayIso()); // Attendance.date — @db.Date (UTC yarim tuni)
  const [active, inactive, marks, birthdays, licenses, contracts] = await Promise.all([
    db.employee.count({ where: { isActive: true } }),
    db.employee.count({ where: { isActive: false } }),
    db.attendance.groupBy({ by: ["status"], where: { date: day, employee: { isActive: true } }, _count: { _all: true } }),
    db.employee.findMany({ where: { isActive: true, birthDate: { not: null } }, select: { id: true, fullName: true, position: true, birthDate: true, phone: true } }),
    db.employee.findMany({ where: { isActive: true, licenseExpiry: { lt: in30 } }, orderBy: { licenseExpiry: "asc" }, select: { id: true, fullName: true, position: true, licenseNo: true, licenseExpiry: true } }),
    db.hrDocument.findMany({
      where: { kind: "SHARTNOMA", fixedTerm: true, termUntil: { lt: in30 }, employee: { isActive: true } },
      orderBy: { termUntil: "asc" },
      select: { id: true, no: true, termUntil: true, employee: { select: { id: true, fullName: true, position: true } } },
    }),
  ]);
  const cnt = new Map(marks.map((m) => [m.status, m._count._all]));
  const present = cnt.get("PRESENT") ?? 0, absent = cnt.get("ABSENT") ?? 0;
  const marked = [...cnt.values()].reduce((s, v) => s + v, 0);
  const unmarked = Math.max(0, active - marked);
  const bdays = birthdays.map((e) => ({ ...e, inDays: daysToBirthday(e.birthDate!, now) })).filter((e) => e.inDays <= 14).sort((a, b) => a.inDays - b.inDays);
  // Bir xodimda bir nechta muddatli shartnoma bo'lsa — eng oxirgisi hisoblanadi (yangilangan bo'lishi mumkin)
  const lastContract = new Map<string, (typeof contracts)[number]>();
  for (const c of contracts) { const prev = lastContract.get(c.employee.id); if (!prev || (c.termUntil && prev.termUntil && c.termUntil > prev.termUntil)) lastContract.set(c.employee.id, c); }
  const ending = [...lastContract.values()];

  return (
    <div className="min-w-0 space-y-6">
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-5 [&>*]:min-w-0">
        <StatCard label="Faol xodimlar" value={String(active)} hint={inactive ? `${inactive} nofaol` : "hammasi faol"} icon={Users} tone="brand" href="/otdel-kadr" />
        <StatCard label="Bugun keldi" value={String(present)} hint={active ? `${Math.round((present / active) * 100)}% xodim` : "—"} icon={UserCheck} tone="success" href="/otdel-kadr?tab=davomat" />
        <StatCard label="Kelmadi (sababsiz)" value={String(absent)} hint={`ta'til/kasal/dam: ${marked - present - absent}`} icon={UserX} tone={absent ? "danger" : "default"} href="/otdel-kadr?tab=davomat" />
        <StatCard label="Belgilanmagan" value={String(unmarked)} hint="davomat hali qo'yilmagan" icon={CalendarCheck} tone={unmarked ? "warning" : "default"} href="/otdel-kadr?tab=davomat" />
        <StatCard label="Muddati yaqin hujjat" value={String(licenses.length + ending.length)} hint={`${licenses.length} guvohnoma · ${ending.length} shartnoma`} icon={AlertTriangle} tone={licenses.length + ending.length ? "warning" : "default"} />
      </div>

      <Card className="py-3">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-medium">Bugungi davomat:</span>
          {ATTENDANCE_MARKS.map((m) => <span key={m.value} className="inline-flex items-center gap-1 rounded-md bg-slate-50 px-2 py-0.5 text-xs">{m.label}: <b className="tabular">{cnt.get(m.value) ?? 0}</b></span>)}
          <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-2 py-0.5 text-xs text-amber-800">Belgilanmagan: <b className="tabular">{unmarked}</b></span>
          <Link href="/otdel-kadr?tab=davomat" className="ml-auto inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-900">Davomatni belgilash <ArrowRight size={14} /></Link>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3 [&>*]:min-w-0">
        <Section title="Tug'ilgan kunlar (14 kun)" className="mt-0">
          <Card>
            {bdays.length === 0 ? <div className="text-sm text-slate-500">Yaqin 14 kunda tug&apos;ilgan kun yo&apos;q.</div> : (
              <ul className="space-y-2 text-sm">
                {bdays.map((e) => (
                  <li key={e.id} className="flex items-start justify-between gap-2">
                    <span className="min-w-0"><Cake size={13} className="mr-1 inline text-pink-500" /><Link href={`/employees/${e.id}`} className="font-medium hover:underline">{e.fullName}</Link><span className="block text-xs text-slate-500">{e.position}{e.phone ? ` · ${e.phone}` : ""}</span></span>
                    <Badge color={e.inDays === 0 ? "green" : "slate"}>{e.inDays === 0 ? "Bugun" : e.inDays === 1 ? "Ertaga" : `${e.inDays} kundan keyin`}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </Section>

        <Section title="Haydovchilik guvohnomalari" className="mt-0">
          <Card>
            {licenses.length === 0 ? <div className="text-sm text-emerald-700">30 kun ichida muddati tugaydigan guvohnoma yo&apos;q.</div> : (
              <ul className="space-y-2 text-sm">
                {licenses.map((e) => { const d = left(e.licenseExpiry!, now); return (
                  <li key={e.id} className="flex items-start justify-between gap-2">
                    <span className="min-w-0"><IdCard size={13} className="mr-1 inline text-slate-400" /><Link href={`/employees/${e.id}`} className="font-medium hover:underline">{e.fullName}</Link><span className="block text-xs text-slate-500">{e.position}{e.licenseNo ? ` · ${e.licenseNo}` : ""} · {date(e.licenseExpiry!)}</span></span>
                    <Badge color={d < 0 ? "red" : d <= 7 ? "amber" : "slate"}>{d < 0 ? `${-d} kun o'tdi` : d === 0 ? "bugun" : `${d} kun`}</Badge>
                  </li>
                ); })}
              </ul>
            )}
          </Card>
        </Section>

        <Section title="Muddatli shartnomalar" className="mt-0">
          <Card>
            {ending.length === 0 ? <div className="text-sm text-emerald-700">30 kun ichida tugaydigan muddatli shartnoma yo&apos;q.</div> : (
              <ul className="space-y-2 text-sm">
                {ending.map((c) => { const d = left(new Date(c.termUntil!.getUTCFullYear(), c.termUntil!.getUTCMonth(), c.termUntil!.getUTCDate()), now); return (
                  <li key={c.id} className="flex items-start justify-between gap-2">
                    <span className="min-w-0"><FileClock size={13} className="mr-1 inline text-slate-400" /><Link href={`/employees/${c.employee.id}`} className="font-medium hover:underline">{c.employee.fullName}</Link><span className="block text-xs text-slate-500">{c.employee.position}{c.no ? ` · № ${c.no}` : ""} · {date(c.termUntil!)} gacha</span></span>
                    <Badge color={d < 0 ? "red" : d <= 7 ? "amber" : "slate"}>{d < 0 ? `${-d} kun o'tdi` : d === 0 ? "bugun" : `${d} kun`}</Badge>
                  </li>
                ); })}
              </ul>
            )}
          </Card>
        </Section>
      </div>
    </div>
  );
}
