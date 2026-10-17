import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireRoles } from "@/lib/page-guard";
import { canDo } from "@/lib/permissions";
import { issueTargetOptions } from "@/lib/stock-recipients";
import { ISSUE_BACK_DAYS } from "@/lib/stock-issue";
import { FIELD_SYNONYMS } from "@/lib/excel";
import { isoDate } from "@/lib/format";
import { Callout, Card, Field, Input, PageHeader, Select } from "@/components/ui";
import { ExcelImport } from "@/components/excel-import";
import { importRasxodFromExcel } from "../actions";
import { TargetField } from "../target-select";

/**
 * Sklad → «Chiqim» → Excel orqali: fayldagi ro'yxat (nomi, miqdor) bitta chiqim hujjati bo'lib yoziladi.
 * Sklad, sana va «Kimga» — formada, butun fayl uchun bitta. Qoldiq yetmasa hech narsa yozilmaydi.
 */
export default async function RasxodImportPage() {
  const s = await requireRoles(["WAREHOUSE", "PROCUREMENT"], { module: "stock", actions: ["issue"] });
  if (!canDo(s, "stock", "issue")) redirect("/stock/rasxod");
  const [warehouses, targets] = await Promise.all([
    db.warehouse.findMany({ where: { isActive: true }, orderBy: [{ isDefault: "desc" }, { name: "asc" }], select: { id: true, name: true } }),
    issueTargetOptions(),
  ]);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const min = new Date(today); min.setDate(min.getDate() - ISSUE_BACK_DAYS);

  return (
    <div>
      <PageHeader back={{ href: "/stock/rasxod", label: "Chiqim" }} title="Excel orqali chiqim"
        subtitle="Excel faylni yuklang — qatorlar jadvalga tushadi, tekshirib tasdiqlaysiz. Hammasi bitta chiqim bo'lib yoziladi, qoldiq darhol kamayadi." />
      {warehouses.length === 0 ? (
        <Callout tone="warning" title="Sklad yo'q">Avval Sozlamalarda sklad oching.</Callout>
      ) : (
        <Card className="max-w-6xl">
          <ExcelImport
            action={importRasxodFromExcel}
            submitLabel="Chiqimni yozish"
            templateName="chiqim-namuna"
            example={{ material: "Sement M400", code: "", unit: "kg", qty: 500 }}
            merge={{ sum: ["qty"], unitKeys: ["unit"] }}
            fields={[
              { key: "material", label: "Nomi (xomashyo)", required: true, hint: "spravochnikdagi nomi", synonyms: FIELD_SYNONYMS.material },
              { key: "code", label: "Kodi", hint: "bo'lsa shu kod bo'yicha topiladi", synonyms: ["kod", "code", "код", "artikul", "артикул"] },
              { key: "unit", label: "Birlik", hint: "farq qilsa faqat kg ↔ t o'giriladi", synonyms: FIELD_SYNONYMS.unit },
              { key: "qty", label: "Miqdor", required: true, synonyms: FIELD_SYNONYMS.qty },
            ]}
          >
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Field label="Sana *"><Input name="date" type="date" defaultValue={isoDate(today)} min={isoDate(min)} max={isoDate(today)} required /></Field>
              {warehouses.length > 1 ? (
                <Field label="Sklad (Kimdan) *"><Select name="warehouseId" defaultValue={warehouses[0].id}>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</Select></Field>
              ) : <input type="hidden" name="warehouseId" value={warehouses[0].id} />}
              <Field label="Kimga *"><TargetField targets={targets} /></Field>
            </div>
            <Field label="Izoh"><Input name="note" maxLength={300} placeholder="Masalan: ta'mirga, obyekt uchun, №… zayavka bo'yicha" autoComplete="off" /></Field>
            {/* Bir martalik kalit: ikki marta bosilgan tugma ikkinchi chiqim yozmaydi */}
            <input type="hidden" name="clientToken" value={crypto.randomUUID()} />
          </ExcelImport>
        </Card>
      )}
    </div>
  );
}
