import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getCompany } from "@/lib/company";
import { apkInfo, apkSize } from "@/lib/apk";
import { navFor, ROLE_LABELS } from "@/lib/nav";
import { AppShell } from "@/components/app-shell";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const s = await getSession();
  if (!s) redirect("/login");
  const company = await getCompany();
  const apk = await apkInfo();
  return (
    <AppShell items={navFor(s.role)} user={{ fullName: s.fullName, roleLabel: ROLE_LABELS[s.role] }} brand={company.name} ai={["DIRECTOR", "FINANCE", "ACCOUNTING"].includes(s.role)} apk={apk.exists ? apkSize(apk.size) : null}>
      {children}
    </AppShell>
  );
}
