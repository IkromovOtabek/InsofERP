import Link from "next/link";
import { db } from "@/lib/db";
import { qty } from "@/lib/format";
import { FileSpreadsheet } from "lucide-react";
import { Badge, Callout, LinkButton, PageHeader, Table, Td, Th, Tr } from "@/components/ui";

export default async function RecipesPage({ searchParams }: { searchParams: Promise<{ imported?: string }> }) {
  const { imported } = await searchParams;
  const products = await db.product.findMany({
    where: { isActive: true },
    orderBy: { code: "asc" },
    include: { recipes: { where: { isActive: true }, include: { items: { include: { material: true } } } } },
  });
  return (
    <div>
      <PageHeader title="Retseptlar" subtitle="Har bir mahsulot uchun 1 birlikka (m³ yoki dona) xomashyo normasi. Yangi versiya yaratiladi, eskisi tarixda qoladi." action={<LinkButton href="/recipes/import" variant="secondary"><FileSpreadsheet size={16} /> Excel orqali</LinkButton>} />
      {imported && <Callout tone="success" title="Excel import bajarildi">{imported} ta mahsulot uchun yangi retsept versiyasi saqlandi.</Callout>}
      <Table>
        <thead><tr><Th>Mahsulot</Th><Th>Versiya</Th><Th>Tarkib (1 birlik)</Th><Th></Th></tr></thead>
        <tbody>
          {products.map((p) => {
            const r = p.recipes[0];
            return (
              <Tr key={p.id}>
                <Td><Link href={`/recipes/${p.id}`} className="font-medium hover:underline">{p.name}</Link></Td>
                <Td>{r ? <Badge color="green">v{r.version}</Badge> : <Badge color="red">Retsept yo'q</Badge>}</Td>
                <Td className="text-slate-600">{r ? r.items.map((i) => `${i.material.name} ${qty(i.qtyPerM3)} ${i.material.unit}`).join(" · ") : "—"}</Td>
                <Td><Link href={`/recipes/${p.id}`} className="text-sm hover:underline">Ochish →</Link></Td>
              </Tr>
            );
          })}
        </tbody>
      </Table>
    </div>
  );
}
