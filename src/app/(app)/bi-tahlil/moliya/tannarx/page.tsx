import { requirePage } from "@/lib/page-guard";
import { canDo } from "@/lib/permissions";
import { costSheet } from "@/lib/fin-report/cost";
import { addMonths, isMonthKey, monthKeyOf } from "@/lib/fin-report/period";
import { biContext, BiPage, type SP } from "../../shell";
import { CostSheetView, monthTitle } from "../cost-view";

export const dynamic = "force-dynamic";

/** Tannarx hisobi — sukut bo'yicha o'tgan (yopilgan) oy. */
export default async function Page({ searchParams }: { searchParams: Promise<SP> }) {
  await requirePage("/bi-tahlil/moliya/tannarx");
  const { s: session, sp, range } = await biContext(searchParams);
  const cur = monthKeyOf(new Date());
  const month = isMonthKey(sp.oy) && sp.oy <= cur ? sp.oy : addMonths(cur, -1);
  const s = await costSheet(month);
  return (
    <BiPage title="Moliya" subtitle={`Tannarx hisobi — ${monthTitle(month)} (o'zimiz hisobladik): haqiqatda kelgan xom-ashyo, norma bilan farq va 1 birlik tannarx`} tab="finance" range={range} period={false}>
      <CostSheetView s={s} base="/bi-tahlil/moliya/tannarx" canWrite={canDo(session, "moliya", "cost")} />
    </BiPage>
  );
}
