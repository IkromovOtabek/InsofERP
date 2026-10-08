"use client";

import { useEffect, useState } from "react";
import { Bot, CircleCheck, CircleAlert, CircleX, CircleHelp } from "lucide-react";
import { Dot, Tag, tagFromColor, type TagTone } from "../../_ui";
import {
  ACTION_STATUS, CHECK_STATUS, INCIDENT_STATUS, SEVERITY, dt, since,
  type ActionStatusT, type AgentView, type CheckStatusT, type IncidentStatusT, type SeverityT,
} from "@/lib/control/monitor/shared";
import { HelpButton } from "../_help/help";

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

/* Holat teglari — Status Board `Tag` (rang + matn; kritik — to'liq qizil). */
const SEV_TONE: Record<SeverityT, TagTone> = { CRITICAL: "crit", HIGH: "high", MEDIUM: "warn", LOW: "info", INFO: "mut" };
export const CheckBadge = ({ s }: { s: CheckStatusT }) => <Tag tone={tagFromColor(CHECK_STATUS[s].color)}>{CHECK_STATUS[s].label}</Tag>;
export const SeverityBadge = ({ s }: { s: SeverityT }) => <Tag tone={SEV_TONE[s]}>{SEVERITY[s].label}</Tag>;
export const IncidentStatusBadge = ({ s }: { s: IncidentStatusT }) => <Tag tone={s === "OPEN" ? "high" : tagFromColor(INCIDENT_STATUS[s].color)}>{INCIDENT_STATUS[s].label}</Tag>;
export const ActionStatusBadge = ({ s }: { s: ActionStatusT }) => <Tag tone={tagFromColor(ACTION_STATUS[s]?.color ?? "slate")}>{ACTION_STATUS[s]?.label ?? s}</Tag>;

const STATUS_ICON = { OK: CircleCheck, WARN: CircleAlert, CRIT: CircleX, UNKNOWN: CircleHelp };
const STATUS_TEXT = { OK: "text-emerald-600", WARN: "text-amber-600", CRIT: "text-red-600", UNKNOWN: "text-slate-500" };
/** Holat ikonkasi + matn (rang yolg'iz ma'no tashimaydi). */
export function StatusIcon({ s, size = 16 }: { s: CheckStatusT; size?: number }) {
  const I = STATUS_ICON[s];
  return <I size={size} className={`shrink-0 ${STATUS_TEXT[s]}`} aria-label={CHECK_STATUS[s].label} role="img" />;
}

/** Agent holati: yashil — ishlayapti, qizil — "Agent javob bermayapti" (o'rnatish ko'rsatmasi bilan). */
export function AgentBadge({ agent }: { agent: AgentView | null }) {
  if (!agent) return <Tag tone="mut"><Dot tone="unk" /> Agent o&apos;rnatilmagan</Tag>;
  if (agent.stale) return <Tag tone="crit">Agent javob bermayapti · <Ago iso={agent.lastSeenAt} /></Tag>;
  return <Tag tone="ok"><Dot tone="ok" live /> Agent ishlayapti · <span data-no-translit>v{agent.version}</span></Tag>;
}

export function AgentHint({ agent }: { agent: AgentView | null }) {
  if (agent && !agent.stale) return null;
  return (
    <div role="alert" className="mb-4 flex gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      <Bot size={20} className="mt-0.5 shrink-0" aria-hidden />
      <div className="space-y-1">
        {!agent ? (
          <>
            <div className="font-semibold">insof-agent o&apos;rnatilmagan — ma&apos;lumot hali kelmagan <HelpButton topic="agent:status" /></div>
            <p>Server metrikalari, tekshiruvlar va amallar serverdagi alohida <code>insof-agent</code> xizmati orqali ishlaydi. O&apos;rnatish: <b>docs/deploy/PLATFORMA.md → Monitoring agenti</b>.</p>
          </>
        ) : (
          <>
            <div className="font-semibold">Agent javob bermayapti (oxirgi signal: <Ago iso={agent.lastSeenAt} />) <HelpButton topic="agent:status" /></div>
            <p>Ko&apos;rsatkichlar eskirgan, navbatdagi amallar bajarilmaydi. Serverda tekshiring: <code>sudo systemctl status insof-agent</code> va <code>journalctl -u insof-agent -n 50</code> (PLATFORMA.md → Monitoring agenti).</p>
          </>
        )}
      </div>
    </div>
  );
}

/** Agent chiqishi (stdout/stderr) — yig'iladigan, monospace. <pre> ichi kirillga o'girilmaydi. */
export function ActionOutput({ output, open }: { output: string | null; open?: boolean }) {
  if (!output) return <span className="text-xs text-slate-400">chiqish yo&apos;q</span>;
  const lines = output.split("\n").length;
  return (
    <details open={open} className="text-xs">
      <summary className="cursor-pointer select-none text-slate-600 hover:text-slate-900">Natija ({lines} qator) <HelpButton topic="act:output" /></summary>
      <pre className="mt-1 max-h-72 overflow-auto whitespace-pre-wrap break-all rounded-lg border border-slate-200 bg-slate-50 p-3 font-mono text-[11px] leading-relaxed text-slate-800">{output}</pre>
    </details>
  );
}

export function ParamsText({ params }: { params: Record<string, unknown> }) {
  const e = Object.entries(params);
  if (!e.length) return <span className="text-slate-400">—</span>;
  return <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs [overflow-wrap:anywhere]">{e.map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`).join(" ")}</code>;
}
