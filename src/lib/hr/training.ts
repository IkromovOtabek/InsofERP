import type { Prisma } from "@/generated/prisma";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { nextNo } from "@/lib/numbering";
import { dayUtc, today } from "@/lib/davomat";
import { notifyAfter, notifyEmployees } from "@/lib/notify";

/**
 * O'qitish: kurs (material + test), xodimga yoki lavozimga biriktirish, test topshirish (veb va mobil), sertifikat.
 *
 * Savollar kadr tomonidan matn bilan yoziladi (bloklar bo'sh qator bilan ajratiladi):
 *   Savol matni?
 *   + To'g'ri javob
 *   - Noto'g'ri javob
 * Ball = to'g'ri javoblar ulushi, %. `passScore` dan yuqori — o'tdi, sertifikat raqami (SR-YYYY-00001) va muddati beriladi.
 * To'g'ri javoblar xodimga hech qachon yuborilmaydi (`publicQuestions`).
 */

export type Question = { q: string; options: string[]; answer: number };
export const questionsOf = (v: unknown): Question[] =>
  Array.isArray(v) ? v.filter((x): x is Question => !!x && typeof x.q === "string" && Array.isArray(x.options) && typeof x.answer === "number") : [];
export const publicQuestions = (v: unknown) => questionsOf(v).map((x, i) => ({ n: i, q: x.q, options: x.options }));

export function parseQuestions(text: string): { questions: Question[] } | { error: string } {
  const blocks = text.replace(/\r/g, "").split(/\n\s*\n/).map((b) => b.split("\n").map((l) => l.trim()).filter(Boolean)).filter((b) => b.length);
  const out: Question[] = [];
  for (const [i, b] of blocks.entries()) {
    const q = b[0]!.replace(/^\d+[.)]\s*/, "");
    const opts = b.slice(1).filter((l) => /^[+-]/.test(l));
    const options = opts.map((l) => l.slice(1).trim()).filter(Boolean);
    const answer = opts.findIndex((l) => l.startsWith("+"));
    if (options.length < 2) return { error: `${i + 1}-savol: kamida 2 ta javob kerak ("+" to'g'ri, "-" noto'g'ri)` };
    if (answer < 0 || opts.filter((l) => l.startsWith("+")).length !== 1) return { error: `${i + 1}-savol: bitta to'g'ri javobni "+" bilan belgilang` };
    out.push({ q: q.slice(0, 500), options: options.map((o) => o.slice(0, 300)).slice(0, 8), answer });
  }
  if (out.length > 100) return { error: "Savollar 100 tadan oshmasin" };
  return { questions: out };
}
export const questionsToText = (qs: Question[]) => qs.map((x) => [x.q, ...x.options.map((o, i) => `${i === x.answer ? "+" : "-"} ${o}`)].join("\n")).join("\n\n");

export type CourseInput = { title: string; description: string | null; material: string | null; contentUrl: string | null; position: string | null; mandatory: boolean; questionsText: string; passScore: number; validMonths: number | null };

