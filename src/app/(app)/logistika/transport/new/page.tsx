import { requireRoles } from "@/lib/page-guard";
import { vehicleFormDrivers } from "@/lib/logistics";
import { Card, PageHeader } from "@/components/ui";
import { VehicleForm } from "../vehicle-form";

export default async function NewVehiclePage() {
  await requireRoles(["LOGISTICS", "DISPATCHER"], { module: "logistika", actions: ["vehicle"] });
  const drivers = await vehicleFormDrivers();
  return (
    <div>
      <PageHeader back={{ href: "/logistika/transport", label: "Transport" }} title="Yangi transport" subtitle="Saqlangach haydovchi ilovasiga (ECO) ham yuboriladi" />
      <Card><VehicleForm drivers={drivers} /></Card>
    </div>
  );
}
