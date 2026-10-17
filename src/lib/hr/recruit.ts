import type { CandidateStage, InterviewResult, Prisma, VacancyStatus } from "@/generated/prisma";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { normalizePhone } from "@/lib/phone";
import { duplicateProblem } from "@/lib/kadr-validate";
import { notifyAfter, notifyUsers } from "@/lib/notify";
import { dayUtc, today } from "@/lib/davomat";
import { startPlan } from "./onboarding";
import { STAGE_LABEL, STAGES } from "./labels";

/**
 * Yollash: vakansiya → nomzodlar kanbani (yangi → saralash → suhbat → taklif) → qabul / rad / zaxira.
 * Nomzod o'chirilmaydi (rad etish sababi va zaxira kadr qoladi). Qabul qilinganda: xodim kartasi (F.I.O., telefon,
 * lavozim, ishga kirgan sana) va moslashuv rejasi bitta tranzaksiyada ochiladi; vakansiya to'lsa o'zi yopiladi.
 */

const STALE = "Nomzod boshqa joyda o'zgartirildi — sahifani yangilang";

export type VacancyInput = { title: string; position: string; headcount: number; description: string | null; requirements: string | null; salaryFrom: number | null; salaryTo: number | null };

export async function saveVacancy(id: string | null, v: VacancyInput, userId: string) {
  if (!v.title.trim() || !v.position.trim()) return { error: "Vakansiya nomi va lavozimi kerak" };
  if (!(v.headcount >= 1 && v.headcount <= 500)) return { error: "Kerakli soni 1–500" };
  if (v.salaryFrom != null && v.salaryTo != null && v.salaryTo < v.salaryFrom) return { error: "Maosh oralig'i noto'g'ri" };
  const data = { ...v, title: v.title.trim().slice(0, 150), position: v.position.trim().slice(0, 100) };
  return db.$transaction(async (tx) => {
    if (id) {
      const before = await tx.vacancy.findUniqueOrThrow({ where: { id } });
      const after = await tx.vacancy.update({ where: { id }, data });
      await audit(tx, userId, "UPDATE", "Vacancy", id, before, after);
      return { id };
    }
    const x = await tx.vacancy.create({ data: { ...data, createdById: userId } });
    await audit(tx, userId, "CREATE", "Vacancy", x.id, undefined, x);
    return { id: x.id };
  });
}

export async function setVacancyStatus(id: string, status: VacancyStatus, userId: string) {
  const cur = await db.vacancy.findUnique({ where: { id } });
  if (!cur) return { error: "Vakansiya topilmadi" };
  await db.$transaction(async (tx) => {
    await tx.vacancy.update({ where: { id }, data: { status, closedAt: status === "CLOSED" ? new Date() : null } });
    await audit(tx, userId, "STATUS_CHANGE", "Vacancy", id, { status: cur.status }, { status });
  });
  return { ok: true as const };
}

export type CandidateInput = { vacancyId: string | null; fullName: string; phone: string | null; source: string | null; rating: number | null; note: string | null; file?: { stored: string; name: string; type: string } | null };

export async function saveCandidate(id: string | null, v: CandidateInput, userId: string) {
  const fullName = v.fullName.replace(/\s+/g, " ").trim().slice(0, 120);
  if (fullName.length < 3) return { error: "F.I.O. kerak" };
  const phone = v.phone ? normalizePhone(v.phone) : null;
  if (v.phone && !phone) return { error: "Telefon raqami noto'g'ri — +998 XX XXX XX XX" };
  if (v.rating != null && !(v.rating >= 1 && v.rating <= 5)) return { error: "Baho 1–5" };
  if (v.vacancyId && !(await db.vacancy.findUnique({ where: { id: v.vacancyId }, select: { id: true } }))) return { error: "Vakansiya topilmadi" };
  // Bir telefon — bitta nomzod kartasi (qayta ariza bersa — o'sha karta yangilanadi)
  if (phone) {
    const dup = await db.candidate.findFirst({ where: { phone, ...(id ? { id: { not: id } } : {}) }, select: { fullName: true, stage: true } });
    if (dup) return { error: `Bu telefon bilan nomzod bor: ${dup.fullName} (${STAGE_LABEL[dup.stage]})` };
  }
  const data = {
    vacancyId: v.vacancyId, fullName, phone, source: v.source, rating: v.rating, note: v.note?.slice(0, 2000) ?? null,
    ...(v.file ? { file: v.file.stored, fileName: v.file.name, fileType: v.file.type } : {}),
  };
  return db.$transaction(async (tx) => {
    if (id) {
      const before = await tx.candidate.findUniqueOrThrow({ where: { id } });
      const after = await tx.candidate.update({ where: { id }, data });
      await audit(tx, userId, "UPDATE", "Candidate", id, before, after);
      return { id };
    }
    const x = await tx.candidate.create({ data: { ...data, createdById: userId } });
    await audit(tx, userId, "CREATE", "Candidate", x.id, undefined, x);
    return { id: x.id };
  });
}

