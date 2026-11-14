import { requirePage, requireRoles } from "@/lib/page-guard";
import { importPositionOptions } from "@/lib/positions";
import { knownSubdivisions } from "@/lib/import-employees";
import { TEMPLATE_ROLE_OPTIONS } from "@/lib/perm-template";
import { Card, PageHeader } from "@/components/ui";
import { EmployeesImport } from "./employees-import";

/**
 * Otdel kadr → "Excel orqali qo'shish": buxgalteriya tabeli ko'rinishidagi xodimlar ro'yxati
 * (Подразделение sarlavhalari ostida Сотрудник, Табельный номер, Должность, Тарифная ставка,
 * Дата приема/увольнения, Телефон, Дата рождения) kartalarga tushadi.
 * Ustun nomlari rus/o'zbek aralash bo'lishi mumkin — mos ustun o'zi topiladi, keyin tekshirib tuzatiladi.
 * Lavozim va bo'lim nomlari "Qiymatlarni moslash" bilan tizimdagi nomlarga keltiriladi («Формовщик» → «Formovshik»,
 * «КАССИР» → «Kassa / bank»); ro'yxatda yo'q lavozimni shu yerning o'zida «+ Yangi lavozim…» bilan ochish mumkin.
 */
export default async function EmployeesImportPage() {
  // Direktor modulni "yo'q" qilib qo'ygan bo'lsa — HR roli bo'lsa ham sahifa yopiq (perms)
  await requirePage("/otdel-kadr");
  const s = await requireRoles(["HR"], { module: "employees", actions: ["create"] });
  const [options, subdivisions] = await Promise.all([importPositionOptions(), knownSubdivisions()]);

  return (
    <div>
      <PageHeader
        back={{ href: "/otdel-kadr?tab=xodimlar", label: "Xodimlar ro'yxati" }}
        title="Excel orqali xodim qo'shish"
        info={<>
          <p>Tabel jadvalini yuklang — har qator xodim kartasi bo&apos;ladi. Tabel raqami (yoki F.I.O.) bo&apos;yicha bazada bor xodim topilsa, yangi karta ochilmaydi — mavjudi yangilanadi.</p>
          <p>Surat va hujjat nusxalari Excel&apos;dan kelmaydi — ularni keyin xodim kartasidan yuklaysiz.</p>
          <p>Tizimga kiradigan lavozimga (Kassa / bank, Brigadir…) moslangan xodimga login bu yerdan ochilmaydi — uni Xodimlar sahifasida «Login berish» bilan bering.</p>
        </>}
      />
      <Card className="max-w-6xl">
        <EmployeesImport
          initialOptions={options}
          subdivisions={subdivisions}
          canLogin={s.role === "DIRECTOR"}
          roles={TEMPLATE_ROLE_OPTIONS}
        />
      </Card>
    </div>
  );
}
