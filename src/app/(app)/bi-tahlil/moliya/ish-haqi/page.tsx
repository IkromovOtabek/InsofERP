import Link from "next/link";
import { Banknote, HandCoins, Receipt, Users } from "lucide-react";
import { biContext, BiPage } from "../../shell";
import { requirePage } from "@/lib/page-guard";
import { vedomost } from "@/lib/fin-report/vedomost";
import { PAYROLL_STATUS_BADGE, PAYROLL_STATUS_LABEL } from "@/lib/hr/labels";
import { fmtNum, moneyShort } from "@/lib/format";
import { Badge, EmptyState, StatCard, Table, Td, Th, Tr } from "@/components/ui";
import { ExcelButton } from "@/app/(app)/logistika/excel-button";
import { MonthBar, monthTitle, parseMonth } from "../../month-bar";
import type { PayrollStatus } from "@/generated/prisma";

export const dynamic = "force-dynamic";

/** «Oy uchun hisoblangan ish haqi (vedomost bo'yicha)» — guruhlar kesimida (`lib/fin-report/vedomost.ts`). */
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requirePage("/bi-tahlil/moliya/ish-haqi");
  const { sp, range } = await biContext(searchParams);
  const month = parseMonth(sp.oy);
  const v = await vedomost(month);
  const t = v.total;
  const base = "/bi-tahlil/moliya/ish-haqi";
  const N = ({ x, className }: { x: number | null; className?: string }) => (x == null || Math.abs(x) < 0.5 ? <span className="text-slate-300">—</span> : <span className={className}>{fmtNum(x)}</span>);

  return (
    <BiPage title="Moliya" subtitle="Oy uchun hisoblangan ish haqi — vedomost bo'yicha, guruhlar kesimida" tab="finance" range={range} period={false}>
      <div className="space-y-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-[17px] font-bold text-slate-900">Oy uchun hisoblangan ish haqi — {monthTitle(month)}</h2>
          {v.run && (
            <span className="flex items-center gap-2 text-[13px] text-slate-500">
              Manba: <Link href={`/ish-haqi/${v.run.id}`} className="font-medium text-slate-800 underline">{v.run.docNo}</Link>
              <Badge color={PAYROLL_STATUS_BADGE[v.run.status as PayrollStatus]}>{PAYROLL_STATUS_LABEL[v.run.status as PayrollStatus]}</Badge>
            </span>
          )}
        </div>
        <MonthBar base={base} month={month}>
          {v.run && <ExcelButton file={`Ish haqi vedomost ${month}`} sheets={[{ name: "Vedomost", rows: [...v.rows, { ...t, group: "Jami", kind: "", perUnit: null }].map((r) => ({
            Guruh: r.group, Turi: r.kind, "Xodimlar soni": r.people, "Hisoblangan (brutto)": r.gross, "Daromad solig'i 12%": r.tax, "Qo'lga": r.hand,
            "Ushlanmalar (jarima va b.)": r.deductions, "Avans berilgan": r.advance, "To'lanishi kerak (qoldiq)": r.toPay, "To'langan": r.paid, "Ishlab chiqarildi (dona)": r.units, "1 donaga ish haqi": r.perUnit,
          })) }]} />}
        </MonthBar>

        {!v.run ? (
          <EmptyState icon={Banknote} title="Bu oy uchun yakuniy hisob-kitob (vedomost) hali tuzilmagan"
            text={v.advanceRuns ? `Faqat avans hisob-kitobi bor (${v.advanceRuns} ta). Oy yakunida Ish haqi bo'limida «Oy yakuni» hisoblanadi.` : "Ish haqi bo'limida oy yakuni hisoblangach, shu yerda guruhlar bo'yicha ko'rinadi."} />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
              <StatCard label="Hisoblangan (brutto)" value={moneyShort(t.gross)} hint={`${fmtNum(t.people)} xodim`} icon={Users} tone="brand" />
              <StatCard label="Daromad solig'i" value={moneyShort(t.tax)} hint={`qo'lga ${moneyShort(t.hand)}`} icon={Receipt} />
              <StatCard label="Avans berilgan" value={moneyShort(t.advance)} hint={t.deductions ? `ushlanmalar ${moneyShort(t.deductions)}` : "oy davomida"} icon={HandCoins} />
              <StatCard label="To'lanishi kerak (qoldiq)" value={moneyShort(t.toPay)} hint={t.paid ? `to'langan ${moneyShort(t.paid)}` : "hali to'lanmagan"} icon={Banknote} tone={t.toPay > 0 ? "warning" : "success"} />
            </div>
            <Table>
              <thead>
                <tr>
                  <Th>Guruh</Th><Th>Turi</Th><Th right>Xodimlar soni</Th><Th right>Hisoblangan (brutto)</Th><Th right>Daromad solig&apos;i 12%</Th><Th right>Qo&apos;lga</Th>
                  <Th right>Ushlanmalar</Th><Th right>Avans berilgan</Th><Th right className="text-amber-700">To&apos;lanishi kerak (qoldiq)</Th><Th right>To&apos;langan</Th><Th right>Ishlab chiqarildi (dona)</Th><Th right>1 donaga ish haqi</Th>
                </tr>
              </thead>
              <tbody>
                {v.rows.map((r) => (
                  <Tr key={r.group}>
                    <Td className="min-w-48">{r.group}</Td>
                    <Td><Badge color={r.kind === "Ma'muriy" ? "violet" : r.kind === "Kunbay" ? "amber" : "blue"} dot={false}>{r.kind}</Badge></Td>
                    <Td right>{fmtNum(r.people)}</Td>
                    <Td right className="font-semibold text-slate-900"><N x={r.gross} /></Td>
                    <Td right><N x={r.tax} /></Td>
                    <Td right><N x={r.hand} /></Td>
                    <Td right><N x={r.deductions} className="text-red-600" /></Td>
                    <Td right><N x={r.advance} /></Td>
                    <Td right className="bg-amber-50/50 font-semibold text-slate-900"><N x={r.toPay} /></Td>
                    <Td right><N x={r.paid} className="text-emerald-700" /></Td>
                    <Td right><N x={r.units} /></Td>
                    <Td right><N x={r.perUnit} /></Td>
                  </Tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-slate-50 font-bold text-slate-900 [&>td]:whitespace-nowrap [&>td]:border-t-2 [&>td]:border-slate-200 [&>td]:px-4 [&>td]:py-3 [&>td]:tabular [&>td:nth-child(n+3)]:text-right">
                  <td colSpan={2}>Jami</td><td>{fmtNum(t.people)}</td><td>{fmtNum(t.gross)}</td><td>{fmtNum(t.tax)}</td><td>{fmtNum(t.hand)}</td><td>{fmtNum(t.deductions)}</td>
                  <td>{fmtNum(t.advance)}</td><td>{fmtNum(t.toPay)}</td><td>{fmtNum(t.paid)}</td><td>{t.units != null ? fmtNum(t.units) : "—"}</td><td />
                </tr>
              </tfoot>
            </Table>
            <p className="text-[13px] text-slate-500">Qo&apos;lga = hisoblangan − daromad solig&apos;i. To&apos;lanishi kerak = qo&apos;lga − ushlanmalar − avans − to&apos;langan. 1 donaga ish haqi — brigada hisoblangani / oyda bajargan mahsuloti (topshiriqlar bo&apos;yicha).</p>
          </>
        )}
      </div>
    </BiPage>
  );
}
