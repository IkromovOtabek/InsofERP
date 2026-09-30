import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { notifyAfter, notifyEmployees, notifyRoles } from "@/lib/notify";
import { productionStaff, type StaffMember } from "@/lib/production-staff";
import { DEFAULT_SHIFT, dayUtc, markOf, toMinutes, today } from "@/lib/davomat";
import { qty as fq } from "@/lib/format";
import { unitLabel } from "@/lib/unit";
import type { BrigadeIssueKind, Prisma, Role, TaskStatus } from "@/generated/prisma";

/**
 * Brigadir ish kuni — smena, topshiriq bosqichlari, muammolar va smena yakuniy hisoboti.
 * Yagona joy: mobil brigadir ekrani (`lib/mobile/brigadier.ts`) va amallar shu yerni chaqiradi.
 *
 * Smena kuniga bitta (`BrigadeShift @@unique([brigadeId, date])`): brigadir ochadi, yopganda
 * o'sha paytdagi raqamlar `report` ga muzlatiladi va ishlab chiqarishga yuboriladi.
 */

type Tone = "brand" | "success" | "warning" | "danger" | "info";

/**
 * Muammo turlari. `owner` — kim hal qiladi va kimga bildirishnoma boradi (har turga bitta mas'ul
 * bo'lim, direktor kuzatuvchi). `blocks` — ochiq muammo topshiriqqa bog'langanda topshiriq holati.
 */
export const BRIGADE_ISSUE: Record<BrigadeIssueKind, { label: string; owner: Role[]; blocks?: string }> = {
  DELAY: { label: "Kechikish", owner: ["PRODUCTION", "SUPERVISOR"] },
  EQUIPMENT: { label: "Uskuna nosozligi", owner: ["PRODUCTION", "SUPERVISOR"], blocks: "Uskuna to'xtagan" },
  MATERIAL: { label: "Material yetishmasligi", owner: ["WAREHOUSE", "PROCUREMENT"], blocks: "Material yetishmaydi" },
  STAFF: { label: "Qo'shimcha ishchi kerak", owner: ["PRODUCTION", "HR"] },
  QUALITY: { label: "Sifat muammosi", owner: ["PRODUCTION", "SUPERVISOR"], blocks: "Sifat nazoratida" },
  OTHER: { label: "Boshqa", owner: ["PRODUCTION"] },
};
export const ISSUE_KINDS = Object.keys(BRIGADE_ISSUE) as BrigadeIssueKind[];
export const isIssueKind = (v: string): v is BrigadeIssueKind => v in BRIGADE_ISSUE;

/** Muammoni hal qila oladigan rollar (brigadir o'z muammosini ham yopadi — masalan uskuna tuzaldi). */
export const ISSUE_RESOLVERS: Role[] = [...new Set(ISSUE_KINDS.flatMap((k) => BRIGADE_ISSUE[k].owner))];
export const canResolveIssue = (role: Role, kind: BrigadeIssueKind) => role === "BRIGADIER" || BRIGADE_ISSUE[kind].owner.includes(role);

// ───────────────────────── Topshiriq bosqichi ─────────────────────────

/**
 * Hujjatdagi bosqich: Brigadaga berildi → Jarayonda → Qisman bajarildi → Bajarildi.
 * Muammo holatlari (Material yetishmaydi, Uskuna to'xtagan, Sifat nazoratida) — topshiriqqa
 * bog'langan OCHIQ muammodan keladi, ya'ni muammo hal qilinganda o'zi yo'qoladi.
 * `TaskStatus` enum'i o'zgarmaydi — veb sahifalar ham, hisob-kitob ham shunday qoladi.
 */
export function taskPhase(t: { status: TaskStatus; startedAt: Date | null; dueDate: Date }, openKinds: BrigadeIssueKind[] = []): { label: string; tone: Tone; late: boolean } {
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const open = t.status === "NEW" || t.status === "IN_PROGRESS";
  const late = open && t.dueDate < start;
  if (t.status === "CANCELLED") return { label: "Bekor qilindi", tone: "danger", late };
  if (t.status === "DONE") return { label: "Bajarildi", tone: "success", late };
  const block = openKinds.map((k) => BRIGADE_ISSUE[k].blocks).find(Boolean);
  if (block) return { label: block, tone: "danger", late };
  if (t.status === "IN_PROGRESS") return { label: "Qisman bajarildi", tone: late ? "danger" : "warning", late };
  if (t.startedAt) return { label: "Jarayonda", tone: late ? "danger" : "brand", late };
  return { label: "Brigadaga berildi", tone: late ? "danger" : "info", late };
}

