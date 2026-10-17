import { db } from "@/lib/db";
import { staffDay } from "@/lib/attendance-report";
import { hrReport } from "@/lib/hr/reports";
import { monthOf, today } from "@/lib/davomat";
import { lateText } from "@/lib/attendance-time";
import { moneyShort } from "@/lib/format";
import { PAYROLL_KIND_LABEL, PAYROLL_STATUS_LABEL, REQUEST_KIND } from "@/lib/hr/labels";
import type { Tool } from "./tools";

/**
 * Rahbar boti va AI (veb chat, Telegram) uchun kadr vositalari: davomat, kadr ko'rinishi, ish haqi, kutilayotgan ishlar.
 * Natija — model o'qiydigan qisqa matn (raqamlar `lib/hr/*` va tabel bilan bir xil).
 */

const M = (v: number) => `${moneyShort(v)} so'm`;
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const isoOk = (v: string) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);
const monthOk = (v: string) => (/^\d{4}-\d{2}$/.test(v) ? v : undefined);

const attendanceDay: Tool = {
  name: "hr_attendance_day",
  description: "Kunlik davomat: nechta keldi, kelmadi, kechikdi (kim va necha daqiqa), belgilanmagan, ta'til/kasal. «Bugun kim kelmadi», «kim kechikdi» savollari uchun.",
  parameters: { type: "object", properties: { date: { type: "string", description: "YYYY-MM-DD (bo'sh — bugun)" } } },
  run: async (a) => {
    const d = await staffDay(isoOk(str(a.date)) ?? today());
    const t = d.totals;
    const late = d.rows.filter((r) => r.lateMin).sort((x, y) => (y.lateMin ?? 0) - (x.lateMin ?? 0));
    const absent = d.rows.filter((r) => r.status === "ABSENT");
    const none = d.rows.filter((r) => r.status === "NONE");
    return [
      `${d.title}: jami ${t.total} · keldi ${t.present} · kelmadi ${t.absent} · kechikdi ${t.late} (${lateText(t.lateMinutes || 0)}) · belgilanmagan ${t.notMarked} · kasal ${t.sick} · ta'til ${t.leave}`,
      late.length ? `Kechikkanlar: ${late.slice(0, 25).map((r) => `${r.fullName} (${r.checkIn}, ${lateText(r.lateMin!)})`).join("; ")}` : "Kechikkan yo'q",
      absent.length ? `Kelmaganlar: ${absent.slice(0, 25).map((r) => `${r.fullName} · ${r.position}`).join("; ")}` : "",
      none.length ? `Belgilanmagan: ${none.slice(0, 25).map((r) => r.fullName).join(", ")}${none.length > 25 ? ` va yana ${none.length - 25}` : ""}` : "",
    ].filter(Boolean).join("\n");
  },
};

const hrOverview: Tool = {
  name: "hr_overview",
  description: "Kadr ko'rinishi: xodimlar soni, 12 oylik aylanma (qabul/bo'shatish), staj, oy davomati va kechikish, ish haqi fondi, vakansiyalar, kurslar, kutilayotgan arizalar va murojaatlar.",
  parameters: { type: "object", properties: { month: { type: "string", description: "YYYY-MM (bo'sh — joriy oy)" } } },
  run: async (a) => {
    const r = await hrReport(monthOk(str(a.month)) ?? monthOf(today()));
    const last = r.series.at(-1)!;
    return [
      `${r.title}: ${r.headcount} faol xodim${r.avgTenure != null ? `, o'rtacha staj ${r.avgTenure} yil` : ""}`,
      `12 oy: +${r.yearHires} qabul, −${r.yearFires} bo'shatish, aylanma ${r.yearTurnover}%`,
      `Davomat: ${r.attendance.rate ?? "—"}% · sababsiz ${r.attendance.absent} kun · kechikish ${Math.round(r.attendance.lateMinutes / 60)} soat · kasal ${r.attendance.sick} · ta'til ${r.attendance.leave}`,
      `Ish haqi fondi (oy): ${M(last.payroll)} + ijtimoiy soliq ${M(last.employerTax)}`,
      `Yollash: ${r.recruiting.openVacancies} ochiq vakansiya (${r.recruiting.openSeats} o'rin), nomzodlar ${r.recruiting.candidates}, qabul ${r.recruiting.hired}`,
      `O'qitish: ${r.training.passed} o'tgan, ${r.training.assigned} topshirmagan · kutilayotgan arizalar ${r.pendingRequests} · ochiq murojaatlar ${r.openFeedback}`,
      `Lavozimlar: ${r.byPosition.slice(0, 10).map(([p, n]) => `${p} ${n}`).join(", ")}`,
      r.fireReasons.length ? `Bo'shatish sabablari: ${r.fireReasons.slice(0, 5).map(([p, n]) => `${p} ${n}`).join(", ")}` : "",
    ].filter(Boolean).join("\n");
  },
};

