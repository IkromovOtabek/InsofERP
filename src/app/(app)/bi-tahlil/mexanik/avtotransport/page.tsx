import { biContext, BiPage } from "../../shell";
import { requirePage } from "@/lib/page-guard";
import { avtoReport } from "@/lib/fin-report/avto";
import { parseMonth } from "../../month-bar";
import { AvtoView } from "../avto-view";

export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requirePage("/bi-tahlil/mexanik/avtotransport");
  const { sp, range } = await biContext(searchParams);
  const r = await avtoReport(parseMonth(sp.oy));
  return (
    <BiPage title="Mexanik" subtitle="Har bir mashina: reys, probeg, yoqilg'i normasi, xarajat, daromad va kassa bilan solishtirish" tab="mechanic" range={range} period={false}>
      <AvtoView r={r} base="/bi-tahlil/mexanik/avtotransport" />
    </BiPage>
  );
}
