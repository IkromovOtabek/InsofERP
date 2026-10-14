import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireRoles } from "@/lib/page-guard";
import { canDo } from "@/lib/permissions";
import { isoDate } from "@/lib/format";
import { Card, Checkbox, Field, Input, PageHeader, Select, Textarea } from "@/components/ui";
import { ExcelImport } from "@/components/excel-import";
import { FIELD_SYNONYMS } from "@/lib/excel";
import { visionEnabled } from "@/lib/ai/vision";
import { supplierVatRate } from "@/lib/receipt-vat";
import { importReceiptFromExcel } from "@/app/(app)/receipts/actions";
import { SupplierSelect } from "./supplier-select";

/**
 * Sklad → «Kirim» → Excel orqali: ko'p qatorli nakladnoy bitta kirim hujjati bo'lib tushadi.
 * Mantiq «Kirim» bo'limidagi import bilan bitta (`importReceiptFromExcel`); saqlangach Sklad jurnaliga qaytadi (`back=prixod`).
 */
export default async function PrixodImportPage() {
  const s = await requireRoles(["PROCUREMENT", "WAREHOUSE"], { module: "stock", actions: ["receipt"] });
  if (!canDo(s, "stock", "receipt")) redirect("/stock/prixod");
  const [suppliers, warehouses] = await Promise.all([
    db.supplier.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true, vatPayer: true } }),
    db.warehouse.findMany({ where: { isActive: true }, orderBy: [{ isDefault: "desc" }, { name: "asc" }], select: { id: true, name: true } }),
  ]);
  return (
    <div>
      <PageHeader back={{ href: "/stock/prixod", label: "Kirim" }} title="Excel orqali kirim"
        subtitle="Excel faylni yuklang yoki nakladnoyni suratga oling — qatorlar jadvalga o'zi tushadi, tekshirib tasdiqlaysiz. Har qator sklad qoldig'iga qo'shiladi." />
      <Card className="max-w-6xl">
        <ExcelImport
          action={importReceiptFromExcel}
          submitLabel="Kirimni saqlash"
          templateName="kirim-namuna"
          example={{ material: "Sement M400", code: "", unit: "t", qty: 20, price: 950000, nds: 2280000, sum: 19000000, note: "" }}
          amountCols={{
            qtyKey: "qty", priceKey: "price", sumKey: "sum", ndsKey: "nds",
            vat: { supplierName: "supplierId", supplierRates: Object.fromEntries(suppliers.map((x) => [x.id, supplierVatRate(x.vatPayer)])), inclusiveName: "pricesWithVat", grossPriceKey: "priceVat", grossSumKey: "sumVat" },
          }}
          merge={{ sum: ["qty", "nds", "sum", "sumVat"], unitKeys: ["unit"] }}
          scan={{ endpoint: "/api/scan/receipt", enabled: visionEnabled(), label: "Nakladnoyni skaner qilish", meta: { supplier: "supplierId", date: "date", docNo: "note" } }}
          fields={[
            { key: "material", label: "Nomi (xomashyo)", required: true, hint: "nomi yoki kodi", synonyms: FIELD_SYNONYMS.material },
            { key: "code", label: "Kodi", hint: "bo'lsa shu kod bo'yicha topiladi", synonyms: ["kod", "code", "код", "artikul", "артикул"] },
            { key: "unit", label: "Birlik", hint: "yangi xomashyo uchun (kg, t, l, dona)", synonyms: FIELD_SYNONYMS.unit },
            { key: "qty", label: "Miqdor", required: true, synonyms: FIELD_SYNONYMS.qty },
            // QQS bilan ustunlar oddiy "Narx"/"Summa"/"NDS" dan oldin: "Цена с НДС" sarlavhasi "Narx" ga tushib qolmasin
            { key: "priceVat", label: "Narx QQS bilan", hint: "bo'lsa QQS ichidan ajratiladi", synonyms: FIELD_SYNONYMS.priceVat },
            { key: "price", label: "Narx (birlik)", hint: "QQS'siz (yoki pastdagi belgi bilan — QQS bilan); bo'sh bo'lsa 0", synonyms: FIELD_SYNONYMS.price },
            { key: "sumVat", label: "Summa QQS bilan", hint: "narx bo'lmasa: summa / miqdor", synonyms: FIELD_SYNONYMS.sumVat },
            { key: "nds", label: "QQS", hint: "fayldan olinadi", synonyms: FIELD_SYNONYMS.nds },
            { key: "sum", label: "Summa", hint: "QQS'siz; narx bo'lmasa: summa / miqdor", synonyms: FIELD_SYNONYMS.sum },
            { key: "note", label: "Izoh", hint: "qator izohi", synonyms: ["izoh", "note", "примеч", "коммент", "tavsif"] },
          ]}
        >
          <input type="hidden" name="back" value="prixod" />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field label="Kimdan (yetkazuvchi) *">
              <SupplierSelect suppliers={suppliers.map((x) => ({ ...x, rate: supplierVatRate(x.vatPayer) }))} canAdd={canDo(s, "stock", "suppliers")} vatRate={supplierVatRate(true)} />
            </Field>
            {warehouses.length > 1 ? (
              <Field label="Sklad *"><Select name="warehouseId" defaultValue={warehouses[0]?.id}>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</Select></Field>
            ) : <input type="hidden" name="warehouseId" value={warehouses[0]?.id ?? ""} />}
            <Field label="Sana *"><Input name="date" type="date" defaultValue={isoDate()} max={isoDate()} required /></Field>
          </div>
          <Field label="Izoh"><Textarea name="note" placeholder="TTN / nakladnoy raqami, mashina…" className="min-h-11" /></Field>
          {/* Bir martalik kalit: ikki marta bosilgan tugma ikkinchi kirim ochmaydi */}
          <input type="hidden" name="clientToken" value={crypto.randomUUID()} />
          <Checkbox name="createMissing" defaultChecked label="Ro'yxatda yo'q xomashyolarni avtomatik yaratish" />
          <Checkbox name="pricesWithVat" label="Narxlar QQS bilan («Narx» va «Summa» ustunlari QQS'ni o'z ichiga oladi)" />
        </ExcelImport>
      </Card>
    </div>
  );
}
