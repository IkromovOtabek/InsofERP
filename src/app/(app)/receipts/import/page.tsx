import { db } from "@/lib/db";
import { requireRoles } from "@/lib/page-guard";
import { isoDate } from "@/lib/format";
import { Card, Checkbox, Field, Input, PageHeader, Select, Textarea } from "@/components/ui";
import { ExcelImport } from "@/components/excel-import";
import { FIELD_SYNONYMS } from "@/lib/excel";
import { visionEnabled } from "@/lib/ai/vision";
import { supplierVatRate } from "@/lib/receipt-vat";
import { importReceiptFromExcel } from "../actions";

/** Kirim → Excel orqali: zavod va texnikaga kerakli mahsulotlar ro'yxati bitta kirim hujjati sifatida, ko'p qator birdan. */
export default async function ReceiptImport() {
  await requireRoles(["PROCUREMENT", "WAREHOUSE"], { module: "stock", actions: ["receipt"] });
  const [suppliers, warehouses] = await Promise.all([
    db.supplier.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
    db.warehouse.findMany({ where: { isActive: true } }),
  ]);
  return (
    <div>
      <PageHeader back={{ href: "/receipts", label: "Kirim" }} title="Excel yoki kamera orqali kirim" subtitle="Nakladnoyni kamera bilan suratga oling yoki Excel faylni yuklang — qatorlar jadvalga o'zi tushadi, tekshirib tasdiqlaysiz. Har qator sklad qoldig'iga qo'shiladi. QQS to'lovchisi yetkazuvchida 12% QQS hisoblanadi — to'lanadigan jami QQS bilan." />
      <Card className="max-w-6xl">
        <ExcelImport
          action={importReceiptFromExcel}
          submitLabel="Kirimni qayd etish"
          templateName="kirim-namuna"
          example={{ material: "Dizel yoqilg'isi", code: "DIZEL", unit: "l", qty: 500, price: 12000, nds: 720000, sum: 6000000, note: "Nakladnoy 123" }}
          amountCols={{
            qtyKey: "qty", priceKey: "price", sumKey: "sum", ndsKey: "nds",
            // QQS: oldindan ko'rish server bilan bir xil — stavka yetkazuvchidan, "Narxlar QQS bilan" belgisi hisobga olinadi
            vat: { supplierName: "supplierId", supplierRates: Object.fromEntries(suppliers.map((s) => [s.id, supplierVatRate(s.vatPayer)])), inclusiveName: "pricesWithVat", grossPriceKey: "priceVat", grossSumKey: "sumVat" },
          }}
          merge={{ sum: ["qty", "nds", "sum", "sumVat"], unitKeys: ["unit"] }}
          scan={{ endpoint: "/api/scan/receipt", enabled: visionEnabled(), label: "Nakladnoyni skaner qilish", meta: { supplier: "supplierId", date: "date", docNo: "note" } }}
          fields={[
            { key: "material", label: "Mahsulot / xomashyo", required: true, hint: "nomi yoki kodi", synonyms: FIELD_SYNONYMS.material },
            { key: "code", label: "Kodi", hint: "bo'lsa shu kod bo'yicha topiladi", synonyms: ["kod", "code", "код", "artikul", "артикул"] },
            { key: "unit", label: "Birlik", hint: "yangi mahsulot uchun (kg, l, dona)", synonyms: FIELD_SYNONYMS.unit },
            { key: "qty", label: "Miqdor", required: true, synonyms: FIELD_SYNONYMS.qty },
            // QQS bilan ustunlar oddiy "Narx"/"Summa"/"NDS" dan oldin: "Цена с НДС" sarlavhasi "Narx" ga tushib qolmasin
            { key: "priceVat", label: "Narx QQS bilan", hint: "bo'lsa QQS ichidan ajratiladi", synonyms: FIELD_SYNONYMS.priceVat },
            { key: "price", label: "Narx (birlik)", hint: "QQS'siz (yoki pastdagi belgi bilan — QQS bilan); bo'sh bo'lsa 0", synonyms: FIELD_SYNONYMS.price },
            { key: "sumVat", label: "Summa QQS bilan", hint: "narx bo'lmasa: summa / miqdor", synonyms: FIELD_SYNONYMS.sumVat },
            { key: "nds", label: "NDS", hint: "fayldan olinadi", synonyms: FIELD_SYNONYMS.nds },
            { key: "sum", label: "Summa", hint: "QQS'siz; narx bo'lmasa: summa / miqdor", synonyms: FIELD_SYNONYMS.sum },
            { key: "note", label: "Izoh", hint: "qator izohi", synonyms: ["izoh", "note", "примеч", "коммент", "tavsif"] },
          ]}
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field label="Yetkazuvchi *">
              <Select name="supplierId" defaultValue="" required>
                <option value="" disabled>Tanlang…</option>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}{s.vatPayer ? "" : " (QQS'siz)"}</option>)}
              </Select>
            </Field>
            <Field label="Sklad *"><Select name="warehouseId" defaultValue={warehouses[0]?.id}>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</Select></Field>
            <Field label="Sana *"><Input name="date" type="date" defaultValue={isoDate()} required /></Field>
          </div>
          <Field label="Izoh"><Textarea name="note" placeholder="Nakladnoy raqami, mashina…" className="min-h-11" /></Field>
          {/* Bir martalik kalit: ikki marta bosilgan tugma ikkinchi kirim ochmaydi */}
          <input type="hidden" name="clientToken" value={crypto.randomUUID()} />
          <Checkbox name="createMissing" defaultChecked label="Ro'yxatda yo'q mahsulotlarni avtomatik yaratish (xomashyo sifatida)" />
          {/* QQS: yetkazuvchi QQS to'lovchisi bo'lsa qatorga 12% QQS. Fayldagi narx QQS bilan bo'lsa — belgilang, QQS ichidan ajratiladi */}
          <Checkbox name="pricesWithVat" label="Narxlar QQS bilan («Narx» va «Summa» ustunlari QQS'ni o'z ichiga oladi)" />
        </ExcelImport>
      </Card>
    </div>
  );
}
