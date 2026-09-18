import { db } from "@/lib/db";
import { qty } from "@/lib/format";
import { Badge, Button, Card, Empty, PageHeader, Table, Td, Th, Tr } from "@/components/ui";
import { VehicleForm } from "./vehicle-form";
import { toggleVehicle } from "./actions";

const TYPE: Record<string, string> = { MIXER: "Mikser", PUMP: "Nasos", TRUCK: "Yuk mashina" };

export default async function VehiclesPage() {
  const vehicles = await db.vehicle.findMany({ orderBy: { plate: "asc" }, include: { _count: { select: { trips: true } } } });
  return (
    <div>
      <PageHeader title="Texnika" />
      <Card className="mb-6"><VehicleForm /></Card>
      <Table>
        <thead><tr><Th>Raqam</Th><Th>Turi</Th><Th right>Sig'imi</Th><Th right>Reyslar</Th><Th>Holat</Th><Th></Th></tr></thead>
        <tbody>
          {vehicles.length === 0 && <Empty text="Texnika yo'q" />}
          {vehicles.map((v) => (
            <Tr key={v.id}>
              <Td className="font-medium">{v.plate}</Td><Td>{TYPE[v.type]}</Td><Td right>{v.capacityM3 ? `${qty(v.capacityM3)} m³` : "—"}</Td><Td right>{v._count.trips}</Td>
              <Td>{v.isActive ? <Badge color="green">Faol</Badge> : <Badge>Nofaol</Badge>}</Td>
              <Td><form action={toggleVehicle.bind(null, v.id)}><Button variant="secondary" className="px-2 py-1 text-xs">{v.isActive ? "O'chirish" : "Yoqish"}</Button></form></Td>
            </Tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}
