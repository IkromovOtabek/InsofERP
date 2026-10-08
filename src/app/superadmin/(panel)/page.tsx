import Link from "next/link";
import { Building2, Plus, RefreshCw } from "lucide-react";
import { control } from "@/lib/control/db";
import { collectAll, serverStats, type TenantStats } from "@/lib/control/stats";
import { moneyShort, fmtNum } from "@/lib/format";
import { loadMonitorSnapshot } from "@/lib/control/monitor/snapshot";
import { PageHeader, Section, Tag, Dot, tagFromColor, type Tone } from "../_ui";
import { TENANT_STATUS, ago } from "./status";
import { SsoButton } from "./forms";
import { refreshStatsAction } from "./actions";
import { BoardActions, BoardBanner, BoardChart, BoardIncidents, BoardServices, BoardTiles, type TenantTile } from "./_monitor/board";
import { ProHome, WidgetsHome, type MobileHomeProps } from "./_monitor/mobile-home";
import { getAdmin } from "@/lib/control/auth";
import { DEFAULT_UI_PREFS } from "@/lib/control/ui-prefs";
import { loadUiPrefs } from "@/lib/control/ui-prefs-db";
import { FirstVisitHint, HelpButton, PageHelp, WithHelp } from "./_help/help";

export const dynamic = "force-dynamic";

/**
 * Umumiy holat — «Status Board»: kritik banner, 6 svetofor plitka, xizmatlar, hodisalar, korxona kartalari, grafik, amallar.
 * Korxona tekshiruvi (jarayon/baza/ECO) har ochilishda jonli; monitoring qismi SSE oqimi bilan yangilanadi.
 */
