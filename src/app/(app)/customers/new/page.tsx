import { requireRoles } from "@/lib/page-guard";
import { PageHeader } from "@/components/ui";
import { CustomerForm } from "../customer-form";

export default async function NewCustomer() {
  const s = await requireRoles(["SALES", "ACCOUNTING", "FINANCE"], { module: "customers", actions: ["edit"] });
  return (
    <div>
      <PageHeader back={{ href: "/customers", label: "Mijozlar" }} title="Yangi mijoz" />
      <CustomerForm customer={null} canEditLimit={["FINANCE", "ACCOUNTING", "DIRECTOR"].includes(s.role)} />
    </div>
  );
}
