import { db } from "@/lib/db";
import { requirePage, requireRoles } from "@/lib/page-guard";
import { positionCatalog } from "@/lib/positions";
import { EMPLOYEE_ACCEPT, EMPLOYEE_MAX_MB, PHOTO_ACCEPT } from "@/lib/uploads";
import { PageHeader } from "@/components/ui";
import { EmployeeCardForm } from "./employee-card-form";

export default async function NewEmployeeCardPage({ searchParams }: { searchParams: Promise<{ qongiroq?: string }> }) {
  // Direktor modulni "yo'q" qilib qo'ygan bo'lsa — HR roli bo'lsa ham sahifa yopiq (perms)
  await requirePage("/otdel-kadr");
  await requireRoles(["HR"], { module: "employees", actions: ["create"] });
  // Ro'yxat Xodimlar sahifasidagi bilan bir xil (Excel'dan qolgan lavozimlar ham ko'rinadi)
  const { work, strays } = await positionCatalog();
  // Qo'ng'iroqlar jurnalidan kelgan bo'lsa («Ishga olindi») — karta shu odam ma'lumoti bilan ochiladi
  const { qongiroq } = await searchParams;
  const call = qongiroq ? await db.hrCallLog.findUnique({ where: { id: qongiroq }, select: { fullName: true, phone: true, address: true, position: true } }) : null;
  return (
    <div>
      <PageHeader
        title="Yangi xodim"
        eyebrow="Otdel kadr"
        info="Ma'lumotlar va hujjat nusxalari to'ldirilgach shaxsiy varaqa chop etiladi"
        back={{ href: "/otdel-kadr?tab=xodimlar", label: "Xodimlar ro'yxati" }}
      />
      <EmployeeCardForm
        positions={[...work, ...strays]}
        docAccept={EMPLOYEE_ACCEPT}
        photoAccept={PHOTO_ACCEPT}
        maxMb={EMPLOYEE_MAX_MB}
        initial={call ? { fullName: call.fullName ?? undefined, phone: call.phone ?? undefined, address: call.address ?? undefined, position: call.position } : undefined}
      />
    </div>
  );
}
