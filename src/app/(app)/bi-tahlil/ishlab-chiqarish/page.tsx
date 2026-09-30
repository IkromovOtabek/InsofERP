import { biContext, BiPage } from "../shell";
import { OperationsTab } from "../tabs/operations";
import { requirePage } from "@/lib/page-guard";

export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requirePage("/bi-tahlil/ishlab-chiqarish");
  const { sp, range } = await biContext(searchParams);
  return (
    <BiPage title="Ishlab chiqarish va logistika" subtitle="Zameslar, reyslar, mikserlar, haydovchilar scorecard va zayavkalar bajarilishi." tab="operations" range={range}>
      <OperationsTab range={range} sp={sp} />
    </BiPage>
  );
}
