import { requirePage } from "@/lib/page-guard";
import { DebtEntry } from "../../kiritish";

export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<{ bekor?: string; q?: string }> }) {
  const s = await requirePage("/bi-tahlil/mijozlar/taminotchilar/kiritish");
  return <DebtEntry who="supplier" s={s} sp={await searchParams} />;
}
