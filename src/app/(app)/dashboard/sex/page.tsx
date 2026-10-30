import { redirect } from "next/navigation";
import { requirePage } from "@/lib/page-guard";
import { canDo } from "@/lib/permissions";
import { productionDay, PRODUCTION_HOME_ROLES } from "@/lib/production-day";
import { dayTitle, today } from "@/lib/davomat";
import { PageHeader } from "@/components/ui";
import { SexAttendance } from "../sex-attendance";

/**
 * Sex xodimlari va bugungi davomat — ishlab chiqarish bosh sahifasidagi «Ishga keldi» kartasidan ochiladi
 * (avval bosh sahifaning o'zida edi). Sex boshlig'i shu yerda belgilaydi; direktor ko'radi.
 */
export default async function SexAttendancePage() {
  const s = await requirePage("/dashboard");
  if (s.role !== "DIRECTOR" && !(PRODUCTION_HOME_ROLES as readonly string[]).includes(s.role)) redirect("/dashboard?denied=1");
  const iso = today();
  const d = await productionDay(iso);
  const isDirector = s.role === "DIRECTOR";
  return (
    <div>
      <PageHeader
        back={{ href: isDirector ? "/dashboard?view=production" : "/dashboard", label: "Bosh sahifa" }}
        eyebrow="Davomat"
        title="Sex xodimlari va davomat"
        subtitle={`${dayTitle(iso)} · keldi ${d.attendance.present.length} / ${d.staff.total}${d.attendance.notMarked.length ? ` · ${d.attendance.notMarked.length} kishi belgilanmagan` : ""}`}
      />
      <SexAttendance d={d} canStaff={canDo(s, "production", "staff")} isDirector={isDirector} />
    </div>
  );
}
