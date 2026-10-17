import Link from "next/link";
import { BookOpen, Briefcase, GraduationCap, UserPlus, Users } from "lucide-react";
import { db } from "@/lib/db";
import type { Session } from "@/lib/auth";
import { canDo } from "@/lib/permissions";
import { date, money } from "@/lib/format";
import { isoDay, shiftDay, today } from "@/lib/davomat";
import { listCandidates } from "@/lib/hr/recruit";
import { listPlans, stepsOf, stepsToText, DEFAULT_STEPS } from "@/lib/hr/onboarding";
import { courseStats } from "@/lib/hr/training";
import { PIPELINE, PROBATION_BADGE, PROBATION_LABEL, STAGE_LABEL, VACANCY_STATUS_BADGE, VACANCY_STATUS_LABEL } from "@/lib/hr/labels";
import { Badge, Card, CardHeader, Empty, Progress, StatCard, Table, Td, Th, Tr } from "@/components/ui";
import { cn } from "@/lib/utils";
import { CandidateForm, CourseForm, CourseToggle, OnbTemplateForm, ProbationForm, StartPlanForm, StepToggle, VacancyForm, VacancyRowActions } from "./hr3-forms";

type Emp = { id: string; fullName: string; position: string };

// ───────────────────────── Yollash ─────────────────────────

