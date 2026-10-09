"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { Activity, Building2, Cpu, DatabaseBackup, HardDrive, ListChecks, MemoryStick, Server, Siren } from "lucide-react";
import {
  SOURCE_LABEL, INCIDENT_STATUS, actionLabel, backupAgeHours, bytes, duration,
  type ActionStatusT, type CheckStatusT, type CheckView, type MonitorSnapshot,
} from "@/lib/control/monitor/shared";
import { Banner, Dot, Section, ServiceRow, StatusTile, type Tone } from "../../_ui";
import { useLiveMonitor } from "./live";
import { Ago, SeverityBadge } from "./bits";
import { HelpButton } from "../_help/help";

/**
 * Bosh sahifa «Status Board» — jonli qismlar (SSE oqimidan): banner, svetofor plitkalari, xizmatlar,
 * hodisalar, grafik, amallar. Korxona statistikasi serverda yig'iladi va prop bilan keladi.
 */

const NOT_SERVICE = new Set(["ssl", "backup", "security", "agent"]);
const isService = (c: CheckView) => !NOT_SERVICE.has(c.kind) && !c.key.startsWith("http:tenant:") && !c.key.startsWith("db:tenant:") && !c.key.startsWith("host:");
const RANK: Record<CheckStatusT, number> = { CRIT: 0, WARN: 1, UNKNOWN: 2, OK: 3 };
const toneOfCheck = (s: CheckStatusT): Tone => (s === "OK" ? "ok" : s === "WARN" ? "warn" : s === "CRIT" ? "crit" : "unk");
const level = (v: number, warn: number, crit: number): Tone => (v >= crit ? "crit" : v >= warn ? "warn" : "ok");
const STATE: Record<Tone, string> = { ok: "Me'yorda", warn: "Yuqori", crit: "Haddan oshgan", unk: "Ma'lumot yo'q" };

export type TenantTile = { tone: Tone; up: number; total: number; sub: string };
export type ServerFallback = { load: number[]; cpus: number; memFreeGb: number; memTotalGb: number; disk: { freeGb: number; totalGb: number } | null; uptimeH: number; node: string; commit: string | null };

/* ───────── Banner ───────── */
export function BoardBanner({ initial, tenantProblems }: { initial: MonitorSnapshot | null; tenantProblems: string[] }) {
  const { data: s } = useLiveMonitor(initial);
  if (!s || !s.agent) {
    if (tenantProblems.length) return <Banner tone="crit" title="Muammo bor — korxona ishlamayapti">{tenantProblems.join(" · ")}</Banner>;
    return (
      <Banner tone="unk" title="Monitoring ma'lumoti yo'q" action={<span className="inline-flex items-center gap-1"><Link href="/superadmin/monitoring" className="sa-btn">Server va xizmatlar →</Link><HelpButton topic="agent:status" /></span>}>
        insof-agent o&apos;rnatilmagan yoki hali signal bermagan — PLATFORMA.md → Monitoring agenti.
      </Banner>
    );
  }
  const hot = s.incidents.filter((i) => i.severity === "CRITICAL" || i.severity === "HIGH");
  const crit = s.checks.filter((c) => c.status === "CRIT");
  const warn = s.checks.filter((c) => c.status === "WARN");
  const open = s.counts.open + s.counts.acked;
  const top = hot[0] ?? s.incidents[0];
  const incLink = <span className="inline-flex items-center gap-1">{top ? <Link href={`/superadmin/hodisalar?id=${top.id}`} className="sa-btn">Hodisani ochish</Link> : <Link href="/superadmin/monitoring" className="sa-btn">Server va xizmatlar →</Link>}{top ? <HelpButton checkKey={top.key} /> : <HelpButton topic="home:health" />}</span>;
  const topText = top ? <>{top.title} · <Ago iso={top.firstSeenAt} /> boshlangan{top.count > 1 ? ` · ${top.count} marta takrorlandi` : ""}</> : null;

  if (hot.length || crit.length || s.agent.stale || tenantProblems.length) {
    const n = hot.length;
    const title = s.agent.stale ? "Muammo bor — agent javob bermayapti"
      : n ? `Muammo bor — ${n} ta ${s.counts.critical ? "kritik" : "yuqori"} hodisa`
        : crit.length ? `Muammo bor — ${crit.length} ta nosoz xizmat` : "Muammo bor — korxona ishlamayapti";
    return (
      <Banner tone="crit" title={title} action={incLink}>
        {s.agent.stale ? <>Oxirgi signal: <Ago iso={s.agent.lastSeenAt} />. Ko&apos;rsatkichlar eskirgan.</>
          : topText ?? (crit.length ? crit.map((c) => `${c.target}: ${c.message ?? "javob yo'q"}`).join(" · ") : tenantProblems.join(" · "))}
      </Banner>
    );
  }
  if (open || warn.length) {
    return (
      <Banner tone="warn" title={open ? `E'tibor talab qiladi — ${open} ta ochiq hodisa` : `E'tibor talab qiladi — ${warn.length} ta ogohlantirish`} action={incLink}>
        {topText ?? warn.map((c) => `${c.target}: ${c.message ?? "ogohlantirish"}`).join(" · ")}
      </Banner>
    );
  }
  return null;
}

