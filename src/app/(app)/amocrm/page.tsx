import Link from "next/link";
import { AlertTriangle, ExternalLink, FilePlus2, Handshake, Inbox, MapPin, Phone, PlugZap } from "lucide-react";
import type { AmoDealState } from "@/generated/prisma";
import { db } from "@/lib/db";
import { requirePage } from "@/lib/page-guard";
import { canDo } from "@/lib/permissions";
import { dateTime, money } from "@/lib/format";
import { formatPhone } from "@/lib/phone";
import { AMO_ID, baseUrl, dealUrl, isReady, oauthRedirectUri, webhookUrl } from "@/lib/amocrm/store";
import { pipelinesSafe } from "@/lib/amocrm/connect";
import { Badge, Callout, Card, CardHeader, DL, EmptyState, LinkButton, PageHeader, StatCard, Table, Tabs, Td, Th, Tr } from "@/components/ui";
import { ConnectForm, DisconnectButton, DismissButton, RestoreButton, StagesForm, SyncNowButton, WebhookButton } from "./forms";

const STATE: Record<AmoDealState, { label: string; color: "amber" | "blue" | "green" | "slate" | "violet" }> = {
  PUSHING: { label: "amoCRM'ga yuborilmoqda", color: "violet" },
  IN_AMO: { label: "Voronkada", color: "blue" },
  READY: { label: "Zayavka kutmoqda", color: "amber" },
  ORDERED: { label: "Zayavka ochildi", color: "green" },
  DISMISSED: { label: "Kerak emas", color: "slate" },
};

const ERRORS: Record<string, string> = {
  ruxsat: "amoCRM'ni ulashga ruxsatingiz yo'q",
  kalit: "Avval client_id va secret kiriting",
  bekor: "amoCRM'da ruxsat berilmadi",
  state: "Ruxsat oynasi muddati o'tdi yoki boshqa oynadan ochildi — qayta urining",
  amo: "amoCRM token bermadi: client_id, secret va «Redirect URI» ni tekshiring",
};

/**
 * amoCRM — savdo voronkasi (lid, taklif, kelishuv) amoCRM'da, zayavka va pul ERP'da (`lib/amocrm/sync.ts`).
 * Bu sahifa: ERP'ga tushgan kelishuvlar (zayavka ochish), sinxron holati va ulanish sozlamasi.
 */
