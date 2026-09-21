import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { isoDate } from "@/lib/format";
import { Card, Checkbox, Field, Input, PageHeader, Select, Textarea } from "@/components/ui";
import { ExcelImport } from "@/components/excel-import";
import { FIELD_SYNONYMS } from "@/lib/excel";
import { importReceiptFromExcel } from "../actions";

/** Kirim → Excel orqali: zavod va texnikaga kerakli mahsulotlar ro'yxati bitta kirim hujjati sifatida, ko'p qator birdan. */
export default async function ReceiptImport() {
  await requireSession(["PROCUREMENT", "WAREHOUSE"]);
  const [suppliers, warehouses] = await Promise.all([
    db.supplier.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
    db.warehouse.findMany({ where: { isActive: true } }),
  ]);
  return (
    <div>
      <PageHeader back={{ href: "/receipts", label: "Kirim" }} title="Excel orqali kirim" subtitle="Zavod va texnikaga kerakli mahsulotlar ro'yxatini Excel'dan yuklang — har qator sklad qoldig'iga tushadi. 8 ta ustun fayldan o'qiladi." />
      <Card className="max-w-6xl">
        <ExcelImport
          action={importReceiptFromExcel}
          submitLabel="Kirimni qayd etish"
          templateName="kirim-namuna"
          example={{ material: "Dizel yoqilg'isi", code: "DIZEL", unit: "l", qty: 500, price: 12000, nds: 720000, sum: 6000000, note: "Nakladnoy 123" }}
          amountCols={{ qtyKey: "qty", priceKey: "price", sumKey: "sum", ndsKey: "nds" }}
          fields={[
            { key: "material", label: "Mahsulot / xomashyo", required: true, hint: "nomi yoki kodi", synonyms: FIELD_SYNONYMS.material },
            { key: "code", label: "Kodi", hint: "bo'lsa shu kod bo'yicha topiladi", synonyms: ["kod", "code", "код", "artikul", "артикул"] },
            { key: "unit", label: "Birlik", hint: "yangi mahsulot uchun (kg, l, dona)", synonyms: FIELD_SYNONYMS.unit },
            { key: "qty", label: "Miqdor", required: true, synonyms: FIELD_SYNONYMS.qty },
            { key: "price", label: "Narx (birlik)", hint: "bo'sh bo'lsa 0", synonyms: FIELD_SYNONYMS.price },
            { key: "nds", label: "NDS", hint: "fayldan olinadi", synonyms: FIELD_SYNONYMS.nds },
            { key: "sum", label: "Summa", hint: "fayldan olinadi", synonyms: FIELD_SYNONYMS.sum },
            { key: "note", label: "Izoh", hint: "qator izohi", synonyms: ["izoh", "note", "примеч", "коммент", "tavsif"] },
          ]}
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field label="Yetkazuvchi *">
              <Select name="supplierId" defaultValue="" required>
                <option value="" disabled>Tanlang…</option>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
            </Field>
            <Field label="Sklad *"><Select name="warehouseId" defaultValue={warehouses[0]?.id}>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</Select></Field>
            <Field label="Sana *"><Input name="date" type="date" defaultValue={isoDate()} required /></Field>
          </div>
          <Field label="Izoh"><Textarea name="note" placeholder="Nakladnoy raqami, mashina…" className="min-h-11" /></Field>
          <Checkbox name="createMissing" defaultChecked label="Ro'yxatda yo'q mahsulotlarni avtomatik yaratish (xomashyo sifatida)" />
        </ExcelImport>
      </Card>
    </div>
  );
}
