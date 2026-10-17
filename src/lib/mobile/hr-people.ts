import { db } from "@/lib/db";
import { canDo } from "@/lib/permissions";
import { employeeOfUser } from "@/lib/hr/requests";
import { courseForEmployee, myCourses, takeTest } from "@/lib/hr/training";
import { myPlans, progressOf, toggleStep } from "@/lib/hr/onboarding";
import { getCandidate, listCandidates, moveCandidate, myInterviews, setInterviewResult } from "@/lib/hr/recruit";
import { ENROLL_STATUS_LABEL, INTERVIEW_RESULT_LABEL, PIPELINE, PROBATION_LABEL, STAGE_LABEL, STAGE_TONE } from "@/lib/hr/labels";
import type { CandidateStage, InterviewResult } from "@/generated/prisma";
import type { MobileUser } from "./auth";
import type { Tone } from "./home";
import type { DetailAction, FormField, MobileDetail } from "./detail";
import { ListError, type MobileList } from "./list";

/**
 * Mobil — 3-faza: "kurslarim" (material + test), "moslashuvim" (o'z rejasi va shogirdlari), "suhbatlarim"
 * (suhbatchiga — natija va xulosa), "nomzodlar" (otdel kadr — bosqich). Qoidalar `lib/hr/training|onboarding|recruit.ts`.
 */

const fail = (m: string): never => { throw new ListError("ACTION_FAILED", m, 400); };
const dt = (d: Date) => d.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const d2 = (d: Date) => `${String(d.getUTCDate()).padStart(2, "0")}.${String(d.getUTCMonth() + 1).padStart(2, "0")}.${d.getUTCFullYear()}`;
const recruiter = (u: MobileUser) => (u.role === "HR" || u.role === "DIRECTOR") && canDo(u, "employees", "recruit", ["HR"]);

async function me(user: MobileUser) {
  const e = await employeeOfUser(user.id);
  if (!e || !e.isActive) throw new ListError("NO_EMPLOYEE", "Loginingiz xodim kartasiga bog'lanmagan — otdel kadrga murojaat qiling", 404);
  return e;
}

export async function peopleList(user: MobileUser, key: string, q?: string, filter?: string): Promise<MobileList> {
  if (key === "kurslarim") {
    const e = await me(user);
    const rows = await myCourses(e.id);
    return { key, title: "Kurslarim", rows: rows.map((c) => ({ id: c.course.id, title: `${c.course.title}${c.course.mandatory ? " · majburiy" : ""}`, subtitle: `${c.dueDate && c.status !== "PASSED" ? `muddat ${d2(c.dueDate)} · ` : ""}o'tish ${c.course.passScore}%`, right: c.bestScore != null ? `${c.bestScore}%` : undefined, status: c.expired ? "Muddati o'tgan" : ENROLL_STATUS_LABEL[c.status], tone: (c.expired ? "danger" : c.status === "PASSED" ? "success" : c.status === "FAILED" ? "danger" : "warning") as Tone })) };
  }
  if (key === "moslashuvim") {
    const e = await me(user);
    const { own, mentees } = await myPlans(e.id);
    const plans = [...(own ? [own] : []), ...mentees];
    return { key, title: "Moslashuv", rows: plans.map((p) => { const pr = progressOf(p); return { id: p.id, title: p.employeeId === e.id ? "Mening rejam" : `Shogird: ${p.employee.fullName}`, subtitle: `${PROBATION_LABEL[p.status]}${p.probationEnd ? ` · sinov ${d2(p.probationEnd)} gacha` : ""}`, right: `${pr.done}/${pr.total}`, tone: (pr.late ? "warning" : "brand") as Tone }; }) };
  }
  if (key === "suhbatlarim") {
    const rows = await myInterviews(user.id);
    return { key, title: "Suhbatlarim", rows: rows.map((i) => ({ id: i.id, title: i.candidate.fullName, subtitle: `${dt(i.at)}${i.place ? ` · ${i.place}` : ""}${i.candidate.vacancy ? ` · ${i.candidate.vacancy.title}` : ""}`, status: INTERVIEW_RESULT_LABEL[i.result], tone: (i.result === "PENDING" ? "warning" : i.result === "PASSED" ? "success" : "danger") as Tone })) };
  }
  // "nomzodlar" — otdel kadr
  if (!recruiter(user)) throw new ListError("FORBIDDEN", "Bu bo'limga ruxsat yo'q", 403);
  const stage = (PIPELINE as string[]).includes(filter ?? "") || ["RESERVE", "HIRED", "REJECTED"].includes(filter ?? "") ? (filter as CandidateStage) : null;
  const rows = await listCandidates({ stages: stage ? [stage] : PIPELINE, q });
  return {
    key, title: "Nomzodlar",
    rows: rows.map((c) => ({ id: c.id, title: c.fullName, subtitle: `${c.vacancy?.title ?? "vakansiyasiz"}${c.phone ? ` · ${c.phone}` : ""}`, status: STAGE_LABEL[c.stage], tone: STAGE_TONE[c.stage] as Tone })),
    filters: [{ key: "", label: "Jarayonda", active: !stage }, ...(["RESERVE", "HIRED", "REJECTED"] as CandidateStage[]).map((s) => ({ key: s, label: STAGE_LABEL[s], active: stage === s }))],
  };
}

