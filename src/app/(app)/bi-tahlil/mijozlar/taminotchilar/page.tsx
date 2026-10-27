import { biContext, BiPage } from "../../shell";
import { requirePage } from "@/lib/page-guard";
import { parseDebtDay, supplierDebtSheet } from "@/lib/fin-report/debts";
import { DebtSheetView, mijozlarSubtabs } from "../qarz";

export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requirePage("/bi-tahlil/mijozlar/taminotchilar");
  const { sp, range } = await biContext(searchParams);
  const s = await supplierDebtSheet(parseDebtDay(sp.sana));
  return (
    <BiPage title="Mijozlar" subtitle="Ta'minotchilar bilan hisob-kitob: oy boshi va tanlangan kun holatiga qarz va avans" tab="customers" range={range} period={false} subtabs={mijozlarSubtabs(sp)} current="taminotchilar">
      <DebtSheetView who="supplier" s={s} sp={sp} base="/bi-tahlil/mijozlar/taminotchilar" />
    </BiPage>
  );
}
