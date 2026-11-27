import { notFound } from "next/navigation";
import { Card, PageHeader } from "@/components/ui";
import { db } from "@/lib/db";
import { requirePage } from "@/lib/page-guard";
import { canDo } from "@/lib/permissions";
import { crmOptions, crmUsers } from "@/lib/crm/clients";
import { T } from "@/lib/crm/labels";
import { ClientForm } from "../../client-form";

export default async function EditCrmClient({ params }: { params: Promise<{ id: string }> }) {
  const s = await requirePage("/crm/mijozlar");
  if (!canDo(s, "crm", "client")) notFound();
  const { id } = await params;
  const c = await db.customer.findFirst({ where: { id, isInternal: false } });
  if (!c) notFound();
  const manager = canDo(s, "crm", "manage");
  const [opts, users] = await Promise.all([crmOptions([c.sourceId, c.clientTypeId]), manager ? crmUsers(c.ownerId) : []]);
  const v = (x: string | null) => x ?? "";
  return (
    <div>
      <PageHeader title={T.form.editTitle} subtitle={c.name} back={{ href: `/crm/mijozlar/${id}`, label: c.name }} />
      <Card>
        <ClientForm id={id} sources={opts.SOURCE} clientTypes={opts.CLIENT_TYPE} users={users} manager={manager} cancelHref={`/crm/mijozlar/${id}`}
          values={{ name: c.name, inn: v(c.inn), phone: v(c.phone), contactPerson: v(c.contactPerson), region: v(c.region), district: v(c.district),
            objectType: v(c.objectType), foremanName: v(c.foremanName), foremanPhone: v(c.foremanPhone), clientTypeId: v(c.clientTypeId),
            sourceId: v(c.sourceId), ownerId: c.crmAt ? v(c.ownerId) : s.userId, crmStatus: c.crmStatusManual && c.crmStatus ? c.crmStatus : "",
            link: v(c.link), crmNote: v(c.crmNote) }} />
      </Card>
    </div>
  );
}
