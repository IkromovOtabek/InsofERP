import { notFound } from "next/navigation";
import { requirePage } from "@/lib/page-guard";
import { getCompany } from "@/lib/company";
import { supplierAkt, parseAktRange } from "@/lib/fin-report/akt";
import { isoDate } from "@/lib/format";
import { AktSverkaDoc, AktToolbar } from "@/components/akt-sverka";

export const dynamic = "force-dynamic";

/** Ta'minotchilar oldidagi qarzdorlik jadvalidagi qatorni bosganda — shu yetkazuvchi bilan akt sverka (`dan`…`gacha`). */
export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ dan?: string; gacha?: string }> }) {
  await requirePage("/bi-tahlil/mijozlar/taminotchilar");
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const { from, to } = parseAktRange(sp.dan, sp.gacha);
  const [akt, company] = await Promise.all([supplierAkt(id, from, to), getCompany()]);
  if (!akt) notFound();
  return (
    <div className="p-1 sm:p-4 print:p-0">
      <AktToolbar akt={akt} back={{ href: `/bi-tahlil/mijozlar/taminotchilar?dan=${isoDate(from)}&sana=${isoDate(to)}`, label: "Ta'minotchilar qarzdorligi" }} />
      <AktSverkaDoc akt={akt} company={company} />
    </div>
  );
}
