"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  Activity, Building2, ChevronRight, Cpu, DatabaseBackup, FileText, ListChecks, MoreHorizontal, RefreshCw, Rocket, Server, ShieldAlert, Siren,
} from "lucide-react";
import { isActionType } from "@/lib/control/monitor/contract";
import {
  SOURCE_LABEL, actionLabel, backupAgeHours, bytes, duration, restartableUnit,
  type CheckStatusT, type CheckView, type IncidentView, type MonitorSnapshot, type SeverityT,
} from "@/lib/control/monitor/shared";
import { BottomSheet } from "../../_ui/sheet";
import { useLiveMonitor } from "./live";
import { Ago } from "./bits";
import { AckButton, ActionButton } from "./action-dialog";
import type { ServerFallback } from "./board";
import { CheckHelpInline, HelpButton, WithHelp } from "../_help/help";

/**
 * Telefon bosh sahifasi — admin prefs'i bo'yicha: M4 «Vidjetlar» yoki M5 «Zich Pro».
 * Ma'lumot bosh sahifa bilan bir xil (SSE oqimi + serverda yig'ilgan korxona holati). Amallar faqat mavjud xavfsiz oqim
 * orqali: ActionButton → enqueueAction (yozma tasdiq, kerak bo'lsa parol) — bu yerda hech qanday amal mantig'i yo'q.
 */

export type MobileTenant = { id: string; slug: string; name: string; status: string; up: boolean | null; ms: number | null; users: number | null; dbOk: boolean | null };
export type MobileHomeProps = {
  initial: MonitorSnapshot | null; tenants: MobileTenant[]; server: ServerFallback; hostname: string; commit: string | null;
};

const NOT_SERVICE = new Set(["ssl", "backup", "security", "agent"]);
const isService = (c: CheckView) => !NOT_SERVICE.has(c.kind) && !c.key.startsWith("http:tenant:") && !c.key.startsWith("db:tenant:") && !c.key.startsWith("host:");
const RANK: Record<CheckStatusT, number> = { CRIT: 0, WARN: 1, UNKNOWN: 2, OK: 3 };
const SEV_SHORT: Record<SeverityT, string> = { CRITICAL: "CRIT", HIGH: "HIGH", MEDIUM: "MED", LOW: "LOW", INFO: "INFO" };
const SEV_TONE: Record<SeverityT, string> = { CRITICAL: "crit", HIGH: "high", MEDIUM: "warn", LOW: "info", INFO: "mut" };
const SEV_UZ: Record<SeverityT, string> = { CRITICAL: "kritik", HIGH: "yuqori", MEDIUM: "o'rta", LOW: "past", INFO: "ma'lumot" };
const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);
const tone = (v: number, w: number, c: number) => (v >= c ? "crit" : v >= w ? "warn" : "ok");

function useHostNumbers(s: MonitorSnapshot | null, server: ServerFallback) {
  const h = s?.host ?? null;
  const cpu = h ? Math.round(h.cpuPct) : null;
  const ram = h ? pct(h.memUsed, h.memTotal) : pct(server.memTotalGb - server.memFreeGb, server.memTotalGb);
  const disk = h ? pct(h.diskUsed, h.diskTotal) : server.disk ? pct(server.disk.totalGb - server.disk.freeGb, server.disk.totalGb) : null;
  const load = h ? h.load : server.load;
  const uptime = h ? duration(h.uptimeSec) : `${server.uptimeH} soat`;
  return { cpu, ram, disk, load, uptime };
}
function backupOf(s: MonitorSnapshot | null) {
  const b = (s?.checks ?? []).filter((c) => c.kind === "backup").sort((x, y) => RANK[x.status] - RANK[y.status])[0];
  if (!b) return null;
  return { c: b, age: backupAgeHours(b), size: (b.data as { sizeBytes?: number } | null)?.sizeBytes };
}
const hm = (iso: string) => { const d = new Date(iso); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };

