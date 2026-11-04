import { requireAdmin } from "@/lib/control/auth";
import { roleAllows } from "@/lib/control/roles";
import { notFound } from "next/navigation";
import { CreditCard, Footprints, LayoutDashboard, Play, RefreshCw, Settings } from "lucide-react";
import { control } from "@/lib/control/db";
import { envPathFor } from "@/lib/control/provision";
import type { TenantStats } from "@/lib/control/stats";
import { EVENT_LABEL } from "@/lib/control/events";
import { ROLE_LABELS } from "@/lib/nav";
import type { Role } from "@/generated/prisma";
import { date, dateTime, fmtNum, money, moneyShort } from "@/lib/format";
import { Badge, Button, Callout, Card, DL, Empty, StatCard, Table, Tabs, Td, Th, Tr } from "@/components/ui";
import { PageHeader } from "../../../_ui";
import { TenantStatusBadge, Health, ago } from "../../status";
import { DirectorForm, EditTenantForm, SsoButton, SuspendForm } from "../../forms";
import { refreshStatsAction, resumeTenantAction } from "../../actions";
import { TenantUpPanel } from "../../_infra/tenant-up";
import { HelpButton, PageHelp, WithHelp } from "../../_help/help";
import { billingState, isoOf, PAYMENT_METHODS, paymentPeriod, PLAN_LABEL, STAGE_LABEL, todayIso } from "@/lib/control/billing";
import { BillingSettingsForm, CancelPaymentButton, PaymentForm, TariffForm } from "./billing";
import { MODULES } from "@/lib/nav";
import { PLATFORM_MODULES } from "@/lib/platform-modules";
import { visitFilter } from "@/lib/control/visits";
import { TenantVisitsTab } from "./visits";

export const dynamic = "force-dynamic";

/** Korxona sahifasi tablari (`?tab=`): holat va statistika, tashriflar, obuna va modullar, boshqaruv. */
const TABS = [
  { key: "umumiy", label: "Umumiy", icon: LayoutDashboard },
  { key: "tashriflar", label: "Tashriflar", icon: Footprints },
  { key: "obuna", label: "Obuna va modullar", icon: CreditCard },
  { key: "sozlamalar", label: "Sozlamalar", icon: Settings },
] as const;
type TabKey = (typeof TABS)[number]["key"];

type Query = { yangi?: string; tab?: string; kun?: string; u?: string; qurilma?: string; tur?: string; it?: string; bet?: string };

