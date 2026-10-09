import { db } from "@/lib/db";
import { ROLE_LABELS } from "@/lib/nav";
import {
  dayTitle, dayUtc, isoDay, markOf, monthDays, monthTitle, shiftDay, shiftMonth, today, validDay, validMonth,
} from "@/lib/davomat";
import { dayTimes, shiftOf, sourceLabel, type Shift } from "@/lib/attendance-time";
import type { AttendanceStatus, Prisma, Role } from "@/generated/prisma";

/**
 * Davomat jadvali — ish haqi asosi: har xodimning kelgan / ketgan vaqti, ishlagan soati, kechikishi.
 * Mobil "Davomat" ekrani (HR, direktor, ishlab chiqarish), xodimning oylik varag'i va veb Excel eksporti
 * shu bitta joydan o'qiydi. Barcha bo'limlar (faqat sex emas).
 *
 * Hisob:
 *   · soat = ketdi − keldi (ketdi kelishdan oldin bo'lsa — tungi smena, +24 soat); ketdi yo'q — soat yo'q;
 *   · kechikish = keldi − smena boshi (xodim kartasidagi "Ish grafigi", bo'lmasa 08:00); bazada saqlangan bo'lsa o'sha;
 *   · erta ketish = smena oxiri − ketdi.
 */

export type AttStatusKey = AttendanceStatus | "NONE";

export type StaffDayRow = {
  id: string; fullName: string; position: string; dept: string | null;
  status: AttStatusKey; statusLabel: string;
  checkIn: string | null; checkOut: string | null;
  minutes: number | null; lateMin: number | null; earlyMin: number | null;
  source: string | null; note: string | null; shift: Shift;
};

export type StaffDay = {
  date: string; title: string; isToday: boolean; prev: string; next: string | null;
  totals: { total: number; present: number; absent: number; late: number; notMarked: number; sick: number; leave: number; dayoff: number; inside: number; minutes: number; lateMinutes: number };
  rows: StaffDayRow[];
};

/** Tabelda xodim ishga kirgan kundan bo'shagan kunigacha turadi (veb tabel bilan bir xil oyna). */
export const employeesInWindow = (from: Date, to: Date): Prisma.EmployeeWhereInput => ({
  AND: [
    { OR: [{ hiredAt: null }, { hiredAt: { lte: to } }] },
    { OR: [{ firedAt: null }, { firedAt: { gte: from } }] },
    { OR: [{ isActive: true }, { firedAt: { not: null } }] },
  ],
});

async function deptByPosition() {
  const wp = await db.workPosition.findMany({ select: { name: true, department: true } });
  return new Map(wp.map((w) => [w.name.trim().toLowerCase(), w.department ? ROLE_LABELS[w.department as Role] ?? null : null]));
}

async function markerRoles(ids: (string | null)[]) {
  const list = [...new Set(ids.filter((x): x is string => !!x))];
  if (!list.length) return new Map<string, Role>();
  const users = await db.user.findMany({ where: { id: { in: list } }, select: { id: true, role: true } });
  return new Map(users.map((u) => [u.id, u.role]));
}

const ATT_SELECT = {
  employeeId: true, date: true, status: true, checkIn: true, checkOut: true, lateMinutes: true, source: true,
  facePhoto: true, markedById: true, note: true,
} as const;
type AttRow = Prisma.AttendanceGetPayload<{ select: typeof ATT_SELECT }>;

function srcOf(a: AttRow | undefined, roles: Map<string, Role>) {
  if (!a) return null;
  return sourceLabel(a.source, { face: !!a.facePhoto, markerRole: a.markedById ? roles.get(a.markedById) ?? null : null });
}

