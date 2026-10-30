import { requirePage } from "@/lib/page-guard";
import { biContext, BiPage, type SP } from "../../shell";
import { CalendarView } from "@/app/(app)/moliya/kalendar/view";

export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<SP> }) {
  await requirePage("/bi-tahlil/moliya/kalendar");
  const { sp, range } = await biContext(searchParams, "/bi-tahlil/moliya/kalendar");
  return (
    <BiPage title="Moliya" subtitle="To'lov kalendari — kelgusi 30 kun: kimga, qachon, qancha" tab="finance" range={range} period={false}>
      <CalendarView base="/bi-tahlil/moliya/kalendar" qoldiq={sp.qoldiq} />
    </BiPage>
  );
}
