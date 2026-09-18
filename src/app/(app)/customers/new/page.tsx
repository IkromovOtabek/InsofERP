import { requireSession } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { CustomerForm } from "../customer-form";

export default async function NewCustomer() {
  const s = await requireSession(["SALES", "ACCOUNTING", "FINANCE"]);
  return (
    <div>
      <PageHeader title="Yangi mijoz" />
      <CustomerForm customer={null} canEditLimit={["FINANCE", "DIRECTOR"].includes(s.role)} />
    </div>
  );
}
