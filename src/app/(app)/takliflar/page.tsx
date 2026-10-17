import Link from "next/link";
import { FileBadge2, Plus, Eye, Settings2, CheckCircle2, Clock, Hourglass } from "lucide-react";
import { db } from "@/lib/db";
import { requirePage } from "@/lib/page-guard";
import { canDo } from "@/lib/permissions";
import { date, money } from "@/lib/format";
import { OFFER_STATE, offerState, offerStateWhere, offerTotals, type OfferState } from "@/lib/offers";
import { Badge, Button, Empty, Input, LinkButton, PageHeader, StatCard, Table, Tabs, Td, Th, Tr } from "@/components/ui";
import type { Prisma } from "@/generated/prisma";

const TABS: { key: "" | OfferState; label: string }[] = [
  { key: "", label: "Hammasi" }, { key: "ACTIVE", label: "Amal qiladi" }, { key: "ACCEPTED", label: "Qabul qilingan" }, { key: "EXPIRED", label: "Muddati o'tgan" }, { key: "CANCELLED", label: "Bekor qilingan" },
];

/** Tijorat takliflari ro'yxati — holat bo'yicha tablar, raqam/mijoz qidiruvi; QR orqali ko'rilganlar soni. */
export default async function OffersPage({ searchParams }: { searchParams: Promise<{ holat?: string; q?: string; customer?: string }> }) {
  const s = await requirePage("/takliflar");
  const { holat, q, customer } = await searchParams;
  const state = TABS.some((t) => t.key === holat) && holat ? (holat as OfferState) : undefined;
  const canCreate = canDo(s, "offers", "create");
  const canSettings = canDo(s, "offers", "settings");

  const where: Prisma.CommercialOfferWhereInput = {
    ...offerStateWhere(state),
    ...(customer ? { customerId: customer } : {}),
    ...(q?.trim() ? { OR: [{ offerNo: { contains: q.trim(), mode: "insensitive" } }, { clientName: { contains: q.trim(), mode: "insensitive" } }, { objectName: { contains: q.trim(), mode: "insensitive" } }] } : {}),
  };
  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
  const [rows, nActive, nExpired, accepted, unseen] = await Promise.all([
    db.commercialOffer.findMany({ where, orderBy: { createdAt: "desc" }, take: 200, include: { items: true, manager: { select: { fullName: true } }, customer: { select: { id: true, name: true } } } }),
    db.commercialOffer.count({ where: offerStateWhere("ACTIVE") }),
    db.commercialOffer.count({ where: offerStateWhere("EXPIRED") }),
    db.commercialOffer.findMany({ where: { status: "ACCEPTED", acceptedAt: { gte: monthStart } }, include: { items: true } }),
    db.commercialOffer.count({ where: { ...offerStateWhere("ACTIVE"), viewCount: 0 } }),
  ]);
  const sumOf = (o: { items: { qty: unknown; price: unknown; name: string; unit: string }[]; withVat: boolean }) =>
    offerTotals(o.items.map((i) => ({ name: i.name, unit: i.unit, qty: Number(i.qty), price: Number(i.price) })), o.withVat).gross;
  const acceptedSum = accepted.reduce((a, o) => a + sumOf(o), 0);
  const keep = (k: string) => { const p = new URLSearchParams(); if (k) p.set("holat", k); if (q) p.set("q", q); if (customer) p.set("customer", customer); const str = p.toString(); return `/takliflar${str ? `?${str}` : ""}`; };

  return (
    <>
      <PageHeader
        title="Tijorat takliflari" eyebrow="Sotuv"
        subtitle="Mijozga beriladigan rasmiy narx hujjati — zayavkadan mustaqil. Chop etiladi, QR orqali mijoz haqiqiyligini tekshiradi va qabul qiladi."
        action={<>
          {canSettings && <LinkButton href="/takliflar/sozlamalar" variant="secondary"><Settings2 size={16} /> Hujjat sozlamalari</LinkButton>}
          {canCreate && <LinkButton href="/takliflar/new"><Plus size={16} /> Yangi taklif</LinkButton>}
        </>}
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Amaldagi takliflar" value={String(nActive)} icon={FileBadge2} href={keep("ACTIVE")} />
        <StatCard label="Shu oy qabul qilingan" value={money(acceptedSum)} hint={`${accepted.length} ta taklif`} icon={CheckCircle2} tone="success" href={keep("ACCEPTED")} />
        <StatCard label="Muddati o'tgan" value={String(nExpired)} hint="Yangilangan narx bilan qayta yuboring" icon={Hourglass} tone={nExpired ? "warning" : "default"} href={keep("EXPIRED")} />
        <StatCard label="Mijoz hali ochmagan" value={String(unseen)} hint="Amaldagi, QR skanerlanmagan" icon={Clock} />
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Tabs current={state ?? ""} items={TABS.map((t) => ({ key: t.key, label: t.label, href: keep(t.key) }))} />
        <form className="flex items-center gap-2">
          {state && <input type="hidden" name="holat" value={state} />}
          {customer && <input type="hidden" name="customer" value={customer} />}
          <Input name="q" defaultValue={q ?? ""} placeholder="№ yoki mijoz…" className="w-56" />
          <Button variant="secondary">Qidirish</Button>
        </form>
      </div>

      {rows.length === 0 ? (
        <Empty text={q ? "Qidiruv bo'yicha taklif topilmadi" : "Hali taklif yo'q — «Yangi taklif» bilan birinchisini tuzing"} icon={FileBadge2} />
      ) : (
        <Table>
          <thead><tr><Th>№ / sana</Th><Th>Mijoz</Th><Th>Obyekt</Th><Th right>Summa</Th><Th>Amal qiladi</Th><Th>Menejer</Th><Th>Holat</Th><Th right>Ko&apos;rildi</Th></tr></thead>
          <tbody>
            {rows.map((o) => {
              const st = offerState(o);
              const meta = OFFER_STATE[st];
              return (
                <Tr key={o.id}>
                  <Td><Link href={`/takliflar/${o.id}`} className="font-medium text-slate-900 hover:underline">{o.offerNo}</Link><div className="text-xs text-slate-500">{date(o.date)}</div></Td>
                  <Td>{o.customer ? <Link href={`/customers/${o.customer.id}`} className="hover:underline">{o.clientName}</Link> : <span>{o.clientName}<span className="ml-1 text-xs text-slate-400">(bazada yo&apos;q)</span></span>}{o.clientPhone && <div className="text-xs text-slate-500">{o.clientPhone}</div>}</Td>
                  <Td className="max-w-[220px] truncate text-slate-600">{o.objectName ?? "—"}</Td>
                  <Td right className="font-medium tabular-nums">{money(sumOf(o))}</Td>
                  <Td className={st === "EXPIRED" ? "text-amber-700" : ""}>{date(o.validUntil)}</Td>
                  <Td className="text-slate-600">{o.manager.fullName}</Td>
                  <Td><Badge color={meta.color}>{meta.label}</Badge></Td>
                  <Td right>{o.viewCount > 0 ? <span className="inline-flex items-center gap-1 text-emerald-700" title={o.lastViewedAt ? `Oxirgi: ${date(o.lastViewedAt)}` : undefined}><Eye size={14} /> {o.viewCount}</span> : <span className="text-slate-400">—</span>}</Td>
                </Tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </>
  );
}
