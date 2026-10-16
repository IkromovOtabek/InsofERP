import { Prisma as P, type Prisma, type Role, type WorkTaskPriority, type WorkTaskStatus } from "@/generated/prisma";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { nextNo } from "@/lib/numbering";
import { canDo } from "@/lib/permissions";
import type { Perms } from "@/lib/auth";
import { dayUtc, isoDay, today } from "@/lib/davomat";
import { notifyAfter, notifyEmployees, notifyUsers } from "@/lib/notify";
import { PRIORITIES, PRIORITY_LABEL, TASK_STATUS_LABEL } from "./labels";

/**
 * Umumiy vazifalar (brigada topshirig'idan alohida) — ro'yxat, kanban, kalendar (veb `/vazifalar`, mobil "vazifalarim").
 *
 * Kim: har bir xodim o'ziga vazifa yozadi; boshqaga berish — `vazifalar.assign` (rahbarlar, otdel kadr, direktor);
 * hammasini ko'rish — `vazifalar.view_all` (otdel kadr, direktor). Bajaruvchi: boshlaydi → "bajarildi";
 * beruvchi qabul qiladi yoki izoh bilan qaytaradi. O'zi yozgan vazifa "bajarildi" bilan darhol yopiladi.
 * Holat o'tishlari shartli `updateMany` bilan; hujjat o'chirilmaydi — bekor qilinadi.
 */

export type Who = { userId: string; role: Role; perms?: Perms };
export const canAssignOthers = (w: Pick<Who, "role" | "perms">) => canDo(w, "vazifalar", "assign");
export const canViewAllTasks = (w: Pick<Who, "role" | "perms">) => canDo(w, "vazifalar", "view_all");

export class TaskError extends Error {}
const STALE = "Vazifa boshqa joyda o'zgartirildi — sahifani yangilang";
const tokenOf = (v: unknown) => (typeof v === "string" && /^[A-Za-z0-9-]{16,64}$/.test(v.trim()) ? v.trim() : null);

export type TaskInput = {
  title: string; description?: string | null; assigneeId?: string | null; dueDate?: string | null; dueTime?: string | null;
  priority?: WorkTaskPriority | null; clientToken?: string | null;
};

/** Login → xodim kartasi (vazifa bajaruvchisi — kartasi bor xodim). */
async function myEmployeeId(userId: string) {
  return (await db.employee.findFirst({ where: { userId, isActive: true }, select: { id: true } }))?.id ?? null;
}

export async function createTask(input: TaskInput, who: Who): Promise<{ id?: string; docNo?: string; error?: string; existed?: boolean }> {
  const title = (input.title ?? "").trim().slice(0, 200);
  if (title.length < 3) return { error: "Vazifa nomini yozing (kamida 3 belgi)" };
  const mine = await myEmployeeId(who.userId);
  const assigneeId = input.assigneeId?.trim() || mine;
  if (!assigneeId) return { error: "Bajaruvchini tanlang — loginingiz xodim kartasiga bog'lanmagan" };
  if (assigneeId !== mine && !canAssignOthers(who)) return { error: "Boshqa xodimga vazifa berish huquqingiz yo'q — o'zingizga yozing" };
  const emp = await db.employee.findUnique({ where: { id: assigneeId }, select: { id: true, isActive: true, fullName: true } });
  if (!emp || !emp.isActive) return { error: "Bajaruvchi topilmadi yoki ishlamaydi" };
  const due = input.dueDate && /^\d{4}-\d{2}-\d{2}$/.test(input.dueDate) ? input.dueDate : null;
  if (input.dueDate && !due) return { error: "Muddat sanasi noto'g'ri" };
  const time = input.dueTime && /^([01]\d|2[0-3]):[0-5]\d$/.test(input.dueTime) ? input.dueTime : null;
  const priority = input.priority && PRIORITIES.includes(input.priority) ? input.priority : "NORMAL";
  const token = tokenOf(input.clientToken);
  if (token) {
    const dup = await db.workTask.findUnique({ where: { clientToken: token }, select: { id: true, docNo: true, createdById: true } });
    if (dup) return dup.createdById === who.userId ? { id: dup.id, docNo: dup.docNo, existed: true } : { error: "Vazifa kaliti band — formani qayta oching" };
  }
  try {
    const t = await db.$transaction(async (tx) => {
      const x = await tx.workTask.create({
        data: {
          docNo: await nextNo(tx, "workTask", "VZ"), title, description: input.description?.trim().slice(0, 3000) || null,
          assigneeId, createdById: who.userId, dueDate: due ? dayUtc(due) : null, dueTime: time, priority, clientToken: token,
        },
      });
      await audit(tx, who.userId, "CREATE", "WorkTask", x.id, undefined, x);
      return x;
    });
    if (assigneeId !== mine) {
      notifyAfter(() => notifyEmployees([assigneeId], {
        type: "WORK_TASK_NEW", title: `Yangi vazifa — ${t.docNo}`,
        body: `${title}${due ? ` · muddat ${due.slice(8, 10)}.${due.slice(5, 7)}` : ""}${priority === "URGENT" || priority === "HIGH" ? ` · ${PRIORITY_LABEL[priority].toLowerCase()}` : ""}`,
        link: { key: "vazifalarim", id: t.id }, channel: priority === "URGENT" ? "muhim" : "oddiy",
      }));
    }
    return { id: t.id, docNo: t.docNo };
  } catch (e) {
    if (token && e instanceof P.PrismaClientKnownRequestError && e.code === "P2002") {
      const dup = await db.workTask.findUnique({ where: { clientToken: token }, select: { id: true, docNo: true } });
      if (dup) return { id: dup.id, docNo: dup.docNo, existed: true };
    }
    throw e;
  }
}