export default async function Overview() {
  // Har ochilishda jonli: jarayon/baza/ECO tekshiruvi parallel (bir korxona — ~0.1–4 s)
  const live = await collectAll();
  const [tenants, server, monitor] = await Promise.all([
    control.tenant.findMany({ orderBy: [{ status: "asc" }, { name: "asc" }] }),
    serverStats(),
    // Monitoring jadvallari hali bo'lmasa ham (migratsiya qilinmagan) bosh sahifa ochilsin
    loadMonitorSnapshot().catch(() => null),
  ]);
  const st = (id: string, last: unknown) => live.get(id) ?? (last as TenantStats | null);
  const all = tenants.map((t) => ({ t, s: st(t.id, t.lastStats) }));
  const sum = (f: (s: TenantStats) => number) => all.reduce((a, x) => a + (x.s ? f(x.s) : 0), 0);
  const active = all.filter((x) => x.t.status === "ACTIVE");
  const down = active.filter((x) => x.s && (!x.s.web.up || !x.s.db.ok));
  const ecoDown = all.filter((x) => x.s?.eco.configured && x.s.eco.up === false);
  const problems = down.map((x) => `${x.t.name}: ${!x.s!.web.up ? `veb (${x.s!.web.error ?? "javob yo'q"})` : ""} ${!x.s!.db.ok ? `baza (${x.s!.db.error ?? ""})` : ""}`.trim());

  const tTone: Tone = active.length === 0 ? "unk" : down.length ? "crit" : ecoDown.length || tenants.some((t) => t.status === "SUSPENDED") ? "warn" : "ok";
  const tenantTile: TenantTile = {
    tone: tTone, up: active.length - down.length, total: active.length,
    sub: down.length ? `${down.map((x) => x.t.name).join(", ")} ishlamayapti`
      : ecoDown.length ? `ECO javob bermayapti: ${ecoDown.map((x) => x.t.name).join(", ")}`
        : active.length === 1 ? `${active[0].t.name} ishlayapti` : active.length ? "Hammasi ishlayapti" : "Hali korxona yo'q",
  };
  const versions = new Map((monitor?.tenants ?? []).map((v) => [v.id, v.version]));
  // Telefon ko'rinishi — admin prefs'i (layout bilan bir xil manba; getAdmin so'rov ichida keshlangan)
  const me = await getAdmin();
  const prefs = me ? await loadUiPrefs(me.id).catch(() => DEFAULT_UI_PREFS) : DEFAULT_UI_PREFS;
  const mobile: MobileHomeProps = {
    initial: monitor, server, hostname: server.host, commit: server.commit,
    tenants: all.filter((x) => x.t.status !== "ARCHIVED").map(({ t, s }) => ({
      id: t.id, slug: t.slug, name: t.name, status: t.status, up: s ? s.web.up : null, ms: s?.web.ms ?? null, users: s ? s.users.active : null, dbOk: s ? s.db.ok : null,
    })),
  };
  const footer = `${server.memTotalGb} GB RAM · ${server.disk ? `${server.disk.totalGb} GB disk · ` : ""}ishlash vaqti ${server.uptimeH} soat · Node ${server.node}${server.commit ? ` · reliz ${server.commit}` : ""}`;

  return (
    <>
    {/* Telefon (≤ 760px): tanlangan ko'rinish; kompyuterda yashirin */}
    <div className="sa-mhome">{prefs.mobileLayout === "pro" ? <ProHome {...mobile} /> : <WidgetsHome {...mobile} />}</div>
    <div className="sa-desk grid gap-(--gap)">
      <PageHeader
        title={<>Platforma holati <PageHelp topic="page:home" /></>}
        subtitle={`ERP va ECO — ${tenants.length} ta korxona · tekshiruv: hozir`}
        action={<>
          <form action={refreshStatsAction.bind(null, undefined)} className="inline-flex items-center gap-0.5"><button className="sa-btn"><RefreshCw size={16} aria-hidden /> Yangilash</button><HelpButton topic="tenant:refresh" /></form>
          <span className="inline-flex items-center gap-0.5"><Link href="/superadmin/korxonalar/yangi" className="sa-btn pri"><Plus size={16} aria-hidden /> Yangi korxona</Link><HelpButton topic="tenant:new-btn" /></span>
        </>}
      />

      <FirstVisitHint />
      <BoardBanner initial={monitor} tenantProblems={problems} />
      <BoardTiles initial={monitor} tenants={tenantTile} server={server} />
      {/* Plitkalar havola — ichiga tugma qo'yib bo'lmaydi, shuning uchun ostida izoh qatori */}
      <div className="sa-sub flex flex-wrap items-center gap-x-4 gap-y-1" aria-label="Plitkalar nimani bildiradi">
        <WithHelp topic="board:tiles">Plitka ranglari</WithHelp>
        <WithHelp topic="board:tenants">Korxonalar</WithHelp>
        <WithHelp topic="board:services">Xizmatlar</WithHelp>
        <WithHelp topic="mon:cpu">CPU</WithHelp>
        <WithHelp topic="mon:ram">RAM</WithHelp>
        <WithHelp topic="mon:disk">Disk</WithHelp>
        <WithHelp topic="board:backup">Zaxira</WithHelp>
      </div>

      <div className="sa-grid2">
        <BoardServices initial={monitor} hostname={server.host} />
        <BoardIncidents initial={monitor} />
      </div>

      <Section id="korxonalar" title={<>Korxonalar <HelpButton topic="tenant:columns" /></>} icon={Building2} sub={`${tenants.length} ta · ${active.length} faol · bazalar ${fmtNum(sum((s) => s.db.sizeMb ?? 0))} MB`}
        more={{ href: "/superadmin/korxonalar/yangi", label: "Yangi korxona →" }}>
        {tenants.length === 0 ? (
          <p className="sa-sub">Hali korxona yo&apos;q — «Yangi korxona» yoki mavjud o&apos;rnatishni <code>npm run tenant -- register</code> bilan qo&apos;shing.</p>
        ) : (
          <div className="sa-tcards">
            {all.map(({ t, s }) => {
              const ver = versions.get(t.id);
              return (
                <article key={t.id} className="sa-card sa-tcard" style={{ background: "var(--soft)", borderColor: s && t.status === "ACTIVE" && (!s.web.up || !s.db.ok) ? "var(--crit)" : undefined }} aria-labelledby={`t-${t.id}`}>
                  <div className="hd">
                    <span className="inline-flex items-center gap-0.5"><Tag tone={tagFromColor(TENANT_STATUS[t.status].color)}>{TENANT_STATUS[t.status].label}</Tag><HelpButton topic="tenant:status" /></span>
                    <span className="sa-sub" data-no-translit>{t.domain ?? `${t.slug} · domen yo'q`} · :{t.port}</span>
                  </div>
                  <Link href={`/superadmin/korxonalar/${t.slug}`} className="nm" id={`t-${t.id}`}>{t.name}</Link>
                  <div className="sa-checks">
                    <Check up={s?.web.up} label={s?.web.ms != null ? `ERP ${s.web.ms} ms` : "ERP"} />
                    <Check up={s?.db.ok} label="Baza" />
                    <Check up={s?.eco.configured ? s.eco.up : null} label="ECO" />
                    <HelpButton topic="tenant:check" />
                  </div>
                  <div className="row">
                    <div className="cell" style={{ background: "var(--card)" }}><b>{s ? fmtNum(s.users.active) : "—"}</b><span>xodim (24 s: {s?.users.active24h ?? "—"})</span></div>
                    <div className="cell" style={{ background: "var(--card)" }}><b>{s ? fmtNum(s.orders.today) : "—"}</b><span>zayavka bugun / oy {s ? fmtNum(s.orders.month) : "—"}</span></div>
                    <div className="cell" style={{ background: "var(--card)" }}><b>{s?.db.sizeMb != null ? fmtNum(s.db.sizeMb) : "—"}</b><span>MB baza</span></div>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="sa-sub">{ver ? <>Versiya <span data-no-translit>{ver}</span> · </> : null}oxirgi faollik {ago(s?.lastActivityAt)}{s ? ` · aylanma ${moneyShort(s.orders.revenueMonth)}` : ""}</span>
                    <SsoButton slug={t.slug} disabled={!t.domain || t.status === "ARCHIVED"} />
                  </div>
                </article>
              );
            })}
          </div>
        )}
        {tenants.length > 0 && (
          <div className="sa-sub" style={{ marginTop: "var(--gap)" }}><WithHelp topic="home:stats">Platforma bo&apos;yicha yig&apos;indilar</WithHelp></div>
          )}
        {tenants.length > 0 && (
          <div className="sa-kpis" style={{ marginTop: 8 }} aria-label="Platforma bo'yicha yig'indilar">
            <div><b>{fmtNum(sum((s) => s.users.active))}</b><span>faol foydalanuvchi · 24 s: {sum((s) => s.users.active24h)}</span></div>
            <div><b>{fmtNum(sum((s) => s.orders.month))}</b><span>zayavka (oy) · bugun {sum((s) => s.orders.today)}</span></div>
            <div><b>{moneyShort(sum((s) => s.orders.revenueMonth))}</b><span>aylanma (oy) · to&apos;lov {moneyShort(sum((s) => s.payments.month))}</span></div>
            <div><b>{fmtNum(sum((s) => s.users.mobileDevices))}</b><span>mobil qurilma · ECO {sum((s) => s.users.ecoLinked)}</span></div>
            <div><b>{fmtNum(sum((s) => s.usage.ai30d))}</b><span>AI so&apos;rov (30 kun)</span></div>
            <div><b>{fmtNum(sum((s) => s.usage.notifications30d))}</b><span>bildirishnoma (30 kun)</span></div>
          </div>
        )}
      </Section>

      <div className="sa-grid2">
        <BoardChart initial={monitor} footer={footer} />
        <BoardActions initial={monitor} />
      </div>
    </div>
    </>
  );
}

function Check({ up, label }: { up: boolean | null | undefined; label: string }) {
  const tone: Tone = up == null ? "unk" : up ? "ok" : "crit";
  return <span className="sa-chk"><Dot tone={tone} />{label}<span className="sa-sr">: {up == null ? "tekshirilmagan" : up ? "ishlayapti" : "nosoz"}</span></span>;
}
