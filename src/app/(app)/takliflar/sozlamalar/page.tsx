import Link from "next/link";
import { redirect } from "next/navigation";
import { Building2, FileText } from "lucide-react";
import { requirePage } from "@/lib/page-guard";
import { canDo } from "@/lib/permissions";
import { getCompany } from "@/lib/company";
import { OFFER_DEFAULT_INTRO, OFFER_DEFAULT_TERMS } from "@/lib/offers";
import { Callout, Card, CardHeader, DL, PageHeader } from "@/components/ui";
import { OfferSettingsForm } from "./settings-form";

/** Tijorat taklifi hujjati sozlamalari — matnlar, OKED, QQS raqami, standart muddat (direktor yoki «settings» ruxsati). */
export default async function OfferSettingsPage() {
  const s = await requirePage("/takliflar");
  if (!canDo(s, "offers", "settings")) redirect("/takliflar?denied=1");
  const c = await getCompany();
  return (
    <>
      <PageHeader back={{ href: "/takliflar", label: "Tijorat takliflari" }} title="Hujjat sozlamalari" subtitle="Taklif boshidagi matn, oxiridagi shartlar va rekvizitlar. Zavod nomi, bank, INN, telefonlar — Sozlamalar → Zavod rekvizitlari'dan olinadi." />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Matnlar va rekvizitlar" icon={FileText} />
          <OfferSettingsForm v={{ oked: c.oked, vatRegNo: c.vatRegNo, offerIntro: c.offerIntro, offerTerms: c.offerTerms, offerValidDays: c.offerValidDays }} defaults={{ intro: OFFER_DEFAULT_INTRO, terms: OFFER_DEFAULT_TERMS }} />
        </Card>
        <div className="space-y-4">
          <Card>
            <CardHeader title="Hujjatga chiqadigan rekvizitlar" icon={Building2} description="Zavod rekvizitlaridan" />
            <DL items={[
              { k: "Nomi", v: c.legalName ?? c.name },
              { k: "Manzil", v: c.address ?? "—" },
              { k: "H/r", v: c.bankAccount ?? "—" },
              { k: "Bank", v: c.bankName ?? "—" },
              { k: "MFO", v: c.mfo ?? "—" },
              { k: "INN", v: c.inn ?? "—" },
              { k: "Telefonlar", v: [c.phone, c.phone2].filter(Boolean).join(", ") || "—" },
              { k: "Telegram", v: c.telegram ?? "—" },
            ]} />
            <p className="mt-3 text-xs text-slate-500">O&apos;zgartirish: <Link href="/settings?tab=company" className="underline">Sozlamalar → Zavod rekvizitlari</Link>. Menejer telefoni — xodim kartasidagi telefon.</p>
          </Card>
          <Callout tone="info" title="QR kod nima qiladi">
            Mijoz skanerlaganda ommaviy sahifa ochiladi: hujjat haqiqiyligi va muddati, mahsulotlar va summa, menejerga qo&apos;ng&apos;iroq / Telegram, «Taklifni qabul qilaman» va «Savol berish» tugmalari. Har ochilish ERP&apos;da «mijoz ko&apos;rdi» deb qayd etiladi, qabul — sotuvga ariza bo&apos;lib tushadi.
          </Callout>
        </div>
      </div>
    </>
  );
}
