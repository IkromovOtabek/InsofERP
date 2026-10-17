import { db } from "@/lib/db";
import { canDo } from "@/lib/permissions";
import { employeeOfUser } from "@/lib/hr/requests";
import { answerSurvey, createFeedback, getFeedback, listFeedback, mySurveys, replyFeedback, setFeedbackStatus } from "@/lib/hr/voice";
import type { FeedbackKind } from "@/generated/prisma";
import type { MobileUser } from "./auth";
import type { Tone } from "./home";
import type { DetailAction, FormField, MobileDetail } from "./detail";
import { ListError, type MobileList } from "./list";

/**
 * Mobil — 4-faza: "sorovnomalar" (javob berish), "murojaatlarim" + "murojaat" formasi (HR chat, anonim bo'lishi mumkin),
 * "murojaatlar" (otdel kadr — javob, hal qilindi), "xabarlar" (ommaviy xabarlar). Qoidalar `lib/hr/voice.ts`.
 */

const fail = (m: string): never => { throw new ListError("ACTION_FAILED", m, 400); };
const dt = (d: Date) => d.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const KIND: Record<FeedbackKind, string> = { COMPLAINT: "Shikoyat", SUGGESTION: "Taklif", QUESTION: "Savol", THANKS: "Minnatdorchilik" };
const STATUS = { NEW: ["Yangi", "warning"], IN_REVIEW: ["Ko'rib chiqilmoqda", "brand"], RESOLVED: ["Hal qilindi", "success"] } as const;
const isHr = (u: MobileUser) => (u.role === "HR" || u.role === "DIRECTOR") && canDo(u, "employees", "voice", ["HR"]);

async function me(user: MobileUser) {
  const e = await employeeOfUser(user.id);
  if (!e || !e.isActive) throw new ListError("NO_EMPLOYEE", "Loginingiz xodim kartasiga bog'lanmagan — otdel kadrga murojaat qiling", 404);
  return e;
}

export async function voiceList(user: MobileUser, key: string): Promise<MobileList> {
  if (key === "sorovnomalar") {
    const list = await mySurveys(await me(user));
    return { key, title: "So'rovnomalar", rows: list.map((s) => ({ id: s.id, title: s.title, subtitle: `${s.questions.length} savol${s.anonymous ? " · anonim" : ""}`, status: s.answered ? "Javob berildi" : "Javob kutilmoqda", tone: (s.answered ? "success" : "warning") as Tone })) };
  }
  if (key === "xabarlar") {
    const rows = await db.notification.findMany({ where: { userId: user.id, type: "BROADCAST" }, orderBy: { createdAt: "desc" }, take: 50 });
    return { key, title: "Xabarlar", rows: rows.map((n) => ({ id: (n.link as { id?: string } | null)?.id ?? n.id, title: n.title, subtitle: `${dt(n.createdAt)} · ${n.body.slice(0, 80)}`, tone: (n.readAt ? "info" : "brand") as Tone })) };
  }
  const hr = key === "murojaatlar";
  if (hr && !isHr(user)) throw new ListError("FORBIDDEN", "Bu bo'limga ruxsat yo'q", 403);
  const rows = await listFeedback(hr ? { status: "ALL" } : { authorUserId: user.id, status: "ALL" });
  return {
    key, title: hr ? "Murojaatlar" : "Murojaatlarim",
    rows: rows.map((f) => ({ id: f.id, title: f.subject, subtitle: `${KIND[f.kind]} · ${dt(f.updatedAt)}${hr ? ` · ${f.anonymous ? "anonim" : f.author ?? "—"}` : f.anonymous ? " · anonim" : ""}`, right: String(f.messages), status: STATUS[f.status][0], tone: STATUS[f.status][1] as Tone })),
  };
}

