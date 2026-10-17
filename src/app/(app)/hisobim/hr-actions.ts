"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import type { ActionState } from "@/lib/action";
import { cancelHrRequest, createHrRequest, employeeOfUser } from "@/lib/hr/requests";
import { REQUEST_KINDS } from "@/lib/hr/labels";
import { saveMyChecklist } from "@/lib/hr/checklists";
import { takeTest } from "@/lib/hr/training";
import { toggleStep } from "@/lib/hr/onboarding";
import type { HrRequestKind } from "@/generated/prisma";

/* Xodimning o'z arizalari ("Mening hisobim") — har qanday rol, faqat o'z kartasi nomidan. */

export async function sendMyRequest(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireSession();
  const emp = await employeeOfUser(s.userId);
  if (!emp || !emp.isActive) return { error: "Loginingiz xodim kartasiga bog'lanmagan — otdel kadrga murojaat qiling" };
  const kind = String(fd.get("kind") ?? "") as HrRequestKind;
  if (!REQUEST_KINDS.includes(kind)) return { error: "Ariza turini tanlang" };
  const str = (k: string) => { const v = String(fd.get(k) ?? "").trim(); return v || null; };
  const amount = str("amount");
  const r = await createHrRequest({
    employeeId: emp.id, kind, dateFrom: str("dateFrom"), dateTo: str("dateTo"),
    amount: amount ? Number(amount.replace(/\s/g, "")) : null, reason: str("reason"), clientToken: str("clientToken"),
  }, s.userId);
  if (r.error) return { error: r.error };
  revalidatePath("/hisobim"); revalidatePath("/otdel-kadr");
  return { ok: true, note: r.existed ? `${r.docNo} allaqachon yuborilgan` : r.note };
}

export async function cancelMyRequest(id: string): Promise<ActionState> {
  const s = await requireSession();
  const r = await cancelHrRequest(id, s.userId);
  if (r.error) return { error: r.error };
  revalidatePath("/hisobim"); revalidatePath("/otdel-kadr");
  return { ok: true, note: r.note };
}

/** Bugungi cheklistni belgilash: `item` — belgilangan bandlar kalitlari (to'liq ro'yxat). */
export async function saveMyChecklistAction(templateId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireSession();
  const emp = await employeeOfUser(s.userId);
  if (!emp || !emp.isActive) return { error: "Loginingiz xodim kartasiga bog'lanmagan" };
  const r = await saveMyChecklist(emp, templateId, fd.getAll("item").map(String), s.userId);
  if ("error" in r) return { error: r.error };
  revalidatePath("/hisobim"); revalidatePath("/otdel-kadr");
  return { ok: true, note: r.note };
}

/** Test topshirish: `a<n>` — n-savolga tanlangan variant. */
export async function takeTestAction(courseId: string, _prev: TestState, fd: FormData): Promise<TestState> {
  const s = await requireSession();
  const emp = await employeeOfUser(s.userId);
  if (!emp || !emp.isActive) return { error: "Loginingiz xodim kartasiga bog'lanmagan" };
  const total = Number(fd.get("total") ?? 0);
  const answers = Array.from({ length: total }, (_, i) => { const v = fd.get(`a${i}`); return v == null || v === "" ? null : Number(v); });
  const r = await takeTest(courseId, emp.id, answers, s.userId);
  if ("error" in r) return { error: r.error };
  revalidatePath("/hisobim"); revalidatePath(`/hisobim/kurs/${courseId}`);
  return { ok: true, score: r.score, passed: r.passed, correct: r.correct, total: r.total, passScore: r.passScore, certificateNo: r.certificateNo };
}
export type TestState = { ok?: boolean; error?: string; score?: number; passed?: boolean; correct?: number; total?: number; passScore?: number; certificateNo?: string | null } | undefined;

/** Moslashuv qadamini belgilash — xodimning o'zi yoki murabbiy. */
export async function myStepAction(stepId: string, done: boolean): Promise<ActionState> {
  const s = await requireSession();
  const r = await toggleStep(stepId, done, s, false);
  if ("error" in r) return { error: r.error };
  revalidatePath("/hisobim");
  return { ok: true };
}
