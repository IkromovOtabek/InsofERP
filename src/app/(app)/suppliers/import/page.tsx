import { requireRoles } from "@/lib/page-guard";
import { Card, Checkbox, PageHeader } from "@/components/ui";
import { ExcelImport } from "@/components/excel-import";
import { importSuppliersFromExcel } from "../actions";
import { PARTY_FIELDS } from "@/lib/party-fields";

/** Yetkazuvchilar → "Excel import": ro'yxat bir martada; INN → telefon → nom bo'yicha takror tekshiriladi. */
export default async function SuppliersImportPage() {
  await requireRoles(["WAREHOUSE", "PROCUREMENT", "ACCOUNTING"], { module: "stock", actions: ["suppliers"] });
  return (
    <div>
      <PageHeader
        back={{ href: "/suppliers", label: "Yetkazuvchilar" }}
        title="Excel orqali yetkazuvchi qo'shish"
        subtitle="Har qator — yetkazuvchi kartasi. INN (bo'lmasa telefon, keyin nomi) bo'yicha bazada bor bo'lsa yangi karta ochilmaydi. Ularga bo'lgan boshlang'ich qarz — «Boshlang'ich qoldiqlar» bo'limida."
      />
      <Card className="max-w-6xl">
        <ExcelImport
          action={importSuppliersFromExcel}
          submitLabel="Yetkazuvchilarni qo'shish"
          templateName="yetkazuvchilar-namuna"
          example={{ name: "\"BODOMZOR SEMENT\" MCHJ", inn: "301987654", phone: "+998 71 200 00 00", address: "Ohangaron sh.", contactPerson: "Aliyev Botir (sotuv bo'limi)" }}
          fields={PARTY_FIELDS}
        >
          <Checkbox name="updateExisting" defaultChecked label="Bazada bor yetkazuvchilarning kartasini fayldagi ma'lumot bilan to'ldirish — bo'sh kataklar eski qiymatni o'chirmaydi" />
        </ExcelImport>
      </Card>
    </div>
  );
}
