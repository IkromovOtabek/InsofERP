import { notFound } from "next/navigation";
import { Card, PageHeader } from "@/components/ui";
import { db } from "@/lib/db";
import { requirePage } from "@/lib/page-guard";
import { canDo } from "@/lib/permissions";
import { crmOptions } from "@/lib/crm/clients";
import { todayIso } from "@/lib/crm/dates";
import { T } from "@/lib/crm/labels";
import { ContactForm } from "./contact-form";

export default async function WriteContactPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ back?: string }> }) {
  const s = await requirePage("/crm/mijozlar");
  if (!canDo(s, "crm", "contact")) notFound();
  const { id } = await params;
  const { back } = await searchParams;
  const [c, results, opts] = await Promise.all([
    db.customer.findFirst({ where: { id, isInternal: false }, select: { id: true, name: true, phone: true } }),
    db.crmResult.findMany({ where: { isActive: true }, orderBy: [{ sort: "asc" }], select: { id: true, label: true, group: true, nextRule: true, defaultDays: true } }),
    crmOptions(),
  ]);
  if (!c) notFound();
  // onlinePBX: so'nggi soatdagi chiquvchi qo'ng'iroq javobsiz bo'lsa — «Telefon ko'tarmadi» tanlanib turadi
  const last = await db.crmCall.findFirst({
    where: { customerId: id, contactId: null, direction: "OUT", startedAt: { gte: new Date(Date.now() - 3_600_000) }, OR: [{ userId: s.userId }, { userId: null }] },
    orderBy: { startedAt: "desc" }, select: { talkSec: true, startedAt: true },
  });
  const noAnswer = results.find((r) => r.label.startsWith("Telefon ko'tarmadi"));
  const hm = (d: Date) => new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Tashkent", hour: "2-digit", minute: "2-digit" }).format(d);
  const suggest = last
    ? last.talkSec === 0 && noAnswer
      ? { resultId: noAnswer.id, hint: `Qo'ng'iroq ${hm(last.startedAt)} — javob bo'lmadi` }
      : last.talkSec > 0 ? { resultId: "", hint: `Qo'ng'iroq ${hm(last.startedAt)} — ${Math.floor(last.talkSec / 60)}:${String(last.talkSec % 60).padStart(2, "0")} gaplashildi, natijani tanlang` } : null
    : null;
  const cc = !!back && (back === "/crm/callcenter" || back.startsWith("/crm/callcenter?"));
  const backHref = back === "bugun" ? "/crm" : cc ? back : `/crm/mijozlar/${id}`;
  return (
    <div className="mx-auto max-w-xl">
      <PageHeader title={T.contact.title} subtitle={c.name} back={{ href: backHref, label: back === "bugun" ? T.today.title : cc ? T.nav.callCenter : c.name }} />
      <Card>
        <ContactForm customerId={c.id} today={todayIso()} results={results} channels={opts.CHANNEL} products={opts.PRODUCT} sources={opts.SOURCE} back={backHref} suggest={suggest} />
      </Card>
    </div>
  );
}
