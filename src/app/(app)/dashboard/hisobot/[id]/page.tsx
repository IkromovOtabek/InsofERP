import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getCompany } from "@/lib/company";
import { PRODUCTION_HOME_ROLES } from "@/lib/production-day";
import { loadReport, reportHistory } from "@/lib/production-report";
import { dateTime } from "@/lib/format";
import { PrintButton } from "@/components/print-button";
import { BackLink } from "@/components/ui";
import { ReportSheet } from "../report-sheet";
import { DailySheet } from "../daily-sheet";
import { ReportHistory } from "../history";

/** Qayd etilgan (muzlatilgan) kunlik hisobot. Direktor ochganda "ko'rildi" belgilanadi. */
export default async function SavedReportPage({ params }: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s || !(s.role === "DIRECTOR" || (PRODUCTION_HOME_ROLES as readonly string[]).includes(s.role))) redirect("/dashboard?denied=1");
  const { id } = await params;
  const [rep, company, history] = await Promise.all([loadReport(id, s), getCompany(), reportHistory(20)]);
  if (!rep) notFound();

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="paper min-w-0 rounded-sm bg-white p-4 sm:p-8 text-[12.5px] text-black print:max-w-none print:rounded-none print:p-0 print:shadow-none">
        <style>{`@media print { @page { size: A4; margin: 12mm } aside, nav, header, .no-print { display: none !important } body { background: #fff } }`}</style>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 print:hidden">
          <BackLink href="/dashboard/hisobot" label="Jonli hisobot" />
          <span className="rounded-md bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700">Qayd etilgan · {dateTime(rep.createdAt)}</span>
          <PrintButton />
        </div>
        <DailySheet m={rep.snap.daily} iso={rep.snap.iso} ym={rep.snap.ym} workDays={rep.snap.plan.workDays} elapsed={rep.snap.plan.elapsed} company={company.name} note={rep.note} stamp={<>topshirdi: {rep.by} · {dateTime(rep.createdAt)}</>} />
        <details className="mt-8 border-t border-slate-200 pt-3 print:hidden">
          <summary className="cursor-pointer text-sm font-medium text-slate-600">Batafsil hisobot — soatma-soat, yuklash, brak, davomat, sklad</summary>
          <div className="mt-4">
            {rep.note && <p className="mb-3 rounded border border-slate-300 bg-slate-50 px-3 py-2"><b>Izoh:</b> {rep.note}</p>}
            <ReportSheet r={rep.snap} company={company.name} stamp={<>Qayd etdi: {rep.by} · {dateTime(rep.createdAt)}</>} />
          </div>
        </details>
      </div>
      <div className="no-print print:hidden"><ReportHistory rows={history} current={rep.id} /></div>
    </div>
  );
}
