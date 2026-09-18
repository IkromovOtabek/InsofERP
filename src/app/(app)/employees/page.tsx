import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { POSITIONS, roleForPosition } from "@/lib/positions";
import { ROLE_LABELS } from "@/lib/nav";
import { Badge, Button, Card, Empty, PageHeader, Table, Td, Th, Tr } from "@/components/ui";
import { EmployeeForm, GrantLoginForm } from "./employee-form";
import { toggleEmployee } from "./actions";

export default async function EmployeesPage() {
  const s = await requireSession(["HR", "LOGISTICS"]);
  const isHR = ["HR", "DIRECTOR"].includes(s.role);
  const employees = await db.employee.findMany({
    orderBy: [{ isActive: "desc" }, { fullName: "asc" }],
    include: { user: true, _count: { select: { trips: true } } },
  });
  return (
    <div>
      <PageHeader title="Xodimlar" subtitle="Bo'lim lavozimi tanlansa xodimga login beriladi va u faqat o'z bo'limini ko'radi" />
      <Card className="mb-6"><EmployeeForm positions={POSITIONS} canGrant={isHR} /></Card>
      <Table>
        <thead><tr><Th>F.I.O.</Th><Th>Lavozim</Th><Th>Telefon</Th><Th>Tizimga kirish</Th><Th right>Reyslar</Th><Th>Holat</Th><Th></Th></tr></thead>
        <tbody>
          {employees.length === 0 && <Empty text="Xodimlar yo'q" />}
          {employees.map((e) => {
            const role = roleForPosition(e.position);
            return (
              <Tr key={e.id}>
                <Td className="font-medium">{e.fullName}</Td><Td>{e.position}</Td><Td>{e.phone ?? "—"}</Td>
                <Td>
                  {e.user
                    ? <span className="text-sm"><code className="rounded bg-slate-100 px-1.5 py-0.5">{e.user.login}</code> <span className="text-slate-500">· {ROLE_LABELS[e.user.role]}</span>{!e.user.isActive && <Badge>bloklangan</Badge>}</span>
                    : role && isHR && e.isActive ? <GrantLoginForm employeeId={e.id} />
                    : <span className="text-slate-400">—</span>}
                </Td>
                <Td right>{e._count.trips}</Td>
                <Td>{e.isActive ? <Badge color="green">Faol</Badge> : <Badge>Nofaol</Badge>}</Td>
                <Td>{isHR && e.userId !== s.userId && <form action={toggleEmployee.bind(null, e.id)}><Button variant="secondary" className="px-2 py-1 text-xs">{e.isActive ? "O'chirish" : "Yoqish"}</Button></form>}</Td>
              </Tr>
            );
          })}
        </tbody>
      </Table>
    </div>
  );
}
