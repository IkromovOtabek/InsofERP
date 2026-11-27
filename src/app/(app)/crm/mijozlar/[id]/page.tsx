import Link from "next/link";
import { notFound } from "next/navigation";
import { ClipboardPlus, ExternalLink, MessageCircle, Pencil, Phone, Send } from "lucide-react";
import { Badge, Card, CardHeader, DL, EmptyState, LinkButton, PageHeader } from "@/components/ui";
import { requirePage } from "@/lib/page-guard";
import { canDo } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { date, money } from "@/lib/format";
import { dbToIso, fullIso } from "@/lib/crm/dates";
import { formatPhone } from "@/lib/phone";
import { orderTotal } from "@/lib/order-total";
import { clientCard, telLink, telegramLink } from "@/lib/crm/clients";
import { ACTIVITY_COLOR, ACTIVITY_LABEL, FUNNEL_STAGES, GROUP_COLOR, STATUS_COLOR, STATUS_LABEL, T } from "@/lib/crm/labels";
import { OrderStatusBadge } from "../../../orders/status";
import { CancelContact } from "./cancel-contact";
import { orderPayments, PAY_COLOR, PAY_LABEL } from "@/lib/crm/order-pay";

/** Zayavka holati CRM tilida (CRM_SPEC 3.3): Yangi / Tasdiqlandi / Yuk xati berildi / Yetkazildi / Bekor qilindi */
function orderStage(status: string, trips: number): string {
  if (status === "CANCELLED") return "Bekor qilindi";
  if (status === "DELIVERED" || status === "CLOSED") return "Yetkazildi";
  if (trips > 0) return "Yuk xati berildi";
  if (status === "CONFIRMED" || status === "IN_PRODUCTION") return "Tasdiqlandi";
  return "Yangi";
}

const bigBtn = "flex min-h-16 flex-col items-center justify-center gap-1 rounded-xl border px-1 text-center text-[12px] font-medium leading-tight transition sm:text-[13px]";

