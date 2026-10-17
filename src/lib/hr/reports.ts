import * as XLSX from "xlsx";
import { db } from "@/lib/db";
import { dayUtc, monthDays, monthOf, monthTitle, shiftMonth, today } from "@/lib/davomat";

/**
 * Kadr hisobotlari — qaror uchun raqamlar: xodimlar soni va aylanma (12 oy), staj, davomat va kechikish (oy),
 * ish haqi fondi (12 oy, yakuniy vedomostlar), yollash voronkasi, o'qitish, arizalar va murojaatlar.
 * Veb (Otdel kadr → Hisobotlar), Excel va AI vositalari shu yerdan o'qiydi.
 */

export type MonthRow = { month: string; title: string; headcount: number; hires: number; fires: number; turnover: number; payroll: number; employerTax: number };

const r1 = (n: number) => Math.round(n * 10) / 10;

export async function hrReport(month = monthOf(today())) {
  const months = Array.from({ length: 12 }, (_, i) => shiftMonth(month, i - 11));
  const from = dayUtc(`${months[0]}-01`);
  const [emps, runs, vacancies, candidates, enroll, requests, feedback, att] = await Promise.all([
    db.employee.findMany({ select: { id: true, position: true, hiredAt: true, firedAt: true, isActive: true, createdAt: true, firedReason: true } }),
    db.payrollRun.findMany({ where: { kind: "FINAL", status: { not: "CANCELLED" }, month: { in: months } }, select: { month: true, gross: true, employerTax: true } }),
    db.vacancy.findMany({ where: { status: "OPEN" }, select: { headcount: true, _count: { select: { candidates: { where: { stage: "HIRED" } } } } } }),
    db.candidate.findMany({ where: { createdAt: { gte: from } }, select: { stage: true, createdAt: true, stageAt: true } }),
    db.courseEnrollment.groupBy({ by: ["status"], _count: { _all: true } }),
    db.hrRequest.count({ where: { status: "PENDING" } }),
    db.feedback.groupBy({ by: ["status"], _count: { _all: true } }),
    (() => { const d = monthDays(month); return db.attendance.groupBy({ by: ["status"], where: { date: { gte: dayUtc(d[0]!.iso), lte: dayUtc(d[d.length - 1]!.iso) } }, _count: { _all: true }, _sum: { lateMinutes: true } }); })(),
  ]);
  const hired = (e: (typeof emps)[number]) => e.hiredAt ?? e.createdAt;
  const series: MonthRow[] = months.map((m) => {
    const d = monthDays(m); const start = dayUtc(d[0]!.iso), end = dayUtc(d[d.length - 1]!.iso);
    const inJob = (e: (typeof emps)[number], at: Date) => hired(e) <= at && (!e.firedAt || e.firedAt > at) && (e.isActive || !!e.firedAt);
    const hc = emps.filter((e) => inJob(e, end)).length;
    const hcStart = emps.filter((e) => inJob(e, start)).length;
    const hires = emps.filter((e) => e.hiredAt && e.hiredAt >= start && e.hiredAt <= end).length;
    const fires = emps.filter((e) => e.firedAt && e.firedAt >= start && e.firedAt <= end).length;
    const avg = (hc + hcStart) / 2;
    const pr = runs.filter((r) => r.month === m);
    return { month: m, title: monthTitle(m), headcount: hc, hires, fires, turnover: avg ? r1((fires / avg) * 100) : 0, payroll: pr.reduce((s, r) => s + Number(r.gross), 0), employerTax: pr.reduce((s, r) => s + Number(r.employerTax), 0) };
  });
  const active = emps.filter((e) => e.isActive);
  const now = Date.now();
  const tenure = active.filter((e) => e.hiredAt).map((e) => (now - e.hiredAt!.getTime()) / (365.25 * 864e5));
  const byPos = [...active.reduce((m, e) => m.set(e.position, (m.get(e.position) ?? 0) + 1), new Map<string, number>()).entries()].sort((a, b) => b[1] - a[1]);
  const fireReasons = [...emps.filter((e) => e.firedAt && e.firedAt >= from).reduce((m, e) => m.set(e.firedReason ?? "Ko'rsatilmagan", (m.get(e.firedReason ?? "Ko'rsatilmagan") ?? 0) + 1), new Map<string, number>()).entries()].sort((a, b) => b[1] - a[1]);
  const attBy = (s: string) => att.find((a) => a.status === s)?._count._all ?? 0;
  const present = attBy("PRESENT"), absent = attBy("ABSENT");
  const lateMin = att.find((a) => a.status === "PRESENT")?._sum.lateMinutes ?? 0;
  const hiredCands = candidates.filter((c) => c.stage === "HIRED");
  const enr = (s: string) => enroll.find((x) => x.status === s)?._count._all ?? 0;
  const yearHires = series.reduce((s, x) => s + x.hires, 0), yearFires = series.reduce((s, x) => s + x.fires, 0);
  const avgHc = series.reduce((s, x) => s + x.headcount, 0) / series.length;
  return {
    month, title: monthTitle(month), series,
    headcount: active.length, byPosition: byPos,
    avgTenure: tenure.length ? r1(tenure.reduce((a, b) => a + b, 0) / tenure.length) : null,
    yearHires, yearFires, yearTurnover: avgHc ? r1((yearFires / avgHc) * 100) : 0, fireReasons,
    attendance: { present, absent, sick: attBy("SICK"), leave: attBy("LEAVE"), rate: present + absent ? r1((present / (present + absent)) * 100) : null, lateMinutes: Number(lateMin) },
    recruiting: {
      openVacancies: vacancies.length, openSeats: vacancies.reduce((s, v) => s + Math.max(0, v.headcount - v._count.candidates), 0),
      candidates: candidates.length, hired: hiredCands.length, rejected: candidates.filter((c) => c.stage === "REJECTED").length,
      daysToHire: hiredCands.length ? Math.round(hiredCands.reduce((s, c) => s + (c.stageAt.getTime() - c.createdAt.getTime()) / 864e5, 0) / hiredCands.length) : null,
    },
    training: { assigned: enr("ASSIGNED"), passed: enr("PASSED"), failed: enr("FAILED") },
    pendingRequests: requests,
    openFeedback: feedback.filter((f) => f.status !== "RESOLVED").reduce((s, f) => s + f._count._all, 0),
  };
}
export type HrReport = Awaited<ReturnType<typeof hrReport>>;

