import Link from "next/link";
import { HandCoins, ListTodo, Wallet } from "lucide-react";
import { db } from "@/lib/db";
import { dateTime, money } from "@/lib/format";
import { monthTitle } from "@/lib/davomat";
import { employeeOfUser } from "@/lib/hr/requests";
import { breakdownOf, myLines } from "@/lib/hr/payroll";
import { PAYROLL_KIND_LABEL, PAYROLL_STATUS_BADGE, PAYROLL_STATUS_LABEL } from "@/lib/hr/labels";
import { deductionLabel } from "@/lib/hr/deduction-cats";
import { employeeLedger } from "@/lib/hr/deductions";
import { DEDUCTION_KEYS, deductionRuleTitle, lineDeductions, sheetColLabel } from "@/lib/hr/vedomost-sheet";
import { Badge, Card, CardHeader, Empty, InfoButton, Table, Td, Th, Tr } from "@/components/ui";

/**
 * "Mening hisobim" — xodimning o'z kadr ma'lumotlari: ochiq vazifalari, tasdiqlangan ish haqi hisob-kitoblari (ushlanmalar
 * turi bo'yicha — vedomost C2026 ustunlari, `lib/hr/vedomost-sheet.ts`) va qarz / ijro qoldig'i (`employeeLedger`).
 * Smena grafigi, arizalar, cheklist, KPI, kurslar, moslashuv, so'rovnoma va murojaatlar olib tashlangan.
 * Login xodim kartasiga bog'lanmagan bo'lsa — ko'rsatilmaydi.
 */