/** Ishni boshlash — NEW topshiriq "Jarayonda" ga o'tadi; qabul qilingan zayavka "Ishlab chiqarilmoqda". */
export async function startTask(taskId: string, userId: string): Promise<{ error: string } | { ok: true }> {
  const t = await db.brigadeTask.findUniqueOrThrow({ where: { id: taskId }, select: { status: true, startedAt: true, orderId: true, order: { select: { status: true } } } });
  if (t.status !== "NEW" && t.status !== "IN_PROGRESS") return { error: "Topshiriq yopilgan" };
  if (t.startedAt) return { error: "Ish allaqachon boshlangan" };
  await db.$transaction(async (tx) => {
    const now = new Date();
    const r = await tx.brigadeTask.updateMany({ where: { id: taskId, startedAt: null }, data: { startedAt: now } });
    if (r.count !== 1) return;
    if (t.order.status === "CONFIRMED") await tx.order.update({ where: { id: t.orderId }, data: { status: "IN_PRODUCTION" } });
    await audit(tx, userId, "UPDATE", "BrigadeTask", taskId, { startedAt: null }, { startedAt: now });
  });
  return { ok: true };
}

// ───────────────────────── Smena ─────────────────────────

export const shiftOf = (brigadeId: string, iso = today()) =>
  db.brigadeShift.findUnique({ where: { brigadeId_date: { brigadeId, date: dayUtc(iso) } } });

export async function openShift(brigadeId: string, userId: string): Promise<{ error: string } | { ok: true; id: string; created: boolean }> {
  const cur = await shiftOf(brigadeId);
  if (cur?.closedAt) return { error: "Bugungi smena yopilgan — ertaga yangisi ochiladi" };
  if (cur) return { ok: true, id: cur.id, created: false };
  const s = await db.$transaction(async (tx) => {
    const s = await tx.brigadeShift.create({ data: { brigadeId, date: dayUtc(today()), openedById: userId } });
    await audit(tx, userId, "CREATE", "BrigadeShift", s.id, undefined, s);
    return s;
  }).catch(() => null); // bir vaqtda ikki marta bosilsa — @@unique ikkinchisini qaytaradi
  if (!s) { const again = await shiftOf(brigadeId); return again ? { ok: true, id: again.id, created: false } : { error: "Smenani ochib bo'lmadi" }; }
  return { ok: true, id: s.id, created: true };
}

/** Brigada a'zolari (bugungi davomati bilan) — sex tarkibidan (`production-staff.ts`). */
export async function brigadeMembers(brigadeId: string, iso = today()): Promise<StaffMember[]> {
  return (await productionStaff(iso)).members.filter((m) => m.brigadeId === brigadeId);
}
/** Smena boshidan kech kelganmi (belgilangan "Keldi" soati bo'yicha). */
export const isLate = (m: Pick<StaffMember, "status" | "checkIn">) =>
  m.status === "PRESENT" && !!m.checkIn && (toMinutes(m.checkIn) ?? 0) > (toMinutes(DEFAULT_SHIFT.checkIn) ?? 0) + 10;

// ───────────────────────── Reja / fakt ─────────────────────────

/**
 * Kunlik reja va fakt. Reja — muddati shu kungacha bo'lgan (kechikkanlari ham) topshiriqlarning
 * kun boshidagi qoldig'i; fakt — shu kuni qayd qilingan hamma bajarilgan miqdor.
 */
