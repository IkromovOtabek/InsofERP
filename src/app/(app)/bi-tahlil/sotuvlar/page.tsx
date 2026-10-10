import { biContext, BiPage } from "../shell";
import { SalesTab } from "../tabs/sales";
import { requirePage } from "@/lib/page-guard";

export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requirePage("/bi-tahlil/sotuvlar");
  const { sp, range } = await biContext(searchParams);
  return (
    <BiPage title="Sotuvlar" subtitle="Sotuv — mijozga yetkazilgan mahsulot, yetkazilgan sana bo'yicha (Moliya va Egasi paneli bilan bir xil). Sotuvchi — mijozga biriktirilgan agent, bo'lmasa zayavkani kiritgan xodim." tab="sales" range={range}>
      <SalesTab range={range} sp={sp} />
    </BiPage>
  );
}
