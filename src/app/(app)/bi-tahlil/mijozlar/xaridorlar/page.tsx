import { biContext, BiPage } from "../../shell";
import { requirePage } from "@/lib/page-guard";
import { getCompany } from "@/lib/company";
import { customerDebtSheet, parseDebtDay, parseDebtStart } from "@/lib/fin-report/debts";
import { DebtSheetView } from "../qarz";
import { canEnterDebts, debtEntryHref } from "../kiritish";

export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const session = await requirePage("/bi-tahlil/mijozlar/xaridorlar");
  const { sp, range } = await biContext(searchParams, "/bi-tahlil/mijozlar/xaridorlar");
  const day = parseDebtDay(sp.sana);
  const [s, company] = await Promise.all([customerDebtSheet(day, sp.tur === "CASH" || sp.tur === "BANK" ? sp.tur : null, parseDebtStart(sp.dan, day)), getCompany()]);
  return (
    <BiPage title="Mijozlar" subtitle="Xaridorlar bilan hisob-kitob" info={<>
      <p>Xaridorlar bilan hisob-kitob: davr boshi va oxiri holatiga qarz va avans.</p>
      <p>Qatorni bosing — akt sverka.</p>
    </>} tab="customers" range={range} period={false}>
      <DebtSheetView who="customer" s={s} sp={sp} base="/bi-tahlil/mijozlar/xaridorlar" company={company.legalName ?? company.name} entryHref={canEnterDebts(session) ? debtEntryHref("customer") : undefined} />
    </BiPage>
  );
}
