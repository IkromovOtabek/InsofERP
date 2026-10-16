import Link from "next/link";
import { CalendarDays, Columns3, List, ListTodo } from "lucide-react";
import { requirePage } from "@/lib/page-guard";
import { db } from "@/lib/db";
import { date } from "@/lib/format";
import { dayUtc, isoDay, monthDays, monthOf, monthTitle, shiftMonth, today, validMonth } from "@/lib/davomat";
import { assignableEmployees, canAssignOthers, canViewAllTasks, listTasks, taskCounts, type TaskRow, type TaskScope } from "@/lib/hr/tasks";
import { PRIORITY_BADGE, PRIORITY_LABEL, TASK_COLUMNS, TASK_STATUS_BADGE, TASK_STATUS_LABEL } from "@/lib/hr/labels";
import { Badge, Card, CardHeader, Empty, PageHeader, StatCard, Table, Tabs, Td, Th, Tr } from "@/components/ui";
import { cn } from "@/lib/utils";
import { NewTaskForm, QuickButton } from "./forms";

const WD = ["Dush", "Sesh", "Chor", "Pay", "Jum", "Shan", "Yak"];

/** Vazifalar — har bir xodim: menga berilgan, men bergan, (kadr/direktor) hammasi; ro'yxat, kanban, kalendar. */
export default async function TasksPage({ searchParams }: { searchParams: Promise<{ scope?: string; view?: string; oy?: string; holat?: string; q?: string }> }) {
  const s = await requirePage("/vazifalar");
  const sp = await searchParams;
  const all = canViewAllTasks(s);
  const scope: TaskScope = sp.scope === "given" ? "given" : sp.scope === "all" && all ? "all" : "mine";
  const view = sp.view === "kanban" || sp.view === "kalendar" ? sp.view : "royxat";
  const month = validMonth(sp.oy) ?? monthOf(today());
  const days = monthDays(month);
  const status = view === "royxat" ? (sp.holat === "ALL" || sp.holat === "DONE" || sp.holat === "CANCELLED" ? sp.holat : "open") : "ALL";
  const [rows, counts, employees, me] = await Promise.all([
    listTasks(s, { scope, status: status as "open", q: sp.q, ...(view === "kalendar" ? { from: days[0]!.iso, to: days[days.length - 1]!.iso } : {}) }),
    taskCounts(s),
    assignableEmployees(),
    db.employee.findFirst({ where: { userId: s.userId, isActive: true }, select: { id: true } }),
  ]);
  const href = (p: Record<string, string>) => `/vazifalar?${new URLSearchParams({ scope, view, ...(view === "kalendar" ? { oy: month } : {}), ...p }).toString()}`;
  const now = today();
  const overdue = (t: TaskRow) => !!t.dueDate && isoDay(t.dueDate) < now && (t.status === "TODO" || t.status === "IN_PROGRESS");
  const quick = (t: TaskRow) => {
    const assignee = t.assignee.userId === s.userId;
    if (assignee && t.status === "TODO") return <QuickButton id={t.id} act="start" label="Boshlash" />;
    if (assignee && t.status === "IN_PROGRESS") return <QuickButton id={t.id} act="done" label="Bajarildi" />;
    if ((t.createdById === s.userId || all) && t.status === "REVIEW") return <QuickButton id={t.id} act="accept" label="Qabul" />;
    return null;
  };

  return (
    <div className="space-y-4">
      <PageHeader title="Vazifalar" subtitle="Berilgan ishlar: muddat, holat, izohlar. Bajaruvchi «Bajarildi» bosadi — beruvchi qabul qiladi" />
      <div className="grid grid-cols-3 gap-3">
        <StatCard label="Menga — ochiq" value={String(counts.open)} icon={ListTodo} href="/vazifalar?scope=mine" />
        <StatCard label="Muddati o'tgan" value={String(counts.overdue)} tone={counts.overdue ? "danger" : "default"} href="/vazifalar?scope=mine" />
        <StatCard label="Tekshirishim kerak" value={String(counts.review)} tone={counts.review ? "warning" : "default"} href="/vazifalar?scope=given" />
      </div>
      <Card>
        <CardHeader title="Yangi vazifa" icon={ListTodo} />
        <NewTaskForm employees={employees} myId={me?.id ?? null} canAssign={canAssignOthers(s)} />
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Tabs current={scope} items={[
          { key: "mine", label: "Menga", href: href({ scope: "mine" }) },
          { key: "given", label: "Men bergan", href: href({ scope: "given" }) },
          ...(all ? [{ key: "all", label: "Hammasi", href: href({ scope: "all" }) }] : []),
        ]} />
        <div className="flex gap-1">
          {([["royxat", "Ro'yxat", List], ["kanban", "Kanban", Columns3], ["kalendar", "Kalendar", CalendarDays]] as const).map(([k, l, Icon]) => (
            <Link key={k} href={href({ view: k })} className={cn("inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm", view === k ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100")}><Icon size={15} /> {l}</Link>
          ))}
        </div>
      </div>

      {view === "royxat" && (
        <Card padded={false}>
          <div className="flex gap-1 border-b border-slate-100 px-3 py-2 text-sm">
            {([["open", "Ochiq"], ["DONE", "Qabul qilingan"], ["CANCELLED", "Bekor"], ["ALL", "Hammasi"]] as const).map(([k, l]) => (
              <Link key={k} href={href({ holat: k })} className={cn("rounded-md px-2.5 py-1", status === k ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100")}>{l}</Link>
            ))}
          </div>
          <Table>
            <thead><tr><Th>Vazifa</Th><Th>{scope === "mine" ? "Beruvchi" : "Bajaruvchi"}</Th><Th>Muddat</Th><Th>Holat</Th><Th right /></tr></thead>
            <tbody>
              {rows.length === 0 && <Empty text="Vazifa yo'q" />}
              {rows.map((t) => (
                <Tr key={t.id}>
                  <Td className="font-medium">
                    <Link href={`/vazifalar/${t.id}`} className="hover:underline">{t.title}</Link>
                    <div className="text-xs font-normal text-slate-500">{t.docNo}{t.priority !== "NORMAL" && <> · <span className={t.priority === "URGENT" ? "text-red-600" : ""}>{PRIORITY_LABEL[t.priority]}</span></>}</div>
                  </Td>
                  <Td className="text-sm">{scope === "mine" ? t.createdByName ?? "—" : <>{t.assignee.fullName}<div className="text-xs text-slate-500">{t.assignee.position}</div></>}</Td>
                  <Td className={cn("text-sm", overdue(t) && "font-semibold text-red-600")}>{t.dueDate ? `${date(t.dueDate)}${t.dueTime ? ` ${t.dueTime}` : ""}` : "—"}{overdue(t) && <div className="text-xs">muddati o&apos;tdi</div>}</Td>
                  <Td><Badge color={TASK_STATUS_BADGE[t.status]}>{TASK_STATUS_LABEL[t.status]}</Badge></Td>
                  <Td right>{quick(t)}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}

      {view === "kanban" && (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          {TASK_COLUMNS.map((col) => {
            const list = rows.filter((t) => t.status === col);
            return (
              <div key={col} className="rounded-(--radius-card) border border-slate-200 bg-slate-50/60 p-2">
                <div className="mb-2 flex items-center justify-between px-1 text-sm font-semibold text-slate-700">{TASK_STATUS_LABEL[col]}<span className="text-xs font-normal text-slate-500">{list.length}</span></div>
                <div className="space-y-2">
                  {list.length === 0 && <div className="px-1 py-4 text-center text-xs text-slate-400">bo&apos;sh</div>}
                  {list.slice(0, 60).map((t) => (
                    <div key={t.id} className={cn("rounded-lg border bg-white p-2.5 shadow-xs", overdue(t) ? "border-red-200" : "border-slate-200")}>
                      <Link href={`/vazifalar/${t.id}`} className="text-sm font-medium hover:underline">{t.title}</Link>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
                        {t.priority !== "NORMAL" && <Badge color={PRIORITY_BADGE[t.priority]}>{PRIORITY_LABEL[t.priority]}</Badge>}
                        <span>{scope === "mine" ? t.createdByName : t.assignee.fullName}</span>
                        {t.dueDate && <span className={overdue(t) ? "font-semibold text-red-600" : ""}>· {date(t.dueDate)}</span>}
                      </div>
                      <div className="mt-2">{quick(t)}</div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {view === "kalendar" && (
        <Card padded={false}>
          <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3">
            <Link href={href({ oy: shiftMonth(month, -1) })} className="rounded-md px-2 py-1 text-sm text-slate-600 hover:bg-slate-100">←</Link>
            <h2 className="text-sm font-semibold">{monthTitle(month)}</h2>
            <Link href={href({ oy: shiftMonth(month, 1) })} className="rounded-md px-2 py-1 text-sm text-slate-600 hover:bg-slate-100">→</Link>
            <span className="ml-auto text-xs text-slate-500">Muddati shu oyda bo&apos;lgan vazifalar</span>
          </div>
          <div className="grid grid-cols-7 border-b border-slate-100 text-center text-xs font-medium text-slate-500">{WD.map((d) => <div key={d} className="py-1.5">{d}</div>)}</div>
          <div className="grid grid-cols-7">
            {Array.from({ length: (dayUtc(days[0]!.iso).getUTCDay() + 6) % 7 }, (_, i) => <div key={`e${i}`} className="min-h-24 border-b border-r border-slate-100 bg-slate-50/50" />)}
            {days.map((d) => {
              const list = rows.filter((t) => t.dueDate && isoDay(t.dueDate) === d.iso);
              return (
                <div key={d.iso} className={cn("min-h-24 border-b border-r border-slate-100 p-1", d.iso === now && "bg-brand-50/50")}>
                  <div className={cn("text-xs", d.weekend ? "text-red-500" : "text-slate-500")}>{d.day}</div>
                  <div className="space-y-0.5">
                    {list.slice(0, 4).map((t) => (
                      <Link key={t.id} href={`/vazifalar/${t.id}`} className={cn("block truncate rounded px-1 py-0.5 text-[11px]", t.status === "DONE" ? "bg-emerald-50 text-emerald-800 line-through" : overdue(t) ? "bg-red-50 text-red-800" : t.status === "REVIEW" ? "bg-amber-50 text-amber-800" : "bg-sky-50 text-sky-800")} title={t.title}>
                        {t.dueTime ? `${t.dueTime} ` : ""}{t.title}
                      </Link>
                    ))}
                    {list.length > 4 && <div className="px-1 text-[11px] text-slate-500">+{list.length - 4}</div>}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}
    </div>
  );
}
