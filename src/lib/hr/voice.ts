import { createHmac } from "node:crypto";
import type { FeedbackKind, FeedbackStatus, Prisma } from "@/generated/prisma";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { authSecret } from "@/lib/secret";
import { notifyAfter, notifyEmployees, notifyRoles, notifyUsers } from "@/lib/notify";

/**
 * Xodim ovozi: so'rovnoma (NPS, baho, variant, matn), HR chat (murojaat — anonim bo'lishi mumkin) va ommaviy xabar.
 *
 * Anonimlik: anonim so'rovnoma javobida va anonim murojaatda xodim id'si saqlanmaydi. Faqat HMAC xesh
 * (AUTH_SECRET bilan) — bir kishi ikki marta javob bermasin va muallif o'z murojaatini ko'rsin; kadr va direktor
 * xeshdan odamni aniqlay olmaydi. AUTH_SECRET almashtirilsa — eski anonim murojaatlar muallifiga ko'rinmay qoladi.
 */

const hmac = (...parts: string[]) => createHmac("sha256", Buffer.from(authSecret())).update(parts.join("|")).digest("hex");
export const authorHashOf = (userId: string) => hmac("feedback", userId);

// ───────────────────────── So'rovnoma ─────────────────────────

export type SurveyQuestion = { key: string; text: string; type: "nps" | "scale5" | "choice" | "text"; options?: string[] };
export const surveyQuestionsOf = (v: unknown): SurveyQuestion[] =>
  Array.isArray(v) ? v.filter((x): x is SurveyQuestion => !!x && typeof x.key === "string" && typeof x.text === "string" && ["nps", "scale5", "choice", "text"].includes(x.type)) : [];

/**
 * Matndan savollar: har qator — savol; boshida tur belgisi:
 *   "NPS: Bizni do'stingizga tavsiya qilasizmi?"  (0–10)
 *   "BAHO: Ish sharoiti"                          (1–5)
 *   "TANLOV: Qaysi smena qulay? | Kunduzgi | Tungi"
 *   "Matn savoli"                                 (erkin javob)
 */
export function parseSurvey(text: string): { questions: SurveyQuestion[] } | { error: string } {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 30);
  const out: SurveyQuestion[] = [];
  for (const [i, l] of lines.entries()) {
    const key = `s${i + 1}`;
    const m = /^(NPS|BAHO|TANLOV)\s*:\s*(.+)$/i.exec(l);
    if (!m) { out.push({ key, text: l.slice(0, 300), type: "text" }); continue; }
    const kind = m[1]!.toUpperCase();
    if (kind === "NPS") out.push({ key, text: m[2]!.slice(0, 300), type: "nps" });
    else if (kind === "BAHO") out.push({ key, text: m[2]!.slice(0, 300), type: "scale5" });
    else {
      const [q, ...opts] = m[2]!.split("|").map((x) => x.trim()).filter(Boolean);
      if (!q || opts.length < 2) return { error: `${i + 1}-qator: TANLOV uchun kamida 2 variant ("| " bilan)` };
      out.push({ key, text: q.slice(0, 300), type: "choice", options: opts.slice(0, 10).map((o) => o.slice(0, 100)) });
    }
  }
  if (!out.length) return { error: "Kamida bitta savol yozing" };
  return { questions: out };
}
export const surveyToText = (qs: SurveyQuestion[]) =>
  qs.map((q) => (q.type === "nps" ? `NPS: ${q.text}` : q.type === "scale5" ? `BAHO: ${q.text}` : q.type === "choice" ? `TANLOV: ${q.text} | ${(q.options ?? []).join(" | ")}` : q.text)).join("\n");

