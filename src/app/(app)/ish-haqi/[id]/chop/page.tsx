import { notFound } from "next/navigation";
import { requirePage } from "@/lib/page-guard";
import { getCompany } from "@/lib/company";
import { fmtNum, dateTime } from "@/lib/format";
import { monthTitle } from "@/lib/davomat";
import { numWords } from "@/lib/num-words";
import { runSheet } from "@/lib/hr/vedomost-sheet";
import { PrintButton } from "@/components/print-button";
import { AutoPrint } from "@/components/auto-print";
import { BackLink } from "@/components/ui";

/**
 * To'lov vedomosti (chop etish) — Excel «Аванс наличка» / «Зарплата» varaqlari kabi: bo'limlar bo'yicha F.I.O., summa va
 * imzo ustuni, jami so'z bilan, imzolar. `?tur=naqd` — naqd qismi (avansda — hammasi), `?tur=plastik` — plastik qismi.
 */
export default async function PayrollPrintPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tur?: string; print?: string }> }) {
  await requirePage("/ish-haqi");
  const { id } = await params;
  const sp = await searchParams;
  const [sh, company] = await Promise.all([runSheet(id), getCompany()]);
  if (!sh) notFound();
  const card = sp.tur === "plastik";
  const amountOf = (v: { cash: number; card: number }) => Math.round(card ? v.card : v.cash);
  const groups = sh.groups.map((g) => ({ label: g.label, rows: g.rows.filter((r) => amountOf(r.v) > 0) })).filter((g) => g.rows.length);
  const total = groups.reduce((s, g) => s + g.rows.reduce((t, r) => t + amountOf(r.v), 0), 0);
  const what = sh.run.kind === "ADVANCE" ? "avans" : sh.run.kind === "EXTRA" ? "alohida to'lov" : "ish haqi";
  const words = numWords(total);
  let no = 0;
  return (
    <div className="paper mx-auto max-w-[210mm] bg-white p-8 text-black print:max-w-none print:p-0">
      <AutoPrint enabled={sp.print === "1"} />
      <style>{`@media print { @page { size: A4 portrait; margin: 10mm } aside, nav, header { display: none } body { background: #fff } tr { break-inside: avoid } }`}</style>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <BackLink href={`/ish-haqi/${sh.run.id}`} label={sh.run.docNo} />
        <PrintButton />
      </div>
      <div className="text-[13px] font-bold">{company.legalName ?? company.name}</div>
      <h1 className="mt-2 text-center text-[16px] font-bold uppercase">To&apos;lov vedomosti № {sh.run.docNo}</h1>
      <div className="text-center text-[13px]">{monthTitle(sh.run.month)} uchun {what} — {card ? "plastik kartaga" : "naqd"}</div>
      <table className="mt-4 w-full border-collapse text-[12.5px]">
        <thead>
          <tr className="bg-slate-100">
            <th className="w-10 border border-black px-1 py-1">№</th>
            <th className="border border-black px-2 py-1 text-left">F.I.O.</th>
            <th className="w-36 border border-black px-2 py-1 text-right">Summa, so&apos;m</th>
            <th className="w-40 border border-black px-2 py-1">Imzo</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => [
            <tr key={`g-${g.label}`}><td colSpan={4} className="border border-black bg-slate-50 px-2 py-0.5 text-center font-semibold">{g.label}</td></tr>,
            ...g.rows.map((r) => (
              <tr key={r.lineId} className="h-7">
                <td className="border border-black px-1 text-center">{++no}</td>
                <td className="border border-black px-2">{r.fullName}</td>
                <td className="border border-black px-2 text-right tabular-nums">{fmtNum(amountOf(r.v))}</td>
                <td className="border border-black" />
              </tr>
            )),
          ])}
          {groups.length === 0 && <tr><td colSpan={4} className="border border-black px-2 py-4 text-center text-slate-500">{card ? "Plastik qismi yo'q" : "To'lanadigan summa yo'q"}</td></tr>}
        </tbody>
        <tfoot>
          <tr className="font-bold"><td className="border border-black" /><td className="border border-black px-2 py-1">Jami ({no} kishi)</td><td className="border border-black px-2 text-right tabular-nums">{fmtNum(total)}</td><td className="border border-black" /></tr>
        </tfoot>
      </table>
      <div className="mt-2 text-[12px] italic">Jami so&apos;z bilan: {words.charAt(0).toUpperCase() + words.slice(1)} so&apos;m</div>
      <div className="mt-8 grid grid-cols-2 gap-x-10 gap-y-6 text-[12.5px]">
        {["Direktor", "Bosh buxgalter", "Hisobchi", "Kassir"].map((r) => (
          <div key={r}>{r}: <span className="inline-block w-40 border-b border-black align-baseline" /></div>
        ))}
      </div>
      <div className="mt-6 text-[10px] text-slate-500">Chop etildi: {dateTime(new Date())}</div>
    </div>
  );
}