export async function voiceDetail(user: MobileUser, key: string, id: string): Promise<MobileDetail> {
  if (key === "sorovnomalar") {
    const s = (await mySurveys(await me(user))).find((x) => x.id === id);
    if (!s) throw new ListError("NOT_FOUND", "So'rovnoma yopiq yoki sizga tegishli emas", 404);
    const form: FormField[] = s.questions.map((q) => (
      q.type === "text" ? { name: q.key, label: q.text, type: "text" }
        : { name: q.key, label: q.text, type: "select", required: true, options: q.type === "nps" ? Array.from({ length: 11 }, (_, n) => ({ value: String(n), label: String(n) })) : q.type === "scale5" ? [1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: "★".repeat(n) })) : (q.options ?? []).map((o) => ({ value: o, label: o })) }
    ));
    return {
      key, id, title: s.title, subtitle: s.anonymous ? "Anonim — javobingiz ismsiz saqlanadi" : undefined, status: s.answered ? "Javob berildi" : "Ochiq",
      fields: [{ label: "Savollar", value: String(s.questions.length) }, ...(s.description ? [{ label: "Izoh", value: s.description }] : [])], sections: [],
      actions: s.answered ? [] : [{ id: "survey.answer", label: "Javob berish", tone: "brand", form }],
    };
  }
  if (key === "xabarlar") {
    const b = await db.broadcast.findUnique({ where: { id } });
    const mine = b ? await db.notification.findFirst({ where: { userId: user.id, type: "BROADCAST", link: { path: ["id"], equals: id } }, select: { id: true } }) : null;
    if (!b || (!mine && !isHr(user))) throw new ListError("NOT_FOUND", "Xabar topilmadi", 404);
    return { key, id, title: b.title, subtitle: dt(b.createdAt), status: b.important ? "Muhim" : undefined, fields: [{ label: "Xabar", value: b.body }], sections: [], actions: [] };
  }
  const hr = key === "murojaatlar";
  if (hr && !isHr(user)) throw new ListError("FORBIDDEN", "Bu bo'limga ruxsat yo'q", 403);
  const f = await getFeedback(id, { userId: user.id }, hr);
  if (!f || (!hr && !f.mine)) throw new ListError("NOT_FOUND", "Murojaat topilmadi", 404);
  const actions: DetailAction[] = [{ id: hr ? "fb.hrreply" : "fb.reply", label: "Javob yozish", tone: "brand", form: [{ name: "text", label: "Xabar", type: "text", required: true }] }];
  if (hr && f.status !== "RESOLVED") actions.push({ id: "fb.resolve", label: "Hal qilindi", tone: "success", confirm: "Murojaat hal qilindimi?" });
  return {
    key, id, title: f.subject, subtitle: `${KIND[f.kind]}${hr ? ` · ${f.anonymous ? "anonim xodim" : f.author ?? ""}` : f.anonymous ? " · anonim" : ""}`, status: STATUS[f.status][0], actions,
    fields: [{ label: "Holat", value: STATUS[f.status][0], tone: STATUS[f.status][1] as Tone }],
    sections: [{ title: "Yozishma", empty: "Xabar yo'q", rows: f.messages.map((m) => ({ id: m.id, title: m.text, subtitle: `${hr ? m.who : m.fromHr ? m.who : "Men"} · ${dt(m.createdAt)}`, tone: (m.fromHr ? "brand" : "info") as Tone })) }],
  };
}

export function feedbackForm() {
  return {
    key: "murojaat", title: "Otdel kadrga murojaat", submitLabel: "Yuborish",
    fields: [
      { name: "kind", label: "Turi", type: "select", required: true, value: "QUESTION", options: (Object.keys(KIND) as FeedbackKind[]).map((k) => ({ value: k, label: KIND[k] })) },
      { name: "subject", label: "Mavzu", type: "text", required: true },
      { name: "text", label: "Matn", type: "text", required: true },
      { name: "anonymous", label: "Anonim — ismim ko'rinmasin", type: "switch", value: "false" },
    ] as FormField[],
  };
}

export async function createFeedbackMobile(user: MobileUser, payload: unknown) {
  const p = (payload ?? {}) as Record<string, unknown>;
  const kind = String(p.kind ?? "") as FeedbackKind;
  if (!(kind in KIND)) throw new Error("Turini tanlang");
  const r = await createFeedback({ kind, subject: String(p.subject ?? ""), text: String(p.text ?? ""), anonymous: p.anonymous === true || p.anonymous === "true" }, { userId: user.id });
  if ("error" in r) throw new Error(r.error);
  return { key: "murojaatlarim", id: r.id, message: "Murojaat yuborildi" };
}

export async function runVoiceAction(user: MobileUser, action: string, id: string, payload: Record<string, unknown>): Promise<string> {
  if (action === "survey.answer") {
    const answers = Object.fromEntries(Object.entries(payload).filter(([k]) => /^s\d+$/.test(k)).map(([k, v]) => [k, String(v ?? "")]));
    const r = await answerSurvey(id, await me(user), answers);
    return "error" in r ? fail(r.error!) : r.note;
  }
  if (action === "fb.reply" || action === "fb.hrreply") {
    const hr = action === "fb.hrreply";
    if (hr && !isHr(user)) return fail("Ruxsat yo'q");
    const r = await replyFeedback(id, String(payload.text ?? ""), { userId: user.id }, hr);
    return "error" in r ? fail(r.error!) : "Yuborildi";
  }
  if (action === "fb.resolve") {
    if (!isHr(user)) return fail("Ruxsat yo'q");
    const r = await setFeedbackStatus(id, "RESOLVED", user.id);
    return "error" in r ? fail(r.error!) : "Hal qilindi";
  }
  return fail("Bunday amal yo'q");
}