/** Bir kun — barcha xodimlar jadvali (`employeeIds` berilsa — faqat shu xodimlar, masalan sex boshlig'iga sex tarkibi). */
export async function staffDay(rawDate?: string | null, opts: { employeeIds?: string[] } = {}): Promise<StaffDay> {
  const now = today();
  const iso = validDay(rawDate ?? undefined) && rawDate! <= now ? rawDate! : now;
  const day = dayUtc(iso);
  const only = opts.employeeIds ? { id: { in: opts.employeeIds } } : {};
  const [emps, marks, depts] = await Promise.all([
    db.employee.findMany({ where: { ...employeesInWindow(day, day), ...only }, orderBy: { fullName: "asc" }, select: { id: true, fullName: true, position: true, workSchedule: true } }),
    db.attendance.findMany({ where: { date: day, ...(opts.employeeIds ? { employeeId: { in: opts.employeeIds } } : {}) }, select: ATT_SELECT }),
    deptByPosition(),
  ]);
  const roles = await markerRoles(marks.map((m) => m.markedById));
  const by = new Map(marks.map((m) => [m.employeeId, m]));
  const rows: StaffDayRow[] = emps.map((e) => {
    const a = by.get(e.id);
    const shift = shiftOf(e.workSchedule);
    const t = dayTimes(a, shift);
    return {
      id: e.id, fullName: e.fullName, position: e.position, dept: depts.get(e.position.trim().toLowerCase()) ?? null,
      status: a?.status ?? "NONE", statusLabel: a ? markOf(a.status).label : "Belgilanmagan",
      checkIn: a?.status === "PRESENT" ? a.checkIn : null, checkOut: a?.status === "PRESENT" ? a.checkOut : null,
      ...t, source: srcOf(a, roles), note: a?.note ?? null, shift,
    };
  });
  const cnt = (s: AttStatusKey) => rows.filter((r) => r.status === s).length;
  return {
    date: iso, title: dayTitle(iso), isToday: iso === now, prev: shiftDay(iso, -1), next: iso < now ? shiftDay(iso, 1) : null,
    totals: {
      total: rows.length, present: cnt("PRESENT"), absent: cnt("ABSENT"), notMarked: cnt("NONE"),
      sick: cnt("SICK"), leave: cnt("LEAVE"), dayoff: cnt("DAYOFF"),
      late: rows.filter((r) => r.lateMin).length,
      inside: rows.filter((r) => r.status === "PRESENT" && r.checkIn && !r.checkOut).length,
      minutes: rows.reduce((s, r) => s + (r.minutes ?? 0), 0),
      lateMinutes: rows.reduce((s, r) => s + (r.lateMin ?? 0), 0),
    },
    rows,
  };
}

// ───────────────────────── Xodim — oy ─────────────────────────

const WD = ["Yak", "Dush", "Sesh", "Chor", "Pay", "Jum", "Shan"];

export type EmployeeMonthDay = {
  date: string; day: number; weekday: string; weekend: boolean;
  status: AttStatusKey; statusLabel: string | null;
  checkIn: string | null; checkOut: string | null; minutes: number | null; lateMin: number | null; earlyMin: number | null;
  source: string | null; note: string | null;
};
export type MonthTotals = {
  present: number; absent: number; sick: number; leave: number; dayoff: number; notMarked: number;
  minutes: number; lateDays: number; lateMinutes: number; earlyDays: number; earlyMinutes: number; openDays: number;
};
export type EmployeeMonth = {
  month: string; title: string; prev: string; next: string | null;
  employee: { id: string; fullName: string; position: string; dept: string | null; phone: string | null };
  shift: Shift; totals: MonthTotals; days: EmployeeMonthDay[];
};

export const normMonth = (raw?: string | null) => {
  const cur = today().slice(0, 7);
  return validMonth(raw ?? undefined) && raw! <= cur ? raw! : cur;
};

export function monthTotals(days: { status: AttStatusKey; minutes: number | null; lateMin: number | null; earlyMin: number | null; checkIn: string | null; checkOut: string | null; weekend?: boolean }[]): MonthTotals {
  const cnt = (s: AttStatusKey) => days.filter((d) => d.status === s).length;
  return {
    present: cnt("PRESENT"), absent: cnt("ABSENT"), sick: cnt("SICK"), leave: cnt("LEAVE"), dayoff: cnt("DAYOFF"),
    notMarked: days.filter((d) => d.status === "NONE" && !d.weekend).length,
    minutes: days.reduce((s, d) => s + (d.minutes ?? 0), 0),
    lateDays: days.filter((d) => d.lateMin).length, lateMinutes: days.reduce((s, d) => s + (d.lateMin ?? 0), 0),
    earlyDays: days.filter((d) => d.earlyMin).length, earlyMinutes: days.reduce((s, d) => s + (d.earlyMin ?? 0), 0),
    openDays: days.filter((d) => d.status === "PRESENT" && d.checkIn && !d.checkOut).length,
  };
}

