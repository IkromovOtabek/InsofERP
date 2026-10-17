import { db } from "@/lib/db";
import type { HrRequestStatus } from "@/generated/prisma";
import { dayUtc, isoDay, monthTitle, shiftDay, today } from "@/lib/davomat";
import { cancelHrRequest, createHrRequest, decideHrRequest, employeeOfUser, listHrRequests, periodText } from "@/lib/hr/requests";
import { plansInRange } from "@/lib/hr/shifts";
import { approveRun, breakdownOf, canPayroll, listRuns, myLines, payRun, returnRun, runWithLines, submitRun, PAYROLL_VIEW_ROLES } from "@/lib/hr/payroll";
import { payAccounts } from "@/lib/mechanic-requests";
import { canDo } from "@/lib/permissions";
import {
  PAYROLL_KIND_LABEL, PAYROLL_STATUS_LABEL, PAYROLL_STATUS_TONE, REQUEST_KIND, REQUEST_KINDS, REQUEST_STATUS_LABEL, REQUEST_STATUS_TONE,
} from "@/lib/hr/labels";
import type { MobileUser } from "./auth";
import type { HomeRow, Tone } from "./home";
import type { DetailAction, DetailField, FormField, MobileDetail } from "./detail";
import { ListError, type ListFilter, type MobileList } from "./list";
import { HR_ACCESS } from "./hr-access";
import { runWorkAction, workDetail, workList } from "./hr-work";
import { peopleDetail, peopleList, runPeopleAction } from "./hr-people";
import { runVoiceAction, voiceDetail, voiceList } from "./hr-voice";
import { payLineFields, payLineIds, payrollRecalc, payrollRecalcActions } from "./moliya-extra";

/**
 * Mobil ilova — otdel kadr modullari (server boshqaradigan ro'yxat / kartochka / forma / amal, ilovani o'zgartirmasdan):
 *   · "arizalarim" — xodimning o'z arizalari (har bir rol), "+" — "ariza" formasi;
 *   · "arizalar"   — otdel kadr: kelgan arizalar, tasdiqlash / rad etish;
 *   · "grafigim"   — xodimning 2 haftalik smena grafigi;
 *   · "oyligim"    — xodimning tasdiqlangan ish haqi hisob-kitoblari (qator id — vedomost id);
 *   · "ish-haqi"   — vedomostlar: kadr yuboradi, direktor tasdiqlaydi, kassir to'laydi.
 * Qoidalar — `lib/hr/*` (veb bilan bitta).
 */

