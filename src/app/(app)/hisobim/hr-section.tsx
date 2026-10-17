import Link from "next/link";
import { CalendarRange, ClipboardList, GraduationCap, MessageSquare, Handshake, Inbox, ListChecks, ListTodo, Target, Wallet } from "lucide-react";
import { myCourses } from "@/lib/hr/training";
import { myPlans, progressOf } from "@/lib/hr/onboarding";
import { MyStep } from "./step-toggle";
import { FeedbackForm, SurveyAnswerForm } from "./voice-forms";
import { listFeedback, mySurveys } from "@/lib/hr/voice";
import { db } from "@/lib/db";
import { myChecklists } from "@/lib/hr/checklists";
import { kpiMonth } from "@/lib/hr/kpi";
import { CheckForm } from "./check-form";
import { date, money } from "@/lib/format";
import { dayUtc, isoDay, monthTitle, shiftDay, today } from "@/lib/davomat";
import { employeeOfUser, listHrRequests, periodText } from "@/lib/hr/requests";
import { plansInRange } from "@/lib/hr/shifts";
import { breakdownOf, myLines } from "@/lib/hr/payroll";
import { ENROLL_STATUS_BADGE, ENROLL_STATUS_LABEL, PROBATION_LABEL, PAYROLL_KIND_LABEL, PAYROLL_STATUS_BADGE, PAYROLL_STATUS_LABEL, REQUEST_KIND, REQUEST_STATUS_BADGE, REQUEST_STATUS_LABEL } from "@/lib/hr/labels";
import { Badge, Card, CardHeader, Empty, Progress, Table, Td, Th, Tr } from "@/components/ui";
import { CancelOwnButton, RequestForm } from "../otdel-kadr/arizalar-forms";
import { cancelMyRequest, sendMyRequest } from "./hr-actions";

const WD = ["Yak", "Dush", "Sesh", "Chor", "Pay", "Jum", "Shan"];

/**
 * "Mening hisobim" — xodimning o'z kadr ma'lumotlari: smena grafigi (2 hafta), arizalari (yuborish va holati) va
 * tasdiqlangan ish haqi hisob-kitoblari. Login xodim kartasiga bog'lanmagan bo'lsa — ko'rsatilmaydi.
 */
