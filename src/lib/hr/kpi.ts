import type { KpiMetric, KpiSource } from "@/generated/prisma";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { dayUtc, isoDay, monthDays, today } from "@/lib/davomat";
import { employeesInWindow } from "@/lib/attendance-report";
import { plansInRange } from "./shifts";
import { checklistPct } from "./checklists";
import { KPI_SOURCE } from "./labels";

/**
 * KPI — reja, fakt va mukofot avtomatik. Ko'rsatkich (`KpiMetric`) lavozim / xodim / hamma uchun; fakt manbasi:
 * davomat, vazifalar, cheklistlar, sotuv m³, brigada ishlab chiqarishi yoki qo'lda (`KpiResult`). Kadr avtomatik faktni
 * ham qo'lda tuzatishi mumkin (KpiResult bo'lsa — u ustun).
 *
 * Mukofot: bajarilish % = fakt / reja; `minPct` dan kam — 0; aks holda mukofot × min(%, capPct) / 100.
 * Oy yakuni ish haqiga bonus bo'lib qo'shiladi (`lib/hr/payroll.ts` → "KPI: <nom>").
 */

export type KpiRow = {
  metricId: string; name: string; source: KpiSource; unit: string; employeeId: string; fullName: string; position: string;
  target: number; fact: number | null; pct: number | null; reward: number; manual: boolean; note: string | null;
};

const fits = (m: Pick<KpiMetric, "employeeId" | "position">, e: { id: string; position: string }) =>
  m.employeeId ? m.employeeId === e.id : !m.position || m.position.trim().toLowerCase() === e.position.trim().toLowerCase();

export function rewardOf(m: { reward: unknown; minPct: number; capPct: number }, pct: number | null): number {
  if (pct == null || pct < m.minPct) return 0;
  return Math.round((Number(m.reward) * Math.min(pct, m.capPct)) / 100);
}