export async function saveSurvey(id: string | null, v: { title: string; description: string | null; anonymous: boolean; position: string | null; text: string; closesAt: string | null }, userId: string) {
  if (v.title.trim().length < 3) return { error: "So'rovnoma nomi kerak" };
  const p = parseSurvey(v.text);
  if ("error" in p) return { error: p.error };
  if (id) {
    const cur = await db.survey.findUnique({ where: { id }, select: { status: true, _count: { select: { responses: true } } } });
    if (!cur) return { error: "So'rovnoma topilmadi" };
    if (cur._count.responses) return { error: "Javoblar kelgan so'rovnomani o'zgartirib bo'lmaydi — yangisini oching" };
  }
  const data = {
    title: v.title.trim().slice(0, 150), description: v.description?.slice(0, 1000) ?? null, anonymous: v.anonymous, position: v.position,
    questions: p.questions as unknown as Prisma.InputJsonValue, closesAt: v.closesAt && /^\d{4}-\d{2}-\d{2}$/.test(v.closesAt) ? new Date(`${v.closesAt}T23:59:59+05:00`) : null,
  };
  return db.$transaction(async (tx) => {
    if (id) {
      const after = await tx.survey.update({ where: { id }, data });
      await audit(tx, userId, "UPDATE", "Survey", id, undefined, after);
      return { ok: true as const, id };
    }
    const x = await tx.survey.create({ data: { ...data, createdById: userId } });
    await audit(tx, userId, "CREATE", "Survey", x.id, undefined, x);
    return { ok: true as const, id: x.id };
  });
}

/** Ochish (xodimlarga bildirishnoma) yoki yopish. */
export async function setSurveyStatus(id: string, status: "OPEN" | "CLOSED", userId: string) {
  const s = await db.survey.findUnique({ where: { id } });
  if (!s) return { error: "So'rovnoma topilmadi" };
  if (s.status === status) return { ok: true as const };
  if (status === "OPEN" && s.status === "CLOSED") return { error: "Yopilgan so'rovnoma qayta ochilmaydi — nusxasini oching" };
  await db.$transaction(async (tx) => {
    await tx.survey.update({ where: { id }, data: { status, ...(status === "OPEN" ? { openedAt: new Date() } : {}) } });
    await audit(tx, userId, "STATUS_CHANGE", "Survey", id, { status: s.status }, { status });
  });
  if (status === "OPEN") {
    const emps = await db.employee.findMany({ where: { isActive: true, userId: { not: null }, ...(s.position ? { position: { equals: s.position, mode: "insensitive" } } : {}) }, select: { id: true } });
    notifyAfter(() => notifyEmployees(emps.map((e) => e.id), { type: "SURVEY_OPEN", title: "Yangi so'rovnoma", body: `${s.title}${s.anonymous ? " · anonim" : ""}`, link: { key: "sorovnomalar", id }, channel: "oddiy" }));
  }
  return { ok: true as const };
}

const surveyOpen = (s: { status: string; closesAt: Date | null }) => s.status === "OPEN" && (!s.closesAt || s.closesAt > new Date());
const fitsPos = (pos: string | null, ep: string) => !pos || pos.trim().toLowerCase() === ep.trim().toLowerCase();

/** Xodim uchun ochiq so'rovnomalar va javob bergan-bermagani. */
export async function mySurveys(employee: { id: string; position: string }) {
  const list = await db.survey.findMany({ where: { status: "OPEN" }, orderBy: { openedAt: "desc" } });
  const mine = list.filter((s) => surveyOpen(s) && fitsPos(s.position, employee.position));
  const answered = new Set((await db.surveyResponse.findMany({ where: { surveyId: { in: mine.map((s) => s.id) }, respondentHash: { in: mine.map((s) => hmac("survey", s.id, employee.id)) } }, select: { surveyId: true } })).map((r) => r.surveyId));
  return mine.map((s) => ({ ...s, questions: surveyQuestionsOf(s.questions), answered: answered.has(s.id) }));
}

