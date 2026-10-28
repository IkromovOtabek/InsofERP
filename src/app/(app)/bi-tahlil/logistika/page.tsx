import { biContext, BiPage } from "../shell";
import { requirePage } from "@/lib/page-guard";
import { SkladLogistika } from "@/app/(app)/dashboard/mechanic-home";

export const dynamic = "force-dynamic";

/** Logistika tahlili — kunlik zayavka, jo'natish, transport ehtiyoji va mahsulot yetarliligi (texnika — Tahlil → Mexanik). */
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requirePage("/bi-tahlil/logistika");
  const { sp, range } = await biContext(searchParams);
  return (
    <BiPage title="Logistika" subtitle="Bugungi va ertangi zayavkalar, jo'natish, transport ehtiyoji va mahsulot yetarliligi" tab="logistics" range={range} period={false}>
      <SkladLogistika day={sp.date} base="/bi-tahlil/logistika" />
    </BiPage>
  );
}