export default async function TenantPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Query> }) {
  const me = await requireAdmin(); // layout ham tekshiradi; sahifa o'zi ham himoyalangan bo'lsin (layout'siz render/qayta foydalanish)
  // Direktor paroli, ma'lumotni tahrirlash, to'xtatish — faqat «Egasi» (server action ham tekshiradi)
  const owner = roleAllows(me.role, "OWNER");
  const { slug } = await params;
  const query = await searchParams;
  const { yangi } = query;
  const tab: TabKey = TABS.some((x) => x.key === query.tab) ? (query.tab as TabKey) : "umumiy";
  const t = await control.tenant.findUnique({ where: { slug } });
  if (!t) notFound();
  // Har tab faqat o'ziga keraklisini o'qiydi
  const [history, events, payments] = await Promise.all([
    tab === "umumiy" ? control.tenantStat.findMany({ where: { tenantId: t.id }, orderBy: { day: "desc" }, take: 30 }) : [],
    tab === "sozlamalar" ? control.controlEvent.findMany({ where: { tenantId: t.id }, orderBy: { createdAt: "desc" }, take: 30, include: { admin: { select: { fullName: true } } } }) : [],
    tab === "obuna" ? control.tenantPayment.findMany({ where: { tenantId: t.id }, orderBy: { createdAt: "desc" }, take: 24 }) : [],
  ]);
  // Obuna: holat, keyingi to'lov qaysi davrni qoplashi (forma izohi uchun), storno qilinadigan oxirgi to'lov
  const today = todayIso();
  const bill = billingState(t, today);
  const fee = t.monthlyFee ? Number(t.monthlyFee) : null;
  const preview = Object.fromEntries([1, 3, 6, 12].map((m) => { const p = paymentPeriod(t, m, today); return [m, `${p.from} — ${p.to}`]; }));
  const lastActive = payments.find((p) => !p.cancelledAt);
  const iso = (d: Date | null) => (d ? isoOf(d) : "—");
  const s = t.lastStats as TenantStats | null;
  const href = (k: TabKey) => (k === "umumiy" ? `/superadmin/korxonalar/${t.slug}` : `/superadmin/korxonalar/${t.slug}?tab=${k}`);

  return (
    <div className="space-y-6">
      <PageHeader
        back={{ href: "/superadmin", label: "Umumiy holat" }}
        title={<>{t.name} <TenantStatusBadge s={t.status} /><HelpButton topic="tenant:status" /> <PageHelp topic="page:korxona" /></>}
        subtitle={<span className="inline-flex flex-wrap items-center gap-x-1">{t.domain ?? "domen ulanmagan"} <HelpButton topic="form:domain" /> · <WithHelp topic="tenant:db">baza {t.dbName}</WithHelp> · <WithHelp topic="tenant:port">port {t.port}</WithHelp> · tarif {t.plan}</span>}
        action={<div className="flex flex-wrap items-start gap-2"><form action={refreshStatsAction.bind(null, t.slug)} className="inline-flex items-center gap-0.5"><Button variant="secondary" size="sm"><RefreshCw size={14} /> Tekshirish</Button><HelpButton topic="tenant:refresh" /></form><SsoButton slug={t.slug} disabled={!t.domain || t.status === "ARCHIVED"} /></div>}
      />

      {(yangi || t.status === "PROVISIONING") && (
        <Callout tone={yangi ? "success" : "warning"} title={yangi ? "Korxona yaratildi — endi serverda ishga tushiring" : "Jarayon hali ishga tushirilmagan"}>
          <ol className="ml-4 list-decimal space-y-1">
            <li>Serverda ishga tushiring — systemd xizmati, /api/health, nginx va SSL (natija shu yerda ko&apos;rinadi; qo&apos;lda: <code className="rounded bg-white/70 px-1">sudo insof-tenant-up {t.slug}{t.domain ? ` ${t.domain}` : ""}</code>):
              {t.status === "PROVISIONING" && <div className="my-2"><TenantUpPanel slug={t.slug} domain={t.domain} /></div>}
            </li>
            <li>Kerak bo&apos;lsa korxonaning o&apos;z kalitlarini (ECO, AI, Telegram) <code className="rounded bg-white/70 px-1">{envPathFor(t.slug)}</code> fayliga yozing va qayta ishga tushiring.</li>
            <li>DNS: <code className="rounded bg-white/70 px-1">{t.domain ?? `${t.slug}.<domen>`}</code> → shu server IP.</li>
            <li>Direktorga manzil va login/parolni bering ({t.directorLogin ?? "login berilmagan"}). Jarayon javob bergach holat o&apos;zi «Faol» bo&apos;ladi.</li>
          </ol>
        </Callout>
      )}
      {t.lastError && <Callout tone="danger" title="Oxirgi tekshiruvdagi muammo">{t.lastError}</Callout>}

      <Tabs current={tab} className="mb-0" items={TABS.map((x) => ({
        key: x.key, label: x.label, icon: x.icon, href: href(x.key),
        count: x.key === "tashriflar" && s?.visits ? s.visits.usersToday : undefined,
      }))} />

      {tab === "tashriflar" && <TenantVisitsTab slug={t.slug} dbName={t.dbName} f={visitFilter(query)} />}

      {tab === "umumiy" && (s ? (
        <>
          <div className="flex flex-wrap items-center gap-2 text-sm"><HelpButton topic="tenant:check" /><Health up={s.web.up} label={`ERP ${s.web.ms ?? "—"}ms`} /><Health up={s.db.ok} label={`Baza ${s.db.sizeMb ?? "—"} MB`} /><Health up={s.eco.configured ? s.eco.up : null} label={`ECO ${s.eco.ms ?? "—"}ms`} /><span className="text-slate-500">tekshirildi {ago(s.at)} · oxirgi faollik {ago(s.lastActivityAt)}</span></div>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Foydalanuvchilar" value={s.users.active} hint={`24 soatda: ${s.users.active24h} · jami ${s.users.total}`} href="#rollar" />
            <StatCard label="Bugun kirgan" value={s.visits ? s.visits.usersToday : "—"} hint={s.visits ? `sahifa: ${fmtNum(s.visits.viewsToday)} · kirish: ${s.visits.loginsToday}` : "tashriflar jurnali hali yo'q"} href={href("tashriflar")} />
            <StatCard label="Xodimlar / mijozlar" value={`${s.employees} / ${s.customers}`} />
            <StatCard label="Zayavka bugun / oy" value={`${s.orders.today} / ${s.orders.month}`} hint={`qoralama ${s.orders.draft} · bloklangan ${s.orders.blocked}`} href={history.length > 1 ? "#tarix" : undefined} />
            <StatCard label="Aylanma / to'lov (oy)" value={moneyShort(s.orders.revenueMonth)} hint={`to'lovlar ${moneyShort(s.payments.month)}`} tone="success" href={history.length > 1 ? "#tarix" : undefined} />
            <StatCard label="Reyslar" value={`${s.trips.today} bugun`} hint={`yo'lda: ${s.trips.onRoad}`} />
            <StatCard label="Mobil / ECO" value={`${s.users.mobileDevices} qurilma`} hint={`ECO hisobi bog'langan: ${s.users.ecoLinked}`} />
            <StatCard label="AI so'rovlar (30 kun)" value={fmtNum(s.usage.ai30d)} hint={`bildirishnoma: ${fmtNum(s.usage.notifications30d)}`} />
            <StatCard label="Amallar (24 soat)" value={fmtNum(s.usage.audit24h)} hint="audit jurnalidagi yozuvlar" />
          </div>
          <Card>
            <div id="rollar" className="mb-2 scroll-mt-20 text-sm font-semibold">Rollar bo&apos;yicha faol foydalanuvchilar</div>
            <div className="flex flex-wrap gap-2 text-sm">{Object.entries(s.users.byRole).map(([r, c]) => <span key={r} className="rounded-md bg-slate-100 px-2 py-0.5">{ROLE_LABELS[r as Role] ?? r}: <b>{c}</b></span>)}</div>
          </Card>
        </>
      ) : <Card><Empty text="Statistika hali olinmagan — «Tekshirish»ni bosing" /></Card>)}

      {tab === "umumiy" && history.length > 1 && (
        <Card>
          <div id="tarix" className="mb-2 scroll-mt-20 text-sm font-semibold">Oxirgi {history.length} kun</div>
          <Table>
            <thead><tr><Th>Kun</Th><Th right>Faol (24s)</Th><Th right>Kirgan (kun)</Th><Th right>Zayavka (kun)</Th><Th right>Aylanma (oy)</Th><Th right>Baza</Th><Th>ERP</Th></tr></thead>
            <tbody>{history.map((h) => { const x = h.stats as TenantStats; return (
              <Tr key={h.id}><Td>{h.day.toISOString().slice(0, 10)}</Td><Td right>{x.users.active24h}</Td><Td right>{x.visits?.usersToday ?? "—"}</Td><Td right>{x.orders.today}</Td><Td right>{moneyShort(x.orders.revenueMonth)}</Td><Td right>{x.db.sizeMb ?? "—"} MB</Td><Td><Health up={x.web.up} label={x.web.up ? "ishladi" : "o'chiq"} /></Td></Tr>
            ); })}</tbody>
          </Table>
        </Card>
      )}

      {tab === "obuna" && <Card>
        <div id="obuna" className="mb-3 flex scroll-mt-20 flex-wrap items-center gap-2 font-semibold">
          Obuna <Badge color={STAGE_LABEL[bill.stage].color}>{STAGE_LABEL[bill.stage].label}</Badge>
          {t.suspendKind === "billing" && <Badge color="red" dot={false}>to&apos;lov uchun to&apos;xtatilgan</Badge>}
          <HelpButton topic="tenant:billing" />
        </div>
        <DL items={[
          { k: "Tarif", v: PLAN_LABEL[t.plan] ?? t.plan },
          { k: "Oylik to'lov", v: fee ? money(fee) : "belgilanmagan" },
          { k: "To'langan muddat", v: bill.paidUntil
            ? <>{bill.paidUntil}{bill.daysLeft !== null && <span className="text-slate-500"> · {bill.daysLeft >= 0 ? `${bill.daysLeft} kun qoldi` : `${-bill.daysLeft} kun o'tdi`}</span>}</>
            : "muddatsiz (avtomat to'xtatmaydi)" },
          { k: "Imtiyoz", v: `${t.graceDays} kun${bill.suspendOn ? ` · to'lanmasa ${bill.suspendOn} dan to'xtatiladi` : ""}` },
        ]} />
        {owner && (
          <>
            <div className="mb-2 mt-5 border-t border-slate-100 pt-4 text-sm font-medium text-slate-700">To&apos;lov qo&apos;shish</div>
            <PaymentForm slug={t.slug} monthlyFee={fee} today={today} preview={preview} />
            <details className="mt-4 border-t border-slate-100 pt-3">
              <summary className="cursor-pointer text-sm font-medium text-slate-700">Narx, imtiyoz va muddatni sozlash</summary>
              <div className="mt-3"><BillingSettingsForm slug={t.slug} monthlyFee={t.monthlyFee?.toString() ?? ""} graceDays={t.graceDays} paidUntil={bill.paidUntil ?? ""} /></div>
            </details>
          </>
        )}
        <div className="mb-2 mt-5 border-t border-slate-100 pt-4 text-sm font-medium text-slate-700">To&apos;lovlar tarixi</div>
        {payments.length === 0 ? <Empty text="Hali to'lov yozilmagan" /> : (
          <Table>
            <thead><tr><Th>Sana</Th><Th right>Summa</Th><Th>Davr</Th><Th>Usul</Th><Th>Izoh</Th><Th /></tr></thead>
            <tbody>{payments.map((p) => (
              <Tr key={p.id}>
                <Td>{iso(p.paidAt)}</Td>
                <Td right>{p.cancelledAt ? <s className="text-slate-400">{money(Number(p.amount))}</s> : money(Number(p.amount))}</Td>
                <Td>{iso(p.periodFrom)} — {iso(p.periodTo)} <span className="text-slate-500">({p.months} oy)</span></Td>
                <Td>{PAYMENT_METHODS[p.method] ?? p.method}</Td>
                <Td>{p.cancelledAt ? <span className="text-red-700">Storno {date(p.cancelledAt)}: {p.cancelReason}</span> : p.note ?? ""}</Td>
                <Td>{p.id === lastActive?.id && <CancelPaymentButton slug={t.slug} id={p.id} />}</Td>
              </Tr>
            ))}</tbody>
          </Table>
        )}
      </Card>}

      {tab === "obuna" && <Card>
        <div id="tarif" className="mb-3 flex scroll-mt-20 flex-wrap items-center gap-2 font-semibold">
          Modullar va limit
          {t.modulesOff.length > 0 && <Badge color="amber" dot={false}>{t.modulesOff.length} ta modul o&apos;chiq</Badge>}
          {t.userLimit && <Badge color={s && s.users.active >= t.userLimit ? "red" : "slate"} dot={false}>foydalanuvchi: {s ? s.users.active : "—"} / {t.userLimit}</Badge>}
          <HelpButton topic="tenant:tariff" />
        </div>
        {owner ? (
          <TariffForm slug={t.slug} userLimit={t.userLimit} activeUsers={s ? s.users.active : null}
            modules={PLATFORM_MODULES.map((k) => ({ key: k, label: MODULES.find((m) => m.key === k)?.label ?? k, on: !t.modulesOff.includes(k) }))} />
        ) : (
          <p className="text-sm text-slate-600">
            {t.modulesOff.length ? <>O&apos;chiq: {t.modulesOff.map((k) => MODULES.find((m) => m.key === k)?.label ?? k).join(", ")}.</> : "Barcha qo'shimcha modullar yoqiq."}
            {" "}Foydalanuvchi chegarasi: {t.userLimit ?? "cheklovsiz"}.
          </p>
        )}
      </Card>}

      {tab === "sozlamalar" && owner && <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <div className="mb-1 flex items-center gap-1 font-semibold">Direktor login/paroli <HelpButton topic="tenant:director" /></div>
          <p className="mb-3 text-sm text-slate-500">Yangi direktor ochiladi yoki mavjudining paroli almashtiriladi (eski sessiyalari tugaydi). Hozirgi: <b>{t.directorLogin ?? "—"}</b></p>
          <DirectorForm slug={t.slug} login={t.directorLogin} />
        </Card>
        <Card>
          <div className="mb-3 flex items-center gap-1 font-semibold">Korxona ma&apos;lumotlari <HelpButton topic="tenant:edit" /></div>
          {/* Faqat oddiy maydonlar — Decimal/Date klient komponentga o'tmaydi */}
          <EditTenantForm t={{ slug: t.slug, name: t.name, domain: t.domain, plan: t.plan, contactName: t.contactName, contactPhone: t.contactPhone, note: t.note, ecoApiUrl: t.ecoApiUrl }} />
        </Card>
      </div>}

      {tab === "sozlamalar" && owner && <Card>
        <div className="mb-1 flex items-center gap-1 font-semibold">To&apos;xtatish <HelpButton topic="tenant:suspend" /></div>
        {t.status === "SUSPENDED" ? (
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="text-red-700">To&apos;xtatilgan: {t.suspendedAt ? dateTime(t.suspendedAt) : ""} — {t.suspendReason}</span>
            <form action={resumeTenantAction.bind(null, t.slug)} className="inline-flex items-center gap-0.5"><Button variant="success" size="sm"><Play size={14} /> Qayta yoqish</Button><HelpButton topic="tenant:resume" /></form>
          </div>
        ) : (
          <>
            <p className="mb-3 text-sm text-slate-500">Xodimlar veb va mobil ilovaga kira olmaydi, ma&apos;lumot o&apos;chmaydi. IT kirishi (SSO) ishlayveradi.</p>
            <SuspendForm slug={t.slug} />
          </>
        )}
      </Card>}

      {tab === "sozlamalar" && <Card>
        <div className="mb-3 flex items-center gap-1 font-semibold">Texnik <HelpButton topic="tenant:tech" /></div>
        <DL items={[
          { k: "Ichki manzil", v: <code>{t.internalUrl}</code> },
          { k: "Baza", v: <code>{t.dbName}</code> },
          { k: ".env fayl", v: <code>{envPathFor(t.slug)}</code> },
          { k: "systemd", v: <code>insof-erp@{t.slug}</code> },
          { k: "Yaratilgan", v: dateTime(t.createdAt) },
          { k: "Oxirgi javob", v: t.lastSeenAt ? dateTime(t.lastSeenAt) : "—" },
        ]} />
        {t.status === "ACTIVE" && <div className="mt-3 border-t border-slate-100 pt-3"><TenantUpPanel slug={t.slug} domain={t.domain} compact /></div>}
      </Card>}

      {tab === "sozlamalar" && <Card>
        <div className="mb-3 flex items-center gap-1 font-semibold">Jurnal <HelpButton topic="tenant:journal" /></div>
        {events.length === 0 ? <Empty text="Yozuv yo'q" /> : (
          <ul className="divide-y divide-slate-100 text-sm">
            {events.map((e) => <li key={e.id} className="flex flex-wrap gap-x-3 py-1.5"><span className="text-slate-500">{dateTime(e.createdAt)}</span><b>{EVENT_LABEL[e.action] ?? e.action}</b><span className="text-slate-500">{e.admin?.fullName ?? "skript"}</span></li>)}
          </ul>
        )}
      </Card>}
    </div>
  );
}
