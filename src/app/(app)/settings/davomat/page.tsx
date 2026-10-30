import Link from "next/link";
import { redirect } from "next/navigation";
import { AlarmClock, ChevronLeft, ChevronRight, Users, Wallet } from "lucide-react";
import { db } from "@/lib/db";
import { requirePage, requireRoles } from "@/lib/page-guard";
import { pathAllowed } from "@/lib/nav";
import { dayUtc, monthDays, monthTitle, shiftMonth, today, validMonth } from "@/lib/davomat";
import { lateText } from "@/lib/attendance-time";
import { money } from "@/lib/format";
import { activeFine, fineText, getLateFine, monthFine } from "@/lib/hr/late-fine";
import { Badge, Callout, Card, CardHeader, Empty, PageHeader, StatCard, Table, Td, Th, Tr } from "@/components/ui";
import { LateFineForm } from "./late-fine-form";

/**
 * Sozlamalar → Davomat: kechikish jarimasi. Otdel kadr va direktor uchun (`lib/nav.ts` — /settings ostidagi alohida band).
 * Qoida `PayRule` da (`lib/hr/late-fine.ts`); pastda — tanlangan oyda kechikkanlar va ularga tushadigan jarima.
 */
export default async function DavomatSettingsPage({ searchParams }: { searchParams: Promise<{ oy?: string }> }) {
  const s = await requirePage("/settings/davomat");
  await requireRoles(["HR"], { module: "employees", actions: ["late_fine"] });
  // Direktor otdel kadr xodimiga "Xodimlar / kadr" modulini yopgan bo'lsa — davomat sozlamasi ham yopiq
  if (!pathAllowed("/otdel-kadr", s.role, s.perms)) redirect("/dashboard?denied=1");

  const cur = today().slice(0, 7);
  const { oy } = await searchParams;
  const month = validMonth(oy) && oy! <= cur ? oy! : cur;
  const days = monthDays(month);
  const [fine, late] = await Promise.all([
    getLateFine(),
    db.attendance.findMany({
      where: { date: { gte: dayUtc(days[0]!.iso), lte: dayUtc(days[days.length - 1]!.iso) }, status: "PRESENT", lateMinutes: { gt: 0 } },
      select: { employeeId: true, lateMinutes: true, employee: { select: { fullName: true, position: true } } },
    }),
  ]);
  const active = activeFine(fine);

  // Xodim bo'yicha: kechikkan kunlar, jami daqiqa, oylik jarima (chegara bilan)
  const byEmp = new Map<string, { fullName: string; position: string; mins: number[] }>();
  for (const a of late) {
    const e = byEmp.get(a.employeeId) ?? { fullName: a.employee.fullName, position: a.employee.position, mins: [] };
    e.mins.push(a.lateMinutes ?? 0);
    byEmp.set(a.employeeId, e);
  }
  const rows = [...byEmp.entries()]
    .map(([id, e]) => ({ id, ...e, days: e.mins.length, minutes: e.mins.reduce((n, m) => n + m, 0), ...monthFine(e.mins, fine) }))
    .sort((a, b) => b.total - a.total || b.minutes - a.minutes || a.fullName.localeCompare(b.fullName));
  const grand = { days: rows.reduce((n, r) => n + r.days, 0), minutes: rows.reduce((n, r) => n + r.minutes, 0), total: rows.reduce((n, r) => n + r.total, 0) };
  const href = (ym: string) => `/settings/davomat?oy=${ym}`;
  const back = s.role === "DIRECTOR" ? { href: "/settings?tab=limits", label: "Sozlamalar" } : { href: "/otdel-kadr?tab=davomat", label: "Davomat" };

  return (
    <div>
      <PageHeader back={back} eyebrow="Sozlamalar" title="Davomat sozlamalari" subtitle="Kechikish jarimasi — otdel kadr yoki direktor belgilaydi; tabel, xodimning o'z davomati va ish haqi hisobi shu qoidadan oladi." />

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label="Joriy qoida" value={active ? (active.perMinute ? `${money(active.amount)} / daqiqa` : `${money(active.amount)} / kun`) : "Jarima yo'q"} hint={fineText(fine)} icon={AlarmClock} tone={active ? "default" : "warning"} href="#jarima-qoidasi" />
        <StatCard label={`Kechikkanlar · ${monthTitle(month)}`} value={`${rows.length} xodim`} hint={grand.days ? `${grand.days} kun · ${lateText(grand.minutes)}` : "kechikish yo'q"} icon={Users} tone={rows.length ? "warning" : "success"} href="#kechikkanlar" />
        <StatCard label="Oylik jarima jami" value={active ? money(grand.total) : "—"} hint={active ? "faol qoida bo'yicha" : "qoida faol emas"} icon={Wallet} href="#kechikkanlar" />
      </div>

      <div className="space-y-4">
        <div id="jarima-qoidasi" className="scroll-mt-20"><Card>
          <CardHeader icon={AlarmClock} title="Kechikish jarimasi"
            description="Kechikish xodim smenasi boshlanishidan hisoblanadi (smena grafigi, bo'lmasa xodim kartasidagi ish vaqti). Qoida hamma xodimga bir xil; o'zgarish audit jurnaliga tushadi va faqat keyingi hisob-kitobga ta'sir qiladi." />
          <LateFineForm value={fine} />
          {!active && <Callout tone="info" title="Qoida faol emas">Jarima hisoblanmaydi — tabelda faqat kechikish daqiqalari ko&apos;rinadi. Summani kiritib «Qoida faol» ni belgilang.</Callout>}
        </Card></div>

        <div id="kechikkanlar" className="scroll-mt-20"><Card>
          <CardHeader icon={Users} title="Kechikkanlar"
            description="Tanlangan oyda kechikib kelgan xodimlar — tabeldagi saqlangan kechikish bo'yicha. Jarima joriy qoida bilan hisoblanadi."
            action={
              <div className="flex items-center gap-1">
                <Link href={href(shiftMonth(month, -1))} aria-label="Oldingi oy" className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 hover:text-slate-900"><ChevronLeft size={16} /></Link>
                <span className="min-w-[120px] text-center text-sm font-semibold text-slate-900">{monthTitle(month)}</span>
                {month < cur
                  ? <Link href={href(shiftMonth(month, 1))} aria-label="Keyingi oy" className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 hover:text-slate-900"><ChevronRight size={16} /></Link>
                  : <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-100 text-slate-300"><ChevronRight size={16} /></span>}
              </div>
            } />
          {rows.length === 0 ? <Empty text="Bu oyda kechikish yo'q" icon={Users} /> : (
            <Table>
              <thead><Tr><Th>Xodim</Th><Th right>Kechikkan kun</Th><Th right>Jami kechikish</Th>{active && <Th right>Jarima</Th>}</Tr></thead>
              <tbody>
                {rows.map((r) => (
                  <Tr key={r.id}>
                    <Td>
                      <Link href={`/employees/${r.id}`} className="font-medium text-slate-900 hover:underline">{r.fullName}</Link>
                      <div className="text-xs text-slate-500">{r.position}</div>
                    </Td>
                    <Td right>{r.days}</Td>
                    <Td right>{lateText(r.minutes)}</Td>
                    {active && <Td right><span className="font-semibold text-slate-900">{money(r.total)}</span>{r.capped && <> <Badge color="amber" dot={false}>chegara</Badge></>}</Td>}
                  </Tr>
                ))}
                <Tr className="bg-slate-50 font-semibold">
                  <Td>Jami</Td><Td right>{grand.days}</Td><Td right>{lateText(grand.minutes)}</Td>{active && <Td right>{money(grand.total)}</Td>}
                </Tr>
              </tbody>
            </Table>
          )}
        </Card></div>
      </div>
    </div>
  );
}
