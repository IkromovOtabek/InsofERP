import { db } from "@/lib/db";
import { isoDate } from "@/lib/format";
import { dayUtc, isoDay, monthOf, today } from "@/lib/davomat";
import { staffDay } from "@/lib/attendance-report";
import { dayTimes, shiftOf } from "@/lib/attendance-time";
import { plansInRange } from "@/lib/hr/shifts";
import { calculate, listRuns } from "@/lib/hr/payroll";
import { periodText } from "@/lib/hr/requests";
import { CALL_STATUSES, REQUEST_KIND } from "@/lib/hr/labels";
import { departmentOf, deptByLabel, deptByRole, guessDepartment } from "@/lib/orgchart";
import type { HrRequestKind } from "@/generated/prisma";

/**
 * Otdel kadr — umumiy ko'rinish (`/otdel-kadr/umumiy`): bo'limning muhim raqamlari bitta joyda.
 * Manbalar mavjud qoidalar bilan bir xil: bugungi davomat — `staffDay`, davr kechikishi — `dayTimes` + smena grafigi
 * (`plansInRange`), jarima/bonus — `calculate` (Jarima va bonuslar tabidagidek), ish haqi — `listRuns`, bo'lim — `orgchart`.
 * Boshqa xodimlar davomati va ta'til/kasalligi faqat `attendance: true` (`canSeeStaffAttendance`) bo'lsa o'qiladi.
 */

export type HrOverviewOpts = {
  /** Davr boshi va oxiri — mahalliy yarim tun, `to` kirmaydi (`parseDayRange`). */
  from: Date; to: Date;
  attendance: boolean; payroll: boolean;
};

const DAY = 86_400_000;
const NO_DEPT = "Bo'limsiz";
const LEAVE_KINDS: HrRequestKind[] = ["VACATION", "UNPAID", "SICK"];

/** `@db.Date` (UTC yarim tun) → mahalliy kun. */
const localDay = (d: Date) => new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
const daysLeft = (d: Date, from: Date) => Math.floor((d.getTime() - from.getTime()) / DAY);
/** Tug'ilgan kungacha necha kun (bugun — 0), yil hisobga olinmaydi. */
function daysToBirthday(birth: Date, from: Date) {
  const next = new Date(from.getFullYear(), birth.getMonth(), birth.getDate());
  if (next < from) next.setFullYear(from.getFullYear() + 1);
  return Math.round((next.getTime() - from.getTime()) / DAY);
}

export type HrEvent = {
  key: string; kind: "BIRTHDAY" | "CONTRACT" | "LICENSE" | "LEAVE";
  employeeId: string; fullName: string; position: string;
  date: Date; days: number; detail: string | null;
};

/** Davrdagi davomat intizomi: kechikish (smena grafigi bo'yicha) va belgilar soni, xodimlar kesimida. */
async function periodDiscipline(range: { gte: Date; lte: Date }, fromIso: string, lastIso: string) {
  const rows = await db.attendance.findMany({
    where: { date: range, employee: { external: false } },
    select: { employeeId: true, date: true, status: true, checkIn: true, checkOut: true, lateMinutes: true },
  });
  const ids = [...new Set(rows.map((r) => r.employeeId))];
  const emps = ids.length ? await db.employee.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true, position: true, workSchedule: true } }) : [];
  const presentIds = new Set(rows.filter((r) => r.status === "PRESENT").map((r) => r.employeeId));
  const plans = await plansInRange(emps.filter((e) => presentIds.has(e.id)), fromIso, lastIso);
  const empBy = new Map(emps.map((e) => [e.id, e]));

  const totals = { present: 0, absent: 0, sick: 0, leave: 0, dayoff: 0, lateDays: 0, lateMinutes: 0 };
  const per = new Map<string, { id: string; fullName: string; position: string; lateDays: number; lateMinutes: number; absent: number }>();
  for (const r of rows) {
    const e = empBy.get(r.employeeId);
    if (!e) continue;
    const p = per.get(e.id) ?? { id: e.id, fullName: e.fullName, position: e.position, lateDays: 0, lateMinutes: 0, absent: 0 };
    if (r.status === "PRESENT") {
      totals.present++;
      const late = dayTimes(r, plans.get(e.id)?.get(isoDay(r.date)) ?? shiftOf(e.workSchedule)).lateMin;
      if (late) { totals.lateDays++; totals.lateMinutes += late; p.lateDays++; p.lateMinutes += late; }
    } else if (r.status === "ABSENT") { totals.absent++; p.absent++; }
    else if (r.status === "SICK") totals.sick++;
    else if (r.status === "LEAVE") totals.leave++;
    else totals.dayoff++;
    per.set(e.id, p);
  }
  const offenders = [...per.values()].filter((p) => p.lateDays || p.absent)
    .sort((a, b) => b.absent + b.lateDays - (a.absent + a.lateDays) || b.lateMinutes - a.lateMinutes);
  return { totals, offenders: offenders.slice(0, 10), offenderCount: offenders.length };
}

