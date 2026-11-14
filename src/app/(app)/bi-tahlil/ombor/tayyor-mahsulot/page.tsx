import { biContext, BiPage } from "../../shell";
import { requirePage } from "@/lib/page-guard";
import { finishedReport, monthBounds } from "@/lib/fin-report/sklad";
import { monthTitle, parseMonth } from "../../month-bar";
import { STOCK_DRILL_KINDS, stockDrill, type StockDrillKind } from "@/lib/stock-drill";
import { FinishedView } from "../sklad-view";

export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requirePage("/bi-tahlil/ombor/tayyor-mahsulot");
  const { sp, range } = await biContext(searchParams);
  const r = await finishedReport(parseMonth(sp.oy));
  // Raqam manbasi: `drill` — ishlab chiqarildi / jo'natildi / qoldiq, `prod` — mahsulot
  const kind = STOCK_DRILL_KINDS.find((k) => k === sp.drill) as StockDrillKind | undefined;
  const drill = kind && sp.prod ? await stockDrill({ productId: sp.prod, ...monthBounds(r.month), kind, period: monthTitle(r.month) }) : null;
  return (
    <BiPage title="Ombor" info="Tayyor mahsulot: oy boshi, ishlab chiqarilgan, jo'natilgan va qoldiq qiymati" tab="stock" range={range} period={false}>
      <FinishedView r={r} sp={sp} base="/bi-tahlil/ombor/tayyor-mahsulot" drill={drill} />
    </BiPage>
  );
}
