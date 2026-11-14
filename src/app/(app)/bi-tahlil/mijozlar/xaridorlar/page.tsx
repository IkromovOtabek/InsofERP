import { biContext, BiPage } from "../../shell";
import { requirePage } from "@/lib/page-guard";
import { getCompany } from "@/lib/company";
import { customerDebtSheet, parseDebtDay, parseDebtStart } from "@/lib/fin-report/debts";
import { DebtSheetView } from "../qarz";
import { canEnterDebts, debtEntryHref } from "../kiritish";
import { DebtTransferButton } from "../debt-dialogs";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const session = await requirePage("/bi-tahlil/mijozlar/xaridorlar");
  const { sp, range } = await biContext(searchParams, "/bi-tahlil/mijozlar/xaridorlar");
  const day = parseDebtDay(sp.sana);
  const canFix = canEnterDebts(session);
  const [s, company, customers] = await Promise.all([
    customerDebtSheet(day, sp.tur === "CASH" || sp.tur === "BANK" ? sp.tur : null, parseDebtStart(sp.dan, day)),
    getCompany(),
    // «Boshqa mijoz to'lovi» oynasidagi tanlov — faqat kiritish huquqi borlarga
    canFix ? db.customer.findMany({ where: { isActive: true, isInternal: false }, orderBy: { name: "asc" }, select: { id: true, name: true } }) : [],
  ]);
  return (
    <BiPage title="Mijozlar" subtitle="Xaridorlar bilan hisob-kitob" info={<>
      <p>Xaridorlar bilan hisob-kitob: davr boshidagi qarzdorlik/haqdorlik, sotib olgan, to&apos;lagan va hozirgi holat.</p>
      <p>Summani bosing — tafsilot (mahsulot, sana, to&apos;lovlar); nomni bosing — akt sverka.</p>
    </>} tab="customers" range={range} period={false}>
      <DebtSheetView who="customer" s={s} sp={sp} base="/bi-tahlil/mijozlar/xaridorlar" company={company.legalName ?? company.name} entryHref={canFix ? debtEntryHref("customer") : undefined}
        canFix={canFix} transfer={canFix ? <DebtTransferButton customers={customers} /> : undefined} />
    </BiPage>
  );
}