export async function dayPlan(brigadeIds: string[], iso = today()) {
  const from = new Date(`${iso}T00:00:00`), to = new Date(from); to.setDate(to.getDate() + 1);
  const [tasks, progress] = await Promise.all([
    db.brigadeTask.findMany({
      where: { brigadeId: { in: brigadeIds }, status: { not: "CANCELLED" }, dueDate: { lt: to }, OR: [{ status: { in: ["NEW", "IN_PROGRESS"] } }, { progress: { some: { date: { gte: from, lt: to } } } }] },
      select: { id: true, taskNo: true, qty: true, doneQty: true, status: true, startedAt: true, dueDate: true, orderItem: { select: { product: { select: { name: true, unit: true } } } } },
    }),
    db.taskProgress.findMany({ where: { date: { gte: from, lt: to }, task: { brigadeId: { in: brigadeIds } } }, select: { taskId: true, qty: true, task: { select: { orderItem: { select: { product: { select: { unit: true } } } } } } } }),
  ]);
  const doneToday = new Map<string, number>();
  for (const p of progress) doneToday.set(p.taskId, (doneToday.get(p.taskId) ?? 0) + Number(p.qty));
  const rows = tasks.map((t) => {
    const today = doneToday.get(t.id) ?? 0;
    const left = Number(t.qty) - Number(t.doneQty);
    return { ...t, unit: t.orderItem.product.unit, product: t.orderItem.product.name, plan: left + today, fact: today, left };
  });
  const units = new Map<string, { unit: string; plan: number; fact: number }>();
  for (const r of rows) { const u = units.get(r.unit) ?? { unit: r.unit, plan: 0, fact: 0 }; u.plan += r.plan; u.fact += r.fact; units.set(r.unit, u); }
  // Rejadan tashqari (muddati keyinroq) topshiriqlar bo'yicha qilingan ish ham faktga kiradi
  const extra = progress.filter((p) => !rows.some((r) => r.id === p.taskId));
  for (const p of extra) { const unit = p.task.orderItem.product.unit; const u = units.get(unit) ?? { unit, plan: 0, fact: 0 }; u.fact += Number(p.qty); units.set(unit, u); }
  return { rows, units: [...units.values()].sort((a, b) => b.plan - a.plan) };
}

// ───────────────────────── Smena yakuniy hisoboti ─────────────────────────

export type ShiftReport = {
  brigade: string; date: string; leader: string | null;
  openedAt: string; closedAt: string; workMin: number; downtimeMin: number;
  totals: { unit: string; plan: number; fact: number }[];
  tasks: { taskNo: string; product: string; unit: string; plan: number; fact: number; left: number; phase: string; late: boolean; reason: string | null }[];
  staff: { total: number; present: number; late: number; absent: number; other: number; notMarked: number; rows: { name: string; position: string; mark: string; checkIn: string | null; checkOut: string | null }[] };
  defects: { product: string; unit: string; qty: number; reason: string }[];
  issues: { kind: string; note: string; equipment: string | null; downtimeMin: number | null; resolved: boolean }[];
  note: string | null;
};

const pct = (fact: number, plan: number) => (plan > 0 ? Math.round((fact / plan) * 100) : null);

