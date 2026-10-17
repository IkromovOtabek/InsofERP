import Link from "next/link";
import { BarChart3, FileSpreadsheet, Megaphone, MessageSquare, Plus } from "lucide-react";
import { db } from "@/lib/db";
import type { Session } from "@/lib/auth";
import { canDo } from "@/lib/permissions";
import { date, dateTime, money } from "@/lib/format";
import { monthOf, monthTitle, shiftMonth, today, validMonth } from "@/lib/davomat";
import { broadcastStats, listFeedback } from "@/lib/hr/voice";
import { hrReport } from "@/lib/hr/reports";
import { Badge, Card, CardHeader, Empty, LinkButton, StatCard, Table, Td, Th, Tr } from "@/components/ui";
import { cn } from "@/lib/utils";
import { BroadcastForm, SurveyForm } from "./hr4-forms";
import type { FeedbackStatus } from "@/generated/prisma";

export const FEEDBACK_KIND_LABEL = { COMPLAINT: "Shikoyat", SUGGESTION: "Taklif", QUESTION: "Savol", THANKS: "Minnatdorchilik" } as const;
export const FEEDBACK_STATUS_LABEL: Record<FeedbackStatus, string> = { NEW: "Yangi", IN_REVIEW: "Ko'rib chiqilmoqda", RESOLVED: "Hal qilindi" };
export const FEEDBACK_STATUS_BADGE: Record<FeedbackStatus, "amber" | "blue" | "green"> = { NEW: "amber", IN_REVIEW: "blue", RESOLVED: "green" };
const SURVEY_STATUS = { DRAFT: ["Qoralama", "slate"], OPEN: ["Ochiq", "green"], CLOSED: ["Yopilgan", "slate"] } as const;

// ───────────────────────── So'rovnomalar ─────────────────────────