/** Bosqichni o'zgartirish (qabul — `hireCandidate` orqali). Rad etishda sabab shart. */
export async function moveCandidate(id: string, to: CandidateStage, reason: string | null, userId: string) {
  if (!STAGES.includes(to) || to === "HIRED") return { error: "Qabul qilish — «Ishga qabul qilish» tugmasi orqali" };
  if (to === "REJECTED" && !reason?.trim()) return { error: "Rad etish sababini yozing" };
  const cur = await db.candidate.findUnique({ where: { id }, select: { stage: true } });
  if (!cur) return { error: "Nomzod topilmadi" };
  if (cur.stage === "HIRED") return { error: "Qabul qilingan nomzod bosqichi o'zgarmaydi" };
  const n = await db.$transaction(async (tx) => {
    const x = await tx.candidate.updateMany({ where: { id, stage: cur.stage }, data: { stage: to, stageAt: new Date(), ...(to === "REJECTED" ? { rejectReason: reason!.trim().slice(0, 500) } : {}) } });
    if (x.count) await audit(tx, userId, "STATUS_CHANGE", "Candidate", id, { stage: cur.stage }, { stage: to, reason });
    return x.count;
  });
  return n ? { ok: true as const, note: STAGE_LABEL[to] } : { error: STALE };
}

export async function addInterview(candidateId: string, input: { at: string; place: string | null; interviewerId: string | null }, userId: string) {
  const at = new Date(input.at);
  if (Number.isNaN(at.getTime())) return { error: "Suhbat vaqtini kiriting" };
  const c = await db.candidate.findUnique({ where: { id: candidateId }, select: { fullName: true, stage: true } });
  if (!c) return { error: "Nomzod topilmadi" };
  if (["HIRED", "REJECTED"].includes(c.stage)) return { error: "Bu nomzod bilan jarayon yakunlangan" };
  const iv = await db.$transaction(async (tx) => {
    const x = await tx.interview.create({ data: { candidateId, at, place: input.place, interviewerId: input.interviewerId, createdById: userId } });
    // Suhbat belgilansa — nomzod "Suhbat" bosqichiga o'tadi (oldingi bosqichda bo'lsa)
    await tx.candidate.updateMany({ where: { id: candidateId, stage: { in: ["NEW", "SCREEN", "RESERVE"] } }, data: { stage: "INTERVIEW", stageAt: new Date() } });
    await audit(tx, userId, "CREATE", "Interview", x.id, undefined, x);
    return x;
  });
  if (input.interviewerId && input.interviewerId !== userId) {
    notifyAfter(() => notifyUsers([input.interviewerId], { type: "INTERVIEW_NEW", title: "Suhbat belgilandi", body: `${c.fullName} · ${at.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}${input.place ? ` · ${input.place}` : ""}`, link: { key: "suhbatlar", id: iv.id } }));
  }
  return { ok: true as const };
}

export async function setInterviewResult(id: string, result: InterviewResult, feedback: string | null, userId: string) {
  const cur = await db.interview.findUnique({ where: { id } });
  if (!cur) return { error: "Suhbat topilmadi" };
  await db.$transaction(async (tx) => {
    await tx.interview.update({ where: { id }, data: { result, feedback: feedback?.slice(0, 2000) ?? null } });
    await audit(tx, userId, "UPDATE", "Interview", id, { result: cur.result }, { result, feedback });
  });
  return { ok: true as const };
}

