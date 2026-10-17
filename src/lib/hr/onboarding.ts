import type { Prisma, ProbationStatus, Role } from "@/generated/prisma";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { dayUtc, isoDay, shiftDay, today } from "@/lib/davomat";
import { notifyAfter, notifyEmployees } from "@/lib/notify";
import { PROBATION_LABEL } from "./labels";

/**
 * Ishga qabul va moslashuv: xodimga murabbiy, sinov muddati va qadamlar ro'yxati (lavozim shablonidan).
 * Qadamni xodimning o'zi, murabbiy yoki otdel kadr belgilaydi; sinov natijasini otdel kadr (yoki direktor) qayd etadi.
 * "O'zi ro'yxatdan o'tadi" — mavjud kirish so'rovi (`AccessRequest`) orqali; nomzod qabul qilinsa reja o'zi ochiladi.
 */

export type StepDef = { title: string; dueDay: number };
export const stepsOf = (v: unknown): StepDef[] =>
  Array.isArray(v) ? v.filter((x): x is StepDef => !!x && typeof x.title === "string").map((x) => ({ title: x.title, dueDay: Number(x.dueDay) || 0 })) : [];

/** "3: Xavfsizlik yo'riqnomasi" — qator boshidagi raqam kun; raqamsiz — 0 (birinchi kun). */
export function stepsFromText(text: string): StepDef[] {
  return text.split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 40).map((l) => {
    const m = /^(\d{1,3})\s*[:.)-]\s*(.+)$/.exec(l);
    return m ? { dueDay: Number(m[1]), title: m[2]!.slice(0, 200) } : { dueDay: 0, title: l.slice(0, 200) };
  });
}
export const stepsToText = (steps: StepDef[]) => steps.map((s) => `${s.dueDay}: ${s.title}`).join("\n");

/** Standart qadamlar — shablon bo'lmasa. */
export const DEFAULT_STEPS: StepDef[] = [
  { dueDay: 0, title: "Mehnat shartnomasi va buyruq imzolandi" },
  { dueDay: 0, title: "Xavfsizlik texnikasi yo'riqnomasi" },
  { dueDay: 1, title: "Ish joyi, maxsus kiyim va asboblar berildi" },
  { dueDay: 1, title: "Yuz (Face ID) ro'yxatga olindi, ilovaga kirdi" },
  { dueDay: 3, title: "Murabbiy bilan ish jarayoni o'rganildi" },
  { dueDay: 7, title: "Majburiy kurslar topshirildi" },
  { dueDay: 30, title: "Birinchi oy suhbati (murabbiy va kadr)" },
];

async function templateFor(position: string): Promise<StepDef[]> {
  const tpls = await db.onboardingTemplate.findMany({ where: { isActive: true }, orderBy: { createdAt: "asc" } });
  const exact = tpls.find((t) => t.position && t.position.trim().toLowerCase() === position.trim().toLowerCase());
  const all = tpls.find((t) => !t.position);
  const steps = stepsOf((exact ?? all)?.steps);
  return steps.length ? steps : DEFAULT_STEPS;
}

/** Reja ochish (xodimga bitta). `tx` berilsa — o'sha tranzaksiyada (nomzodni qabul qilish). */
export async function startPlan(input: { employeeId: string; mentorId?: string | null; startDate: string; probationMonths?: number | null }, userId: string, tx?: Prisma.TransactionClient) {
  const run = async (t: Prisma.TransactionClient) => {
    const e = await t.employee.findUnique({ where: { id: input.employeeId }, select: { id: true, position: true, onboarding: { select: { id: true } } } });
    if (!e) return { error: "Xodim topilmadi" };
    if (e.onboarding) return { error: "Bu xodimda moslashuv rejasi bor" };
    if (input.mentorId && input.mentorId === e.id) return { error: "Xodim o'ziga murabbiy bo'lolmaydi" };
    const months = input.probationMonths ?? 3;
    if (months < 0 || months > 12) return { error: "Sinov muddati 0–12 oy" };
    const start = dayUtc(input.startDate);
    const end = months ? new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + months, start.getUTCDate())) : null;
    const steps = await templateFor(e.position);
    const plan = await t.onboardingPlan.create({
      data: { employeeId: e.id, mentorId: input.mentorId || null, startDate: start, probationEnd: end, createdById: userId, steps: { create: steps.map((s, i) => ({ title: s.title, dueDay: s.dueDay, sortOrder: i })) } },
    });
    await audit(t, userId, "CREATE", "OnboardingPlan", plan.id, undefined, { ...plan, steps: steps.length });
    return { id: plan.id };
  };
  const r = tx ? await run(tx) : await db.$transaction(run);
  if ("id" in r && input.mentorId) {
    notifyAfter(() => notifyEmployees([input.mentorId], { type: "ONBOARDING_MENTOR", title: "Siz murabbiy etib tayinlandingiz", body: "Yangi xodimning moslashuv rejasini kuzating", link: { key: "moslashuvim", id: r.id! } }));
  }
  return r;
}

type Who = { userId: string; role: Role };

/** Qadamni belgilash / qaytarish — xodimning o'zi, murabbiy yoki kadr. */
export async function toggleStep(stepId: string, done: boolean, who: Who, isHr: boolean) {
  const s = await db.onboardingStep.findUnique({ where: { id: stepId }, include: { plan: { select: { id: true, employeeId: true, mentorId: true, status: true } } } });
  if (!s) return { error: "Qadam topilmadi" };
  const me = await db.employee.findFirst({ where: { userId: who.userId }, select: { id: true } });
  const allowed = isHr || (me && (me.id === s.plan.employeeId || me.id === s.plan.mentorId));
  if (!allowed) return { error: "Bu reja sizga tegishli emas" };
  if (s.plan.status !== "ACTIVE" && s.plan.status !== "EXTENDED") return { error: "Sinov muddati yakunlangan — reja o'zgarmaydi" };
  await db.$transaction(async (tx) => {
    await tx.onboardingStep.update({ where: { id: stepId }, data: done ? { doneAt: s.doneAt ?? new Date(), doneById: s.doneById ?? who.userId } : { doneAt: null, doneById: null } });
    await audit(tx, who.userId, "UPDATE", "OnboardingStep", stepId, { done: !!s.doneAt }, { done });
  });
  return { ok: true as const };
}