const money = (n: number) => `${Math.round(n).toLocaleString("ru-RU")} so'm`;
const dt = (d: Date) => `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;
const WD = ["Yak", "Dush", "Sesh", "Chor", "Pay", "Jum", "Shan"];
const forbid = (): never => { throw new ListError("FORBIDDEN", "Bu bo'limga ruxsat yo'q", 403); };

async function myEmployee(user: MobileUser) {
  const e = await employeeOfUser(user.id);
  if (!e || !e.isActive) throw new ListError("NO_EMPLOYEE", "Loginingiz xodim kartasiga bog'lanmagan — otdel kadrga murojaat qiling", 404);
  return e;
}
const reqRow = (r: Awaited<ReturnType<typeof listHrRequests>>[number], withName: boolean): HomeRow => ({
  id: r.id,
  title: `${REQUEST_KIND[r.kind].label}${withName ? ` · ${r.employee.fullName}` : ""}`,
  subtitle: `${r.docNo} · ${r.dateFrom && r.dateTo ? periodText(isoDay(r.dateFrom), isoDay(r.dateTo)) : dt(r.createdAt)}${r.reason ? ` · ${r.reason}` : ""}`,
  right: r.amount ? money(Number(r.amount)) : undefined,
  status: REQUEST_STATUS_LABEL[r.status], tone: REQUEST_STATUS_TONE[r.status] as Tone,
});

// ───────────────────────── Ro'yxatlar ─────────────────────────

const REQ_TABS: { key: HrRequestStatus | "ALL"; label: string }[] = [
  { key: "PENDING", label: "Kutilmoqda" }, { key: "APPROVED", label: "Tasdiqlangan" }, { key: "REJECTED", label: "Rad etilgan" }, { key: "ALL", label: "Hammasi" },
];

const WORK_KEYS = ["vazifalarim", "cheklistim", "kpim"];
const PEOPLE_KEYS = ["kurslarim", "moslashuvim", "suhbatlarim", "nomzodlar"];
const VOICE_KEYS = ["sorovnomalar", "murojaatlarim", "murojaatlar", "xabarlar"];

export async function hrList(user: MobileUser, key: string, q?: string, filter?: string): Promise<MobileList> {
  if (WORK_KEYS.includes(key)) return workList(user, key, q, filter);
  if (PEOPLE_KEYS.includes(key)) return peopleList(user, key, q, filter);
  if (VOICE_KEYS.includes(key)) return voiceList(user, key);
  const title = HR_ACCESS[key]!.title;
  if (key === "arizalarim") {
    const e = await myEmployee(user);
    const rows = await listHrRequests({ employeeId: e.id, status: "ALL", q, take: 60 });
    return { key, title, rows: rows.map((r) => reqRow(r, false)) };
  }
  if (key === "arizalar") {
    const tab = REQ_TABS.find((t) => t.key === filter) ?? REQ_TABS[0]!;
    const [rows, all] = await Promise.all([listHrRequests({ status: tab.key, q, take: 80 }), db.hrRequest.groupBy({ by: ["status"], _count: { _all: true } })]);
    const cnt = (k: string) => (k === "ALL" ? all.reduce((s, x) => s + x._count._all, 0) : all.find((x) => x.status === k)?._count._all ?? 0);
    const filters: ListFilter[] = REQ_TABS.map((t) => ({ key: t.key, label: t.label, count: cnt(t.key), active: t.key === tab.key }));
    return { key, title, rows: rows.map((r) => reqRow(r, true)), filters };
  }
  if (key === "grafigim") {
    const e = await myEmployee(user);
    const from = today();
    const plan = (await plansInRange([{ id: e.id, workSchedule: e.workSchedule }], from, shiftDay(from, 13))).get(e.id)!;
    return {
      key, title,
      rows: [...plan.entries()].map(([iso, p]) => ({
        id: iso, title: `${WD[dayUtc(iso).getUTCDay()]}, ${iso.slice(8, 10)}.${iso.slice(5, 7)}${iso === from ? " · bugun" : ""}`,
        subtitle: p.off ? "Dam olish kuni" : p.label ?? "Kartadagi ish grafigi",
        right: p.off ? "—" : `${p.start}–${p.end}`, tone: (p.off ? "info" : "brand") as Tone,
      })),
    };
  }
  if (key === "oyligim") {
    const e = await myEmployee(user);
    const lines = await myLines(e.id, 24);
    return {
      key, title,
      rows: lines.map((l) => ({
        id: l.run.id, title: `${monthTitle(l.run.month)} · ${PAYROLL_KIND_LABEL[l.run.kind]}`,
        subtitle: `Hisoblangan ${money(Number(l.gross))}${Number(l.incomeTax) + Number(l.penalty) + Number(l.advanceDeducted) ? ` · ushlanma ${money(Number(l.incomeTax) + Number(l.penalty) + Number(l.advanceDeducted))}` : ""}`,
        right: money(Number(l.net)), status: l.paidAt ? "Berildi" : PAYROLL_STATUS_LABEL[l.run.status], tone: (l.paidAt ? "success" : "warning") as Tone,
      })),
    };
  }
  // "ish-haqi" — vedomostlar; kassirga sukut — to'lov kutayotganlar
  const runs = await listRuns({ take: 60 });
  const tabs = [
    { key: "open", label: "Ochiq", test: (s: string) => ["DRAFT", "SUBMITTED", "APPROVED"].includes(s) },
    { key: "paid", label: "To'langan", test: (s: string) => s === "PAID" },
    { key: "all", label: "Hammasi", test: () => true },
  ];
  const tab = tabs.find((t) => t.key === filter) ?? tabs[0]!;
  return {
    key, title,
    rows: runs.filter((r) => tab.test(r.status)).map((r) => ({
      id: r.id, title: `${r.docNo} · ${PAYROLL_KIND_LABEL[r.kind]}`,
      subtitle: `${monthTitle(r.month)} · ${r._count.lines} xodim${r.note ? ` · ${r.note}` : ""}`,
      right: money(Number(r.net)), status: PAYROLL_STATUS_LABEL[r.status], tone: PAYROLL_STATUS_TONE[r.status] as Tone,
    })),
    filters: tabs.map((t) => ({ key: t.key, label: t.label, count: runs.filter((r) => t.test(r.status)).length, active: t.key === tab.key })),
  };
}

// ───────────────────────── Kartochkalar ─────────────────────────

export async function hrDetail(user: MobileUser, key: string, id: string): Promise<MobileDetail> {
  if (WORK_KEYS.includes(key)) return workDetail(user, key, id);
  if (PEOPLE_KEYS.includes(key)) return peopleDetail(user, key, id);
  if (VOICE_KEYS.includes(key)) return voiceDetail(user, key, id);
  if (key === "arizalarim" || key === "arizalar") return requestDetail(user, key, id);
  if (key === "oyligim") return payslipDetail(user, id);
  if (key === "ish-haqi") return runDetail(user, id);
  if (key === "grafigim") return shiftDayDetail(user, id);
  throw new ListError("UNKNOWN_DETAIL", "Bunday kartochka yo'q", 404);
}

/** «Smena grafigim» qatori (id — `YYYY-MM-DD`): ilova ro'yxatning har qatorini ochadi, shu kunning rejasi. */
async function shiftDayDetail(user: MobileUser, iso: string): Promise<MobileDetail> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso) || Number.isNaN(dayUtc(iso).getTime())) throw new ListError("NOT_FOUND", "Kun topilmadi", 404);
  const e = await myEmployee(user);
  const p = (await plansInRange([{ id: e.id, workSchedule: e.workSchedule }], iso, iso)).get(e.id)?.get(iso);
  if (!p) throw new ListError("NOT_FOUND", "Kun topilmadi", 404);
  return {
    key: "grafigim", id: iso,
    title: `${WD[dayUtc(iso).getUTCDay()]}, ${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`,
    subtitle: e.fullName,
    status: p.off ? "Dam olish kuni" : "Ish kuni", fields: [
      { label: "Holat", value: p.off ? "Dam olish kuni" : "Ish kuni", tone: (p.off ? "info" : "brand") as Tone },
      ...(p.off ? [] : [{ label: "Ish vaqti", value: `${p.start}–${p.end}` }]),
      { label: "Grafik", value: p.label ?? "Kartadagi ish grafigi" },
    ],
    sections: [], actions: [],
  };
}

async function requestDetail(user: MobileUser, key: string, id: string): Promise<MobileDetail> {
  const r = await db.hrRequest.findUnique({ where: { id }, include: { employee: { select: { fullName: true, position: true, userId: true } } } });
  if (!r) throw new ListError("NOT_FOUND", "Ariza topilmadi", 404);
  const own = r.employee.userId === user.id || r.createdById === user.id;
  const decider = (user.role === "DIRECTOR" || user.role === "HR") && canDo(user, "employees", "requests", ["HR"]);
  if (!own && !decider) forbid();
  const meta = REQUEST_KIND[r.kind];
  const actions: DetailAction[] = [];
  if (r.status === "PENDING" && decider && r.employee.userId !== user.id) {
    actions.push({ id: "hrreq.approve", label: "Tasdiqlash", tone: "success", confirm: `${meta.label} — tasdiqlaysizmi? ${meta.hint}` });
    actions.push({ id: "hrreq.reject", label: "Rad etish", tone: "danger", form: [{ name: "note", label: "Sabab", type: "text", required: true }] });
  }
  if (r.status === "PENDING" && own) actions.push({ id: "hrreq.cancel", label: "Qaytarib olish", tone: "danger", confirm: "Arizani qaytarib olasizmi?" });
  const decidedBy = r.decidedById ? (await db.user.findUnique({ where: { id: r.decidedById }, select: { fullName: true } }))?.fullName : null;
  const fields: DetailField[] = [
    { label: "Holat", value: REQUEST_STATUS_LABEL[r.status], tone: REQUEST_STATUS_TONE[r.status] as Tone },
    { label: "Xodim", value: `${r.employee.fullName} · ${r.employee.position}` },
    { label: "Turi", value: meta.label },
    ...(r.dateFrom && r.dateTo ? [{ label: "Davri", value: periodText(isoDay(r.dateFrom), isoDay(r.dateTo)) }] : []),
    ...(r.amount ? [{ label: "Summa", value: money(Number(r.amount)), tone: "brand" as Tone }] : []),
    { label: "Sababi / izoh", value: r.reason },
    { label: "Yuborildi", value: dt(r.createdAt) },
    ...(r.decidedAt && r.status !== "PENDING" ? [{ label: r.status === "CANCELLED" ? "Qaytarib olindi" : "Hal qildi", value: `${decidedBy ?? "—"} · ${dt(r.decidedAt)}` }] : []),
    ...(r.decisionNote ? [{ label: "Javob", value: r.decisionNote }] : []),
    ...(r.appliedDays != null ? [{ label: "Davomatga yozildi", value: `${r.appliedDays} kun` }] : []),
  ];
  return { key, id: r.id, title: meta.label, subtitle: `${r.docNo} · ${r.employee.fullName}`, status: REQUEST_STATUS_LABEL[r.status], fields, sections: [], actions };
}

async function payslipDetail(user: MobileUser, runId: string): Promise<MobileDetail> {
  const e = await myEmployee(user);
  const l = await db.payrollLine.findFirst({ where: { runId, employeeId: e.id, run: { status: { in: ["APPROVED", "PAID"] } } }, include: { run: { select: { docNo: true, month: true, kind: true, status: true } } } });
  if (!l) throw new ListError("NOT_FOUND", "Hisob-kitob topilmadi", 404);
  const b = breakdownOf(l.breakdown);
  const n = (v: unknown) => Number(v ?? 0);
  const fields: DetailField[] = [
    { label: "Qo'lga", value: money(n(l.net)), tone: "brand" },
    { label: "Holat", value: l.paidAt ? `Berildi · ${dt(l.paidAt)}` : PAYROLL_STATUS_LABEL[l.run.status], tone: l.paidAt ? "success" : "warning" },
    ...(b && l.run.kind === "FINAL" ? [
      { label: "Ish kunlari", value: `${b.presentDays} / ${b.normDays}${b.minutes ? ` · ${Math.round(b.minutes / 60)} soat` : ""}` },
      ...(b.paidLeaveDays ? [{ label: "Ta'til", value: `${b.paidLeaveDays} kun · ${money(n(l.leavePay))}` }] : []),
      ...(b.sickDays ? [{ label: "Kasallik", value: `${b.sickDays} kun (${b.sickPct}%) · ${money(n(l.sickPay))}` }] : []),
    ] : []),
    { label: "Asosiy", value: money(n(l.base)) },
    ...(n(l.bonus) ? [{ label: "Bonus", value: money(n(l.bonus)), tone: "success" as Tone }] : []),
    { label: "Hisoblangan", value: money(n(l.gross)) },
    ...(n(l.incomeTax) ? [{ label: "JShDS", value: `−${money(n(l.incomeTax))}` }] : []),
    ...(n(l.penalty) ? [{ label: "Jarima", value: `−${money(n(l.penalty))}`, tone: "danger" as Tone }] : []),
    ...(n(l.advanceDeducted) ? [{ label: "Berilgan avans", value: `−${money(n(l.advanceDeducted))}` }] : []),
  ];
  const detailRows = [
    ...(b?.advanceFormula ? [{ id: "f", title: b.advanceFormula }] : []),
    ...(b?.rules ?? []).map((h, i) => ({ id: `r${i}`, title: h.rule, subtitle: h.detail, right: `${h.kind === "BONUS" ? "+" : "−"}${money(h.amount)}`, tone: (h.kind === "BONUS" ? "success" : "danger") as Tone })),
    ...(b?.manual ?? []).map((m) => ({ id: m.id, title: m.kind === "BONUS" ? "Bonus" : "Jarima", subtitle: m.reason, right: `${m.kind === "BONUS" ? "+" : "−"}${money(m.amount)}`, tone: (m.kind === "BONUS" ? "success" : "danger") as Tone })),
  ];
  return {
    key: "oyligim", id: runId, title: `${monthTitle(l.run.month)} · ${PAYROLL_KIND_LABEL[l.run.kind]}`, subtitle: l.run.docNo, status: l.paidAt ? "Berildi" : PAYROLL_STATUS_LABEL[l.run.status],
    fields, sections: detailRows.length ? [{ title: "Tafsilot", empty: "", rows: detailRows }] : [], actions: [],
  };
}

async function runDetail(user: MobileUser, id: string): Promise<MobileDetail> {
  if (user.role !== "DIRECTOR" && !PAYROLL_VIEW_ROLES.includes(user.role)) forbid();
  const r = await runWithLines(id);
  if (!r) throw new ListError("NOT_FOUND", "Vedomost topilmadi", 404);
  const n = (v: unknown) => Number(v ?? 0);
  const actions: DetailAction[] = [];
  actions.push(...payrollRecalcActions(user, r)); // qoralamani qayta hisoblash (`./moliya-extra.ts`)
  if (r.status === "DRAFT" && canPayroll(user, "calc")) actions.push({ id: "payroll.submit", label: "Direktor tasdig'iga yuborish", tone: "brand", confirm: "Yuborilgandan keyin qayta hisoblanmaydi. Yuborasizmi?" });
  if (r.status === "SUBMITTED" && canPayroll(user, "approve")) {
    actions.push({ id: "payroll.approve", label: "Tasdiqlash", tone: "success", confirm: `${money(n(r.net))} ish haqini tasdiqlaysizmi? Kassa to'laydi` });
    actions.push({ id: "payroll.return", label: "Qaytarish", tone: "danger", form: [{ name: "note", label: "Nimani tuzatish kerak", type: "text", required: true }] });
  }
  const unpaid = r.lines.filter((l) => !l.paidAt && n(l.net) > 0);
  if (r.status === "APPROVED" && unpaid.length && canPayroll(user, "pay")) {
    const accounts = await payAccounts();
    const left = unpaid.reduce((s, l) => s + n(l.net), 0);
    const form: FormField[] = [
      { name: "cashAccountId", label: "Qaysi kassadan", type: "select", required: true, value: accounts.find((a) => a.type === "CASH")?.id ?? accounts[0]?.id,
        options: accounts.map((a) => ({ value: a.id, label: `${a.name} · ${a.type === "CASH" ? "naqd" : "bank"}`, hint: `qoldiq ${money(a.balance)}` })), hint: `Hammaga ${money(left)} — Kirim-Chiqimda «Ish haqi» chiqimi` },
      { name: "note", label: "Izoh", type: "text" },
      ...payLineFields(unpaid), // kimga to'lanadi — vebdagi kabi tanlab (`./moliya-extra.ts`)
    ];
    actions.push({ id: "payroll.pay", label: `To'lash · ${money(left)}`, tone: "success", form });
  }
  return {
    key: "ish-haqi", id: r.id, title: `${r.docNo} · ${PAYROLL_KIND_LABEL[r.kind]}`, subtitle: `${monthTitle(r.month)} · ${r.lines.length} xodim`, status: PAYROLL_STATUS_LABEL[r.status],
    fields: [
      { label: "Holat", value: PAYROLL_STATUS_LABEL[r.status], tone: PAYROLL_STATUS_TONE[r.status] as Tone },
      { label: "Hisoblangan", value: money(n(r.gross)) },
      { label: "Ushlanma", value: money(n(r.deductions)) },
      { label: "Qo'lga", value: money(n(r.net)), tone: "brand" },
      { label: "To'langan", value: money(n(r.paid)) },
      ...(r.rejectNote && r.status === "DRAFT" ? [{ label: "Direktor izohi", value: r.rejectNote, tone: "warning" as Tone }] : []),
      ...(r.note ? [{ label: "Izoh", value: r.note }] : []),
    ],
    sections: [{
      title: "Xodimlar", empty: "Qator yo'q",
      rows: r.lines.map((l) => ({ id: l.id, title: l.employee.fullName, subtitle: `${l.employee.position} · ${l.workedDays}${l.normDays ? `/${l.normDays}` : ""} kun`, right: money(n(l.net)), tone: (l.paidAt ? "success" : n(l.net) < 0 ? "danger" : "info") as Tone })),
    }],
    actions,
  };
}

