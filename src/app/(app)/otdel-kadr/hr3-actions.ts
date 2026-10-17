"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAction } from "@/lib/auth";
import { parseForm, zOpt, zStr, type ActionState } from "@/lib/action";
import { saveEmployeeFile } from "@/lib/uploads";
import { addInterview, hireCandidate, moveCandidate, saveCandidate, saveVacancy, setInterviewResult, setVacancyStatus } from "@/lib/hr/recruit";
import { decideProbation, saveOnboardingTemplate, startPlan, toggleStep } from "@/lib/hr/onboarding";
import { assignCourse, saveCourse, toggleCourse } from "@/lib/hr/training";
import type { CandidateStage, InterviewResult, ProbationStatus, VacancyStatus } from "@/generated/prisma";

/* Otdel kadr 3-faza: yollash, moslashuv, o'qitish. Qoidalar — `lib/hr/recruit.ts`, `onboarding.ts`, `training.ts`. */

const refresh = (...extra: string[]) => { for (const p of ["/otdel-kadr", "/hisobim", "/employees", ...extra]) revalidatePath(p); };
const num = (v: string | null) => (v == null || v === "" ? null : Number(v.replace(/\s/g, "")));
const res = (r: { error?: string; note?: string }, ok = "Saqlandi"): ActionState => (r.error ? { error: r.error } : { ok: true, note: r.note ?? ok });

// ───────────────────────── Yollash ─────────────────────────

const vacancySchema = z.object({
  title: zStr("Vakansiya nomi kerak"), position: zStr("Lavozim kerak"), headcount: z.coerce.number().int().min(1).max(500).default(1),
  description: zOpt, requirements: zOpt, salaryFrom: zOpt, salaryTo: zOpt,
});

export async function saveVacancyAction(id: string | null, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("employees", "recruit", ["HR"]);
  const r = parseForm(vacancySchema, fd);
  if ("error" in r) return { error: r.error };
  const d = r.data;
  const out = await saveVacancy(id, { ...d, salaryFrom: num(d.salaryFrom), salaryTo: num(d.salaryTo) }, s.userId);
  if ("error" in out) return { error: out.error as string };
  refresh();
  return { ok: true, note: "Vakansiya saqlandi" };
}

export async function vacancyStatusAction(id: string, status: VacancyStatus): Promise<ActionState> {
  const s = await requireAction("employees", "recruit", ["HR"]);
  const r = await setVacancyStatus(id, status, s.userId);
  refresh();
  return res(r);
}

export async function saveCandidateAction(id: string | null, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("employees", "recruit", ["HR"]);
  const str = (k: string) => { const v = String(fd.get(k) ?? "").trim(); return v || null; };
  // Rezyume — PDF yoki rasm (`uploads/employees`, faqat kadr ko'radi)
  const saved = await saveEmployeeFile("nomzod", fd.get("file"));
  if (saved && "error" in saved) return { error: saved.error };
  const r = await saveCandidate(id, {
    vacancyId: str("vacancyId"), fullName: str("fullName") ?? "", phone: str("phone"), source: str("source"),
    rating: num(str("rating")), note: str("note"), file: saved ? { stored: saved.stored, name: saved.name, type: saved.type } : null,
  }, s.userId);
  if ("error" in r) return { error: r.error as string };
  refresh();
  if (!id) redirect(`/otdel-kadr/nomzod/${r.id}`);
  return { ok: true, note: "Saqlandi" };
}

export async function moveCandidateAction(id: string, to: CandidateStage, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("employees", "recruit", ["HR"]);
  const r = await moveCandidate(id, to, String(fd.get("reason") ?? "").trim() || null, s.userId);
  refresh(`/otdel-kadr/nomzod/${id}`);
  return res(r);
}

export async function addInterviewAction(candidateId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("employees", "recruit", ["HR"]);
  const r = await addInterview(candidateId, { at: String(fd.get("at") ?? ""), place: String(fd.get("place") ?? "").trim() || null, interviewerId: String(fd.get("interviewerId") ?? "") || null }, s.userId);
  refresh(`/otdel-kadr/nomzod/${candidateId}`);
  return res(r, "Suhbat belgilandi");
}

export async function interviewResultAction(id: string, candidateId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("employees", "recruit", ["HR"]);
  const result = String(fd.get("result") ?? "") as InterviewResult;
  if (!["PENDING", "PASSED", "FAILED", "NOSHOW"].includes(result)) return { error: "Natijani tanlang" };
  const r = await setInterviewResult(id, result, String(fd.get("feedback") ?? "").trim() || null, s.userId);
  refresh(`/otdel-kadr/nomzod/${candidateId}`);
  return res(r);
}

