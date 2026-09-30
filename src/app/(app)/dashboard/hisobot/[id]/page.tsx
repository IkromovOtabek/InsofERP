import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getCompany } from "@/lib/company";
import { PRODUCTION_HOME_ROLES } from "@/lib/production-day";
import { loadReport, reportHistory } from "@/lib/production-report";
import { dateTime } from "@/lib/format";
import { PrintButton } from "@/components/print-button";
import { ReportSheet } from "../report-sheet";
import { ReportHistory } from "../history";

/** Qayd etilgan (muzlatilgan) kunlik hisobot. Direktor ochganda "ko'rildi" belgilanadi. */
export default async function SavedReportPage({ params }: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s || !(s.role === "DIRECTOR" || (PRODUCTION_HOME_ROLES as readonly string[]).includes(s.role))) redirect("/dashboard?denied=1");
  const { id } = await params;
  const [rep, company, history] = await Promise.all([loadReport(id, s), getCompany(), reportHistory(20)]);
  if (!rep) notFound();

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="paper rounded-sm bg-white p-8 text-[12.5px] text-black print:max-w-none print:rounded-none print:p-0 print:shadow-none">
        <style>{`@media print { @page { size: A4; margin: 12mm } aside, nav, header, .no-print { display: none !important } body { background: #fff } }`}</style>
        <div className="mb-4 flex items-center justify-between gap-2 print:hidden">
          <Link href="/dashboard/hisobot" className="text-sm text-slate-500 hover:text-slate-900">← Jonli hisobot</Link>
          <span className="rounded-md bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700">Qayd etilgan · {dateTime(rep.createdAt)}</span>
          <PrintButton />
        </div>
        {rep.note && <p className="mb-3 rounded border border-slate-300 bg-slate-50 px-3 py-2 print:bg-transparent"><b>Izoh:</b> {rep.note}</p>}
        <ReportSheet r={rep.snap} company={company.name} stamp={<>Qayd etdi: {rep.by} · {dateTime(rep.createdAt)}</>} />
      </div>
      <div className="no-print print:hidden"><ReportHistory rows={history} current={rep.id} /></div>
    </div>
  );
}
