import { Fragment } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePage } from "@/lib/page-guard";
import { db } from "@/lib/db";
import { dateTime, fmtNum, money } from "@/lib/format";
import { hoursShort, monthTitle } from "@/lib/davomat";
import { breakdownOf, canPayroll, runWithLines } from "@/lib/hr/payroll";
import { payAccounts } from "@/lib/mechanic-requests";
import { PAY_TYPE_LABEL, PAYROLL_KIND_LABEL, PAYROLL_STATUS_BADGE, PAYROLL_STATUS_LABEL } from "@/lib/hr/labels";
import { Badge, Callout, Card, CardHeader, InfoButton, LinkButton, PageHeader, StatCard, StatusSteps, Table, Td, Th, Tr } from "@/components/ui";
import { PayForm, RunActions, UnpayForm, type UnpayGroup } from "../forms";
import { CreditCard, FileSpreadsheet, Printer, Table2 } from "lucide-react";
import { Sheet, SheetHead, SheetTd, SheetTh, SheetTr, SheetFoot } from "@/components/ui/sheet";
import { SHEET_COLS, runSheet, type RunSheet } from "@/lib/hr/vedomost-sheet";

const STEPS = [{ key: "DRAFT", label: "Hisoblandi" }, { key: "SUBMITTED", label: "Direktor tasdig'ida" }, { key: "APPROVED", label: "Tasdiqlandi" }, { key: "PAID", label: "To'landi" }];

/** Vedomost: qatorlar (xodim bo'yicha hisob tafsiloti), tasdiq va kassadan to'lov. */
export default async function PayrollRunPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ view?: string }> }) {
  const s = await requirePage("/ish-haqi");
  const { id } = await params;
  const sp = await searchParams;
  const run = await runWithLines(id);
  if (!run) notFound();
  const sheet = sp.view === "c2026" ? await runSheet(id) : null;
  const canPay = canPayroll(s, "pay") && run.status === "APPROVED";
  const accounts = canPay ? await payAccounts() : [];
  const unpaid = run.lines.filter((l) => !l.paidAt && Number(l.net) > 0);
  const n = (v: unknown) => Number(v ?? 0);
  const final = run.kind === "FINAL";
  // To'lovni bekor qilish (direktor): to'langan qatorlar to'lov (kassa chiqimi) bo'yicha guruhlanadi — chiqim bo'linmaydi
  const canUndo = canPayroll(s, "approve") && (run.status === "APPROVED" || run.status === "PAID");
  const paidLines = canUndo ? run.lines.filter((l) => l.paidAt) : [];
  const payTxs = paidLines.length
    ? new Map((await db.cashTransaction.findMany({
      where: { id: { in: [...new Set(paidLines.flatMap((l) => (l.cashTxId ? [l.cashTxId] : [])))] } },
      select: { id: true, date: true, cancelledAt: true, cashAccount: { select: { name: true } } },
    })).map((c) => [c.id, c]))
    : new Map<string, never>();
  const undoGroups: UnpayGroup[] = [];
  for (const l of paidLines) {
    const key = l.cashTxId ?? `line:${l.id}`;
    let g = undoGroups.find((x) => x.key === key);
    if (!g) {
      const ct = l.cashTxId ? payTxs.get(l.cashTxId) : undefined;
      g = { key, amount: 0, lines: [], label: ct ? `${dateTime(ct.date)} · ${ct.cashAccount.name}${ct.cancelledAt ? " · chiqim kassada bekor qilingan" : ""}` : `${dateTime(l.paidAt!)} · kassa chiqimi bog'lanmagan` };
      undoGroups.push(g);
    }
    g.amount += n(l.paid);
    g.lines.push({ id: l.id, fullName: l.employee.fullName });
  }
  const sum = (k: "base" | "leavePay" | "sickPay" | "bonus" | "penalty" | "gross" | "incomeTax" | "inps" | "advanceDeducted" | "employerTax") => run.lines.reduce((x, l) => x + n(l[k]), 0);

  return (
    <div className="space-y-4">
      <PageHeader back={{ href: "/ish-haqi", label: "Ish haqi" }} title={`${run.docNo} · ${PAYROLL_KIND_LABEL[run.kind]}`} subtitle={`${monthTitle(run.month)} · ${run.lines.length} xodim${run.note ? ` · ${run.note}` : ""}`}
        action={<Badge color={PAYROLL_STATUS_BADGE[run.status]}>{PAYROLL_STATUS_LABEL[run.status]}</Badge>} />
      {run.status !== "CANCELLED" && <StatusSteps steps={STEPS} current={run.status} />}
      {run.rejectNote && run.status === "DRAFT" && <Callout tone="warning" title="Direktor qaytardi">{run.rejectNote}</Callout>}
      {run.status === "CANCELLED" && <Callout tone="danger" title="Bekor qilingan">{run.cancelReason}{run.cancelledAt ? ` · ${dateTime(run.cancelledAt)}` : ""}</Callout>}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Hisoblangan" value={money(n(run.gross))} href="#qatorlar" />
        <StatCard label="Ushlanma (soliq, jarima, avans)" value={money(n(run.deductions))} href="#qatorlar" />
        <StatCard label="Qo'lga" value={money(n(run.net))} tone="brand" href="#qatorlar" />
        <StatCard label="To'langan" value={money(n(run.paid))} tone={n(run.paid) >= n(run.net) && n(run.net) > 0 ? "success" : "default"} hint={final ? `Ijtimoiy soliq (ish beruvchi): ${money(n(run.employerTax))}` : undefined} href={canPay && unpaid.length > 0 ? "#tolash" : "#qatorlar"} />
      </div>

      <RunActions id={run.id} status={run.status} kind={run.kind} net={n(run.net) - n(run.paid)} canCalc={canPayroll(s, "calc")} canApprove={canPayroll(s, "approve")} />
      {canUndo && <UnpayForm id={run.id} groups={undoGroups} />}

      {/* Excel C2026 ko'rinishi, eksport va imzo ustunli to'lov ro'yxatlari */}
      <div className="flex flex-wrap items-center gap-2">
        <LinkButton href={sp.view === "c2026" ? `/ish-haqi/${run.id}` : `/ish-haqi/${run.id}?view=c2026`} variant={sp.view === "c2026" ? "primary" : "secondary"} size="sm"><Table2 size={14} /> {sp.view === "c2026" ? "Oddiy ko'rinish" : "C2026 ko'rinish (Excel kabi)"}</LinkButton>
        <a href={`/ish-haqi/${run.id}/excel`} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 shadow-sm hover:bg-slate-50"><FileSpreadsheet size={14} /> Excel</a>
        <LinkButton href={`/ish-haqi/${run.id}/chop?tur=naqd`} variant="secondary" size="sm"><Printer size={14} /> To&apos;lov ro&apos;yxati — naqd</LinkButton>
        {run.lines.some((l) => n(l.cardAmount) > 0) && <LinkButton href={`/ish-haqi/${run.id}/chop?tur=plastik`} variant="secondary" size="sm"><CreditCard size={14} /> Plastik ro&apos;yxati</LinkButton>}
      </div>
      {sheet && <C2026View sheet={sheet} />}

      {canPay && unpaid.length > 0 && (
        <Card>
          <div id="tolash" className="scroll-mt-20" />
          <CardHeader title="Kassadan to'lash" info="Har to'lov Kirim-Chiqimda «Ish haqi» chiqimi bo'lib yoziladi; kassa qoldig'i tekshiriladi" />
          <PayForm id={run.id} accounts={accounts} lines={unpaid.map((l) => ({ id: l.id, fullName: l.employee.fullName, net: n(l.net), card: n(l.cardAmount) }))} />
        </Card>
      )}

      <Card padded={false} className={sheet ? "hidden" : undefined}>
        <div id="qatorlar" className="scroll-mt-20" />
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
                  <Td right>{b?.dayUnits != null ? fmtNum(b.dayUnits, 2) : l.workedDays}{l.normDays ? `/${l.normDays}` : ""}<div className="text-xs text-slate-500">{l.workedMinutes ? `${hoursShort(l.workedMinutes)} soat` : ""}</div></Td>
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
                  <Td>{l.paidAt ? <Badge color="green">{dateTime(l.paidAt)}</Badge> : n(l.net) > 0 ? <Badge color="amber">kutmoqda</Badge> : <span className="text-xs text-slate-400">—</span>}</Td>
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
      {final && (
        <div className="flex flex-wrap items-center gap-1 text-xs text-slate-500">
          INPS {money(sum("inps"))} · Ijtimoiy soliq {money(sum("employerTax"))}
          <InfoButton title="INPS va ijtimoiy soliq">
            <p>INPS (shaxsiy jamg&apos;arib boriladigan pensiya) — JShDS ichidan o&apos;tkaziladi.</p>
            <p>Ijtimoiy soliq — ish beruvchi hisobidan.</p>
          </InfoButton>
        </div>
      )}
    </div>
  );
}