/** Javob: `answers` — { kalit: qiymat }. Bir xodim — bir javob (xesh unique). */
export async function answerSurvey(surveyId: string, employee: { id: string; position: string }, answers: Record<string, string>) {
  const s = await db.survey.findUnique({ where: { id: surveyId } });
  if (!s || !surveyOpen(s) || !fitsPos(s.position, employee.position)) return { error: "So'rovnoma yopiq yoki sizga tegishli emas" };
  const qs = surveyQuestionsOf(s.questions);
  const clean: Record<string, string | number> = {};
  for (const q of qs) {
    const raw = (answers[q.key] ?? "").trim();
    if (q.type === "text") { if (raw) clean[q.key] = raw.slice(0, 2000); continue; }
    if (!raw) return { error: `Javob bering: «${q.text}»` };
    const n = Number(raw);
    if (q.type === "nps" && !(Number.isInteger(n) && n >= 0 && n <= 10)) return { error: `«${q.text}» — 0 dan 10 gacha` };
    if (q.type === "scale5" && !(Number.isInteger(n) && n >= 1 && n <= 5)) return { error: `«${q.text}» — 1 dan 5 gacha` };
    if (q.type === "choice" && !(q.options ?? []).includes(raw)) return { error: `«${q.text}» — variantlardan birini tanlang` };
    clean[q.key] = q.type === "choice" ? raw : n;
  }
  try {
    await db.surveyResponse.create({ data: { surveyId, employeeId: s.anonymous ? null : employee.id, respondentHash: hmac("survey", surveyId, employee.id), answers: clean } });
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") return { error: "Siz bu so'rovnomaga javob bergansiz" };
    throw e;
  }
  return { ok: true as const, note: s.anonymous ? "Rahmat! Javobingiz anonim saqlandi" : "Rahmat! Javobingiz saqlandi" };
}

/** Natijalar: NPS (promouterlar − kritiklar), o'rtacha baho, variantlar taqsimoti, matnli javoblar (anonimda — ismsiz). */
export async function surveyResults(id: string) {
  const s = await db.survey.findUnique({ where: { id }, include: { responses: { orderBy: { createdAt: "desc" } } } });
  if (!s) return null;
  const qs = surveyQuestionsOf(s.questions);
  const names = s.anonymous ? new Map<string, string>() : new Map((await db.employee.findMany({ where: { id: { in: s.responses.map((r) => r.employeeId).filter((x): x is string => !!x) } }, select: { id: true, fullName: true } })).map((e) => [e.id, e.fullName]));
  const ans = s.responses.map((r) => ({ a: (r.answers ?? {}) as Record<string, string | number>, who: r.employeeId ? names.get(r.employeeId) ?? null : null }));
  const results = qs.map((q) => {
    const vals = ans.map((x) => x.a[q.key]).filter((v) => v !== undefined && v !== "");
    if (q.type === "nps") {
      const n = vals.map(Number);
      const pro = n.filter((x) => x >= 9).length, det = n.filter((x) => x <= 6).length;
      return { q, count: n.length, nps: n.length ? Math.round(((pro - det) / n.length) * 100) : null, avg: n.length ? Math.round((n.reduce((a, b) => a + b, 0) / n.length) * 10) / 10 : null, pro, det };
    }
    if (q.type === "scale5") { const n = vals.map(Number); return { q, count: n.length, avg: n.length ? Math.round((n.reduce((a, b) => a + b, 0) / n.length) * 10) / 10 : null }; }
    if (q.type === "choice") return { q, count: vals.length, dist: (q.options ?? []).map((o) => ({ option: o, n: vals.filter((v) => v === o).length })) };
    return { q, count: vals.length, texts: ans.filter((x) => x.a[q.key]).map((x) => ({ text: String(x.a[q.key]), who: x.who })).slice(0, 200) };
  });
  return { survey: { ...s, questions: qs }, total: s.responses.length, results };
}

// ───────────────────────── HR chat (murojaatlar) ─────────────────────────

