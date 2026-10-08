"use client";

import Link from "next/link";
import { Activity, Cpu, Database, HardDrive, MemoryStick, Network, Server, ShieldCheck, Siren, Timer } from "lucide-react";
import { Badge, Card, CardHeader, EmptyState, Table, Td, Th, Tr } from "@/components/ui";
import { PageHeader } from "../../_ui";
import {
  backupAgeHours, bps, bytes, duration, restartableUnit, sslDaysLeft, tenantCheckKeys,
  type CheckView, type MonitorSnapshot,
} from "@/lib/control/monitor/shared";
import { ConnBadge, useLiveMonitor } from "../_monitor/live";
import { Sparkline } from "../_monitor/sparkline";
import { ActionButton } from "../_monitor/action-dialog";
import { Ago, AgentBadge, AgentHint, CheckBadge, SeverityBadge, StatusIcon } from "../_monitor/bits";
import { TENANT_STATUS } from "../status";

const pct = (v: number) => `${Math.round(v)}%`;
const toneOf = (v: number, warn: number, crit: number) => (v >= crit ? "danger" : v >= warn ? "warning" : "default") as "danger" | "warning" | "default";
const NOT_SERVICE = new Set(["ssl", "backup", "security", "agent"]);

export function MonitoringView({ initial, loadError }: { initial: MonitorSnapshot | null; loadError?: string }) {
  const { data } = useLiveMonitor(initial);
  const s = data;
  const checks = s?.checks ?? [];
  const byKey = new Map(checks.map((c) => [c.key, c]));
  const services = checks.filter((c) => !NOT_SERVICE.has(c.kind) && !c.key.startsWith("http:tenant:") && !c.key.startsWith("db:tenant:") && !c.key.startsWith("host:"));
  const ssl = checks.filter((c) => c.kind === "ssl");
  const backup = checks.filter((c) => c.kind === "backup");
  const hostChecks = checks.filter((c) => c.key.startsWith("host:"));

  return (
    <div className="space-y-6">
      <PageHeader
        title={<>Server va xizmatlar <ConnBadge /></>}
        subtitle={<span className="inline-flex flex-wrap items-center gap-2">Har 3 soniyada yangilanadi. <AgentBadge agent={s?.agent ?? null} /></span>}
        action={
          <div className="flex flex-wrap gap-2">
            <ActionButton type="RUN_HEALTH_CHECK" label="Hozir tekshirish" icon="refresh" />
            <ActionButton type="RUN_BACKUP" label="Zaxira olish" icon="archive" />
            <ActionButton type="RELOAD_NGINX" label="Nginx reload" icon="restart" />
            <ActionButton type="RENEW_CERT" label="SSL yangilash" icon="lock" />
          </div>
        }
      />
      {loadError && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">Monitoring jadvallari o&apos;qilmadi: <code>{loadError}</code>. Control baza migratsiyasini tekshiring (<code>prisma migrate deploy --schema prisma/control/schema.prisma</code>).</div>}
      <AgentHint agent={s?.agent ?? null} />

      {/* ── Server ── */}
      {s?.host ? <HostCards s={s} hostChecks={hostChecks} /> : (
        <EmptyState icon={Server} title="Server ko'rsatkichlari hali yo'q" text="insof-agent o'rnatilmagan yoki hali birinchi suratni yozmagan — PLATFORMA.md → Monitoring agenti." />
      )}

      {/* ── Xizmatlar ── */}
      <section aria-labelledby="svc-h">
        <h2 id="svc-h" className="mb-3 flex items-center gap-2 text-base font-semibold text-slate-900"><Activity size={16} aria-hidden /> Xizmatlar</h2>
        {services.length === 0 ? <EmptyState icon={Activity} title="Tekshiruv natijalari yo'q" text="Agent ishga tushgach systemd xizmatlari, nginx, Postgres va ECO holati shu yerda chiqadi." /> : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {services.map((c) => <ServiceCard key={c.key} c={c} />)}
          </div>
        )}
      </section>

      {/* ── Korxonalar ── */}
      <Card padded={false}>
        <div className="p-5 pb-0"><CardHeader title="Korxonalar" description="Har korxona: veb jarayon, baza, systemd xizmati, versiya va oxirgi xato." icon={Server} /></div>
        {(s?.tenants.length ?? 0) === 0 ? <div className="p-5 pt-0 text-sm text-slate-500">Korxona yo&apos;q.</div> : (
          <Table className="rounded-none border-0 border-t shadow-none">
            <thead><tr><Th>Korxona</Th><Th>Holat</Th><Th>Veb</Th><Th>Baza</Th><Th>Xizmat</Th><Th>Versiya</Th><Th>Oxirgi xato</Th></tr></thead>
            <tbody>
              {s!.tenants.map((t) => {
                const k = tenantCheckKeys(t.slug);
                const web = byKey.get(k.web), db = byKey.get(k.db), unit = byKey.get(k.unit);
                const err = [web, db, unit].find((c) => c && c.status !== "OK" && c.message)?.message ?? t.lastError;
                return (
                  <Tr key={t.id}>
                    <Td><Link href={`/superadmin/korxonalar/${t.slug}`} className="hover:underline">{t.name}</Link><div className="text-xs font-normal text-slate-500" data-no-translit>{t.slug}</div></Td>
                    <Td><Badge color={TENANT_STATUS[t.status as keyof typeof TENANT_STATUS]?.color ?? "slate"}>{TENANT_STATUS[t.status as keyof typeof TENANT_STATUS]?.label ?? t.status}</Badge></Td>
                    <Td><CellCheck c={web} /></Td>
                    <Td><CellCheck c={db} /></Td>
                    <Td><CellCheck c={unit} /></Td>
                    <Td><span className="font-mono text-xs" data-no-translit>{t.version ?? "—"}</span></Td>
                    <Td className="max-w-xs text-xs text-red-700 [overflow-wrap:anywhere]">{err ?? <span className="text-slate-400">—</span>}</Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>

      {/* ── SSL va zaxira ── */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="SSL sertifikatlari" icon={ShieldCheck} action={<ActionButton type="RENEW_CERT" label="Yangilash" icon="lock" />} />
          {ssl.length === 0 ? <p className="text-sm text-slate-500">Ma&apos;lumot yo&apos;q — agent domenlar sertifikatini tekshirgach chiqadi.</p> : (
            <ul className="divide-y divide-slate-100">
              {ssl.map((c) => {
                const d = sslDaysLeft(c);
                return (
                  <li key={c.key} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <span className="flex min-w-0 items-center gap-2"><StatusIcon s={c.status} /><span className="truncate" data-no-translit>{c.target}</span></span>
                    <span className={`shrink-0 font-medium tabular ${d != null && d < 7 ? "text-red-600" : d != null && d < 21 ? "text-amber-700" : "text-slate-700"}`}>{d == null ? (c.message ?? "—") : d < 0 ? "muddati o'tgan" : `${d} kun qoldi`}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
        <Card>
          <CardHeader title="Zaxira nusxa" icon={Database} action={<ActionButton type="RUN_BACKUP" label="Zaxira olish" icon="archive" />} />
          {backup.length === 0 ? <p className="text-sm text-slate-500">Ma&apos;lumot yo&apos;q — agent oxirgi zaxirani tekshirgach chiqadi.</p> : (
            <ul className="divide-y divide-slate-100">
              {backup.map((c) => {
                const h = backupAgeHours(c);
                const size = (c.data as { sizeBytes?: number } | null)?.sizeBytes;
                return (
                  <li key={c.key} className="space-y-0.5 py-2 text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <span className="flex items-center gap-2"><StatusIcon s={c.status} /> {c.target}</span>
                      <span className={`font-medium tabular ${h != null && h > 48 ? "text-red-600" : h != null && h > 26 ? "text-amber-700" : "text-slate-700"}`}>{h == null ? "—" : <Ago iso={new Date(Date.now() - h * 3_600_000).toISOString()} />}</span>
                    </div>
                    <div className="text-xs text-slate-500">{c.message}{typeof size === "number" ? ` · ${bytes(size)}` : ""}</div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>

      {/* ── Ochiq hodisalar (qisqa) ── */}
      <Card>
        <CardHeader title="Ochiq hodisalar" icon={Siren} action={<Link href="/superadmin/hodisalar" className="text-sm font-medium text-slate-600 hover:underline">Hammasi →</Link>} />
        {(s?.incidents.length ?? 0) === 0 ? <p className="text-sm text-slate-500">Ochiq hodisa yo&apos;q.</p> : (
          <ul className="divide-y divide-slate-100">
            {s!.incidents.slice(0, 6).map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                <SeverityBadge s={i.severity} />
                <Link href={`/superadmin/hodisalar?id=${i.id}`} className="min-w-0 flex-1 basis-48 hover:underline">{i.title}</Link>
                <span className="text-xs text-slate-500">{i.count > 1 ? `${i.count} marta · ` : ""}<Ago iso={i.lastSeenAt} /></span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function CellCheck({ c }: { c: CheckView | undefined }) {
  if (!c) return <span className="text-xs text-slate-400">—</span>;
  return <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs" title={c.message ?? undefined}><StatusIcon s={c.status} size={14} />{c.latencyMs != null ? <span className="tabular">{c.latencyMs} ms</span> : <CheckBadge s={c.status} />}</span>;
}

function ServiceCard({ c }: { c: CheckView }) {
  const unit = restartableUnit(c.key);
  const ring = { OK: "border-slate-200/80", WARN: "border-amber-300", CRIT: "border-red-300", UNKNOWN: "border-slate-200/80" }[c.status];
  return (
    <div className={`flex flex-col gap-2 rounded-(--radius-card) border bg-white p-4 shadow-(--shadow-card) ${ring}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2"><StatusIcon s={c.status} /><span className="truncate font-medium text-slate-900" data-no-translit>{c.target}</span></div>
        <CheckBadge s={c.status} />
      </div>
      {c.message && <p className="text-xs text-slate-600 [overflow-wrap:anywhere]">{c.message}</p>}
      <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
        <span className="font-mono" data-no-translit>{c.kind}</span>
        {c.latencyMs != null && <span className="tabular">{c.latencyMs} ms</span>}
        <span>holatda: <Ago iso={c.changedAt} bare /></span>
        <span>tekshirildi <Ago iso={c.checkedAt} /></span>
      </div>
      {unit && (
        <div><ActionButton type="RESTART_UNIT" params={{ unit }} label="Qayta ishga tushirish" icon="restart" variant={c.status === "CRIT" ? "danger" : "secondary"} /></div>
      )}
    </div>
  );
}

function Metric({ icon: Icon, label, value, hint, children, tone = "default" }: { icon: typeof Cpu; label: string; value: React.ReactNode; hint?: React.ReactNode; children?: React.ReactNode; tone?: "default" | "warning" | "danger" }) {
  const tc = { default: "text-slate-900", warning: "text-amber-700", danger: "text-red-600" }[tone];
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-(--radius-card) border border-slate-200/80 bg-white p-4 shadow-(--shadow-card)">
      <div className="flex items-center justify-between gap-2 text-[13px] font-medium text-slate-500"><span data-no-translit>{label}</span><Icon size={16} aria-hidden /></div>
      <div className={`text-xl font-semibold tabular ${tc}`}>{value}</div>
      {hint && <div className="text-xs text-slate-500">{hint}</div>}
      {children}
    </div>
  );
}

function HostCards({ s, hostChecks }: { s: MonitorSnapshot; hostChecks: CheckView[] }) {
  const h = s.host!;
  const sr = s.series;
  const memPct = h.memTotal ? (h.memUsed / h.memTotal) * 100 : 0;
  const diskPct = h.diskTotal ? (h.diskUsed / h.diskTotal) * 100 : 0;
  const age = Date.now() - new Date(h.takenAt).getTime();
  return (
    <section aria-labelledby="host-h" className="space-y-3">
      <h2 id="host-h" className="flex flex-wrap items-center gap-2 text-base font-semibold text-slate-900">
        <Server size={16} aria-hidden /> <span data-no-translit>{h.hostname}</span>
        <span className={`text-xs font-normal ${age > 120_000 ? "text-red-600" : "text-slate-500"}`} suppressHydrationWarning>surat: <Ago iso={h.takenAt} /></span>
        {hostChecks.filter((c) => c.status !== "OK").map((c) => <Badge key={c.key} color={c.status === "CRIT" ? "red" : "amber"}>{c.message ?? c.target}</Badge>)}
      </h2>
      <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <Metric icon={Cpu} label="CPU" value={pct(h.cpuPct)} hint={h.cpus ? `${h.cpus} yadro` : undefined} tone={toneOf(h.cpuPct, 75, 90)}>
          <Sparkline label="CPU yuklamasi" values={sr.cpu} times={sr.t} format={pct} max={100} tone={toneOf(h.cpuPct, 75, 90)} />
        </Metric>
        <Metric icon={MemoryStick} label="RAM" value={pct(memPct)} hint={<span data-no-translit>{bytes(h.memUsed)} / {bytes(h.memTotal)}{h.swapTotal ? ` · swap ${bytes(h.swapUsed)}` : ""}</span>} tone={toneOf(memPct, 80, 92)}>
          <Sparkline label="Xotira band" values={sr.mem} times={sr.t} format={pct} max={100} tone={toneOf(memPct, 80, 92)} />
        </Metric>
        <Metric icon={HardDrive} label="Disk" value={pct(diskPct)} hint={<span data-no-translit>{bytes(h.diskUsed)} / {bytes(h.diskTotal)}</span>} tone={toneOf(diskPct, 80, 90)}>
          <Sparkline label="Disk band" values={sr.disk} times={sr.t} format={pct} max={100} tone={toneOf(diskPct, 80, 90)} />
        </Metric>
        <Metric icon={Activity} label="Load" value={h.load[0].toFixed(2)} hint={<span data-no-translit>{h.load.map((x) => x.toFixed(2)).join(" / ")}</span>} tone={h.cpus ? toneOf(h.load[0] / h.cpus, 1, 2) : "default"}>
          <Sparkline label="Yuklama (1 daq)" values={sr.load} times={sr.t} format={(v) => v.toFixed(2)} />
        </Metric>
        <Metric icon={Network} label="Tarmoq" value={<span className="text-base" data-no-translit>↓ {bps(h.netRx)}</span>} hint={<span data-no-translit>↑ {bps(h.netTx)}</span>}>
          <Sparkline label="Kiruvchi trafik" values={sr.rx} times={sr.t} format={bps} />
          <Sparkline label="Chiquvchi trafik" values={sr.tx} times={sr.t} format={bps} />
        </Metric>
        <Metric icon={Timer} label="Ishlash vaqti" value={<span className="text-base">{duration(h.uptimeSec)}</span>} hint={s.agent ? <>agent: <Ago iso={s.agent.lastSeenAt} /></> : "agent yo'q"} />
      </div>
    </section>
  );
}