/* ───────── Svetofor plitkalari ───────── */
export function BoardTiles({ initial, tenants, server }: { initial: MonitorSnapshot | null; tenants: TenantTile; server: ServerFallback }) {
  const { data: s } = useLiveMonitor(initial);
  const h = s?.host ?? null;
  const services = (s?.checks ?? []).filter(isService);
  const okN = services.filter((c) => c.status === "OK").length;
  const worst = [...services].sort((a, b) => RANK[a.status] - RANK[b.status])[0];
  const svcTone: Tone = !s?.agent || services.length === 0 ? "unk" : toneOfCheck(worst.status);
  const bad = services.filter((c) => c.status === "CRIT" || c.status === "WARN");

  // CPU / RAM / Disk — agent surati; yo'q bo'lsa panel jarayoni ko'rgan server (os.loadavg, statfs)
  const cpuPct = h ? h.cpuPct : null;
  const loadRatio = server.cpus ? server.load[0] / server.cpus : 0;
  const cpuTone: Tone = cpuPct != null ? level(cpuPct, 75, 90) : level(loadRatio, 1, 2);
  const memPct = h ? (h.memTotal ? (h.memUsed / h.memTotal) * 100 : 0) : server.memTotalGb ? ((server.memTotalGb - server.memFreeGb) / server.memTotalGb) * 100 : 0;
  const diskPct = h ? (h.diskTotal ? (h.diskUsed / h.diskTotal) * 100 : 0) : server.disk ? ((server.disk.totalGb - server.disk.freeGb) / server.disk.totalGb) * 100 : null;
  const load = h ? h.load : server.load;

  const backups = (s?.checks ?? []).filter((c) => c.kind === "backup").sort((a, b) => RANK[a.status] - RANK[b.status]);
  const b = backups[0];
  const age = b ? backupAgeHours(b) : null;
  const size = b ? (b.data as { sizeBytes?: number } | null)?.sizeBytes : undefined;
  const bTone: Tone = b ? toneOfCheck(b.status) : "unk";

  return (
    <div className="sa-tiles">
      <StatusTile tone={tenants.tone} label="Korxonalar" icon={Building2} href="#korxonalar"
        state={tenants.tone === "ok" ? "Ishlayapti" : tenants.tone === "crit" ? "Nosoz" : tenants.tone === "warn" ? "Ogohlantirish" : "Korxona yo'q"}
        value={tenants.up} unit={`/ ${tenants.total}`} sub={tenants.sub} />
      <StatusTile tone={svcTone} label="Xizmatlar" icon={Activity} href="/superadmin/monitoring"
        state={svcTone === "ok" ? "Ishlayapti" : svcTone === "crit" ? "Nosoz" : svcTone === "warn" ? "Ogohlantirish" : "Ma'lumot yo'q"}
        value={services.length ? okN : "—"} unit={services.length ? `/ ${services.length}` : undefined}
        sub={!s?.agent ? "insof-agent signal bermagan" : bad.length ? `${bad[0].target} ${bad[0].status === "CRIT" ? "nosoz" : "— ogohlantirish"}${bad.length > 1 ? ` (+${bad.length - 1})` : ""}` : "Hammasi javob beryapti"} />
      <StatusTile tone={cpuTone} label="CPU" icon={Cpu} href="/superadmin/monitoring" state={STATE[cpuTone]}
        value={cpuPct != null ? Math.round(cpuPct) : load[0].toFixed(2)} unit={cpuPct != null ? "%" : "load"}
        sub={<span data-no-translit>load {load.map((x) => x.toFixed(2)).join(" / ")}{(h?.cpus ?? server.cpus) ? ` · ${h?.cpus ?? server.cpus} yadro` : ""}</span>} />
      <StatusTile tone={level(memPct, 80, 92)} label="RAM" icon={MemoryStick} href="/superadmin/monitoring" state={STATE[level(memPct, 80, 92)]}
        value={Math.round(memPct)} unit="%"
        sub={<span data-no-translit>{h ? `${bytes(h.memUsed)} / ${bytes(h.memTotal)}` : `${(server.memTotalGb - server.memFreeGb).toFixed(1)} / ${server.memTotalGb} GB`}</span>} />
      <StatusTile tone={diskPct == null ? "unk" : level(diskPct, 80, 90)} label="Disk" icon={HardDrive} href="/superadmin/server"
        state={diskPct == null ? STATE.unk : STATE[level(diskPct, 80, 90)]}
        value={diskPct == null ? "—" : Math.round(diskPct)} unit={diskPct == null ? undefined : "%"}
        sub={<span data-no-translit>{h ? `${bytes(h.diskUsed)} / ${bytes(h.diskTotal)}` : server.disk ? `${server.disk.totalGb - server.disk.freeGb} / ${server.disk.totalGb} GB` : "—"}</span>} />
      <StatusTile tone={bTone} label="Zaxira" icon={DatabaseBackup} href="/superadmin/zaxira"
        state={!b ? "Ma'lumot yo'q" : bTone === "ok" ? "Bajarildi" : bTone === "crit" ? "Eskirgan" : bTone === "warn" ? "Ogohlantirish" : "Noma'lum"}
        value={age == null ? "—" : age < 48 ? Math.max(0, Math.round(age)) : Math.round(age / 24)} unit={age == null ? undefined : age < 48 ? "soat oldin" : "kun oldin"}
        sub={b ? <>{b.message ?? b.target}{typeof size === "number" ? <span data-no-translit> · {bytes(size)}</span> : null}</> : "Agent zaxirani hali tekshirmagan"} />
    </div>
  );
}

