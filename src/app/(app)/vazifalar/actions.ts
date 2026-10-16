"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth";
import { notSignedIn } from "@/lib/access-denied";
import type { ActionState } from "@/lib/action";
import { addTaskComment, createTask, taskAction } from "@/lib/hr/tasks";
import type { WorkTaskPriority } from "@/generated/prisma";

/* Vazifalar — har bir xodim (qoida `lib/hr/tasks.ts`). */

async function who() {
  const s = await getSession();
  if (!s) throw notSignedIn();
  return s;
}
const refresh = (id?: string) => { revalidatePath("/vazifalar"); revalidatePath("/hisobim"); if (id) revalidatePath(`/vazifalar/${id}`); };

export async function createTaskAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await who();
  const str = (k: string) => { const v = String(fd.get(k) ?? "").trim(); return v || null; };
  const r = await createTask({
    title: str("title") ?? "", description: str("description"), assigneeId: str("assigneeId"), dueDate: str("dueDate"), dueTime: str("dueTime"),
    priority: str("priority") as WorkTaskPriority | null, clientToken: str("clientToken"),
  }, s);
  if (r.error) return { error: r.error };
  refresh(r.id);
  return { ok: true, note: r.existed ? `${r.docNo} allaqachon saqlangan` : `${r.docNo} berildi` };
}

export async function taskStatusAction(id: string, act: "start" | "done" | "accept" | "return" | "cancel", _prev: ActionState, fd: FormData): Promise<ActionState> {
  const r = await taskAction(id, act, await who(), String(fd.get("note") ?? "").trim() || null);
  if (r.error) return { error: r.error };
  refresh(id);
  return { ok: true, note: r.note };
}

export async function commentAction(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const r = await addTaskComment(id, String(fd.get("text") ?? ""), await who());
  if (r.error) return { error: r.error };
  refresh(id);
  return { ok: true };
}

/** Kanbandan sudrab o'tkazish o'rniga — kartadagi tugma (holat qoidasi bir xil). */
export async function quickStatus(id: string, act: "start" | "done" | "accept"): Promise<ActionState> {
  const r = await taskAction(id, act, await who());
  refresh(id);
  return r.error ? { error: r.error } : { ok: true, note: r.note };
}