/** Sinov natijasi: o'tdi / uzaytirildi (yangi muddat) / o'tmadi. "O'tmadi" — ishdan bo'shatish kartadan alohida. */
export async function decideProbation(planId: string, status: Exclude<ProbationStatus, "ACTIVE">, note: string | null, extendTo: string | null, userId: string) {
  const p = await db.onboardingPlan.findUnique({ where: { id: planId }, include: { employee: { select: { fullName: true } } } });
  if (!p) return { error: "Reja topilmadi" };
  if (status === "EXTENDED" && (!extendTo || !/^\d{4}-\d{2}-\d{2}$/.test(extendTo) || extendTo <= today())) return { error: "Uzaytirish uchun kelajakdagi yangi sanani kiriting" };
  if (status === "FAILED" && !note?.trim()) return { error: "Sababini yozing" };
  const n = await db.$transaction(async (tx) => {
    const x = await tx.onboardingPlan.updateMany({
      where: { id: planId, status: { in: ["ACTIVE", "EXTENDED"] } },
      data: { status, result: note?.trim() || null, decidedById: userId, decidedAt: new Date(), ...(status === "EXTENDED" ? { probationEnd: dayUtc(extendTo!) } : {}) },
    });
    if (x.count) await audit(tx, userId, "STATUS_CHANGE", "OnboardingPlan", planId, { status: p.status }, { status, note, extendTo });
    return x.count;
  });
  if (!n) return { error: "Natija allaqachon qayd etilgan" };
  notifyAfter(() => notifyEmployees([p.employeeId], { type: "PROBATION_RESULT", title: `Sinov muddati: ${PROBATION_LABEL[status].toLowerCase()}`, body: note ?? "", link: { key: "moslashuvim", id: planId } }));
  return { ok: true as const, note: `${p.employee.fullName}: ${PROBATION_LABEL[status]}` };
}

export async function saveOnboardingTemplate(id: string | null, input: { name: string; position: string | null; text: string }, userId: string) {
  const steps = stepsFromText(input.text);
  if (!input.name.trim()) return { error: "Shablon nomi kerak" };
  if (!steps.length) return { error: "Kamida bitta qadam yozing" };
  await db.$transaction(async (tx) => {
    if (id) {
      const before = await tx.onboardingTemplate.findUniqueOrThrow({ where: { id } });
      const after = await tx.onboardingTemplate.update({ where: { id }, data: { name: input.name.trim(), position: input.position, steps } });
      await audit(tx, userId, "UPDATE", "OnboardingTemplate", id, before, after);
    } else {
      const x = await tx.onboardingTemplate.create({ data: { name: input.name.trim(), position: input.position, steps } });
      await audit(tx, userId, "CREATE", "OnboardingTemplate", x.id, undefined, x);
    }
  });
  return { ok: true as const };
}

const PLAN_INCLUDE = { employee: { select: { id: true, fullName: true, position: true, hiredAt: true, userId: true } }, steps: { orderBy: { sortOrder: "asc" as const } } };

export async function listPlans(opts: { status?: ProbationStatus | "open" | "ALL" } = {}) {
  const plans = await db.onboardingPlan.findMany({
    where: opts.status === "open" || !opts.status ? { status: { in: ["ACTIVE", "EXTENDED"] } } : opts.status === "ALL" ? {} : { status: opts.status },
    orderBy: [{ probationEnd: { sort: "asc", nulls: "last" } }], include: PLAN_INCLUDE, take: 200,
  });
  const mentors = new Map((await db.employee.findMany({ where: { id: { in: plans.map((p) => p.mentorId).filter((x): x is string => !!x) } }, select: { id: true, fullName: true } })).map((m) => [m.id, m.fullName]));
  return plans.map((p) => ({ ...p, mentorName: p.mentorId ? mentors.get(p.mentorId) ?? null : null, progress: progressOf(p) }));
}

export const progressOf = (p: { startDate: Date; steps: { dueDay: number; doneAt: Date | null }[] }) => {
  const done = p.steps.filter((s) => s.doneAt).length;
  const now = today();
  const late = p.steps.filter((s) => !s.doneAt && shiftDay(isoDay(p.startDate), s.dueDay) < now).length;
  return { done, total: p.steps.length, late };
};

/** Xodimning o'z rejasi va (murabbiy bo'lsa) shogirdlarining rejalari. */
export async function myPlans(employeeId: string) {
  const [own, mentees] = await Promise.all([
    db.onboardingPlan.findUnique({ where: { employeeId }, include: PLAN_INCLUDE }),
    db.onboardingPlan.findMany({ where: { mentorId: employeeId, status: { in: ["ACTIVE", "EXTENDED"] } }, include: PLAN_INCLUDE }),
  ]);
  return { own, mentees };
}

/** Eslatma uchun: sinov muddati 7 kun ichida tugaydigan rejalar. */
export async function probationEnding(days = 7) {
  return db.onboardingPlan.findMany({
    where: { status: { in: ["ACTIVE", "EXTENDED"] }, probationEnd: { lte: dayUtc(shiftDay(today(), days)) } },
    include: { employee: { select: { fullName: true } } }, take: 50,
  });
}
