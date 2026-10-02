import { db } from "@/lib/db";
import { dayUtc, today } from "@/lib/davomat";
import { workDays } from "@/lib/production-day";
import type { AttendanceStatus } from "@/generated/prisma";

/**
 * Dashboard davr filtri (bugun / hafta / oy / yil / kalendar) uchun "holat" ko'rsatkichlari:
 * oylik plan davrga bo'linadi, davomat davr bo'yicha yig'iladi. Bosh ekran plitkasi ham,
 * bosilganda ochiladigan kartochka ham shu funksiyalardan o'qiydi — raqamlar bir xil chiqsin.
 */

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** [from, to) oralig'idagi ish kunlari (yakshanbasiz), oy bo'yicha guruhlangan: "YYYY-MM" → kunlar. */
export function periodWorkDays(from: Date, to: Date) {
  const f = iso(from), t = iso(to), now = today();
  const out = new Map<string, { all: string[]; elapsed: string[] }>();
  for (let y = from.getFullYear(), m = from.getMonth(); new Date(y, m, 1) < to; m === 11 ? (y++, m = 0) : m++) {
    const ym = `${y}-${String(m + 1).padStart(2, "0")}`;
    const days = workDays(ym).map((d) => d.iso).filter((d) => d >= f && d < t);
    if (days.length) out.set(ym, { all: days, elapsed: days.filter((d) => d <= now) });
  }
  return out;
}

export type PeriodPlanRow = {
  product: { id: string; code: string; name: string; unit: string };
  plan: number; // butun davr uchun
  expected: number; // bugungacha bajarilishi kerak edi
  fact: number; defect: number;
  pct: number | null; behind: number;
};

/**
 * Davr plani: har oy uchun kunlik plan (belgilanmagan bo'lsa oylik ÷ ish kunlari) × davrning shu oydagi
 * ish kunlari. Fakt — PRODUCTION_OUTPUT (ishlab chiqarish hisoboti bilan bir manba).
 */
export async function periodPlan(from: Date, to: Date): Promise<{ rows: PeriodPlanRow[]; workDays: number; elapsed: number; avgPct: number | null }> {
  const wd = periodWorkDays(from, to);
  const months = [...wd.keys()].map((ym) => ({ year: Number(ym.slice(0, 4)), month: Number(ym.slice(5)) }));
  const [plans, outputs, defects] = await Promise.all([
    months.length ? db.productionPlan.findMany({ where: { OR: months }, include: { product: { select: { id: true, code: true, name: true, unit: true } } } }) : Promise.resolve([]),
    db.stockMove.groupBy({ by: ["productId"], where: { type: "PRODUCTION_OUTPUT", productId: { not: null }, date: { gte: from, lt: to } }, _sum: { qty: true } }),
    db.productDefect.groupBy({ by: ["productId"], where: { date: { gte: from, lt: to } }, _sum: { qty: true } }),
  ]);
  const rows = new Map<string, PeriodPlanRow>();
  for (const p of plans) {
    const ym = `${p.year}-${String(p.month).padStart(2, "0")}`;
    const days = wd.get(ym);
    if (!days) continue;
    const perDay = p.dayQty !== null ? Number(p.dayQty) : Number(p.monthQty) / Math.max(1, workDays(ym).length);
    const cur = rows.get(p.productId) ?? { product: p.product, plan: 0, expected: 0, fact: 0, defect: 0, pct: null, behind: 0 };
    cur.plan += perDay * days.all.length; cur.expected += perDay * days.elapsed.length;
    rows.set(p.productId, cur);
  }
  for (const r of rows.values()) {
    r.fact = Number(outputs.find((o) => o.productId === r.product.id)?._sum.qty ?? 0);
    r.defect = Number(defects.find((o) => o.productId === r.product.id)?._sum.qty ?? 0);
    r.pct = r.plan > 0 ? (r.fact / r.plan) * 100 : null;
    r.behind = Math.max(0, r.expected - r.fact);
  }
  const list = [...rows.values()].sort((a, b) => a.product.code.localeCompare(b.product.code));
  const withPct = list.filter((r) => r.pct != null);
  return {
    rows: list,
    workDays: [...wd.values()].reduce((s, d) => s + d.all.length, 0),
    elapsed: [...wd.values()].reduce((s, d) => s + d.elapsed.length, 0),
    avgPct: withPct.length ? withPct.reduce((s, r) => s + r.pct!, 0) / withPct.length : null,
  };
}

export type PeriodAttendance = {
  byStatus: Record<AttendanceStatus, number>;
  marked: number; // DAYOFF siz
  pct: number | null; // keldi / belgilangan
  avgPresent: number; // kuniga o'rtacha kelgan
  days: number; // davomat yozilgan kunlar
  perEmployee: Map<string, Record<AttendanceStatus, number>>;
};

/** Berilgan xodimlarning [from, to) dagi davomati — status bo'yicha va xodim bo'yicha. */
export async function periodAttendance(employeeIds: string[], from: Date, to: Date): Promise<PeriodAttendance> {
  const rows = employeeIds.length
    ? await db.attendance.findMany({ where: { employeeId: { in: employeeIds }, date: { gte: dayUtc(iso(from)), lt: dayUtc(iso(to)) } }, select: { employeeId: true, date: true, status: true } })
    : [];
  const zero = (): Record<AttendanceStatus, number> => ({ PRESENT: 0, ABSENT: 0, SICK: 0, LEAVE: 0, DAYOFF: 0 });
  const byStatus = zero();
  const perEmployee = new Map<string, Record<AttendanceStatus, number>>();
  const presentDays = new Map<string, number>();
  for (const a of rows) {
    byStatus[a.status]++;
    const e = perEmployee.get(a.employeeId) ?? zero(); e[a.status]++; perEmployee.set(a.employeeId, e);
    const k = a.date.toISOString().slice(0, 10);
    presentDays.set(k, (presentDays.get(k) ?? 0) + (a.status === "PRESENT" ? 1 : 0));
  }
  const marked = byStatus.PRESENT + byStatus.ABSENT + byStatus.SICK + byStatus.LEAVE;
  const days = presentDays.size;
  return {
    byStatus, marked, pct: marked ? (byStatus.PRESENT / marked) * 100 : null,
    avgPresent: days ? byStatus.PRESENT / days : 0, days, perEmployee,
  };
}
