import { notFound } from "next/navigation";
import { requirePage } from "@/lib/page-guard";
import { getCompany } from "@/lib/company";
import { customerAkt, parseAktRange } from "@/lib/fin-report/akt";
import { isoDate } from "@/lib/format";
import { AktSverkaDoc, AktToolbar } from "@/components/akt-sverka";

export const dynamic = "force-dynamic";

/** Xaridorlar qarzdorligi jadvalidagi qatorni bosganda — shu mijoz bilan akt sverka (`dan`…`gacha`). */
export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ dan?: string; gacha?: string }> }) {
  await requirePage("/bi-tahlil/mijozlar/xaridorlar");
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const { from, to } = parseAktRange(sp.dan, sp.gacha);
  const [akt, company] = await Promise.all([customerAkt(id, from, to), getCompany()]);
  if (!akt) notFound();
  return (
    <div className="p-1 sm:p-4 print:p-0">
      <AktToolbar akt={akt} back={{ href: `/bi-tahlil/mijozlar/xaridorlar?dan=${isoDate(from)}&sana=${isoDate(to)}`, label: "Xaridorlar qarzdorligi" }} />
      <AktSverkaDoc akt={akt} company={company} />
    </div>
  );
}
