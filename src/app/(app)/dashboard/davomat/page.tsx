import { redirect } from "next/navigation";
import { ScanFace, UserPlus } from "lucide-react";
import { getSession } from "@/lib/auth";
import { canEnrollFaces, faceRoster, faceScope, todayFaceLog } from "@/lib/face-id";
import { productionStaff } from "@/lib/production-staff";
import { PageHeader, Tabs } from "@/components/ui";
import { FaceScanner } from "./scanner";
import { FaceRosterPanel } from "./enroll";

/**
 * Bosh sahifa → «Davomat»: ERP'ning o'z Face ID skaneri (telefonning Face ID'si emas) va yuzlarni ro'yxatga olish.
 * Otdel kadr va direktor — hamma xodim; sex boshliqlari — faqat sex xodimlari (`lib/face-id.ts` → faceScope).
 */
export default async function FaceAttendancePage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const s = await getSession();
  if (!s) redirect("/api/logout");
  const scope = faceScope(s);
  if (!scope) redirect("/dashboard?denied=1");
  const canEnroll = canEnrollFaces(s);
  const tab = canEnroll && (await searchParams).tab === "yuzlar" ? "yuzlar" : "skaner";

  const [roster, log, sex] = await Promise.all([
    faceRoster(),
    tab === "skaner" ? todayFaceLog(scope) : [],
    scope === "sex" ? productionStaff() : null,
  ]);
  // Sex boshlig'iga — faqat o'z sexi bo'yicha sanoq
  const inScope = sex ? roster.filter((r) => sex.members.some((m) => m.id === r.id)) : roster;
  const enrolled = inScope.filter((r) => r.samples > 0).length;

  return (
    <div>
      <PageHeader
        back={{ href: "/dashboard", label: "Bosh sahifa" }}
        eyebrow="Davomat"
        title="Face ID — yuz bilan davomat"
        subtitle={scope === "sex"
          ? "Sex xodimlari kameraga qarab o'tadi — kelish va ketish vaqti tabelga o'zi yoziladi."
          : "Xodimlar kameraga qarab o'tadi — kelish va ketish vaqti otdel kadr tabeliga o'zi yoziladi."}
      />
      {canEnroll && (
        <Tabs current={tab} items={[
          { key: "skaner", label: "Skaner", href: "/dashboard/davomat", icon: ScanFace },
          { key: "yuzlar", label: "Yuzlarni ro'yxatga olish", href: "/dashboard/davomat?tab=yuzlar", icon: UserPlus, count: roster.length - enrolled || undefined },
        ]} />
      )}
      {tab === "skaner"
        ? <FaceScanner initialLog={log} enrolled={enrolled} total={inScope.length} canEnroll={canEnroll} />
        : <FaceRosterPanel rows={roster} />}
    </div>
  );
}
