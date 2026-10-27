import { BookOpen, LineChart, Scale, Wallet } from "lucide-react";
import { biContext, BiPage, type SP } from "../shell";
import { FinReportView, type ReportTab } from "../../moliya/report-view";

/**
 * Tahlil → Moliya bo'limining sahifalari: «Tahlil» (`/bi-tahlil/moliya`) va «Insof 2026» jadvalidagi rasmiy hisobotlar —
 * Foyda va zarar (`/pnl`), Pul oqimi (`/dds`), Balans (`/balans`). Sidebar'da «Moliya» ostida ham shu havolalar (`lib/nav.ts`).
 */
const BASE = "/bi-tahlil/moliya";
export const MOLIYA_LINKS: { key: "tahlil" | ReportTab; label: string; href: string; icon: typeof LineChart }[] = [
  { key: "tahlil", label: "Tahlil", href: BASE, icon: LineChart },
  { key: "pnl", label: "Foyda va zarar (PNL)", href: `${BASE}/pnl`, icon: BookOpen },
  { key: "dds", label: "Pul oqimi (DDS)", href: `${BASE}/dds`, icon: Wallet },
  { key: "balans", label: "Balans (BSH)", href: `${BASE}/balans`, icon: Scale },
];

/** Hisobotlar orasida o'tganda tanlangan davr (oy, n) saqlanadi. */
export function moliyaSubtabs(sp: SP) {
  const period = new URLSearchParams(Object.entries({ oy: sp.oy, n: sp.n }).filter((kv): kv is [string, string] => !!kv[1])).toString();
  return MOLIYA_LINKS.map((l) => ({ key: l.key, label: l.label, icon: l.icon, href: l.key !== "tahlil" && period ? `${l.href}?${period}` : l.href }));
}

export async function MoliyaReportPage({ tab, searchParams }: { tab: ReportTab; searchParams: Promise<SP> }) {
  const { sp, range } = await biContext(searchParams);
  return (
    <BiPage title="Moliya" subtitle="Foyda va zarar, pul mablag'lari harakati va balans — oylar bo'yicha" tab="finance" range={range} period={false} subtabs={moliyaSubtabs(sp)} current={tab}>
      <FinReportView base={MOLIYA_LINKS.find((l) => l.key === tab)!.href} sp={{ ...sp, tab }} tabs={false} />
    </BiPage>
  );
}
