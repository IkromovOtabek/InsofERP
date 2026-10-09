import { requireAdmin } from "@/lib/control/auth";
import Link from "next/link";
import { control } from "@/lib/control/db";
import { EVENT_LABEL } from "@/lib/control/events";
import { dateTime } from "@/lib/format";
import { Empty, Table, Td, Th, Tr } from "@/components/ui";
import { PageHeader } from "../../_ui";
import { PageHelp, WithHelp } from "../_help/help";

export const metadata = { title: "Jurnal" };
export const dynamic = "force-dynamic";

export default async function EventsPage() {
  await requireAdmin(); // layout ham tekshiradi; sahifa o'zi ham himoyalangan bo'lsin (layout'siz render/qayta foydalanish)
  const events = await control.controlEvent.findMany({
    orderBy: { createdAt: "desc" }, take: 300,
    include: { admin: { select: { fullName: true, login: true } }, tenant: { select: { name: true, slug: true } } },
  });
  return (
    <div className="space-y-4">
      <PageHeader title={<>Jurnal <PageHelp topic="page:jurnal" /></>} subtitle="Superadminlar amallari: kim, qachon, qaysi korxonada. Parollar yozilmaydi." />
      {events.length === 0 ? <Empty text="Yozuv yo'q" /> : (
        <Table>
          <thead><tr><Th>Vaqt</Th><Th><WithHelp topic="jur:columns">Kim</WithHelp></Th><Th><WithHelp topic="jur:events">Amal</WithHelp></Th><Th>Korxona</Th><Th><WithHelp topic="jur:columns">Tafsilot</WithHelp></Th><Th><WithHelp topic="term:ip">IP</WithHelp></Th></tr></thead>
          <tbody>{events.map((e) => (
            <Tr key={e.id}>
              <Td className="whitespace-nowrap">{dateTime(e.createdAt)}</Td>
              <Td>{e.admin ? `${e.admin.fullName}` : "skript"}</Td>
              <Td>{EVENT_LABEL[e.action] ?? e.action}</Td>
              <Td>{e.tenant ? <Link className="hover:underline" href={`/superadmin/korxonalar/${e.tenant.slug}`}>{e.tenant.name}</Link> : "—"}</Td>
              <Td className="max-w-md truncate text-xs text-slate-500">{e.detail ? JSON.stringify(e.detail) : ""}</Td>
              <Td className="text-xs">{e.ip ?? ""}</Td>
            </Tr>
          ))}</tbody>
        </Table>
      )}
    </div>
  );
}
