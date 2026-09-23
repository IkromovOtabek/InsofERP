import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getCompany } from "@/lib/company";
import { apkInfo, apkSize } from "@/lib/apk";
import { navFor, ROLE_LABELS } from "@/lib/nav";
import { AppShell } from "@/components/app-shell";
import { tourFor, TOUR_COOKIE } from "@/lib/tour";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const s = await getSession();
  if (!s) redirect("/login");
  const company = await getCompany();
  const apk = await apkInfo();
  // Instruksiyaning joriy bosqichi (yoki "done") — cookie sessiya bilan birga o'chadi
  const tourRaw = (await cookies()).get(TOUR_COOKIE)?.value;
  const tourStart = tourRaw ? decodeURIComponent(tourRaw) : null;
  return (
    <AppShell items={navFor(s.role)} user={{ fullName: s.fullName, roleLabel: ROLE_LABELS[s.role] }} brand={company.name} ai={["DIRECTOR", "FINANCE", "ACCOUNTING"].includes(s.role)} apk={apk.exists ? apkSize(apk.size) : null} tour={{ steps: tourFor(s.role), start: tourStart }}>
      {children}
    </AppShell>
  );
}
