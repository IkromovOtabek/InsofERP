import Link from "next/link";
import { notFound } from "next/navigation";
import { Award, ExternalLink } from "lucide-react";
import { requirePage } from "@/lib/page-guard";
import { employeeOfUser } from "@/lib/hr/requests";
import { courseForEmployee } from "@/lib/hr/training";
import { date } from "@/lib/format";
import { ENROLL_STATUS_BADGE, ENROLL_STATUS_LABEL } from "@/lib/hr/labels";
import { Badge, Card, CardHeader, PageHeader } from "@/components/ui";
import { TestForm } from "../../test-form";

/** Xodimning kursi: material va test (to'g'ri javoblarsiz). */
export default async function MyCoursePage({ params }: { params: Promise<{ id: string }> }) {
  const s = await requirePage("/hisobim");
  const { id } = await params;
  const emp = await employeeOfUser(s.userId);
  const data = emp ? await courseForEmployee(id, emp.id) : null;
  if (!data) notFound();
  const { course, enrollment: en } = data;
  return (
    <div className="space-y-4">
      <PageHeader back={{ href: "/hisobim", label: "Mening hisobim" }} eyebrow="Kurs" title={course.title} subtitle={course.description ?? undefined}
        action={<Badge color={ENROLL_STATUS_BADGE[en.status]}>{ENROLL_STATUS_LABEL[en.status]}{en.bestScore != null ? ` · ${en.bestScore}%` : ""}</Badge>} />
      {en.status === "PASSED" && en.certificateNo && (
        <Link href={`/hisobim/sertifikat/${en.id}`} className="inline-flex items-center gap-1.5 text-sm text-brand-700 hover:underline"><Award size={15} /> Sertifikat {en.certificateNo}{en.expiresAt ? ` · ${date(en.expiresAt)} gacha` : ""}</Link>
      )}
      {(course.material || course.contentUrl) && (
        <Card>
          <CardHeader title="Material" />
          {course.material && <div className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">{course.material}</div>}
          {course.contentUrl && <a href={course.contentUrl} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1 text-sm text-brand-700 hover:underline"><ExternalLink size={14} /> Video / hujjat</a>}
        </Card>
      )}
      <Card>
        <CardHeader title={`Test — ${course.questions.length} savol`} description={`O'tish bali ${course.passScore}%${en.attempts ? ` · urinishlar: ${en.attempts}` : ""}`} />
        <TestForm courseId={course.id} enrollmentId={en.id} questions={course.questions} />
      </Card>
    </div>
  );
}
