"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAction } from "@/lib/auth";
import type { ActionState } from "@/lib/action";
import { replyFeedback, saveSurvey, sendBroadcast, setFeedbackStatus, setSurveyStatus } from "@/lib/hr/voice";
import { saveESignature, signPayload } from "@/lib/hr/eimzo";
import type { FeedbackStatus } from "@/generated/prisma";

/* Otdel kadr 4-faza: so'rovnoma, murojaatlar (HR chat), ommaviy xabar, E-IMZO. Qoidalar — `lib/hr/voice.ts`, `eimzo.ts`. */

const refresh = (...extra: string[]) => { for (const p of ["/otdel-kadr", "/hisobim", ...extra]) revalidatePath(p); };
const voice = () => requireAction("employees", "voice", ["HR"]);

export async function saveSurveyAction(id: string | null, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await voice();
  const str = (k: string) => { const v = String(fd.get(k) ?? "").trim(); return v || null; };
  const r = await saveSurvey(id || null, { title: str("title") ?? "", description: str("description"), anonymous: fd.get("anonymous") === "on", position: str("position"), text: String(fd.get("questions") ?? ""), closesAt: str("closesAt") }, s.userId);
  if ("error" in r) return { error: r.error as string };
  refresh(`/otdel-kadr/sorovnoma/${r.id}`);
  if (!id) redirect(`/otdel-kadr/sorovnoma/${r.id}`);
  return { ok: true, note: "Saqlandi" };
}

export async function surveyStatusAction(id: string, status: "OPEN" | "CLOSED"): Promise<ActionState> {
  const s = await voice();
  const r = await setSurveyStatus(id, status, s.userId);
  refresh(`/otdel-kadr/sorovnoma/${id}`);
  return "error" in r ? { error: r.error as string } : { ok: true, note: status === "OPEN" ? "So'rovnoma ochildi — xodimlarga xabar ketdi" : "Yopildi" };
}

export async function hrReplyAction(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await voice();
  const r = await replyFeedback(id, String(fd.get("text") ?? ""), s, true);
  refresh(`/otdel-kadr/murojaat/${id}`);
  return "error" in r ? { error: r.error as string } : { ok: true, note: "Javob yuborildi" };
}

export async function feedbackStatusAction(id: string, status: FeedbackStatus): Promise<ActionState> {
  const s = await voice();
  const r = await setFeedbackStatus(id, status, s.userId);
  refresh(`/otdel-kadr/murojaat/${id}`);
  return "error" in r ? { error: r.error as string } : { ok: true };
}

export async function broadcastAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await voice();
  const r = await sendBroadcast({ title: String(fd.get("title") ?? ""), body: String(fd.get("body") ?? ""), positions: fd.getAll("pos").map(String).filter(Boolean), important: fd.get("important") === "on" }, s.userId);
  if ("error" in r) return { error: r.error as string };
  refresh();
  return { ok: true, note: `${r.count} xodimga yuborildi` };
}

// ───────────────────────── E-IMZO ─────────────────────────

/** Imzolanadigan matn (brauzer E-IMZO ga yuboradi). */
export async function eimzoPayloadAction(docId: string): Promise<{ text?: string; error?: string }> {
  await requireAction("employees", "edit", ["HR"]);
  const text = await signPayload(docId);
  return text ? { text } : { error: "Hujjat topilmadi" };
}

export async function eimzoSaveAction(docId: string, pkcs7: string, certInfo: { name?: string | null; tin?: string | null }): Promise<ActionState> {
  const s = await requireAction("employees", "edit", ["HR"]);
  const r = await saveESignature(docId, pkcs7, certInfo, s.userId);
  if ("error" in r) return { error: r.error as string };
  revalidatePath(`/employees/${r.employeeId}`);
  return { ok: true, note: r.note };
}
