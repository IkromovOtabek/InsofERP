import { biContext, BiPage } from "../../shell";
import { requirePage } from "@/lib/page-guard";
import { customerDebtSheet, parseDebtDay } from "@/lib/fin-report/debts";
import { DebtSheetView, mijozlarSubtabs } from "../qarz";

export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requirePage("/bi-tahlil/mijozlar/xaridorlar");
  const { sp, range } = await biContext(searchParams);
  const s = await customerDebtSheet(parseDebtDay(sp.sana), sp.tur === "CASH" || sp.tur === "BANK" ? sp.tur : null);
  return (
    <BiPage title="Mijozlar" subtitle="Xaridorlar bilan hisob-kitob: oy boshi va tanlangan kun holatiga qarz va avans" tab="customers" range={range} period={false} subtabs={mijozlarSubtabs(sp)} current="xaridorlar">
      <DebtSheetView who="customer" s={s} sp={sp} base="/bi-tahlil/mijozlar/xaridorlar" />
    </BiPage>
  );
}
