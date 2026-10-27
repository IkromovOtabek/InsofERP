import { requirePage } from "@/lib/page-guard";
import { canDo } from "@/lib/permissions";
import { productProfit } from "@/lib/fin-report/cost";
import { isMonthKey, monthKeyOf } from "@/lib/fin-report/period";
import { biContext, BiPage, type SP } from "../../shell";
import { ProductProfitView, monthTitle } from "../cost-view";

export const dynamic = "force-dynamic";

/** Har bir mahsulotdan qancha foyda qolyapti — sukut bo'yicha joriy oy. */
export default async function Page({ searchParams }: { searchParams: Promise<SP> }) {
  await requirePage("/bi-tahlil/moliya/mahsulot-foydasi");
  const { s, sp, range } = await biContext(searchParams);
  const cur = monthKeyOf(new Date());
  const month = isMonthKey(sp.oy) && sp.oy <= cur ? sp.oy : cur;
  const p = await productProfit(month);
  return (
    <BiPage title="Moliya" subtitle={`Har bir mahsulotdan qancha foyda qolyapti — ${monthTitle(month)}`} tab="finance" range={range} period={false}>
      <ProductProfitView p={p} base="/bi-tahlil/moliya/mahsulot-foydasi" canWrite={canDo(s, "moliya", "cost")} />
    </BiPage>
  );
}