export async function peopleDetail(user: MobileUser, key: string, id: string): Promise<MobileDetail> {
  if (key === "kurslarim") {
    const e = await me(user);
    const d = await courseForEmployee(id, e.id);
    if (!d) throw new ListError("NOT_FOUND", "Kurs topilmadi", 404);
    const form: FormField[] = d.course.questions.map((x) => ({ name: `a${x.n}`, label: `${x.n + 1}. ${x.q}`, type: "select", required: true, options: x.options.map((o, i) => ({ value: String(i), label: o })) }));
    return {
      key, id, title: d.course.title, subtitle: d.course.description ?? undefined, status: ENROLL_STATUS_LABEL[d.enrollment.status],
      fields: [
        { label: "Holat", value: `${ENROLL_STATUS_LABEL[d.enrollment.status]}${d.enrollment.bestScore != null ? ` · ${d.enrollment.bestScore}%` : ""}`, tone: d.enrollment.status === "PASSED" ? "success" : "warning" },
        { label: "O'tish bali", value: `${d.course.passScore}%` },
        ...(d.enrollment.certificateNo ? [{ label: "Sertifikat", value: `${d.enrollment.certificateNo}${d.enrollment.expiresAt ? ` · ${d2(d.enrollment.expiresAt)} gacha` : ""}`, tone: "success" as Tone }] : []),
        ...(d.course.contentUrl ? [{ label: "Video / hujjat", value: d.course.contentUrl }] : []),
      ],
      sections: d.course.material ? [{ title: "Material", empty: "", rows: d.course.material.split(/\n\s*\n/).slice(0, 60).map((p, i) => ({ id: `m${i}`, title: p.trim() })) }] : [],
      actions: form.length ? [{ id: "course.take", label: `Test topshirish (${form.length} savol)`, tone: "brand", form }] : [],
    };
  }
  if (key === "moslashuvim") {
    const e = await me(user);
    const { own, mentees } = await myPlans(e.id);
    const p = [own, ...mentees].find((x) => x?.id === id);
    if (!p) throw new ListError("NOT_FOUND", "Reja topilmadi", 404);
    const open = p.status === "ACTIVE" || p.status === "EXTENDED";
    return {
      key, id, title: p.employeeId === e.id ? "Mening rejam" : p.employee.fullName, subtitle: PROBATION_LABEL[p.status], status: PROBATION_LABEL[p.status],
      fields: p.steps.map((x) => ({ label: x.title, value: x.doneAt ? `✓ ${d2(x.doneAt)}` : "—", tone: (x.doneAt ? "success" : undefined) as Tone | undefined })),
      sections: [],
      actions: open ? [{ id: "onb.steps", label: "Qadamlarni belgilash", tone: "brand", form: p.steps.map((x): FormField => ({ name: x.id, label: x.title, type: "switch", value: x.doneAt ? "true" : "false" })) }] : [],
    };
  }
  if (key === "suhbatlarim") {
    const i = await db.interview.findUnique({ where: { id }, include: { candidate: { select: { id: true, fullName: true, phone: true, note: true, vacancy: { select: { title: true } } } } } });
    if (!i || (i.interviewerId !== user.id && !recruiter(user))) throw new ListError("NOT_FOUND", "Suhbat topilmadi", 404);
    const actions: DetailAction[] = [{
      id: "interview.result", label: "Natijani yozish", tone: "brand",
      form: [
        { name: "result", label: "Natija", type: "select", required: true, value: i.result, options: Object.entries(INTERVIEW_RESULT_LABEL).map(([k, l]) => ({ value: k, label: l })) },
        { name: "feedback", label: "Xulosa", type: "text", value: i.feedback ?? undefined },
      ],
    }];
    return {
      key, id, title: i.candidate.fullName, subtitle: `${dt(i.at)}${i.place ? ` · ${i.place}` : ""}`, status: INTERVIEW_RESULT_LABEL[i.result], sections: [], actions,
      fields: [
        ...(i.candidate.vacancy ? [{ label: "Vakansiya", value: i.candidate.vacancy.title }] : []),
        ...(i.candidate.phone ? [{ label: "Telefon", value: i.candidate.phone }] : []),
        ...(i.candidate.note ? [{ label: "Izoh", value: i.candidate.note }] : []),
        ...(i.feedback ? [{ label: "Xulosa", value: i.feedback }] : []),
      ],
    };
  }
  // "nomzodlar"
  if (!recruiter(user)) throw new ListError("FORBIDDEN", "Bu bo'limga ruxsat yo'q", 403);
  const c = await getCandidate(id);
  if (!c) throw new ListError("NOT_FOUND", "Nomzod topilmadi", 404);
  const actions: DetailAction[] = c.stage === "HIRED" ? [] : [{
    id: "cand.move", label: "Bosqichni o'zgartirish", tone: "brand",
    form: [
      { name: "stage", label: "Bosqich", type: "select", required: true, value: c.stage, options: (["NEW", "SCREEN", "INTERVIEW", "OFFER", "RESERVE", "REJECTED"] as CandidateStage[]).map((s) => ({ value: s, label: STAGE_LABEL[s] })) },
      { name: "reason", label: "Rad etish sababi", type: "text", showIf: { field: "stage", equals: "REJECTED" } },
    ],
  }];
  return {
    key, id, title: c.fullName, subtitle: c.vacancy?.title ?? "Vakansiyasiz", status: STAGE_LABEL[c.stage], actions,
    fields: [
      { label: "Bosqich", value: STAGE_LABEL[c.stage], tone: STAGE_TONE[c.stage] },
      ...(c.phone ? [{ label: "Telefon", value: c.phone }] : []),
      ...(c.source ? [{ label: "Manba", value: c.source }] : []),
      ...(c.rating ? [{ label: "Baho", value: "★".repeat(c.rating) }] : []),
      ...(c.note ? [{ label: "Izoh", value: c.note }] : []),
      ...(c.rejectReason ? [{ label: "Rad sababi", value: c.rejectReason, tone: "danger" as Tone }] : []),
    ],
    sections: [{ title: "Suhbatlar", empty: "Suhbat yo'q", rows: c.interviews.map((i) => ({ id: i.id, title: dt(i.at), subtitle: `${i.interviewerName ?? "Kadr"}${i.feedback ? ` · ${i.feedback}` : ""}`, right: INTERVIEW_RESULT_LABEL[i.result] })) }],
  };
}

