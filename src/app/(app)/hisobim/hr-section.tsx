import { CalendarRange, Inbox, Wallet } from "lucide-react";
import { date, money } from "@/lib/format";
import { dayUtc, isoDay, monthTitle, shiftDay, today } from "@/lib/davomat";
import { employeeOfUser, listHrRequests, periodText } from "@/lib/hr/requests";
import { plansInRange } from "@/lib/hr/shifts";
import { breakdownOf, myLines } from "@/lib/hr/payroll";
import { PAYROLL_KIND_LABEL, PAYROLL_STATUS_BADGE, PAYROLL_STATUS_LABEL, REQUEST_KIND, REQUEST_STATUS_BADGE, REQUEST_STATUS_LABEL } from "@/lib/hr/labels";
import { Badge, Card, CardHeader, Empty, Table, Td, Th, Tr } from "@/components/ui";
import { CancelOwnButton, RequestForm } from "../otdel-kadr/arizalar-forms";
import { cancelMyRequest, sendMyRequest } from "./hr-actions";

const WD = ["Yak", "Dush", "Sesh", "Chor", "Pay", "Jum", "Shan"];

/**
 * "Mening hisobim" — xodimning o'z kadr ma'lumotlari: smena grafigi (2 hafta), arizalari (yuborish va holati) va
 * tasdiqlangan ish haqi hisob-kitoblari. Login xodim kartasiga bog'lanmagan bo'lsa — ko'rsatilmaydi.
 */
export async function MyHrSection({ userId }: { userId: string }) {
  const emp = await employeeOfUser(userId);
  if (!emp || !emp.isActive) return null;
  const from = today(), to = shiftDay(from, 13);
  const [plans, requests, lines] = await Promise.all([
    plansInRange([{ id: emp.id, workSchedule: emp.workSchedule }], from, to),
    listHrRequests({ employeeId: emp.id, status: "ALL", take: 20 }),
    myLines(emp.id, 12),
  ]);
  const plan = plans.get(emp.id)!;
  return (
    <div className="mt-5 grid max-w-5xl grid-cols-1 gap-4 xl:grid-cols-2">
      <Card>
        <CardHeader title="Smena grafigim" icon={CalendarRange} description="Keyingi 2 hafta — kechikish shu grafik bo'yicha hisoblanadi" />
        <div className="grid grid-cols-7 gap-1 text-center text-xs">
          {[...plan.entries()].map(([iso, p]) => (
            <div key={iso} className={`rounded-md border px-1 py-1.5 ${p.off ? "border-slate-100 bg-slate-50 text-slate-400" : "border-sky-100 bg-sky-50 text-sky-900"} ${iso === from ? "ring-2 ring-brand-400" : ""}`}>
              <div className="font-medium">{WD[dayUtc(iso).getUTCDay()]} {iso.slice(8, 10)}</div>
              <div>{p.off ? "Dam" : `${p.start}–${p.end}`}</div>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <CardHeader title="Ariza yuborish" icon={Inbox} description="Ta'til, kasallik, dam olish kuni, avans yoki kechikish sababi — otdel kadr ko'rib chiqadi" />
        <RequestForm action={sendMyRequest} />
      </Card>

      <Card padded={false}>
        <div className="border-b border-slate-100 px-4 py-3"><h2 className="text-sm font-semibold">Arizalarim</h2></div>
        <Table>
          <thead><tr><Th>Ariza</Th><Th>Turi</Th><Th>Holat</Th><Th right /></tr></thead>
          <tbody>
            {requests.length === 0 && <Empty text="Ariza yo'q" />}
            {requests.map((r) => (
              <Tr key={r.id}>
                <Td className="font-medium">{r.docNo}<div className="text-xs font-normal text-slate-500">{date(r.createdAt)}</div></Td>
                <Td>{REQUEST_KIND[r.kind].label}<div className="text-xs text-slate-500">{r.dateFrom && r.dateTo ? periodText(isoDay(r.dateFrom), isoDay(r.dateTo)) : r.amount ? money(Number(r.amount)) : ""}</div></Td>
                <Td><Badge color={REQUEST_STATUS_BADGE[r.status]}>{REQUEST_STATUS_LABEL[r.status]}</Badge>{r.decisionNote && <div className="mt-1 text-xs text-slate-500">{r.decisionNote}</div>}</Td>
                <Td right>{r.status === "PENDING" && <CancelOwnButton action={cancelMyRequest.bind(null, r.id)} />}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
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
                  <Td>{l.paidAt ? <Badge color="green">Berildi {date(l.paidAt)}</Badge> : <Badge color={PAYROLL_STATUS_BADGE[l.run.status]}>{PAYROLL_STATUS_LABEL[l.run.status]}</Badge>}</Td>
                </Tr>
              );
            })}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}
