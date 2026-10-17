import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarClock, FileText, UserCheck } from "lucide-react";
import { db } from "@/lib/db";
import { requirePage, requireRoles } from "@/lib/page-guard";
import { canDo } from "@/lib/permissions";
import { dateTime } from "@/lib/format";
import { formatPhone } from "@/lib/phone";
import { getCandidate } from "@/lib/hr/recruit";
import { INTERVIEW_RESULT_LABEL, STAGE_BADGE, STAGE_LABEL } from "@/lib/hr/labels";
import { Badge, Callout, Card, CardHeader, DL, PageHeader, Table, Td, Th, Tr, Empty } from "@/components/ui";
import { CandidateForm, HireForm, InterviewForm, InterviewResultForm, StageButtons } from "../../hr3-forms";

/** Nomzod kartasi: ma'lumot, bosqich, suhbatlar, ishga qabul. */
export default async function CandidatePage({ params }: { params: Promise<{ id: string }> }) {
  await requirePage("/otdel-kadr");
  const s = await requireRoles(["HR"], { module: "employees" });
  const { id } = await params;
  const c = await getCandidate(id);
  if (!c) notFound();
  const editable = canDo(s, "employees", "recruit", ["HR"]);
  const [vacancies, users, employees] = await Promise.all([
    db.vacancy.findMany({ where: { status: { not: "CLOSED" } }, select: { id: true, title: true, position: true } }),
    db.user.findMany({ where: { isActive: true, role: { notIn: ["DRIVER", "BRIGADIER", "AGENT", "SUPERADMIN"] } }, orderBy: { fullName: "asc" }, select: { id: true, fullName: true } }),
    db.employee.findMany({ where: { isActive: true }, orderBy: { fullName: "asc" }, select: { id: true, fullName: true, position: true } }),
  ]);
  const vacOpts = [...vacancies, ...(c.vacancy && !vacancies.some((v) => v.id === c.vacancy!.id) ? [c.vacancy] : [])].map((v) => ({ id: v.id, label: `${v.title} · ${v.position}` }));
  const open = !["HIRED", "REJECTED"].includes(c.stage);
  return (
    <div className="space-y-4">
      <PageHeader back={{ href: "/otdel-kadr?tab=yollash", label: "Yollash" }} eyebrow="Nomzod" title={c.fullName}
        subtitle={`${c.vacancy?.title ?? "Vakansiyasiz"}${c.source ? ` · ${c.source}` : ""}`} action={<Badge color={STAGE_BADGE[c.stage]}>{STAGE_LABEL[c.stage]}</Badge>} />
      {c.stage === "HIRED" && c.employeeId && <Callout tone="success" title="Ishga qabul qilingan"><Link href={`/employees/${c.employeeId}`} className="underline">Xodim kartasini ochish</Link></Callout>}
      {c.stage === "REJECTED" && <Callout tone="danger" title="Rad etilgan">{c.rejectReason}</Callout>}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_1.3fr]">
        <Card>
          <DL items={[
            { k: "Telefon", v: c.phone ? <a href={`tel:${c.phone}`} className="hover:underline">{formatPhone(c.phone)}</a> : "—" },
            { k: "Baho", v: c.rating ? "★".repeat(c.rating) : "—" },
            { k: "Bosqichda", v: dateTime(c.stageAt) },
            { k: "Qo'shilgan", v: dateTime(c.createdAt) },
            { k: "Rezyume", v: c.file ? <a href={`/otdel-kadr/nomzod/${c.id}/fayl`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand-700 hover:underline"><FileText size={14} /> {c.fileName}</a> : "—" },
          ]} />
          {c.note && <p className="mt-3 whitespace-pre-wrap text-sm text-slate-700">{c.note}</p>}
          {editable && c.stage !== "HIRED" && <div className="mt-4 border-t border-slate-100 pt-3"><StageButtons id={c.id} stage={c.stage} /></div>}
        </Card>
        <Card padded={false}>
          <div className="border-b border-slate-100 px-4 py-3"><h2 className="flex items-center gap-2 text-sm font-semibold"><CalendarClock size={15} /> Suhbatlar</h2></div>
          <Table>
            <thead><tr><Th>Vaqti</Th><Th>Suhbatchi</Th><Th>Natija va xulosa</Th></tr></thead>
            <tbody>
              {c.interviews.length === 0 && <Empty text="Suhbat belgilanmagan" />}
              {c.interviews.map((i) => (
                <Tr key={i.id}>
                  <Td className="whitespace-nowrap text-sm">{dateTime(i.at)}<div className="text-xs text-slate-500">{i.place ?? ""}</div></Td>
                  <Td className="text-sm">{i.interviewerName ?? "Kadr"}</Td>
                  <Td>{editable ? <InterviewResultForm id={i.id} candidateId={c.id} result={i.result} feedback={i.feedback} /> : <>{INTERVIEW_RESULT_LABEL[i.result]}{i.feedback ? ` · ${i.feedback}` : ""}</>}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
          {editable && open && <div className="border-t border-slate-100 p-4"><InterviewForm candidateId={c.id} users={users.map((u) => ({ id: u.id, label: u.fullName }))} /></div>}
        </Card>
      </div>
      {editable && open && (
        <Card>
          <CardHeader title="Ishga qabul qilish" icon={UserCheck} />
          <HireForm id={c.id} position={c.vacancy?.position ?? ""} employees={employees.map((e) => ({ id: e.id, label: `${e.fullName} · ${e.position}` }))} />
          <datalist id="hr-positions">{[...new Set(employees.map((e) => e.position))].map((p) => <option key={p} value={p} />)}</datalist>
        </Card>
      )}
      {editable && c.stage !== "HIRED" && (
        <Card>
          <CardHeader title="Ma'lumotni tahrirlash" />
          <CandidateForm vacancies={vacOpts} c={{ id: c.id, vacancyId: c.vacancyId, fullName: c.fullName, phone: c.phone, source: c.source, rating: c.rating, note: c.note }} />
        </Card>
      )}
    </div>
  );
}