export async function buildShiftReport(brigadeId: string, iso: string, openedAt: Date, closedAt: Date, note: string | null): Promise<ShiftReport> {
  const from = new Date(`${iso}T00:00:00`), to = new Date(from); to.setDate(to.getDate() + 1);
  const [brigade, plan, members, defects, issues] = await Promise.all([
    db.brigade.findUniqueOrThrow({ where: { id: brigadeId }, select: { name: true, leader: { select: { fullName: true } } } }),
    dayPlan([brigadeId], iso),
    brigadeMembers(brigadeId, iso),
    db.productDefect.findMany({ where: { brigadeId, date: { gte: from, lt: to } }, select: { qty: true, reason: true, product: { select: { name: true, unit: true } } } }),
    db.brigadeIssue.findMany({ where: { brigadeId, OR: [{ createdAt: { gte: from, lt: to } }, { resolvedAt: null }] }, orderBy: { createdAt: "asc" }, select: { kind: true, note: true, equipment: true, downtimeMin: true, resolvedAt: true, taskId: true } }),
  ]);
  const openByTask = new Map<string, BrigadeIssueKind[]>();
  for (const i of issues) if (!i.resolvedAt && i.taskId) openByTask.set(i.taskId, [...(openByTask.get(i.taskId) ?? []), i.kind]);
  return {
    brigade: brigade.name, date: iso, leader: brigade.leader?.fullName ?? null,
    openedAt: openedAt.toISOString(), closedAt: closedAt.toISOString(),
    workMin: Math.max(0, Math.round((closedAt.getTime() - openedAt.getTime()) / 60_000)),
    downtimeMin: issues.filter((i) => i.downtimeMin).reduce((s, i) => s + (i.downtimeMin ?? 0), 0),
    totals: plan.units,
    tasks: plan.rows.map((t) => {
      const kinds = openByTask.get(t.id) ?? [];
      const ph = taskPhase(t, kinds);
      return { taskNo: t.taskNo, product: t.product, unit: t.unit, plan: t.plan, fact: t.fact, left: t.left, phase: ph.label, late: ph.late, reason: kinds.length ? kinds.map((k) => BRIGADE_ISSUE[k].label).join(", ") : null };
    }),
    staff: {
      total: members.length,
      present: members.filter((m) => m.status === "PRESENT").length,
      late: members.filter(isLate).length,
      absent: members.filter((m) => m.status === "ABSENT").length,
      other: members.filter((m) => m.status && m.status !== "PRESENT" && m.status !== "ABSENT").length,
      notMarked: members.filter((m) => !m.status).length,
      rows: members.map((m) => ({ name: m.fullName, position: m.position, mark: m.status ? markOf(m.status).label : "belgilanmagan", checkIn: m.checkIn, checkOut: m.checkOut })),
    },
    defects: defects.map((d) => ({ product: d.product.name, unit: d.product.unit, qty: Number(d.qty), reason: d.reason })),
    issues: issues.map((i) => ({ kind: BRIGADE_ISSUE[i.kind].label, note: i.note, equipment: i.equipment, downtimeMin: i.downtimeMin, resolved: !!i.resolvedAt })),
    note,
  };
}

const unitTotal = (rows: { unit: string; qty: number }[]) => {
  const m = new Map<string, number>();
  for (const r of rows) m.set(r.unit, (m.get(r.unit) ?? 0) + r.qty);
  return [...m].map(([u, q]) => `${fq(q)} ${unitLabel(u)}`).join(" + ") || "0";
};

export function shiftSummary(r: ShiftReport) {
  const main = r.totals[0];
  const p = main ? pct(main.fact, main.plan) : null;
  return [
    `${r.brigade}: fakt ${unitTotal(r.totals.map((t) => ({ unit: t.unit, qty: t.fact })))}${p != null ? ` (${p}% reja)` : ""}`,
    `davomat ${r.staff.present}/${r.staff.total}`,
    r.defects.length ? `brak ${unitTotal(r.defects)}` : null,
    r.issues.length ? `${r.issues.length} muammo` : null,
  ].filter(Boolean).join(" · ");
}

/** Smenani yopish: hisobot muzlatiladi, ishlab chiqarishga bildirishnoma. */
export async function closeShift(brigadeId: string, userId: string, note: string | null): Promise<{ error: string } | { ok: true; id: string; summary: string }> {
  const cur = await shiftOf(brigadeId);
  if (!cur) return { error: "Bugun smena ochilmagan" };
  if (cur.closedAt) return { error: "Smena allaqachon yopilgan" };
  const closedAt = new Date();
  const report = await buildShiftReport(brigadeId, today(), cur.openedAt, closedAt, note);
  const summary = shiftSummary(report);
  const r = await db.$transaction(async (tx) => {
    const r = await tx.brigadeShift.updateMany({ where: { id: cur.id, closedAt: null }, data: { closedAt, closedById: userId, report: report as unknown as Prisma.InputJsonValue, summary, note } });
    if (r.count === 1) await audit(tx, userId, "UPDATE", "BrigadeShift", cur.id, { closedAt: null }, { closedAt, summary });
    return r.count;
  });
  if (r !== 1) return { error: "Smena allaqachon yopilgan" };
  notifyAfter(() => notifyRoles(["PRODUCTION", "SUPERVISOR"], {
    type: "SHIFT_REPORT", title: `Smena yopildi — ${report.brigade}`, body: summary, link: { key: "brig-shift", id: cur.id },
  }, { except: userId }));
  return { ok: true, id: cur.id, summary };
}

// ───────────────────────── Muammolar ─────────────────────────

export type IssueInput = { brigadeId: string; taskId?: string | null; kind: BrigadeIssueKind; equipment?: string | null; qty?: number | null; downtimeMin?: number | null; note: string };

