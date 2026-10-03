import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getCompany } from "@/lib/company";
import { apkInfo, apkSize } from "@/lib/apk";
import { navFor, ROLE_LABELS } from "@/lib/nav";
import { AppShell } from "@/components/app-shell";
import { LiveRefresh } from "@/components/live-refresh";
import { tourFor, TOUR_COOKIE } from "@/lib/tour";
import { isControlMode } from "@/lib/tenant";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // Markaziy panel jarayonida korxona sahifalari yo'q (middleware ham yo'naltiradi — ikkinchi himoya)
  if (isControlMode()) redirect("/superadmin");
  const s = await getSession();
  if (!s) redirect("/api/logout");
  const company = await getCompany();
  const apk = await apkInfo();
  // Instruksiyaning joriy bosqichi (yoki "done") — cookie sessiya bilan birga o'chadi
  const tourRaw = (await cookies()).get(TOUR_COOKIE)?.value;
  const tourStart = tourRaw ? decodeURIComponent(tourRaw) : null;
  return (
    <AppShell items={navFor(s.role, s.perms)} user={{ fullName: s.fullName, roleLabel: s.superadmin ? ROLE_LABELS.SUPERADMIN : ROLE_LABELS[s.role] }} brand={company.name} ai={["DIRECTOR", "FINANCE", "ACCOUNTING"].includes(s.role)} apk={apk.exists ? apkSize(apk.size) : null} tour={{ steps: s.superadmin ? [] : tourFor(s.role), start: tourStart }}>
      {/* Ma'lumot o'zi yangilanib turadi — sahifani qo'lda yangilash shart emas */}
      <LiveRefresh />
      {s.superadmin && (
        <div className="mb-4 rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-sm text-violet-800">
          IT superadmin rejimi — direktor huquqi bilan ishlayapsiz. Har amal korxonaning audit jurnaliga yoziladi.
        </div>
      )}
      {children}
    </AppShell>
  );
}
