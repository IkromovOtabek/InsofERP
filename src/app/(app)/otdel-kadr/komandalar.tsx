import Link from "next/link";
import { Hammer, Users, UsersRound } from "lucide-react";
import { db } from "@/lib/db";
import type { Session } from "@/lib/auth";
import { canDo } from "@/lib/permissions";
import { money } from "@/lib/format";
import { Badge, Card, CardHeader, Empty, Table, Td, Th, Tr } from "@/components/ui";
import { TeamForm, TeamTools, type TeamData } from "./team-forms";

/**
 * «Komanda va brigadalar»: komandalar (svarshiklar va h.k. — `Team`, shu yerda ochiladi) va ishlab chiqarish brigadalari
 * (`Brigade`, Ishlab chiqarish → Brigadalar'da boshqariladi — bu yerda tarkibi ko'rinadi). «Kassadan» — Kirim-Chiqimda
 * «Hodimlar bilan hisob-kitob» manbasidan shu komanda/brigadaga yozilgan chiqimlar jami.
 */
export async function KomandaTab({ s }: { s: Session }) {
  const editable = canDo(s, "employees", "teams", ["HR"]);
  const [teams, brigades, employees, cash] = await Promise.all([
    db.team.findMany({
      orderBy: [{ isActive: "desc" }, { name: "asc" }],
      include: { leader: { select: { fullName: true } }, members: { where: { isActive: true, firedAt: null }, select: { id: true, fullName: true, position: true }, orderBy: { fullName: "asc" } } },
    }),
    db.brigade.findMany({
      where: { isActive: true }, orderBy: { name: "asc" },
      include: { leader: { select: { fullName: true } }, members: { where: { isActive: true, firedAt: null }, select: { id: true, fullName: true }, orderBy: { fullName: "asc" } } },
    }),
    db.employee.findMany({ where: { isActive: true, firedAt: null }, orderBy: { fullName: "asc" }, select: { id: true, fullName: true, position: true, team: { select: { name: true } } } }),
    db.cashTransaction.groupBy({ by: ["teamId", "brigadeId"], where: { type: "EXPENSE", cancelledAt: null, OR: [{ teamId: { not: null } }, { brigadeId: { not: null } }] }, _sum: { amount: true } }),
  ]);
  const paidTeam = new Map(cash.filter((c) => c.teamId).map((c) => [c.teamId!, Number(c._sum.amount ?? 0)]));
  const paidBrig = new Map(cash.filter((c) => c.brigadeId).map((c) => [c.brigadeId!, Number(c._sum.amount ?? 0)]));
  const emps = employees.map((e) => ({ id: e.id, fullName: e.fullName, position: e.position, teamName: e.team?.name ?? null }));

  return (
    <div className="space-y-4">
      {editable && (
        <Card>
          <CardHeader title="Yangi komanda" icon={UsersRound} info="Komanda — ishlab chiqarish brigadasidan alohida guruh (svarshiklar, montajchilar…). Kirim-Chiqimda «Hodimlar bilan hisob-kitob» manbasida unga chiqim yozish mumkin." />
          <TeamForm employees={emps} />
        </Card>
      )}

      <Card>
        <CardHeader title={`Komandalar — ${teams.filter((t) => t.isActive).length} ta`} icon={Users} />
        {!teams.length ? <Empty text="Hali komanda yo'q" icon={UsersRound} /> : (
          <div className="space-y-2">
            {teams.map((t) => {
              const data: TeamData = { id: t.id, name: t.name, leaderId: t.leaderId, phone: t.phone, note: t.note, memberIds: t.members.map((m) => m.id) };
              return (
                <div key={t.id} className={t.isActive ? "rounded-lg border border-slate-200 p-3" : "rounded-lg border border-dashed border-slate-200 p-3 opacity-60"}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-slate-900">{t.name}</span>
                        <Badge color="blue">{t.members.length} kishi</Badge>
                        {!t.isActive && <Badge color="slate">Yopilgan</Badge>}
                        {paidTeam.get(t.id) ? <Badge color="amber" dot={false}>Kassadan: {money(paidTeam.get(t.id)!)}</Badge> : null}
                      </div>
                      <div className="mt-0.5 text-xs text-slate-500">
                        Brigadir: {t.leader?.fullName ?? "—"}{t.phone ? ` · ${t.phone}` : ""}{t.note ? ` · ${t.note}` : ""}
                      </div>
                      {t.members.length > 0 && <div className="mt-1.5 text-sm text-slate-700">{t.members.map((m) => m.fullName).join(", ")}</div>}
                    </div>
                    {editable && <div className="w-full sm:w-auto"><TeamTools team={data} employees={emps} active={t.isActive} /></div>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <Card padded={false}>
        <div className="p-5 pb-0"><CardHeader title={`Brigadalar — ${brigades.length} ta`} icon={Hammer} info="Ishlab chiqarish brigadalari — tarkibi va brigadiri Ishlab chiqarish → Brigadalar bo'limida o'zgaradi." /></div>
        {!brigades.length ? <div className="p-5"><Empty text="Faol brigada yo'q" /></div> : (
          <Table className="rounded-none border-0 shadow-none">
            <thead><tr><Th>Brigada</Th><Th>Brigadir</Th><Th right>Kishi</Th><Th>A&apos;zolar</Th><Th right>Kassadan</Th></tr></thead>
            <tbody>{brigades.map((b) => (
              <Tr key={b.id}>
                <Td className="font-medium"><Link href="/brigades" className="hover:underline">{b.name}</Link></Td>
                <Td>{b.leader?.fullName ?? "—"}</Td>
                <Td right className="tabular">{b.members.length}</Td>
                <Td className="text-slate-600">{b.members.map((m) => m.fullName).join(", ") || "—"}</Td>
                <Td right className="tabular">{paidBrig.get(b.id) ? money(paidBrig.get(b.id)!) : "—"}</Td>
              </Tr>
            ))}</tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
