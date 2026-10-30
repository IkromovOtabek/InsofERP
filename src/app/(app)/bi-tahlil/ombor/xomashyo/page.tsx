import { biContext, BiPage } from "../../shell";
import { requirePage } from "@/lib/page-guard";
import { rawBalance } from "@/lib/fin-report/sklad";
import { parseMonth } from "../../month-bar";
import { RawBalanceView } from "../sklad-view";

export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requirePage("/bi-tahlil/ombor/xomashyo");
  const { sp, range } = await biContext(searchParams, "/bi-tahlil/ombor/xomashyo");
  const r = await rawBalance(parseMonth(sp.oy));
  return (
    <BiPage title="Ombor" subtitle="Xom-ashyo: haqiqiy sarf retsept normasi bilan solishtiriladi" tab="stock" range={range} period={false}>
      <RawBalanceView r={r} sp={sp} base="/bi-tahlil/ombor/xomashyo" />
    </BiPage>
  );
}