/** Oy bo'yicha barcha KPI natijalari (`employeeIds` berilsa — faqat shular). */
export async function kpiMonth(month: string, opts: { employeeIds?: string[] } = {}): Promise<KpiRow[]> {
  const metrics = await db.kpiMetric.findMany({ where: { isActive: true }, orderBy: { createdAt: "asc" } });
  if (!metrics.length) return [];
  const days = monthDays(month);
  const from = days[0]!.iso, to = days[days.length - 1]!.iso;
  const emps = await db.employee.findMany({
    where: { AND: [employeesInWindow(dayUtc(from), dayUtc(to)), ...(opts.employeeIds ? [{ id: { in: opts.employeeIds } }] : [])] },
    orderBy: { fullName: "asc" }, select: { id: true, fullName: true, position: true, workSchedule: true, userId: true, brigadeId: true, hiredAt: true, firedAt: true },
  });
  const pairs = emps.flatMap((e) => metrics.filter((m) => fits(m, e)).map((m) => ({ m, e })));
  if (!pairs.length) return [];
  const ids = [...new Set(pairs.map((p) => p.e.id))];
  const need = new Set(pairs.map((p) => p.m.source));
  const now = today();
  const upto = to < now ? to : now;

  const manual = await db.kpiResult.findMany({ where: { month, employeeId: { in: ids } } });
  const manBy = new Map(manual.map((r) => [`${r.metricId}|${r.employeeId}`, r]));

  // Ish kunlari (grafik) — davomat va cheklist ulushi uchun
  const plans = need.has("ATTENDANCE") || need.has("CHECKLIST") ? await plansInRange(emps.filter((e) => ids.includes(e.id)), from, to) : new Map();
  const workDays = (id: string) => {
    const e = emps.find((x) => x.id === id)!;
    const lo = e.hiredAt && isoDay(e.hiredAt) > from ? isoDay(e.hiredAt) : from;
    const hi = e.firedAt && isoDay(e.firedAt) < upto ? isoDay(e.firedAt) : upto;
    return days.filter((d) => d.iso >= lo && d.iso <= hi && !(plans.get(id)?.get(d.iso)?.off ?? d.weekend)).map((d) => d.iso);
  };

  const fact = new Map<string, number | null>(); // `${source}|${employeeId}`
  if (need.has("ATTENDANCE")) {
    const att = await db.attendance.findMany({ where: { employeeId: { in: ids }, date: { gte: dayUtc(from), lte: dayUtc(upto) }, status: "PRESENT" }, select: { employeeId: true, date: true } });
    for (const id of ids) {
      const wd = new Set(workDays(id));
      const present = att.filter((a) => a.employeeId === id && wd.has(isoDay(a.date))).length;
      fact.set(`ATTENDANCE|${id}`, wd.size ? Math.round((present / wd.size) * 1000) / 10 : null);
    }
  }
  if (need.has("TASKS")) {
    const tasks = await db.workTask.findMany({
      where: { assigneeId: { in: ids }, dueDate: { gte: dayUtc(from), lte: dayUtc(upto) }, status: { not: "CANCELLED" } },
      select: { assigneeId: true, dueDate: true, status: true, doneAt: true },
    });
    for (const id of ids) {
      const mine = tasks.filter((t) => t.assigneeId === id);
      // Muddatida: "bajarildi" muddat kuni oxirigacha bosilgan va beruvchi qabul qilgan (yoki tekshiruvda)
      const onTime = mine.filter((t) => (t.status === "DONE" || t.status === "REVIEW") && t.doneAt && isoDay(new Date(t.doneAt.getTime() + 5 * 3600e3)) <= isoDay(t.dueDate!)).length;
      fact.set(`TASKS|${id}`, mine.length ? Math.round((onTime / mine.length) * 1000) / 10 : null);
    }
  }
  if (need.has("CHECKLIST")) {
    const pct = await checklistPct(emps.filter((e) => ids.includes(e.id)), month, workDays);
    for (const [id, v] of pct) fact.set(`CHECKLIST|${id}`, v);
  }
  if (need.has("SALES_M3")) {
    const users = emps.filter((e) => e.userId && ids.includes(e.id));
    const orders = users.length ? await db.order.findMany({
      where: { kind: "SALE", createdById: { in: users.map((u) => u.userId!) }, status: { in: ["DELIVERED", "CLOSED"] }, deliveryDate: { gte: dayUtc(from), lte: dayUtc(to) } },
      select: { createdById: true, items: { select: { qtyM3: true } } },
    }) : [];
    for (const u of users) {
      const m3 = orders.filter((o) => o.createdById === u.userId).reduce((s, o) => s + o.items.reduce((x, i) => x + Number(i.qtyM3), 0), 0);
      fact.set(`SALES_M3|${u.id}`, Math.round(m3 * 100) / 100);
    }
  }
  if (need.has("PRODUCTION")) {
    const brigades = [...new Set(emps.map((e) => e.brigadeId).filter((x): x is string => !!x))];
    const prog = brigades.length ? await db.taskProgress.groupBy({ by: ["taskId"], where: { date: { gte: dayUtc(from), lte: dayUtc(to) }, task: { brigadeId: { in: brigades }, status: { not: "CANCELLED" } } }, _sum: { qty: true } }) : [];
    const taskBrig = prog.length ? new Map((await db.brigadeTask.findMany({ where: { id: { in: prog.map((p) => p.taskId) } }, select: { id: true, brigadeId: true } })).map((t) => [t.id, t.brigadeId])) : new Map<string, string>();
    const byBrig = new Map<string, number>();
    for (const p of prog) { const b = taskBrig.get(p.taskId)!; byBrig.set(b, (byBrig.get(b) ?? 0) + Number(p._sum.qty ?? 0)); }
    for (const e of emps) if (ids.includes(e.id)) fact.set(`PRODUCTION|${e.id}`, e.brigadeId ? Math.round((byBrig.get(e.brigadeId) ?? 0) * 1000) / 1000 : null);
  }

  return pairs.map(({ m, e }) => {
    const man = manBy.get(`${m.id}|${e.id}`);
    const auto = m.source === "MANUAL" ? null : fact.get(`${m.source}|${e.id}`) ?? null;
    const f = man ? Number(man.fact) : auto;
    const target = Number(m.target);
    const pct = f == null || target <= 0 ? null : Math.round((f / target) * 1000) / 10;
    return {
      metricId: m.id, name: m.name, source: m.source, unit: m.unit || KPI_SOURCE[m.source].unit, employeeId: e.id, fullName: e.fullName, position: e.position,
      target, fact: f, pct, reward: rewardOf(m, pct), manual: !!man, note: man?.note ?? null,
    };
  });
}

