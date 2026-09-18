import { db } from "@/lib/db";
import { Badge, Button, Card, Empty, PageHeader, Table, Td, Th, Tr } from "@/components/ui";
import { SupplierForm } from "./supplier-form";
import { toggleSupplier } from "./actions";

export default async function SuppliersPage() {
  const suppliers = await db.supplier.findMany({ orderBy: { name: "asc" }, include: { _count: { select: { receipts: true } } } });
  return (
    <div>
      <PageHeader title="Yetkazuvchilar" />
      <Card className="mb-6"><SupplierForm /></Card>
      <Table>
        <thead><tr><Th>Nomi</Th><Th>INN</Th><Th>Telefon</Th><Th right>Kirimlar</Th><Th>Holat</Th><Th></Th></tr></thead>
        <tbody>
          {suppliers.length === 0 && <Empty text="Yetkazuvchilar yo'q" />}
          {suppliers.map((s) => (
            <Tr key={s.id}>
              <Td className="font-medium">{s.name}</Td><Td>{s.inn ?? "—"}</Td><Td>{s.phone ?? "—"}</Td><Td right>{s._count.receipts}</Td>
              <Td>{s.isActive ? <Badge color="green">Faol</Badge> : <Badge>Nofaol</Badge>}</Td>
              <Td><form action={toggleSupplier.bind(null, s.id)}><Button variant="secondary" className="px-2 py-1 text-xs">{s.isActive ? "O'chirish" : "Yoqish"}</Button></form></Td>
            </Tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}
