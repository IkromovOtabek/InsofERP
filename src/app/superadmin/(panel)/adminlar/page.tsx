import { control } from "@/lib/control/db";
import { requireAdmin } from "@/lib/control/auth";
import { dateTime } from "@/lib/format";
import { Badge, Button, Card, Table, Td, Th, Tr } from "@/components/ui";
import { PageHeader } from "../../_ui";
import { NewAdminForm, OwnPasswordForm } from "../forms";
import { toggleAdminAction } from "../actions";
import { adminEcoEnabled } from "@/lib/control/eco-login";
import { OwnEcoForm } from "./eco-form";

export const metadata = { title: "IT jamoasi" };

export default async function AdminsPage() {
  const me = await requireAdmin();
  const admins = await control.superAdmin.findMany({ orderBy: { createdAt: "asc" } });
  return (
    <div className="space-y-6">
      <PageHeader title="IT jamoasi" subtitle="Platforma administratorlari: barcha korxonalarni ko'radi, yaratadi, direktorga login beradi, korxonaga IT sifatida kiradi." />
      <Card><div className="mb-3 font-semibold">Yangi superadmin</div><NewAdminForm /></Card>
      <Table>
        <thead><tr><Th>F.I.O.</Th><Th>Login</Th><Th>Holat</Th><Th>Oxirgi kirish</Th><Th /></tr></thead>
        <tbody>{admins.map((a) => (
          <Tr key={a.id}>
            <Td>{a.fullName}{a.id === me.id && <span className="ml-2 text-xs text-slate-400">(siz)</span>}</Td>
            <Td><code className="text-xs">{a.login}</code>{a.ecoUserId && <span className="ml-2"><Badge color="violet" dot={false}>ECO</Badge></span>}</Td>
            <Td><Badge color={a.isActive ? "green" : "red"}>{a.isActive ? "Faol" : "Bloklangan"}</Badge></Td>
            <Td>{a.lastLoginAt ? dateTime(a.lastLoginAt) : "—"}</Td>
            <Td>{a.id !== me.id && <form action={toggleAdminAction.bind(null, a.id)}><Button variant="secondary" size="sm">{a.isActive ? "Bloklash" : "Yoqish"}</Button></form>}</Td>
          </Tr>
        ))}</tbody>
      </Table>
      <Card>
        <div className="mb-3 font-semibold">Mening hisobim</div>
        <div className="mb-2 text-sm font-medium text-slate-700">Parol</div>
        <OwnPasswordForm />
        <div className="mb-2 mt-6 border-t border-slate-100 pt-4 text-sm font-medium text-slate-700">Insof ECO ilovasi orqali kirish</div>
        <OwnEcoForm linkedPhone={admins.find((x) => x.id === me.id)?.ecoPhone ?? null} enabled={adminEcoEnabled()} />
      </Card>
    </div>
  );
}
