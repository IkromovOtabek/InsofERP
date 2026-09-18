import { biContext, BiPage } from "../shell";
import { FinanceTab } from "../tabs/finance";

export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { sp, range } = await biContext(searchParams);
  return (
    <BiPage title="Moliya" subtitle="Pul qayerdan oqyapti va kassada nima bo'ladi — yo'qotish kanallari, cash forecast, profit leakage, P&L, debitorka aging." tab="finance" range={range}>
      <FinanceTab range={range} sp={sp} />
    </BiPage>
  );
}