const INCLUDE = { assignee: { select: { id: true, fullName: true, position: true, userId: true } } } as const;
export type TaskRow = Prisma.WorkTaskGetPayload<{ include: typeof INCLUDE }> & { createdByName: string | null };

async function withCreators<T extends { createdById: string }>(rows: T[]): Promise<(T & { createdByName: string | null })[]> {
  const ids = [...new Set(rows.map((r) => r.createdById))];
  const users = ids.length ? await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true } }) : [];
  const by = new Map(users.map((u) => [u.id, u.fullName]));
  return rows.map((r) => ({ ...r, createdByName: by.get(r.createdById) ?? null }));
}

export type TaskScope = "mine" | "given" | "all";

/** Ro'yxat: "mine" — menga berilgan, "given" — men bergan, "all" — hammasi (faqat `view_all`). */
export async function listTasks(who: Who, opts: { scope?: TaskScope; status?: WorkTaskStatus | "open" | "ALL"; from?: string; to?: string; q?: string; take?: number } = {}): Promise<TaskRow[]> {
  const mine = await myEmployeeId(who.userId);
  const scope = opts.scope === "all" && canViewAllTasks(who) ? "all" : opts.scope === "given" ? "given" : "mine";
  const q = opts.q?.trim();
  const where: Prisma.WorkTaskWhereInput = {
    ...(scope === "mine" ? { assigneeId: mine ?? "__none__" } : scope === "given" ? { createdById: who.userId, NOT: { assigneeId: mine ?? "__none__" } } : {}),
    ...(opts.status === "open" ? { status: { in: ["TODO", "IN_PROGRESS", "REVIEW"] } } : opts.status && opts.status !== "ALL" ? { status: opts.status } : {}),
    ...(opts.from || opts.to ? { dueDate: { ...(opts.from ? { gte: dayUtc(opts.from) } : {}), ...(opts.to ? { lte: dayUtc(opts.to) } : {}) } } : {}),
    ...(q ? { OR: [{ title: { contains: q, mode: "insensitive" } }, { docNo: { contains: q, mode: "insensitive" } }, { assignee: { fullName: { contains: q, mode: "insensitive" } } }] } : {}),
  };
  const rows = await db.workTask.findMany({ where, orderBy: [{ status: "asc" }, { dueDate: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }], take: opts.take ?? 300, include: INCLUDE });
  return withCreators(rows);
}

export async function getTask(id: string, who: Who) {
  const t = await db.workTask.findUnique({ where: { id }, include: { ...INCLUDE, comments: { orderBy: { createdAt: "asc" } } } });
  if (!t) return null;
  const isAssignee = t.assignee.userId === who.userId;
  const isCreator = t.createdById === who.userId;
  if (!isAssignee && !isCreator && !canViewAllTasks(who)) return null;
  const users = await db.user.findMany({ where: { id: { in: [t.createdById, ...t.comments.map((c) => c.userId)] } }, select: { id: true, fullName: true } });
  const name = new Map(users.map((u) => [u.id, u.fullName]));
  return {
    ...t, createdByName: name.get(t.createdById) ?? null, isAssignee, isCreator,
    comments: t.comments.map((c) => ({ ...c, userName: name.get(c.userId) ?? "—" })),
    overdue: !!t.dueDate && isoDay(t.dueDate) < today() && ["TODO", "IN_PROGRESS"].includes(t.status),
  };
}
export type TaskCard = NonNullable<Awaited<ReturnType<typeof getTask>>>;