export async function runPeopleAction(user: MobileUser, action: string, id: string, payload: Record<string, unknown>): Promise<string> {
  if (action === "course.take") {
    const e = await me(user);
    const n = Object.keys(payload).filter((k) => /^a\d+$/.test(k)).length;
    const answers = Array.from({ length: n }, (_, i) => { const v = payload[`a${i}`]; return v == null || v === "" ? null : Number(v); });
    const r = await takeTest(id, e.id, answers, user.id);
    if ("error" in r) return fail(r.error!);
    return r.passed ? `O'tdingiz — ${r.score}% (${r.correct}/${r.total}). Sertifikat ${r.certificateNo}` : `O'tmadingiz — ${r.score}% (kerak ${r.passScore}%). Materialni qayta o'qib, yana topshiring`;
  }
  if (action === "onb.steps") {
    let changed = 0;
    const cur = new Map((await db.onboardingStep.findMany({ where: { planId: id }, select: { id: true, doneAt: true } })).map((x) => [x.id, !!x.doneAt]));
    for (const [stepId, v] of Object.entries(payload)) {
      if (typeof v !== "boolean" && v !== "true" && v !== "false") continue;
      const want = v === true || v === "true";
      if (!cur.has(stepId) || cur.get(stepId) === want) continue; // boshqa reja qadami yoki o'zgarmagan
      const r = await toggleStep(stepId, want, { userId: user.id, role: user.role }, false);
      if ("error" in r) return fail(r.error!);
      changed++;
    }
    return changed ? "Saqlandi" : "O'zgarish yo'q";
  }
  if (action === "interview.result") {
    const i = await db.interview.findUnique({ where: { id }, select: { interviewerId: true } });
    if (!i || (i.interviewerId !== user.id && !recruiter(user))) return fail("Bu suhbat sizga tegishli emas");
    const result = String(payload.result ?? "") as InterviewResult;
    if (!["PENDING", "PASSED", "FAILED", "NOSHOW"].includes(result)) return fail("Natijani tanlang");
    const r = await setInterviewResult(id, result, String(payload.feedback ?? "").trim() || null, user.id);
    return "error" in r ? fail(r.error!) : "Natija yozildi";
  }
  if (action === "cand.move") {
    if (!recruiter(user)) return fail("Ruxsat yo'q");
    const r = await moveCandidate(id, String(payload.stage ?? "") as CandidateStage, String(payload.reason ?? "").trim() || null, user.id);
    return "error" in r ? fail(r.error!) : `Bosqich: ${r.note}`;
  }
  return fail("Bunday amal yo'q");
}
