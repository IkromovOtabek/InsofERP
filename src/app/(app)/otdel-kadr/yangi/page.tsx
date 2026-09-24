import { requireSession } from "@/lib/auth";
import { positionCatalog } from "@/lib/positions";
import { EMPLOYEE_ACCEPT, EMPLOYEE_MAX_MB, PHOTO_ACCEPT } from "@/lib/uploads";
import { PageHeader } from "@/components/ui";
import { EmployeeCardForm } from "./employee-card-form";

export default async function NewEmployeeCardPage() {
  await requireSession(["HR"]);
  // Ro'yxat Xodimlar sahifasidagi bilan bir xil (Excel'dan qolgan lavozimlar ham ko'rinadi)
  const { work, strays } = await positionCatalog();
  return (
    <div>
      <PageHeader
        title="Yangi xodim"
        eyebrow="Otdel kadr"
        subtitle="Ma'lumotlar va hujjat nusxalari to'ldirilgach shaxsiy varaqa chop etiladi"
        back={{ href: "/otdel-kadr?tab=xodimlar", label: "Xodimlar ro'yxati" }}
      />
      <EmployeeCardForm
        positions={[...work, ...strays]}
        docAccept={EMPLOYEE_ACCEPT}
        photoAccept={PHOTO_ACCEPT}
        maxMb={EMPLOYEE_MAX_MB}
      />
    </div>
  );
}
