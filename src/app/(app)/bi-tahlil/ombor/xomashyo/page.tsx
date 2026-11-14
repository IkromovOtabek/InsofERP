import { biContext, BiPage } from "../../shell";
import { requirePage } from "@/lib/page-guard";
import { rawBalance } from "@/lib/fin-report/sklad";
import { monthTitle, parseMonth } from "../../month-bar";
import { STOCK_DRILL_KINDS, stockDrill, type StockDrillKind } from "@/lib/stock-drill";
import { RawBalanceView } from "../sklad-view";

export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requirePage("/bi-tahlil/ombor/xomashyo");
  const { sp, range } = await biContext(searchParams, "/bi-tahlil/ombor/xomashyo");
  const r = await rawBalance(parseMonth(sp.oy));
  // Raqam manbasi: `drill` — kirim / sarf / qoldiq, `mat` — material
  const kind = STOCK_DRILL_KINDS.find((k) => k === sp.drill) as StockDrillKind | undefined;
  const drill = kind && sp.mat ? await stockDrill({ materialId: sp.mat, from: r.from, to: r.to, kind, period: monthTitle(r.month) }) : null;
  return (
    <BiPage title="Ombor" info="Xom-ashyo: haqiqiy sarf retsept normasi bilan solishtiriladi" tab="stock" range={range} period={false}>
      <RawBalanceView r={r} sp={sp} base="/bi-tahlil/ombor/xomashyo" drill={drill} />
    </BiPage>
  );
}
