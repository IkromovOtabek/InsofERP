"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Bot, CircleCheck, CircleAlert, CircleX, CircleHelp } from "lucide-react";
import { Badge } from "@/components/ui";
import {
  ACTION_STATUS, CHECK_STATUS, INCIDENT_STATUS, SEVERITY, dt, overall, since,
  type ActionStatusT, type AgentView, type CheckStatusT, type IncidentStatusT, type MonitorSnapshot, type SeverityT,
} from "@/lib/control/monitor/shared";
import { useLiveMonitor } from "./live";

/** Joriy vaqt (har 10 s yangilanadi) — "5 daq oldin" matnlari jonli bo'lsin. */
export function useNow(ms = 10_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(t); }, [ms]);
  return now;
}

/** "3 daq oldin" — server va brauzer soniyalari farq qilishi mumkin, shuning uchun gidratsiya ogohlantirishi o'chirilgan. */
export function Ago({ iso, bare, className }: { iso: string | null | undefined; bare?: boolean; className?: string }) {
  const now = useNow();
  const t = since(iso, now);
  return <time dateTime={iso ?? undefined} title={iso ? dt(iso) : undefined} className={className} suppressHydrationWarning>{bare ? t.replace(/ oldin$/, "") : t}</time>;
}

export const CheckBadge = ({ s }: { s: CheckStatusT }) => <Badge color={CHECK_STATUS[s].color}>{CHECK_STATUS[s].label}</Badge>;
export const SeverityBadge = ({ s }: { s: SeverityT }) => <Badge color={SEVERITY[s].color}>{SEVERITY[s].label}</Badge>;
export const IncidentStatusBadge = ({ s }: { s: IncidentStatusT }) => <Badge color={INCIDENT_STATUS[s].color}>{INCIDENT_STATUS[s].label}</Badge>;
export const ActionStatusBadge = ({ s }: { s: ActionStatusT }) => <Badge color={ACTION_STATUS[s]?.color ?? "slate"}>{ACTION_STATUS[s]?.label ?? s}</Badge>;

const STATUS_ICON = { OK: CircleCheck, WARN: CircleAlert, CRIT: CircleX, UNKNOWN: CircleHelp };
const STATUS_TEXT = { OK: "text-emerald-700", WARN: "text-amber-700", CRIT: "text-red-600", UNKNOWN: "text-slate-500" };
/** Holat ikonkasi + matn (rang yolg'iz ma'no tashimaydi). */
export function StatusIcon({ s, size = 16 }: { s: CheckStatusT; size?: number }) {
  const I = STATUS_ICON[s];
  return <I size={size} className={`shrink-0 ${STATUS_TEXT[s]}`} aria-label={CHECK_STATUS[s].label} role="img" />;
}

/** Agent holati: yashil — ishlayapti, qizil — "Agent javob bermayapti" (o'rnatish ko'rsatmasi bilan). */
export function AgentBadge({ agent }: { agent: AgentView | null }) {
  if (!agent) return <Badge color="slate">Agent o&apos;rnatilmagan</Badge>;
  if (agent.stale) return <Badge color="red">Agent javob bermayapti · <Ago iso={agent.lastSeenAt} /></Badge>;
  return <Badge color="green">Agent ishlayapti · <span data-no-translit>v{agent.version}</span></Badge>;
}

export function AgentHint({ agent }: { agent: AgentView | null }) {
  if (agent && !agent.stale) return null;
  return (
    <div role="alert" className="mb-4 flex gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      <Bot size={20} className="mt-0.5 shrink-0" aria-hidden />
      <div className="space-y-1">
        {!agent ? (
          <>
            <div className="font-semibold">insof-agent o&apos;rnatilmagan — ma&apos;lumot hali kelmagan</div>
            <p>Server metrikalari, tekshiruvlar va amallar serverdagi alohida <code>insof-agent</code> xizmati orqali ishlaydi. O&apos;rnatish: <b>docs/deploy/PLATFORMA.md → Monitoring agenti</b>.</p>
          </>
        ) : (
          <>
            <div className="font-semibold">Agent javob bermayapti (oxirgi signal: <Ago iso={agent.lastSeenAt} />)</div>
            <p>Ko&apos;rsatkichlar eskirgan, navbatdagi amallar bajarilmaydi. Serverda tekshiring: <code>sudo systemctl status insof-agent</code> va <code>journalctl -u insof-agent -n 50</code> (PLATFORMA.md → Monitoring agenti).</p>
          </>
        )}
      </div>
    </div>
  );
}

const OVERALL = {
  OK: { t: "Hammasi joyida", c: "border-emerald-200 bg-emerald-50 text-emerald-900" },
  WARN: { t: "E'tibor talab qiladi", c: "border-amber-200 bg-amber-50 text-amber-900" },
  CRIT: { t: "Muammo bor", c: "border-red-200 bg-red-50 text-red-900" },
  UNKNOWN: { t: "Monitoring ma'lumoti yo'q", c: "border-slate-200 bg-white text-slate-700" },
};

/** Bosh sahifadagi ixcham holat qatori — monitoringga havola. */
export function HealthStrip({ initial }: { initial: MonitorSnapshot | null }) {
  const { data } = useLiveMonitor(initial);
  const o = overall(data);
  const hot = data ? data.counts.critical + data.counts.high : 0;
  return (
    <Link href="/superadmin/monitoring" className={`flex flex-wrap items-center gap-x-4 gap-y-2 rounded-(--radius-card) border px-4 py-3 text-sm transition hover:shadow-md ${OVERALL[o].c}`}>
      <span className="flex items-center gap-2 font-semibold"><StatusIcon s={o} size={18} /> {OVERALL[o].t}</span>
      <span>Ochiq kritik/yuqori hodisa: <b className="tabular">{hot}</b>{data && data.counts.open + data.counts.acked > hot ? <span className="opacity-75"> (jami ochiq {data.counts.open + data.counts.acked})</span> : null}</span>
      <AgentBadge agent={data?.agent ?? null} />
      <span className="ml-auto text-xs underline-offset-2 hover:underline">Server va xizmatlar →</span>
    </Link>
  );
}

/** Agent chiqishi (stdout/stderr) — yig'iladigan, monospace. <pre> ichi kirillga o'girilmaydi. */
export function ActionOutput({ output, open }: { output: string | null; open?: boolean }) {
  if (!output) return <span className="text-xs text-slate-400">chiqish yo&apos;q</span>;
  const lines = output.split("\n").length;
  return (
    <details open={open} className="text-xs">
      <summary className="cursor-pointer select-none text-slate-600 hover:text-slate-900">Natija ({lines} qator)</summary>
      <pre className="mt-1 max-h-72 overflow-auto whitespace-pre-wrap break-all rounded-lg border border-slate-200 bg-slate-50 p-3 font-mono text-[11px] leading-relaxed text-slate-800">{output}</pre>
    </details>
  );
}

export function ParamsText({ params }: { params: Record<string, unknown> }) {
  const e = Object.entries(params);
  if (!e.length) return <span className="text-slate-400">—</span>;
  return <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs [overflow-wrap:anywhere]">{e.map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`).join(" ")}</code>;
}