export async function hireAction(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("employees", "recruit", ["HR"]);
  const r = await hireCandidate(id, {
    position: String(fd.get("position") ?? ""), hiredAt: String(fd.get("hiredAt") ?? ""),
    mentorId: String(fd.get("mentorId") ?? "") || null, probationMonths: Number(fd.get("probationMonths") ?? 3),
  }, s.userId);
  if ("error" in r) return { error: r.error as string };
  refresh(`/otdel-kadr/nomzod/${id}`);
  redirect(`/employees/${r.employeeId}`);
}

// ───────────────────────── Moslashuv ─────────────────────────

export async function startPlanAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("employees", "onboarding", ["HR"]);
  const r = await startPlan({
    employeeId: String(fd.get("employeeId") ?? ""), mentorId: String(fd.get("mentorId") ?? "") || null,
    startDate: String(fd.get("startDate") ?? ""), probationMonths: Number(fd.get("probationMonths") ?? 3),
  }, s.userId);
  if ("error" in r) return { error: r.error as string };
  refresh();
  return { ok: true, note: "Moslashuv rejasi ochildi" };
}

export async function stepAction(stepId: string, done: boolean): Promise<ActionState> {
  const s = await requireAction("employees", "onboarding", ["HR"]);
  const r = await toggleStep(stepId, done, s, true);
  refresh();
  return res(r);
}

export async function decideProbationAction(planId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("employees", "onboarding", ["HR"]);
  const status = String(fd.get("status") ?? "") as Exclude<ProbationStatus, "ACTIVE">;
  if (!["PASSED", "EXTENDED", "FAILED"].includes(status)) return { error: "Natijani tanlang" };
  const r = await decideProbation(planId, status, String(fd.get("note") ?? "").trim() || null, String(fd.get("extendTo") ?? "") || null, s.userId);
  refresh();
  return res(r);
}

export async function saveOnbTemplateAction(id: string | null, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("employees", "onboarding", ["HR"]);
  const r = await saveOnboardingTemplate(id, { name: String(fd.get("name") ?? ""), position: String(fd.get("position") ?? "").trim() || null, text: String(fd.get("steps") ?? "") }, s.userId);
  refresh();
  return res(r, "Shablon saqlandi");
}

// ───────────────────────── O'qitish ─────────────────────────

export async function saveCourseAction(id: string | null, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("employees", "training", ["HR"]);
  const str = (k: string) => { const v = String(fd.get(k) ?? "").trim(); return v || null; };
  const r = await saveCourse(id, {
    title: str("title") ?? "", description: str("description"), material: str("material"), contentUrl: str("contentUrl"),
    position: str("position"), mandatory: fd.get("mandatory") === "on", questionsText: String(fd.get("questions") ?? ""),
    passScore: Number(fd.get("passScore") ?? 70), validMonths: num(str("validMonths")),
  }, s.userId);
  if ("error" in r) return { error: r.error as string };
  refresh(`/otdel-kadr/kurs/${r.id}`);
  if (!id) redirect(`/otdel-kadr/kurs/${r.id}`);
  return { ok: true, note: `Kurs saqlandi${r.assigned ? ` · ${r.assigned} xodimga biriktirildi` : ""}` };
}

export async function toggleCourseAction(id: string): Promise<ActionState> {
  const s = await requireAction("employees", "training", ["HR"]);
  const r = await toggleCourse(id, s.userId);
  refresh(`/otdel-kadr/kurs/${id}`);
  return res(r);
}

export async function assignCourseAction(courseId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireAction("employees", "training", ["HR"]);
  const ids = fd.getAll("emp").map(String).filter(Boolean);
  const position = String(fd.get("position") ?? "").trim();
  if (!ids.length && !position) return { error: "Xodimlarni belgilang yoki lavozimni tanlang" };
  const r = await assignCourse(courseId, ids.length ? { employeeIds: ids } : { position }, String(fd.get("dueDate") ?? "") || null, s.userId);
  if ("error" in r) return { error: r.error as string };
  refresh(`/otdel-kadr/kurs/${courseId}`);
  return { ok: true, note: r.count ? `${r.count} xodimga biriktirildi` : "Hammasi allaqachon biriktirilgan" };
}
