import Link from "next/link";
import { notFound } from "next/navigation";
import { UserPlus } from "lucide-react";
import { db } from "@/lib/db";
import { requirePage, requireRoles } from "@/lib/page-guard";
import { canDo } from "@/lib/permissions";
import { date } from "@/lib/format";
import { enrollmentsOf, questionsOf, questionsToText } from "@/lib/hr/training";
import { ENROLL_STATUS_BADGE, ENROLL_STATUS_LABEL } from "@/lib/hr/labels";
import { Badge, Card, CardHeader, Empty, PageHeader, StatCard, Table, Td, Th, Tr } from "@/components/ui";
import { AssignForm, CourseForm } from "../../hr3-forms";

/** Kurs: kimga biriktirilgan, natijalar, sertifikatlar; biriktirish va tahrir. */
export default async function CoursePage({ params }: { params: Promise<{ id: string }> }) {
  await requirePage("/otdel-kadr");
  const s = await requireRoles(["HR"], { module: "employees" });
  const { id } = await params;
  const c = await db.course.findUnique({ where: { id } });
  if (!c) notFound();
  const editable = canDo(s, "employees", "training", ["HR"]);
  const [rows, employees] = await Promise.all([
    enrollmentsOf(id),
    db.employee.findMany({ where: { isActive: true }, orderBy: { fullName: "asc" }, select: { id: true, fullName: true, position: true } }),
  ]);
  const enrolled = new Set(rows.map((r) => r.employeeId));
  const positions = [...new Set(employees.map((e) => e.position))].sort();
  const now = new Date().toISOString().slice(0, 10);
  return (
    <div className="space-y-4">
      <PageHeader back={{ href: "/otdel-kadr?tab=oqitish", label: "O'qitish" }} eyebrow="Kurs" title={c.title} subtitle={`${questionsOf(c.questions).length} savol · o'tish ${c.passScore}%${c.validMonths ? ` · sertifikat ${c.validMonths} oy` : ""}${c.isActive ? "" : " · o'chirilgan"}`} />
      <div className="grid grid-cols-3 gap-3">
        <StatCard label="Topshirmagan" value={String(rows.filter((r) => r.status === "ASSIGNED").length)} tone="warning" href="#natijalar" />
        <StatCard label="O'tdi" value={String(rows.filter((r) => r.status === "PASSED").length)} tone="success" href="#natijalar" />
        <StatCard label="O'tmadi" value={String(rows.filter((r) => r.status === "FAILED").length)} tone="danger" href="#natijalar" />
      </div>
      <Card padded={false}>
        <div id="natijalar" className="scroll-mt-20" />
        <Table>
          <thead><tr><Th>Xodim</Th><Th>Holat</Th><Th right>Eng yaxshi ball</Th><Th right>Urinish</Th><Th>Sertifikat</Th><Th>Muddat</Th></tr></thead>
          <tbody>
            {rows.length === 0 && <Empty text="Hali hech kimga biriktirilmagan" />}
            {rows.map((r) => {
              const expired = !!r.expiresAt && r.expiresAt.toISOString().slice(0, 10) < now;
              return (
                <Tr key={r.id}>
                  <Td className="font-medium"><Link href={`/employees/${r.employee.id}`} className="hover:underline">{r.employee.fullName}</Link><div className="text-xs font-normal text-slate-500">{r.employee.position}</div></Td>
                  <Td><Badge color={expired ? "red" : ENROLL_STATUS_BADGE[r.status]}>{expired ? "Muddati o'tgan" : ENROLL_STATUS_LABEL[r.status]}</Badge></Td>
                  <Td right>{r.bestScore != null ? `${r.bestScore}%` : "—"}</Td>
                  <Td right>{r.attempts}</Td>
                  <Td>{r.certificateNo ? <Link href={`/hisobim/sertifikat/${r.id}`} target="_blank" className="text-brand-700 hover:underline">{r.certificateNo}</Link> : "—"}{r.expiresAt && <div className="text-xs text-slate-500">{date(r.expiresAt)} gacha</div>}</Td>
                  <Td className="text-sm">{r.dueDate ? date(r.dueDate) : "—"}</Td>
                </Tr>
              );
            })}
          </tbody>
        </Table>
      </Card>
      {editable && c.isActive && (
        <Card>
          <CardHeader title="Biriktirish" icon={UserPlus} />
          <AssignForm courseId={c.id} positions={positions} employees={employees.filter((e) => !enrolled.has(e.id)).map((e) => ({ id: e.id, label: `${e.fullName} · ${e.position}` }))} />
        </Card>
      )}
      {editable && (
        <Card>
          <CardHeader title="Kursni tahrirlash" />
          <CourseForm positions={positions} c={{ id: c.id, title: c.title, description: c.description, material: c.material, contentUrl: c.contentUrl, position: c.position, mandatory: c.mandatory, questionsText: questionsToText(questionsOf(c.questions)), passScore: c.passScore, validMonths: c.validMonths }} />
        </Card>
      )}
    </div>
  );
}
