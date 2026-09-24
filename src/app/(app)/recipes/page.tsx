import { db } from "@/lib/db";
import { qty } from "@/lib/format";
import { FileSpreadsheet } from "lucide-react";
import { Callout, LinkButton, PageHeader } from "@/components/ui";
import { getSession } from "@/lib/auth";
import { RecipesTable } from "./recipes-table";

export default async function RecipesPage({ searchParams }: { searchParams: Promise<{ imported?: string }> }) {
  const { imported } = await searchParams;
  // Sahifa ruxsati avvalgidek (middleware); o'chirish esa faqat ishlab chiqarish va direktorda
  const session = await getSession();
  const canDelete = !!session && ["PRODUCTION", "DIRECTOR"].includes(session.role);
  const products = await db.product.findMany({
    where: { isActive: true },
    orderBy: { code: "asc" },
    include: { recipes: { where: { isActive: true }, include: { items: { include: { material: true } } } } },
  });
  const rows = products.map((p) => {
    const r = p.recipes[0];
    return {
      id: p.id,
      name: p.name,
      version: r?.version ?? null,
      summary: r ? r.items.map((i) => `${i.material.name} ${qty(i.qtyPerM3)} ${i.material.unit}`).join(" · ") : "",
    };
  });

  return (
    <div>
      <PageHeader
        title="Retseptlar"
        subtitle="Har bir mahsulot uchun 1 birlikka (m³ yoki dona) xomashyo normasi. Bitta bosish tanlaydi, ikki marta bosish ochadi — 1C dagidek. Yangi versiya yaratiladi, eskisi tarixda qoladi."
        action={<LinkButton href="/recipes/import" variant="secondary"><FileSpreadsheet size={16} /> Excel orqali</LinkButton>}
      />
      {imported && <Callout tone="success" title="Excel import bajarildi">{imported} ta mahsulot uchun yangi retsept versiyasi saqlandi.</Callout>}
      <RecipesTable products={rows} canDelete={canDelete} />
    </div>
  );
}
