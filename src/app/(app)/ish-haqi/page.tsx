import Link from "next/link";
import { Settings2, Wallet } from "lucide-react";
import { db } from "@/lib/db";
import { requirePage } from "@/lib/page-guard";
import { date, money } from "@/lib/format";
import { monthOf, monthTitle, today } from "@/lib/davomat";
import { canPayroll, listRuns, payrollSettings } from "@/lib/hr/payroll";
import { PAYROLL_KIND_LABEL, PAYROLL_STATUS_BADGE, PAYROLL_STATUS_LABEL } from "@/lib/hr/labels";
import { Badge, Callout, Card, CardHeader, Empty, PageHeader, StatCard, Table, Tabs, Td, Th, Tr } from "@/components/ui";
import { CalculateForm, PieceRatesForm, SettingsForm } from "./forms";

/**
 * Ish haqi: otdel kadr / buxgalteriya hisoblaydi, direktor tasdiqlaydi, kassir to'laydi (`lib/hr/payroll.ts`).
 * Har vedomost — oy uchun avans, oy yakuni yoki alohida to'lov (xodimning avans arizasi).
 */
export default async function PayrollPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const s = await requirePage("/ish-haqi");
  const { tab = "vedomostlar" } = await searchParams;
  const month = monthOf(today());
  const canCalc = canPayroll(s, "calc");
  const canSettings = canPayroll(s, "settings");

  const [runs, st, products] = await Promise.all([
    listRuns({ take: 80 }),
    payrollSettings(),
    tab === "sozlamalar" ? db.product.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true, unit: true, pieceRate: true } }) : Promise.resolve([]),
  ]);
  const waiting = runs.filter((r) => r.status === "SUBMITTED");
  const toPay = runs.filter((r) => r.status === "APPROVED");
  const thisMonth = runs.filter((r) => r.month === month && r.status !== "CANCELLED");

  return (
    <div className="space-y-4">
      <PageHeader title="Ish haqi" subtitle="Avans va oy yakuni vedomostlari: hisoblash → direktor tasdig'i → kassadan to'lov" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label={`${monthTitle(month)} — hisoblangan`} value={money(thisMonth.filter((r) => r.kind === "FINAL").reduce((x, r) => x + Number(r.gross), 0))} icon={Wallet} />
        <StatCard label="Direktor tasdig'ida" value={String(waiting.length)} tone={waiting.length ? "warning" : "default"} hint={waiting.length ? money(waiting.reduce((x, r) => x + Number(r.net), 0)) : undefined} />
        <StatCard label="To'lov kutmoqda" value={String(toPay.length)} tone={toPay.length ? "brand" : "default"} hint={toPay.length ? money(toPay.reduce((x, r) => x + Number(r.net) - Number(r.paid), 0)) : undefined} />
        <StatCard label={`${monthTitle(month)} — to'langan`} value={money(thisMonth.reduce((x, r) => x + Number(r.paid), 0))} />
      </div>
      <Tabs current={tab} items={[{ key: "vedomostlar", label: "Vedomostlar", href: "/ish-haqi", icon: Wallet }, { key: "sozlamalar", label: "Sozlamalar", href: "/ish-haqi?tab=sozlamalar", icon: Settings2 }]} />

      {tab === "vedomostlar" && (
        <>
          {canCalc && (
            <Card>
              <CardHeader title="Hisoblash" description={`Avans — 1–${st.advanceDay} kunlar bo'yicha, oylikning ${st.advancePct}%; oy yakuni — tabel, smena grafigi, ta'til/kasallik, jarima/bonus, soliq va berilgan avanslar bilan`} />
              <CalculateForm month={month} />
            </Card>
          )}
          <Card padded={false}>
            <Table>
              <thead><tr><Th>Vedomost</Th><Th>Oy</Th><Th>Turi</Th><Th right>Xodim</Th><Th right>Hisoblangan</Th><Th right>Qo&apos;lga</Th><Th right>To&apos;langan</Th><Th>Holat</Th></tr></thead>
              <tbody>
                {runs.length === 0 && <Empty text="Vedomost hali yo'q — yuqorida oy va turini tanlab hisoblang" />}
                {runs.map((r) => (
                  <Tr key={r.id} className={r.status === "CANCELLED" ? "opacity-50" : ""}>
                    <Td className="font-medium"><Link href={`/ish-haqi/${r.id}`} className="text-brand-700 hover:underline">{r.docNo}</Link><div className="text-xs font-normal text-slate-500">{date(r.createdAt)}{r.note ? ` · ${r.note}` : ""}</div></Td>
                    <Td>{monthTitle(r.month)}</Td>
                    <Td>{PAYROLL_KIND_LABEL[r.kind]}</Td>
                    <Td right>{r._count.lines}</Td>
                    <Td right>{money(Number(r.gross))}</Td>
                    <Td right className="font-medium">{money(Number(r.net))}</Td>
                    <Td right>{money(Number(r.paid))}</Td>
                    <Td><Badge color={PAYROLL_STATUS_BADGE[r.status]}>{PAYROLL_STATUS_LABEL[r.status]}</Badge></Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </Card>
        </>
      )}

      {tab === "sozlamalar" && (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <Card>
            <CardHeader title="Soliq, avans, kasallik" description="Barcha xodimlarga bir xil. O'zgarish keyingi hisobdan qo'llanadi — tasdiqlangan vedomostlar o'zgarmaydi" />
            <SettingsForm editable={canSettings} v={{
              incomeTaxPct: Number(st.incomeTaxPct), inpsPct: Number(st.inpsPct), socialTaxPct: Number(st.socialTaxPct), advancePct: st.advancePct, advanceDay: st.advanceDay,
              sickPctShort: st.sickPctShort, sickPctLong: st.sickPctLong, hoursPerDay: Number(st.hoursPerDay), vacationPaid: st.vacationPaid,
            }} />
          </Card>
          <Card>
            <CardHeader title="Sdelka narxlari" description="Brigada bajargan 1 birlik uchun ish haqi fondiga qo'shiladigan summa. Fond sdelkadagi a'zolarga ishlagan soati bo'yicha bo'linadi" />
            {products.length ? <PieceRatesForm editable={canSettings} products={products.map((p) => ({ id: p.id, name: p.name, unit: p.unit, pieceRate: p.pieceRate == null ? null : Number(p.pieceRate) }))} /> : <Empty text="Mahsulot yo'q" />}
          </Card>
          <Callout tone="info" title="Xodimning ish haqi turi">
            Oklad, kunbay, soatbay yoki sdelka — xodim kartasida («Ish haqi turi» va «Tarif stavka»). Jarima va bonus qoidalari — Otdel kadr → Jarima va bonuslar.
          </Callout>
        </div>
      )}
    </div>
  );
}