export async function createFeedback(input: { kind: FeedbackKind; subject: string; text: string; anonymous: boolean }, user: { userId: string }) {
  const subject = input.subject.trim().slice(0, 150), text = input.text.trim().slice(0, 4000);
  if (subject.length < 3 || text.length < 3) return { error: "Mavzu va matnni yozing" };
  const emp = await db.employee.findFirst({ where: { userId: user.userId, isActive: true }, select: { id: true } });
  if (!emp) return { error: "Loginingiz xodim kartasiga bog'lanmagan" };
  const f = await db.feedback.create({
    data: {
      kind: input.kind, subject, anonymous: input.anonymous, employeeId: input.anonymous ? null : emp.id, authorHash: authorHashOf(user.userId),
      messages: { create: { text, fromHr: false, userId: input.anonymous ? null : user.userId } },
    },
  });
  notifyAfter(() => notifyRoles(["HR"], { type: "FEEDBACK_NEW", title: `Yangi murojaat${input.anonymous ? " (anonim)" : ""}`, body: subject, link: { key: "murojaatlar", id: f.id } }));
  return { ok: true as const, id: f.id };
}

/** Kim o'qiy oladi: kadr (hammasini) yoki muallif (xesh bo'yicha). */
export async function getFeedback(id: string, user: { userId: string }, isHr: boolean) {
  const f = await db.feedback.findUnique({ where: { id }, include: { messages: { orderBy: { createdAt: "asc" } } } });
  if (!f) return null;
  const mine = f.authorHash === authorHashOf(user.userId);
  if (!isHr && !mine) return null;
  const emp = f.employeeId ? await db.employee.findUnique({ where: { id: f.employeeId }, select: { fullName: true, position: true } }) : null;
  const hrNames = new Map((await db.user.findMany({ where: { id: { in: f.messages.filter((m) => m.fromHr && m.userId).map((m) => m.userId!) } }, select: { id: true, fullName: true } })).map((u) => [u.id, u.fullName]));
  return {
    id: f.id, kind: f.kind, subject: f.subject, anonymous: f.anonymous, status: f.status, createdAt: f.createdAt, mine,
    author: f.anonymous ? null : emp ? `${emp.fullName} · ${emp.position}` : null, authorHash: undefined,
    messages: f.messages.map((m) => ({ id: m.id, fromHr: m.fromHr, text: m.text, createdAt: m.createdAt, who: m.fromHr ? `Otdel kadr${m.userId && hrNames.get(m.userId) ? ` · ${hrNames.get(m.userId)}` : ""}` : f.anonymous ? "Anonim xodim" : emp?.fullName ?? "Xodim" })),
  };
}

export async function replyFeedback(id: string, text: string, user: { userId: string }, isHr: boolean) {
  const body = text.trim().slice(0, 4000);
  if (!body) return { error: "Xabar bo'sh" };
  const f = await db.feedback.findUnique({ where: { id }, select: { authorHash: true, employeeId: true, anonymous: true, status: true, subject: true } });
  if (!f) return { error: "Murojaat topilmadi" };
  const mine = f.authorHash === authorHashOf(user.userId);
  if (!isHr && !mine) return { error: "Murojaat topilmadi" };
  await db.$transaction(async (tx) => {
    await tx.feedbackMessage.create({ data: { feedbackId: id, fromHr: isHr && !mine, userId: isHr && !mine ? user.userId : f.anonymous ? null : user.userId, text: body } });
    await tx.feedback.update({ where: { id }, data: { status: isHr && !mine ? (f.status === "NEW" ? "IN_REVIEW" : f.status) : f.status === "RESOLVED" ? "IN_REVIEW" : f.status, updatedAt: new Date() } });
  });
  if (isHr && !mine) {
    // Muallifga xabar: ochiq murojaatda — xodimga; anonimda — qabul qiluvchini bilmaymiz, u «Murojaatlarim»da ko'radi
    if (f.employeeId) notifyAfter(() => notifyEmployees([f.employeeId], { type: "FEEDBACK_REPLY", title: "Otdel kadr javob berdi", body: f.subject, link: { key: "murojaatlarim", id } }));
  } else {
    notifyAfter(() => notifyRoles(["HR"], { type: "FEEDBACK_MESSAGE", title: "Murojaatga yangi xabar", body: f.subject, link: { key: "murojaatlar", id }, channel: "oddiy" }));
  }
  return { ok: true as const };
}

