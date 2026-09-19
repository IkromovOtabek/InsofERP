import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { Card, Checkbox, PageHeader } from "@/components/ui";
import { ExcelImport } from "@/components/excel-import";
import { FIELD_SYNONYMS } from "@/lib/excel";
import { importRecipesFromExcel } from "../actions";

/** Retseptlar → Excel orqali: bir faylda bir nechta mahsulot retsepti, har biri uchun yangi faol versiya. */
export default async function RecipeImport() {
  await requireSession(["PRODUCTION", "WAREHOUSE", "PROCUREMENT"]);
  const [products, materials] = await Promise.all([
    db.product.findMany({ where: { isActive: true }, orderBy: { code: "asc" }, select: { code: true } }),
    db.material.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { name: true, unit: true } }),
  ]);
  return (
    <div>
      <PageHeader back={{ href: "/recipes", label: "Retseptlar" }} title="Excel orqali retsept" subtitle="Har qator: mahsulot, xomashyo, 1 birlikka miqdor. Bir faylda bir nechta mahsulot bo'lishi mumkin." />
      <Card>
        <ExcelImport
          action={importRecipesFromExcel}
          submitLabel="Retseptlarni import qilish"
          templateName="retsept-namuna"
          example={{ product: products[0]?.code ?? "M300", material: materials[0]?.name ?? "Sement M400", qty: 380, unit: materials[0]?.unit ?? "kg" }}
          fields={[
            { key: "product", label: "Mahsulot", required: true, hint: "kodi (M300) yoki nomi", synonyms: FIELD_SYNONYMS.product },
            { key: "material", label: "Xomashyo", required: true, hint: "nomi yoki kodi", synonyms: FIELD_SYNONYMS.material.filter((x) => x !== "mahsulot") },
            { key: "qty", label: "Miqdor (1 birlikka)", required: true, hint: "masalan 380", synonyms: FIELD_SYNONYMS.qty },
            { key: "unit", label: "Birlik", hint: "yangi xomashyo uchun (kg, l, dona)", synonyms: FIELD_SYNONYMS.unit },
          ]}
        >
          <Checkbox name="createMissing" defaultChecked label="Ro'yxatda yo'q xomashyolarni avtomatik yaratish" />
        </ExcelImport>
      </Card>
    </div>
  );
}