export default async function AmoPage({ searchParams }: { searchParams: Promise<{ tab?: string; xato?: string; ulandi?: string }> }) {
  const s = await requirePage("/amocrm");
  const canWork = canDo(s, "sales", "amocrm");
  const canSettings = canDo(s, "sales", "amocrm_settings");
  const canOrder = canDo(s, "orders", "create");
  const sp = await searchParams;

  const conn = await db.amoConnection.findUnique({ where: { id: AMO_ID } });
  const ready = isReady(conn) ? conn : null;
  const tab = sp.tab ?? (ready ? "kutmoqda" : "sozlamalar");

  const [counts, errors] = await Promise.all([
    db.amoDeal.groupBy({ by: ["state"], _count: true }),
    db.amoDeal.count({ where: { OR: [{ pushError: { not: null }, state: "PUSHING" }, { syncError: { not: null } }] } }),
  ]);
  const count = (st: AmoDealState) => counts.find((c) => c.state === st)?._count ?? 0;

  const filter: Record<string, AmoDealState[]> = { kutmoqda: ["READY"], zayavka: ["ORDERED"], voronka: ["IN_AMO", "PUSHING"], yopilgan: ["DISMISSED"] };
  const deals = filter[tab]
    ? await db.amoDeal.findMany({
        where: { state: { in: filter[tab] } },
        orderBy: tab === "kutmoqda" ? { readyAt: "asc" } : { updatedAt: "desc" },
        take: 200,
        include: { customer: { select: { id: true, name: true } }, orders: { select: { id: true, orderNo: true, status: true }, orderBy: { createdAt: "asc" } }, lead: { select: { id: true, createdAt: true } } },
      })
    : [];

  const tabs = [
    { key: "kutmoqda", label: "Zayavka kutmoqda", href: "/amocrm?tab=kutmoqda", count: count("READY") },
    { key: "zayavka", label: "Zayavka ochilgan", href: "/amocrm?tab=zayavka", count: count("ORDERED") },
    { key: "voronka", label: "Voronkada", href: "/amocrm?tab=voronka", count: count("IN_AMO") + count("PUSHING") },
    { key: "yopilgan", label: "Kerak emas", href: "/amocrm?tab=yopilgan", count: count("DISMISSED") },
    ...(canSettings ? [{ key: "sozlamalar", label: "Sozlamalar", href: "/amocrm?tab=sozlamalar" }] : []),
  ];

  return (
    <div>
      <PageHeader
        title="amoCRM"
        subtitle="Savdo voronkasi amoCRM'da: lid, taklif va kelishuv. Sdelka «ERP'ga» bosqichiga o'tsa shu yerga tushadi — zayavka ochiladi, holati va summasi sdelkaga qaytadi."
        action={ready && canWork ? <SyncNowButton /> : undefined}
      />

      {sp.xato && <div className="mb-4"><Callout tone="danger">{ERRORS[sp.xato] ?? "Ulanmadi"}</Callout></div>}
      {sp.ulandi && <div className="mb-4"><Callout tone="success">amoCRM ulandi. Endi voronka va bosqichlarni tanlang.</Callout></div>}
      {conn?.status === "ERROR" && <div className="mb-4"><Callout tone="danger" title="amoCRM bilan aloqa uzildi">{conn.lastError ?? "Token yaroqsiz"} — {canSettings ? "Sozlamalar tabida qayta ulang." : "direktorga ayting."}</Callout></div>}
      {ready && !ready.stageToErp && <div className="mb-4"><Callout tone="warning">Voronka sozlanmagan: «ERP'ga tushadigan» bosqich tanlanmaguncha kelishuvlar kelmaydi.</Callout></div>}

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Zayavka kutmoqda" value={count("READY")} icon={Inbox} tone={count("READY") ? "warning" : "default"} href="/amocrm?tab=kutmoqda" />
        <StatCard label="Zayavka ochilgan" value={count("ORDERED")} icon={Handshake} href="/amocrm?tab=zayavka" />
        <StatCard label="Voronkada" value={count("IN_AMO") + count("PUSHING")} icon={ExternalLink} href="/amocrm?tab=voronka" />
        <StatCard label="Sinxron xatolari" value={errors} icon={AlertTriangle} tone={errors ? "danger" : "default"} href="/amocrm?tab=voronka" />
      </div>

      <Tabs current={tab} className="mb-6" items={tabs} />

      {tab === "sozlamalar" && canSettings ? (
        <Settings conn={conn} />
      ) : !ready ? (
        <EmptyState icon={PlugZap} title="amoCRM ulanmagan" text={canSettings ? "Sozlamalar tabida hisobni ulang." : "Ulash uchun direktorga murojaat qiling."} />
      ) : deals.length === 0 ? (
        <EmptyState icon={Inbox} title="Kelishuv yo'q" text={tab === "kutmoqda" ? "amoCRM'da sdelka «ERP'ga» bosqichiga o'tkazilsa, shu yerda paydo bo'ladi." : "Bu ro'yxat bo'sh."} />
      ) : (
        <Card padded={false}>
          <Table>
            <thead>
              <tr><Th>Sdelka</Th><Th>Mijoz</Th><Th>Aloqa</Th><Th right>Byudjet</Th><Th>Holat</Th><Th /></tr>
            </thead>
            <tbody>
              {deals.map((d) => (
                <Tr key={d.id}>
                  <Td>
                    <div className="font-medium">{d.name}</div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                      {d.amoLeadId && ready ? <a href={dealUrl(ready.domain, d.amoLeadId)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:underline">#{d.amoLeadId} <ExternalLink size={12} /></a> : null}
                      {d.lead ? <span>sayt arizasi</span> : null}
                      {d.responsible ? <span>{d.responsible}</span> : null}
                      <span>{dateTime(d.readyAt ?? d.createdAt)}</span>
                    </div>
                    {d.address && <div className="mt-1 inline-flex items-start gap-1 text-xs text-slate-600"><MapPin size={12} className="mt-0.5 shrink-0" />{d.address}</div>}
                  </Td>
                  <Td>
                    {d.customer ? <Link href={`/customers/${d.customer.id}`} className="font-medium hover:underline">{d.customer.name}</Link> : <span className="text-slate-400">—</span>}
                    {d.inn && <div className="text-xs text-slate-500">INN {d.inn}</div>}
                  </Td>
                  <Td>
                    {d.contactName && <div>{d.contactName}</div>}
                    {d.phone && <a href={`tel:${d.phone}`} className="inline-flex items-center gap-1 text-sm text-slate-700 hover:underline"><Phone size={12} />{formatPhone(d.phone)}</a>}
                  </Td>
                  <Td right>{d.price != null ? money(d.price) : "—"}</Td>
                  <Td>
                    <Badge color={STATE[d.state].color}>{STATE[d.state].label}</Badge>
                    {d.orders.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1.5 text-xs">
                        {d.orders.map((o) => <Link key={o.id} href={`/orders/${o.id}`} className="font-mono hover:underline">{o.orderNo}</Link>)}
                      </div>
                    )}
                    {(d.state === "PUSHING" ? d.pushError : d.syncError) && <div className="mt-1 max-w-64 text-xs text-red-600">{d.state === "PUSHING" ? d.pushError : d.syncError}</div>}
                  </Td>
                  <Td right>
                    {canWork && (
                      <div className="flex flex-wrap justify-end gap-2">
                        {canOrder && d.customerId && (d.state === "READY" || d.state === "ORDERED") && (
                          <LinkButton href={`/orders/new?amo=${d.id}`} size="sm" variant={d.state === "READY" ? "primary" : "secondary"}><FilePlus2 size={14} /> {d.state === "READY" ? "Zayavka ochish" : "Yana zayavka"}</LinkButton>
                        )}
                        {(d.state === "READY" || d.state === "IN_AMO") && <DismissButton id={d.id} />}
                        {d.state === "DISMISSED" && d.amoLeadId && <RestoreButton id={d.id} />}
                      </div>
                    )}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
    </div>
  );
}

async function Settings({ conn }: { conn: Awaited<ReturnType<typeof db.amoConnection.findUnique>> }) {
  const ready = isReady(conn) ? conn : null;
  const pipes = ready ? await pipelinesSafe(ready) : { list: [] };
  return (
    <div className="grid gap-5 xl:grid-cols-2">
      <Card>
        <CardHeader title={ready ? "Ulanish" : "amoCRM'ni ulash"} icon={PlugZap} description={ready ? undefined : "amoCRM'da (admin) Sozlamalar → Integratsiyalar → «Integratsiya yaratish» → shaxsiy integratsiya. Undan token yoki client_id/secret olinadi."} />
        {ready ? (
          <div className="space-y-4">
            <DL items={[
              { k: "Hisob", v: <a href={baseUrl(ready.domain)} target="_blank" rel="noreferrer" className="hover:underline">{ready.accountName ?? ready.domain}</a> },
              { k: "Manzil", v: ready.domain },
              { k: "Usul", v: ready.method === "OAUTH" ? "OAuth (token o'zi yangilanadi)" : "Uzoq muddatli token" },
              { k: "Holat", v: ready.status === "ERROR" ? <Badge color="red">Xato</Badge> : <Badge color="green">Ishlayapti</Badge> },
              { k: "Webhook", v: ready.webhookOk ? <Badge color="green">O&apos;rnatilgan</Badge> : <Badge color="amber">Yo&apos;q — 5 daqiqada tekshiriladi</Badge> },
              { k: "Webhook manzili", v: <span className="break-all font-mono text-xs">{webhookUrl(ready.webhookKey)}</span> },
              { k: "Ulagan", v: `${ready.connectedByName ?? "—"} · ${dateTime(ready.updatedAt)}` },
              { k: "Oxirgi tekshiruv", v: ready.lastPullAt ? dateTime(ready.lastPullAt) : "—" },
            ]} />
            <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-4">
              <WebhookButton />
              <DisconnectButton />
            </div>
            <details className="text-sm">
              <summary className="cursor-pointer text-slate-600">Boshqa token bilan qayta ulash</summary>
              <div className="mt-3"><ConnectForm domain={ready.domain} redirectUri={oauthRedirectUri()} /></div>
            </details>
          </div>
        ) : (
          <ConnectForm domain={conn?.domain ?? ""} redirectUri={oauthRedirectUri()} />
        )}
      </Card>

      {ready && (
        <Card>
          <CardHeader title="Voronka va bosqichlar" description="Qaysi bosqichda sdelka ERP'ga tushadi va zayavka holati sdelkani qaysi bosqichga o'tkazadi." />
          {pipes.error ? (
            <Callout tone="danger">Voronkalar olinmadi: {pipes.error}</Callout>
          ) : pipes.list.length === 0 ? (
            <Callout tone="warning">amoCRM hisobida voronka topilmadi</Callout>
          ) : (
            <StagesForm
              pipelines={pipes.list.map((p) => ({ id: p.id, name: p.name, statuses: p._embedded.statuses.map((x) => ({ id: x.id, name: x.name })) }))}
              values={{
                pipelineId: ready.pipelineId, stageNewLead: ready.stageNewLead, stageToErp: ready.stageToErp, stageConfirmed: ready.stageConfirmed,
                stageDelivered: ready.stageDelivered, stageClosed: ready.stageClosed, stageCancelled: ready.stageCancelled, pushLeads: ready.pushLeads,
              }}
            />
          )}
        </Card>
      )}
    </div>
  );
}
