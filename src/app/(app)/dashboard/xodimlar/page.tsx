import Link from "next/link";
import { redirect } from "next/navigation";
import { HardHat, Users } from "lucide-react";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { productionStaff, UNASSIGNED } from "@/lib/production-staff";
import { markOf } from "@/lib/davomat";
import { Badge, Card, Empty, PageHeader, StatCard, Table, Td, Th, Tr } from "@/components/ui";
import { AssignSelect } from "../production-forms";

/**
 * Direktor: sex xodimlarini brigadalarga taqsimlaydi. Brigadaga biriktirilgan xodim sex tarkibida
 * sanaladi (bosh sahifa, mobil "Sex", kunlik hisobot) va sex boshlig'i uning davomatini belgilaydi.
 * Pastdagi ro'yxat — boshqa bo'lim xodimlari: kerak bo'lsa ularni ham sexga berish mumkin.
 */
export default async function StaffAssignPage({ searchParams }: { searchParams: Promise<{ all?: string }> }) {
  const s = await getSession();
  if (s?.role !== "DIRECTOR") redirect("/dashboard?denied=1");
  const showAll = (await searchParams).all === "1";
  const staff = await productionStaff();
  const inSex = new Set(staff.members.map((m) => m.id));
  const others = showAll
    ? await db.employee.findMany({ where: { isActive: true, firedAt: null, id: { notIn: [...inSex] } }, select: { id: true, fullName: true, position: true }, orderBy: [{ position: "asc" }, { fullName: "asc" }] })
    : [];

  return (
    <div>
      <PageHeader back={{ href: "/dashboard?view=production", label: "Ishlab chiqarish" }} title="Xodimlarni taqsimlash" subtitle="Brigada tanlansa darhol saqlanadi. Sex boshlig'i davomatni shu tarkib bo'yicha belgilaydi." />
      <div className="mb-6 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatCard label="Sexda jami" value={String(staff.total)} icon={Users} />
        <StatCard label="Bugun keldi" value={`${staff.present} / ${staff.total}`} hint={staff.notMarked ? `${staff.notMarked} belgilanmagan` : "hammasi belgilangan"} icon={Users} tone="success" />
        <StatCard label="Taqsimlanmagan" value={String(staff.unassigned)} icon={HardHat} tone={staff.unassigned ? "warning" : "default"} />
        <StatCard label="Brigadalar" value={String(staff.brigades.length)} hint={staff.groups.filter((g) => g.id).map((g) => `${g.name.split(" ")[0]} ${g.total}`).join(" · ")} icon={HardHat} href="/brigades" />
      </div>

      <Table>
        <thead><tr><Th>Xodim</Th><Th>Lavozim</Th><Th>Bugun</Th><Th className="w-72">Brigada</Th></tr></thead>
        <tbody>
          {staff.members.length === 0 && <Empty text="Sex tarkibida xodim yo'q" icon={Users} />}
          {staff.members.map((m) => {
            const st = m.status ? markOf(m.status) : null;
            return (
              <Tr key={m.id}>
                <Td className="font-medium">{m.fullName}{m.leads && <span className="ml-2"><Badge color="blue">brigadir</Badge></span>}</Td>
                <Td className="text-slate-500">{m.position}</Td>
                <Td>{st ? <Badge color={st.color}>{st.label}{m.checkIn ? ` ${m.checkIn}` : ""}</Badge> : <span className="text-xs text-slate-400">belgilanmagan</span>}</Td>
                <Td><AssignSelect employeeId={m.id} brigadeId={m.brigadeId} brigades={staff.brigades} /></Td>
              </Tr>
            );
          })}
        </tbody>
      </Table>
      {staff.unassigned > 0 && <p className="mt-2 text-xs text-amber-700">«{UNASSIGNED}» — lavozimi ishlab chiqarishga tegishli, lekin brigadasi tanlanmagan xodimlar.</p>}

      <div className="mt-8">
        {showAll ? (
          <Card padded={false}>
            <div className="flex items-center justify-between px-5 py-3"><div className="text-sm font-medium">Boshqa bo&apos;lim xodimlari — sexga berish</div><Link href="?" className="text-sm text-slate-500 hover:text-slate-900">Yashirish</Link></div>
            <table className="w-full text-sm">
              <tbody>
                {others.map((e) => (
                  <Tr key={e.id}><Td className="font-medium">{e.fullName}</Td><Td className="text-slate-500">{e.position}</Td><Td className="w-72"><AssignSelect employeeId={e.id} brigadeId={null} brigades={staff.brigades} /></Td></Tr>
                ))}
                {others.length === 0 && <Empty text="Boshqa xodim yo'q" icon={Users} />}
              </tbody>
            </table>
          </Card>
        ) : (
          <Link href="?all=1" className="text-sm font-medium text-slate-600 hover:text-slate-900">+ Boshqa bo&apos;lim xodimini sexga qo&apos;shish</Link>
        )}
      </div>
    </div>
  );
}