const payroll: Tool = {
  name: "hr_payroll",
  description: "Ish haqi vedomostlari oy bo'yicha: avans / oy yakuni / alohida to'lov, holati (tasdiq, to'lov), hisoblangan, qo'lga, to'langan.",
  parameters: { type: "object", properties: { month: { type: "string", description: "YYYY-MM (bo'sh — joriy oy)" } } },
  run: async (a) => {
    const month = monthOk(str(a.month)) ?? monthOf(today());
    const runs = await db.payrollRun.findMany({ where: { month, status: { not: "CANCELLED" } }, orderBy: { createdAt: "asc" }, include: { _count: { select: { lines: true } } } });
    if (!runs.length) return `${month}: vedomost hali hisoblanmagan.`;
    return runs.map((r) => `${r.docNo} · ${PAYROLL_KIND_LABEL[r.kind]} · ${PAYROLL_STATUS_LABEL[r.status]} · ${r._count.lines} xodim · hisoblangan ${M(Number(r.gross))} · qo'lga ${M(Number(r.net))} · to'langan ${M(Number(r.paid))}`).join("\n");
  },
};

const pending: Tool = {
  name: "hr_pending",
  description: "Kadr bo'yicha kutilayotgan ishlar: ko'rib chiqilmagan arizalar, direktor tasdig'idagi vedomostlar, sinov muddati tugayotganlar, muddati o'tgan vazifalar, ochiq murojaatlar.",
  parameters: { type: "object", properties: {} },
  run: async () => {
    const soon = new Date(Date.now() + 7 * 864e5);
    const [reqs, runs, probation, tasks, fb] = await Promise.all([
      db.hrRequest.findMany({ where: { status: "PENDING" }, orderBy: { createdAt: "asc" }, take: 20, include: { employee: { select: { fullName: true } } } }),
      db.payrollRun.findMany({ where: { status: "SUBMITTED" }, select: { docNo: true, kind: true, net: true } }),
      db.onboardingPlan.findMany({ where: { status: { in: ["ACTIVE", "EXTENDED"] }, probationEnd: { lte: soon } }, include: { employee: { select: { fullName: true } } } }),
      db.workTask.count({ where: { status: { in: ["TODO", "IN_PROGRESS"] }, dueDate: { lt: new Date(`${today()}T00:00:00Z`) } } }),
      db.feedback.count({ where: { status: { in: ["NEW", "IN_REVIEW"] } } }),
    ]);
    return [
      reqs.length ? `Arizalar (${reqs.length}): ${reqs.map((r) => `${r.employee.fullName} — ${REQUEST_KIND[r.kind].label}`).join("; ")}` : "Kutilayotgan ariza yo'q",
      runs.length ? `Direktor tasdig'ida: ${runs.map((r) => `${r.docNo} (${PAYROLL_KIND_LABEL[r.kind]}, ${M(Number(r.net))})`).join("; ")}` : "Tasdiq kutayotgan vedomost yo'q",
      probation.length ? `Sinov muddati tugaydi: ${probation.map((p) => `${p.employee.fullName} (${p.probationEnd!.toISOString().slice(0, 10)})`).join("; ")}` : "",
      `Muddati o'tgan vazifalar: ${tasks} · ochiq murojaatlar: ${fb}`,
    ].filter(Boolean).join("\n");
  },
};

export const HR_TOOLS: Tool[] = [attendanceDay, hrOverview, payroll, pending];
