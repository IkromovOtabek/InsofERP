import { db } from "@/lib/db";
import { canDo } from "@/lib/permissions";
import { pathAllowed } from "@/lib/nav";
import { dayUtc, DISMISSAL_REASONS, hoursText, isoDay, monthOf, monthTitle, shiftDay, shiftMonth, today, validDay } from "@/lib/davomat";
import { employeeMonth, staffMonth } from "@/lib/attendance-report";
import { parseSchedule } from "@/lib/attendance-time";
import { LOGIN_ROLE_OPTIONS, isDriverPosition, positionCatalog } from "@/lib/positions";
import { DOC_KINDS, EDUCATION, MARITAL, OTHER_DOC_KIND } from "@/lib/kadr";
import { dataUrlFile } from "@/lib/procurement";
import {
  addEmployeeDocumentCore, changeEmployeeRoleCore, changeLoginCore, createEmployeeCore, deleteEmployeeDocumentCore, deleteEmployeePhotoCore,
  dismissEmployeeCore, grantLoginCore, resetEmployeePasswordCore, restoreEmployeeCore, setEmployeeScheduleCore, toggleEmployeeCore,
  toggleEmployeeLoginCore, toggleWorkPositionCore, updateEmployeeCore, updateEmployeePhotoCore, type KadrResult,
} from "@/lib/kadr-employee";
import { addPayAdjustmentCore, cancelPayAdjustmentCore, saveLateFineCore } from "@/lib/kadr-ops";
import { fillPattern, plansInRange } from "@/lib/hr/shifts";
import { checklistDay, myChecklists } from "@/lib/hr/checklists";
import { kpiMonth, setFact } from "@/lib/hr/kpi";
import { addInterview, hireCandidate, saveCandidate, saveVacancy, setVacancyStatus, type CandidateRow } from "@/lib/hr/recruit";
import { decideProbation, listPlans, progressOf, startPlan, toggleStep } from "@/lib/hr/onboarding";
import { assignCourse, courseStats, enrollmentsOf, toggleCourse } from "@/lib/hr/training";
import { sendBroadcast, setSurveyStatus, surveyResults } from "@/lib/hr/voice";
import { hrReport } from "@/lib/hr/reports";
import { createHrRequest } from "@/lib/hr/requests";
import { getLateFine } from "@/lib/hr/late-fine";
import { saveEmployeeFile } from "@/lib/uploads";
import {
  ADJ_KIND_LABEL, CANDIDATE_SOURCES, ENROLL_STATUS_LABEL, KPI_SOURCE, PAY_TYPE_LABEL, PROBATION_LABEL, REQUEST_KIND, REQUEST_KINDS,
  STAGE_LABEL, VACANCY_STATUS_LABEL,
} from "@/lib/hr/labels";
import type { HrRequestKind, PayType, ProbationStatus, VacancyStatus } from "@/generated/prisma";
import type { MobileUser } from "./auth";
import type { HomeCard, HomeRow, HomeSection, Tone } from "./home";
import type { DetailAction, FormField, FormOption, MobileDetail } from "./detail";
import type { CreateForm, CreateResult } from "./create";
import { ListError, listAllowed, type ListFilter, type MobileList } from "./list";
import { KADR_ACCESS, kadrActionPerm } from "./kadr-access";

/**
 * Mobil ilova — Otdel kadr kabineti (veb `/otdel-kadr` tablari va xodim kartasi bilan paritet):
 *   · ro'yxatlar: tabel, lavozimlar, grafik, jarima-bonus, cheklistlar, kpi, vakansiyalar, moslashuv, kurslar, sorovlar,
 *     kadr-taqvim, kadr-hisobot (`./kadr-access.ts` KADR_ACCESS);
 *   · xodim kartasi: tahrir, login (berish, blok, bo'lim, parol, login nomi), bo'shatish / qaytarish, ish vaqti, surat,
 *     hujjat nusxalari, moslashuv rejasi (`kadrEmployeeExtras` — `detail.ts` employeeDetail chaqiradi);
 *   · formalar: employees (xodim qo'shish), jarima-bonus, vakansiyalar, nomzodlar, xabar, davomat-sozlama;
 *     "ariza" — otdel kadr xodim nomidan ham yuboradi (`kadrRequestForm` / `kadrAriza`);
 *   · bosh sahifa qo'shimchasi: bugungi davomat, tug'ilgan kunlar, muddati yaqin hujjatlar (`kadrHome`).
 * Qoidalar — `lib/kadr-employee.ts`, `lib/kadr-ops.ts`, `lib/hr/*` (veb bilan bitta). Ruxsat — vebdagi
 * `requireAction("employees", <amal>)` bilan bir xil: `canDo(user, "employees", <amal>, ["HR"])`.
 */

const money = (n: number) => `${Math.round(n).toLocaleString("ru-RU")} so'm`;
const d2 = (d: Date) => `${String(d.getUTCDate()).padStart(2, "0")}.${String(d.getUTCMonth() + 1).padStart(2, "0")}.${d.getUTCFullYear()}`;
const dm = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;
const WD = ["Yak", "Dush", "Sesh", "Chor", "Pay", "Jum", "Shan"];
const fail = (m: string): never => { throw new ListError("ACTION_FAILED", m, 400); };
const forbid = (): never => { throw new ListError("FORBIDDEN", "Bu bo'limga ruxsat yo'q", 403); };
const notFound = (m: string): never => { throw new ListError("NOT_FOUND", m, 404); };
const actor = (u: MobileUser) => ({ userId: u.id, role: u.role });
/** Vebdagi `requireAction("employees", act, ["HR"])` bilan aynan bir qoida. */
const may = (u: MobileUser, act: string) => canDo(u, "employees", act, ["HR"]);
const out = (r: KadrResult, ok = "Saqlandi"): string => ("error" in r ? fail(r.error) : r.note ?? ok);
const lc = (s: string | null | undefined) => (s ?? "").toLowerCase();
const match = (q: string | undefined, ...vals: (string | null | undefined)[]) => !q || vals.some((v) => lc(v).includes(q.toLowerCase()));

/** "15.03.1990" → "1990-03-15" (ilovada o'tgan sana matn bilan yoziladi); boshqa ko'rinish — o'zicha. */
function normDate(v: string): string {
  const m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(v.trim());
  return m ? `${m[3]}-${m[2]!.padStart(2, "0")}-${m[1]!.padStart(2, "0")}` : v.trim();
}

/**
 * Ilova maydonlari → veb formasi (`FormData`) — `lib/kadr-*.ts` funksiyalari veb bilan bir xil kirishni oladi.
 * Switch `true` → "on" (veb checkbox), sana `kk.oo.yyyy` → `yyyy-mm-dd`. `extra` — formada bo'lmagan, lekin
 * qoida uchun kerak bo'lgan joriy qiymatlar (bo'sh qolsa ustun o'chib ketmasin).
 */
function formData(p: Record<string, unknown>, extra: Record<string, string | null | undefined> = {}): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(p)) {
    if (v == null || typeof v === "object") continue;
    fd.set(k, typeof v === "boolean" ? (v ? "on" : "") : normDate(String(v)));
  }
  for (const [k, v] of Object.entries(extra)) if (!fd.has(k) && v != null && v !== "") fd.set(k, v);
  return fd;
}
const str = (p: Record<string, unknown>, k: string) => String(p[k] ?? "").trim();
const opt = (p: Record<string, unknown>, k: string) => str(p, k) || null;

/** Faol xodimlar tanlovi (forma `select` variantlari). */
async function employeeOptions(where: { excludeId?: string } = {}): Promise<FormOption[]> {
  const list = await db.employee.findMany({ where: { isActive: true, ...(where.excludeId ? { id: { not: where.excludeId } } : {}) }, orderBy: { fullName: "asc" }, select: { id: true, fullName: true, position: true } });
  return list.map((e) => ({ value: e.id, label: e.fullName, hint: e.position }));
}
/** Lavozimlar: bo'lim lavozimlari + ishchi lavozimlar + ro'yxatda yo'q eski yozuvlar (veb tanlovi bilan bir xil). */
async function positionOptions(current?: string | null, opts: { departments?: boolean } = { departments: true }): Promise<FormOption[]> {
  const c = await positionCatalog();
  const names = [...(opts.departments ? c.departments.map((d) => d.label) : []), ...c.work, ...c.strays];
  if (current && !names.includes(current)) names.unshift(current);
  return [...new Set(names)].map((n) => ({ value: n, label: n, hint: c.departments.some((d) => d.label === n) ? "tizimga kiradi" : c.drivers.includes(n) ? "haydovchi" : undefined }));
}
const monthFilters = (cur: string, n = 3): ListFilter[] =>
  Array.from({ length: n }, (_, i) => shiftMonth(monthOf(today()), -i)).map((m) => ({ key: m, label: monthTitle(m), active: m === cur }));
const pickMonth = (filter?: string) => (filter && /^\d{4}-\d{2}$/.test(filter) && filter <= monthOf(today()) ? filter : monthOf(today()));
/** Dushanba — hafta boshi (veb `GrafikTab` bilan bir xil). */
function weekStart(iso: string) {
  const d = dayUtc(iso).getUTCDay();
  return shiftDay(iso, d === 0 ? -6 : 1 - d);
}

// ───────────────────────── Ro'yxatlar ─────────────────────────

