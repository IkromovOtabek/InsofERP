import { biContext, BiPage } from "../../shell";
import { requirePage } from "@/lib/page-guard";
import { getCompany } from "@/lib/company";
import { parseDebtDay, parseDebtStart, supplierDebtSheet } from "@/lib/fin-report/debts";
import { DebtSheetView } from "../qarz";
import { canEnterDebts, debtEntryHref } from "../kiritish";

export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const session = await requirePage("/bi-tahlil/mijozlar/taminotchilar");
  const { sp, range } = await biContext(searchParams, "/bi-tahlil/mijozlar/taminotchilar");
  const day = parseDebtDay(sp.sana);
  const [s, company] = await Promise.all([supplierDebtSheet(day, parseDebtStart(sp.dan, day)), getCompany()]);
  return (
    <BiPage title="Mijozlar" subtitle="Ta'minotchilar bilan hisob-kitob" info={<>
      <p>Ta&apos;minotchilar bilan hisob-kitob: davr boshi va oxiri holatiga qarz va avans.</p>
      <p>Qatorni bosing — akt sverka.</p>
    </>} tab="customers" range={range} period={false}>
      <DebtSheetView who="supplier" s={s} sp={sp} base="/bi-tahlil/mijozlar/taminotchilar" company={company.legalName ?? company.name} entryHref={canEnterDebts(session) ? debtEntryHref("supplier") : undefined} />
    </BiPage>
  );
}