/** Bitta xodimning oylik varag'i — kunlar (yangisi tepada) va jami. */
export async function employeeMonth(employeeId: string, rawMonth?: string | null): Promise<EmployeeMonth | null> {
  const month = normMonth(rawMonth);
  const e = await db.employee.findUnique({ where: { id: employeeId }, select: { id: true, fullName: true, position: true, phone: true, workSchedule: true } });
  if (!e) return null;
  const days = monthDays(month);
  const [rows, depts] = await Promise.all([
    db.attendance.findMany({ where: { employeeId, date: { gte: dayUtc(days[0]!.iso), lte: dayUtc(days[days.length - 1]!.iso) } }, select: ATT_SELECT }),
    deptByPosition(),
  ]);
  const roles = await markerRoles(rows.map((r) => r.markedById));
  const by = new Map(rows.map((r) => [isoDay(r.date), r]));
  const shift = shiftOf(e.workSchedule);
  const now = today();
  const out: EmployeeMonthDay[] = days.filter((d) => d.iso <= now).reverse().map((d) => {
    const a = by.get(d.iso);
    const present = a?.status === "PRESENT";
    return {
      date: d.iso, day: d.day, weekday: WD[dayUtc(d.iso).getUTCDay()]!, weekend: d.weekend,
      status: a?.status ?? "NONE", statusLabel: a ? markOf(a.status).label : null,
      checkIn: present ? a!.checkIn : null, checkOut: present ? a!.checkOut : null,
      ...dayTimes(a, shift), source: srcOf(a, roles), note: a?.note ?? null,
    };
  });
  return {
    month, title: monthTitle(month), prev: shiftMonth(month, -1), next: month < now.slice(0, 7) ? shiftMonth(month, 1) : null,
    employee: { id: e.id, fullName: e.fullName, position: e.position, dept: depts.get(e.position.trim().toLowerCase()) ?? null, phone: e.phone },
    shift, totals: monthTotals(out), days: out,
  };
}

// ───────────────────────── Oy — barcha xodimlar (Excel) ─────────────────────────

export type StaffMonthRow = { id: string; fullName: string; position: string; shift: Shift; totals: MonthTotals; days: Map<string, EmployeeMonthDay> };

/** Oy bo'yicha barcha xodimlar (tabel eksporti uchun). */
export async function staffMonth(rawMonth?: string | null): Promise<{ month: string; title: string; days: ReturnType<typeof monthDays>; rows: StaffMonthRow[] }> {
  const month = normMonth(rawMonth);
  const days = monthDays(month);
  const from = dayUtc(days[0]!.iso), to = dayUtc(days[days.length - 1]!.iso);
  const [emps, marks] = await Promise.all([
    db.employee.findMany({ where: employeesInWindow(from, to), orderBy: [{ position: "asc" }, { fullName: "asc" }], select: { id: true, fullName: true, position: true, workSchedule: true } }),
    db.attendance.findMany({ where: { date: { gte: from, lte: to } }, select: ATT_SELECT }),
  ]);
  const roles = await markerRoles(marks.map((m) => m.markedById));
  const byEmp = new Map<string, AttRow[]>();
  for (const m of marks) byEmp.set(m.employeeId, [...(byEmp.get(m.employeeId) ?? []), m]);
  const now = today();
  const rows = emps.map((e) => {
    const shift = shiftOf(e.workSchedule);
    const mine = new Map((byEmp.get(e.id) ?? []).map((a) => [isoDay(a.date), a]));
    const list: EmployeeMonthDay[] = days.filter((d) => d.iso <= now).map((d) => {
      const a = mine.get(d.iso);
      const present = a?.status === "PRESENT";
      return {
        date: d.iso, day: d.day, weekday: WD[dayUtc(d.iso).getUTCDay()]!, weekend: d.weekend,
        status: a?.status ?? "NONE", statusLabel: a ? markOf(a.status).label : null,
        checkIn: present ? a!.checkIn : null, checkOut: present ? a!.checkOut : null,
        ...dayTimes(a, shift), source: srcOf(a, roles), note: a?.note ?? null,
      };
    });
    return { id: e.id, fullName: e.fullName, position: e.position, shift, totals: monthTotals(list), days: new Map(list.map((d) => [d.date, d])) };
  });
  return { month, title: monthTitle(month), days, rows };
}
