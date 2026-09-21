import Link from "next/link";
import { HardHat, ArrowRight } from "lucide-react";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { qty } from "@/lib/format";
import { Badge, Button, Card, Empty, PageHeader, Progress, Table, Td, Th, Tr } from "@/components/ui";
import { RowForm } from "@/components/row-form";
import { saveBrigade, toggleBrigade } from "./actions";

export default async function BrigadesPage() {
  const s = await requireSession(["SUPERVISOR", "PRODUCTION", "HR", "SALES"]);
  const canEdit = ["PRODUCTION", "HR", "DIRECTOR"].includes(s.role);
  const [brigades, employees] = await Promise.all([
    db.brigade.findMany({ orderBy: [{ isActive: "desc" }, { name: "asc" }], include: { leader: true, tasks: { where: { status: { in: ["NEW", "IN_PROGRESS"] } } } } }),
    db.employee.findMany({ where: { isActive: true }, orderBy: { fullName: "asc" }, select: { id: true, fullName: true, position: true } }),
  ]);

  return (
    <div>
      <PageHeader title="Brigadalar" subtitle="Zayavkadagi mahsulotlar brigadalarga topshiriq sifatida biriktiriladi. Brigadir — Xodimlar ro'yxatidan." />
      {canEdit && (
        <Card className="mb-6">
          <h2 className="mb-3 font-semibold">Yangi brigada</h2>
          <RowForm action={saveBrigade.bind(null, null)} mode="create" cols={5} submit="Qo'shish" fields={[
            { name: "name", label: "Nomi *", placeholder: "1-brigada", required: true },
            { name: "leaderId", label: "Brigadir", type: "select", options: [["", "—"], ...employees.map((e) => [e.id, `${e.fullName} · ${e.position}`] as [string, string])] },
            { name: "phone", label: "Telefon" },
            { name: "note", label: "Izoh", className: "sm:col-span-2" },
          ]} />
        </Card>
      )}
      <Table>
        <thead><tr><Th>Brigada</Th><Th>Brigadir</Th><Th>Telefon</Th><Th>Ochiq topshiriqlar</Th><Th>Bajarilishi</Th><Th>Holat</Th><Th></Th></tr></thead>
        <tbody>
          {brigades.length === 0 && <Empty text="Brigadalar yo'q" icon={HardHat} />}
          {brigades.map((b) => {
            const total = b.tasks.reduce((x, t) => x + Number(t.qty), 0);
            const done = b.tasks.reduce((x, t) => x + Number(t.doneQty), 0);
            return (
              <Tr key={b.id}>
                <Td className="font-medium">{b.name}{b.note && <div className="text-xs text-slate-500">{b.note}</div>}</Td>
                <Td>{b.leader?.fullName ?? "—"}</Td>
                <Td>{b.phone ?? b.leader?.phone ?? "—"}</Td>
                <Td><Link href={`/tasks?brigade=${b.id}`} className="inline-flex items-center gap-1 hover:underline">{b.tasks.length} ta <ArrowRight size={13} /></Link></Td>
                <Td className="min-w-40"><div className="text-xs text-slate-500">{qty(done)} / {qty(total)} · qoldiq {qty(total - done)}</div><Progress value={done} max={total || 1} tone={done >= total && total > 0 ? "success" : "default"} /></Td>
                <Td>{b.isActive ? <Badge color="green">Faol</Badge> : <Badge>Nofaol</Badge>}</Td>
                <Td>{canEdit && <form action={toggleBrigade.bind(null, b.id)}><Button variant="secondary" className="px-2 py-1 text-xs">{b.isActive ? "O'chirish" : "Yoqish"}</Button></form>}</Td>
              </Tr>
            );
          })}
        </tbody>
      </Table>
    </div>
  );
}
