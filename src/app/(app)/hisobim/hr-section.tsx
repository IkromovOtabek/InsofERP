import Link from "next/link";
import { ListTodo, Wallet } from "lucide-react";
import { db } from "@/lib/db";
import { dateTime, money } from "@/lib/format";
import { monthTitle } from "@/lib/davomat";
import { employeeOfUser } from "@/lib/hr/requests";
import { breakdownOf, myLines } from "@/lib/hr/payroll";
import { PAYROLL_KIND_LABEL, PAYROLL_STATUS_BADGE, PAYROLL_STATUS_LABEL } from "@/lib/hr/labels";
import { Badge, Card, CardHeader, Empty, Table, Td, Th, Tr } from "@/components/ui";

/**
 * "Mening hisobim" — xodimning o'z kadr ma'lumotlari: ochiq vazifalari va tasdiqlangan ish haqi hisob-kitoblari.
 * Smena grafigi, arizalar, cheklist, KPI, kurslar, moslashuv, so'rovnoma va murojaatlar olib tashlangan.
 * Login xodim kartasiga bog'lanmagan bo'lsa — ko'rsatilmaydi.
 */
export async function MyHrSection({ userId }: { userId: string }) {
  const emp = await employeeOfUser(userId);
  if (!emp || !emp.isActive) return null;
  const [lines, tasks] = await Promise.all([
    myLines(emp.id, 12),
    db.workTask.groupBy({ by: ["status"], where: { assigneeId: emp.id, status: { in: ["TODO", "IN_PROGRESS", "REVIEW"] } }, _count: { _all: true } }),
  ]);
  const openTasks = tasks.reduce((x, t) => x + t._count._all, 0);
  return (
    <div className="mt-5 grid max-w-5xl grid-cols-1 gap-4 xl:grid-cols-2">
      <Card>
        <CardHeader title="Vazifalarim" icon={ListTodo} description="Sizga berilgan ochiq vazifalar" />
        <Link href="/vazifalar" className="inline-flex items-center gap-1.5 text-sm text-brand-700 hover:underline"><ListTodo size={15} /> {openTasks} ta ochiq vazifa</Link>
      </Card>

      <Card padded={false}>
        <div className="border-b border-slate-100 px-4 py-3"><h2 className="flex items-center gap-2 text-sm font-semibold"><Wallet size={15} /> Ish haqim</h2><p className="text-xs text-slate-500">Direktor tasdiqlagan hisob-kitoblar</p></div>
        <Table>
          <thead><tr><Th>Oy</Th><Th right>Hisoblangan</Th><Th right>Ushlanma</Th><Th right>Qo&apos;lga</Th><Th>Holat</Th></tr></thead>
          <tbody>
            {lines.length === 0 && <Empty text="Hali hisob-kitob yo'q" />}
            {lines.map((l) => {
              const b = breakdownOf(l.breakdown);
              const ded = Number(l.incomeTax) + Number(l.penalty) + Number(l.advanceDeducted);
              return (
                <Tr key={l.id}>
                  <Td className="font-medium">
                    {monthTitle(l.run.month)} · {PAYROLL_KIND_LABEL[l.run.kind]}
                    {b && l.run.kind === "FINAL" && (
                      <details className="text-xs font-normal text-slate-600">
                        <summary className="cursor-pointer text-slate-500">Tafsilot</summary>
                        <div>Keldi {b.presentDays}/{b.normDays} kun · ta&apos;til {b.paidLeaveDays} · kasal {b.sickDays}</div>
                        <div>Asosiy {money(Number(l.base))}{Number(l.leavePay) ? ` · ta'til ${money(Number(l.leavePay))}` : ""}{Number(l.sickPay) ? ` · kasallik ${money(Number(l.sickPay))}` : ""}{Number(l.bonus) ? ` · bonus ${money(Number(l.bonus))}` : ""}</div>
                        <div>JShDS {money(Number(l.incomeTax))}{Number(l.penalty) ? ` · jarima ${money(Number(l.penalty))}` : ""}{Number(l.advanceDeducted) ? ` · avans ${money(Number(l.advanceDeducted))}` : ""}</div>
                        {b.rules.map((h) => <div key={h.rule}>{h.rule}: {h.detail}</div>)}
                        {b.manual.map((m) => <div key={m.id}>{m.kind === "BONUS" ? "Bonus" : "Jarima"}: {m.reason}</div>)}
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
    </div>
  );
}
