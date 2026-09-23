import { requireSession } from "@/lib/auth";
import { workPositions } from "@/lib/positions";
import { Card, Checkbox, Field, PageHeader, Select } from "@/components/ui";
import { ExcelImport } from "@/components/excel-import";
import { importEmployeesFromExcel } from "../actions";

/**
 * Otdel kadr → "Excel orqali qo'shish": buxgalteriya tabeli ko'rinishidagi xodimlar ro'yxati
 * (Подразделение sarlavhalari ostida Сотрудник, Табельный номер, Должность, Тарифная ставка,
 * Дата приема/увольнения, Телефон, Дата рождения) kartalarga tushadi.
 * Ustun nomlari rus/o'zbek aralash bo'lishi mumkin — mos ustun o'zi topiladi, keyin tekshirib tuzatiladi.
 */
export default async function EmployeesImportPage() {
  await requireSession(["HR"]);
  const positions = await workPositions();

  return (
    <div>
      <PageHeader
        back={{ href: "/otdel-kadr?tab=xodimlar", label: "Xodimlar ro'yxati" }}
        title="Excel orqali xodim qo'shish"
        subtitle="Tabel jadvalini yuklang — har qator xodim kartasi bo'ladi. Tabel raqami (yoki F.I.O.) bo'yicha bazada bor xodim topilsa, yangi karta ochilmaydi — mavjudi yangilanadi."
      />
      <Card className="max-w-6xl">
        <ExcelImport
          action={importEmployeesFromExcel}
          submitLabel="Xodimlarni qo'shish"
          templateName="xodimlar-namuna"
          example={{
            fullName: "ABDUKARIMOV AZIMJON ORIFJONOVICH", tabelNo: "00401", position: "Formovshik",
            subdivision: "Brigada 1", tariffRate: 2500000, hiredAt: "10.09.2026", firedAt: "",
            phone: "+998 90 123 45 67", birthDate: "26.12.1989",
          }}
          fields={[
            { key: "fullName", label: "F.I.O. (Сотрудник)", required: true, synonyms: ["сотрудник", "ф.и.о", "фио", "работник", "xodim", "ходим", "familiya", "ism", "name"] },
            { key: "tabelNo", label: "Tabel № (Табельный номер)", hint: "shu raqam bo'yicha mavjud xodim topiladi", synonyms: ["табельный", "табел", "tabel", "личный номер", "таб."] },
            { key: "position", label: "Lavozim (Должность)", hint: "ro'yxatda bo'lmasa yangi ishchi lavozim ochiladi", synonyms: ["должност", "lavozim", "kasb", "position"] },
            { key: "subdivision", label: "Bo'lim / brigada (Подразделение)", hint: "alohida ustun bo'lmasa jadvaldagi sarlavhadan olinadi", synonyms: ["подразделен", "бригада", "brigada", "цех", "участок", "bo'lim", "bolim", "бўлим"] },
            { key: "tariffRate", label: "Tarif stavka (Тарифная ставка)", synonyms: ["тарифная", "тариф", "ставка", "оклад", "maosh", "ish haqi", "зарплат"] },
            { key: "hiredAt", label: "Ishga kirgan (Дата приема)", hint: "kun.oy.yil", synonyms: ["дата приема", "дата приёма", "приема", "приёма", "принят", "ishga kirgan", "qabul"] },
            { key: "firedAt", label: "Ishdan bo'shagan (Дата увольнения)", hint: "to'ldirilgan bo'lsa xodim nofaol bo'ladi", synonyms: ["увольнен", "уволен", "bo'shagan", "boshagan", "ishdan"] },
            { key: "phone", label: "Telefon (Телефон рабочий)", synonyms: ["телефон", "tel", "phone", "моб", "raqam"] },
            { key: "birthDate", label: "Tug'ilgan sana (Дата рождения)", hint: "«Дней до дня рождения» ustuni kerak emas", synonyms: ["дата рожд", "туғилган", "tug'ilgan", "tugilgan", "birth", "рожден"] },
          ]}
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Standart lavozim" hint="Должность ustuni bo'sh qolgan qatorlar uchun">
              <Select name="defaultPosition" defaultValue="">
                <option value="">— (bo'sh bo'lsa xato beriladi)</option>
                {positions.map((p) => <option key={p.id} value={p.name}>{p.name}</option>)}
              </Select>
            </Field>
          </div>
          <div className="space-y-2">
            <Checkbox
              name="groupRows"
              defaultChecked
              label="Faqat nomi yozilgan qator — bo'lim sarlavhasi («Бригада 1»): xodim sifatida qo'shilmaydi, undan keyingi xodimlarga bo'lim bo'lib biriktiriladi"
            />
            <Checkbox name="createPositions" defaultChecked label="Ro'yxatda yo'q lavozimlarni yangi ishchi lavozim sifatida ochish (Формовщик, Бригадир…)" />
            <Checkbox name="updateExisting" defaultChecked label="Bazada bor xodimlarning kartasini fayldagi ma'lumot bilan yangilash — bo'sh kataklar eski qiymatni o'chirmaydi" />
          </div>
          <p className="text-xs text-slate-500">
            Surat va hujjat nusxalari Excel&apos;dan kelmaydi — ularni keyin xodim kartasidan yuklaysiz.
            Tizimga kiradigan bo&apos;lim lavozimlari (Sotuv, Buxgalteriya…) bu yerdan qo&apos;shilmaydi: ular login bilan Xodimlar sahifasida ochiladi.
          </p>
        </ExcelImport>
      </Card>
    </div>
  );
}
