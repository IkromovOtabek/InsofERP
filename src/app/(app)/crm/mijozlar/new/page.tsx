import { notFound } from "next/navigation";
import { Card, PageHeader } from "@/components/ui";
import { requirePage } from "@/lib/page-guard";
import { canDo } from "@/lib/permissions";
import { crmOptions, crmUsers } from "@/lib/crm/clients";
import { T } from "@/lib/crm/labels";
import { ClientForm } from "../client-form";

export default async function NewCrmClient() {
  const s = await requirePage("/crm/mijozlar");
  if (!canDo(s, "crm", "client")) notFound();
  const manager = canDo(s, "crm", "manage");
  const [opts, users] = await Promise.all([crmOptions(), manager ? crmUsers() : []]);
  return (
    <div>
      <PageHeader title={T.form.newTitle} back={{ href: "/crm/mijozlar", label: T.clients.title }} />
      <Card>
        <ClientForm id={null} sources={opts.SOURCE} clientTypes={opts.CLIENT_TYPE} users={users} manager={manager} cancelHref="/crm/mijozlar"
          values={{ name: "", inn: "", phone: "", contactPerson: "", region: "", district: "", objectType: "", foremanName: "", foremanPhone: "",
            clientTypeId: "", sourceId: "", ownerId: s.userId, crmStatus: "", link: "", crmNote: "" }} />
      </Card>
    </div>
  );
}
