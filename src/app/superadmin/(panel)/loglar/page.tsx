import { requireAdmin } from "@/lib/control/auth";
import { control } from "@/lib/control/db";
import { LOG_FILES } from "@/lib/control/devops/contract";
import { PageHeader } from "@/components/ui";
import { LogsClient, type SourceOpt } from "./view";

export const metadata = { title: "Loglar" };
export const dynamic = "force-dynamic";

/** Loglar: oq ro'yxatdagi manbalar (journald unitlari va log fayllar) — agent o'qiydi, panel natijani ko'rsatadi. */
export default async function LogsPage({ searchParams }: { searchParams: Promise<{ source?: string }> }) {
  await requireAdmin(); // layout ham tekshiradi; sahifa o'zi ham himoyalangan bo'lsin (layout'siz render/qayta foydalanish)
  const sp = await searchParams;
  const tenants = await control.tenant.findMany({ where: { status: { in: ["ACTIVE", "SUSPENDED"] } }, select: { slug: true, name: true }, orderBy: { port: "asc" } });
  const sources: SourceOpt[] = [
    ...tenants.map((t) => ({ value: `insof-erp@${t.slug}`, label: `insof-erp@${t.slug} — ${t.name}`, group: "Korxonalar (journald)", unit: true })),
    { value: "insof-control", label: "insof-control — IT panel", group: "Platforma (journald)", unit: true },
    { value: "insof-eco", label: "insof-eco — ECO API", group: "Platforma (journald)", unit: true },
    { value: "insof-agent", label: "insof-agent — monitoring agenti", group: "Platforma (journald)", unit: true },
    { value: "nginx", label: "nginx (unit)", group: "Platforma (journald)", unit: true },
    ...Object.entries(LOG_FILES).map(([value, f]) => ({ value, label: f.label, group: "Log fayllar", unit: false })),
  ];
  const initial = sources.some((s) => s.value === sp.source) ? sp.source! : sources[0]?.value ?? "insof-control";
  return (
    <div className="space-y-4">
      <PageHeader title="Loglar" subtitle="Agent oq ro'yxatdagi manbaning oxirgi qatorlarini o'qiydi (≤ 500 qator, ≤ 64 KB, parol/token yashirilgan). Har so'rov «Amallar» jurnaliga yoziladi." />
      <LogsClient sources={sources} initial={initial} />
    </div>
  );
}