export async function MyHrSection({ userId }: { userId: string }) {
  const emp = await employeeOfUser(userId);
  if (!emp || !emp.isActive) return null;
  const [lines, led, tasks] = await Promise.all([
    myLines(emp.id, 12),
    employeeLedger(emp.id),
    db.workTask.groupBy({ by: ["status"], where: { assigneeId: emp.id, status: { in: ["TODO", "IN_PROGRESS", "REVIEW"] } }, _count: { _all: true } }),
  ]);
  const openTasks = tasks.reduce((x, t) => x + t._count._all, 0);
  return (
    <div className="mt-5 grid max-w-5xl grid-cols-1 gap-4 xl:grid-cols-2">
      <Card>
        <CardHeader title="Vazifalarim" icon={ListTodo} info="Sizga berilgan ochiq vazifalar" />
        <Link href="/vazifalar" className="inline-flex items-center gap-1.5 text-sm text-brand-700 hover:underline"><ListTodo size={15} /> {openTasks} ta ochiq vazifa</Link>
      </Card>

      <Card padded={false}>
        <div className="border-b border-slate-100 px-4 py-3"><h2 className="flex items-center gap-2 text-sm font-semibold"><Wallet size={15} /> Ish haqim<InfoButton title="Ish haqim" className="-ml-1">Direktor tasdiqlagan hisob-kitoblar</InfoButton></h2></div>
        <Table>
          <thead><tr><Th>Oy</Th><Th right>Hisoblangan</Th><Th right>Ushlanma</Th><Th right>Qo&apos;lga</Th><Th>Holat</Th></tr></thead>
          <tbody>
            {lines.length === 0 && <Empty text="Hali hisob-kitob yo'q" />}
            {lines.map((l) => {
              const b = breakdownOf(l.breakdown);
              const ded = Number(l.incomeTax) + Number(l.penalty) + Number(l.advanceDeducted);
              const byType = lineDeductions(l.breakdown);
              const typed = DEDUCTION_KEYS.filter((k) => byType[k]).map((k) => `${sheetColLabel(k).toLowerCase()} ${money(byType[k])}`);
              return (
                <Tr key={l.id}>
                  <Td className="font-medium">
                    {monthTitle(l.run.month)} · {PAYROLL_KIND_LABEL[l.run.kind]}
                    {b && l.run.kind === "FINAL" && (
                      <details className="text-xs font-normal text-slate-600">
                        <summary className="cursor-pointer text-slate-500">Tafsilot</summary>
                        <div>Keldi {b.presentDays}/{b.normDays} kun · ta&apos;til {b.paidLeaveDays} · kasal {b.sickDays}</div>
                        <div>Asosiy {money(Number(l.base))}{Number(l.leavePay) ? ` · ta'til ${money(Number(l.leavePay))}` : ""}{Number(l.sickPay) ? ` · kasallik ${money(Number(l.sickPay))}` : ""}{Number(l.bonus) ? ` · bonus ${money(Number(l.bonus))}` : ""}</div>
                        <div>JShDS {money(Number(l.incomeTax))}{typed.length ? ` · ${typed.join(" · ")}` : ""}{Number(l.advanceDeducted) ? ` · avans ${money(Number(l.advanceDeducted))}` : ""}</div>
                        {b.rules.map((h) => <div key={h.rule}>{deductionRuleTitle(h.rule)}: {money(h.amount)} — {h.detail}</div>)}
                        {b.manual.map((m) => {
                          const t = m.kind === "BONUS" ? "Bonus" : deductionLabel(m.category) ?? "Jarima";
                          return <div key={m.id}>{t}: {money(m.amount)}{m.reason && m.reason !== t ? ` — ${m.reason}` : ""}</div>;
                        })}
                      </details>
                    )}
                  </Td>
                  <Td right>{money(Number(l.gross))}</Td>
                  <Td right>{ded ? money(ded) : "—"}</Td>
                  <Td right className="font-semibold">{money(Number(l.net))}</Td>
                  <Td>{l.paidAt ? <Badge color="green">Berildi {dateTime(l.paidAt)}</Badge> : <Badge color={PAYROLL_STATUS_BADGE[l.run.status]}>{PAYROLL_STATUS_LABEL[l.run.status]}</Badge>}</Td>
                </Tr>
              );
            })}
          </tbody>
        </Table>
      </Card>

      {(led.debts.length > 0 || led.withholds.length > 0) && (
        <Card padded={false}>
          <div className="border-b border-slate-100 px-4 py-3"><h2 className="flex items-center gap-2 text-sm font-semibold"><HandCoins size={15} /> Qarz va ushlanmalar qoldig&apos;i<InfoButton title="Qarz va ushlanmalar" className="-ml-1">Oy yakuni vedomostida oylikdan ushlanadi; qoldiq — tasdiqlangan vedomostlardan keyin</InfoButton></h2></div>
          <Table>
            <thead><tr><Th>Turi</Th><Th>Davri</Th><Th right>Oyiga</Th><Th right>Qoldiq</Th></tr></thead>
            <tbody>
              {led.debts.map((d) => (
                <Tr key={d.id}>
                  <Td className="font-medium">Qarz{d.note ? ` · ${d.note}` : ""}<div className="text-xs font-normal text-slate-500">jami {money(d.amount)} · ushlangan {money(d.held)}</div></Td>
                  <Td>{monthTitle(d.startMonth)} – {monthTitle(d.endMonth)}</Td>
                  <Td right>{money(d.monthly)}</Td>
                  <Td right className="font-semibold">{money(d.left)}</Td>
                </Tr>
              ))}
              {led.withholds.map((w) => (
                <Tr key={w.id}>
                  <Td className="font-medium">{w.kind === "MIB" ? "Ijro varaqasi" : "Aliment"}{w.caseNo ? ` №${w.caseNo}` : ""}<div className="text-xs font-normal text-slate-500">{w.amount != null ? `jami ${money(w.amount)} · ` : ""}ushlangan {money(w.held)}</div></Td>
                  <Td>{monthTitle(w.startMonth)} dan</Td>
                  <Td right>{w.monthly != null ? money(w.monthly) : w.percent != null ? `${w.percent}%` : "—"}</Td>
                  <Td right className="font-semibold">{w.left != null ? money(w.left) : "muddatsiz"}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
    </div>
  );
}