export async function setFeedbackStatus(id: string, status: FeedbackStatus, userId: string) {
  const f = await db.feedback.findUnique({ where: { id }, select: { status: true } });
  if (!f) return { error: "Murojaat topilmadi" };
  await db.$transaction(async (tx) => {
    await tx.feedback.update({ where: { id }, data: { status } });
    await audit(tx, userId, "STATUS_CHANGE", "Feedback", id, { status: f.status }, { status });
  });
  return { ok: true as const };
}

export async function listFeedback(opts: { status?: FeedbackStatus | "open" | "ALL"; authorUserId?: string } = {}) {
  const rows = await db.feedback.findMany({
    where: {
      ...(opts.authorUserId ? { authorHash: authorHashOf(opts.authorUserId) } : {}),
      ...(opts.status === "open" ? { status: { in: ["NEW", "IN_REVIEW"] } } : opts.status && opts.status !== "ALL" ? { status: opts.status } : {}),
    },
    orderBy: { updatedAt: "desc" }, take: 200, include: { _count: { select: { messages: true } } },
  });
  const emps = new Map((await db.employee.findMany({ where: { id: { in: rows.map((r) => r.employeeId).filter((x): x is string => !!x) } }, select: { id: true, fullName: true } })).map((e) => [e.id, e.fullName]));
  return rows.map((r) => ({ id: r.id, kind: r.kind, subject: r.subject, anonymous: r.anonymous, status: r.status, updatedAt: r.updatedAt, createdAt: r.createdAt, messages: r._count.messages, author: r.anonymous ? null : r.employeeId ? emps.get(r.employeeId) ?? null : null }));
}

// ───────────────────────── Ommaviy xabar ─────────────────────────

export async function sendBroadcast(input: { title: string; body: string; positions: string[]; important: boolean }, userId: string) {
  const title = input.title.trim().slice(0, 120), body = input.body.trim().slice(0, 2000);
  if (title.length < 3 || body.length < 3) return { error: "Sarlavha va matnni yozing" };
  const emps = await db.employee.findMany({
    where: { isActive: true, userId: { not: null }, ...(input.positions.length ? { OR: input.positions.map((p) => ({ position: { equals: p, mode: "insensitive" as const } })) } : {}) },
    select: { userId: true },
  });
  if (!emps.length) return { error: "Qabul qiluvchi xodim yo'q (login bor faol xodimlar)" };
  const b = await db.broadcast.create({ data: { title, body, positions: input.positions, important: input.important, sentCount: emps.length, createdById: userId } });
  await audit(db, userId, "CREATE", "Broadcast", b.id, undefined, { title, qabul: emps.length, positions: input.positions });
  // Bildirishnoma hozir yoziladi (o'qilganlik hisobi shundan), push — fonda
  await notifyUsers(emps.map((e) => e.userId), { type: "BROADCAST", title, body, link: { key: "xabarlar", id: b.id }, channel: input.important ? "muhim" : "oddiy" });
  return { ok: true as const, count: emps.length };
}

/** Ommaviy xabarlar va o'qilganlar soni (Notification.readAt). */
export async function broadcastStats(take = 30) {
  const list = await db.broadcast.findMany({ orderBy: { createdAt: "desc" }, take });
  const ids = list.map((b) => b.id);
  const reads = ids.length
    ? await db.$queryRaw<{ id: string; n: bigint }[]>`SELECT link->>'id' AS id, count(*) AS n FROM "Notification" WHERE type = 'BROADCAST' AND "readAt" IS NOT NULL AND link->>'id' = ANY(${ids}) GROUP BY 1`
    : [];
  const readBy = new Map(reads.map((r) => [r.id, Number(r.n)]));
  return list.map((b) => ({ ...b, read: readBy.get(b.id) ?? 0 }));
}
