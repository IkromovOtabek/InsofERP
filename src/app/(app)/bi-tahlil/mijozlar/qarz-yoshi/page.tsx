import { biContext, BiPage } from "../../shell";
import { requirePage } from "@/lib/page-guard";
import { debtAgeReport, parseDebtDay } from "@/lib/fin-report/debts";
import { DebtAgeView } from "../qarz";

export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requirePage("/bi-tahlil/mijozlar/qarz-yoshi");
  const { sp, range } = await biContext(searchParams);
  const r = await debtAgeReport(parseDebtDay(sp.sana));
  return (
    <BiPage title="Mijozlar" subtitle="Kim qancha qarz va u qancha vaqtdan beri turibdi" tab="customers" range={range} period={false}>
      <DebtAgeView r={r} sp={sp} base="/bi-tahlil/mijozlar/qarz-yoshi" />
    </BiPage>
  );
}
