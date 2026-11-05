import { requirePage } from "@/lib/page-guard";
import { DebtEntry } from "../../kiritish";

export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<{ bekor?: string; q?: string }> }) {
  const s = await requirePage("/bi-tahlil/mijozlar/xaridorlar/kiritish");
  return <DebtEntry who="customer" s={s} sp={await searchParams} />;
}