/** Holat amali: start / done / accept / return / cancel / reopen. */
export async function taskAction(id: string, act: "start" | "done" | "accept" | "return" | "cancel", who: Who, note?: string | null): Promise<{ ok?: true; note?: string; error?: string }> {
  const t = await db.workTask.findUnique({ where: { id }, include: INCLUDE });
  if (!t) return { error: "Vazifa topilmadi" };
  const isAssignee = t.assignee.userId === who.userId;
  const isCreator = t.createdById === who.userId;
  const self = isAssignee && isCreator;
  const now = new Date();
  let from: WorkTaskStatus[], data: Prisma.WorkTaskUpdateManyMutationInput, msg: string;
  switch (act) {
    case "start":
      if (!isAssignee) return { error: "Vazifani bajaruvchi boshlaydi" };
      from = ["TODO"]; data = { status: "IN_PROGRESS", startedAt: now }; msg = "Boshlandi"; break;
    case "done":
      if (!isAssignee) return { error: "Bajarildi — bajaruvchi belgilaydi" };
      from = ["TODO", "IN_PROGRESS"];
      // O'zi yozgan vazifa — tekshiruvsiz yopiladi
      data = self ? { status: "DONE", doneAt: now, acceptedAt: now, returnNote: null } : { status: "REVIEW", doneAt: now, returnNote: null };
      msg = self ? "Bajarildi" : "Bajarildi — beruvchi tekshiradi"; break;
    case "accept":
      if (!isCreator && !canViewAllTasks(who)) return { error: "Vazifani beruvchi qabul qiladi" };
      from = ["REVIEW"]; data = { status: "DONE", acceptedAt: now }; msg = "Qabul qilindi"; break;
    case "return":
      if (!isCreator && !canViewAllTasks(who)) return { error: "Vazifani beruvchi qaytaradi" };
      if (!note?.trim()) return { error: "Qaytarish sababini yozing" };
      from = ["REVIEW"]; data = { status: "IN_PROGRESS", returnNote: note.trim().slice(0, 500), doneAt: null }; msg = "Qayta ishlashga qaytarildi"; break;
    case "cancel":
      if (!isCreator && !canViewAllTasks(who)) return { error: "Vazifani beruvchi bekor qiladi" };
      if (!note?.trim()) return { error: "Bekor qilish sababini yozing" };
      from = ["TODO", "IN_PROGRESS", "REVIEW"]; data = { status: "CANCELLED", cancelledAt: now, cancelReason: note.trim().slice(0, 500) }; msg = "Bekor qilindi"; break;
  }
  const n = await db.$transaction(async (tx) => {
    const x = await tx.workTask.updateMany({ where: { id, status: { in: from } }, data });
    if (x.count) await audit(tx, who.userId, "STATUS_CHANGE", "WorkTask", id, { status: t.status }, { status: data.status, note: note ?? null });
    return x.count;
  });
  if (!n) return { error: STALE };
  // Kim bilishi kerak: bajarildi → beruvchi; qabul / qaytarish / bekor → bajaruvchi
  notifyAfter(async () => {
    const title = `${t.docNo}: ${TASK_STATUS_LABEL[data.status as WorkTaskStatus]}`;
    if (act === "done" && !self) await notifyUsers([t.createdById], { type: "WORK_TASK_DONE", title, body: `${t.assignee.fullName} · ${t.title} — tekshiring`, link: { key: "vazifalarim", id } });
    if ((act === "accept" || act === "return" || act === "cancel") && !isAssignee) {
      await notifyEmployees([t.assigneeId], { type: act === "return" ? "WORK_TASK_RETURNED" : "WORK_TASK_UPDATE", title, body: `${t.title}${note ? ` · ${note}` : ""}`, link: { key: "vazifalarim", id } });
    }
  });
  return { ok: true, note: msg };
}

export async function addTaskComment(id: string, text: string, who: Who): Promise<{ ok?: true; error?: string }> {
  const t = await getTask(id, who);
  if (!t) return { error: "Vazifa topilmadi" };
  const body = text.trim().slice(0, 2000);
  if (!body) return { error: "Izoh bo'sh" };
  await db.workTaskComment.create({ data: { taskId: id, userId: who.userId, text: body } });
  notifyAfter(async () => {
    const to = [t.createdById, t.assignee.userId].filter((u): u is string => !!u && u !== who.userId);
    await notifyUsers(to, { type: "WORK_TASK_COMMENT", title: `${t.docNo}: yangi izoh`, body: body.slice(0, 120), link: { key: "vazifalarim", id }, channel: "oddiy" });
  });
  return { ok: true };
}

/** Bosh sahifa / KPI uchun sanoq: ochiq, muddati o'tgan, tekshiruv kutayotgan. */
export async function taskCounts(who: Who) {
  const mine = await myEmployeeId(who.userId);
  const now = dayUtc(today());
  const [open, overdue, review] = await Promise.all([
    db.workTask.count({ where: { assigneeId: mine ?? "__none__", status: { in: ["TODO", "IN_PROGRESS"] } } }),
    db.workTask.count({ where: { assigneeId: mine ?? "__none__", status: { in: ["TODO", "IN_PROGRESS"] }, dueDate: { lt: now } } }),
    db.workTask.count({ where: { createdById: who.userId, status: "REVIEW" } }),
  ]);
  return { open, overdue, review };
}

/** Vazifa beriladigan xodimlar (faol). */
export async function assignableEmployees() {
  return db.employee.findMany({ where: { isActive: true }, orderBy: [{ fullName: "asc" }], select: { id: true, fullName: true, position: true, userId: true } });
}
