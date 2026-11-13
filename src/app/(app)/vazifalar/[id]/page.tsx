import { notFound } from "next/navigation";
import { MessageSquare } from "lucide-react";
import { requirePage } from "@/lib/page-guard";
import { date, dateTime } from "@/lib/format";
import { isoDay } from "@/lib/davomat";
import { assignableEmployees, canAssignOthers, canViewAllTasks, getTask } from "@/lib/hr/tasks";
import { PRIORITY_BADGE, PRIORITY_LABEL, TASK_STATUS_BADGE, TASK_STATUS_LABEL } from "@/lib/hr/labels";
import { Badge, Callout, Card, CardHeader, DL, PageHeader, StatusSteps } from "@/components/ui";
import { CommentForm, EditTaskForm, TaskButtons } from "../forms";

const STEPS = [{ key: "TODO", label: "Berildi" }, { key: "IN_PROGRESS", label: "Bajarilmoqda" }, { key: "REVIEW", label: "Tekshiruvda" }, { key: "DONE", label: "Qabul qilindi" }];

export default async function TaskPage({ params }: { params: Promise<{ id: string }> }) {
  const s = await requirePage("/vazifalar");
  const { id } = await params;
  const t = await getTask(id, s);
  if (!t) notFound();
  const boss = t.isCreator || canViewAllTasks(s);
  const open = ["TODO", "IN_PROGRESS", "REVIEW"].includes(t.status);
  // Tahrirlash — beruvchi yoki hammasini ko'ruvchi, ochiq vazifada. Bajaruvchi tanlovi: `assign` bo'lsa — hamma faol xodim,
  // aks holda hozirgi bajaruvchi va o'zi (o'ziga olish har kimga ochiq); tekshiruvdagi vazifada almashtirilmaydi
  let editPeople: { id: string; fullName: string; position: string }[] = [];
  if (boss && open) {
    const current = { id: t.assignee.id, fullName: t.assignee.fullName, position: t.assignee.position };
    const all = await assignableEmployees();
    const me = all.find((e) => e.userId === s.userId);
    const pool = t.status === "REVIEW" ? [] : canAssignOthers(s) ? all : me ? [me] : [];
    editPeople = [current, ...pool.filter((e) => e.id !== current.id).map((e) => ({ id: e.id, fullName: e.fullName, position: e.position }))];
  }
  return (
    <div className="space-y-4">
      <PageHeader back={{ href: "/vazifalar", label: "Vazifalar" }} eyebrow={t.docNo} title={t.title}
        action={<Badge color={TASK_STATUS_BADGE[t.status]}>{TASK_STATUS_LABEL[t.status]}</Badge>} />
      {t.status !== "CANCELLED" && <StatusSteps steps={STEPS} current={t.status} />}
      {t.overdue && <Callout tone="danger" title="Muddati o'tgan">{date(t.dueDate!)}{t.dueTime ? ` ${t.dueTime}` : ""} gacha bajarilishi kerak edi</Callout>}
      {t.returnNote && t.status === "IN_PROGRESS" && <Callout tone="warning" title="Qayta ishlashga qaytarildi">{t.returnNote}</Callout>}
      {t.status === "CANCELLED" && <Callout tone="danger" title="Bekor qilingan">{t.cancelReason}</Callout>}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          {t.description ? <p className="whitespace-pre-wrap text-sm text-slate-700">{t.description}</p> : <p className="text-sm text-slate-400">Tavsif yo&apos;q</p>}
          <div className="mt-4">
            <TaskButtons id={t.id} can={{
              start: t.isAssignee && t.status === "TODO",
              done: t.isAssignee && (t.status === "TODO" || t.status === "IN_PROGRESS"),
              accept: boss && t.status === "REVIEW",
              ret: boss && t.status === "REVIEW",
              cancel: boss && open,
            }} />
            {boss && open && (
              <div className="mt-2">
                <EditTaskForm
                  task={{ id: t.id, title: t.title, description: t.description, assigneeId: t.assigneeId, dueDate: t.dueDate ? isoDay(t.dueDate) : null, dueTime: t.dueTime, priority: t.priority }}
                  employees={editPeople}
                />
              </div>
            )}
          </div>
        </Card>
        <Card>
          <DL items={[
            { k: "Bajaruvchi", v: `${t.assignee.fullName} · ${t.assignee.position}` },
            { k: "Beruvchi", v: t.createdByName ?? "—" },
            { k: "Muhimlik", v: <Badge color={PRIORITY_BADGE[t.priority]}>{PRIORITY_LABEL[t.priority]}</Badge> },
            { k: "Muddat", v: t.dueDate ? `${date(t.dueDate)}${t.dueTime ? ` ${t.dueTime}` : ""}` : "—" },
            { k: "Berilgan", v: dateTime(t.createdAt) },
            ...(t.startedAt ? [{ k: "Boshlandi", v: dateTime(t.startedAt) }] : []),
            ...(t.doneAt ? [{ k: "Bajarildi", v: dateTime(t.doneAt) }] : []),
            ...(t.acceptedAt ? [{ k: "Qabul qilindi", v: dateTime(t.acceptedAt) }] : []),
          ]} />
        </Card>
      </div>
      <Card>
        <CardHeader title={`Izohlar (${t.comments.length})`} icon={MessageSquare} />
        <div className="space-y-3">
          {t.comments.map((c) => (
            <div key={c.id} className="rounded-lg bg-slate-50 px-3 py-2 text-sm">
              <div className="text-xs text-slate-500">{c.userName} · {dateTime(c.createdAt)}</div>
              <div className="whitespace-pre-wrap">{c.text}</div>
            </div>
          ))}
          <CommentForm id={t.id} />
        </div>
      </Card>
    </div>
  );
}
