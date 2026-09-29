import { requireSession } from "@/lib/auth";
import { driverEmployees } from "@/lib/logistics";
import { Card, PageHeader } from "@/components/ui";
import { VehicleForm } from "../vehicle-form";

export default async function NewVehiclePage() {
  await requireSession(["LOGISTICS"]);
  const drivers = await driverEmployees({ activeOnly: true });
  return (
    <div>
      <PageHeader back={{ href: "/logistika/transport", label: "Transport" }} title="Yangi transport" subtitle="Saqlangach haydovchi ilovasiga (ECO) ham yuboriladi" />
      <Card><VehicleForm drivers={drivers.map((d) => ({ id: d.id, name: d.fullName }))} /></Card>
    </div>
  );
}