export default async function CrmClientCard({ params }: { params: Promise<{ id: string }> }) {
  const s = await requirePage("/crm/mijozlar");
  const { id } = await params;
  const card = await clientCard(id);
  if (!card) notFound();
  const { c, position, activity, status } = card;
  const tel = telLink(c.phone);
  const tg = telegramLink(c.phone);
  const canEdit = canDo(s, "crm", "client");
  const canOrder = canDo(s, "orders", "create");
  const canContact = canDo(s, "crm", "contact");
  const manager = canDo(s, "crm", "manage");
  const phone = c.phone ? formatPhone(c.phone) : null;
  const pays = await orderPayments([id]);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title={c.name} back={{ href: "/crm/mijozlar", label: T.clients.title }}
        subtitle={[c.source?.label, c.owner?.fullName].filter(Boolean).join(" · ") || undefined}
        action={canEdit ? <LinkButton href={`/crm/mijozlar/${id}/tahrir`} variant="secondary" size="sm"><Pencil size={14} /> {T.card.edit}</LinkButton> : undefined} />
      <div className="-mt-4 mb-4 flex flex-wrap gap-2">
        {c.crmAt ? <Badge color={STATUS_COLOR[status]}>{STATUS_LABEL[status]}</Badge> : <Badge>{T.clients.notCrm}</Badge>}
        <Badge color={ACTIVITY_COLOR[activity]}>{ACTIVITY_LABEL[activity]}</Badge>
      </div>

      {/* 4 ta katta tugma (5.3) */}
      <div className="mb-4 grid grid-cols-4 gap-2">
        {tel ? <a href={tel} className={cn(bigBtn, "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100")}><Phone size={20} />{T.card.call}</a>
          : <span className={cn(bigBtn, "border-slate-200 text-slate-300")}><Phone size={20} />{T.card.call}</span>}
        {tg ? <a href={tg} target="_blank" rel="noopener noreferrer" className={cn(bigBtn, "border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-100")}><Send size={20} />{T.card.telegram}</a>
          : <span className={cn(bigBtn, "border-slate-200 text-slate-300")}><Send size={20} />{T.card.telegram}</span>}
        {canContact ? <Link href={`/crm/mijozlar/${id}/aloqa`} className={cn(bigBtn, "border-slate-900 bg-slate-900 text-white hover:bg-slate-800")}><MessageCircle size={20} />{T.card.writeContact}</Link>
          : <span className={cn(bigBtn, "border-slate-200 text-slate-300")}><MessageCircle size={20} />{T.card.writeContact}</span>}
        {canOrder ? <Link href={`/orders/new?customer=${id}`} className={cn(bigBtn, "border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100")}><ClipboardPlus size={20} />{T.card.order}</Link>
          : <span className={cn(bigBtn, "border-slate-200 text-slate-300")}><ClipboardPlus size={20} />{T.card.order}</span>}
      </div>

      {/* Voronkadagi joyi — 7 bo'lak */}
      <Card className="mb-4">
        <div className="mb-2 flex items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-900">{T.card.funnel}</h2>
          <span className="text-xs text-slate-500 tabular">{position} / 7</span>
        </div>
        <div className="flex gap-1" aria-label={`${T.card.funnel}: ${position} / 7`}>
          {FUNNEL_STAGES.map((st, i) => <div key={st} title={st} className={cn("h-2.5 flex-1 rounded-full", i < position ? "bg-emerald-500" : "bg-slate-200")} />)}
        </div>
        <p className="mt-2 text-[13px] text-slate-600">
          {position > 0 && <span className="font-medium text-slate-900">{FUNNEL_STAGES[position - 1]}</span>}
          {position > 0 && position < 7 && " · "}
          {position < 7 ? `${T.card.next}: ${FUNNEL_STAGES[position]}` : ` — ${T.card.funnelDone}`}
        </p>
      </Card>

      <Card className="mb-4">
        <CardHeader title={T.card.info} />
        <DL items={[
          { k: T.field.phone, v: tel && phone ? <a href={tel} className="font-medium text-slate-900 underline-offset-2 hover:underline">{phone}</a> : "—" },
          { k: T.field.contactPerson, v: c.contactPerson || "—" },
          { k: T.field.region, v: [c.region, c.district].filter(Boolean).join(", ") || "—" },
          { k: T.field.source, v: c.source?.label ?? "—" },
          { k: T.field.owner, v: c.owner?.fullName ?? "—" },
          { k: T.field.nextContact, v: c.nextContactAt ? fullIso(dbToIso(c.nextContactAt)) : "—" },
          { k: T.field.clientType, v: c.clientType?.label ?? "—" },
          { k: T.field.objectType, v: c.objectType || "—" },
          { k: T.field.inn, v: c.inn || "—" },
          { k: T.field.foremanName, v: c.foremanName ? <>{c.foremanName}{c.foremanPhone && <> · <a href={telLink(c.foremanPhone) ?? undefined} className="underline-offset-2 hover:underline">{formatPhone(c.foremanPhone)}</a></>}</> : "—" },
          { k: T.field.link, v: c.link ? <a href={c.link} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 break-all text-blue-700 hover:underline">{c.link.replace(/^https?:\/\//, "").slice(0, 48)} <ExternalLink size={12} /></a> : "—" },
          ...(c.crmNote ? [{ k: T.field.note, v: <span className="whitespace-pre-line">{c.crmNote}</span> }] : []),
        ]} />
        {canDo(s, "customers", "edit") && <Link href={`/customers/${id}`} className="mt-3 inline-flex items-center gap-1 text-[13px] text-slate-500 hover:text-slate-900">{T.card.erpCard} <ExternalLink size={12} /></Link>}
      </Card>

      <Card className="mb-4">
        <CardHeader title={T.card.history} description={c.crmContacts.length ? String(c.crmContacts.length) : undefined} />
        {c.crmContacts.length === 0 ? <EmptyState title={T.card.noHistory} /> : (
          <ol className="relative ml-2 border-l border-slate-200">
            {c.crmContacts.map((x) => (
              <li key={x.id} className={cn("relative pb-4 pl-4 last:pb-0", x.cancelledAt && "opacity-50")}>
                <span aria-hidden className="absolute -left-[5px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-slate-400" />
                <div className="flex flex-wrap items-center gap-2">
                  {x.result ? <Badge color={GROUP_COLOR[x.result.group]}>{x.result.label}</Badge> : <Badge>{T.card.noResult}</Badge>}
                  {x.cancelledAt && <Badge color="red" dot={false}>{T.card.cancelled}</Badge>}
                </div>
                <div className="mt-1 text-[13px] text-slate-500">{[fullIso(dbToIso(x.date)), x.channel?.label, x.user.fullName].filter(Boolean).join(" · ")}</div>
                {(x.product || x.offeredPrice) && <div className="text-[13px] text-slate-600">{[x.product?.label, x.offeredPrice ? money(x.offeredPrice) : null].filter(Boolean).join(" · ")}</div>}
                {x.note && <p className="mt-1 whitespace-pre-line text-sm text-slate-800">{x.note}</p>}
                {x.cancelledAt && x.cancelReason && <p className="mt-1 text-xs text-red-600">{x.cancelReason}{x.cancelledBy ? ` — ${x.cancelledBy.fullName}` : ""}</p>}
                {manager && !x.cancelledAt && <CancelContact id={x.id} />}
              </li>
            ))}
          </ol>
        )}
      </Card>

      <Card>
        <CardHeader title={T.card.orders} description={c.orders.length ? String(c.orders.length) : undefined} />
        {c.orders.length === 0 ? <EmptyState title={T.card.noOrders} /> : (
          <ul className="divide-y divide-slate-100">
            {c.orders.map((o) => (
              <li key={o.id}>
                <Link href={`/orders/${o.id}`} className="flex min-h-14 items-center justify-between gap-3 py-2 hover:bg-slate-50">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-slate-900">№{o.orderNo}{o.crmContactId && <span className="ml-1.5 text-xs font-normal text-emerald-700">· CRM</span>}</div>
                    <div className="text-xs text-slate-500">{date(o.date)} · {orderStage(o.status, o._count.trips)}</div>
                  </div>
                  <div className="flex flex-col items-end gap-1 text-right">
                    <span className="text-sm font-medium tabular text-slate-900">{money(orderTotal(o))}</span>
                    {(() => {
                      const p = pays.get(o.id);
                      if (!p) return <OrderStatusBadge status={o.status} />;
                      return <span className="flex items-center gap-1.5"><Badge color={PAY_COLOR[p.status]}>{PAY_LABEL[p.status]}</Badge>{p.status === "PARTIAL" && <span className="text-xs tabular text-slate-500">{money(p.paid)}</span>}</span>;
                    })()}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
