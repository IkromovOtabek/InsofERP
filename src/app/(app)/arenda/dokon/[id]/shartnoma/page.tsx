import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requirePage } from "@/lib/page-guard";
import { currentLeases } from "@/lib/rent";
import { getRentLessor } from "@/lib/rent-lessor";
import { PrintButton } from "@/components/print-button";
import { BackLink } from "@/components/ui";
import { cn } from "@/lib/utils";
import { ContractDoc, type ContractData, type ContractLang } from "./contract-text";

/**
 * Ijara shartnomasi — chop etish uchun (A4), sekretarning «Договор аренды нежилого помещения» shabloni bo'yicha:
 * ruscha, o'zbekcha yoki ikkalasi (`?til=ru|uz|ikki`), 1-ilova (qabul-topshirish) va 2-ilova (qaytarish) bilan.
 * Ma'lumot: shartnoma (`RentLease`: ijarachi, rekvizitlari, muddat, zaklad), do'kon (manzil, kadastr, maydon, ijara haqi,
 * to'lov kuni, svet) va ijaraga beruvchi rekvizitlari (`lib/rent-lessor.ts`). `?lease=` — qaysi shartnoma, berilmasa — joriysi.
 */
export default async function RentContractPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ lease?: string; til?: string }> }) {
  await requirePage("/arenda");
  const { id } = await params;
  const sp = await searchParams;
  const shop = await db.rentShop.findUnique({ where: { id } });
  if (!shop) notFound();
  const leaseId = sp.lease ?? (await currentLeases([id])).get(id)?.id ?? null;
  const lease = leaseId ? await db.rentLease.findUnique({ where: { id: leaseId } }) : null;
  if (!lease || lease.shopId !== id) notFound();
  const lessor = await getRentLessor();
  const til = sp.til === "uz" || sp.til === "ikki" ? sp.til : "ru";
  const langs: ContractLang[] = til === "ikki" ? ["ru", "uz"] : [til];

  const d: ContractData = {
    no: lease.no ?? "____", date: lease.startDate, city: lessor.city || "Ташкент",
    lessor: {
      person: lessor.kind === "person", name: lessor.name, basis: lessor.basis, address: lessor.address, inn: lessor.inn, bank: lessor.bank,
      mfo: lessor.mfo, account: lessor.account, card: lessor.card, phone: lessor.phone, taxPercent: lessor.taxPercent,
    },
    tenant: {
      name: lease.tenantName ?? "", rep: lease.tenantRep ?? "", address: lease.tenantAddress ?? "", inn: lease.inn ?? "",
      account: lease.tenantAccount ?? "", mfo: lease.tenantMfo ?? "", phone: lease.phone ?? "",
    },
    object: { address: shop.address ?? `${shop.location}, ${shop.name}`, cadastre: shop.cadastre ?? "", area: shop.area ? Number(shop.area) : null },
    rent: {
      daily: shop.period === "DAILY", bank: Number(shop.bankAmount), cash: Number(shop.cashAmount), payDay: shop.payDay,
      start: lease.startDate, end: lease.endDate, deposit: Number(lease.deposit), electricity: shop.electricityBilled, elecFixed: Number(shop.elecFixed),
    },
    note: lease.note,
  };
  const missing = [
    !lease.tenantName && "ijarachi F.I.O./nomi", !lease.tenantRep && "ijarachi vakili/asosi", !shop.address && "joy manzili",
    !shop.cadastre && "kadastr raqami", !shop.area && "maydoni (m²)", !lessor.basis && "ijaraga beruvchi asosi (pasport yoki vakil)",
  ].filter(Boolean) as string[];
  const href = (t: string) => `/arenda/dokon/${id}/shartnoma?lease=${lease.id}${t === "ru" ? "" : `&til=${t}`}`;

  return (
    <div className="paper mx-auto max-w-[210mm] bg-white p-10 text-[13px] leading-relaxed text-black print:max-w-none print:p-0">
      <style>{`@media print { @page { size: A4 portrait; margin: 15mm } aside, nav, header { display: none } body { background: #fff } .contract-page { break-after: page } .contract-page:last-child { break-after: auto } }`}</style>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <BackLink href={`/arenda/dokon/${id}`} label={shop.name} />
        <div className="inline-flex rounded-lg border border-slate-200 p-0.5 text-sm">
          {([["ru", "Ruscha"], ["uz", "O'zbekcha"], ["ikki", "Ikkalasi"]] as const).map(([k, l]) => (
            <Link key={k} href={href(k)} className={cn("rounded-md px-3 py-1.5 font-medium no-underline", til === k ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100")}>{l}</Link>
          ))}
        </div>
        <PrintButton />
      </div>
      {missing.length > 0 && (
        <div className="mb-6 rounded-lg border border-amber-300 bg-amber-50 p-3 text-[12px] text-amber-900 print:hidden">
          Kiritilmagan: {missing.join(", ")} — shartnomada chiziq (____) bo&apos;lib chiqadi. Do&apos;kon «Tahrirlash» va «Do&apos;konlar» tabidagi «Ijaraga beruvchi rekvizitlari» da to&apos;ldiring.
        </div>
      )}
      {langs.map((l) => <ContractDoc key={l} lang={l} d={d} basisUz={lessor.basisUz} />)}
    </div>
  );
}
