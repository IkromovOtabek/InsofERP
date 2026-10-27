import { requirePage } from "@/lib/page-guard";
import type { SP } from "../../shell";
import { MoliyaReportPage } from "../report-page";

export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<SP> }) {
  await requirePage("/bi-tahlil/moliya/balans");
  return <MoliyaReportPage tab="balans" searchParams={searchParams} />;
}