/* ───────── Xizmatlar ───────── */
export function BoardServices({ initial, hostname }: { initial: MonitorSnapshot | null; hostname: string }) {
  const { data: s } = useLiveMonitor(initial);
  const services = (s?.checks ?? []).filter(isService).sort((a, b) => RANK[a.status] - RANK[b.status] || a.target.localeCompare(b.target));
  return (
    <Section id="b-svc" title={<>Xizmatlar — <span data-no-translit>{s?.host?.hostname ?? hostname}</span> <HelpButton topic="mon:services" /></>} icon={Server} sub="har 3 soniyada"
      more={{ href: "/superadmin/monitoring", label: "Server va xizmatlar →" }}>
      {services.length === 0 ? <p className="sa-sub">Tekshiruv natijalari yo&apos;q — insof-agent ishga tushgach xizmatlar shu yerda chiqadi.</p> : (
        <ul className="sa-svc">
          {services.map((c) => (
            <ServiceRow key={c.key} tone={toneOfCheck(c.status)} name={c.target} href="/superadmin/monitoring" title={c.message ?? undefined}
              value={c.status === "OK" ? (c.latencyMs != null ? `${c.latencyMs} ms` : "faol") : `${c.status === "CRIT" ? "Nosoz" : c.status === "WARN" ? "Diqqat" : "?"}${c.message ? ` · ${c.message}` : ""}`} />
          ))}
        </ul>
      )}
    </Section>
  );
}

