import { biContext, BiPage } from "../shell";
import { SalesTab } from "../tabs/sales";
import { requirePage } from "@/lib/page-guard";

export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requirePage("/bi-tahlil/sotuvlar");
  const { sp, range } = await biContext(searchParams);
  return (
    <BiPage title="Sotuvlar" info={<>
      <p>Sotuv — Sotuv → Realizatsiya reestrining o&apos;zi: o&apos;sha qatorlar, o&apos;sha sana, «Jami» QQS va dastavka bilan (Moliya va Egasi paneli bilan bir xil). Marja va PNL — QQS&apos;siz, dastavkasiz.</p>
      <p>Sotuvchi — mijozga biriktirilgan agent, bo&apos;lmasa zayavkani kiritgan xodim.</p>
    </>} tab="sales" range={range}>
      <SalesTab range={range} sp={sp} />
    </BiPage>
  );
}
