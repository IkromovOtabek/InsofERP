import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { getSession } from "@/lib/auth";
import { getCompany } from "@/lib/company";
import { PRODUCTION_HOME_ROLES } from "@/lib/production-day";
import { buildReport, reportHistory } from "@/lib/production-report";
import { dayTitle, shiftDay, today, validDay } from "@/lib/davomat";
import { dateTime } from "@/lib/format";
import { PrintButton } from "@/components/print-button";
import { ReportSheet } from "./report-sheet";
import { SaveReportForm } from "../production-forms";
import { ReportHistory } from "./history";

/**
 * Direktorga kunlik ishlab chiqarish hisoboti — bitta varaq, chop etish / PDF uchun.
 * Bu jonli ko'rinish (raqamlar hozir hisoblanadi); "Qayd etish" bosilganda shu varaq
 * saqlanadi va direktor kabinetidagi tarixga tushadi (`/dashboard/hisobot/[id]`).
 */
export default async function ReportPage({ searchParams }: { searchParams: Promise<{ kun?: string }> }) {
  const s = await getSession();
  if (!s || !(s.role === "DIRECTOR" || (PRODUCTION_HOME_ROLES as readonly string[]).includes(s.role))) redirect("/dashboard?denied=1");
  const iso = validDay((await searchParams).kun) ?? today();
  const [r, company, history] = await Promise.all([buildReport(iso), getCompany(), reportHistory(20)]);
  const isToday = iso === today();
  const saved = history.filter((h) => h.iso === iso);

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="paper min-w-0 rounded-sm bg-white p-4 sm:p-8 text-[12.5px] text-black print:max-w-none print:rounded-none print:p-0 print:shadow-none">
        <style>{`@media print { @page { size: A4; margin: 12mm } aside, nav, header, .no-print { display: none !important } body { background: #fff } }`}</style>

        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 print:hidden">
          <Link href="/dashboard" className="text-sm text-slate-500 hover:text-slate-900">← Bosh sahifa</Link>
          <div className="flex items-center gap-1 text-sm">
            <Link href={`?kun=${shiftDay(iso, -1)}`} className="rounded-md p-1.5 hover:bg-slate-100" aria-label="Oldingi kun"><ChevronLeft size={16} /></Link>
            <span className="px-2 font-medium">{dayTitle(iso)}</span>
            {!isToday && <Link href={`?kun=${shiftDay(iso, 1)}`} className="rounded-md p-1.5 hover:bg-slate-100" aria-label="Keyingi kun"><ChevronRight size={16} /></Link>}
          </div>
          <PrintButton />
        </div>

        {s.role !== "DIRECTOR" && (
          <div className="mb-5 rounded-lg border border-brand-200 bg-brand-50/60 p-3 print:hidden">
            <div className="mb-2 text-[13px] text-slate-700">
              {saved.length
                ? <>Bu kun uchun hisobot <b>{saved.length} marta</b> qayd etilgan (oxirgisi {dateTime(saved[0].createdAt)}). Qayta qayd etsangiz yangi nusxa saqlanadi — oldingisi tarixda qoladi.</>
                : <>Raqamlarni tekshirib, <b>&quot;Qayd etish&quot;</b> ni bosing — hisobot saqlanadi va direktor kabinetiga tushadi.</>}
              {" "}Soatma-soat qism 08:00 dan tugma bosilgan daqiqagacha yoziladi — brigadirlar belgilagan to&apos;xtash va muammolar bilan.
            </div>
            <SaveReportForm iso={iso} />
          </div>
        )}

        <ReportSheet r={r} company={company.name} stamp={<>Jonli ko&apos;rinish · {dateTime(new Date())} · {s.fullName}</>} />
      </div>

      <div className="no-print print:hidden">
        <ReportHistory rows={history} current={null} />
      </div>
    </div>
  );
}
