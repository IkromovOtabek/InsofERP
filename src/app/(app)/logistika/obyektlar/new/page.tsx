import { db } from "@/lib/db";
import { requireRoles } from "@/lib/page-guard";
import { geoSearchEnabled } from "@/lib/geo";
import { Card, PageHeader } from "@/components/ui";
import { SiteForm } from "../site-form";

export default async function NewSitePage({ searchParams }: { searchParams: Promise<{ customerId?: string }> }) {
  await requireRoles(["LOGISTICS", "SALES"], { module: "logistika", actions: ["sites"] });
  const { customerId } = await searchParams;
  const customers = await db.customer.findMany({ where: { isActive: true, isInternal: false }, orderBy: { name: "asc" }, select: { id: true, name: true } });
  return (
    <div>
      <PageHeader back={{ href: "/logistika/obyektlar", label: "Obyektlar" }} title="Yangi obyekt" />
      <Card><SiteForm customers={customers} searchEnabled={geoSearchEnabled()} s={customerId ? { id: "", customerId, name: "", address: "", lat: null, lng: null, contactName: null, contactPhone: null, deliveryHours: null, instructions: null, isActive: true } : undefined} /></Card>
    </div>
  );
}