/* ───────── Ochiq hodisalar ───────── */
export function BoardIncidents({ initial }: { initial: MonitorSnapshot | null }) {
  const { data: s } = useLiveMonitor(initial);
  const list = (s?.incidents ?? []).slice(0, 6);
  const open = s ? s.counts.open + s.counts.acked : 0;
  return (
    <Section id="b-inc" title={<>Ochiq hodisalar <HelpButton topic="home:hot" /></>} icon={Siren} sub={open ? `${open} ta` : undefined} more={{ href: "/superadmin/hodisalar", label: "Hammasi →" }}>
      {list.length === 0 ? <p className="sa-sub">Ochiq hodisa yo&apos;q.</p> : (
        <ul className="sa-ilist">
          {list.map((i) => (
            <li key={i.id}>
              <Link href={`/superadmin/hodisalar?id=${i.id}`} className="sa-irow">
                <SeverityBadge s={i.severity} />
                <span className="it">{i.title}</span>
                <span className="im">
                  <span>{SOURCE_LABEL[i.source] ?? i.source}</span>
                  <span>{INCIDENT_STATUS[i.status].label}</span>
                  {i.count > 1 && <span className="num">×{i.count}</span>}
                  <Ago iso={i.lastSeenAt} />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

/* ───────── So'nggi amallar ───────── */
const ACT_TONE: Record<ActionStatusT, Tone> = { DONE: "ok", FAILED: "crit", REJECTED: "unk", RUNNING: "warn", PENDING: "unk", CANCELLED: "unk" };
const ACT_WORD: Record<ActionStatusT, string> = { DONE: "Bajarildi", FAILED: "Xato", REJECTED: "Rad etildi", RUNNING: "Bajarilmoqda", PENDING: "Navbatda", CANCELLED: "Bekor qilindi" };

export function BoardActions({ initial }: { initial: MonitorSnapshot | null }) {
  const { data: s } = useLiveMonitor(initial);
  const list = (s?.actions ?? []).slice(0, 6);
  const hm = (iso: string) => { const d = new Date(iso); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
  return (
    <Section id="b-act" title={<>So&apos;nggi amallar <HelpButton topic="act:status" /></>} icon={ListChecks} more={{ href: "/superadmin/amallar", label: "Amallar →" }}>
      {list.length === 0 ? <p className="sa-sub">Hali amal so&apos;ralmagan.</p> : (
        <ul className="sa-alist">
          {list.map((a) => {
            const p = Object.entries(a.params).map(([k, v]) => `${k}=${String(v)}`).join(" ");
            return (
              <li key={a.id}>
                <Dot tone={ACT_TONE[a.status]} label={ACT_WORD[a.status]} />
                <span className="min-w-0"><span className="at">{actionLabel(a.type)}</span><br />
                  <span className="am">{ACT_WORD[a.status]}{p ? <> · <span data-no-translit>{p}</span></> : null} · {a.requestedBy ?? "tizim"}</span></span>
                <time dateTime={a.requestedAt} suppressHydrationWarning>{hm(a.requestedAt)}</time>
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}

/* ───────── CPU va RAM grafigi (bitta o'q, 0–100%) ───────── */
export function BoardChart({ initial, footer }: { initial: MonitorSnapshot | null; footer: React.ReactNode }) {
  const { data: s } = useLiveMonitor(initial);
  const sr = s?.series;
  const n = sr?.cpu.length ?? 0;
  const span = n > 1 ? (sr!.t[n - 1] - sr!.t[0]) / 1000 : 0;
  return (
    <Section id="b-ch" title={<>CPU va RAM{span > 0 ? ` — so'nggi ${duration(span)}` : ""} <HelpButton topic="board:chart" /></>} icon={Activity}
      action={<div className="sa-legend" aria-hidden><span><i style={{ background: "var(--c1)" }} />CPU, %</span><span><i style={{ background: "var(--c2)" }} />RAM, %</span></div>}>
      {n < 2 ? <p className="sa-sub">Grafik uchun ma&apos;lumot yetarli emas — agent har daqiqada surat yozadi.</p> : <LineChart t={sr!.t} a={sr!.cpu} b={sr!.mem} />}
      <div className="sa-sub" style={{ marginTop: 8 }}>{footer}</div>
    </Section>
  );
}

function LineChart({ t, a, b }: { t: number[]; a: number[]; b: number[] }) {
  const id = useId();
  const [hover, setHover] = useState<number | null>(null);
  // viewBox = konteyner kengligi: telefonda ham shrift 11px qoladi (masshtablanib maydalashmaydi)
  const wrap = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(640);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(260, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const H = W < 480 ? 190 : 220, m = { l: 36, r: 12, t: 12, b: 24 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b, N = a.length;
  const x = (i: number) => m.l + (i * iw) / (N - 1);
  const y = (v: number) => m.t + ih * (1 - Math.min(100, Math.max(0, v)) / 100);
  const path = (arr: number[]) => arr.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const hm = (ms: number) => { const d = new Date(ms); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
  const ticks = W < 480 ? [0, Math.floor((N - 1) / 2)] : [0, Math.floor((N - 1) / 3), Math.floor((2 * (N - 1)) / 3)];
  const i = hover ?? N - 1;
  const peak = Math.max(...a);
  return (
    <div className="sa-chart" ref={wrap}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-labelledby={id}
        onPointerMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const px = ((e.clientX - r.left) / r.width) * W;
          setHover(Math.max(0, Math.min(N - 1, Math.round(((px - m.l) / iw) * (N - 1)))));
        }}
        onPointerLeave={() => setHover(null)}>
        <title id={id}>{`CPU hozir ${a[N - 1]}%, eng yuqori ${peak}%; RAM hozir ${b[N - 1]}%`}</title>
        {[0, 25, 50, 75, 100].map((v) => (
          <g key={v}>
            <line x1={m.l} x2={W - m.r} y1={y(v)} y2={y(v)} style={{ stroke: "var(--grid)" }} strokeWidth={1} />
            <text x={m.l - 6} y={y(v) + 3.5} textAnchor="end">{v}%</text>
          </g>
        ))}
        <line x1={m.l} x2={W - m.r} y1={y(90)} y2={y(90)} style={{ stroke: "var(--crit)" }} strokeDasharray="3 4" opacity={0.7} />
        <text x={m.l + 6} y={y(90) - 4} style={{ fill: "var(--crit)" }}>chegara 90%</text>
        {ticks.map((k) => <text key={k} x={x(k)} y={H - 6} textAnchor="middle" suppressHydrationWarning>{hm(t[k])}</text>)}
        <text x={W - m.r} y={H - 6} textAnchor="end">hozir</text>
        <path d={`${path(a)}L${x(N - 1)},${y(0)}L${x(0)},${y(0)}Z`} style={{ fill: "var(--c1)" }} opacity={0.12} />
        <path d={path(b)} fill="none" style={{ stroke: "var(--c2)" }} strokeWidth={2} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        <path d={path(a)} fill="none" style={{ stroke: "var(--c1)" }} strokeWidth={2} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        {hover != null && <line x1={x(i)} x2={x(i)} y1={m.t} y2={m.t + ih} style={{ stroke: "var(--muted)" }} strokeWidth={1} />}
        <circle cx={x(i)} cy={y(a[i])} r={4} style={{ fill: "var(--c1)", stroke: "var(--card)" }} strokeWidth={2} />
        <circle cx={x(i)} cy={y(b[i])} r={4} style={{ fill: "var(--c2)", stroke: "var(--card)" }} strokeWidth={2} />
      </svg>
      {hover != null && (
        <div className="tip" style={{ left: `${(x(i) / W) * 100}%` }} data-no-translit>{hm(t[i])} · CPU {a[i]}% · RAM {b[i]}%</div>
      )}
    </div>
  );
}
