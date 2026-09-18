import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { qty, date } from "@/lib/format";
import { Badge, Card, PageHeader, Table, Td, Th, Tr } from "@/components/ui";
import { RecipeForm } from "../recipe-form";
import { unitLabel } from "@/lib/unit";

export default async function RecipePage({ params }: { params: Promise<{ productId: string }> }) {
  const { productId } = await params;
  await requireSession(["PRODUCTION"]);
  const [p, materials] = await Promise.all([
    db.product.findUnique({ where: { id: productId }, include: { recipes: { orderBy: { version: "desc" }, include: { items: { include: { material: true } } } } } }),
    db.material.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
  ]);
  if (!p) notFound();
  const active = p.recipes.find((r) => r.isActive);

  return (
    <div>
      <PageHeader title={`Retsept: ${p.name}`} subtitle={active ? `Faol versiya v${active.version} · ${date(active.createdAt)}` : "Hali retsept yo'q"} />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="mb-3 font-semibold">{active ? "Yangi versiya" : "Birinchi versiya"}</h2>
          <RecipeForm productId={productId} unit={unitLabel(p.unit)} materials={materials.map((m) => ({ id: m.id, name: m.name, unit: m.unit }))} initial={active ? active.items.map((i) => ({ materialId: i.materialId, qtyPerM3: i.qtyPerM3.toString() })) : []} />
        </Card>
        <div>
          <h2 className="mb-3 font-semibold">Versiyalar tarixi</h2>
          <div className="space-y-3">
            {p.recipes.map((r) => (
              <Card key={r.id} className={r.isActive ? "border-emerald-300" : ""}>
                <div className="mb-2 flex items-center justify-between">
                  <div className="font-medium">v{r.version} <span className="text-sm font-normal text-slate-500">· {date(r.createdAt)}</span></div>
                  {r.isActive ? <Badge color="green">Faol</Badge> : <Badge>Arxiv</Badge>}
                </div>
                {r.note && <p className="mb-2 text-sm text-slate-600">{r.note}</p>}
                <Table>
                  <thead><tr><Th>Xomashyo</Th><Th right>1 {unitLabel(p.unit)} ga</Th></tr></thead>
                  <tbody>{r.items.map((i) => <Tr key={i.id}><Td>{i.material.name}</Td><Td right>{qty(i.qtyPerM3)} {i.material.unit}</Td></Tr>)}</tbody>
                </Table>
              </Card>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
