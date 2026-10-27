import { redirect } from "next/navigation";
import { biContext, BiPage } from "../shell";
import { FinanceTab } from "../tabs/finance";
import { requirePage } from "@/lib/page-guard";
import { isReportTab } from "../../moliya/report-view";
import { MOLIYA_LINKS } from "./report-page";

export const dynamic = "force-dynamic";

/**
 * Tahlil → Moliya: «Tahlil» (yo'qotish kanallari, cash forecast, P&L sharsharasi, debitorka aging). Rasmiy hisobotlar —
 * Foyda va zarar, Pul oqimi, Balans — alohida sahifalarda (`./pnl`, `./dds`, `./balans`); eski `?tab=` havolalari o'sha yerga.
 */
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requirePage("/bi-tahlil/moliya");
  const { sp, range } = await biContext(searchParams);
  if (isReportTab(sp.tab)) {
    const { tab, ...rest } = sp;
    const q = new URLSearchParams(Object.entries(rest).filter((kv): kv is [string, string] => !!kv[1])).toString();
    redirect(`${MOLIYA_LINKS.find((l) => l.key === tab)!.href}${q ? `?${q}` : ""}`);
  }
  return (
    <BiPage title="Moliya" subtitle="Pul qayerdan oqyapti va kassada nima bo'ladi — yo'qotish kanallari, kassa prognozi, foyda yo'qotishlari, foyda-zarar, qarz yoshi." tab="finance" range={range}>
      <FinanceTab range={range} sp={sp} />
    </BiPage>
  );
}
