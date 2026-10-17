import Link from "next/link";
import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { Printer, Copy, FilePlus2, Eye, EyeOff, QrCode, ScrollText, Inbox } from "lucide-react";
import { db } from "@/lib/db";
import { requirePage } from "@/lib/page-guard";
import { canDo } from "@/lib/permissions";
import { publicOrigin } from "@/lib/public-url";
import { date, dateTime, fmtNum, money } from "@/lib/format";
import { OFFER_STATE, offerPublicPath, offerState, offerTotals, offerUnitLabel } from "@/lib/offers";
import { Badge, Callout, Card, CardHeader, DL, LinkButton, PageHeader, Table, Td, Th, Tr } from "@/components/ui";
import { CopyLink, OfferStateButtons } from "./offer-actions";

/** Taklif kartasi: hujjat tafsiloti, chop etish, QR havolasi, mijoz ko'rganmi, holat amallari. */
export default async function OfferPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ yangi?: string }> }) {
  const s = await requirePage("/takliflar");
  const { id } = await params;
  const { yangi } = await searchParams;
  const o = await db.commercialOffer.findUnique({
    where: { id },
    include: { items: { orderBy: { sort: "asc" } }, manager: { select: { fullName: true } }, customer: { select: { id: true, name: true } }, order: { select: { id: true, orderNo: true } }, lead: { select: { id: true, name: true } } },
  });
  if (!o) notFound();
  const st = offerState(o);
  const meta = OFFER_STATE[st];
  const t = offerTotals(o.items.map((i) => ({ name: i.name, unit: i.unit, qty: Number(i.qty), price: Number(i.price) })), o.withVat, Number(o.advance));
  const { origin, fromEnv } = await publicOrigin();
  const url = `${origin}${offerPublicPath(o)}`;
  const qr = await QRCode.toString(url, { type: "svg", margin: 1, width: 112, errorCorrectionLevel: "M", color: { dark: "#000000", light: "#ffffff" } });
  const canCreate = canDo(s, "offers", "create");
  const canCancel = canDo(s, "offers", "cancel");
  const canOrder = canDo(s, "orders", "create") && !!o.customerId && st !== "CANCELLED";

  return (
    <>
      <PageHeader
        back={{ href: "/takliflar", label: "Tijorat takliflari" }}
        title={<>Tijorat taklifi {o.offerNo} <Badge color={meta.color}>{meta.label}</Badge></>}
        subtitle={<>{date(o.date)} · {o.manager.fullName} · amal qiladi {date(o.validUntil)} gacha{o.lang === "ru" && " · hujjat ruscha"}</>}
        action={<>
          {canOrder && <LinkButton href={`/orders/new?customer=${o.customerId}`} variant="secondary"><FilePlus2 size={16} /> Zayavka ochish</LinkButton>}
          {canCreate && <LinkButton href={`/takliflar/new?copy=${o.id}`} variant="secondary"><Copy size={16} /> Nusxa (yangi narx)</LinkButton>}
          <LinkButton href={`/takliflar/${o.id}/print`}><Printer size={16} /> Chop etish</LinkButton>
        </>}
      />

      {yangi && <div className="mb-4"><Callout tone="success" title="Taklif saqlandi">Endi «Chop etish» bilan A4 hujjatni chiqaring yoki pastdagi havolani mijozga Telegram orqali yuboring — u QR'siz ham ochiladi.</Callout></div>}
      {st === "EXPIRED" && <div className="mb-4"><Callout tone="warning" title="Taklif muddati o'tgan">Mijoz QR orqali ochsa «muddati o&apos;tgan» ko&apos;radi va qabul qila olmaydi. Yangilangan narx bilan «Nusxa» qiling.</Callout></div>}
      {st === "CANCELLED" && <div className="mb-4"><Callout tone="danger" title={`Bekor qilingan · ${o.cancelledAt ? dateTime(o.cancelledAt) : ""}`}>{o.cancelReason}</Callout></div>}
      {st === "ACCEPTED" && <div className="mb-4"><Callout tone="success" title={`Mijoz qabul qildi · ${o.acceptedAt ? dateTime(o.acceptedAt) : ""}`}>{o.acceptedBy}{o.acceptedNote && <> — «{o.acceptedNote}»</>}{canOrder && <> · keyingi qadam — <Link href={`/orders/new?customer=${o.customerId}`} className="underline">zayavka ochish</Link></>}</Callout></div>}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2" padded={false}>
          <div className="px-5 pt-5"><CardHeader title="Mahsulotlar va narxlar" icon={ScrollText} description={o.withVat ? "Narxlar QQS'siz kiritilgan, QQS 12% alohida" : "QQS'siz hujjat"} /></div>
          <Table>
            <thead><tr><Th>№</Th><Th>Nomi</Th><Th>Birlik</Th><Th right>Soni</Th><Th right>Narxi</Th>{o.withVat && <Th right>QQS bilan</Th>}<Th right>Summa</Th></tr></thead>
            <tbody>
              {t.lines.map((l, i) => (
                <Tr key={i}>
                  <Td className="text-slate-500">{i + 1}</Td>
                  <Td className="font-medium">{l.name}{!l.productId && <span className="ml-1 text-xs font-normal text-slate-400">xizmat</span>}</Td>
                  <Td>{offerUnitLabel(l.unit)}</Td>
                  <Td right className="tabular-nums">{fmtNum(l.qty, 3)}</Td>
                  <Td right className="tabular-nums">{fmtNum(l.price)}</Td>
                  {o.withVat && <Td right className="tabular-nums">{fmtNum(l.grossUnit)}</Td>}
                  <Td right className="font-medium tabular-nums">{fmtNum(l.gross)}</Td>
                </Tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-slate-50 text-sm">
                <Td colSpan={o.withVat ? 6 : 5} right className="text-slate-600">{o.withVat && <>QQS&apos;siz {money(t.net)} · QQS {money(t.vat)} · </>}Jami</Td>
                <Td right className="text-base font-semibold tabular-nums">{money(t.gross)}</Td>
              </tr>
              {t.advance > 0 && <>
                <tr><Td colSpan={o.withVat ? 6 : 5} right className="text-slate-600">Avans</Td><Td right className="tabular-nums">{money(t.advance)}</Td></tr>
                <tr><Td colSpan={o.withVat ? 6 : 5} right className="text-slate-600">Qoldiq</Td><Td right className="font-semibold tabular-nums">{money(t.rest)}</Td></tr>
              </>}
            </tfoot>
          </Table>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Mijoz" />
            <DL items={[
              { k: "Nomi", v: o.customer ? <Link href={`/customers/${o.customer.id}`} className="font-medium hover:underline">{o.clientName}</Link> : <>{o.clientName} <span className="text-xs text-slate-400">(bazada yo&apos;q)</span></> },
              { k: "Telefon", v: o.clientPhone ? <a href={`tel:${o.clientPhone}`} className="hover:underline">{o.clientPhone}</a> : "—" },
              { k: "INN", v: o.clientInn ?? "—" },
              { k: "Obyekt", v: o.objectName ?? "—" },
              { k: "Muddat", v: o.deadline ?? "—" },
              ...(o.order ? [{ k: "Zayavka", v: <Link href={`/orders/${o.order.id}`} className="hover:underline">{o.order.orderNo}</Link> }] : []),
              ...(o.lead ? [{ k: "Sayt arizasi", v: <Link href="/leads" className="inline-flex items-center gap-1 hover:underline"><Inbox size={13} /> {o.lead.name}</Link> }] : []),
              ...(o.note ? [{ k: "Ichki izoh", v: o.note }] : []),
            ]} />
            <div className="mt-4"><OfferStateButtons id={o.id} canCancel={canCancel} active={st === "ACTIVE" || st === "EXPIRED"} /></div>
          </Card>

          <Card>
            <CardHeader title="QR va mijoz havolasi" icon={QrCode} description="Mijoz skanerlaydi: haqiqiyligini ko'radi, menejerga qo'ng'iroq qiladi yoki «qabul qilaman» deydi" />
            <div className="flex items-start gap-4">
              <div className="shrink-0 rounded-lg border border-slate-200 bg-white p-1" dangerouslySetInnerHTML={{ __html: qr }} />
              <div className="min-w-0 space-y-2 text-sm">
                {o.viewCount > 0 ? (
                  <div className="inline-flex items-center gap-1.5 text-emerald-700"><Eye size={15} /> Mijoz {o.viewCount} marta ochdi</div>
                ) : (
                  <div className="inline-flex items-center gap-1.5 text-slate-500"><EyeOff size={15} /> Mijoz hali ochmagan</div>
                )}
                {o.firstViewedAt && <div className="text-xs text-slate-500">Birinchi: {dateTime(o.firstViewedAt)}{o.lastViewedAt && o.lastViewedAt.getTime() !== o.firstViewedAt.getTime() && <> · oxirgi: {dateTime(o.lastViewedAt)}</>}</div>}
              </div>
            </div>
            <div className="mt-3"><CopyLink url={url} /></div>
            {!fromEnv && <p className="mt-2 text-xs text-amber-700">Havola <b>{origin}</b> ga ishora qiladi — telefon bu manzilni ocha olmasligi mumkin. <code>.env</code> da <code>APP_URL</code> ni tashqi manzil qiling.</p>}
          </Card>
        </div>
      </div>
    </>
  );
}