export async function MyHrSection({ userId }: { userId: string }) {
  const emp = await employeeOfUser(userId);
  if (!emp || !emp.isActive) return null;
  const from = today(), to = shiftDay(from, 13);
  const [plans, requests, lines, checklists, kpi, tasks, courses, onb, surveys, feedback] = await Promise.all([
    plansInRange([{ id: emp.id, workSchedule: emp.workSchedule }], from, to),
    listHrRequests({ employeeId: emp.id, status: "ALL", take: 20 }),
    myLines(emp.id, 12),
    myChecklists(emp),
    kpiMonth(from.slice(0, 7), { employeeIds: [emp.id] }),
    db.workTask.groupBy({ by: ["status"], where: { assigneeId: emp.id, status: { in: ["TODO", "IN_PROGRESS", "REVIEW"] } }, _count: { _all: true } }),
    myCourses(emp.id),
    myPlans(emp.id),
    mySurveys(emp),
    listFeedback({ authorUserId: userId, status: "ALL" }),
  ]);
  const openTasks = tasks.reduce((x, t) => x + t._count._all, 0);
  const plan = plans.get(emp.id)!;
  return (
    <div className="mt-5 grid max-w-5xl grid-cols-1 gap-4 xl:grid-cols-2">
      {surveys.filter((x) => !x.answered).map((x) => (
        <Card key={x.id}>
          <CardHeader title={`So'rovnoma: ${x.title}`} icon={ClipboardList} description={`${x.anonymous ? "Anonim — javobingiz ismsiz saqlanadi" : "Ismli"}${x.description ? ` · ${x.description}` : ""}`} />
          <SurveyAnswerForm id={x.id} questions={x.questions} anonymous={x.anonymous} />
        </Card>
      ))}
      <Card>
        <CardHeader title="Otdel kadrga murojaat" icon={MessageSquare} description="Savol, taklif yoki shikoyat — xohlasangiz anonim" />
        <FeedbackForm />
        {feedback.length > 0 && (
          <ul className="mt-4 divide-y divide-slate-100 border-t border-slate-100 text-sm">
            {feedback.slice(0, 10).map((f) => (
              <li key={f.id} className="flex items-center justify-between gap-2 py-2">
                <Link href={`/hisobim/murojaat/${f.id}`} className="hover:underline">{f.subject}{f.anonymous ? <span className="ml-1 text-xs text-slate-500">· anonim</span> : null}</Link>
                <Badge color={f.status === "RESOLVED" ? "green" : f.status === "NEW" ? "amber" : "blue"}>{f.status === "RESOLVED" ? "Hal qilindi" : f.status === "NEW" ? "Yangi" : "Javob bor"}</Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {[...(onb.own && (onb.own.status === "ACTIVE" || onb.own.status === "EXTENDED") ? [{ p: onb.own, mine: true }] : []), ...onb.mentees.map((p) => ({ p, mine: false }))].map(({ p, mine }) => (
        <Card key={p.id}>
          <CardHeader title={mine ? "Moslashuv rejam" : `Shogird: ${p.employee.fullName}`} icon={Handshake}
            description={`${PROBATION_LABEL[p.status]}${p.probationEnd ? ` · sinov ${date(p.probationEnd)} gacha` : ""} · ${progressOf(p).done}/${progressOf(p).total}`} />
          <div className="space-y-1.5">{p.steps.map((x) => <MyStep key={x.id} id={x.id} done={!!x.doneAt} label={x.title} />)}</div>
        </Card>
      ))}
      {courses.length > 0 && (
        <Card padded={false}>
          <div className="border-b border-slate-100 px-4 py-3"><h2 className="flex items-center gap-2 text-sm font-semibold"><GraduationCap size={15} /> Kurslarim</h2></div>
          <ul className="divide-y divide-slate-100">
            {courses.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                <Link href={`/hisobim/kurs/${c.course.id}`} className="font-medium hover:underline">{c.course.title}{c.course.mandatory && <span className="ml-1 text-xs text-red-600">· majburiy</span>}</Link>
                <span className="flex items-center gap-2">
                  {c.dueDate && c.status !== "PASSED" && <span className="text-xs text-slate-500">{date(c.dueDate)} gacha</span>}
                  <Badge color={c.expired ? "red" : ENROLL_STATUS_BADGE[c.status]}>{c.expired ? "Muddati o'tgan" : ENROLL_STATUS_LABEL[c.status]}{c.bestScore != null ? ` · ${c.bestScore}%` : ""}</Badge>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {checklists.map((c) => (
        <Card key={c.templateId}>
          <CardHeader title={`Bugungi cheklist: ${c.name}`} icon={ListChecks} description={`${c.doneCount} / ${c.total} bajarildi`} />
          <CheckForm templateId={c.templateId} items={c.items} />
        </Card>
      ))}
      <Card>
        <CardHeader title={`KPI — ${monthTitle(from.slice(0, 7))}`} icon={Target} description={kpi.length ? `Mukofot: ${money(kpi.reduce((x, k) => x + k.reward, 0))} (oy yakunida ish haqiga)` : "Sizga KPI belgilanmagan"} />
        {kpi.map((k) => (
          <div key={k.metricId} className="mb-2">
            <div className="flex justify-between text-sm"><span>{k.name}</span><span className="tabular text-slate-600">{k.fact ?? "—"} / {k.target} {k.unit}{k.pct != null ? ` · ${k.pct}%` : ""}</span></div>
            <Progress value={Math.min(k.pct ?? 0, 100)} max={100} tone={(k.pct ?? 0) >= 100 ? "success" : k.reward ? "warning" : "danger"} />
          </div>
        ))}
        <Link href="/vazifalar" className="mt-2 inline-flex items-center gap-1.5 text-sm text-brand-700 hover:underline"><ListTodo size={15} /> Vazifalarim: {openTasks} ta ochiq</Link>
      </Card>
      <Card>
        <CardHeader title="Smena grafigim" icon={CalendarRange} description="Keyingi 2 hafta — kechikish shu grafik bo'yicha hisoblanadi" />
        <div className="grid grid-cols-7 gap-1 text-center text-xs">
          {[...plan.entries()].map(([iso, p]) => (
            <div key={iso} className={`rounded-md border px-1 py-1.5 ${p.off ? "border-slate-100 bg-slate-50 text-slate-400" : "border-sky-100 bg-sky-50 text-sky-900"} ${iso === from ? "ring-2 ring-brand-400" : ""}`}>
              <div className="font-medium">{WD[dayUtc(iso).getUTCDay()]} {iso.slice(8, 10)}</div>
              <div>{p.off ? "Dam" : `${p.start}–${p.end}`}</div>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <CardHeader title="Ariza yuborish" icon={Inbox} description="Ta'til, kasallik, dam olish kuni, avans yoki kechikish sababi — otdel kadr ko'rib chiqadi" />
        <RequestForm action={sendMyRequest} />
      </Card>

      <Card padded={false}>
        <div className="border-b border-slate-100 px-4 py-3"><h2 className="text-sm font-semibold">Arizalarim</h2></div>
        <Table>
          <thead><tr><Th>Ariza</Th><Th>Turi</Th><Th>Holat</Th><Th right /></tr></thead>
          <tbody>
            {requests.length === 0 && <Empty text="Ariza yo'q" />}
            {requests.map((r) => (
              <Tr key={r.id}>
                <Td className="font-medium">{r.docNo}<div className="text-xs font-normal text-slate-500">{date(r.createdAt)}</div></Td>
                <Td>{REQUEST_KIND[r.kind].label}<div className="text-xs text-slate-500">{r.dateFrom && r.dateTo ? periodText(isoDay(r.dateFrom), isoDay(r.dateTo)) : r.amount ? money(Number(r.amount)) : ""}</div></Td>
                <Td><Badge color={REQUEST_STATUS_BADGE[r.status]}>{REQUEST_STATUS_LABEL[r.status]}</Badge>{r.decisionNote && <div className="mt-1 text-xs text-slate-500">{r.decisionNote}</div>}</Td>
                <Td right>{r.status === "PENDING" && <CancelOwnButton action={cancelMyRequest.bind(null, r.id)} />}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </Card>

      <Card padded={false}>
        <div className="border-b border-slate-100 px-4 py-3"><h2 className="flex items-center gap-2 text-sm font-semibold"><Wallet size={15} /> Ish haqim</h2><p className="text-xs text-slate-500">Direktor tasdiqlagan hisob-kitoblar</p></div>
        <Table>
          <thead><tr><Th>Oy</Th><Th right>Hisoblangan</Th><Th right>Ushlanma</Th><Th right>Qo&apos;lga</Th><Th>Holat</Th></tr></thead>
          <tbody>
            {lines.length === 0 && <Empty text="Hali hisob-kitob yo'q" />}
            {lines.map((l) => {
              const b = breakdownOf(l.breakdown);
              const ded = Number(l.incomeTax) + Number(l.penalty) + Number(l.advanceDeducted);
              return (
                <Tr key={l.id}>
                  <Td className="font-medium">
                    {monthTitle(l.run.month)} · {PAYROLL_KIND_LABEL[l.run.kind]}
                    {b && l.run.kind === "FINAL" && (
                      <details className="text-xs font-normal text-slate-600">
                        <summary className="cursor-pointer text-slate-500">Tafsilot</summary>
                        <div>Keldi {b.presentDays}/{b.normDays} kun · ta&apos;til {b.paidLeaveDays} · kasal {b.sickDays}</div>
                        <div>Asosiy {money(Number(l.base))}{Number(l.leavePay) ? ` · ta'til ${money(Number(l.leavePay))}` : ""}{Number(l.sickPay) ? ` · kasallik ${money(Number(l.sickPay))}` : ""}{Number(l.bonus) ? ` · bonus ${money(Number(l.bonus))}` : ""}</div>
                        <div>JShDS {money(Number(l.incomeTax))}{Number(l.penalty) ? ` · jarima ${money(Number(l.penalty))}` : ""}{Number(l.advanceDeducted) ? ` · avans ${money(Number(l.advanceDeducted))}` : ""}</div>
                        {b.rules.map((h) => <div key={h.rule}>{h.rule}: {h.detail}</div>)}
                        {b.manual.map((m) => <div key={m.id}>{m.kind === "BONUS" ? "Bonus" : "Jarima"}: {m.reason}</div>)}
                      </details>
                    )}
                  </Td>
                  <Td right>{money(Number(l.gross))}</Td>
                  <Td right>{ded ? money(ded) : "—"}</Td>
                  <Td right className="font-semibold">{money(Number(l.net))}</Td>
                  <Td>{l.paidAt ? <Badge color="green">Berildi {date(l.paidAt)}</Badge> : <Badge color={PAYROLL_STATUS_BADGE[l.run.status]}>{PAYROLL_STATUS_LABEL[l.run.status]}</Badge>}</Td>
                </Tr>
              );
            })}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}
