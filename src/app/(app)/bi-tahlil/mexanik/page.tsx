import { biContext, BiPage } from "../shell";
import { requirePage } from "@/lib/page-guard";
import { MechanicHome } from "@/app/(app)/dashboard/mechanic-home";

export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requirePage("/bi-tahlil/mexanik");
  const { sp, range } = await biContext(searchParams);
  return (
    <BiPage title="Mexanik" subtitle="Transport, reyslar, ta'mir va texnika ehtiyojlari" tab="mechanic" range={range} period={false}>
      <MechanicHome day={sp.date} base="/bi-tahlil/mexanik" />
    </BiPage>
  );
}
