import { requirePage } from "@/lib/page-guard";
import { LedgerPage } from "../../ledger-view";

export const dynamic = "force-dynamic";

/**
 * Qarz varag'idagi qator: shu mijoz bilan davrdagi hisob-kitob — sotib olgan, to'lagan, boshlang'ich qoldiq
 * (har yozuvni tahrirlash / o'chirish) va akt sverka (`tab`, `dan`…`gacha`). Ko'rinish — `../../ledger-view.tsx`.
 */
export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ dan?: string; gacha?: string; tab?: string }> }) {
  const session = await requirePage("/bi-tahlil/mijozlar/xaridorlar");
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  return <LedgerPage who="customer" id={id} sp={sp} session={session} />;
}
