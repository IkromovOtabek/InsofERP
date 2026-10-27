import { biContext, BiPage } from "../../shell";
import { requirePage } from "@/lib/page-guard";
import { finishedReport } from "@/lib/fin-report/sklad";
import { parseMonth } from "../../month-bar";
import { FinishedView } from "../sklad-view";

export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requirePage("/bi-tahlil/ombor/tayyor-mahsulot");
  const { sp, range } = await biContext(searchParams);
  const r = await finishedReport(parseMonth(sp.oy));
  return (
    <BiPage title="Ombor" subtitle="Tayyor mahsulot: oy boshi, ishlab chiqarilgan, jo'natilgan va qoldiq qiymati" tab="stock" range={range} period={false}>
      <FinishedView r={r} sp={sp} base="/bi-tahlil/ombor/tayyor-mahsulot" />
    </BiPage>
  );
}
