import Link from "next/link";
import { Building2, Users, ClipboardList, Wallet, Server, RefreshCw, Database, Bot, MessageSquare, Smartphone } from "lucide-react";
import { control } from "@/lib/control/db";
import { collectAll, serverStats, type TenantStats } from "@/lib/control/stats";
import { moneyShort, fmtNum } from "@/lib/format";
import { Button, Card, Empty, LinkButton, PageHeader, StatCard, Table, Td, Th, Tr, Callout } from "@/components/ui";
import { TenantStatusBadge, Health, ago } from "./status";
import { SsoButton } from "./forms";
import { refreshStatsAction } from "./actions";

export const dynamic = "force-dynamic";

/** Umumiy holat: barcha korxonalar (ERP + ECO) jonli tekshiruv bilan, platforma bo'yicha yig'indilar. */
export default async function Overview() {
  // Har ochilishda jonli: jarayon/baza/ECO tekshiruvi parallel (bir korxona — ~0.1–4 s)
  const live = await collectAll();
  const [tenants, server] = await Promise.all([
    control.tenant.findMany({ orderBy: [{ status: "asc" }, { name: "asc" }] }),
    serverStats(),
  ]);
  const st = (id: string, last: unknown) => live.get(id) ?? (last as TenantStats | null);
  const all = tenants.map((t) => ({ t, s: st(t.id, t.lastStats) }));
  const sum = (f: (s: TenantStats) => number) => all.reduce((a, x) => a + (x.s ? f(x.s) : 0), 0);
  const down = all.filter((x) => x.t.status === "ACTIVE" && x.s && (!x.s.web.up || !x.s.db.ok));
  const ecoDown = all.filter((x) => x.s?.eco.configured && x.s.eco.up === false);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Platforma holati"
        subtitle={`ERP va ECO — ${tenants.length} ta korxona. Tekshiruv: hozir.`}
        action={<div className="flex gap-2"><form action={refreshStatsAction.bind(null, undefined)}><Button variant="secondary"><RefreshCw size={16} /> Yangilash</Button></form><LinkButton href="/superadmin/korxonalar/yangi">Yangi korxona</LinkButton></div>}
      />

      {down.length > 0 && <Callout tone="danger" title="Ishlamayotgan korxonalar">{down.map((x) => `${x.t.name}: ${!x.s!.web.up ? `veb (${x.s!.web.error ?? "javob yo'q"})` : ""} ${!x.s!.db.ok ? `baza (${x.s!.db.error ?? ""})` : ""}`).join(" · ")}</Callout>}
      {ecoDown.length > 0 && <Callout tone="warning" title="ECO javob bermayapti">{ecoDown.map((x) => `${x.t.name} (${x.t.ecoApiUrl})`).join(" · ")}</Callout>}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Korxonalar" value={tenants.length} hint={`${tenants.filter((t) => t.status === "ACTIVE").length} faol · ${tenants.filter((t) => t.status === "SUSPENDED").length} to'xtatilgan`} icon={Building2} />
        <StatCard label="Faol foydalanuvchi" value={fmtNum(sum((s) => s.users.active))} hint={`24 soatda ishlagan: ${sum((s) => s.users.active24h)}`} icon={Users} tone="info" />
        <StatCard label="Zayavkalar (oy)" value={fmtNum(sum((s) => s.orders.month))} hint={`bugun: ${sum((s) => s.orders.today)}`} icon={ClipboardList} />
        <StatCard label="Aylanma (oy)" value={moneyShort(sum((s) => s.orders.revenueMonth))} hint={`to'lovlar: ${moneyShort(sum((s) => s.payments.month))}`} icon={Wallet} tone="success" />
        <StatCard label="Mobil qurilmalar" value={fmtNum(sum((s) => s.users.mobileDevices))} hint={`ECO bilan bog'langan: ${sum((s) => s.users.ecoLinked)}`} icon={Smartphone} />
        <StatCard label="AI so'rovlar (30 kun)" value={fmtNum(sum((s) => s.usage.ai30d))} icon={Bot} />
        <StatCard label="Bildirishnomalar (30 kun)" value={fmtNum(sum((s) => s.usage.notifications30d))} icon={MessageSquare} />
        <StatCard label="Bazalar hajmi" value={`${fmtNum(sum((s) => s.db.sizeMb ?? 0))} MB`} icon={Database} />
      </div>

      <Card>
        <div className="mb-3 flex items-center gap-2 font-semibold"><Server size={16} /> Server</div>
        <div className="grid gap-2 text-sm text-slate-600 sm:grid-cols-3 lg:grid-cols-6">
          <div>Host: <b>{server.host}</b></div>
          <div>Ishlash: <b>{server.uptimeH} soat</b></div>
          <div>Yuklama: <b>{server.load.join(" / ")}</b> ({server.cpus} CPU)</div>
          <div>Xotira: <b>{server.memFreeGb} / {server.memTotalGb} GB</b> bo&apos;sh</div>
          <div>Disk: <b>{server.disk ? `${server.disk.freeGb} / ${server.disk.totalGb} GB` : "—"}</b> bo&apos;sh</div>
          <div>Node {server.node}{server.commit ? ` · ${server.commit}` : ""}</div>
        </div>
      </Card>

      {tenants.length === 0 ? <Card><Empty text="Hali korxona yo'q — «Yangi korxona» yoki mavjud o'rnatishni `npm run tenant -- register` bilan qo'shing" /></Card> : (
        <Table>
          <thead><tr><Th>Korxona</Th><Th>Holat</Th><Th>Tekshiruv</Th><Th right>Xodim</Th><Th right>Zayavka (bugun/oy)</Th><Th right>Aylanma (oy)</Th><Th right>Baza</Th><Th>Oxirgi faollik</Th><Th /></tr></thead>
          <tbody>
            {all.map(({ t, s }) => (
              <Tr key={t.id}>
                <Td>
                  <Link href={`/superadmin/korxonalar/${t.slug}`} className="hover:underline">{t.name}</Link>
                  <div className="text-xs font-normal text-slate-500">{t.domain ?? `${t.slug} · domen yo'q`} · :{t.port}</div>
                </Td>
                <Td><TenantStatusBadge s={t.status} /></Td>
                <Td><div className="flex flex-wrap gap-1"><Health up={s?.web.up} label={s?.web.ms != null ? `ERP ${s.web.ms}ms` : "ERP"} /><Health up={s?.db.ok} label="Baza" /><Health up={s?.eco.configured ? s.eco.up : null} label="ECO" /></div></Td>
                <Td right>{s ? `${s.users.active} (${s.users.active24h})` : "—"}</Td>
                <Td right>{s ? `${s.orders.today} / ${s.orders.month}` : "—"}</Td>
                <Td right>{s ? moneyShort(s.orders.revenueMonth) : "—"}</Td>
                <Td right>{s?.db.sizeMb != null ? `${s.db.sizeMb} MB` : "—"}</Td>
                <Td className="whitespace-nowrap text-xs">{ago(s?.lastActivityAt)}</Td>
                <Td><SsoButton slug={t.slug} disabled={!t.domain || t.status === "ARCHIVED"} /></Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}