/** Kurs saqlash; `position` bo'lsa — shu lavozimdagi faol xodimlarga avtomatik biriktiriladi. */
export async function saveCourse(id: string | null, v: CourseInput, userId: string) {
  if (v.title.trim().length < 3) return { error: "Kurs nomi kerak" };
  const p = parseQuestions(v.questionsText);
  if ("error" in p) return { error: p.error };
  if (!(v.passScore >= 1 && v.passScore <= 100)) return { error: "O'tish bali 1–100%" };
  if (v.validMonths != null && !(v.validMonths >= 1 && v.validMonths <= 120)) return { error: "Sertifikat muddati 1–120 oy" };
  if (v.contentUrl && !/^https?:\/\//.test(v.contentUrl)) return { error: "Havola http(s):// bilan boshlansin" };
  const data = {
    title: v.title.trim().slice(0, 150), description: v.description?.slice(0, 1000) ?? null, material: v.material?.slice(0, 20000) ?? null,
    contentUrl: v.contentUrl, position: v.position, mandatory: v.mandatory, questions: p.questions as unknown as Prisma.InputJsonValue,
    passScore: v.passScore, validMonths: v.validMonths,
  };
  const courseId = await db.$transaction(async (tx) => {
    if (id) {
      const before = await tx.course.findUniqueOrThrow({ where: { id } });
      const after = await tx.course.update({ where: { id }, data });
      await audit(tx, userId, "UPDATE", "Course", id, before, after);
      return id;
    }
    const x = await tx.course.create({ data: { ...data, createdById: userId } });
    await audit(tx, userId, "CREATE", "Course", x.id, undefined, { ...x, questions: p.questions.length });
    return x.id;
  });
  const auto = v.position ? await assignCourse(courseId, { position: v.position }, null, userId) : null;
  return { ok: true as const, id: courseId, assigned: auto && "count" in auto ? auto.count : 0 };
}

export async function toggleCourse(id: string, userId: string) {
  const cur = await db.course.findUnique({ where: { id } });
  if (!cur) return { error: "Kurs topilmadi" };
  await db.$transaction(async (tx) => {
    await tx.course.update({ where: { id }, data: { isActive: !cur.isActive } });
    await audit(tx, userId, "UPDATE", "Course", id, { isActive: cur.isActive }, { isActive: !cur.isActive });
  });
  return { ok: true as const };
}

/** Biriktirish: xodimlarga yoki lavozimga (allaqachon biriktirilganlar o'tkazib yuboriladi). */
export async function assignCourse(courseId: string, to: { employeeIds?: string[]; position?: string }, dueDate: string | null, userId: string) {
  const c = await db.course.findUnique({ where: { id: courseId }, select: { id: true, title: true, isActive: true } });
  if (!c || !c.isActive) return { error: "Kurs topilmadi yoki o'chirilgan" };
  const emps = await db.employee.findMany({
    where: { isActive: true, ...(to.employeeIds ? { id: { in: to.employeeIds } } : { position: { equals: to.position ?? "", mode: "insensitive" } }) },
    select: { id: true },
  });
  if (!emps.length) return { error: "Biriktiriladigan xodim topilmadi" };
  const r = await db.courseEnrollment.createMany({
    data: emps.map((e) => ({ courseId, employeeId: e.id, assignedById: userId, dueDate: dueDate && /^\d{4}-\d{2}-\d{2}$/.test(dueDate) ? dayUtc(dueDate) : null })),
    skipDuplicates: true,
  });
  if (r.count) {
    await audit(db, userId, "CREATE", "CourseEnrollment", courseId, undefined, { kurs: c.title, biriktirildi: r.count });
    notifyAfter(() => notifyEmployees(emps.map((e) => e.id), { type: "COURSE_ASSIGNED", title: "Yangi kurs biriktirildi", body: c.title, link: { key: "kurslarim", id: courseId }, channel: "oddiy" }));
  }
  return { ok: true as const, count: r.count };
}

/**
 * Test topshirish. `answers` — savol tartibi bo'yicha tanlangan variant indeksi. O'tsa — sertifikat (bir marta raqam,
 * keyingi o'tishda muddati yangilanadi). Bir urinish qulf ostida (ikki marta bosish ikki urinish bo'lmasin).
 */
export async function takeTest(courseId: string, employeeId: string, answers: (number | null)[], userId: string) {
  const c = await db.course.findUnique({ where: { id: courseId } });
  if (!c || !c.isActive) return { error: "Kurs topilmadi" };
  const qs = questionsOf(c.questions);
  if (!qs.length) return { error: "Kursda test yo'q" };
  if (answers.length !== qs.length || answers.some((a) => a == null)) return { error: "Barcha savollarga javob bering" };
  const correct = qs.filter((x, i) => answers[i] === x.answer).length;
  const score = Math.round((correct / qs.length) * 100);
  const passed = score >= c.passScore;
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"course:" + courseId + employeeId}))`;
    const en = await tx.courseEnrollment.findUnique({ where: { courseId_employeeId: { courseId, employeeId } } });
    if (!en) return { error: "Bu kurs sizga biriktirilmagan" };
    const now = new Date();
    const certNo = passed ? en.certificateNo ?? await nextNo(tx, "certificate", "SR") : en.certificateNo;
    const expires = passed && c.validMonths ? dayUtc(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + c.validMonths, now.getUTCDate())).toISOString().slice(0, 10)) : passed ? null : en.expiresAt;
    await tx.courseEnrollment.update({
      where: { id: en.id },
      data: {
        attempts: { increment: 1 }, lastAt: now, bestScore: Math.max(en.bestScore ?? 0, score),
        ...(passed ? { status: "PASSED", passedAt: now, certificateNo: certNo, expiresAt: expires } : en.status === "PASSED" ? {} : { status: "FAILED" }),
      },
    });
    await audit(tx, userId, "UPDATE", "CourseEnrollment", en.id, { status: en.status, bestScore: en.bestScore }, { ball: score, togri: correct, jami: qs.length, otdi: passed, sertifikat: certNo });
    return { ok: true as const, score, correct, total: qs.length, passed, certificateNo: certNo, passScore: c.passScore };
  });
}

const EN_INCLUDE = { course: { select: { id: true, title: true, description: true, mandatory: true, passScore: true, validMonths: true, isActive: true } } } as const;

export async function myCourses(employeeId: string) {
  const rows = await db.courseEnrollment.findMany({ where: { employeeId, course: { isActive: true } }, orderBy: [{ status: "asc" }, { createdAt: "desc" }], include: EN_INCLUDE });
  const now = today();
  return rows.map((r) => ({ ...r, expired: !!r.expiresAt && r.expiresAt.toISOString().slice(0, 10) < now }));
}

/** Xodim uchun kurs: material va savollar (javobsiz). */
export async function courseForEmployee(courseId: string, employeeId: string) {
  const en = await db.courseEnrollment.findUnique({ where: { courseId_employeeId: { courseId, employeeId } }, include: { course: true } });
  if (!en || !en.course.isActive) return null;
  return { enrollment: en, course: { ...en.course, questions: publicQuestions(en.course.questions) } };
}

/** Kadr ko'rinishi: kurslar va har biri bo'yicha sanoq. */
export async function courseStats() {
  const [courses, groups] = await Promise.all([
    db.course.findMany({ orderBy: [{ isActive: "desc" }, { createdAt: "desc" }] }),
    db.courseEnrollment.groupBy({ by: ["courseId", "status"], _count: { _all: true } }),
  ]);
  return courses.map((c) => {
    const g = (s: string) => groups.find((x) => x.courseId === c.id && x.status === s)?._count._all ?? 0;
    return { ...c, questionsCount: questionsOf(c.questions).length, assigned: g("ASSIGNED"), passed: g("PASSED"), failed: g("FAILED") };
  });
}

export async function enrollmentsOf(courseId: string) {
  return db.courseEnrollment.findMany({ where: { courseId }, orderBy: [{ status: "asc" }, { employee: { fullName: "asc" } }], include: { employee: { select: { id: true, fullName: true, position: true } } } });
}

/** Sertifikat (chop etish uchun). */
export async function certificate(enrollmentId: string) {
  return db.courseEnrollment.findFirst({ where: { id: enrollmentId, status: "PASSED", certificateNo: { not: null } }, include: { course: { select: { title: true, validMonths: true } }, employee: { select: { fullName: true, position: true, userId: true } } } });
}
