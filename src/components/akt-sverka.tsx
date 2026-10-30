import Link from "next/link";
import { type Akt } from "@/lib/fin-report/akt";
import { dateRu, dateShort, fmtFixed, isoDate } from "@/lib/format";
import { PrintButton } from "@/components/print-button";
import { BackLink } from "@/components/ui";

/**
 * Akt sverka hujjati — «Insof 2026» jadvalidagi «Akt sverka» varag'i ko'rinishida (chop etish / PDF uchun).
 * Hisob `lib/fin-report/akt.ts` da; bu yerda faqat ko'rinish. Xaridor va ta'minotchi uchun bitta shablon.
 * Qog'oz hujjat — ranglar hex bilan (dark rejim tokenlari ag'darmasin).
 */

const NAVY = "#2c4a6e";
const SOFT = "#dde7f3";

type Company = { name: string; legalName: string | null; directorName: string | null };

const n = (v: number) => (Math.abs(v) < 0.005 ? "" : fmtFixed(v));

/** Davr tanlash, orqaga va chop etish — hujjat tepasida, chop etishda yashirinadi. */
export function AktToolbar({ akt, back }: { akt: Akt; back: { href: string; label: string } }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3 print:hidden">
      <form method="get" className="flex flex-wrap items-end gap-2 text-sm">
        <label className="flex flex-col text-xs text-slate-500">Davr boshi<input name="dan" type="date" defaultValue={isoDate(akt.from)} max={isoDate(new Date())} className="h-9 rounded-lg border border-slate-200 px-2 text-sm text-slate-900" /></label>
        <label className="flex flex-col text-xs text-slate-500">Davr oxiri<input name="gacha" type="date" defaultValue={isoDate(akt.to)} max={isoDate(new Date())} className="h-9 rounded-lg border border-slate-200 px-2 text-sm text-slate-900" /></label>
        <button className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium hover:bg-slate-50">Ko&apos;rsatish</button>
      </form>
      <div className="flex items-center gap-3">
        <BackLink href={back.href} label={back.label} />
        <PrintButton />
      </div>
    </div>
  );
}

export function AktSverkaDoc({ akt, company }: { akt: Akt; company: Company }) {
  const us = company.legalName ?? company.name;
  const director = company.directorName?.trim() || null;
  const party = akt.name;
  const cell = "px-3 py-2.5";
  const sum = "px-3 py-2.5 text-right tabular-nums whitespace-nowrap";
  const opening = akt.opening, closing = akt.closing;
  // Saldo: musbat — ular bizga qarz (debet), manfiy — biz ularga qarzmiz (kredit)
  const debt = closing > 0.005 ? `${dateRu(akt.to)} holatiga ${us} foydasiga qarzdorlik: ${fmtFixed(closing)} so'm.`
    : closing < -0.005 ? `${dateRu(akt.to)} holatiga ${us} ning ${party} oldidagi qarzdorligi: ${fmtFixed(-closing)} so'm.`
      : `${dateRu(akt.to)} holatiga tomonlar o'rtasida qarzdorlik yo'q.`;

  return (
    <div className="mx-auto max-w-4xl rounded-lg bg-[#fff] p-4 text-[14px] leading-relaxed text-[#000] sm:p-8 print:rounded-none print:p-0">
      <style>{`@media print { @page { size: A4; margin: 12mm } aside, nav, header { display: none } body { background: #fff } .akt-doc * { -webkit-print-color-adjust: exact; print-color-adjust: exact } }`}</style>
      <div className="akt-doc">
        <h1 className="text-center text-[24px] font-bold tracking-wide" style={{ color: NAVY }}>AKT SVERKA</h1>
        <div className="text-center italic">o&apos;zaro hisob-kitoblarni solishtirish dalolatnomasi, davr: {dateRu(akt.from)} - {dateRu(akt.to)}</div>
        <div className="mt-1 text-center text-[15px] font-bold">{us} va</div>
        <div className="text-center text-[15px] font-bold">{party} o&apos;rtasida</div>
        {akt.contractNo && <div className="text-center">Shartnoma № {akt.contractNo}</div>}

        <p className="mt-4">
          Biz, quyida imzo chekuvchilar, bir tomondan {us} direktori{director ? ` ${director}` : ""} va ikkinchi tomondan {party} direktori
          ushbu dalolatnomani tuzdik. Buxgalteriya hisobi ma&apos;lumotlariga ko&apos;ra o&apos;zaro hisob-kitoblar holati quyidagicha:
        </p>

        <div className="mt-6 overflow-x-auto">
          <table className="w-full min-w-[600px] border-collapse">
            <thead>
              <tr className="text-white" style={{ background: NAVY }}>
                <th className={`${cell} w-24 text-center font-bold`}>Sana</th>
                <th className={`${cell} text-center font-bold`}>Hujjat</th>
                <th className={`${cell} w-48 text-center font-bold`}>Debet</th>
                <th className={`${cell} w-48 text-center font-bold`}>Kredit</th>
              </tr>
            </thead>
            <tbody>
              <tr className="font-bold" style={{ background: SOFT, color: NAVY }}>
                <td className={cell} />
                <td className={cell}>Boshlang&apos;ich saldo</td>
                <td className={sum}>{opening > 0 ? n(opening) : ""}</td>
                <td className={sum}>{opening < 0 ? n(-opening) : ""}</td>
              </tr>
              {akt.lines.length === 0 && (
                <tr><td colSpan={4} className={`${cell} text-center text-[#666]`}>Davrda hujjat va to&apos;lov yo&apos;q</td></tr>
              )}
              {akt.lines.map((l, i) => (
                <tr key={i} className={i % 2 ? "bg-[#f1f1f1]" : "bg-[#fff]"}>
                  <td className={`${cell} text-center whitespace-nowrap`}>{dateShort(l.date)}</td>
                  <td className={cell}>{l.href ? <Link href={l.href} className="hover:underline print:no-underline">{l.doc}</Link> : l.doc}</td>
                  <td className={sum}>{n(l.debit)}</td>
                  <td className={sum}>{n(l.credit)}</td>
                </tr>
              ))}
              <tr className="font-bold" style={{ background: SOFT, color: NAVY }}>
                <td className={cell} />
                <td className={cell}>Davr aylanmasi</td>
                <td className={sum}>{fmtFixed(akt.debit)}</td>
                <td className={sum}>{fmtFixed(akt.credit)}</td>
              </tr>
              <tr className="font-bold" style={{ background: SOFT, color: NAVY }}>
                <td className={cell} />
                <td className={cell}>Yakuniy saldo</td>
                <td className={sum}>{closing > 0 ? n(closing) : ""}</td>
                <td className={sum}>{closing < 0 ? n(-closing) : ""}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="mt-12 px-1 sm:px-8">
          <div className="font-bold">{us} ma&apos;lumotlariga ko&apos;ra</div>
          <div className="mt-6 font-bold text-[#b42318]">{debt}</div>

          <div className="mt-10 grid grid-cols-2 gap-6 font-bold">
            <div className="space-y-1">
              <div>{us} nomidan</div>
              <div>Direktor <span className="inline-block w-36 border-b border-black align-bottom" />{director ? ` (${director})` : ""}</div>
              <div>M.O&apos;.</div>
            </div>
            <div className="space-y-1 text-right">
              <div>{party} nomidan</div>
              <div>Direktor <span className="inline-block w-36 border-b border-black align-bottom" /></div>
              <div>M.O&apos;.</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
