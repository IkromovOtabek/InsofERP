import { biContext, BiPage, type SP } from "../shell";
import { FinReportView, type ReportTab } from "../../moliya/report-view";

/**
 * Tahlil → Moliya bo'limining sahifalari: «Tahlil» (`/bi-tahlil/moliya`) va «Insof 2026» jadvalidagi rasmiy hisobotlar —
 * Foyda va zarar (`/pnl`), Pul oqimi (`/dds`), Balans (`/balans`), To'lov kalendari va To'lov rejasi, Mahsulot foydasi va
 * Tannarx hisobi. Ular orasida o'tish — sidebar'da «Moliya» ostida (`lib/nav.ts`).
 */
export type MoliyaKey = "tahlil" | ReportTab | "ish-haqi" | "kalendar" | "tolov-rejasi" | "mahsulot-foydasi" | "tannarx";
const BASE = "/bi-tahlil/moliya";
export const MOLIYA_LINKS: { key: MoliyaKey; label: string; href: string }[] = [
  { key: "tahlil", label: "Tahlil", href: BASE },
  { key: "pnl", label: "Foyda va zarar (PNL)", href: `${BASE}/pnl` },
  { key: "dds", label: "Pul oqimi (DDS)", href: `${BASE}/dds` },
  { key: "balans", label: "Balans (BSH)", href: `${BASE}/balans` },
  { key: "ish-haqi", label: "Ish haqi vedomosti", href: `${BASE}/ish-haqi` },
  { key: "kalendar", label: "To'lov kalendari", href: `${BASE}/kalendar` },
  { key: "tolov-rejasi", label: "To'lov rejasi", href: `${BASE}/tolov-rejasi` },
  { key: "mahsulot-foydasi", label: "Mahsulot foydasi", href: `${BASE}/mahsulot-foydasi` },
  { key: "tannarx", label: "Tannarx hisobi", href: `${BASE}/tannarx` },
];


export async function MoliyaReportPage({ tab, searchParams }: { tab: ReportTab; searchParams: Promise<SP> }) {
  const { sp, range } = await biContext(searchParams);
  return (
    <BiPage title="Moliya" subtitle="Foyda va zarar, pul mablag'lari harakati va balans — oylar bo'yicha" tab="finance" range={range} period={false}>
      <FinReportView base={MOLIYA_LINKS.find((l) => l.key === tab)!.href} sp={{ ...sp, tab }} tabs={false} />
    </BiPage>
  );
}