export async function hrOverview({ from, to, attendance, payroll }: HrOverviewOpts) {
  const fromIso = isoDate(from);
  const lastIso = isoDate(new Date(to.getFullYear(), to.getMonth(), to.getDate() - 1));
  const range = { gte: dayUtc(fromIso), lte: dayUtc(lastIso) };
  const month = monthOf(lastIso); // jarima/bonus va ish haqi — oylik hisob, davr oxiridagi oy
  const todayIso = today();
  const now = new Date(); now.setHours(0, 0, 0, 0);
  const in30 = new Date(now.getTime() + 30 * DAY);

  const [active, workPos, moved, day, discipline, calc, runs, callStats, callPositions, visitsToday, birthdays, licenses, contracts, leaves] = await Promise.all([
    db.employee.findMany({ where: { isActive: true, external: false }, select: { id: true, position: true } }),
    db.workPosition.findMany({ select: { name: true, department: true, loginRole: true } }),
    db.employee.findMany({
      where: { external: false, OR: [{ hiredAt: { gte: from, lt: to } }, { firedAt: { gte: from, lt: to } }] },
      select: { id: true, fullName: true, position: true, hiredAt: true, firedAt: true, firedReason: true },
    }),
    attendance ? staffDay(todayIso) : null,
    attendance ? periodDiscipline(range, fromIso, lastIso) : null,
    calculate(month, "FINAL"),
    payroll ? listRuns({ month, take: 20 }) : Promise.resolve([] as Awaited<ReturnType<typeof listRuns>>),
    db.hrCallLog.groupBy({ by: ["status"], where: { date: range }, _count: { _all: true } }),
    db.hrCallLog.groupBy({ by: ["position"], where: { date: range }, _count: { _all: true } }),
    db.hrCallLog.count({ where: { status: "WAITING", visitDate: dayUtc(todayIso) } }),
    db.employee.findMany({ where: { isActive: true, external: false, birthDate: { not: null } }, select: { id: true, fullName: true, position: true, birthDate: true } }),
    db.employee.findMany({ where: { isActive: true, external: false, licenseExpiry: { lt: in30 } }, select: { id: true, fullName: true, position: true, licenseNo: true, licenseExpiry: true } }),
    // Har xodimning eng oxirgi mehnat shartnomasi hal qiladi (muddatsizga almashtirilgan bo'lsa — ogohlantirilmaydi)
    db.hrDocument.findMany({
      where: { kind: "SHARTNOMA", employee: { isActive: true } },
      orderBy: [{ docDate: "desc" }, { createdAt: "desc" }],
      select: { id: true, no: true, fixedTerm: true, termUntil: true, employee: { select: { id: true, fullName: true, position: true } } },
    }),
    attendance
      ? db.hrRequest.findMany({
        where: { status: "APPROVED", kind: { in: LEAVE_KINDS }, dateTo: { gte: dayUtc(todayIso) }, dateFrom: { lte: dayUtc(isoDate(in30)) } },
        orderBy: { dateFrom: "asc" },
        select: { id: true, kind: true, dateFrom: true, dateTo: true, employee: { select: { id: true, fullName: true, position: true } } },
      })
      : Promise.resolve([]),
  ]);

  // ── Bo'limlar: lavozim nomi bo'lim bo'lsa — o'sha, aks holda ishchi lavozimning bo'limi (otdel kadr belgilagan / taxmin) ──
  const wpBy = new Map(workPos.map((w) => [w.name.trim().toLowerCase(), w]));
  const deptOf = (position: string) => {
    const own = deptByLabel(position);
    if (own) return own.label;
    const wp = wpBy.get(position.trim().toLowerCase());
    const role = wp ? departmentOf(wp) : guessDepartment(position);
    return (role && deptByRole(role)?.label) || NO_DEPT;
  };
  const todayBy = new Map((day?.rows ?? []).map((r) => [r.id, r]));
  const deptMap = new Map<string, { name: string; count: number; present: number; late: number; absent: number }>();
  for (const e of active) {
    const name = deptOf(e.position);
    const d = deptMap.get(name) ?? { name, count: 0, present: 0, late: 0, absent: 0 };
    const t = todayBy.get(e.id);
    d.count++;
    if (t?.status === "PRESENT") d.present++;
    if (t?.lateMin) d.late++;
    if (t?.status === "ABSENT") d.absent++;
    deptMap.set(name, d);
  }
  const departments = [...deptMap.values()].sort((a, b) => Number(a.name === NO_DEPT) - Number(b.name === NO_DEPT) || b.count - a.count || a.name.localeCompare(b.name));

  // ── Kadr harakati (davr) ──
  const inRange = (d: Date | null): d is Date => !!d && d >= from && d < to;
  const movement = moved.flatMap((e) => [
    ...(inRange(e.hiredAt) ? [{ key: `${e.id}-q`, hire: true, id: e.id, fullName: e.fullName, position: e.position, date: e.hiredAt, reason: null as string | null }] : []),
    ...(inRange(e.firedAt) ? [{ key: `${e.id}-b`, hire: false, id: e.id, fullName: e.fullName, position: e.position, date: e.firedAt, reason: e.firedReason }] : []),
  ]).sort((a, b) => b.date.getTime() - a.date.getTime());

  // ── Jarima va bonus (oy) — Jarima va bonuslar tabi va vedomost bilan bir xil hisob ──
  const hits = calc.filter((l) => l.bonus || l.penalty).sort((a, b) => b.penalty + b.bonus - (a.penalty + a.bonus));
  const fines = {
    bonus: calc.reduce((x, l) => x + l.bonus, 0), penalty: calc.reduce((x, l) => x + l.penalty, 0),
    bonusPeople: calc.filter((l) => l.bonus > 0).length, penaltyPeople: calc.filter((l) => l.penalty > 0).length,
    top: hits.slice(0, 8).map((l) => ({ id: l.employeeId, fullName: l.fullName, position: l.position, bonus: l.bonus, penalty: l.penalty })),
  };

  // ── Ish haqi (oy) ──
  const live = runs.filter((r) => r.status !== "CANCELLED").map((r) => ({
    id: r.id, docNo: r.docNo, kind: r.kind, status: r.status, lines: r._count.lines,
    gross: Number(r.gross), net: Number(r.net), paid: Number(r.paid),
  }));
  const pay = {
    runs: live,
    final: live.find((r) => r.kind === "FINAL") ?? null,
    waiting: live.filter((r) => r.status === "SUBMITTED").length,
    toPay: live.filter((r) => r.status === "APPROVED").reduce((x, r) => x + r.net - r.paid, 0),
    paid: live.reduce((x, r) => x + r.paid, 0),
  };

  // ── Qo'ng'iroqlar jurnali (davr) ──
  const callBy = new Map(callStats.map((x) => [x.status, x._count._all]));
  const calls = {
    total: callStats.reduce((n, x) => n + x._count._all, 0),
    byStatus: CALL_STATUSES.map((status) => ({ status, count: callBy.get(status) ?? 0 })),
    hired: callBy.get("HIRED") ?? 0,
    visitsToday,
    positions: callPositions.map((p) => ({ position: p.position, count: p._count._all })).sort((a, b) => b.count - a.count).slice(0, 5),
  };

  // ── Kadr taqvimi (yaqin 30 kun): tug'ilgan kun, shartnoma va guvohnoma muddati, ta'til/kasallik ──
  const events: HrEvent[] = [];
  for (const e of birthdays) {
    const days = daysToBirthday(e.birthDate!, now);
    if (days <= 30) events.push({ key: `t-${e.id}`, kind: "BIRTHDAY", employeeId: e.id, fullName: e.fullName, position: e.position, date: new Date(now.getTime() + days * DAY), days, detail: null });
  }
  for (const e of licenses) {
    events.push({ key: `g-${e.id}`, kind: "LICENSE", employeeId: e.id, fullName: e.fullName, position: e.position, date: e.licenseExpiry!, days: daysLeft(e.licenseExpiry!, now), detail: e.licenseNo });
  }
  const seen = new Set<string>();
  for (const c of contracts) {
    if (seen.has(c.employee.id)) continue;
    seen.add(c.employee.id);
    if (!c.fixedTerm || !c.termUntil) continue;
    const until = localDay(c.termUntil);
    if (until < in30) events.push({ key: `s-${c.id}`, kind: "CONTRACT", employeeId: c.employee.id, fullName: c.employee.fullName, position: c.employee.position, date: until, days: daysLeft(until, now), detail: c.no ? `№ ${c.no}` : null });
  }
  for (const r of leaves) {
    if (!r.dateFrom || !r.dateTo) continue;
    const start = localDay(r.dateFrom);
    events.push({ key: `a-${r.id}`, kind: "LEAVE", employeeId: r.employee.id, fullName: r.employee.fullName, position: r.employee.position, date: start, days: daysLeft(start, now), detail: `${REQUEST_KIND[r.kind].label}: ${periodText(isoDay(r.dateFrom), isoDay(r.dateTo))}` });
  }
  events.sort((a, b) => a.days - b.days || a.fullName.localeCompare(b.fullName));

  return {
    month, fromIso, lastIso,
    headcount: { active: active.length, positions: new Set(active.map((e) => e.position)).size, departments },
    movement: { hires: movement.filter((m) => m.hire).length, fires: movement.filter((m) => !m.hire).length, list: movement },
    today: day ? { totals: day.totals, rows: day.rows.filter((r) => r.status === "ABSENT" || r.lateMin).sort((a, b) => Number(b.status === "ABSENT") - Number(a.status === "ABSENT") || (b.lateMin ?? 0) - (a.lateMin ?? 0)) } : null,
    discipline,
    fines, pay, calls, events,
  };
}

export type HrOverview = Awaited<ReturnType<typeof hrOverview>>;
