import { notFound } from "next/navigation";
import { getCompany } from "@/lib/company";
import { requireRoles } from "@/lib/page-guard";
import { customerAkt, parseAktRange } from "@/lib/fin-report/akt";
import { isoDate } from "@/lib/format";
import { AktSverkaDoc, AktToolbar } from "@/components/akt-sverka";

/**
 * Akt sverki — mijoz bilan o'zaro hisob-kitoblarni solishtirish dalolatnomasi (chop etish uchun).
 * Davr sukut bo'yicha: joriy yil boshidan bugungacha. Debet — hisob-fakturalar, kredit — to'lovlar.
 * Hisob va ko'rinish Tahlil → Mijozlar dagi akt bilan bitta (`lib/fin-report/akt.ts`, `components/akt-sverka.tsx`).
 * Eski havolalardagi `from`/`to` ham qabul qilinadi.
 */
export default async function AktSverki({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ dan?: string; gacha?: string; from?: string; to?: string }> }) {
  await requireRoles(["SALES", "ACCOUNTING", "FINANCE"], { module: "customers" });
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const { from, to } = parseAktRange(sp.dan ?? sp.from ?? isoDate(new Date(new Date().getFullYear(), 0, 1)), sp.gacha ?? sp.to);
  const [akt, company] = await Promise.all([customerAkt(id, from, to), getCompany()]);
  if (!akt) notFound();
  return (
    <div className="p-1 sm:p-4 print:p-0">
      <AktToolbar akt={akt} back={{ href: `/customers/${id}`, label: "Mijoz kartasi" }} />
      <AktSverkaDoc akt={akt} company={company} />
    </div>
  );
}
