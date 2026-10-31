import { requireAdmin } from "@/lib/control/auth";
import { roleDeniedText } from "@/lib/control/roles";
import { Card, Callout } from "@/components/ui";
import { PageHeader } from "../../../_ui";
import { NewTenantForm } from "../../forms";
import { HelpButton, PageHelp } from "../../_help/help";

export const metadata = { title: "Yangi korxona" };

export default async function NewTenantPage() {
  const me = await requireAdmin(); // layout ham tekshiradi; sahifa o'zi ham himoyalangan bo'lsin (layout'siz render/qayta foydalanish)
  const denied = roleDeniedText(me.role, "OWNER");
  const ok = !!process.env.TENANT_DATABASE_URL?.includes("{db}");
  return (
    <div className="max-w-4xl">
      <PageHeader back={{ href: "/superadmin", label: "Umumiy holat" }} title={<>Yangi korxona <PageHelp topic="page:yangi" /></>} subtitle={<>Alohida baza yaratiladi, jadvallar o&apos;rnatiladi va direktor hisobi ochiladi. Jarayonni serverda bitta buyruq bilan ishga tushirasiz. <HelpButton topic="form:created" /> Port avtomatik beriladi <HelpButton topic="tenant:port" /></>} />
      {!ok && <Callout tone="danger" title="Sozlanmagan">Panel .env ida TENANT_DATABASE_URL (…/&#123;db&#125;) yo&apos;q — baza yaratib bo&apos;lmaydi.</Callout>}
      {denied ? <Callout tone="warning" title="Ruxsat yo'q">{denied}</Callout> : <Card><NewTenantForm baseDomain={process.env.TENANT_BASE_DOMAIN || null} /></Card>}
    </div>
  );
}
