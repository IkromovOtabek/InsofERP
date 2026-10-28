import { biContext, BiPage } from "../../shell";
import { requirePage } from "@/lib/page-guard";
import { avtoReport } from "@/lib/fin-report/avto";
import { parseDayRange } from "../../month-bar";
import { AvtoView } from "../avto-view";

export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requirePage("/bi-tahlil/logistika/avtotransport");
  const { sp, range } = await biContext(searchParams);
  const period = parseDayRange(sp);
  const r = await avtoReport(period.from, period.to);
  return (
    <BiPage title="Logistika" subtitle="Har bir mashina: reys, probeg, yoqilg'i normasi, xarajat, daromad va kassa bilan solishtirish" tab="logistics" range={range} period={false}>
      <AvtoView r={r} period={period} base="/bi-tahlil/logistika/avtotransport" />
    </BiPage>
  );
}