export async function SorovnomaTab({ s, positions }: { s: Session; positions: string[] }) {
  const editable = canDo(s, "employees", "voice", ["HR"]);
  const list = await db.survey.findMany({ orderBy: { createdAt: "desc" }, take: 60, include: { _count: { select: { responses: true } } } });
  return (
    <div className="space-y-4">
      <Card padded={false}>
        <Table>
          <thead><tr><Th>So&apos;rovnoma</Th><Th>Kimga</Th><Th right>Javoblar</Th><Th>Holat</Th></tr></thead>
          <tbody>
            {list.length === 0 && <Empty text="So'rovnoma hali yo'q" />}
            {list.map((x) => (
              <Tr key={x.id}>
                <Td className="font-medium"><Link href={`/otdel-kadr/sorovnoma/${x.id}`} className="hover:underline">{x.title}</Link><div className="text-xs font-normal text-slate-500">{x.anonymous ? "anonim" : "ismli"} · {date(x.createdAt)}{x.closesAt ? ` · ${date(x.closesAt)} gacha` : ""}</div></Td>
                <Td>{x.position ?? "Hamma"}</Td>
                <Td right>{x._count.responses}</Td>
                <Td><Badge color={SURVEY_STATUS[x.status][1]}>{SURVEY_STATUS[x.status][0]}</Badge></Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </Card>
      {editable && <Card><CardHeader title="Yangi so'rovnoma" icon={Plus} /><SurveyForm positions={positions} /></Card>}
    </div>
  );
}

// ───────────────────────── Murojaatlar (HR chat) va ommaviy xabar ─────────────────────────

export async function MurojaatTab({ s, positions, holat }: { s: Session; positions: string[]; holat?: string }) {
  const editable = canDo(s, "employees", "voice", ["HR"]);
  const st = holat === "ALL" || holat === "RESOLVED" ? holat : "open";
  const [rows, broadcasts] = await Promise.all([listFeedback({ status: st as "open" }), broadcastStats(20)]);
  return (
    <div className="space-y-4">
      <Card padded={false}>
        <div className="flex flex-wrap items-center gap-1 border-b border-slate-100 px-3 py-2 text-sm">
          <MessageSquare size={15} className="mr-1 text-slate-500" />
          {([["open", "Ochiq"], ["RESOLVED", "Hal qilingan"], ["ALL", "Hammasi"]] as const).map(([k, l]) => (
            <Link key={k} href={`/otdel-kadr?tab=murojaatlar&holat=${k}`} className={cn("rounded-md px-2.5 py-1", st === k ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100")}>{l}</Link>
          ))}
          <span className="ml-auto text-xs text-slate-500">Anonim murojaat muallifi hech kimga ko&apos;rinmaydi</span>
        </div>
        <Table>
          <thead><tr><Th>Mavzu</Th><Th>Kimdan</Th><Th>Turi</Th><Th right>Xabar</Th><Th>Holat</Th></tr></thead>
          <tbody>
            {rows.length === 0 && <Empty text="Murojaat yo'q" />}
            {rows.map((f) => (
              <Tr key={f.id}>
                <Td className="font-medium"><Link href={`/otdel-kadr/murojaat/${f.id}`} className="hover:underline">{f.subject}</Link><div className="text-xs font-normal text-slate-500">{dateTime(f.updatedAt)}</div></Td>
                <Td>{f.anonymous ? <span className="text-slate-500">Anonim</span> : f.author ?? "—"}</Td>
                <Td>{FEEDBACK_KIND_LABEL[f.kind]}</Td>
                <Td right>{f.messages}</Td>
                <Td><Badge color={FEEDBACK_STATUS_BADGE[f.status]}>{FEEDBACK_STATUS_LABEL[f.status]}</Badge></Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </Card>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {editable && <Card><CardHeader title="Ommaviy xabar" icon={Megaphone} description="Xodimlar telefoniga (ilova) va ERP bildirishnomasiga" /><BroadcastForm positions={positions} /></Card>}
        <Card padded={false}>
          <div className="border-b border-slate-100 px-4 py-3"><h2 className="text-sm font-semibold">Yuborilgan xabarlar</h2></div>
          <Table>
            <thead><tr><Th>Xabar</Th><Th right>Yuborildi</Th><Th right>O&apos;qidi</Th></tr></thead>
            <tbody>
              {broadcasts.length === 0 && <Empty text="Xabar yuborilmagan" />}
              {broadcasts.map((b) => (
                <Tr key={b.id}>
                  <Td className="font-medium">{b.title}{b.important && <span className="ml-1"><Badge color="red">muhim</Badge></span>}<div className="text-xs font-normal text-slate-500">{dateTime(b.createdAt)}{b.positions.length ? ` · ${b.positions.join(", ")}` : " · hammaga"}</div></Td>
                  <Td right>{b.sentCount}</Td>
                  <Td right>{b.read} <span className="text-xs text-slate-500">({b.sentCount ? Math.round((b.read / b.sentCount) * 100) : 0}%)</span></Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Card>
      </div>
    </div>
  );
}

// ───────────────────────── Hisobotlar ─────────────────────────

export async function HisobotTab({ oy }: { oy?: string }) {
  const month = validMonth(oy) ?? monthOf(today());
  const r = await hrReport(month);
  const max = Math.max(1, ...r.series.map((x) => x.headcount));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Link href={`/otdel-kadr?tab=hisobotlar&oy=${shiftMonth(month, -1)}`} className="rounded-md px-2 py-1 text-sm text-slate-600 hover:bg-slate-100">←</Link>
        <h2 className="text-base font-semibold">{r.title}</h2>
        {month < monthOf(today()) && <Link href={`/otdel-kadr?tab=hisobotlar&oy=${shiftMonth(month, 1)}`} className="rounded-md px-2 py-1 text-sm text-slate-600 hover:bg-slate-100">→</Link>}
        <span className="ml-auto"><LinkButton href={`/otdel-kadr/hisobot-excel?oy=${month}`} variant="secondary" size="sm"><FileSpreadsheet size={14} /> Excel</LinkButton></span>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Xodimlar" value={String(r.headcount)} icon={BarChart3} hint={r.avgTenure != null ? `o'rtacha staj ${r.avgTenure} yil` : undefined} />
        <StatCard label="Aylanma (12 oy)" value={`${r.yearTurnover}%`} tone={r.yearTurnover > 30 ? "danger" : r.yearTurnover > 15 ? "warning" : "success"} hint={`+${r.yearHires} qabul · −${r.yearFires} bo'shatish`} />
        <StatCard label={`Davomat — ${monthTitle(month)}`} value={r.attendance.rate != null ? `${r.attendance.rate}%` : "—"} hint={`kechikish ${Math.round(r.attendance.lateMinutes / 60)} soat · sababsiz ${r.attendance.absent} kun`} tone={(r.attendance.rate ?? 100) < 90 ? "warning" : "default"} />
        <StatCard label="Ish haqi fondi (oy)" value={money(r.series.at(-1)?.payroll ?? 0)} hint={`+ ijtimoiy soliq ${money(r.series.at(-1)?.employerTax ?? 0)}`} />
        <StatCard label="Ochiq vakansiya" value={String(r.recruiting.openVacancies)} hint={`${r.recruiting.openSeats} o'rin · qabulgacha ~${r.recruiting.daysToHire ?? "—"} kun`} />
        <StatCard label="Kurslar" value={`${r.training.passed} o'tdi`} hint={`${r.training.assigned} topshirmagan · ${r.training.failed} o'tmagan`} />
        <StatCard label="Kutilayotgan arizalar" value={String(r.pendingRequests)} tone={r.pendingRequests ? "warning" : "default"} href="/otdel-kadr?tab=arizalar" />
        <StatCard label="Ochiq murojaatlar" value={String(r.openFeedback)} tone={r.openFeedback ? "warning" : "default"} href="/otdel-kadr?tab=murojaatlar" />
      </div>
      <Card padded={false}>
        <div className="border-b border-slate-100 px-4 py-3"><h2 className="text-sm font-semibold">12 oy: xodimlar, qabul, bo&apos;shatish, ish haqi fondi</h2></div>
        <Table>
          <thead><tr><Th>Oy</Th><Th>Xodimlar</Th><Th right>Qabul</Th><Th right>Bo&apos;shatish</Th><Th right>Aylanma</Th><Th right>Ish haqi fondi</Th></tr></thead>
          <tbody>
            {r.series.map((x) => (
              <Tr key={x.month}>
                <Td>{x.title}</Td>
                <Td><div className="flex items-center gap-2"><div className="h-2 rounded bg-brand-400" style={{ width: `${Math.round((x.headcount / max) * 120)}px` }} /><span className="tabular text-sm">{x.headcount}</span></div></Td>
                <Td right className="text-emerald-700">{x.hires || "—"}</Td>
                <Td right className="text-red-700">{x.fires || "—"}</Td>
                <Td right>{x.turnover ? `${x.turnover}%` : "—"}</Td>
                <Td right>{x.payroll ? money(x.payroll) : "—"}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </Card>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card padded={false}>
          <div className="border-b border-slate-100 px-4 py-3"><h2 className="text-sm font-semibold">Lavozimlar bo&apos;yicha</h2></div>
          <Table><tbody>{r.byPosition.slice(0, 20).map(([p, n]) => <Tr key={p}><Td>{p}</Td><Td right>{n}</Td></Tr>)}</tbody></Table>
        </Card>
        <Card padded={false}>
          <div className="border-b border-slate-100 px-4 py-3"><h2 className="text-sm font-semibold">Bo&apos;shatish sabablari (12 oy)</h2></div>
          <Table><tbody>{r.fireReasons.length === 0 && <Empty text="Bo'shatish yo'q" />}{r.fireReasons.map(([p, n]) => <Tr key={p}><Td>{p}</Td><Td right>{n}</Td></Tr>)}</tbody></Table>
        </Card>
      </div>
    </div>
  );
}