export async function kadrList(user: MobileUser, key: string, q?: string, filter?: string): Promise<MobileList> {
  const title = KADR_ACCESS[key]!.title;
  switch (key) {
    case "tabel": {
      const month = pickMonth(filter);
      const m = await staffMonth(month);
      const rows: HomeRow[] = m.rows.filter((r) => match(q, r.fullName, r.position)).map((r) => {
        const t = r.totals;
        return {
          id: `${r.id}~${m.month}`, title: r.fullName,
          subtitle: [r.position, `${t.present} kun keldi`, t.lateDays ? `${t.lateDays} kech` : "", t.absent ? `${t.absent} kelmadi` : "", t.sick + t.leave ? `${t.sick + t.leave} kasal/ta'til` : "", t.notMarked ? `${t.notMarked} belgisiz` : ""].filter(Boolean).join(" · "),
          right: t.minutes ? hoursText(t.minutes) : "—",
          tone: (t.absent ? "danger" : t.notMarked ? "warning" : "success") as Tone,
        };
      });
      return { key, title: `Tabel — ${m.title}`, rows, filters: monthFilters(m.month) };
    }
    case "lavozimlar": {
      const [positions, used] = await Promise.all([
        db.workPosition.findMany({ orderBy: [{ isActive: "desc" }, { sortOrder: "asc" }, { name: "asc" }] }),
        db.employee.groupBy({ by: ["position"], where: { isActive: true }, _count: { _all: true } }),
      ]);
      const cnt = new Map(used.map((u) => [u.position.trim().toLowerCase(), u._count._all]));
      const show = filter === "hidden" ? positions.filter((p) => !p.isActive) : filter === "all" ? positions : positions.filter((p) => p.isActive);
      return {
        key, title,
        rows: show.filter((p) => match(q, p.name, p.note)).map((p) => ({
          id: p.id, title: p.name,
          subtitle: [`${cnt.get(p.name.trim().toLowerCase()) ?? 0} xodim`, p.isDriver ? "haydovchi ilovasi" : "", p.loginRole ? "tizimga kiradi" : "", p.note ?? ""].filter(Boolean).join(" · "),
          status: p.isActive ? "Faol" : "Yashirilgan", tone: (p.isActive ? "success" : "info") as Tone,
        })),
        filters: [
          { key: "", label: "Faol", count: positions.filter((p) => p.isActive).length, active: !filter || !["hidden", "all"].includes(filter) },
          { key: "hidden", label: "Yashirilgan", count: positions.filter((p) => !p.isActive).length, active: filter === "hidden" },
          { key: "all", label: "Hammasi", count: positions.length, active: filter === "all" },
        ],
      };
    }
    case "grafik": {
      const shift = filter === "next" ? 7 : filter === "prev" ? -7 : 0;
      const start = shiftDay(weekStart(today()), shift), end = shiftDay(start, 6);
      const emps = await db.employee.findMany({ where: { isActive: true }, orderBy: [{ position: "asc" }, { fullName: "asc" }], select: { id: true, fullName: true, position: true, workSchedule: true } });
      const list = emps.filter((e) => match(q, e.fullName, e.position));
      const plans = await plansInRange(list, start, end);
      return {
        key, title: `Smena grafigi · ${dm(start)}–${dm(end)}`,
        rows: list.map((e) => {
          const days = [...(plans.get(e.id)?.entries() ?? [])];
          const work = days.filter(([, p]) => !p.off);
          const times = [...new Set(work.map(([, p]) => `${p.start}–${p.end}`))];
          const off = days.filter(([, p]) => p.off).map(([iso]) => WD[dayUtc(iso).getUTCDay()]);
          const grid = days.some(([, p]) => p.fromGrid);
          return {
            id: `${e.id}~${start}`, title: e.fullName,
            subtitle: [e.position, `${work.length} ish kuni`, times.length === 1 ? times[0] : times.length ? `${times.length} xil smena` : "", off.length ? `dam: ${off.join(", ")}` : ""].filter(Boolean).join(" · "),
            right: grid ? "grafik" : "karta", tone: (grid ? "brand" : "info") as Tone,
          };
        }),
        filters: [{ key: "prev", label: "O'tgan hafta", active: shift < 0 }, { key: "", label: "Shu hafta", active: shift === 0 }, { key: "next", label: "Keyingi hafta", active: shift > 0 }],
      };
    }
    case "jarima-bonus": {
      const month = pickMonth(filter);
      const list = await db.payAdjustment.findMany({ where: { month }, orderBy: { createdAt: "desc" }, include: { employee: { select: { fullName: true, position: true } } } });
      return {
        key, title: `Jarima va bonuslar — ${monthTitle(month)}`,
        rows: list.filter((a) => match(q, a.employee.fullName, a.reason)).map((a) => ({
          id: a.id, title: `${ADJ_KIND_LABEL[a.kind]} · ${a.employee.fullName}`,
          subtitle: `${d2(a.date ?? a.createdAt)} · ${a.reason}${a.cancelledAt ? ` · bekor: ${a.cancelReason ?? ""}` : ""}`,
          right: `${a.kind === "BONUS" ? "+" : "−"}${money(Number(a.amount))}`,
          status: a.cancelledAt ? "Bekor qilingan" : undefined, tone: (a.cancelledAt ? "info" : a.kind === "BONUS" ? "success" : "danger") as Tone,
        })),
        filters: monthFilters(month),
      };
    }
    case "cheklistlar": {
      const iso = filter === "yesterday" ? shiftDay(today(), -1) : filter === "2" ? shiftDay(today(), -2) : today();
      const day = await checklistDay(iso);
      const done = day.filter((d) => d.doneCount === d.total).length;
      return {
        key, title: `Cheklistlar — ${d2(dayUtc(iso))} · ${done}/${day.length}`,
        rows: day.filter((d) => match(q, d.employee.fullName, d.employee.position, d.template.name)).map((d) => ({
          id: `${d.employee.id}~${d.template.id}~${iso}`, title: d.employee.fullName, subtitle: `${d.employee.position} · ${d.template.name}`,
          right: `${d.doneCount}/${d.total}`, status: d.doneCount === d.total ? "Bajarildi" : d.doneCount ? "Qisman" : "Belgilanmagan",
          tone: (d.doneCount === d.total ? "success" : d.doneCount ? "warning" : "danger") as Tone,
        })),
        filters: [{ key: "", label: "Bugun", active: iso === today() }, { key: "yesterday", label: "Kecha", active: filter === "yesterday" }, { key: "2", label: dm(shiftDay(today(), -2)), active: filter === "2" }],
      };
    }
    case "kpi": {
      const month = pickMonth(filter);
      const rows = await kpiMonth(month);
      const total = rows.reduce((s, r) => s + r.reward, 0);
      return {
        key, title: `KPI — ${monthTitle(month)} · ${money(total)}`,
        rows: rows.filter((r) => match(q, r.fullName, r.position, r.name)).map((r) => ({
          id: `${r.metricId}~${r.employeeId}~${month}`, title: `${r.fullName} · ${r.name}`,
          subtitle: `${KPI_SOURCE[r.source].label}${r.manual ? " · qo'lda" : ""} · fakt ${r.fact ?? "—"} / reja ${r.target} ${r.unit}`,
          right: r.reward ? money(r.reward) : r.pct == null ? "—" : `${r.pct}%`,
          tone: (r.pct == null ? "info" : r.pct >= 100 ? "success" : r.reward ? "warning" : "danger") as Tone,
        })),
        filters: monthFilters(month),
      };
    }
    case "vakansiyalar": {
      const all = await db.vacancy.findMany({ orderBy: [{ status: "asc" }, { createdAt: "desc" }], include: { _count: { select: { candidates: true } }, candidates: { where: { stage: "HIRED" }, select: { id: true } } } });
      const st = (["OPEN", "PAUSED", "CLOSED"] as VacancyStatus[]).includes(filter as VacancyStatus) ? (filter as VacancyStatus) : null;
      return {
        key, title,
        rows: all.filter((v) => (!st || v.status === st) && match(q, v.title, v.position)).map((v) => ({
          id: v.id, title: v.title, subtitle: `${v.position} · ${v._count.candidates} nomzod · kerak ${v.headcount} / qabul ${v.candidates.length}`,
          right: v.salaryFrom || v.salaryTo ? `${v.salaryFrom ? money(Number(v.salaryFrom)) : ""}${v.salaryTo ? ` – ${money(Number(v.salaryTo))}` : ""}` : undefined,
          status: VACANCY_STATUS_LABEL[v.status], tone: (v.status === "OPEN" ? "success" : v.status === "PAUSED" ? "warning" : "info") as Tone,
        })),
        filters: [{ key: "", label: "Hammasi", count: all.length, active: !st }, ...(["OPEN", "PAUSED", "CLOSED"] as VacancyStatus[]).map((s) => ({ key: s, label: VACANCY_STATUS_LABEL[s], count: all.filter((v) => v.status === s).length, active: st === s }))],
      };
    }
    case "moslashuv": {
      const st = filter === "ALL" ? "ALL" : "open";
      const plans = await listPlans({ status: st });
      const soon = shiftDay(today(), 7);
      return {
        key, title,
        rows: plans.filter((p) => match(q, p.employee.fullName, p.employee.position)).map((p) => {
          const end = p.probationEnd ? isoDay(p.probationEnd) : null;
          const open = p.status === "ACTIVE" || p.status === "EXTENDED";
          return {
            id: p.id, title: p.employee.fullName,
            subtitle: [p.employee.position, `boshlandi ${d2(p.startDate)}`, end ? `sinov ${d2(p.probationEnd!)} gacha` : "", p.mentorName ? `murabbiy ${p.mentorName}` : "", p.progress.late ? `${p.progress.late} qadam kechikdi` : ""].filter(Boolean).join(" · "),
            right: `${p.progress.done}/${p.progress.total}`, status: PROBATION_LABEL[p.status],
            tone: (open && end && end <= soon ? "danger" : p.progress.late ? "warning" : p.status === "FAILED" ? "danger" : p.status === "PASSED" ? "success" : "brand") as Tone,
          };
        }),
        filters: [{ key: "", label: "Sinov muddatida", active: st === "open" }, { key: "ALL", label: "Hammasi", active: st === "ALL" }],
      };
    }
    case "kurslar": {
      const courses = await courseStats();
      return {
        key, title,
        rows: courses.filter((c) => match(q, c.title, c.position)).map((c) => ({
          id: c.id, title: `${c.title}${c.mandatory ? " · majburiy" : ""}`,
          subtitle: `${c.position ?? "Hamma lavozim"} · ${c.questionsCount} savol · o'tish ${c.passScore}% · topshirmagan ${c.assigned} · o'tmadi ${c.failed}`,
          right: `${c.passed} o'tdi`, status: c.isActive ? undefined : "O'chirilgan", tone: (c.isActive ? (c.assigned ? "warning" : "success") : "info") as Tone,
        })),
      };
    }
    case "sorovlar": {
      const list = await db.survey.findMany({ orderBy: { createdAt: "desc" }, take: 60, include: { _count: { select: { responses: true } } } });
      const ST = { DRAFT: ["Qoralama", "info"], OPEN: ["Ochiq", "success"], CLOSED: ["Yopilgan", "info"] } as const;
      return {
        key, title,
        rows: list.filter((s) => match(q, s.title, s.position)).map((s) => ({
          id: s.id, title: s.title, subtitle: `${s.position ?? "Hamma"} · ${s.anonymous ? "anonim" : "ismli"} · ${d2(s.createdAt)}${s.closesAt ? ` · ${d2(s.closesAt)} gacha` : ""}`,
          right: `${s._count.responses} javob`, status: ST[s.status][0], tone: ST[s.status][1] as Tone,
        })),
      };
    }
    case "kadr-taqvim": return taqvimList(key, title, q, filter);
    case "kadr-hisobot": {
      const r = await hrReport(monthOf(today()));
      return {
        key, title,
        rows: [...r.series].reverse().map((x) => ({
          id: x.month, title: x.title, subtitle: `${x.headcount} xodim · +${x.hires} qabul · −${x.fires} bo'shatish${x.turnover ? ` · aylanma ${x.turnover}%` : ""}`,
          right: x.payroll ? money(x.payroll) : "—", tone: "info" as Tone,
        })),
      };
    }
  }
  throw new ListError("UNKNOWN_LIST", "Bunday ro'yxat yo'q", 404);
}

/** Kun qolgani (yil hisobga olinmaydi) — veb `KadrTaqvim` bilan bir xil. */
function daysToAnniversary(d: Date) {
  const now = new Date(); now.setHours(0, 0, 0, 0);
  const next = new Date(now.getFullYear(), d.getMonth(), d.getDate());
  if (next < now) next.setFullYear(now.getFullYear() + 1);
  return Math.round((next.getTime() - now.getTime()) / 86_400_000);
}
const inDays = (n: number) => (n === 0 ? "bugun" : n === 1 ? "ertaga" : `${n} kundan keyin`);

