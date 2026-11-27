import { notFound } from "next/navigation";
import { Card, PageHeader } from "@/components/ui";
import { db } from "@/lib/db";
import { requirePage } from "@/lib/page-guard";
import { canDo } from "@/lib/permissions";
import { crmOptions } from "@/lib/crm/clients";
import { todayIso } from "@/lib/crm/dates";
import { T } from "@/lib/crm/labels";
import { ContactForm } from "./contact-form";

export default async function WriteContactPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ back?: string }> }) {
  const s = await requirePage("/crm/mijozlar");
  if (!canDo(s, "crm", "contact")) notFound();
  const { id } = await params;
  const { back } = await searchParams;
  const [c, results, opts] = await Promise.all([
    db.customer.findFirst({ where: { id, isInternal: false }, select: { id: true, name: true, phone: true } }),
    db.crmResult.findMany({ where: { isActive: true }, orderBy: [{ sort: "asc" }], select: { id: true, label: true, group: true, nextRule: true, defaultDays: true } }),
    crmOptions(),
  ]);
  if (!c) notFound();
  const backHref = back === "bugun" ? "/crm" : `/crm/mijozlar/${id}`;
  return (
    <div className="mx-auto max-w-xl">
      <PageHeader title={T.contact.title} subtitle={c.name} back={{ href: backHref, label: back === "bugun" ? T.today.title : c.name }} />
      <Card>
        <ContactForm customerId={c.id} today={todayIso()} results={results} channels={opts.CHANNEL} products={opts.PRODUCT} sources={opts.SOURCE} back={backHref} />
      </Card>
    </div>
  );
}
