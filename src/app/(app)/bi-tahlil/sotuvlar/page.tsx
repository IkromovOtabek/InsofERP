import { biContext, BiPage } from "../shell";
import { SalesTab } from "../tabs/sales";

export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { sp, range } = await biContext(searchParams);
  return (
    <BiPage title="Sotuvlar" subtitle="Reja pulsi, dinamika, markalar, mijozlar, Pareto, o'sish/pasayish sabablari, yo'qotilgan tushum va qaror simulyatori." tab="sales" range={range}>
      <SalesTab range={range} sp={sp} />
    </BiPage>
  );
}
