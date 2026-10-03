import { requireRoles } from "@/lib/page-guard";
import { Card, Checkbox, PageHeader } from "@/components/ui";
import { ExcelImport } from "@/components/excel-import";
import { importCustomersFromExcel } from "../actions";
import { PARTY_FIELDS } from "@/lib/party-fields";

/**
 * Mijozlar → "Excel import": real korxonaning mijozlar ro'yxati (1C / Excel'dan) bir martada kartalarga tushadi.
 * Takroriylik INN → telefon → nom bo'yicha tekshiriladi; boshlang'ich qarz alohida — "Boshlang'ich qoldiqlar" bo'limida.
 */
export default async function CustomersImportPage() {
  const s = await requireRoles(["SALES", "ACCOUNTING", "FINANCE"], { module: "customers", actions: ["edit"] });
  const canLimit = ["FINANCE", "ACCOUNTING", "DIRECTOR"].includes(s.role);
  return (
    <div>
      <PageHeader
        back={{ href: "/customers", label: "Mijozlar" }}
        title="Excel orqali mijoz qo'shish"
        subtitle="Har qator — mijoz kartasi. INN (bo'lmasa telefon, keyin nomi) bo'yicha bazada bor mijoz topilsa yangi karta ochilmaydi. Boshlang'ich qarzlar — «Boshlang'ich qoldiqlar» bo'limida."
      />
      <Card className="max-w-6xl">
        <ExcelImport
          action={importCustomersFromExcel}
          submitLabel="Mijozlarni qo'shish"
          templateName="mijozlar-namuna"
          example={{ name: "\"QURILISH INVEST\" MCHJ", inn: "305123456", phone: "+998 90 123 45 67", address: "Toshkent sh., Chilonzor t., 5-uy", contactPerson: "Karimov Anvar (ta'minotchi)", creditLimit: 100000000 }}
          fields={[
            ...PARTY_FIELDS,
            { key: "creditLimit", label: "Kredit limit", hint: canLimit ? "bo'sh — standart 100 mln" : "faqat buxgalteriya/direktor belgilaydi — sizda standart 100 mln qo'yiladi", synonyms: ["limit", "лимит", "kredit", "кредит"] },
          ]}
        >
          <Checkbox name="updateExisting" defaultChecked label="Bazada bor mijozlarning kartasini fayldagi ma'lumot bilan to'ldirish — bo'sh kataklar eski qiymatni o'chirmaydi" />
        </ExcelImport>
      </Card>
    </div>
  );
}
