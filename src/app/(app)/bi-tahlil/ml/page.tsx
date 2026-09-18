import { biContext, BiPage } from "../shell";
import { ForecastTab } from "../tabs/forecast";

export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { sp, range } = await biContext(searchParams);
  return (
    <BiPage title="Bashorat" subtitle="ML tahlil — sotuv bashorati (trend × mavsumiylik), xomashyo tugash prognozi, quvvat va model registry. Sana filtriga bog'liq emas." eyebrow="ML tahlil" tab="forecast" range={range} period={false}>
      <ForecastTab sp={sp} />
    </BiPage>
  );
}
