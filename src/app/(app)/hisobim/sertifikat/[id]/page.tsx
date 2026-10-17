import { notFound } from "next/navigation";
import { requirePage } from "@/lib/page-guard";
import { canDo } from "@/lib/permissions";
import { certificate } from "@/lib/hr/training";
import { getCompany } from "@/lib/company";
import { date } from "@/lib/format";

/** Sertifikat (chop etish) — egasi yoki otdel kadr ko'radi. */
export default async function CertificatePage({ params }: { params: Promise<{ id: string }> }) {
  const s = await requirePage("/hisobim");
  const { id } = await params;
  const c = await certificate(id);
  if (!c || (c.employee.userId !== s.userId && !canDo(s, "employees", "training", ["HR"]))) notFound();
  const company = await getCompany();
  return (
    <div className="mx-auto max-w-3xl rounded-2xl border-4 border-double border-slate-300 bg-white p-10 text-center shadow-sm print:border-slate-400 print:shadow-none">
      <div className="text-sm uppercase tracking-[0.3em] text-slate-500">{company.legalName ?? company.name}</div>
      <h1 className="mt-6 text-4xl font-bold tracking-tight text-slate-900">Sertifikat</h1>
      <div className="mt-2 text-sm text-slate-500">№ {c.certificateNo}</div>
      <p className="mt-8 text-slate-600">Ushbu sertifikat</p>
      <div className="mt-2 text-2xl font-semibold text-slate-900">{c.employee.fullName}</div>
      <div className="text-sm text-slate-500">{c.employee.position}</div>
      <p className="mt-6 text-slate-600">«{c.course.title}» kursini muvaffaqiyatli tamomlagani va test sinovidan {c.bestScore}% natija bilan o&apos;tganini tasdiqlaydi.</p>
      <div className="mt-10 flex justify-between text-sm text-slate-600">
        <div className="text-left">Berilgan sana<div className="font-medium text-slate-900">{c.passedAt ? date(c.passedAt) : "—"}</div></div>
        {c.expiresAt && <div className="text-right">Amal qiladi<div className="font-medium text-slate-900">{date(c.expiresAt)} gacha</div></div>}
      </div>
      <div className="mt-10 border-t border-slate-200 pt-4 text-sm text-slate-500">Rahbar: {company.directorName ?? "________________"}</div>
    </div>
  );
}
