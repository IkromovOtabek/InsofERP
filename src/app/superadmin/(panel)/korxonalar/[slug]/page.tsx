import { notFound } from "next/navigation";
import { RefreshCw, Play } from "lucide-react";
import { control } from "@/lib/control/db";
import { envPathFor } from "@/lib/control/provision";
import type { TenantStats } from "@/lib/control/stats";
import { EVENT_LABEL } from "@/lib/control/events";
import { ROLE_LABELS } from "@/lib/nav";
import type { Role } from "@/generated/prisma";
import { dateTime, fmtNum, moneyShort } from "@/lib/format";
import { Button, Callout, Card, DL, Empty, PageHeader, StatCard, Table, Td, Th, Tr } from "@/components/ui";
import { TenantStatusBadge, Health, ago } from "../../status";
import { DirectorForm, EditTenantForm, SsoButton, SuspendForm } from "../../forms";
import { refreshStatsAction, resumeTenantAction } from "../../actions";

export const dynamic = "force-dynamic";

export default async function TenantPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ yangi?: string }> }) {
  const { slug } = await params;
  const { yangi } = await searchParams;
  const t = await control.tenant.findUnique({ where: { slug } });
  if (!t) notFound();
  const [history, events] = await Promise.all([
    control.tenantStat.findMany({ where: { tenantId: t.id }, orderBy: { day: "desc" }, take: 30 }),
    control.controlEvent.findMany({ where: { tenantId: t.id }, orderBy: { createdAt: "desc" }, take: 30, include: { admin: { select: { fullName: true } } } }),
  ]);
  const s = t.lastStats as TenantStats | null;

  return (
    <div className="space-y-6">
      <PageHeader
        back={{ href: "/superadmin", label: "Umumiy holat" }}
        title={<>{t.name} <TenantStatusBadge s={t.status} /></>}
        subtitle={`${t.domain ?? "domen ulanmagan"} · baza ${t.dbName} · port ${t.port} · tarif ${t.plan}`}
        action={<div className="flex flex-wrap items-start gap-2"><form action={refreshStatsAction.bind(null, t.slug)}><Button variant="secondary" size="sm"><RefreshCw size={14} /> Tekshirish</Button></form><SsoButton slug={t.slug} disabled={!t.domain || t.status === "ARCHIVED"} /></div>}
      />

      {(yangi || t.status === "PROVISIONING") && (
        <Callout tone={yangi ? "success" : "warning"} title={yangi ? "Korxona yaratildi — endi serverda ishga tushiring" : "Jarayon hali ishga tushirilmagan"}>
          <ol className="ml-4 list-decimal space-y-1">
            <li>Serverda: <code className="rounded bg-white/70 px-1">sudo bash scripts/tenant-up.sh {t.slug}{t.domain ? ` ${t.domain}` : ""}</code> — systemd xizmati, nginx va SSL.</li>
            <li>Kerak bo&apos;lsa korxonaning o&apos;z kalitlarini (ECO, AI, Telegram) <code className="rounded bg-white/70 px-1">{envPathFor(t.slug)}</code> fayliga yozing va qayta ishga tushiring.</li>
            <li>DNS: <code className="rounded bg-white/70 px-1">{t.domain ?? `${t.slug}.<domen>`}</code> → shu server IP.</li>
            <li>Direktorga manzil va login/parolni bering ({t.directorLogin ?? "login berilmagan"}). Jarayon javob bergach holat o&apos;zi «Faol» bo&apos;ladi.</li>
          </ol>
        </Callout>
      )}
      {t.lastError && <Callout tone="danger" title="Oxirgi tekshiruvdagi muammo">{t.lastError}</Callout>}

      {s ? (
        <>
          <div className="flex flex-wrap gap-2 text-sm"><Health up={s.web.up} label={`ERP ${s.web.ms ?? "—"}ms`} /><Health up={s.db.ok} label={`Baza ${s.db.sizeMb ?? "—"} MB`} /><Health up={s.eco.configured ? s.eco.up : null} label={`ECO ${s.eco.ms ?? "—"}ms`} /><span className="text-slate-500">tekshirildi {ago(s.at)} · oxirgi faollik {ago(s.lastActivityAt)}</span></div>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Foydalanuvchilar" value={s.users.active} hint={`24 soatda: ${s.users.active24h} · jami ${s.users.total}`} />
            <StatCard label="Xodimlar / mijozlar" value={`${s.employees} / ${s.customers}`} />
            <StatCard label="Zayavka bugun / oy" value={`${s.orders.today} / ${s.orders.month}`} hint={`qoralama ${s.orders.draft} · bloklangan ${s.orders.blocked}`} />
            <StatCard label="Aylanma / to'lov (oy)" value={moneyShort(s.orders.revenueMonth)} hint={`to'lovlar ${moneyShort(s.payments.month)}`} tone="success" />
            <StatCard label="Reyslar" value={`${s.trips.today} bugun`} hint={`yo'lda: ${s.trips.onRoad}`} />
            <StatCard label="Mobil / ECO" value={`${s.users.mobileDevices} qurilma`} hint={`ECO hisobi bog'langan: ${s.users.ecoLinked}`} />
            <StatCard label="AI / SMS (30 kun)" value={`${fmtNum(s.usage.ai30d)} / ${fmtNum(s.usage.sms30d)}`} hint={`bildirishnoma: ${fmtNum(s.usage.notifications30d)}`} />
            <StatCard label="Amallar (24 soat)" value={fmtNum(s.usage.audit24h)} hint="audit jurnalidagi yozuvlar" />
          </div>
          <Card>
            <div className="mb-2 text-sm font-semibold">Rollar bo&apos;yicha faol foydalanuvchilar</div>
            <div className="flex flex-wrap gap-2 text-sm">{Object.entries(s.users.byRole).map(([r, c]) => <span key={r} className="rounded-md bg-slate-100 px-2 py-0.5">{ROLE_LABELS[r as Role] ?? r}: <b>{c}</b></span>)}</div>
          </Card>
        </>
      ) : <Card><Empty text="Statistika hali olinmagan — «Tekshirish»ni bosing" /></Card>}

      {history.length > 1 && (
        <Card>
          <div className="mb-2 text-sm font-semibold">Oxirgi {history.length} kun</div>
          <Table>
            <thead><tr><Th>Kun</Th><Th right>Faol (24s)</Th><Th right>Zayavka (kun)</Th><Th right>Aylanma (oy)</Th><Th right>Baza</Th><Th>ERP</Th></tr></thead>
            <tbody>{history.map((h) => { const x = h.stats as TenantStats; return (
              <Tr key={h.id}><Td>{h.day.toISOString().slice(0, 10)}</Td><Td right>{x.users.active24h}</Td><Td right>{x.orders.today}</Td><Td right>{moneyShort(x.orders.revenueMonth)}</Td><Td right>{x.db.sizeMb ?? "—"} MB</Td><Td><Health up={x.web.up} label={x.web.up ? "ishladi" : "o'chiq"} /></Td></Tr>
            ); })}</tbody>
          </Table>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <div className="mb-1 font-semibold">Direktor login/paroli</div>
          <p className="mb-3 text-sm text-slate-500">Yangi direktor ochiladi yoki mavjudining paroli almashtiriladi (eski sessiyalari tugaydi). Hozirgi: <b>{t.directorLogin ?? "—"}</b></p>
          <DirectorForm slug={t.slug} login={t.directorLogin} />
        </Card>
        <Card>
          <div className="mb-3 font-semibold">Korxona ma&apos;lumotlari</div>
          <EditTenantForm t={t} />
        </Card>
      </div>

      <Card>
        <div className="mb-1 font-semibold">To&apos;xtatish</div>
        {t.status === "SUSPENDED" ? (
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="text-red-700">To&apos;xtatilgan: {t.suspendedAt ? dateTime(t.suspendedAt) : ""} — {t.suspendReason}</span>
            <form action={resumeTenantAction.bind(null, t.slug)}><Button variant="success" size="sm"><Play size={14} /> Qayta yoqish</Button></form>
          </div>
        ) : (
          <>
            <p className="mb-3 text-sm text-slate-500">Xodimlar veb va mobil ilovaga kira olmaydi, ma&apos;lumot o&apos;chmaydi. IT kirishi (SSO) ishlayveradi.</p>
            <SuspendForm slug={t.slug} />
          </>
        )}
      </Card>

      <Card>
        <div className="mb-3 font-semibold">Texnik</div>
        <DL items={[
          { k: "Ichki manzil", v: <code>{t.internalUrl}</code> },
          { k: "Baza", v: <code>{t.dbName}</code> },
          { k: ".env fayl", v: <code>{envPathFor(t.slug)}</code> },
          { k: "systemd", v: <code>insof-erp@{t.slug}</code> },
          { k: "Yaratilgan", v: dateTime(t.createdAt) },
          { k: "Oxirgi javob", v: t.lastSeenAt ? dateTime(t.lastSeenAt) : "—" },
        ]} />
      </Card>

      <Card>
        <div className="mb-3 font-semibold">Jurnal</div>
        {events.length === 0 ? <Empty text="Yozuv yo'q" /> : (
          <ul className="divide-y divide-slate-100 text-sm">
            {events.map((e) => <li key={e.id} className="flex flex-wrap gap-x-3 py-1.5"><span className="text-slate-500">{dateTime(e.createdAt)}</span><b>{EVENT_LABEL[e.action] ?? e.action}</b><span className="text-slate-500">{e.admin?.fullName ?? "skript"}</span></li>)}
          </ul>
        )}
      </Card>
    </div>
  );
}