/** Kadr taqvimi: yaqin tug'ilgan kunlar, ish yubileylari, to'ldirilmagan kartalar. Qator — xodim kartasi (`employees:<id>`). */
async function taqvimList(key: string, title: string, q?: string, filter?: string): Promise<MobileList> {
  const emps = (await db.employee.findMany({ where: { isActive: true }, orderBy: { fullName: "asc" }, select: { id: true, fullName: true, position: true, phone: true, hiredAt: true, birthDate: true } }))
    .filter((e) => match(q, e.fullName, e.position));
  const birthdays = emps.filter((e) => e.birthDate).map((e) => ({ e, days: daysToAnniversary(e.birthDate!) })).filter((x) => x.days <= 45).sort((a, b) => a.days - b.days);
  const jubilee = emps.filter((e) => e.hiredAt).map((e) => { const days = daysToAnniversary(e.hiredAt!); return { e, days, years: new Date(Date.now() + days * 86_400_000).getFullYear() - e.hiredAt!.getFullYear() }; })
    .filter((x) => x.days <= 45 && x.years >= 1).sort((a, b) => a.days - b.days);
  const incomplete = emps.filter((e) => !e.phone || !e.hiredAt || !e.birthDate);
  const tab = filter === "jubilee" || filter === "incomplete" ? filter : "birthday";
  const rows: HomeRow[] = tab === "birthday"
    ? birthdays.map(({ e, days }) => ({ id: `employees:${e.id}`, title: e.fullName, subtitle: `${e.position} · ${d2(e.birthDate!)}`, right: inDays(days), tone: (days <= 7 ? "warning" : "info") as Tone }))
    : tab === "jubilee"
      ? jubilee.map(({ e, days, years }) => ({ id: `employees:${e.id}`, title: e.fullName, subtitle: `${e.position} · ishga kirgan ${d2(e.hiredAt!)} · ${years} yil`, right: inDays(days), tone: "brand" as Tone }))
      : incomplete.map((e) => ({ id: `employees:${e.id}`, title: e.fullName, subtitle: `${e.position} · yo'q: ${[!e.phone && "telefon", !e.hiredAt && "ishga kirgan sana", !e.birthDate && "tug'ilgan sana"].filter(Boolean).join(", ")}`, tone: "warning" as Tone }));
  return {
    key, title, rows,
    filters: [
      { key: "", label: "Tug'ilgan kunlar", count: birthdays.length, active: tab === "birthday" },
      { key: "jubilee", label: "Ish yubileylari", count: jubilee.length, active: tab === "jubilee" },
      { key: "incomplete", label: "To'ldirilmagan", count: incomplete.length, active: tab === "incomplete" },
    ],
  };
}

// ───────────────────────── Kartochkalar ─────────────────────────

