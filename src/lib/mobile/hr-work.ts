import { isoDay, monthTitle, today } from "@/lib/davomat";
import { addTaskComment, assignableEmployees, canAssignOthers, canViewAllTasks, createTask, getTask, listTasks, taskAction, type TaskScope } from "@/lib/hr/tasks";
import { myChecklists, saveMyChecklist } from "@/lib/hr/checklists";
import { kpiMonth } from "@/lib/hr/kpi";
import { employeeOfUser } from "@/lib/hr/requests";
import { KPI_SOURCE, PRIORITIES, PRIORITY_LABEL, TASK_STATUS_LABEL, TASK_STATUS_TONE } from "@/lib/hr/labels";
import type { WorkTaskPriority } from "@/generated/prisma";
import type { MobileUser } from "./auth";
import type { HomeRow, Tone } from "./home";
import type { DetailAction, DetailField, FormField, MobileDetail } from "./detail";
import { ListError, type MobileList } from "./list";

/**
 * Mobil — 2-faza: vazifalar ("vazifalarim", "vazifa" formasi), bugungi cheklist ("cheklistim"), KPI ("kpim").
 * Qoidalar `lib/hr/tasks.ts`, `checklists.ts`, `kpi.ts` (veb bilan bitta).
 */

const who = (u: MobileUser) => ({ userId: u.id, role: u.role, perms: u.perms });
const money = (n: number) => `${Math.round(n).toLocaleString("ru-RU")} so'm`;
const dd = (d: Date) => `${String(d.getUTCDate()).padStart(2, "0")}.${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
const fail = (m: string): never => { throw new ListError("ACTION_FAILED", m, 400); };

async function me(user: MobileUser) {
  const e = await employeeOfUser(user.id);
  if (!e || !e.isActive) throw new ListError("NO_EMPLOYEE", "Loginingiz xodim kartasiga bog'lanmagan — otdel kadrga murojaat qiling", 404);
  return e;
}

export async function workList(user: MobileUser, key: string, q?: string, filter?: string): Promise<MobileList> {
  if (key === "vazifalarim") {
    const all = canViewAllTasks(who(user));
    // Filtr: `<scope>` yoki `<scope>.<holat>` — holat: ochiq (sukut) / `closed` (qabul qilingan + bekor) / `any` (hammasi)
    const [sc, st] = (filter ?? "").split(".");
    const scope: TaskScope = sc === "given" ? "given" : sc === "all" && all ? "all" : "mine";
    const status = st === "closed" || st === "any" ? st : "open";
    const rows = status === "closed"
      ? (await Promise.all((["DONE", "CANCELLED"] as const).map((x) => listTasks(who(user), { scope, status: x, q, take: 80 })))).flat().sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()).slice(0, 80)
      : await listTasks(who(user), { scope, status: status === "any" ? "ALL" : "open", q, take: 80 });
    const sfx = status === "open" ? "" : `.${status}`;
    const now = today();
    return {
      key, title: "Vazifalarim",
      rows: rows.map((t): HomeRow => {
        const late = !!t.dueDate && isoDay(t.dueDate) < now && (t.status === "TODO" || t.status === "IN_PROGRESS");
        return {
          id: t.id, title: `${t.title}${t.priority === "URGENT" ? " · shoshilinch" : ""}`,
          subtitle: `${t.docNo} · ${scope === "mine" ? t.createdByName ?? "—" : t.assignee.fullName}${t.dueDate ? ` · muddat ${dd(t.dueDate)}${t.dueTime ? ` ${t.dueTime}` : ""}` : ""}${late ? " · kechikdi" : ""}`,
          status: TASK_STATUS_LABEL[t.status], tone: (late ? "danger" : TASK_STATUS_TONE[t.status]) as Tone,
        };
      }),
      filters: [
        { key: `mine${sfx}`, label: "Menga", active: scope === "mine" },
        { key: `given${sfx}`, label: "Men bergan", active: scope === "given" },
        ...(all ? [{ key: `all${sfx}`, label: "Barcha xodimlar", active: scope === "all" }] : []),
        { key: scope, label: "Ochiq", active: status === "open" },
        { key: `${scope}.closed`, label: "Yopilgan", active: status === "closed" },
        { key: `${scope}.any`, label: "Hammasi", active: status === "any" },
      ],
    };
  }
  if (key === "cheklistim") {
    const e = await me(user);
    const list = await myChecklists(e);
    return { key, title: "Bugungi cheklist", rows: list.map((c) => ({ id: c.templateId, title: c.name, subtitle: `${c.total} band`, right: `${c.doneCount}/${c.total}`, tone: (c.doneCount === c.total ? "success" : c.doneCount ? "warning" : "danger") as Tone })) };
  }
  // "kpim"
  const e = await me(user);
  const month = today().slice(0, 7);
  const rows = await kpiMonth(month, { employeeIds: [e.id] });
  return {
    key, title: `KPI — ${monthTitle(month)}`,
    rows: rows.map((k) => ({ id: k.metricId, title: k.name, subtitle: `${KPI_SOURCE[k.source].label} · fakt ${k.fact ?? "—"} / reja ${k.target} ${k.unit}`, right: k.reward ? money(k.reward) : `${k.pct ?? 0}%`, tone: ((k.pct ?? 0) >= 100 ? "success" : k.reward ? "warning" : "danger") as Tone })),
  };
}

export async function workDetail(user: MobileUser, key: string, id: string): Promise<MobileDetail> {
  if (key === "vazifalarim") {
    const t = await getTask(id, who(user));
    if (!t) throw new ListError("NOT_FOUND", "Vazifa topilmadi", 404);
    const boss = t.isCreator || canViewAllTasks(who(user));
    const open = ["TODO", "IN_PROGRESS", "REVIEW"].includes(t.status);
    const actions: DetailAction[] = [];
    if (t.isAssignee && t.status === "TODO") actions.push({ id: "wtask.start", label: "Boshlash", tone: "brand" });
    if (t.isAssignee && (t.status === "TODO" || t.status === "IN_PROGRESS")) actions.push({ id: "wtask.done", label: "Bajarildi", tone: "success", confirm: "Vazifa bajarildimi?" });
    if (boss && t.status === "REVIEW") {
      actions.push({ id: "wtask.accept", label: "Qabul qilish", tone: "success" });
      actions.push({ id: "wtask.return", label: "Qaytarish", tone: "warning", form: [{ name: "note", label: "Nimani qayta qilish kerak", type: "text", required: true }] });
    }
    if (boss && open) actions.push({ id: "wtask.cancel", label: "Bekor qilish", tone: "danger", form: [{ name: "note", label: "Sabab", type: "text", required: true }] });
    actions.push({ id: "wtask.comment", label: "Izoh yozish", form: [{ name: "text", label: "Izoh", type: "text", required: true }] });
    const fields: DetailField[] = [
      { label: "Holat", value: TASK_STATUS_LABEL[t.status], tone: TASK_STATUS_TONE[t.status] },
      ...(t.description ? [{ label: "Tavsif", value: t.description }] : []),
      { label: "Bajaruvchi", value: `${t.assignee.fullName} · ${t.assignee.position}` },
      { label: "Beruvchi", value: t.createdByName ?? "—" },
      { label: "Muhimlik", value: PRIORITY_LABEL[t.priority], tone: t.priority === "URGENT" ? "danger" : undefined },
      ...(t.dueDate ? [{ label: "Muddat", value: `${dd(t.dueDate)}${t.dueTime ? ` ${t.dueTime}` : ""}${t.overdue ? " · kechikdi" : ""}`, tone: (t.overdue ? "danger" : undefined) as Tone | undefined }] : []),
      ...(t.returnNote && t.status === "IN_PROGRESS" ? [{ label: "Qaytarildi", value: t.returnNote, tone: "warning" as Tone }] : []),
      ...(t.cancelReason ? [{ label: "Bekor sababi", value: t.cancelReason, tone: "danger" as Tone }] : []),
    ];
    return {
      key, id: t.id, title: t.title, subtitle: t.docNo, status: TASK_STATUS_LABEL[t.status], fields, actions,
      sections: [{ title: "Izohlar", empty: "Izoh yo'q", rows: t.comments.map((c) => ({ id: c.id, title: c.text, subtitle: `${c.userName} · ${dd(c.createdAt)}` })) }],
    };
  }
  if (key === "cheklistim") {
    const e = await me(user);
    const c = (await myChecklists(e)).find((x) => x.templateId === id);
    if (!c) throw new ListError("NOT_FOUND", "Cheklist topilmadi", 404);
    return {
      key, id, title: c.name, subtitle: `Bugun · ${c.doneCount} / ${c.total} bajarildi`, status: c.doneCount === c.total ? "Bajarildi" : "Ochiq",
      fields: c.items.map((i) => ({ label: i.label, value: i.done ? `✓ ${i.done}` : "—", tone: (i.done ? "success" : undefined) as Tone | undefined })),
      sections: [],
      actions: [{ id: "checklist.save", label: "Belgilash", tone: "brand", form: c.items.map((i): FormField => ({ name: i.key, label: i.label, type: "switch", value: i.done ? "true" : "false" })) }],
    };
  }
  // "kpim"
  const e = await me(user);
  const k = (await kpiMonth(today().slice(0, 7), { employeeIds: [e.id] })).find((x) => x.metricId === id);
  if (!k) throw new ListError("NOT_FOUND", "KPI topilmadi", 404);
  return {
    key, id, title: k.name, subtitle: KPI_SOURCE[k.source].label, status: `${k.pct ?? 0}%`, actions: [], sections: [],
    fields: [
      { label: "Reja", value: `${k.target} ${k.unit}` },
      { label: "Fakt", value: k.fact == null ? "—" : `${k.fact} ${k.unit}` },
      { label: "Bajarilish", value: `${k.pct ?? 0}%`, tone: (k.pct ?? 0) >= 100 ? "success" : "warning" },
      { label: "Mukofot", value: money(k.reward), tone: k.reward ? "success" : undefined },
    ],
  };
}

export async function taskForm(user: MobileUser): Promise<{ key: string; title: string; submitLabel: string; fields: FormField[] }> {
  const e = await employeeOfUser(user.id);
  const others = canAssignOthers(who(user)) ? (await assignableEmployees()).filter((x) => x.id !== e?.id) : [];
  return {
    key: "vazifa", title: "Yangi vazifa", submitLabel: "Saqlash",
    fields: [
      { name: "title", label: "Vazifa", type: "text", required: true, placeholder: "Nima qilish kerak" },
      ...(others.length ? [{ name: "assigneeId", label: "Bajaruvchi", type: "select" as const, value: e?.id ?? "", options: [...(e ? [{ value: e.id, label: "Men o'zim" }] : []), ...others.map((x) => ({ value: x.id, label: x.fullName, hint: x.position }))] }] : []),
      { name: "dueDate", label: "Muddat", type: "date" },
      { name: "dueTime", label: "Soat", type: "time" },
      { name: "priority", label: "Muhimlik", type: "select", value: "NORMAL", options: PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABEL[p] })) },
      { name: "description", label: "Tavsif", type: "text" },
    ],
  };
}

export async function createTaskMobile(user: MobileUser, payload: unknown) {
  const p = (payload ?? {}) as Record<string, unknown>;
  const s = (k: string) => { const v = String(p[k] ?? "").trim(); return v || null; };
  const r = await createTask({ title: s("title") ?? "", description: s("description"), assigneeId: s("assigneeId"), dueDate: s("dueDate"), dueTime: s("dueTime"), priority: s("priority") as WorkTaskPriority | null, clientToken: s("clientToken") }, who(user));
  if (r.error) throw new Error(r.error);
  return { key: "vazifalarim", id: r.id!, message: r.existed ? `${r.docNo} allaqachon saqlangan` : `${r.docNo} saqlandi` };
}

export async function runWorkAction(user: MobileUser, action: string, id: string, payload: Record<string, unknown>): Promise<string> {
  if (action === "wtask.comment") {
    const r = await addTaskComment(id, String(payload.text ?? ""), who(user));
    return r.error ? fail(r.error) : "Izoh qo'shildi";
  }
  if (action === "checklist.save") {
    const e = await me(user);
    const checked = Object.entries(payload).filter(([, v]) => v === true || v === "true").map(([k]) => k);
    const r = await saveMyChecklist(e, id, checked, user.id);
    return "error" in r ? fail(r.error!) : r.note;
  }
  const act = action.slice("wtask.".length) as "start" | "done" | "accept" | "return" | "cancel";
  const r = await taskAction(id, act, who(user), String(payload.note ?? "").trim() || null);
  return r.error ? fail(r.error) : r.note ?? "Bajarildi";
}
