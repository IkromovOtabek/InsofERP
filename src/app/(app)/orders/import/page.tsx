import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { isoDate } from "@/lib/format";
import { Callout, Card, Checkbox, Field, Input, PageHeader, Textarea } from "@/components/ui";
import { ExcelImport } from "@/components/excel-import";
import { FIELD_SYNONYMS } from "@/lib/excel";
import { importOrdersFromExcel } from "../actions";

/**
 * Zayavkalar → Excel orqali. Ikki ko'rinishdagi fayl qabul qilinadi:
 *  · ro'yxat — har qator bitta mijoz × mahsulot × miqdor;
 *  · matritsa (kesishma jadval) — ustunlar mijoz/obyekt, qatorlar mahsulot, katak miqdor (sotuvchilar shu ko'rinishda yuritadi).
 * Mijoz + yetkazish sanasi bo'yicha guruhlanib qoralama zayavkalar ochiladi.
 */
export default async function OrdersImport() {
  await requireSession(["SALES"]);
  const products = await db.product.findMany({ where: { isActive: true }, orderBy: { code: "asc" }, select: { code: true, unit: true } });
  return (
    <div>
      <PageHeader
        back={{ href: "/orders", label: "Zayavkalar" }}
        title="Excel orqali zayavka"
        subtitle="Faylni yuklang — qatorlar jadvalga tushadi, tekshirib tasdiqlaysiz. Har mijozning har yetkazish sanasi uchun alohida qoralama zayavka ochiladi."
      />
      <Card className="max-w-6xl">
        <Callout tone="info" title="Kesishma jadval ham bo'ladi">
          Ustunlar mijoz/obyekt, qatorlar mahsulot, kataklar miqdor bo&apos;lgan fayl o&apos;zi tanilib, har to&apos;ldirilgan katak bitta zayavka
          qatoriga yoyiladi. Qoldiq (&ldquo;22-sent.&rdquo;) va &ldquo;Итого&rdquo; ustunlari hisobga olinmaydi — qoldiqni tizim o&apos;zi hisoblaydi.
          Kataklarning rangi o&apos;qilmaydi: hamma zayavka <b>qoralama</b> bo&apos;lib tushadi, keraksizini qabul qilmaysiz.
        </Callout>
        <div className="mt-4">
          <ExcelImport
            action={importOrdersFromExcel}
            submitLabel="Zayavkalarni ochish"
            templateName="zayavka-namuna"
            example={{ customer: "Эсо Картон", product: products[0]?.code ?? "M300", unit: products[0]?.unit ?? "dona", qty: 12, date: isoDate(), price: "" }}
            merge={{ sum: ["qty"], unitKeys: ["unit"] }}
            matrix={{ colKey: "customer", rowKey: "product", qtyKey: "qty", unitKey: "unit", dateKey: "date" }}
            fields={[
              { key: "customer", label: "Mijoz / obyekt", required: true, hint: "matritsada — ustun nomi", synonyms: ["mijoz", "zakazchi", "obyekt", "клиент", "заказчик", "объект", "customer", "buyurtmachi"] },
              { key: "product", label: "Mahsulot", required: true, hint: "kodi yoki nomi", synonyms: FIELD_SYNONYMS.product },
              { key: "unit", label: "Birlik", hint: "faqat ko'rish uchun — birlik mahsulotdan olinadi", synonyms: FIELD_SYNONYMS.unit },
              { key: "qty", label: "Miqdor", required: true, synonyms: FIELD_SYNONYMS.qty },
              { key: "date", label: "Yetkazish sanasi", hint: "bo'sh bo'lsa pastdagi standart sana", synonyms: ["sana", "yetkazish", "muddat", "дата", "срок", "date"] },
              { key: "price", label: "Narx", hint: "bo'sh bo'lsa mahsulotning bazaviy narxi", synonyms: FIELD_SYNONYMS.price },
            ]}
          >
            <Field label="Standart yetkazish sanasi *" hint="Faylda sana ko'rsatilmagan qatorlar shu sanaga tushadi">
              <Input name="defaultDate" type="date" defaultValue={isoDate()} required />
            </Field>
            <Field label="Izoh"><Textarea name="note" placeholder="Masalan: sentabr oyi rejasi" className="min-h-11" /></Field>
            <Checkbox name="createCustomers" defaultChecked label="Ro'yxatda yo'q mijozlarni yaratish (ustun nomi mijoz nomi bo'ladi)" />
            <Checkbox name="onCredit" label="Qarzga — kafolat xati talab qilinadi" />
          </ExcelImport>
        </div>
      </Card>
    </div>
  );
}