// ───────────────────────── Forma va amallar ─────────────────────────

export function requestForm(): { key: string; title: string; submitLabel: string; fields: FormField[] } {
  return {
    key: "ariza", title: "Ariza yuborish", submitLabel: "Yuborish",
    fields: [
      { name: "kind", label: "Ariza turi", type: "select", required: true, value: "VACATION", options: REQUEST_KINDS.map((k) => ({ value: k, label: REQUEST_KIND[k].label, hint: REQUEST_KIND[k].hint })) },
      { name: "dateFrom", label: "Boshlanishi", type: "date", value: today() },
      { name: "dateTo", label: "Tugashi", type: "date", hint: "Bir kun bo'lsa — bo'sh qoldiring" },
      { name: "amount", label: "Avans summasi, so'm", type: "number", showIf: { field: "kind", equals: "ADVANCE" } },
      { name: "reason", label: "Sababi / izoh", type: "text", placeholder: "Masalan: oilaviy sabab, kasallik varaqasi raqami" },
    ],
  };
}

export async function createRequestMobile(user: MobileUser, payload: unknown): Promise<{ key: string; id: string; message: string }> {
  const p = (payload ?? {}) as Record<string, unknown>;
  const e = await myEmployee(user);
  const s = (k: string) => { const v = String(p[k] ?? "").trim(); return v || null; };
  const kind = s("kind");
  if (!kind || !REQUEST_KINDS.includes(kind as never)) throw new Error("Ariza turini tanlang");
  // Sana tanlanmagan bo'lsa (sabab arizasi / avans) — bugun; sanasiz turlarda e'tiborsiz
  const r = await createHrRequest({
    employeeId: e.id, kind: kind as never, dateFrom: s("dateFrom") ?? today(), dateTo: s("dateTo"),
    amount: s("amount") ? Number(String(p.amount).replace(/[\s,]/g, "")) : null, reason: s("reason"), clientToken: s("clientToken"),
  }, user.id);
  if (r.error) throw new Error(r.error);
  return { key: "arizalarim", id: r.id!, message: r.existed ? `${r.docNo} allaqachon yuborilgan` : r.note! };
}

