import { requireRoles } from "@/lib/page-guard";
import { PageHeader } from "@/components/ui";
import { defaultCreditLimit } from "@/lib/finance";
import { CustomerForm } from "../customer-form";

export default async function NewCustomer() {
  const s = await requireRoles(["SALES", "ACCOUNTING", "FINANCE"], { module: "customers", actions: ["edit"] });
  // Standart limit (Sozlamalar → Limitlar) — formaning boshlang'ich qiymati; huquqsiz xodimga ham shu ko'rinadi
  const defaultLimit = await defaultCreditLimit();
  return (
    <div>
      <PageHeader back={{ href: "/customers", label: "Mijozlar" }} title="Yangi mijoz" />
      <CustomerForm customer={null} canEditLimit={["FINANCE", "ACCOUNTING", "DIRECTOR"].includes(s.role)} defaultLimit={defaultLimit} />
    </div>
  );
}