/** Excel C2026 kabi: bo'limlar, ushlanmalar turi bo'yicha ustunlar, bo'lim va umumiy jami. */
function C2026View({ sheet }: { sheet: RunSheet }) {
  const cell = (v: number) => (v ? fmtNum(Math.round(v)) : "");
  let no = 0;
  return (
    <Sheet maxHeight="75vh">
      <SheetHead>
        <tr>
          <SheetTh>№</SheetTh><SheetTh>F.I.O.</SheetTh>
          {SHEET_COLS.map((c) => <SheetTh key={c.key} right title={c.excel} tone={c.key === "net" || c.key === "cash" ? "green" : ["brak", "aliment", "loan", "salaryDebt", "fund", "fine", "other", "advance"].includes(c.key) ? "red" : "head"}>{c.label}</SheetTh>)}
        </tr>
      </SheetHead>
      <tbody>
        {sheet.groups.map((g) => (
          <Fragment key={g.label}>
            <SheetTr key={`h-${g.label}`}><SheetTd colSpan={SHEET_COLS.length + 2} tone="yellow" strong center>{g.label}</SheetTd></SheetTr>
            {g.rows.map((r) => (
              <SheetTr key={r.lineId}>
                <SheetTd center muted>{++no}</SheetTd>
                <SheetTd>{r.fullName}<div className="text-[11px] text-slate-500">{r.position}{r.paid ? " · to'langan" : ""}</div></SheetTd>
                {SHEET_COLS.map((c) => <SheetTd key={c.key} right strong={c.key === "net"}>{cell(r.v[c.key])}</SheetTd>)}
              </SheetTr>
            ))}
            <SheetTr key={`t-${g.label}`}><SheetTd /><SheetTd strong>Jami: {g.label}</SheetTd>{SHEET_COLS.map((c) => <SheetTd key={c.key} right strong tone="gray">{cell(g.total[c.key])}</SheetTd>)}</SheetTr>
          </Fragment>
        ))}
      </tbody>
      <SheetFoot sticky>
        <tr><SheetTd /><SheetTd strong>JAMI</SheetTd>{SHEET_COLS.map((c) => <SheetTd key={c.key} right strong>{cell(sheet.total[c.key])}</SheetTd>)}</tr>
      </SheetFoot>
    </Sheet>
  );
}
