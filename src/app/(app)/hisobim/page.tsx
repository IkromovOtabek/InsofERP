import { requirePage } from "@/lib/page-guard";
import { PageHeader } from "@/components/ui";
import { SelfAccountPanel } from "./panel";

/** Har bir xodimning o'z hisobi — barcha rollarga ochiq (`lib/nav.ts` → ALWAYS_OPEN). */
export default async function MyAccountPage() {
  const s = await requirePage("/hisobim");
  return (
    <div>
      <PageHeader title="Mening hisobim" subtitle="Login va parolingizni o'zingiz o'zgartirasiz" />
      <SelfAccountPanel s={s} />
    </div>
  );
}