export async function reportBrigadeIssue(i: IssueInput, userId: string): Promise<{ error: string } | { ok: true; id: string; text: string }> {
  const meta = BRIGADE_ISSUE[i.kind];
  const note = i.note.trim();
  if (!note) return { error: "Muammoni qisqacha yozing" };
  if (i.kind === "EQUIPMENT" && !i.equipment?.trim()) return { error: "Qaysi uskuna — nomini yozing" };
  if (i.kind === "STAFF" && !(i.qty && i.qty > 0)) return { error: "Nechta ishchi kerakligini yozing" };
  if (i.downtimeMin != null && (i.downtimeMin < 0 || i.downtimeMin > 24 * 60)) return { error: "To'xtash vaqti 0–1440 daqiqa" };
  const brigade = await db.brigade.findUnique({ where: { id: i.brigadeId }, select: { name: true } });
  if (!brigade) return { error: "Brigada topilmadi" };
  const task = i.taskId ? await db.brigadeTask.findUnique({ where: { id: i.taskId }, select: { brigadeId: true, taskNo: true } }) : null;
  if (i.taskId && task?.brigadeId !== i.brigadeId) return { error: "Topshiriq bu brigadaniki emas" };
  const issue = await db.$transaction(async (tx) => {
    const x = await tx.brigadeIssue.create({
      data: { brigadeId: i.brigadeId, taskId: i.taskId || null, kind: i.kind, equipment: i.equipment?.trim() || null, qty: i.qty ?? null, downtimeMin: i.downtimeMin ?? null, note, createdById: userId },
    });
    await audit(tx, userId, "CREATE", "BrigadeIssue", x.id, undefined, x);
    return x;
  });
  const detail = [
    i.kind === "EQUIPMENT" ? i.equipment?.trim() : null,
    i.kind === "STAFF" && i.qty ? `${i.qty} ta ishchi kerak` : null,
    task ? task.taskNo : null,
    note,
  ].filter(Boolean).join(" · ");
  notifyAfter(() => notifyRoles(meta.owner, {
    type: "BRIGADE_ISSUE", title: `${meta.label} — ${brigade.name}`, body: detail, link: { key: "brig-issue", id: issue.id },
  }, { except: userId }));
  const who = meta.owner.map((r) => ({ PRODUCTION: "ishlab chiqarish", SUPERVISOR: "ish boshqaruvchi", WAREHOUSE: "sklad", PROCUREMENT: "snabjeniye", HR: "otdel kadr" } as Partial<Record<Role, string>>)[r] ?? r).join(" va ");
  return { ok: true, id: issue.id, text: `${meta.label} — ${who}ga yuborildi` };
}

export async function resolveBrigadeIssue(id: string, userId: string, resolution: string, downtimeMin?: number | null): Promise<{ error: string } | { ok: true }> {
  if (!resolution.trim()) return { error: "Qanday hal qilinganini yozing" };
  const cur = await db.brigadeIssue.findUnique({ where: { id }, select: { resolvedAt: true, createdById: true, kind: true, brigade: { select: { name: true, leaderId: true } } } });
  if (!cur) return { error: "Muammo topilmadi" };
  if (cur.resolvedAt) return { error: "Muammo allaqachon hal qilingan" };
  const now = new Date();
  await db.$transaction(async (tx) => {
    await tx.brigadeIssue.update({ where: { id }, data: { resolvedAt: now, resolvedById: userId, resolution: resolution.trim(), ...(downtimeMin != null ? { downtimeMin } : {}) } });
    await audit(tx, userId, "UPDATE", "BrigadeIssue", id, { resolvedAt: null }, { resolvedAt: now, resolution });
  });
  // Brigadir bildirgan muammo boshqa bo'limda hal qilinsa — brigadirga xabar
  if (cur.createdById !== userId && cur.brigade.leaderId) {
    const leaderId = cur.brigade.leaderId;
    notifyAfter(() => notifyEmployees([leaderId], {
      type: "BRIGADE_ISSUE_RESOLVED", title: `Hal qilindi — ${BRIGADE_ISSUE[cur.kind].label}`, body: resolution.trim(), link: { key: "brig-issue", id },
    }));
  }
  return { ok: true };
}
