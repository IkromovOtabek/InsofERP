import { requireSession } from "@/lib/auth";
import { workPositions } from "@/lib/positions";
import { EMPLOYEE_ACCEPT, EMPLOYEE_MAX_MB, PHOTO_ACCEPT } from "@/lib/uploads";
import { PageHeader } from "@/components/ui";
import { EmployeeCardForm } from "./employee-card-form";

export default async function NewEmployeeCardPage() {
  await requireSession(["HR"]);
  const positions = await workPositions();
  return (
    <div>
      <PageHeader
        title="Yangi xodim"
        eyebrow="Otdel kadr"
        subtitle="Ma'lumotlar va hujjat nusxalari to'ldirilgach shaxsiy varaqa chop etiladi"
        back={{ href: "/otdel-kadr?tab=xodimlar", label: "Xodimlar ro'yxati" }}
      />
      <EmployeeCardForm
        positions={positions.map((p) => p.name)}
        docAccept={EMPLOYEE_ACCEPT}
        photoAccept={PHOTO_ACCEPT}
        maxMb={EMPLOYEE_MAX_MB}
      />
    </div>
  );
}
