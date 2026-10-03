import { Card, PageHeader, Callout } from "@/components/ui";
import { NewTenantForm } from "../../forms";

export const metadata = { title: "Yangi korxona" };

export default function NewTenantPage() {
  const ok = !!process.env.TENANT_DATABASE_URL?.includes("{db}");
  return (
    <div className="max-w-4xl">
      <PageHeader back={{ href: "/superadmin", label: "Umumiy holat" }} title="Yangi korxona" subtitle="Alohida baza yaratiladi, jadvallar o'rnatiladi va direktor hisobi ochiladi. Jarayonni serverda bitta buyruq bilan ishga tushirasiz." />
      {!ok && <Callout tone="danger" title="Sozlanmagan">Panel .env ida TENANT_DATABASE_URL (…/&#123;db&#125;) yo&apos;q — baza yaratib bo&apos;lmaydi.</Callout>}
      <Card><NewTenantForm baseDomain={process.env.TENANT_BASE_DOMAIN || null} /></Card>
    </div>
  );
}
