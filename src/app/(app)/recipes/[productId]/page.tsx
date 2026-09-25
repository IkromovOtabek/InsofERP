import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { qty, date, money } from "@/lib/format";
import { Badge, Card, DL, LinkButton, PageHeader, Table, Td, Th, Tr } from "@/components/ui";
import { RecipeForm } from "../recipe-form";
import { unitLabel } from "@/lib/unit";
import { ingredientOf } from "@/lib/recipe";
import { productCatalog } from "@/lib/product-catalog";
import { canEditMaterials, canEditProducts } from "@/lib/catalog";
import type { IngredientGroup, IngredientRow } from "@/components/ingredient-picker";
import { Pencil } from "lucide-react";

export default async function RecipePage({ params }: { params: Promise<{ productId: string }> }) {
  const { productId } = await params;
  const s = await requireSession(["PRODUCTION"]);
  const [p, materials, materialGroups, catalog] = await Promise.all([
    db.product.findUnique({
      where: { id: productId },
      include: { group: true, recipes: { orderBy: { version: "desc" }, include: { items: { include: { material: true, product: true } } } } },
    }),
    db.material.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
    db.materialGroup.findMany({ where: { isActive: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, code: true, name: true, parentId: true } }),
    // Mahsulot ro'yxati hamma joydagi bilan bir xil; o'zini o'ziga ingredient qilmaslik uchun joriy mahsulot chiqariladi
    productCatalog({ exclude: productId }),
  ]);
  if (!p) notFound();
  const active = p.recipes.find((r) => r.isActive);

  // Xomashyo + mahsulot spravochnigi bitta ro'yxatda — retsept qatoriga shu yerdan tanlanadi
  const ingredients: IngredientRow[] = [
    ...materials.map((m) => ({ id: m.id, kind: "material" as const, name: m.name, code: m.code, unit: m.unit, groupId: m.groupId })),
    ...catalog.products.map((x) => ({ id: x.id, kind: "product" as const, name: x.name, code: x.code, unit: x.rawUnit, groupId: x.groupId })),
  ];
  // Papka qaysi ro'yxatdan ekani belgilanadi — ochiq papkaga to'g'ri turdagi yozuv qo'shish uchun
  const groups: IngredientGroup[] = [
    ...materialGroups.map((g) => ({ ...g, kind: "material" as const })),
    ...catalog.groups.map((g) => ({ ...g, kind: "product" as const })),
  ];
  const initial = active
    ? active.items.map((i) => {
        const ing = ingredientOf(i);
        return { ing: { id: ing.key, kind: ing.kind, name: ing.name, code: (i.material ?? i.product)!.code, unit: ing.unit, groupId: (i.material ?? i.product)!.groupId }, qtyPerM3: ing.qtyPerM3.toString() };
      })
    : [];

  return (
    <div>
      <PageHeader
        back={{ href: "/recipes", label: "Retseptlar" }}
        title={`Retsept: ${p.name}`}
        subtitle={active ? `Faol versiya v${active.version} · ${date(active.createdAt)}` : "Hali retsept yo'q"}
      />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="space-y-4">
          {/* Mahsulotning o'z ma'lumotlari — 1C dagi tovar kartasi tepasidagi kabi; tahrirlash Sozlamalarda */}
          <Card>
            <div className="mb-2 flex items-center justify-between gap-2">
              <h2 className="font-semibold">Mahsulot</h2>
              <LinkButton href="/settings?tab=products" variant="ghost" size="sm"><Pencil size={13} /> Tahrirlash</LinkButton>
            </div>
            <DL items={[
              { k: "Kod", v: p.code },
              { k: "Tovar turi", v: p.kind ?? "—" },
              { k: "Bo'lim", v: p.group?.name ?? "Ro'yxat ildizi" },
              { k: "O'lchov birligi", v: unitLabel(p.unit) },
              { k: "Sotuv narxi", v: money(p.price) },
            ]} />
          </Card>
          <Card>
            <h2 className="mb-3 font-semibold">{active ? "Yangi versiya" : "Birinchi versiya"}</h2>
            <RecipeForm productId={productId} unit={unitLabel(p.unit)} ingredients={ingredients} groups={groups} canCreateMaterial={canEditMaterials(s.role)} canCreateProduct={canEditProducts(s.role)} initial={initial} />
          </Card>
        </div>
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
                  <thead><tr><Th>Xomashyo / mahsulot</Th><Th right>1 {unitLabel(p.unit)} ga</Th></tr></thead>
                  <tbody>{r.items.map((i) => { const ing = ingredientOf(i); return (
                    <Tr key={i.id}>
                      <Td>{ing.name}{ing.kind === "product" && <Badge color="blue" dot={false}>Mahsulot</Badge>}</Td>
                      <Td right>{qty(ing.qtyPerM3)} {ing.unit}</Td>
                    </Tr>
                  ); })}</tbody>
                </Table>
              </Card>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