export async function kadrDetail(user: MobileUser, key: string, id: string): Promise<MobileDetail> {
  if (key === "kadr-hujjat") return documentDetail(user, id);
  if (!listAllowed(user, key)) forbid();
  const [a, b, c] = id.split("~");
  switch (key) {
    case "tabel": {
      const m = await employeeMonth(a!, b);
      if (!m) return notFound("Xodim topilmadi");
      const t = m.totals;
      return {
        key, id, title: m.employee.fullName, subtitle: `${m.employee.position} · ${m.title}`, status: `${t.present} kun`,
        fields: [
          { label: "Smena", value: `${m.shift.start}–${m.shift.end}` },
          { label: "Keldi", value: `${t.present} kun · ${hoursText(t.minutes)}`, tone: "success" },
          ...(t.lateDays ? [{ label: "Kechikdi", value: `${t.lateDays} kun · ${t.lateMinutes} daq`, tone: "warning" as Tone }] : []),
          ...(t.earlyDays ? [{ label: "Erta ketdi", value: `${t.earlyDays} kun · ${t.earlyMinutes} daq`, tone: "warning" as Tone }] : []),
          { label: "Kelmadi (sababsiz)", value: String(t.absent), tone: t.absent ? "danger" : undefined },
          { label: "Kasal / ta'til / dam", value: `${t.sick} / ${t.leave} / ${t.dayoff}` },
          ...(t.notMarked ? [{ label: "Belgilanmagan", value: `${t.notMarked} kun`, tone: "warning" as Tone }] : []),
        ],
        sections: [{
          title: "Kunlar", empty: "Bu oyda kun yo'q",
          rows: m.days.map((d) => ({
            id: d.date, title: `${d.weekday}, ${dm(d.date)}`,
            subtitle: [d.statusLabel ?? (d.weekend ? "Dam olish kuni" : "Belgilanmagan"), d.lateMin ? `${d.lateMin} daq kech` : "", d.source ?? "", d.note ?? ""].filter(Boolean).join(" · "),
            right: d.checkIn ? `${d.checkIn}–${d.checkOut ?? "…"}` : undefined,
            tone: (d.status === "PRESENT" ? (d.lateMin ? "warning" : "success") : d.status === "ABSENT" ? "danger" : d.status === "NONE" ? (d.weekend ? "info" : "warning") : "info") as Tone,
          })),
        }],
        actions: [],
      };
    }
    case "lavozimlar": {
      const p = await db.workPosition.findUnique({ where: { id } });
      if (!p) return notFound("Lavozim topilmadi");
      const holders = (await db.employee.findMany({ where: { position: { contains: p.name.trim(), mode: "insensitive" } }, orderBy: [{ isActive: "desc" }, { fullName: "asc" }], select: { id: true, fullName: true, position: true, isActive: true, phone: true, userId: true } }))
        .filter((e) => e.position.trim().toLowerCase() === p.name.trim().toLowerCase());
      const actions: DetailAction[] = may(user, "edit") ? [{
        id: "position.toggle", label: p.isActive ? "Yashirish" : "Qaytarish", tone: p.isActive ? "danger" : "success",
        confirm: p.isActive ? `«${p.name}» yashirilsinmi? Yangi xodimga tanlanmaydi, mavjud xodimlar joyida qoladi` : `«${p.name}» qaytarilsinmi?`,
      }] : [];
      return {
        key, id, title: p.name, subtitle: p.note ?? undefined, status: p.isActive ? "Faol" : "Yashirilgan", actions,
        fields: [
          { label: "Holat", value: p.isActive ? "Faol" : "Yashirilgan", tone: p.isActive ? "success" : "info" },
          { label: "Faol xodimlar", value: String(holders.filter((h) => h.isActive).length) },
          { label: "Haydovchi ilovasi", value: p.isDriver ? "Ha" : "Yo'q" },
          { label: "Tizimga kiradi", value: p.loginRole ? `Ha · ${LOGIN_ROLE_OPTIONS.find((o) => o.value === p.loginRole)?.label ?? p.loginRole}` : "Yo'q" },
          ...(p.department ? [{ label: "Bo'lim", value: p.department }] : []),
        ],
        sections: [{ title: "Xodimlar", empty: "Bu lavozimda xodim yo'q", target: "employees", rows: holders.map((h) => ({ id: h.id, title: h.fullName, subtitle: `${h.phone ?? ""}${h.userId ? " · login bor" : ""}`, status: h.isActive ? "Faol" : "Nofaol", tone: (h.isActive ? "success" : "info") as Tone })) }],
      };
    }
    case "grafik": {
      const start = validDay(b) ? weekStart(b!) : weekStart(today());
      const e = await db.employee.findUnique({ where: { id: a }, select: { id: true, fullName: true, position: true, workSchedule: true } });
      if (!e) return notFound("Xodim topilmadi");
      const plan = (await plansInRange([e], start, shiftDay(start, 6))).get(e.id)!;
      const actions: DetailAction[] = [];
      if (may(user, "schedule")) {
        const [tpls, others] = await Promise.all([db.shiftTemplate.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" } }), employeeOptions({ excludeId: e.id })]);
        if (tpls.length) {
          actions.push({
            id: "shift.fill", label: "Naqsh bilan to'ldirish", tone: "brand",
            form: [
              { name: "templateId", label: "Smena", type: "select", required: true, value: tpls[0]!.id, options: tpls.map((t) => ({ value: t.id, label: t.name, hint: `${t.start}–${t.end}` })) },
              { name: "pattern", label: "Naqsh (ish/dam kunlari)", type: "select", required: true, value: "5/2", options: ["5/2", "6/1", "2/2", "1/2", "1/3", "4/4"].map((x) => ({ value: x, label: x })) },
              { name: "from", label: "Boshlanishi", type: "date", required: true, value: today() },
              { name: "weeks", label: "Necha hafta", type: "number", required: true, value: "4", hint: "Boshlanish kunidan boshlab, 1–8 hafta" },
              { name: "emps", label: "Yana xodimlar (ixtiyoriy)", type: "items", columns: [{ name: "employeeId", label: "Xodim", type: "select", options: others }] },
            ],
          });
        }
      }
      return {
        key, id, title: e.fullName, subtitle: `${e.position} · ${dm(start)}–${dm(shiftDay(start, 6))}`, actions, sections: [],
        fields: [...plan.entries()].map(([iso, p]) => ({
          label: `${WD[dayUtc(iso).getUTCDay()]}, ${dm(iso)}${iso === today() ? " · bugun" : ""}`,
          value: p.off ? "Dam olish" : `${p.start}–${p.end}${p.label && p.label !== `${p.start}–${p.end}` ? ` · ${p.label}` : ""}${p.fromGrid ? "" : " (karta)"}`,
          tone: (p.off ? "info" : p.fromGrid ? "brand" : undefined) as Tone | undefined,
        })),
      };
    }
    case "jarima-bonus": {
      const x = await db.payAdjustment.findUnique({ where: { id }, include: { employee: { select: { fullName: true, position: true } } } });
      if (!x) return notFound("Yozuv topilmadi");
      const by = await db.user.findMany({ where: { id: { in: [x.createdById, x.cancelledById].filter((v): v is string => !!v) } }, select: { id: true, fullName: true } });
      const name = (uid: string | null) => by.find((u) => u.id === uid)?.fullName ?? "—";
      const actions: DetailAction[] = !x.cancelledAt && may(user, "payrules")
        ? [{ id: "payadj.cancel", label: "Bekor qilish", tone: "danger", form: [{ name: "reason", label: "Bekor qilish sababi", type: "text", required: true }] }] : [];
      return {
        key, id, title: `${ADJ_KIND_LABEL[x.kind]} · ${money(Number(x.amount))}`, subtitle: x.employee.fullName, status: x.cancelledAt ? "Bekor qilingan" : ADJ_KIND_LABEL[x.kind], actions, sections: [],
        fields: [
          { label: "Xodim", value: `${x.employee.fullName} · ${x.employee.position}` },
          { label: "Oy", value: monthTitle(x.month) },
          { label: "Summa", value: `${x.kind === "BONUS" ? "+" : "−"}${money(Number(x.amount))}`, tone: x.kind === "BONUS" ? "success" : "danger" },
          { label: "Sababi", value: x.reason },
          ...(x.date ? [{ label: "Sana", value: d2(x.date) }] : []),
          { label: "Yozdi", value: `${name(x.createdById)} · ${d2(x.createdAt)}` },
          ...(x.cancelledAt ? [{ label: "Bekor qildi", value: `${name(x.cancelledById)} · ${d2(x.cancelledAt)} · ${x.cancelReason ?? ""}`, tone: "danger" as Tone }] : []),
        ],
      };
    }
    case "cheklistlar": {
      const iso = validDay(c) ?? today();
      const e = await db.employee.findUnique({ where: { id: a }, select: { id: true, fullName: true, position: true } });
      const cl = e ? (await myChecklists(e, iso)).find((x) => x.templateId === b) : null;
      if (!e || !cl) return notFound("Cheklist topilmadi");
      return {
        key, id, title: cl.name, subtitle: `${e.fullName} · ${d2(dayUtc(iso))} · ${cl.doneCount} / ${cl.total}`, status: cl.doneCount === cl.total ? "Bajarildi" : "Ochiq", actions: [], sections: [],
        fields: cl.items.map((i) => ({ label: i.label, value: i.done ? `bajarildi ${i.done}` : "—", tone: (i.done ? "success" : undefined) as Tone | undefined })),
      };
    }
    case "kpi": {
      const month = /^\d{4}-\d{2}$/.test(c ?? "") ? c! : monthOf(today());
      const k = (await kpiMonth(month, { employeeIds: [b!] })).find((x) => x.metricId === a);
      if (!k) return notFound("KPI topilmadi");
      const actions: DetailAction[] = may(user, "kpi") ? [{
        id: "kpi.fact", label: k.manual ? "Faktni tuzatish" : "Faktni qo'lda kiritish", tone: "brand",
        form: [
          { name: "fact", label: `Fakt, ${k.unit}`, type: "number", value: k.manual && k.fact != null ? String(k.fact) : undefined, hint: "Bo'sh qoldirsangiz — qo'lda yozuv o'chadi, avtomatik fakt qaytadi" },
          { name: "note", label: "Izoh", type: "text", value: k.note ?? undefined },
        ],
      }] : [];
      return {
        key, id, title: k.name, subtitle: `${k.fullName} · ${monthTitle(month)}`, status: k.pct == null ? "—" : `${k.pct}%`, actions, sections: [],
        fields: [
          { label: "Manba", value: `${KPI_SOURCE[k.source].label}${k.manual ? " · qo'lda" : ""}` },
          { label: "Reja", value: `${k.target} ${k.unit}` },
          { label: "Fakt", value: k.fact == null ? "—" : `${k.fact} ${k.unit}` },
          { label: "Bajarilish", value: k.pct == null ? "—" : `${k.pct}%`, tone: (k.pct ?? 0) >= 100 ? "success" : "warning" },
          { label: "Mukofot", value: money(k.reward), tone: k.reward ? "success" : undefined },
          ...(k.note ? [{ label: "Izoh", value: k.note }] : []),
        ],
      };
    }
    case "vakansiyalar": {
      const v = await db.vacancy.findUnique({ where: { id }, include: { candidates: { orderBy: { createdAt: "desc" }, select: { id: true, fullName: true, stage: true, phone: true } } } });
      if (!v) return notFound("Vakansiya topilmadi");
      const actions: DetailAction[] = may(user, "recruit") ? [{
        id: "vacancy.status", label: "Holatni o'zgartirish", tone: "brand",
        form: [{ name: "status", label: "Holat", type: "select", required: true, value: v.status, options: (["OPEN", "PAUSED", "CLOSED"] as VacancyStatus[]).map((s) => ({ value: s, label: VACANCY_STATUS_LABEL[s] })) }],
      }] : [];
      return {
        key, id, title: v.title, subtitle: v.position, status: VACANCY_STATUS_LABEL[v.status], actions,
        fields: [
          { label: "Holat", value: VACANCY_STATUS_LABEL[v.status], tone: v.status === "OPEN" ? "success" : "info" },
          { label: "Kerak / qabul", value: `${v.headcount} / ${v.candidates.filter((x) => x.stage === "HIRED").length}` },
          ...(v.salaryFrom || v.salaryTo ? [{ label: "Maosh", value: `${v.salaryFrom ? money(Number(v.salaryFrom)) : ""}${v.salaryTo ? ` – ${money(Number(v.salaryTo))}` : ""}` }] : []),
          ...(v.description ? [{ label: "Tavsif", value: v.description }] : []),
          ...(v.requirements ? [{ label: "Talablar", value: v.requirements }] : []),
          { label: "Ochilgan", value: d2(v.createdAt) },
        ],
        sections: [{ title: "Nomzodlar", empty: "Nomzod yo'q", target: "nomzodlar", rows: v.candidates.map((x) => ({ id: x.id, title: x.fullName, subtitle: x.phone ?? undefined, status: STAGE_LABEL[x.stage] })) }],
      };
    }
    case "moslashuv": {
      const p = await db.onboardingPlan.findUnique({ where: { id }, include: { employee: { select: { id: true, fullName: true, position: true } }, steps: { orderBy: { sortOrder: "asc" } } } });
      if (!p) return notFound("Reja topilmadi");
      const mentor = p.mentorId ? (await db.employee.findUnique({ where: { id: p.mentorId }, select: { fullName: true } }))?.fullName : null;
      const open = p.status === "ACTIVE" || p.status === "EXTENDED";
      const pr = progressOf(p);
      const actions: DetailAction[] = [];
      if (open && may(user, "onboarding")) {
        actions.push({ id: "onb.hrsteps", label: "Qadamlarni belgilash", tone: "brand", form: p.steps.map((x): FormField => ({ name: x.id, label: x.title, type: "switch", value: x.doneAt ? "true" : "false" })) });
        actions.push({
          id: "onb.decide", label: "Sinov natijasi", tone: "success",
          form: [
            { name: "status", label: "Natija", type: "select", required: true, value: "PASSED", options: (["PASSED", "EXTENDED", "FAILED"] as ProbationStatus[]).map((s) => ({ value: s, label: PROBATION_LABEL[s] })) },
            { name: "extendTo", label: "Yangi muddat (kk.oo.yyyy)", type: "text", placeholder: "31.12.2026", showIf: { field: "status", equals: "EXTENDED" } },
            { name: "note", label: "Izoh / sabab", type: "text", hint: "«O'tmadi» bo'lsa — sababi majburiy" },
          ],
        });
      }
      return {
        key, id, title: p.employee.fullName, subtitle: `${p.employee.position} · ${PROBATION_LABEL[p.status]}`, status: PROBATION_LABEL[p.status], actions,
        fields: [
          { label: "Boshlandi", value: d2(p.startDate) },
          ...(p.probationEnd ? [{ label: "Sinov tugaydi", value: d2(p.probationEnd), tone: (open && isoDay(p.probationEnd) <= shiftDay(today(), 7) ? "danger" : undefined) as Tone | undefined }] : []),
          ...(mentor ? [{ label: "Murabbiy", value: mentor }] : []),
          { label: "Bajarildi", value: `${pr.done} / ${pr.total}${pr.late ? ` · ${pr.late} ta muddati o'tgan` : ""}`, tone: pr.late ? "warning" : "success" },
          ...(p.result ? [{ label: "Natija", value: p.result }] : []),
        ],
        sections: [{ title: "Qadamlar", empty: "Qadam yo'q", rows: p.steps.map((x) => ({ id: x.id, title: x.title, subtitle: `muddat ${dm(shiftDay(isoDay(p.startDate), x.dueDay))}`, right: x.doneAt ? d2(x.doneAt) : "—", tone: (x.doneAt ? "success" : "info") as Tone })) }],
      };
    }
    case "kurslar": {
      const cs = (await courseStats()).find((x) => x.id === id);
      if (!cs) return notFound("Kurs topilmadi");
      const enr = await enrollmentsOf(id);
      const actions: DetailAction[] = [];
      if (may(user, "training")) {
        if (cs.isActive) {
          actions.push({
            id: "course.assign", label: "Xodimlarga biriktirish", tone: "brand",
            form: [
              { name: "position", label: "Lavozim bo'yicha (hammasiga)", type: "select", options: await positionOptions(cs.position) },
              { name: "emps", label: "Yoki tanlangan xodimlar", type: "items", columns: [{ name: "employeeId", label: "Xodim", type: "select", options: await employeeOptions() }] },
              { name: "dueDate", label: "Muddat", type: "date" },
            ],
          });
        }
        actions.push({ id: "course.toggle", label: cs.isActive ? "O'chirish" : "Yoqish", tone: cs.isActive ? "danger" : "success", confirm: cs.isActive ? "Kurs o'chirilsinmi? Biriktirilganlar va sertifikatlar joyida qoladi" : "Kurs yoqilsinmi?" });
      }
      return {
        key, id, title: cs.title, subtitle: cs.description ?? undefined, status: cs.isActive ? (cs.mandatory ? "Majburiy" : "Faol") : "O'chirilgan", actions,
        fields: [
          { label: "Lavozim", value: cs.position ?? "Hamma" },
          { label: "Savollar", value: String(cs.questionsCount) },
          { label: "O'tish bali", value: `${cs.passScore}%${cs.validMonths ? ` · sertifikat ${cs.validMonths} oy` : ""}` },
          { label: "Topshirmagan / o'tdi / o'tmadi", value: `${cs.assigned} / ${cs.passed} / ${cs.failed}`, tone: cs.assigned ? "warning" : "success" },
        ],
        sections: [{ title: "Biriktirilganlar", empty: "Hali hech kimga biriktirilmagan", rows: enr.map((x) => ({ id: x.id, title: x.employee.fullName, subtitle: `${x.employee.position}${x.dueDate && x.status !== "PASSED" ? ` · muddat ${d2(x.dueDate)}` : ""}`, right: x.bestScore != null ? `${x.bestScore}%` : undefined, status: ENROLL_STATUS_LABEL[x.status], tone: (x.status === "PASSED" ? "success" : x.status === "FAILED" ? "danger" : "warning") as Tone })) }],
      };
    }
    case "sorovlar": {
      const r = await surveyResults(id);
      if (!r) return notFound("So'rovnoma topilmadi");
      const s = r.survey;
      const actions: DetailAction[] = [];
      if (may(user, "voice")) {
        if (s.status === "DRAFT") actions.push({ id: "survey.status", label: "Ochish — xodimlarga yuborish", tone: "success", form: [{ name: "status", label: "Holat", type: "select", required: true, value: "OPEN", options: [{ value: "OPEN", label: "Ochiq" }] }] });
        if (s.status === "OPEN") actions.push({ id: "survey.status", label: "Yopish", tone: "danger", form: [{ name: "status", label: "Holat", type: "select", required: true, value: "CLOSED", options: [{ value: "CLOSED", label: "Yopilgan" }] }] });
      }
      const rows: HomeRow[] = r.results.flatMap((x, i): HomeRow[] => {
        const head = `${i + 1}. ${x.q.text}`;
        if ("nps" in x) return [{ id: x.q.key, title: head, subtitle: `NPS · ${x.count} javob · o'rtacha ${x.avg ?? "—"} · promouter ${x.pro} / kritik ${x.det}`, right: x.nps == null ? "—" : String(x.nps), tone: (x.nps == null ? "info" : x.nps >= 30 ? "success" : x.nps >= 0 ? "warning" : "danger") as Tone }];
        if ("dist" in x) return [{ id: x.q.key, title: head, subtitle: (x.dist ?? []).map((d) => `${d.option}: ${d.n}`).join(" · "), right: `${x.count}` }];
        if ("texts" in x) return [{ id: x.q.key, title: head, subtitle: `${x.count} javob`, tone: "info" as Tone }, ...(x.texts ?? []).slice(0, 30).map((t, j) => ({ id: `${x.q.key}~${j}`, title: t.text, subtitle: t.who ?? (s.anonymous ? "anonim" : undefined) }))];
        return [{ id: x.q.key, title: head, subtitle: `${x.count} javob · o'rtacha ${x.avg ?? "—"} / 5`, right: x.avg == null ? "—" : String(x.avg) }];
      });
      return {
        key, id, title: s.title, subtitle: s.description ?? undefined, status: s.status === "OPEN" ? "Ochiq" : s.status === "CLOSED" ? "Yopilgan" : "Qoralama", actions,
        fields: [
          { label: "Javoblar", value: String(r.total), tone: "brand" },
          { label: "Kimga", value: s.position ?? "Hamma" },
          { label: "Turi", value: s.anonymous ? "Anonim" : "Ismli" },
          ...(s.closesAt ? [{ label: "Muddat", value: d2(s.closesAt) }] : []),
        ],
        sections: [{ title: "Natijalar", empty: "Hali javob yo'q", rows }],
      };
    }
    case "kadr-hisobot": {
      const month = /^\d{4}-\d{2}$/.test(id) ? id : monthOf(today());
      const r = await hrReport(month);
      return {
        key, id, title: `Kadr hisoboti — ${r.title}`, status: `${r.headcount} xodim`, actions: [],
        fields: [
          { label: "Xodimlar", value: `${r.headcount}${r.avgTenure != null ? ` · o'rtacha staj ${r.avgTenure} yil` : ""}`, tone: "brand" },
          { label: "Aylanma (12 oy)", value: `${r.yearTurnover}% · +${r.yearHires} qabul · −${r.yearFires} bo'shatish`, tone: r.yearTurnover > 30 ? "danger" : r.yearTurnover > 15 ? "warning" : "success" },
          { label: "Davomat", value: `${r.attendance.rate != null ? `${r.attendance.rate}%` : "—"} · kechikish ${Math.round(r.attendance.lateMinutes / 60)} soat · sababsiz ${r.attendance.absent} kun` },
          { label: "Ish haqi fondi", value: `${money(r.series.at(-1)?.payroll ?? 0)} · ijtimoiy soliq ${money(r.series.at(-1)?.employerTax ?? 0)}` },
          { label: "Vakansiyalar", value: `${r.recruiting.openVacancies} ochiq · ${r.recruiting.openSeats} o'rin · qabulgacha ~${r.recruiting.daysToHire ?? "—"} kun` },
          { label: "Kurslar", value: `${r.training.passed} o'tdi · ${r.training.assigned} topshirmagan · ${r.training.failed} o'tmagan` },
          { label: "Kutilayotgan arizalar", value: String(r.pendingRequests), tone: r.pendingRequests ? "warning" : undefined },
          { label: "Ochiq murojaatlar", value: String(r.openFeedback), tone: r.openFeedback ? "warning" : undefined },
        ],
        sections: [
          { title: "Lavozimlar bo'yicha", empty: "Xodim yo'q", rows: r.byPosition.slice(0, 30).map(([p, n]) => ({ id: `p~${p}`, title: p, right: String(n) })) },
          { title: "Bo'shatish sabablari (12 oy)", empty: "Bo'shatish yo'q", rows: r.fireReasons.map(([p, n]) => ({ id: `f~${p}`, title: p, right: String(n) })) },
        ],
      };
    }
  }
  throw new ListError("UNKNOWN_DETAIL", "Bunday kartochka yo'q", 404);
}

/** Hujjat nusxasi — faqat otdel kadr va direktor (veb `/employees/[id]/hujjat/[docId]` bilan bir xil). */
async function documentDetail(user: MobileUser, id: string): Promise<MobileDetail> {
  if ((user.role !== "HR" && user.role !== "DIRECTOR") || !pathAllowed("/employees", user.role, user.perms)) forbid();
  const doc = await db.employeeDocument.findUnique({ where: { id }, include: { employee: { select: { fullName: true } } } });
  if (!doc) return notFound("Hujjat topilmadi");
  const image = doc.fileType.startsWith("image/");
  return {
    key: "kadr-hujjat", id, title: doc.kind, subtitle: doc.employee.fullName, status: image ? "Rasm" : "Fayl",
    fields: [
      { label: "Xodim", value: doc.employee.fullName },
      { label: "Fayl", value: doc.fileName },
      { label: "Yuklandi", value: d2(doc.createdAt) },
      ...(image ? [] : [{ label: "Ko'rish", value: "PDF — kompyuterdagi ERP'da oching" }]),
    ],
    sections: [],
    actions: may(user, "edit") ? [{ id: "employee.doc.remove", label: "Kartadan olib tashlash", tone: "danger", confirm: `«${doc.kind}» nusxasi kartadan olib tashlansinmi? Fayl arxivda qoladi` }] : [],
    ...(image ? { photo: { url: `/api/mobile/kadr/photo?doc=${doc.id}`, title: doc.kind } } : {}),
  };
}

// ───────────────────────── Xodim kartasi: qo'shimcha amallar ─────────────────────────

const ROLE_OPTS = (user: MobileUser) => LOGIN_ROLE_OPTIONS.filter((o) => o.value !== "DIRECTOR" || user.role === "DIRECTOR").map((o) => ({ value: o.value, label: o.label }));

/**
 * Xodim kartasiga (`detail.ts` employeeDetail) qo'shiladigan otdel kadr qismi: kadr ma'lumotlari, hujjatlar, surat
 * va amallar. Har tugma — vebdagi kartadagi tugma, o'sha ruxsat bilan (`may`). Ruxsati bo'lmaganga — hech narsa.
 */
export async function kadrEmployeeExtras(user: MobileUser, employeeId: string): Promise<{ actions: DetailAction[]; sections: HomeSection[]; photo?: MobileDetail["photo"] }> {
  const edit = may(user, "edit"), login = may(user, "login"), onb = may(user, "onboarding");
  if (!edit && !login && !onb) return { actions: [], sections: [] };
  const e = await db.employee.findUnique({ where: { id: employeeId }, include: { user: { select: { id: true, login: true, role: true, isActive: true } }, documents: { orderBy: { createdAt: "desc" } }, onboarding: { select: { id: true } } } });
  if (!e) return { actions: [], sections: [] };
  const actions: DetailAction[] = [];
  const self = e.userId === user.id;
  const dirLocked = e.user?.role === "DIRECTOR" && user.role !== "DIRECTOR";

  if (edit && !dirLocked) {
    actions.push({ id: "employee.edit", label: "Kartani tahrirlash", tone: "brand", form: await editForm(e) });
    const sch = parseSchedule(e.workSchedule);
    actions.push({
      id: "employee.schedule", label: sch.start ? `Ish vaqti: ${sch.start}–${sch.end}` : "Ish vaqti (smena)",
      form: [
        { name: "start", label: "Boshlanishi (SS:DD)", type: "text", value: sch.start ?? undefined, placeholder: "08:00" },
        { name: "end", label: "Tugashi (SS:DD)", type: "text", value: sch.end ?? undefined, placeholder: "17:00" },
        { name: "note", label: "Izoh (masalan 5/2)", type: "text", value: sch.note || undefined, hint: "Hammasi bo'sh — zavod standarti" },
      ],
    });
    actions.push({ id: "employee.photo", label: e.photo ? "Suratni almashtirish" : "3x4 surat yuklash", form: [{ name: "photo", label: "Surat", type: "photo", required: true, camera: "back" }] });
    if (e.photo) actions.push({ id: "employee.photo.remove", label: "Suratni olib tashlash", tone: "danger", confirm: "Surat kartadan olib tashlansinmi?" });
    actions.push({
      id: "employee.doc", label: "Hujjat nusxasi qo'shish",
      form: [
        { name: "kind", label: "Hujjat turi", type: "select", required: true, value: DOC_KINDS[0], options: [...DOC_KINDS, OTHER_DOC_KIND].map((k) => ({ value: k, label: k })) },
        { name: "name", label: "Hujjat nomi", type: "text", required: true, placeholder: "Masalan: Bo'shatish buyrug'i №230", showIf: { field: "kind", equals: OTHER_DOC_KIND } },
        { name: "file", label: "Nusxa surati", type: "photo", required: true, camera: "back" },
      ],
    });
  }
  if (login && !self && !dirLocked) {
    if (!e.user && e.isActive) {
      actions.push({
        id: "employee.login", label: "Login berish", tone: "brand",
        form: [
          { name: "login", label: "Login", type: "text", required: true, placeholder: "lotin harf, raqam" },
          { name: "password", label: "Parol", type: "text", secure: true, required: true, hint: "Kamida 8 belgi, harf va raqam. Xodimga o'zingiz yetkazing" },
          { name: "role", label: "Bo'lim (huquq)", type: "select", value: "auto", options: [{ value: "auto", label: "Lavozimdan (avtomatik)" }, ...ROLE_OPTS(user)] },
        ],
      });
    }
    if (e.user) {
      actions.push({ id: "employee.role", label: "Bo'limni almashtirish", form: [{ name: "role", label: "Bo'lim", type: "select", required: true, value: e.user.role, options: ROLE_OPTS(user), hint: "Xodimning ochiq sessiyalari tugaydi — qayta kiradi" }] });
      actions.push({ id: "employee.resetpw", label: "Parolni tiklash", form: [{ name: "password", label: "Yangi parol", type: "text", secure: true, required: true, hint: "Kamida 8 belgi, harf va raqam. Xodimga o'zingiz yetkazing" }] });
      actions.push({ id: "employee.rename", label: "Login nomini almashtirish", form: [{ name: "login", label: "Login", type: "text", required: true, value: e.user.login }] });
      if (e.isActive) actions.push({ id: "employee.block", label: e.user.isActive ? "Kirishni bloklash" : "Kirishni ochish", tone: e.user.isActive ? "danger" : "success", confirm: e.user.isActive ? `${e.fullName} tizimga kira olmasin? Xodimning o'zi faol qoladi` : `${e.fullName} yana tizimga kira olsinmi?` });
    }
  }
  if (onb && e.isActive && !e.onboarding) {
    actions.push({
      id: "onb.start", label: "Moslashuv rejasini ochish",
      form: [
        { name: "mentorId", label: "Murabbiy", type: "select", options: await employeeOptions({ excludeId: e.id }) },
        { name: "startDate", label: "Boshlanishi (kk.oo.yyyy)", type: "text", required: true, value: d2(e.hiredAt ?? dayUtc(today())) },
        { name: "probationMonths", label: "Sinov muddati, oy", type: "number", value: "3" },
      ],
    });
  }
  if (edit && !self && !dirLocked) {
    if (e.firedAt) actions.push({ id: "employee.restore", label: "Ishga qaytarish", tone: "success", confirm: `${e.fullName} ishga qaytarilsinmi? Logini ham ochiladi` });
    else {
      actions.push({
        id: "employee.dismiss", label: "Ishdan bo'shatish", tone: "danger",
        form: [
          { name: "firedAt", label: "Bo'shatilgan sana (kk.oo.yyyy)", type: "text", required: true, value: d2(dayUtc(today())) },
          { name: "reason", label: "Sabab", type: "select", required: true, options: [...DISMISSAL_REASONS.map((r) => ({ value: r, label: r })), { value: "__other", label: "Boshqa sabab" }] },
          { name: "reasonText", label: "Sababni yozing", type: "text", required: true, showIf: { field: "reason", equals: "__other" } },
          // Veb bo'shatish oynasidagi kabi: buyruq kadr hujjatlariga tushadi (chop etish — vebda, xodim kartasi → hujjatlar)
          { name: "makeOrder", label: "Bo'shatish buyrug'ini tayyorlash", type: "switch", value: "true" },
          { name: "orderNo", label: "Buyruq raqami", type: "text", placeholder: "avtomatik", hint: "Bo'sh qoldirilsa — keyingi bo'sh raqam beriladi", showIf: { field: "makeOrder", equals: "true" } },
        ],
      });
      actions.push({ id: "employee.toggle", label: e.isActive ? "Nofaol qilish" : "Faollashtirish", tone: e.isActive ? "danger" : "success", confirm: e.isActive ? `${e.fullName} nofaol qilinsinmi? Logini ham bloklanadi` : `${e.fullName} faollashtirilsinmi?` });
    }
  }

  const sections: HomeSection[] = [];
  if (edit) {
    const rows: HomeRow[] = [
      ...(e.birthDate ? [{ id: "birth", title: "Tug'ilgan sana", right: d2(e.birthDate) }] : []),
      ...(e.hiredAt ? [{ id: "hired", title: "Ishga kirgan", right: d2(e.hiredAt) }] : []),
      ...(e.firedAt ? [{ id: "fired", title: "Bo'shatilgan", subtitle: e.firedReason ?? undefined, right: d2(e.firedAt), tone: "danger" as Tone }] : []),
      ...(e.tabelNo ? [{ id: "tabel", title: "Tabel raqami", right: e.tabelNo }] : []),
      ...(e.subdivision ? [{ id: "sub", title: "Bo'lim / brigada", right: e.subdivision }] : []),
      { id: "pay", title: "Ish haqi turi", right: `${PAY_TYPE_LABEL[e.payType]}${e.tariffRate ? ` · ${money(Number(e.tariffRate))}` : ""}` },
      { id: "sched", title: "Ish vaqti", right: e.workSchedule ?? "zavod standarti" },
      ...(e.passportSeries ? [{ id: "pass", title: "Pasport", subtitle: e.passportIssuedBy ?? undefined, right: e.passportSeries }] : []),
      ...(e.pinfl ? [{ id: "pinfl", title: "PINFL", right: e.pinfl }] : []),
      ...(e.address ? [{ id: "addr", title: "Manzil", subtitle: e.address }] : []),
      ...(e.user ? [{ id: "login", title: "Login", subtitle: LOGIN_ROLE_OPTIONS.find((o) => o.value === e.user!.role)?.label ?? e.user.role, right: e.user.login, status: e.user.isActive ? "Faol" : "Bloklangan", tone: (e.user.isActive ? "success" : "danger") as Tone }] : []),
    ];
    sections.push({ title: "Kadr ma'lumotlari", empty: "", rows });
    sections.push({ title: "Hujjatlar", empty: "Hujjat nusxasi yuklanmagan", target: "kadr-hujjat", rows: e.documents.map((d) => ({ id: d.id, title: d.kind, subtitle: `${d.fileName} · ${d2(d.createdAt)}`, tone: "info" as Tone })) });
  }
  const photo = e.photo && pathAllowed("/employees", user.role, user.perms) ? { url: `/api/mobile/kadr/photo?id=${e.id}`, title: "3x4 surat" } : undefined;
  return { actions, sections, photo };
}

/** Karta tahriri formasi — veb kartasidagi maydonlar (haydovchi texnikasi va bo'shatish sanasi — alohida). */
async function editForm(e: { fullName: string; position: string; phone: string | null; birthDate: Date | null; hiredAt: Date | null; tabelNo: string | null; subdivision: string | null; payType: PayType; tariffRate: unknown; passportSeries: string | null; pinfl: string | null; passportIssuedBy: string | null; passportIssuedAt: Date | null; address: string | null; education: string | null; maritalStatus: string | null; note: string | null }): Promise<FormField[]> {
  const date = (d: Date | null) => (d ? d2(d) : undefined);
  return [
    { name: "fullName", label: "F.I.O.", type: "text", required: true, value: e.fullName },
    { name: "position", label: "Lavozim", type: "select", required: true, value: e.position, options: await positionOptions(e.position) },
    { name: "phone", label: "Telefon", type: "text", value: e.phone ?? undefined, placeholder: "+998 90 123 45 67" },
    { name: "birthDate", label: "Tug'ilgan sana (kk.oo.yyyy)", type: "text", value: date(e.birthDate), placeholder: "15.03.1990" },
    { name: "hiredAt", label: "Ishga kirgan sana (kk.oo.yyyy)", type: "text", value: date(e.hiredAt) },
    { name: "tabelNo", label: "Tabel raqami", type: "text", value: e.tabelNo ?? undefined },
    { name: "subdivision", label: "Bo'lim / brigada", type: "text", value: e.subdivision ?? undefined },
    { name: "payType", label: "Ish haqi turi", type: "select", value: e.payType, options: (Object.keys(PAY_TYPE_LABEL) as PayType[]).map((k) => ({ value: k, label: PAY_TYPE_LABEL[k] })) },
    { name: "tariffRate", label: "Stavka, so'm", type: "number", value: e.tariffRate != null ? String(Number(e.tariffRate)) : undefined },
    { name: "passportSeries", label: "Pasport seriya va raqami", type: "text", value: e.passportSeries ?? undefined },
    { name: "pinfl", label: "PINFL (14 raqam)", type: "number", value: e.pinfl ?? undefined },
    { name: "passportIssuedBy", label: "Pasport kim tomonidan berilgan", type: "text", value: e.passportIssuedBy ?? undefined },
    { name: "passportIssuedAt", label: "Pasport berilgan sana (kk.oo.yyyy)", type: "text", value: date(e.passportIssuedAt) },
    { name: "address", label: "Manzil", type: "text", value: e.address ?? undefined },
    { name: "education", label: "Ma'lumoti", type: "select", value: e.education ?? undefined, options: [...new Set([...EDUCATION, ...(e.education ? [e.education] : [])])].map((x) => ({ value: x, label: x })) },
    { name: "maritalStatus", label: "Oilaviy holati", type: "select", value: e.maritalStatus ?? undefined, options: [...new Set([...MARITAL, ...(e.maritalStatus ? [e.maritalStatus] : [])])].map((x) => ({ value: x, label: x })) },
    { name: "note", label: "Izoh", type: "text", value: e.note ?? undefined },
  ];
}

/**
 * Karta tahriri: formada yo'q maydonlar (haydovchi texnikasi, bo'shatish sanasi) joriy qiymati bilan yuboriladi —
 * aks holda `updateEmployeeCore` ularni bo'sh deb o'chirib yuborardi (texnika uziladi, bo'shatilgan xodim qaytadi).
 */
async function editFormData(id: string, p: Record<string, unknown>): Promise<FormData> {
  const e = await db.employee.findUniqueOrThrow({ where: { id }, include: { vehicle: { select: { plate: true, type: true, capacityM3: true } } } });
  const iso = (d: Date | null) => (d ? isoDay(d) : null);
  const driver = (await isDriverPosition(str(p, "position") || e.position)) || (await isDriverPosition(e.position));
  return formData(p, {
    firedAt: iso(e.firedAt),
    ...(driver ? {
      plate: e.vehicle?.plate, vehicleType: e.vehicle?.type, capacityM3: e.vehicle?.capacityM3 != null ? String(Number(e.vehicle.capacityM3)) : null,
      licenseNo: e.licenseNo, licenseCategory: e.licenseCategory, licenseExpiry: iso(e.licenseExpiry),
    } : {}),
  });
}

// ───────────────────────── Amallar ─────────────────────────

export async function runKadrAction(user: MobileUser, action: string, id: string, payload: Record<string, unknown>): Promise<string> {
  const perm = kadrActionPerm(action);
  if (!perm || !may(user, perm)) return fail("Bu amalga ruxsatingiz yo'q");
  const s = actor(user);
  switch (action) {
    case "employee.edit": return out(await updateEmployeeCore(s, id, await editFormData(id, payload)), "Karta saqlandi");
    case "employee.toggle": return out(await toggleEmployeeCore(s, id));
    case "employee.dismiss": {
      const p = { ...payload, ...(payload.reason === "__other" ? { reason: "" } : { reasonText: "" }) };
      return out(await dismissEmployeeCore(s, id, formData(p)));
    }
    case "employee.restore": return out(await restoreEmployeeCore(s, id));
    case "employee.schedule": {
      const r = await setEmployeeScheduleCore(s, id, formData(payload));
      return "error" in r ? fail(r.error) : r.same ? "O'zgarish yo'q" : "Ish vaqti saqlandi";
    }
    case "employee.photo": return out(await updateEmployeePhotoCore(s, id, formData({}, { photoData: str(payload, "photo") })));
    case "employee.photo.remove": return out(await deleteEmployeePhotoCore(s, id), "Surat yo'q edi");
    case "employee.doc": {
      const file = dataUrlFile(str(payload, "file"), "nusxa");
      if (!file) return fail("Nusxa surati olinmadi");
      // Yozilgan nom (masalan «Bo'shatish buyrug'i №230») turdan ustun — veb `addEmployeeDocumentCore` bilan bir xil
      const fd = formData({ kind: str(payload, "kind"), name: str(payload, "name") });
      fd.append("file", file);
      return out(await addEmployeeDocumentCore(s, id, fd));
    }
    case "employee.doc.remove": return out(await deleteEmployeeDocumentCore(s, id));
    case "employee.login": return out(await grantLoginCore(s, id, formData({ ...payload, role: payload.role === "auto" ? "" : payload.role, password: payload.password })));
    case "employee.block": return out(await toggleEmployeeLoginCore(s, id));
    case "employee.role": return out(await changeEmployeeRoleCore(s, id, formData(payload)));
    case "employee.resetpw": return out(await resetEmployeePasswordCore(s, id, formData({ password: String(payload.password ?? "") })));
    case "employee.rename": {
      const r = await changeLoginCore(s, id, formData(payload));
      return "error" in r ? fail(r.error) : r.same ? "Login o'zgarmadi" : r.note ?? "Saqlandi";
    }
    case "position.toggle": return out(await toggleWorkPositionCore(s, id));
    case "shift.fill": {
      const [empId, week] = id.split("~");
      const m = /^(\d{1,2})\/(\d{1,2})$/.exec(str(payload, "pattern"));
      if (!m) return fail("Naqsh 5/2 ko'rinishida bo'lsin");
      const from = validDay(normDate(str(payload, "from")) || undefined) ?? (validDay(week) ? week! : null);
      const weeks = Math.round(Number(str(payload, "weeks") || 4));
      if (!from) return fail("Sana noto'g'ri");
      if (!(weeks >= 1 && weeks <= 8)) return fail("Hafta soni 1–8");
      const others = Array.isArray(payload.emps) ? (payload.emps as Record<string, unknown>[]).map((r) => String(r?.employeeId ?? "")).filter(Boolean) : [];
      const ids = [...new Set([empId!, ...others])];
      const res = await fillPattern({ employeeIds: ids, templateId: str(payload, "templateId"), work: Number(m[1]), rest: Number(m[2]), startIso: from, endIso: shiftDay(from, weeks * 7 - 1) }, user.id);
      if ("error" in res) return fail(res.error);
      return `${ids.length} xodimga ${m[0]} grafigi qo'yildi (${res.saved} kun)`;
    }
    case "payadj.cancel": return out(await cancelPayAdjustmentCore(user.id, id, formData(payload)));
    case "kpi.fact": {
      const [metricId, employeeId, month] = id.split("~");
      if (!metricId || !employeeId || !/^\d{4}-\d{2}$/.test(month ?? "")) return fail("KPI topilmadi");
      const raw = str(payload, "fact").replace(/\s/g, "").replace(",", ".");
      const r = await setFact({ metricId, employeeId, month: month!, fact: raw === "" ? null : Number(raw), note: opt(payload, "note") }, user.id);
      return "error" in r ? fail(r.error!) : "Saqlandi";
    }
    case "vacancy.status": {
      const st = str(payload, "status") as VacancyStatus;
      if (!["OPEN", "PAUSED", "CLOSED"].includes(st)) return fail("Holatni tanlang");
      const r = await setVacancyStatus(id, st, user.id);
      return "error" in r && r.error ? fail(r.error) : `Holat: ${VACANCY_STATUS_LABEL[st]}`;
    }
    case "cand.interview": {
      const day = normDate(str(payload, "date")), time = str(payload, "time");
      if (!validDay(day) || !/^\d{1,2}:\d{2}$/.test(time)) return fail("Suhbat sanasi va soatini tanlang");
      const r = await addInterview(id, { at: `${day}T${time.padStart(5, "0")}`, place: opt(payload, "place"), interviewerId: opt(payload, "interviewerId") }, user.id);
      return "error" in r ? fail(r.error!) : "Suhbat belgilandi";
    }
    case "cand.hire": {
      const r = await hireCandidate(id, { position: str(payload, "position"), hiredAt: normDate(str(payload, "hiredAt")), mentorId: opt(payload, "mentorId"), probationMonths: Number(str(payload, "probationMonths") || 3) }, user.id);
      return "error" in r ? fail(r.error!) : "Ishga qabul qilindi — xodim kartasi va moslashuv rejasi ochildi";
    }
    case "onb.start": {
      const r = await startPlan({ employeeId: id, mentorId: opt(payload, "mentorId"), startDate: normDate(str(payload, "startDate")), probationMonths: Number(str(payload, "probationMonths") || 3) }, user.id);
      return "error" in r ? fail(r.error!) : "Moslashuv rejasi ochildi";
    }
    case "onb.decide": {
      const st = str(payload, "status") as Exclude<ProbationStatus, "ACTIVE">;
      if (!["PASSED", "EXTENDED", "FAILED"].includes(st)) return fail("Natijani tanlang");
      const r = await decideProbation(id, st, opt(payload, "note"), payload.extendTo ? normDate(str(payload, "extendTo")) : null, user.id);
      return "error" in r ? fail(r.error!) : r.note ?? "Saqlandi";
    }
    case "onb.hrsteps": {
      const cur = new Map((await db.onboardingStep.findMany({ where: { planId: id }, select: { id: true, doneAt: true } })).map((x) => [x.id, !!x.doneAt]));
      let changed = 0;
      for (const [stepId, v] of Object.entries(payload)) {
        if (typeof v !== "boolean" && v !== "true" && v !== "false") continue;
        const want = v === true || v === "true";
        if (!cur.has(stepId) || cur.get(stepId) === want) continue;
        const r = await toggleStep(stepId, want, s, true);
        if ("error" in r) return fail(r.error!);
        changed++;
      }
      return changed ? "Saqlandi" : "O'zgarish yo'q";
    }
    case "course.assign": {
      const ids = Array.isArray(payload.emps) ? [...new Set((payload.emps as Record<string, unknown>[]).map((r) => String(r?.employeeId ?? "")).filter(Boolean))] : [];
      const position = str(payload, "position");
      if (!ids.length && !position) return fail("Xodimlarni belgilang yoki lavozimni tanlang");
      const r = await assignCourse(id, ids.length ? { employeeIds: ids } : { position }, opt(payload, "dueDate") ? normDate(str(payload, "dueDate")) : null, user.id);
      return "error" in r ? fail(r.error!) : r.count ? `${r.count} xodimga biriktirildi` : "Hammasi allaqachon biriktirilgan";
    }
    case "course.toggle": {
      const r = await toggleCourse(id, user.id);
      return "error" in r && r.error ? fail(r.error) : "Saqlandi";
    }
    case "survey.status": {
      const st = str(payload, "status");
      if (st !== "OPEN" && st !== "CLOSED") return fail("Holatni tanlang");
      const r = await setSurveyStatus(id, st, user.id);
      return "error" in r ? fail(r.error!) : st === "OPEN" ? "So'rovnoma ochildi — xodimlarga xabar ketdi" : "Yopildi";
    }
  }
  return fail("Bunday amal yo'q");
}

// ───────────────────────── Formalar ─────────────────────────

export async function kadrForm(user: MobileUser, key: string): Promise<CreateForm> {
  switch (key) {
    case "employees": {
      const hr = user.role === "HR" || user.role === "DIRECTOR";
      const c = await positionCatalog();
      // Logistika vebda ham faqat haydovchi qo'shadi (login — kadr ishi)
      const positions = hr ? await positionOptions(null) : c.drivers.map((d) => ({ value: d, label: d }));
      return {
        key, title: "Yangi xodim", submitLabel: "Saqlash",
        fields: [
          { name: "fullName", label: "F.I.O.", type: "text", required: true },
          { name: "position", label: "Lavozim", type: "select", required: true, value: hr ? undefined : c.drivers[0], options: positions, hint: "Bo'lim lavozimi (Sotuv, Sklad…) — login va parol majburiy" },
          { name: "phone", label: "Telefon", type: "text", placeholder: "+998 90 123 45 67" },
          { name: "hiredAt", label: "Ishga kirgan sana (kk.oo.yyyy)", type: "text", value: d2(dayUtc(today())) },
          { name: "birthDate", label: "Tug'ilgan sana (kk.oo.yyyy)", type: "text" },
          ...(hr ? [
            { name: "login", label: "Login (tizimga kirsa)", type: "text" as const, placeholder: "lotin harf, raqam" },
            { name: "password", label: "Parol", type: "text" as const, secure: true, hint: "Kamida 8 belgi, harf va raqam. Xodimga o'zingiz yetkazing" },
            { name: "role", label: "Bo'lim (huquq)", type: "select" as const, value: "auto", options: [{ value: "auto", label: "Lavozimdan (avtomatik)" }, ...ROLE_OPTS(user)] },
          ] : []),
          { name: "plate", label: "Haydovchi: mashina davlat raqami", type: "text", placeholder: "01 A 123 BC", hint: "Faqat haydovchi lavozimida — reys shu texnika bilan ochiladi" },
          { name: "vehicleType", label: "Haydovchi: texnika turi", type: "select", value: "MIXER", options: [{ value: "MIXER", label: "Mikser" }, { value: "PUMP", label: "Nasos" }, { value: "TRUCK", label: "Yuk mashina" }] },
          { name: "capacityM3", label: "Haydovchi: sig'imi, m³", type: "number" },
          { name: "note", label: "Izoh", type: "text" },
        ],
      };
    }
    case "jarima-bonus": {
      const cur = monthOf(today());
      return {
        key, title: "Jarima / bonus", submitLabel: "Yozish",
        fields: [
          { name: "employeeId", label: "Xodim", type: "select", required: true, options: await employeeOptions() },
          { name: "kind", label: "Turi", type: "select", required: true, value: "PENALTY", options: [{ value: "PENALTY", label: "Jarima" }, { value: "BONUS", label: "Bonus" }] },
          { name: "amount", label: "Summa, so'm", type: "number", required: true },
          { name: "reason", label: "Sababi", type: "text", required: true },
          { name: "month", label: "Qaysi oy hisobiga", type: "select", required: true, value: cur, options: [shiftMonth(cur, -1), cur, shiftMonth(cur, 1)].map((m) => ({ value: m, label: monthTitle(m) })) },
          { name: "date", label: "Sana (ixtiyoriy, kk.oo.yyyy)", type: "text" },
        ],
      };
    }
    case "vakansiyalar":
      return {
        key, title: "Yangi vakansiya", submitLabel: "Saqlash",
        fields: [
          { name: "title", label: "Vakansiya nomi", type: "text", required: true },
          { name: "position", label: "Lavozim", type: "select", required: true, options: await positionOptions(null) },
          { name: "headcount", label: "Necha kishi kerak", type: "number", value: "1" },
          { name: "salaryFrom", label: "Maosh, dan (so'm)", type: "number" },
          { name: "salaryTo", label: "Maosh, gacha (so'm)", type: "number" },
          { name: "description", label: "Tavsif", type: "text" },
          { name: "requirements", label: "Talablar", type: "text" },
        ],
      };
    case "nomzodlar": {
      const vacs = await db.vacancy.findMany({ where: { status: { not: "CLOSED" } }, orderBy: { createdAt: "desc" }, select: { id: true, title: true, position: true } });
      return {
        key, title: "Yangi nomzod", submitLabel: "Saqlash",
        fields: [
          { name: "fullName", label: "F.I.O.", type: "text", required: true },
          { name: "phone", label: "Telefon", type: "text", placeholder: "+998 90 123 45 67" },
          { name: "vacancyId", label: "Vakansiya", type: "select", options: vacs.map((v) => ({ value: v.id, label: v.title, hint: v.position })) },
          { name: "source", label: "Manba", type: "select", options: CANDIDATE_SOURCES.map((x) => ({ value: x, label: x })) },
          { name: "rating", label: "Baho", type: "select", options: [1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: "★".repeat(n) })) },
          { name: "note", label: "Izoh", type: "text" },
          { name: "file", label: "Rezyume surati (ixtiyoriy)", type: "photo", camera: "back" },
        ],
      };
    }
    case "xabar": {
      const positions = [...new Set((await db.employee.findMany({ where: { isActive: true }, select: { position: true } })).map((e) => e.position))].sort();
      return {
        key, title: "Ommaviy xabar", submitLabel: "Yuborish",
        fields: [
          { name: "title", label: "Sarlavha", type: "text", required: true },
          { name: "body", label: "Matn", type: "text", required: true },
          { name: "important", label: "Muhim xabar", type: "switch", value: "false" },
          { name: "pos", label: "Lavozimlar (bo'sh — hammaga)", type: "items", columns: [{ name: "position", label: "Lavozim", type: "select", options: positions.map((p) => ({ value: p, label: p })) }] },
        ],
      };
    }
    case "davomat-sozlama": {
      const f = await getLateFine();
      return {
        key, title: "Kechikish jarimasi", submitLabel: "Saqlash",
        fields: [
          { name: "isActive", label: "Jarima yoqilgan", type: "switch", value: f?.isActive ? "true" : "false" },
          { name: "mode", label: "Hisoblash usuli", type: "select", required: true, value: f?.perMinute ? "minute" : "day", options: [{ value: "day", label: "Har kechikkan kun uchun" }, { value: "minute", label: "Har kechikkan daqiqa uchun" }] },
          { name: "amount", label: "Summa, so'm", type: "number", required: true, value: f ? String(f.amount) : undefined },
          { name: "graceMinutes", label: "Imtiyoz, daqiqa", type: "number", required: true, value: String(f?.graceMinutes ?? 0), hint: "Shuncha daqiqagacha kechikish hisoblanmaydi" },
          { name: "maxPerMonth", label: "Oyiga ko'pi bilan, so'm", type: "number", value: f?.maxPerMonth != null ? String(f.maxPerMonth) : undefined },
          { name: "note", label: "Izoh", type: "text", value: f?.note ?? undefined },
        ],
      };
    }
  }
  throw new ListError("UNKNOWN_FORM", "Bunday forma yo'q", 404);
}

export async function kadrCreate(user: MobileUser, key: string, payload: unknown): Promise<CreateResult> {
  const p = (payload ?? {}) as Record<string, unknown>;
  const ok = (r: KadrResult) => { if ("error" in r) throw new Error(r.error); return r; };
  switch (key) {
    case "employees": {
      if (!may(user, "create")) forbid();
      const r = ok(await createEmployeeCore(actor(user), formData({ ...p, role: p.role === "auto" ? "" : p.role })));
      return { key: "employees", id: "id" in r ? r.id ?? "" : "", message: r.note ?? "Xodim qo'shildi" };
    }
    case "jarima-bonus": {
      if (!may(user, "payrules")) forbid();
      const r = ok(await addPayAdjustmentCore(user.id, formData({ ...p, amount: str(p, "amount").replace(/\s/g, "") })));
      return { key, id: "id" in r ? r.id ?? "" : "", message: r.note ?? "Yozildi" };
    }
    case "vakansiyalar": {
      if (!may(user, "recruit")) forbid();
      const n = (k: string) => { const v = str(p, k).replace(/\s/g, ""); return v ? Number(v) : null; };
      const headcount = Math.round(n("headcount") ?? 1);
      if (!str(p, "title") || !str(p, "position")) throw new Error("Vakansiya nomi va lavozimni kiriting");
      if (!(headcount >= 1 && headcount <= 500)) throw new Error("Kerakli odam soni 1–500");
      const r = await saveVacancy(null, { title: str(p, "title"), position: str(p, "position"), headcount, description: opt(p, "description"), requirements: opt(p, "requirements"), salaryFrom: n("salaryFrom"), salaryTo: n("salaryTo") }, user.id);
      if ("error" in r && r.error) throw new Error(r.error as string);
      return { key, id: "id" in r ? String(r.id ?? "") : "", message: "Vakansiya saqlandi" };
    }
    case "nomzodlar": {
      if (!may(user, "recruit")) forbid();
      const file = p.file ? dataUrlFile(str(p, "file"), "rezyume") : null;
      const saved = file ? await saveEmployeeFile("nomzod", file) : null;
      if (saved && "error" in saved) throw new Error(saved.error);
      const r = await saveCandidate(null, {
        vacancyId: opt(p, "vacancyId"), fullName: str(p, "fullName"), phone: opt(p, "phone"), source: opt(p, "source"),
        rating: str(p, "rating") ? Number(str(p, "rating")) : null, note: opt(p, "note"), file: saved ? { stored: saved.stored, name: saved.name, type: saved.type } : null,
      }, user.id);
      if ("error" in r) throw new Error(r.error as string);
      return { key, id: r.id!, message: "Nomzod qo'shildi" };
    }
    case "xabar": {
      if (!may(user, "voice")) forbid();
      const positions = Array.isArray(p.pos) ? [...new Set((p.pos as Record<string, unknown>[]).map((r) => String(r?.position ?? "").trim()).filter(Boolean))] : [];
      const r = await sendBroadcast({ title: str(p, "title"), body: str(p, "body"), positions, important: p.important === true || p.important === "true" }, user.id);
      if ("error" in r) throw new Error(r.error as string);
      return { key: "xabarlar", id: "", message: `${r.count} xodimga yuborildi` };
    }
    case "davomat-sozlama": {
      if (user.role !== "DIRECTOR" && user.perms?.employees === "none") forbid();
      const r = ok(await saveLateFineCore(user.id, formData({ ...p, amount: str(p, "amount").replace(/\s/g, ""), maxPerMonth: str(p, "maxPerMonth").replace(/\s/g, "") })));
      return { key, id: "", message: r.note ?? "Saqlandi" };
    }
  }
  throw new ListError("UNKNOWN_FORM", "Bunday forma yo'q", 404);
}

// ───────────────────────── Ariza — xodim nomidan (otdel kadr) ─────────────────────────

const onBehalf = (u: MobileUser) => (u.role === "HR" || u.role === "DIRECTOR") && canDo(u, "employees", "requests", ["HR"]);

/** "ariza" formasi otdel kadrga — boshida xodim tanlovi (veb «Xodim nomidan ariza kiritish»). Bo'sh — o'zim uchun. */
export async function kadrRequestForm<T extends { fields: FormField[] }>(user: MobileUser, form: T): Promise<T> {
  if (!onBehalf(user)) return form;
  const me = await db.employee.findFirst({ where: { userId: user.id }, select: { id: true } });
  const options = (await employeeOptions()).filter((o) => o.value !== me?.id);
  return {
    ...form,
    fields: [{ name: "employeeId", label: "Kim uchun", type: "select", value: "", options: [...(me ? [{ value: "", label: "O'zim uchun" }] : []), ...options], hint: "Qog'oz ariza yoki kasallik varaqasi keltirilganda — xodimni tanlang" } satisfies FormField, ...form.fields],
  };
}

/** "ariza" yuborish: xodim tanlangan bo'lsa — kadr uning nomidan (`createRequestForEmployee` bilan bir qoida), aks holda o'zi uchun. */
export async function kadrAriza(user: MobileUser, payload: unknown, self: () => Promise<CreateResult>): Promise<CreateResult> {
  const p = (payload ?? {}) as Record<string, unknown>;
  const employeeId = str(p, "employeeId");
  const mine = employeeId ? await db.employee.findFirst({ where: { userId: user.id }, select: { id: true } }) : null;
  if (!employeeId || mine?.id === employeeId) return self();
  if (!onBehalf(user)) forbid();
  const kind = str(p, "kind");
  if (!REQUEST_KINDS.includes(kind as HrRequestKind)) throw new Error("Ariza turini tanlang");
  const amount = str(p, "amount").replace(/[\s,]/g, "");
  const r = await createHrRequest({
    employeeId, kind: kind as HrRequestKind, dateFrom: opt(p, "dateFrom") ?? today(), dateTo: opt(p, "dateTo"),
    amount: amount ? Number(amount) : null, reason: opt(p, "reason"), clientToken: opt(p, "clientToken"),
  }, user.id);
  if (r.error) throw new Error(r.error);
  return { key: "arizalar", id: r.id!, message: r.existed ? `${r.docNo} allaqachon kiritilgan` : `${r.docNo} kiritildi — ${REQUEST_KIND[kind as HrRequestKind].label}, endi tasdiqlashingiz mumkin` };
}

// ───────────────────────── Nomzod kartasi: suhbat va qabul ─────────────────────────

/** `hr-people.ts` nomzod kartasiga — «Suhbat belgilash» va «Ishga qabul qilish» (veb nomzod sahifasi bilan bir xil). */
export async function kadrCandidateActions(user: MobileUser, c: Pick<CandidateRow, "stage" | "vacancy">): Promise<DetailAction[]> {
  if (!may(user, "recruit") || c.stage === "HIRED" || c.stage === "REJECTED") return [];
  const [users, emps, positions] = await Promise.all([
    db.user.findMany({ where: { isActive: true, role: { notIn: ["DRIVER", "BRIGADIER", "AGENT", "SUPERADMIN"] } }, orderBy: { fullName: "asc" }, select: { id: true, fullName: true } }),
    employeeOptions(),
    positionOptions(c.vacancy?.position ?? null, { departments: false }),
  ]);
  return [
    {
      id: "cand.interview", label: "Suhbat belgilash", tone: "brand",
      form: [
        { name: "date", label: "Sana", type: "date", required: true, value: today() },
        { name: "time", label: "Soat", type: "time", required: true, value: "10:00" },
        { name: "place", label: "Joy", type: "text" },
        { name: "interviewerId", label: "Suhbatchi", type: "select", options: users.map((u) => ({ value: u.id, label: u.fullName })), hint: "Bo'sh — otdel kadr o'zi" },
      ],
    },
    {
      id: "cand.hire", label: "Ishga qabul qilish", tone: "success",
      form: [
        { name: "position", label: "Lavozim", type: "select", required: true, value: c.vacancy?.position ?? undefined, options: positions },
        { name: "hiredAt", label: "Ishga kirish sanasi (kk.oo.yyyy)", type: "text", required: true, value: d2(dayUtc(today())) },
        { name: "mentorId", label: "Murabbiy", type: "select", options: emps },
        { name: "probationMonths", label: "Sinov muddati, oy", type: "number", value: "3" },
      ],
    },
  ];
}

// ───────────────────────── Bosh sahifa (otdel kadr) ─────────────────────────

const DAY = 86_400_000;
/**
 * Veb `dashboard/hr-home.tsx` bilan bir xil: bugungi davomat (keldi / kelmadi / belgilanmagan), 14 kunlik tug'ilgan
 * kunlar, 30 kun ichida muddati tugaydigan haydovchilik guvohnomalari va muddatli mehnat shartnomalari.
 */
export async function kadrHome(): Promise<{ cards: HomeCard[]; sections: HomeSection[] }> {
  const now = new Date(); now.setHours(0, 0, 0, 0);
  const in30 = new Date(now.getTime() + 30 * DAY);
  const [active, marks, birthdays, licenses, contracts] = await Promise.all([
    db.employee.count({ where: { isActive: true } }),
    db.attendance.groupBy({ by: ["status"], where: { date: dayUtc(today()), employee: { isActive: true } }, _count: { _all: true } }),
    db.employee.findMany({ where: { isActive: true, birthDate: { not: null } }, select: { id: true, fullName: true, position: true, birthDate: true, phone: true } }),
    db.employee.findMany({ where: { isActive: true, licenseExpiry: { lt: in30 } }, orderBy: { licenseExpiry: "asc" }, select: { id: true, fullName: true, position: true, licenseNo: true, licenseExpiry: true } }),
    db.hrDocument.findMany({ where: { kind: "SHARTNOMA", fixedTerm: true, termUntil: { lt: in30 }, employee: { isActive: true } }, orderBy: { termUntil: "asc" }, select: { id: true, no: true, termUntil: true, employee: { select: { id: true, fullName: true, position: true } } } }),
  ]);
  const cnt = new Map(marks.map((m) => [m.status, m._count._all]));
  const present = cnt.get("PRESENT") ?? 0, absent = cnt.get("ABSENT") ?? 0;
  const marked = [...cnt.values()].reduce((s, v) => s + v, 0);
  const unmarked = Math.max(0, active - marked);
  const bdays = birthdays.map((e) => ({ ...e, inDays: daysToAnniversary(e.birthDate!) })).filter((e) => e.inDays <= 14).sort((a, b) => a.inDays - b.inDays);
  const last = new Map<string, (typeof contracts)[number]>();
  for (const c of contracts) { const prev = last.get(c.employee.id); if (!prev || (c.termUntil && prev.termUntil && c.termUntil > prev.termUntil)) last.set(c.employee.id, c); }
  const ending = [...last.values()];
  const left = (d: Date) => Math.floor((d.getTime() - now.getTime()) / DAY);
  const leftText = (d: number) => (d < 0 ? `${-d} kun o'tdi` : d === 0 ? "bugun" : `${d} kun`);
  const leftTone = (d: number): Tone => (d < 0 ? "danger" : d <= 7 ? "warning" : "info");
  const tabel = { key: "tabel" };
  return {
    cards: [
      { key: "today-came", label: "Bugun keldi", value: String(present), hint: active ? `${Math.round((present / active) * 100)}% xodim` : "—", tone: "success", icon: "user-check", open: tabel },
      { key: "today-absent", label: "Bugun kelmadi (sababsiz)", value: String(absent), hint: `ta'til/kasal/dam: ${marked - present - absent}`, tone: absent ? "danger" : "info", icon: "user-x", open: tabel },
      { key: "today-unmarked", label: "Bugun belgilanmagan", value: String(unmarked), hint: "davomat hali qo'yilmagan", tone: unmarked ? "warning" : "info", icon: "calendar-days", open: tabel },
      { key: "docs-expiring", label: "Muddati yaqin hujjat", value: String(licenses.length + ending.length), hint: `${licenses.length} guvohnoma · ${ending.length} shartnoma`, tone: licenses.length + ending.length ? "warning" : "info", icon: "triangle-alert" },
    ],
    sections: [
      { title: "Tug'ilgan kunlar (14 kun)", empty: "Yaqin 14 kunda tug'ilgan kun yo'q", target: "employees", rows: bdays.map((e) => ({ id: e.id, title: e.fullName, subtitle: `${e.position}${e.phone ? ` · ${e.phone}` : ""}`, right: e.inDays === 0 ? "Bugun" : e.inDays === 1 ? "Ertaga" : `${e.inDays} kundan keyin`, tone: (e.inDays === 0 ? "success" : "info") as Tone })) },
      ...(licenses.length ? [{ title: "Haydovchilik guvohnomalari (30 kun)", empty: "", target: "employees", rows: licenses.map((e) => { const d = left(e.licenseExpiry!); return { id: e.id, title: e.fullName, subtitle: `${e.position}${e.licenseNo ? ` · ${e.licenseNo}` : ""} · ${d2(e.licenseExpiry!)}`, right: leftText(d), tone: leftTone(d) }; }) }] : []),
      ...(ending.length ? [{ title: "Muddatli shartnomalar (30 kun)", empty: "", target: "employees", rows: ending.map((c) => { const d = left(new Date(c.termUntil!.getUTCFullYear(), c.termUntil!.getUTCMonth(), c.termUntil!.getUTCDate())); return { id: c.employee.id, title: c.employee.fullName, subtitle: `${c.employee.position}${c.no ? ` · № ${c.no}` : ""} · ${d2(c.termUntil!)} gacha`, right: leftText(d), tone: leftTone(d) }; }) }] : []),
    ],
  };
}