/** Ishga qabul: xodim kartasi + moslashuv rejasi (bitta tranzaksiya), nomzod — HIRED, vakansiya to'lsa — yopiladi. */
export async function hireCandidate(id: string, input: { position: string; hiredAt: string; mentorId: string | null; probationMonths: number }, userId: string) {
  const c = await db.candidate.findUnique({ where: { id }, include: { vacancy: true } });
  if (!c) return { error: "Nomzod topilmadi" };
  if (c.stage === "HIRED") return { error: "Nomzod allaqachon qabul qilingan" };
  if (c.stage === "REJECTED") return { error: "Rad etilgan nomzod — avval zaxiraga yoki bosqichga qaytaring" };
  const position = input.position.trim() || c.vacancy?.position || "";
  if (!position) return { error: "Lavozimni kiriting" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.hiredAt)) return { error: "Ishga kirish sanasini kiriting" };
  const dup = await duplicateProblem(null, c.phone, null);
  if (dup) return { error: dup };
  try {
    const res = await db.$transaction(async (tx) => {
      const lock = await tx.candidate.updateMany({ where: { id, stage: c.stage, employeeId: null }, data: { stage: "HIRED", stageAt: new Date() } });
      if (!lock.count) throw new Error(STALE);
      const e = await tx.employee.create({ data: { fullName: c.fullName, phone: c.phone, position, hiredAt: dayUtc(input.hiredAt), note: `Yollash: ${c.vacancy?.title ?? "nomzod"}${c.source ? ` · manba ${c.source}` : ""}` } });
      await tx.candidate.update({ where: { id }, data: { employeeId: e.id } });
      await audit(tx, userId, "CREATE", "Employee", e.id, undefined, { ...e, via: "yollash", candidateId: id });
      const plan = await startPlan({ employeeId: e.id, mentorId: input.mentorId, startDate: input.hiredAt, probationMonths: input.probationMonths }, userId, tx);
      if ("error" in plan) throw new Error(plan.error);
      if (c.vacancyId && c.vacancy) {
        const hired = await tx.candidate.count({ where: { vacancyId: c.vacancyId, stage: "HIRED" } });
        if (hired >= c.vacancy.headcount && c.vacancy.status !== "CLOSED") {
          await tx.vacancy.update({ where: { id: c.vacancyId }, data: { status: "CLOSED", closedAt: new Date() } });
          await audit(tx, userId, "STATUS_CHANGE", "Vacancy", c.vacancyId, { status: c.vacancy.status }, { status: "CLOSED", sabab: "to'ldi" });
        }
      }
      await audit(tx, userId, "STATUS_CHANGE", "Candidate", id, { stage: c.stage }, { stage: "HIRED", employeeId: e.id });
      return { employeeId: e.id, planId: plan.id! };
    });
    return { ok: true as const, ...res };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

// ───────────────────────── O'qish ─────────────────────────

const CAND_INCLUDE = { vacancy: { select: { id: true, title: true, position: true } }, interviews: { orderBy: { at: "desc" as const } } };
export type CandidateRow = Prisma.CandidateGetPayload<{ include: typeof CAND_INCLUDE }>;

export async function listCandidates(opts: { vacancyId?: string | null; stages?: CandidateStage[]; q?: string } = {}) {
  const q = opts.q?.trim();
  return db.candidate.findMany({
    where: {
      ...(opts.vacancyId ? { vacancyId: opts.vacancyId } : {}),
      ...(opts.stages ? { stage: { in: opts.stages } } : {}),
      ...(q ? { OR: [{ fullName: { contains: q, mode: "insensitive" } }, { phone: { contains: q } }] } : {}),
    },
    orderBy: [{ stageAt: "desc" }], take: 300, include: CAND_INCLUDE,
  });
}

export async function getCandidate(id: string) {
  const c = await db.candidate.findUnique({ where: { id }, include: CAND_INCLUDE });
  if (!c) return null;
  const users = await db.user.findMany({ where: { id: { in: c.interviews.map((i) => i.interviewerId).filter((x): x is string => !!x) } }, select: { id: true, fullName: true } });
  const name = new Map(users.map((u) => [u.id, u.fullName]));
  return { ...c, interviews: c.interviews.map((i) => ({ ...i, interviewerName: i.interviewerId ? name.get(i.interviewerId) ?? null : null })) };
}

/** Suhbatchiga — o'zi o'tkazadigan bugungi va kelgusi suhbatlar (mobil "suhbatlar"). */
export async function myInterviews(userId: string) {
  return db.interview.findMany({
    where: { interviewerId: userId, at: { gte: dayUtc(today()) } },
    orderBy: { at: "asc" }, take: 50, include: { candidate: { select: { id: true, fullName: true, phone: true, vacancy: { select: { title: true } } } } },
  });
}
