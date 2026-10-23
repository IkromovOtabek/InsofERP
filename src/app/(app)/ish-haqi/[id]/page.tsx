import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePage } from "@/lib/page-guard";
import { date, dateTime, money } from "@/lib/format";
import { hoursShort, monthTitle } from "@/lib/davomat";
import { breakdownOf, canPayroll, runWithLines } from "@/lib/hr/payroll";
import { payAccounts } from "@/lib/mechanic-requests";
import { PAY_TYPE_LABEL, PAYROLL_KIND_LABEL, PAYROLL_STATUS_BADGE, PAYROLL_STATUS_LABEL } from "@/lib/hr/labels";
import { Badge, Callout, Card, CardHeader, PageHeader, StatCard, StatusSteps, Table, Td, Th, Tr } from "@/components/ui";
import { PayForm, RunActions } from "../forms";

const STEPS = [{ key: "DRAFT", label: "Hisoblandi" }, { key: "SUBMITTED", label: "Direktor tasdig'ida" }, { key: "APPROVED", label: "Tasdiqlandi" }, { key: "PAID", label: "To'landi" }];

/** Vedomost: qatorlar (xodim bo'yicha hisob tafsiloti), tasdiq va kassadan to'lov. */
export default async function PayrollRunPage({ params }: { params: Promise<{ id: string }> }) {
  const s = await requirePage("/ish-haqi");
  const { id } = await params;
  const run = await runWithLines(id);
  if (!run) notFound();
  const canPay = canPayroll(s, "pay") && run.status === "APPROVED";
  const accounts = canPay ? await payAccounts() : [];
  const unpaid = run.lines.filter((l) => !l.paidAt && Number(l.net) > 0);
  const n = (v: unknown) => Number(v ?? 0);
  const final = run.kind === "FINAL";
  const sum = (k: "base" | "leavePay" | "sickPay" | "bonus" | "penalty" | "gross" | "incomeTax" | "inps" | "advanceDeducted" | "employerTax") => run.lines.reduce((x, l) => x + n(l[k]), 0);

  return (
    <div className="space-y-4">
      <PageHeader back={{ href: "/ish-haqi", label: "Ish haqi" }} title={`${run.docNo} · ${PAYROLL_KIND_LABEL[run.kind]}`} subtitle={`${monthTitle(run.month)} · ${run.lines.length} xodim${run.note ? ` · ${run.note}` : ""}`}
        action={<Badge color={PAYROLL_STATUS_BADGE[run.status]}>{PAYROLL_STATUS_LABEL[run.status]}</Badge>} />
      {run.status !== "CANCELLED" && <StatusSteps steps={STEPS} current={run.status} />}
      {run.rejectNote && run.status === "DRAFT" && <Callout tone="warning" title="Direktor qaytardi">{run.rejectNote}</Callout>}
      {run.status === "CANCELLED" && <Callout tone="danger" title="Bekor qilingan">{run.cancelReason}{run.cancelledAt ? ` · ${dateTime(run.cancelledAt)}` : ""}</Callout>}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Hisoblangan" value={money(n(run.gross))} />
        <StatCard label="Ushlanma (soliq, jarima, avans)" value={money(n(run.deductions))} />
        <StatCard label="Qo'lga" value={money(n(run.net))} tone="brand" />
        <StatCard label="To'langan" value={money(n(run.paid))} tone={n(run.paid) >= n(run.net) && n(run.net) > 0 ? "success" : "default"} hint={final ? `Ijtimoiy soliq (ish beruvchi): ${money(n(run.employerTax))}` : undefined} />
      </div>

      <RunActions id={run.id} status={run.status} kind={run.kind} net={n(run.net) - n(run.paid)} canCalc={canPayroll(s, "calc")} canApprove={canPayroll(s, "approve")} />

      {canPay && unpaid.length > 0 && (
        <Card>
          <CardHeader title="Kassadan to'lash" description="Har to'lov Kirim-Chiqimda «Ish haqi» chiqimi bo'lib yoziladi; kassa qoldig'i tekshiriladi" />
          <PayForm id={run.id} accounts={accounts} lines={unpaid.map((l) => ({ id: l.id, fullName: l.employee.fullName, net: n(l.net) }))} />
        </Card>
      )}

      <Card padded={false}>
        <Table>
          <thead>
            <tr>
              <Th>Xodim</Th><Th>Turi / stavka</Th><Th right>Kun / soat</Th><Th right>Asosiy</Th>
              {final && <><Th right>Ta&apos;til / kasallik</Th><Th right>Bonus</Th><Th right>Jarima</Th><Th right>JShDS</Th><Th right>Avans</Th></>}
              <Th right>Qo&apos;lga</Th><Th>To&apos;lov</Th>
            </tr>
          </thead>
          <tbody>
            {run.lines.map((l) => {
              const b = breakdownOf(l.breakdown);
              return (
                <Tr key={l.id}>
                  <Td className="font-medium">
                    <Link href={`/employees/${l.employee.id}`} className="hover:underline">{l.employee.fullName}</Link>
                    <div className="text-xs font-normal text-slate-500">{l.employee.position}{l.employee.tabelNo ? ` · tabel ${l.employee.tabelNo}` : ""}</div>
                    {b && (b.warnings.length > 0 || b.rules.length > 0 || b.piece || b.trips || b.advanceFormula) && (
                      <details className="mt-1 text-xs font-normal text-slate-600">
                        <summary className="cursor-pointer text-slate-500">Tafsilot</summary>
                        <div className="mt-1 space-y-0.5">
                          {b.advanceFormula && <div>{b.advanceFormula}</div>}
                          {b.trips && <div>Reyslar: {b.trips.count} ta, {b.trips.km} km — {money(b.trips.sum)} (dispetcher narxi){b.trips.unpriced ? ` · narxsiz ${b.trips.unpriced} ta kirmadi` : ""}</div>}
                          {b.piece && <div>Sdelka · {b.piece.brigade}: fond {money(b.piece.pool)}, ulushi {b.piece.share}% ({b.piece.units.map((u) => `${u.product} ${u.qty} × ${money(u.rate)}`).join("; ")})</div>}
                          {final && <div>Norma {b.normDays} kun · keldi {b.presentDays} · ta&apos;til {b.paidLeaveDays}{b.unpaidLeaveDays ? ` (+${b.unpaidLeaveDays} o'z hisobidan)` : ""} · kasal {b.sickDays} ({b.sickPct}%) · sababsiz {b.absentDays} · kunlik o&apos;rtacha {money(b.dailyAvg)}</div>}
                          {b.rules.map((h) => <div key={h.rule} className={h.kind === "BONUS" ? "text-emerald-700" : "text-red-700"}>{h.rule}: {h.detail} = {money(h.amount)}</div>)}
                          {b.manual.map((m) => <div key={m.id} className={m.kind === "BONUS" ? "text-emerald-700" : "text-red-700"}>Qo&apos;lda: {m.reason} = {money(m.amount)}</div>)}
                          {b.advances.map((a) => <div key={a.docNo}>Avans {a.docNo}: {money(a.amount)}</div>)}
                          {b.warnings.map((w) => <div key={w} className="text-amber-700">{w}</div>)}
                        </div>
                      </details>
                    )}
                  </Td>
                  <Td className="text-sm">{PAY_TYPE_LABEL[l.payType]}<div className="text-xs text-slate-500">{l.payType === "PIECE" ? `${Number(l.units)} birlik` : money(n(l.rate))}</div></Td>
                  <Td right>{l.workedDays}{l.normDays ? `/${l.normDays}` : ""}<div className="text-xs text-slate-500">{l.workedMinutes ? `${hoursShort(l.workedMinutes)} soat` : ""}</div></Td>
                  <Td right>{money(n(l.base))}</Td>
                  {final && (
                    <>
                      <Td right>{n(l.leavePay) + n(l.sickPay) ? money(n(l.leavePay) + n(l.sickPay)) : "—"}</Td>
                      <Td right className="text-emerald-700">{n(l.bonus) ? money(n(l.bonus)) : "—"}</Td>
                      <Td right className="text-red-700">{n(l.penalty) ? money(n(l.penalty)) : "—"}</Td>
                      <Td right>{money(n(l.incomeTax))}</Td>
                      <Td right>{n(l.advanceDeducted) ? money(n(l.advanceDeducted)) : "—"}</Td>
                    </>
                  )}
                  <Td right className={`font-semibold ${n(l.net) < 0 ? "text-red-700" : ""}`}>{money(n(l.net))}</Td>
                  <Td>{l.paidAt ? <Badge color="green">{date(l.paidAt)}</Badge> : n(l.net) > 0 ? <Badge color="amber">kutmoqda</Badge> : <span className="text-xs text-slate-400">—</span>}</Td>
                </Tr>
              );
            })}
            <Tr className="bg-slate-50 font-semibold">
              <Td>Jami</Td><Td /><Td />
              <Td right>{money(sum("base"))}</Td>
              {final && <><Td right>{money(sum("leavePay") + sum("sickPay"))}</Td><Td right>{money(sum("bonus"))}</Td><Td right>{money(sum("penalty"))}</Td><Td right>{money(sum("incomeTax"))}</Td><Td right>{money(sum("advanceDeducted"))}</Td></>}
              <Td right>{money(n(run.net))}</Td><Td />
            </Tr>
          </tbody>
        </Table>
      </Card>
      {final && <p className="text-xs text-slate-500">INPS (shaxsiy jamg&apos;arib boriladigan pensiya) {money(sum("inps"))} — JShDS ichidan o&apos;tkaziladi. Ijtimoiy soliq {money(sum("employerTax"))} — ish beruvchi hisobidan.</p>}
    </div>
  );
}
