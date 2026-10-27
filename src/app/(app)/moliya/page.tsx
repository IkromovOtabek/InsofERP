import { requirePage } from "@/lib/page-guard";
import { PageHeader } from "@/components/ui";
import { MoliyaTabs } from "./moliya-tabs";
import { FinReportView } from "./report-view";

/**
 * Moliyaviy hisobotlar — «Insof 2026» jadvalidagi PNL, Cash Flow va BSH varaqlari o'rnida (`lib/fin-report`).
 * Oylar ustunda (eng ko'pi 12). Ko'rinish — `report-view.tsx` (direktorning «Tahlil → Moliya» bo'limi ham shu).
 */
export default async function MoliyaPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requirePage("/moliya");
  const sp = await searchParams;
  return (
    <div>
      <PageHeader eyebrow="Moliya" title="Moliyaviy hisobotlar" subtitle="Foyda va zarar, pul mablag'lari harakati va balans" />
      <MoliyaTabs current="/moliya" />
      <FinReportView base="/moliya" sp={sp} />
    </div>
  );
}