export async function hrReportXlsx(month?: string | null): Promise<{ file: Buffer; name: string }> {
  const r = await hrReport(month && /^\d{4}-\d{2}$/.test(month) ? month : undefined);
  const wb = XLSX.utils.book_new();
  const t = XLSX.utils.aoa_to_sheet([
    [`Kadr hisoboti — ${r.title}`], [],
    ["Oy", "Xodimlar (oy oxiri)", "Qabul", "Bo'shatish", "Aylanma, %", "Ish haqi fondi (hisoblangan)", "Ijtimoiy soliq"],
    ...r.series.map((x) => [x.title, x.headcount, x.hires, x.fires, x.turnover, x.payroll, x.employerTax]),
    [], ["Yil bo'yicha", "", r.yearHires, r.yearFires, r.yearTurnover],
  ]);
  t["!cols"] = [{ wch: 16 }, { wch: 18 }, { wch: 9 }, { wch: 11 }, { wch: 11 }, { wch: 24 }, { wch: 16 }];
  XLSX.utils.book_append_sheet(wb, t, "12 oy");
  const p = XLSX.utils.aoa_to_sheet([["Lavozim", "Xodim"], ...r.byPosition]);
  p["!cols"] = [{ wch: 30 }, { wch: 8 }];
  XLSX.utils.book_append_sheet(wb, p, "Lavozimlar");
  const f = XLSX.utils.aoa_to_sheet([["Bo'shatish sababi (12 oy)", "Soni"], ...r.fireReasons]);
  f["!cols"] = [{ wch: 40 }, { wch: 8 }];
  XLSX.utils.book_append_sheet(wb, f, "Sabablar");
  return { file: XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer, name: `kadr-hisobot-${r.month}.xlsx` };
}
