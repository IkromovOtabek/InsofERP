import { requirePage, requireRoles } from "@/lib/page-guard";
import { Card, PageHeader } from "@/components/ui";
import { ExcelImport } from "@/components/excel-import";
import type { ImportField } from "@/lib/excel";
import { importCallLogs } from "../../qongiroq-actions";

/** Excel'dagi qo'ng'iroqlar daftari ustunlari (HR jurnali: Sana · Lavozim · № · Hodim nomer · Ismi · …). */
const CALL_FIELDS: ImportField[] = [
  { key: "date", label: "Sana", hint: "Birlashtirilgan katak bo'lsa — bo'sh qatorlar yuqoridagi sanani oladi", synonyms: ["sana", "дата", "date"] },
  { key: "position", label: "Lavozim", hint: "Bo'sh katak — yuqoridagi lavozim", synonyms: ["lavozim", "должност", "vakansiya", "вакан", "position"] },
  { key: "phone", label: "Telefon", synonyms: ["nomer", "telefon", "телефон", "номер", "raqam", "phone", "tel"] },
  { key: "fullName", label: "Ismi", synonyms: ["ismi", "ism", "f.i.o", "fio", "фио", "имя", "name"] },
  { key: "address", label: "Yashash manzili", synonyms: ["manzil", "yashash", "адрес", "mahalla", "address"] },
  { key: "age", label: "Yoshi", synonyms: ["yosh", "возраст", "age"] },
  { key: "status", label: "Suhbatga keldimi", hint: "keldi / kelmadi / keladi / tel ko'tarmadi / ishga olindi — boshqa matn izohga yoziladi", synonyms: ["suxbat", "suhbat", "собесед", "keldi", "holat", "статус"] },
  { key: "reason", label: "Sabab / izoh", synonyms: ["sabab", "причин", "izoh", "примеч", "комментар"] },
];

/** Otdel kadr → Qo'ng'iroqlar jurnali → Excel: HR'ning eski daftari bir martada ko'chiriladi. */
export default async function CallLogImportPage() {
  await requirePage("/otdel-kadr");
  await requireRoles(["HR"], { module: "employees", actions: ["calls"] });
  return (
    <div>
      <PageHeader
        back={{ href: "/otdel-kadr?tab=qongiroqlar", label: "Qo'ng'iroqlar jurnali" }}
        title="Qo'ng'iroqlarni Excel'dan qo'shish"
        info={<>
          <p>Har qator — bitta qo&apos;ng&apos;iroq.</p>
          <p>Sana va lavozim birlashtirilgan katakda bo&apos;lsa, guruhdagi qatorlar shu qiymatni oladi.</p>
          <p>Shu kun va shu telefon jurnalda bo&apos;lsa — qayta yozilmaydi.</p>
        </>}
      />
      <Card className="max-w-6xl">
        <ExcelImport
          action={importCallLogs}
          submitLabel="Jurnalga yozish"
          templateName="qongiroqlar-namuna"
          example={{ date: "25.07.2025", position: "Beton qoliplovchi", phone: "973330327", fullName: "Akin", address: "2 paliknika", age: 23, status: "keldi", reason: "dushanbadan ishga keladi" }}
          fields={CALL_FIELDS}
        />
      </Card>
    </div>
  );
}
