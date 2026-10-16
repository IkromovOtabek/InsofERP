import { requirePage } from "@/lib/page-guard";
import { PageHeader } from "@/components/ui";
import { SelfAccountPanel } from "./panel";
import { MyAttendanceCard } from "./davomat";
import { MyHrSection } from "./hr-section";

/** Har bir xodimning o'z hisobi — barcha rollarga ochiq (`lib/nav.ts` → ALWAYS_OPEN). Pastda — o'z davomati (`oy` — oy). */
export default async function MyAccountPage({ searchParams }: { searchParams: Promise<{ oy?: string }> }) {
  const s = await requirePage("/hisobim");
  const { oy } = await searchParams;
  return (
    <div>
      <PageHeader title="Mening hisobim" subtitle="Login va parolingizni o'zingiz o'zgartirasiz; pastda — o'z davomatingiz" />
      <SelfAccountPanel s={s} />
      <div className="mt-5 max-w-3xl"><MyAttendanceCard userId={s.userId} month={oy ?? null} /></div>
      {/* Smena grafigi, arizalar va ish haqi (`lib/hr/*`) */}
      <MyHrSection userId={s.userId} />
    </div>
  );
}