export async function YollashTab({ s, positions, vakansiya }: { s: Session; positions: string[]; vakansiya?: string }) {
  const editable = canDo(s, "employees", "recruit", ["HR"]);
  const [vacancies, candidates] = await Promise.all([
    db.vacancy.findMany({ orderBy: [{ status: "asc" }, { createdAt: "desc" }], include: { _count: { select: { candidates: true } }, candidates: { where: { stage: "HIRED" }, select: { id: true } } } }),
    listCandidates({ vacancyId: vakansiya || null }),
  ]);
  const open = vacancies.filter((v) => v.status === "OPEN");
  const vacOpts = vacancies.filter((v) => v.status !== "CLOSED").map((v) => ({ id: v.id, label: `${v.title} · ${v.position}` }));
  const by = (st: string) => candidates.filter((c) => c.stage === st);
  const href = (v?: string) => `/otdel-kadr?tab=yollash${v ? `&vakansiya=${v}` : ""}`;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Ochiq vakansiya" value={String(open.length)} icon={Briefcase} hint={`${open.reduce((x, v) => x + v.headcount - v.candidates.length, 0)} o'rin bo'sh`} />
        <StatCard label="Jarayondagi nomzod" value={String(candidates.filter((c) => PIPELINE.includes(c.stage)).length)} icon={Users} />
        <StatCard label="Zaxira kadr" value={String(by("RESERVE").length)} />
        <StatCard label="Qabul qilingan" value={String(by("HIRED").length)} tone="success" />
      </div>

      <Card padded={false}>
        <div className="border-b border-slate-100 px-4 py-3"><h2 className="text-sm font-semibold">Vakansiyalar</h2></div>
        <Table>
          <thead><tr><Th>Vakansiya</Th><Th>Lavozim</Th><Th right>Kerak / qabul</Th><Th right>Maosh</Th><Th>Holat</Th><Th right /></tr></thead>
          <tbody>
            {vacancies.length === 0 && <Empty text="Vakansiya yo'q" />}
            {vacancies.map((v) => (
              <Tr key={v.id} className={v.status === "CLOSED" ? "opacity-60" : ""}>
                <Td className="font-medium"><Link href={href(v.id)} className="hover:underline">{v.title}</Link><div className="text-xs font-normal text-slate-500">{v._count.candidates} nomzod · {date(v.createdAt)}</div></Td>
                <Td>{v.position}</Td>
                <Td right>{v.headcount} / {v.candidates.length}</Td>
                <Td right className="text-sm">{v.salaryFrom || v.salaryTo ? `${v.salaryFrom ? money(Number(v.salaryFrom)) : ""}${v.salaryTo ? ` – ${money(Number(v.salaryTo))}` : ""}` : "—"}</Td>
                <Td><Badge color={VACANCY_STATUS_BADGE[v.status]}>{VACANCY_STATUS_LABEL[v.status]}</Badge></Td>
                <Td right>{editable && <VacancyRowActions status={v.status} positions={positions} v={{ id: v.id, title: v.title, position: v.position, headcount: v.headcount, description: v.description, requirements: v.requirements, salaryFrom: v.salaryFrom == null ? null : Number(v.salaryFrom), salaryTo: v.salaryTo == null ? null : Number(v.salaryTo) }} />}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
        {editable && <div className="border-t border-slate-100 p-4"><VacancyForm positions={positions} /></div>}
      </Card>

      <div className="flex flex-wrap items-center gap-1 text-sm">
        <span className="mr-1 text-slate-500">Nomzodlar:</span>
        <Link href={href()} className={cn("rounded-md px-2.5 py-1", !vakansiya ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100")}>Hammasi</Link>
        {vacancies.filter((v) => v.status !== "CLOSED").map((v) => (
          <Link key={v.id} href={href(v.id)} className={cn("rounded-md px-2.5 py-1", vakansiya === v.id ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100")}>{v.title}</Link>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        {PIPELINE.map((st) => (
          <div key={st} className="rounded-(--radius-card) border border-slate-200 bg-slate-50/60 p-2">
            <div className="mb-2 flex justify-between px-1 text-sm font-semibold text-slate-700">{STAGE_LABEL[st]}<span className="text-xs font-normal text-slate-500">{by(st).length}</span></div>
            <div className="space-y-2">
              {by(st).length === 0 && <div className="px-1 py-4 text-center text-xs text-slate-400">bo&apos;sh</div>}
              {by(st).map((c) => {
                const next = c.interviews.find((i) => i.result === "PENDING");
                return (
                  <Link key={c.id} href={`/otdel-kadr/nomzod/${c.id}`} className="block rounded-lg border border-slate-200 bg-white p-2.5 shadow-xs hover:border-slate-300">
                    <div className="text-sm font-medium">{c.fullName}{c.rating ? <span className="ml-1 text-xs text-amber-600">{"★".repeat(c.rating)}</span> : null}</div>
                    <div className="text-[11px] text-slate-500">{c.vacancy?.title ?? "vakansiyasiz"}{c.source ? ` · ${c.source}` : ""}</div>
                    {next && <div className="mt-1 text-[11px] text-amber-700">Suhbat: {next.at.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</div>}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {(["RESERVE", "HIRED", "REJECTED"] as const).map((st) => (
          <Card key={st} padded={false}>
            <div className="border-b border-slate-100 px-4 py-2 text-sm font-semibold">{STAGE_LABEL[st]} ({by(st).length})</div>
            <ul className="divide-y divide-slate-100 text-sm">
              {by(st).slice(0, 15).map((c) => (
                <li key={c.id} className="flex justify-between gap-2 px-4 py-2">
                  <Link href={`/otdel-kadr/nomzod/${c.id}`} className="hover:underline">{c.fullName}</Link>
                  <span className="truncate text-xs text-slate-500">{st === "REJECTED" ? c.rejectReason : c.vacancy?.title ?? ""}</span>
                </li>
              ))}
              {by(st).length === 0 && <li className="px-4 py-3 text-xs text-slate-400">yo&apos;q</li>}
            </ul>
          </Card>
        ))}
      </div>
      {editable && (
        <Card>
          <CardHeader title="Yangi nomzod" icon={UserPlus} />
          <CandidateForm vacancies={vacOpts} />
        </Card>
      )}
    </div>
  );
}

// ───────────────────────── Moslashuv ─────────────────────────

export async function MoslashuvTab({ s, employees, positions, holat }: { s: Session; employees: Emp[]; positions: string[]; holat?: string }) {
  const editable = canDo(s, "employees", "onboarding", ["HR"]);
  const st = holat === "ALL" ? "ALL" : "open";
  const [plans, templates, planned] = await Promise.all([
    listPlans({ status: st }),
    db.onboardingTemplate.findMany({ orderBy: { createdAt: "asc" } }),
    db.onboardingPlan.findMany({ select: { employeeId: true } }),
  ]);
  const has = new Set(planned.map((p) => p.employeeId));
  const empOpts = employees.map((e) => ({ id: e.id, label: `${e.fullName} · ${e.position}` }));
  const now = today();
  const soon = shiftDay(now, 7);
  return (
    <div className="space-y-4">
      <div className="flex gap-1 text-sm">
        <Link href="/otdel-kadr?tab=moslashuv" className={cn("rounded-md px-2.5 py-1", st === "open" ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100")}>Sinov muddatida</Link>
        <Link href="/otdel-kadr?tab=moslashuv&holat=ALL" className={cn("rounded-md px-2.5 py-1", st === "ALL" ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100")}>Hammasi</Link>
      </div>
      {plans.length === 0 && <Card><Empty text="Moslashuv rejasi yo'q" /></Card>}
      {plans.map((p) => {
        const end = p.probationEnd ? isoDay(p.probationEnd) : null;
        return (
          <Card key={p.id}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <Link href={`/employees/${p.employee.id}`} className="font-semibold hover:underline">{p.employee.fullName}</Link>
                <div className="text-xs text-slate-500">{p.employee.position} · boshlandi {date(p.startDate)}{p.mentorName ? ` · murabbiy ${p.mentorName}` : ""}</div>
              </div>
              <div className="text-right">
                <Badge color={PROBATION_BADGE[p.status]}>{PROBATION_LABEL[p.status]}</Badge>
                {end && <div className={cn("mt-1 text-xs", (p.status === "ACTIVE" || p.status === "EXTENDED") && end <= soon ? "font-semibold text-red-600" : "text-slate-500")}>Sinov tugaydi: {date(p.probationEnd!)}</div>}
              </div>
            </div>
            <div className="mt-3"><Progress value={p.progress.done} max={p.progress.total || 1} tone={p.progress.late ? "warning" : "success"} /></div>
            <div className="mt-1 text-xs text-slate-500">{p.progress.done} / {p.progress.total} qadam{p.progress.late ? ` · ${p.progress.late} ta muddati o'tgan` : ""}</div>
            <details className="mt-2">
              <summary className="cursor-pointer text-sm text-slate-600">Qadamlar</summary>
              <div className="mt-2 space-y-1.5">
                {p.steps.map((x) => (
                  <div key={x.id} className="flex items-center justify-between gap-2">
                    {editable ? <StepToggle id={x.id} done={!!x.doneAt} label={x.title} /> : <span className="text-sm">{x.title}</span>}
                    <span className="text-xs text-slate-400">{date(new Date(`${shiftDay(isoDay(p.startDate), x.dueDay)}T00:00:00Z`))}</span>
                  </div>
                ))}
              </div>
            </details>
            {editable && (p.status === "ACTIVE" || p.status === "EXTENDED") && <div className="mt-3 border-t border-slate-100 pt-3"><ProbationForm planId={p.id} /></div>}
            {p.result && <div className="mt-2 text-xs text-slate-500">Natija: {p.result}</div>}
          </Card>
        );
      })}
      {editable && (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <Card>
            <CardHeader title="Mavjud xodimga reja ochish" icon={UserPlus} description="Nomzod «Ishga qabul qilish» bilan kelsa — reja o'zi ochiladi" />
            <StartPlanForm employees={empOpts.filter((e) => !has.has(e.id))} />
          </Card>
          <Card>
            <CardHeader title="Moslashuv shablonlari" icon={BookOpen} description="Lavozimga mos shablon bo'lmasa — umumiy, u ham bo'lmasa standart qadamlar" />
            <div className="space-y-4">
              {templates.map((t) => <OnbTemplateForm key={t.id} positions={positions} t={{ id: t.id, name: t.name, position: t.position, text: stepsToText(stepsOf(t.steps)) }} />)}
              <details>
                <summary className="cursor-pointer text-sm text-brand-700">+ Yangi shablon</summary>
                <div className="mt-2"><OnbTemplateForm positions={positions} t={{ id: "", name: "Umumiy moslashuv", position: null, text: stepsToText(DEFAULT_STEPS) }} /></div>
              </details>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

// ───────────────────────── O'qitish ─────────────────────────

export async function OqitishTab({ s, positions }: { s: Session; positions: string[] }) {
  const editable = canDo(s, "employees", "training", ["HR"]);
  const courses = await courseStats();
  return (
    <div className="space-y-4">
      <Card padded={false}>
        <div className="border-b border-slate-100 px-4 py-3"><h2 className="text-sm font-semibold">Kurslar</h2><p className="text-xs text-slate-500">Xodim kursni «Mening hisobim» yoki ilovada o&apos;qiydi va test topshiradi; o&apos;tsa — sertifikat</p></div>
        <Table>
          <thead><tr><Th>Kurs</Th><Th>Lavozim</Th><Th right>Savol</Th><Th right>Topshirmagan</Th><Th right>O&apos;tdi</Th><Th right>O&apos;tmadi</Th><Th right /></tr></thead>
          <tbody>
            {courses.length === 0 && <Empty text="Kurs hali yo'q" />}
            {courses.map((c) => (
              <Tr key={c.id} className={c.isActive ? "" : "opacity-50"}>
                <Td className="font-medium"><Link href={`/otdel-kadr/kurs/${c.id}`} className="hover:underline">{c.title}</Link>{c.mandatory && <span className="ml-2"><Badge color="red">majburiy</Badge></span>}<div className="text-xs font-normal text-slate-500">o&apos;tish {c.passScore}%{c.validMonths ? ` · sertifikat ${c.validMonths} oy` : ""}</div></Td>
                <Td>{c.position ?? "—"}</Td>
                <Td right>{c.questionsCount}</Td>
                <Td right className={c.assigned ? "text-amber-700" : ""}>{c.assigned}</Td>
                <Td right className="text-emerald-700">{c.passed}</Td>
                <Td right className="text-red-700">{c.failed}</Td>
                <Td right>{editable && <CourseToggle id={c.id} active={c.isActive} />}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </Card>
      {editable && (
        <Card>
          <CardHeader title="Yangi kurs" icon={GraduationCap} />
          <CourseForm positions={positions} />
        </Card>
      )}
    </div>
  );
}
