import { biContext, BiPage } from "../../shell";
import { AnomaliesTab } from "../../tabs/anomalies";

export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { sp, range } = await biContext(searchParams);
  return (
    <BiPage title="Anomaliyalar" subtitle="Qoida asosida aniqlangan shubhali holatlar — narx chetlanishi, ish vaqtidan tashqari to'lovlar, dublikat summalar, g'ayrioddiy hajmlar, inventarizatsiya farqlari." eyebrow="ML tahlil" tab="anomalies" range={range} period={false}>
      <AnomaliesTab sp={sp} />
    </BiPage>
  );
}