/** Kichik chiziqli grafik (bezak; qiymat yonida matn bilan beriladi). */
function Spark({ values, max, h = 18, area }: { values: number[]; max?: number; h?: number; area?: boolean }) {
  if (values.length < 2) return <svg viewBox={`0 0 100 ${h}`} aria-hidden />;
  const mx = max ?? (Math.max(...values) * 1.15 || 1);
  const pts = values.map((v, i) => `${i ? "L" : "M"}${((i / (values.length - 1)) * 100).toFixed(2)},${(h - (Math.min(v, mx) / mx) * (h - 2) - 1).toFixed(2)}`).join("");
  return (
    <svg viewBox={`0 0 100 ${h}`} preserveAspectRatio="none" aria-hidden>
      {area && <path d={`${pts}L100,${h}L0,${h}Z`} style={{ fill: "var(--c1)" }} opacity={0.16} />}
      <path d={pts} fill="none" style={{ stroke: area ? "var(--c1)" : "currentColor" }} strokeWidth={area ? 2 : 1.3} vectorEffect="non-scaling-stroke" opacity={area ? 1 : 0.8} />
    </svg>
  );
}

/* ══════════════════════ M4 · Vidjetlar ══════════════════════ */
export function WidgetsHome({ initial, tenants, server, hostname, commit }: MobileHomeProps) {
  const { data: s } = useLiveMonitor(initial);
  const host = s?.host?.hostname ?? hostname;
  const n = useHostNumbers(s, server);
  const services = (s?.checks ?? []).filter(isService).sort((a, b) => RANK[a.status] - RANK[b.status] || a.target.localeCompare(b.target));
  const okN = services.filter((c) => c.status === "OK").length;
  const incidents = s?.incidents ?? [];
  const top = incidents[0];
  const others = incidents.slice(1, 3);
  const b = backupOf(s);
  const lastAct = s?.actions[0];
  const series = s?.series.cpu ?? [];
  const peak = series.length ? Math.round(Math.max(...series)) : null;
  const [sheet, setSheet] = useState<IncidentView | null>(null);

  // Gorizontal sahifalar: scroll-snap + nuqtalar + chap/o'ng tugmalari (klaviatura)
  const pager = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState(0);
  const PAGES = 3;
  const go = (i: number) => {
    const el = pager.current;
    if (!el) return;
    const k = Math.max(0, Math.min(PAGES - 1, i));
    el.scrollTo({ left: k * el.clientWidth, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    setPage(k);
  };
  useEffect(() => {
    const el = pager.current;
    if (!el) return;
    const on = () => setPage(Math.round(el.scrollLeft / Math.max(1, el.clientWidth)));
    el.addEventListener("scroll", on, { passive: true });
    return () => el.removeEventListener("scroll", on);
  }, []);

  const t0 = tenants.find((t) => t.status === "ACTIVE") ?? tenants[0];
  const tenantDown = tenants.filter((t) => t.status === "ACTIVE" && (t.up === false || t.dbOk === false));

  return (
    <div className="m4">
      <h1 className="sa-sr">Platforma holati</h1>
      <div className="m4-pager" ref={pager} tabIndex={0} aria-roledescription="karusel" aria-label={`Vidjet sahifalari, ${page + 1}/${PAGES}. Chap/o'ng strelka bilan almashtiring`}
        onKeyDown={(e) => { if (e.key === "ArrowRight") { e.preventDefault(); go(page + 1); } if (e.key === "ArrowLeft") { e.preventDefault(); go(page - 1); } }}>
        {/* 1-sahifa: asosiy */}
        <div className="m4-page" role="group" aria-label="1-sahifa: asosiy">
          {top ? (
            <button type="button" className={`w w42 ${top.severity === "CRITICAL" || top.severity === "HIGH" ? "crit" : "warn"}`} onClick={() => setSheet(top)} aria-haspopup="dialog"
              aria-label={`Hodisa vidjeti: ${SEV_UZ[top.severity]}. ${top.title}. Ochish`}>
              <span className="w-k"><Siren size={15} aria-hidden />Hodisa · {SEV_UZ[top.severity]}</span>
              <span className="w-t">{top.title}</span>
              <span className="w-s"><Ago iso={top.firstSeenAt} /> · {top.count} marta{incidents.length > 1 ? ` · yana ${incidents.length - 1} ochiq` : ""}</span>
            </button>
          ) : (
            <Link href="/superadmin/hodisalar" className="w w42 ok" aria-label="Hodisa vidjeti: ochiq hodisa yo'q">
              <span className="w-k"><Siren size={15} aria-hidden />Hodisalar</span>
              <span className="w-t">{s?.agent ? "Ochiq hodisa yo'q" : "Monitoring ma'lumoti yo'q"}</span>
              <span className="w-s">{s?.agent ? "Hammasi joyida" : "insof-agent signal bermagan"}</span>
            </Link>
          )}
          <Link href="/superadmin/monitoring" className="w" aria-label={`Server vidjeti: CPU ${n.cpu ?? "—"}, RAM ${n.ram}, disk ${n.disk ?? "—"} foiz`}>
            <span className="w-k"><Server size={15} aria-hidden /><span className="truncate" data-no-translit>{host}</span></span>
            <span className="w-bars">
              <Bar k="CPU" v={n.cpu} w={75} c={90} />
              <Bar k="RAM" v={n.ram} w={80} c={92} />
              <Bar k="Disk" v={n.disk} w={80} c={90} />
            </span>
          </Link>
          {t0 ? (
            <Link href={`/superadmin/korxonalar/${t0.slug}`} className={`w ${tenantDown.length ? "crit" : ""}`} aria-label={`Korxona vidjeti: ${t0.name}${tenantDown.length ? ", nosoz" : ""}`}>
              <span className="w-k"><Building2 size={15} aria-hidden />Korxona{tenants.length > 1 ? `lar · ${tenants.length}` : ""}</span>
              <span className="w-big sm">{tenantDown.length ? `${tenantDown.length} ta nosoz` : t0.name}</span>
              <span className="w-s"><span className={`sa-dot ${t0.up ? "ok" : t0.up === false ? "crit" : ""}`} aria-hidden /> ERP {t0.ms != null ? `${t0.ms} ms` : "—"}{t0.users != null ? ` · ${t0.users} kishi` : ""}</span>
            </Link>
          ) : (
            <Link href="/superadmin/korxonalar/yangi" className="w" aria-label="Korxona vidjeti: korxona yo'q. Yangi korxona">
              <span className="w-k"><Building2 size={15} aria-hidden />Korxona</span><span className="w-big sm">Yo&apos;q</span><span className="w-s">Yangi korxona →</span>
            </Link>
          )}
          <Link href="/superadmin/zaxira" className={`w ${b && b.c.status === "CRIT" ? "crit" : ""}`} aria-label={`Zaxira vidjeti: ${b ? (b.c.message ?? b.c.status) : "ma'lumot yo'q"}`}>
            <span className="w-k"><DatabaseBackup size={15} aria-hidden />Zaxira</span>
            <span className="w-big">{b?.age != null ? (b.age < 48 ? `${Math.round(b.age)} soat` : `${Math.round(b.age / 24)} kun`) : "—"}{b?.c.status === "OK" ? " ✓" : ""}</span>
            <span className="w-s">{b ? <>{b.age != null ? "oldin" : b.c.message}{typeof b.size === "number" ? <span data-no-translit> · {bytes(b.size)}</span> : null}</> : "agent tekshirmagan"}</span>
          </Link>
          <Link href="/superadmin/relizlar" className="w" aria-label={`Reliz vidjeti: ${commit ?? "noma'lum"}`}>
            <span className="w-k"><Rocket size={15} aria-hidden />Reliz</span>
            <span className="w-big sm m-mono" data-no-translit>{commit ?? "—"}</span>
            <span className="w-s">Node {server.node.replace(/^v/, "")} · up {n.uptime}</span>
          </Link>
        </div>

        {/* 2-sahifa: server */}
        <div className="m4-page" role="group" aria-label="2-sahifa: server">
          <Link href="/superadmin/monitoring" className="w w42" aria-label={`CPU grafigi: hozir ${n.cpu ?? "—"} foiz${peak != null ? `, eng yuqori ${peak} foiz` : ""}`}>
            <span className="w-k"><Cpu size={15} aria-hidden />CPU · so&apos;nggi {s && s.series.t.length > 1 ? duration((s.series.t[s.series.t.length - 1] - s.series.t[0]) / 1000) : "—"}</span>
            <span className="w-s">hozir {n.cpu ?? "—"}%{peak != null ? ` · eng yuqori ${peak}%` : ""}</span>
            <span className="w-ch"><Spark values={series} max={100} h={62} area /></span>
          </Link>
          <Link href="/superadmin/monitoring" className="w w44" aria-label={`Xizmatlar vidjeti: ${services.length} dan ${okN} tasi ishlayapti`}>
            <span className="w-k"><Activity size={15} aria-hidden />Xizmatlar · {okN} / {services.length}</span>
            {services.length === 0 ? <span className="w-s">Tekshiruv natijasi yo&apos;q</span> : (
              <span className="w-list">
                {services.slice(0, 8).map((c) => (
                  <span key={c.key} className={`li ${c.status === "CRIT" ? "crit" : ""}`}>
                    <span className={`sa-dot ${c.status === "OK" ? "ok" : c.status === "WARN" ? "warn" : c.status === "CRIT" ? "crit" : ""}`} aria-hidden />
                    <span className="nm" data-no-translit>{c.target}</span>
                    <span className="vl">{c.status === "OK" ? (c.latencyMs != null ? `${c.latencyMs} ms` : "faol") : c.status === "CRIT" ? "nosoz" : c.status === "WARN" ? "diqqat" : "?"}</span>
                  </span>
                ))}
              </span>
            )}
          </Link>
        </div>

        {/* 3-sahifa: xavfsizlik va amallar */}
        <div className="m4-page" role="group" aria-label="3-sahifa: boshqa hodisalar va amallar">
          {others.map((i) => (
            <button key={i.id} type="button" className="w" onClick={() => setSheet(i)} aria-haspopup="dialog" aria-label={`Hodisa: ${SEV_UZ[i.severity]}. ${i.title}`}>
              <span className="w-k"><ShieldAlert size={15} aria-hidden />{SEV_UZ[i.severity]}</span>
              <span className="w-t">{i.title}</span>
              <span className="w-s"><Ago iso={i.lastSeenAt} /></span>
            </button>
          ))}
          {others.length === 0 && (
            <Link href="/superadmin/xavfsizlik" className="w" aria-label="Xavfsizlik vidjeti">
              <span className="w-k"><ShieldAlert size={15} aria-hidden />Xavfsizlik</span>
              <span className="w-t">{s?.report ? `Baho: ${s.report.grade}` : "Hisobot yo'q"}</span>
              <span className="w-s">{s?.report ? <Ago iso={s.report.createdAt} /> : "AI tahlil hali bo'lmagan"}</span>
            </Link>
          )}
          <Link href="/superadmin/amallar" className="w" aria-label={`Amallar vidjeti: ${lastAct ? actionLabel(lastAct.type) : "amal yo'q"}`}>
            <span className="w-k"><ListChecks size={15} aria-hidden />Oxirgi amal</span>
            <span className="w-t">{lastAct ? actionLabel(lastAct.type) : "Amal yo'q"}</span>
            <span className="w-s" suppressHydrationWarning>{lastAct ? `${hm(lastAct.requestedAt)} · ${lastAct.requestedBy ?? "tizim"}` : "—"}</span>
          </Link>
          <Link href="/superadmin/loglar" className="w" aria-label="Loglar">
            <span className="w-k"><FileText size={15} aria-hidden />Loglar</span>
            <span className="w-t">journald va nginx</span>
            <span className="w-s">so&apos;nggi qatorlar →</span>
          </Link>
        </div>
      </div>
      <p className="sa-sub" style={{ margin: "6px 0 0", textAlign: "center" }}><WithHelp topic="mobile:widgets">Vidjetlar nimani ko&apos;rsatadi?</WithHelp></p>
      <div className="m4-dots" role="group" aria-label="Vidjet sahifasi">
        {Array.from({ length: PAGES }, (_, i) => (
          <button key={i} type="button" onClick={() => go(i)} aria-label={`${i + 1}-sahifa`} aria-current={page === i}><i /></button>
        ))}
      </div>
      <IncidentSheet incident={sheet} onClose={() => setSheet(null)} checks={s?.checks ?? []} />
    </div>
  );
}

function Bar({ k, v, w, c }: { k: string; v: number | null; w: number; c: number }) {
  const t = v == null ? "" : tone(v, w, c);
  return <span className={`w-bar ${t}`}><span>{k}</span><i style={{ ["--p" as string]: `${v ?? 0}%` }} /><b>{v == null ? "—" : `${v}%`}</b></span>;
}

/** Hodisa varag'i (M4 «chora»): holat, tavsiya etilgan amallar — tanlangani mavjud ActionButton oqimi bilan bajariladi. */
function IncidentSheet({ incident: i, onClose, checks }: { incident: IncidentView | null; onClose: () => void; checks: CheckView[] }) {
  const fixes = (i?.suggestedActions ?? []).filter((f) => isActionType(f.type));
  const [pick, setPick] = useState(0);
  useEffect(() => { setPick(0); }, [i?.id]);
  const related = i ? checks.find((c) => i.key === c.key || i.key.endsWith(c.key)) : undefined;
  const f = fixes[pick];
  return (
    <BottomSheet open={!!i} onClose={onClose} title={i ? i.title : ""} initialFocus="button.sa-sheet-x">
      {i && (
        <div className="grid gap-3">
          <div className={`m4-hero ${SEV_TONE[i.severity]}`}>
            <p>{SOURCE_LABEL[i.source] ?? i.source} · {SEV_UZ[i.severity]}{related?.message ? ` — ${related.message}` : ""}</p>
            <div className="m4-st3">
              <div><b><Ago iso={i.firstSeenAt} bare /></b><span>davom etmoqda</span></div>
              <div><b>{i.count}</b><span>marta takror</span></div>
              <div><b>{i.status === "OPEN" ? "Ochiq" : "Ko'rildi"}</b><span>holat</span></div>
            </div>
          </div>
          {fixes.length > 0 && (
            <fieldset className="m4-opts">
              <legend>Amal tanlang <HelpButton topic="inc:fix" /></legend>
              {fixes.map((x, k) => (
                <label key={k} className="m4-opt">
                  <RefreshCw size={20} aria-hidden />
                  <span><b>{x.label ?? actionLabel(x.type)}</b><small>{Object.values(x.params ?? {}).map(String).join(" · ") || actionLabel(x.type)}</small></span>
                  <input type="radio" name={`fix-${i.id}`} checked={pick === k} onChange={() => setPick(k)} />
                  <i className="rd" aria-hidden />
                </label>
              ))}
            </fieldset>
          )}
          <CheckHelpInline checkKey={i.key} collapsed />
          {f && <ActionButton type={f.type} params={f.params} incidentId={i.id} label={f.label ?? actionLabel(f.type)} icon="wrench" variant="danger" size="md" className="w-full" />}
          <div className="grid grid-cols-2 gap-2">
            {i.status === "OPEN" ? <AckButton id={i.id} /> : <span />}
            <Link href={`/superadmin/hodisalar?id=${i.id}`} className="sa-btn">Tafsilot <ChevronRight size={16} aria-hidden /></Link>
          </div>
        </div>
      )}
    </BottomSheet>
  );
}

/* ══════════════════════ M5 · Zich Pro ══════════════════════ */
/** 24 soatlik uptime — tarix jadvali yo'q, shuning uchun faqat joriy holat va o'zgarish vaqtidan (oldin OK bo'lgan deb faraz). */
function uptime24(c: CheckView, now: number): string {
  const since = (now - new Date(c.changedAt).getTime()) / 3_600_000;
  if (c.status === "OK") return since >= 24 ? "100%" : "—";
  if (c.status === "CRIT" && since < 24) return `≈${(((24 - since) / 24) * 100).toFixed(1)}%`;
  return "—";
}

export function ProHome({ initial, tenants, server, commit }: MobileHomeProps) {
  const { data: s } = useLiveMonitor(initial);
  const n = useHostNumbers(s, server);
  const sr = s?.series;
  const services = (s?.checks ?? []).filter(isService).sort((a, b) => RANK[a.status] - RANK[b.status] || a.target.localeCompare(b.target));
  const okN = services.filter((c) => c.status === "OK").length;
  const b = backupOf(s);
  const [menu, setMenu] = useState<CheckView | null>(null);
  const [now, setNow] = useState(0);
  useEffect(() => { setNow(Date.now()); const t = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(t); }, []);
  const down = tenants.filter((t) => t.status === "ACTIVE" && (t.up === false || t.dbOk === false));
  const res: [string, string, string, number[], number | undefined, string][] = [
    ["CPU", n.cpu != null ? String(n.cpu) : "—", "%", sr?.cpu ?? [], 100, n.cpu != null ? tone(n.cpu, 75, 90) : ""],
    ["RAM", String(n.ram), "%", sr?.mem ?? [], 100, tone(n.ram, 80, 92)],
    ["DSK", n.disk != null ? String(n.disk) : "—", "%", sr?.disk ?? [], 100, n.disk != null ? tone(n.disk, 80, 90) : ""],
    ["LOAD", n.load[0].toFixed(2), "", sr?.load ?? [], undefined, ""],
  ];
  return (
    <div className="m5">
      <h1 className="sa-sr">Platforma holati</h1>
      <div className="m5-res" role="list" aria-label="Server resurslari">
        {res.map(([k, v, u, vals, max, t]) => (
          <Link key={k} href="/superadmin/monitoring" role="listitem" className={t} aria-label={`${k} ${v}${u}`}>
            <span>{k}</span><b>{v}<small>{u}</small></b><Spark values={vals.slice(-48)} max={max} />
          </Link>
        ))}
      </div>

      {down.length > 0 && (
        <div className="m5-alert" role="alert"><b>CRIT</b> {down.map((t) => `${t.name}: ${t.up === false ? "veb" : "baza"} ishlamayapti`).join(" · ")}</div>
      )}

      <div className="m5-cap"><div className="inline-flex items-center gap-1">Xizmatlar<HelpButton topic="mobile:pro" /></div> <span>{okN}/{services.length} · javob · up 24s</span></div>
      {services.length === 0 ? <p className="m5-empty">Tekshiruv natijasi yo&apos;q — insof-agent ishga tushgach chiqadi.</p> : (
        <div className="m5-tbl" role="table" aria-label="Xizmatlar: holat, javob vaqti, 24 soatlik uptime">
          <div className="m5-tr m5-th" role="row">
            <span role="columnheader">Xizmat</span><span role="columnheader" className="c">Hol.</span><span role="columnheader" className="r">ms</span><span role="columnheader" className="r">Up 24s</span><span role="columnheader"><span className="sa-sr">Amal</span></span>
          </div>
          {services.map((c) => {
            const st = c.status === "OK" ? "ok" : c.status === "WARN" ? "warn" : c.status === "CRIT" ? "crit" : "unk";
            return (
              <div key={c.key} className={`m5-tr ${st === "crit" ? "bad" : ""}`} role="row">
                <span className="nm" role="cell"><span className={`sa-dot ${st === "unk" ? "" : st}`} aria-hidden /><span data-no-translit>{c.target}</span></span>
                <span role="cell" className={`m5-st ${st}`}>{c.status === "UNKNOWN" ? "?" : c.status}</span>
                <span role="cell" className="r">{c.latencyMs != null ? c.latencyMs : "—"}</span>
                <span role="cell" className="r" suppressHydrationWarning>{now ? uptime24(c, now) : "—"}</span>
                <span role="cell"><button type="button" className="m5-more" onClick={() => setMenu(c)} aria-haspopup="dialog" aria-label={`${c.target}: amallar menyusi`}><MoreHorizontal size={18} aria-hidden /></button></span>
              </div>
            );
          })}
        </div>
      )}

      <div className="m5-cap"><div className="inline-flex items-center gap-1">Ochiq hodisalar<HelpButton topic="inc:severity" /></div> <span>{s ? s.counts.open + s.counts.acked : 0}</span></div>
      {(s?.incidents.length ?? 0) === 0 ? <p className="m5-empty">Ochiq hodisa yo&apos;q.</p> : (
        <ul className="m5-incs">
          {s!.incidents.slice(0, 8).map((i) => (
            <li key={i.id}>
              <Link href={`/superadmin/hodisalar?id=${i.id}`} className="m5-ir">
                <span className={`m5-sv ${SEV_TONE[i.severity]}`}>{SEV_SHORT[i.severity]}</span>
                <span className="it">{i.title}</span>
                <span className="ag"><Ago iso={i.lastSeenAt} bare />{i.count > 1 ? ` ×${i.count}` : ""}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <footer className="m5-foot" data-no-translit>
        <span>{commit ?? "—"}</span>
        <span>{b ? `zaxira ${b.c.status}${typeof b.size === "number" ? ` ${bytes(b.size)}` : ""}` : "zaxira —"}</span>
        <span>up {n.uptime}</span>
      </footer>

      <ServiceMenu check={menu} onClose={() => setMenu(null)} />
    </div>
  );
}

/** Qator menyusi (⋯): mavjud xavfsiz amallar va havolalar. */
function ServiceMenu({ check: c, onClose }: { check: CheckView | null; onClose: () => void }) {
  const unit = c ? restartableUnit(c.key) : null;
  const logSource = c?.key.startsWith("unit:") ? c.key.slice(5) : null;
  return (
    <BottomSheet open={!!c} onClose={onClose} title={c ? c.target : ""} initialFocus="button.sa-sheet-x">
      {c && (
        <div className="grid gap-2">
          <code className="m5-cmd" data-no-translit>{c.kind} · {c.status}{c.latencyMs != null ? ` · ${c.latencyMs} ms` : ""}{c.message ? ` · ${c.message}` : ""}</code>
          <p className="sa-sub" style={{ margin: 0 }}>Holatda: <Ago iso={c.changedAt} bare /> · tekshirildi <Ago iso={c.checkedAt} /></p>
          <p className="sa-sub" style={{ margin: 0 }}><WithHelp checkKey={c.key}>Bu nima va qanday tuzatiladi?</WithHelp></p>
          <div className="m5-menu" role="group" aria-label="Xizmat amallari">
            {unit
              ? <ActionButton type="RESTART_UNIT" params={{ unit }} label="Qayta ishga tushirish" icon="restart" variant={c.status === "CRIT" ? "danger" : "secondary"} size="md" className="w-full justify-start" />
              : <p className="sa-sub" style={{ margin: 0 }}>Bu tekshiruv uchun qayta ishga tushirish amali yo&apos;q.</p>}
            {logSource && <Link href={`/superadmin/loglar?source=${encodeURIComponent(logSource)}`} className="sa-btn justify-start"><FileText size={16} aria-hidden /> Log · oxirgi qatorlar</Link>}
            <Link href="/superadmin/monitoring" className="sa-btn justify-start"><Activity size={16} aria-hidden /> Server va xizmatlar</Link>
          </div>
        </div>
      )}
    </BottomSheet>
  );
}