export async function runHrAction(user: MobileUser, action: string, id: string, payload: Record<string, unknown>): Promise<string> {
  const note = String(payload.note ?? "").trim();
  const who = { userId: user.id, role: user.role, perms: user.perms };
  const out = (r: { error?: string; note?: string }) => { if (r.error) throw new ListError("ACTION_FAILED", r.error, 400); return r.note ?? "Bajarildi"; };
  if (action.startsWith("wtask.") || action === "checklist.save") return runWorkAction(user, action, id, payload);
  if (["course.take", "onb.steps", "interview.result", "cand.move"].includes(action)) return runPeopleAction(user, action, id, payload);
  if (["survey.answer", "fb.reply", "fb.hrreply", "fb.resolve"].includes(action)) return runVoiceAction(user, action, id, payload);
  switch (action) {
    case "hrreq.approve":
    case "hrreq.reject":
      if (!canDo(user, "employees", "requests", ["HR"])) forbid();
      return out(await decideHrRequest(id, action === "hrreq.approve", note || null, who));
    case "hrreq.cancel": return out(await cancelHrRequest(id, user.id));
    case "payroll.submit": return out(await submitRun(id, who));
    case "payroll.approve": return out(await approveRun(id, who));
    case "payroll.return": return out(await returnRun(id, note, who));
    case "payroll.pay": return out(await payRun(id, { cashAccountId: String(payload.cashAccountId ?? ""), lineIds: payLineIds(payload), note }, who));
    case "payroll.recalc": return out(await payrollRecalc(user, id));
  }
  throw new ListError("ACTION_FAILED", "Bunday amal yo'q", 404);
}

/** Direktor "Tasdiqlar" tabi — ish haqi vedomostlari (id `ish-haqi:<id>`). */
export async function payrollApprovalRows(q?: string): Promise<HomeRow[]> {
  const runs = await db.payrollRun.findMany({
    where: { status: "SUBMITTED", ...(q ? { docNo: { contains: q, mode: "insensitive" } } : {}) },
    orderBy: { submittedAt: "asc" }, take: 30, include: { _count: { select: { lines: true } } },
  });
  return runs.map((r) => ({
    id: `ish-haqi:${r.id}`, title: `${r.docNo} · ${PAYROLL_KIND_LABEL[r.kind]}`,
    subtitle: `Ish haqi — tasdiq kutmoqda · ${monthTitle(r.month)} · ${r._count.lines} xodim${r.note ? ` · ${r.note}` : ""}`,
    right: money(Number(r.net)), status: "Tasdiq", tone: "warning" as Tone,
  }));
}