// ───────────────────────── Yozish (otdel kadr) ─────────────────────────

export type MetricInput = { name: string; source: KpiSource; unit: string | null; position: string | null; employeeId: string | null; target: number; reward: number; minPct: number; capPct: number; note: string | null };

export async function saveMetric(id: string | null, v: MetricInput, userId: string) {
  if (!v.name.trim()) return { error: "Ko'rsatkich nomini yozing" };
  if (!(v.target > 0)) return { error: "Reja (maqsad) musbat bo'lsin" };
  if (v.minPct < 0 || v.minPct > 200 || v.capPct < 100 || v.capPct > 300) return { error: "Chegara: minimal 0–200%, yuqori 100–300%" };
  if (v.employeeId && !(await db.employee.findUnique({ where: { id: v.employeeId }, select: { id: true } }))) return { error: "Xodim topilmadi" };
  const data = { name: v.name.trim().slice(0, 120), source: v.source, unit: (v.unit ?? KPI_SOURCE[v.source].unit).slice(0, 20), position: v.employeeId ? null : v.position, employeeId: v.employeeId, target: v.target, reward: Math.round(v.reward), minPct: v.minPct, capPct: v.capPct, note: v.note };
  await db.$transaction(async (tx) => {
    if (id) {
      const before = await tx.kpiMetric.findUniqueOrThrow({ where: { id } });
      const after = await tx.kpiMetric.update({ where: { id }, data });
      await audit(tx, userId, "UPDATE", "KpiMetric", id, before, after);
    } else {
      const x = await tx.kpiMetric.create({ data: { ...data, createdById: userId } });
      await audit(tx, userId, "CREATE", "KpiMetric", x.id, undefined, x);
    }
  });
  return { ok: true as const };
}

export async function toggleMetric(id: string, userId: string) {
  const cur = await db.kpiMetric.findUnique({ where: { id } });
  if (!cur) return { error: "Ko'rsatkich topilmadi" };
  await db.$transaction(async (tx) => {
    await tx.kpiMetric.update({ where: { id }, data: { isActive: !cur.isActive } });
    await audit(tx, userId, "UPDATE", "KpiMetric", id, { isActive: cur.isActive }, { isActive: !cur.isActive });
  });
  return { ok: true as const };
}

/** Faktni qo'lda kiritish / tuzatish (`fact` null — qo'lda yozuv o'chadi, avtomatik qaytadi). Yopilgan oy — yo'q. */
export async function setFact(input: { metricId: string; employeeId: string; month: string; fact: number | null; note: string | null }, userId: string) {
  const closed = await db.payrollRun.findFirst({ where: { month: input.month, kind: "FINAL", status: { in: ["SUBMITTED", "APPROVED", "PAID"] } }, select: { docNo: true } });
  if (closed) return { error: `${input.month} oyining yakuniy vedomosti (${closed.docNo}) tasdiqqa yuborilgan — KPI o'zgarmaydi` };
  if (input.fact != null && (!Number.isFinite(input.fact) || input.fact < 0)) return { error: "Fakt manfiy bo'lmasin" };
  const key = { metricId_employeeId_month: { metricId: input.metricId, employeeId: input.employeeId, month: input.month } };
  await db.$transaction(async (tx) => {
    const before = await tx.kpiResult.findUnique({ where: key });
    if (input.fact == null) { if (before) await tx.kpiResult.delete({ where: key }); }
    else await tx.kpiResult.upsert({ where: key, create: { ...key.metricId_employeeId_month, fact: input.fact, note: input.note, updatedById: userId }, update: { fact: input.fact, note: input.note, updatedById: userId } });
    await audit(tx, userId, "UPDATE", "KpiResult", `${input.metricId}:${input.employeeId}:${input.month}`, before ? { fact: before.fact } : undefined, { fact: input.fact, note: input.note });
  });
  return { ok: true as const };
}
