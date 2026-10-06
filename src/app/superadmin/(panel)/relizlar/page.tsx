import { requireAdmin } from "@/lib/control/auth";
import { loadReleasesView, type ReleasesView } from "@/lib/control/devops/data";
import { Callout } from "@/components/ui";
import { PageHeader } from "../../_ui";
import { ReleasesClient } from "./view";

export const metadata = { title: "Relizlar" };
export const dynamic = "force-dynamic";

/** Relizlar: joriy reliz, serverdagi relizlar, xizmatlar versiyasi, GitHub'dagi yangi commitlar, deploy/qaytarish. */
export default async function ReleasesPage() {
  await requireAdmin(); // layout ham tekshiradi; sahifa o'zi ham himoyalangan bo'lsin (layout'siz render/qayta foydalanish)
  let view: ReleasesView | null = null;
  let error: string | undefined;
  try {
    view = await loadReleasesView();
  } catch (e) {
    console.error("[relizlar]", e);
    error = (e as Error).message.split("\n").pop()?.slice(0, 200);
  }
  return (
    <div className="space-y-4">
      <PageHeader title="Relizlar" subtitle="Ma'lumotni serverdagi insof-agent yig'adi (git fetch — har 5 daqiqada). Deploy va qaytarish agent orqali, scripts/deploy.sh bilan." />
      {view ? <ReleasesClient view={view} /> : <Callout tone="danger" title="Ma'lumot yuklanmadi">{error ?? "control baza javob bermadi"}</Callout>}
    </div>
  );
}
