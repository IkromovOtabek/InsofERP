import Link from "next/link";
import { db } from "@/lib/db";
import { FileSpreadsheet } from "lucide-react";
import { Badge, Button, Card, Empty, LinkButton, PageHeader, Table, Td, Th, Tr } from "@/components/ui";
import { SupplierForm } from "./supplier-form";
import { deleteSupplier, toggleSupplier } from "./actions";
import { requirePage } from "@/lib/page-guard";
import { canDo } from "@/lib/permissions";
import { DeleteButton } from "@/components/delete-button";

export default async function SuppliersPage() {
  const session = await requirePage("/suppliers");
  // Qo'shish, nofaol qilish va o'chirish — server action'lar bilan bir xil huquq (stock → suppliers)
  const canEdit = canDo(session, "stock", "suppliers");
  const suppliers = await db.supplier.findMany({ orderBy: { name: "asc" }, include: { _count: { select: { receipts: true } } } });
  return (
    <div>
      <PageHeader title="Yetkazuvchilar" action={<LinkButton href="/suppliers/import" variant="secondary"><FileSpreadsheet size={16} /> Excel import</LinkButton>} />
      {canEdit && <Card className="mb-6"><SupplierForm /></Card>}
      <Table>
        <thead><tr><Th>Nomi</Th><Th>INN</Th><Th>Telefon</Th><Th right>Kirimlar</Th><Th>Holat</Th><Th></Th></tr></thead>
        <tbody>
          {suppliers.length === 0 && <Empty text="Yetkazuvchilar yo'q" />}
          {suppliers.map((s) => (
            <Tr key={s.id}>
              <Td className="font-medium"><Link href={`/suppliers/${s.id}`} data-no-translit className="hover:underline">{s.name}</Link></Td><Td>{s.inn ?? "—"}</Td><Td>{s.phone ?? "—"}</Td><Td right>{s._count.receipts}</Td>
              <Td>{s.isActive ? <Badge color="green">Faol</Badge> : <Badge>Nofaol</Badge>}</Td>
              <Td>
                <div className="flex items-center justify-end gap-2">
                  <Link href={`/suppliers/${s.id}`} className="rounded-lg px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100">Karta</Link>
                  {/* Nofaol — ro'yxatlardan yashiriladi; o'chirish — faqat hujjatsiz yetkazuvchi, aks holda nofaol qilinadi */}
                  {canEdit && <form action={toggleSupplier.bind(null, s.id)}><Button variant="secondary" className="px-2 py-1 text-xs">{s.isActive ? "Nofaol qilish" : "Faollashtirish"}</Button></form>}
                  {canEdit && <DeleteButton action={deleteSupplier} id={s.id} name={s.name} title="Yetkazuvchini o'chirish" />}
                </div>
              </Td>
            </Tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}
