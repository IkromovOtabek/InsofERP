import Link from "next/link";
import { Card, CardHeader, Empty } from "@/components/ui";
import { actionLabel, dt, msBetween, type ActionView } from "@/lib/control/monitor/shared";
import { ActionOutput, ActionStatusBadge, ParamsText } from "../_monitor/bits";

/** Shu bo'limga tegishli oxirgi amallar (kim, qachon, natija) — to'liq ro'yxat «Amallar» sahifasida. */
export function RecentActions({ actions, title = "Oxirgi amallar" }: { actions: ActionView[]; title?: string }) {
  return (
    <Card>
      <CardHeader title={title} action={<Link href="/superadmin/amallar" className="text-sm text-slate-600 underline-offset-2 hover:underline">Barcha amallar →</Link>} />
      {actions.length === 0 ? <Empty text="Hali amal so'ralmagan" /> : (
        <ul className="divide-y divide-slate-100">
          {actions.map((a) => (
            <li key={a.id} className="py-2.5">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <ActionStatusBadge s={a.status} />
                <span className="font-medium text-slate-900">{actionLabel(a.type)}</span>
                <ParamsText params={a.params} />
                <span className="ml-auto text-xs text-slate-500 tabular" data-no-translit>{dt(a.requestedAt)}</span>
              </div>
              <div className="mt-1 flex flex-wrap gap-x-4 text-xs text-slate-500">
                <span>Kim: <b className="font-medium text-slate-700">{a.requestedBy ?? "agent"}</b></span>
                <span>Bajarilish: <span className="tabular">{msBetween(a.startedAt, a.finishedAt)}</span></span>
              </div>
              <div className="mt-1.5"><ActionOutput output={a.output} open={a.status === "FAILED" || a.status === "REJECTED"} /></div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** Log dumi (sirlar agentda yashirilgan). */
export function LogTail({ lines, label }: { lines: string[]; label: string }) {
  if (!lines.length) return <span className="text-xs text-slate-400">log yo&apos;q</span>;
  return (
    <details className="text-xs">
      <summary className="cursor-pointer select-none text-slate-600 hover:text-slate-900">{label} ({lines.length} qator)</summary>
      <pre className="mt-1 max-h-72 overflow-auto whitespace-pre-wrap break-all rounded-lg border border-slate-200 bg-slate-50 p-3 font-mono text-[11px] leading-relaxed text-slate-800">{lines.join("\n")}</pre>
    </details>
  );
}
