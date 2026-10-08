import Link from "next/link";
import { ListChecks } from "lucide-react";
import { control } from "@/lib/control/db";
import { toActionView } from "@/lib/control/monitor/snapshot";
import { ACTION_TYPES } from "@/lib/control/monitor/contract";
import { ACTION_STATUS, actionLabel, dt, msBetween, type ActionStatusT } from "@/lib/control/monitor/shared";
import { EmptyState, Tabs } from "@/components/ui";
import { PageHeader } from "../../_ui";
import { ConnBadge, RefreshOn } from "../_monitor/live";
import { ActionOutput, ActionStatusBadge, ParamsText } from "../_monitor/bits";

export const metadata = { title: "Amallar" };
export const dynamic = "force-dynamic";

const STATUSES = Object.keys(ACTION_STATUS) as ActionStatusT[];

/** Amallar jurnali: panel navbatga qo'ygan va agent bajargan amallar — kim, qachon, qancha vaqt, natija. */
export default async function ActionsPage({ searchParams }: { searchParams: Promise<{ status?: string; type?: string }> }) {
  const sp = await searchParams;
  const status = STATUSES.includes(sp.status as ActionStatusT) ? (sp.status as ActionStatusT) : undefined;
  const type = (ACTION_TYPES as readonly string[]).includes(sp.type ?? "") ? sp.type : undefined;
  const [rows, counts] = await Promise.all([
    control.agentAction.findMany({
      where: { ...(status ? { status } : {}), ...(type ? { type } : {}) },
      orderBy: { requestedAt: "desc" }, take: 200,
      include: { incident: { select: { id: true, title: true } } },
    }),
    control.agentAction.groupBy({ by: ["status"], _count: { _all: true } }),
  ]);
  const ids = [...new Set(rows.map((r) => r.requestedById).filter((x): x is string => !!x))];
  const admins = ids.length ? await control.superAdmin.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true } }) : [];
  const names = new Map(admins.map((a) => [a.id, a.fullName]));
  const total = counts.reduce((s, c) => s + c._count._all, 0);
  const cnt = (s: ActionStatusT) => counts.find((c) => c.status === s)?._count._all ?? 0;
  const href = (s?: string) => `/superadmin/amallar${s ? `?status=${s}` : ""}${type ? `${s ? "&" : "?"}type=${type}` : ""}`;

  return (
    <div className="space-y-4">
      <RefreshOn what="actions" />
      <PageHeader title={<>Amallar <ConnBadge /></>} subtitle="Panel so'ragan va insof-agent bajargan amallar. Natija — agent yozgan stdout/stderr (oxirgi ~8 KB, sirlarsiz)." />
      <Tabs current={status ?? "all"} items={[
        { key: "all", label: "Hammasi", href: href(), count: total },
        ...STATUSES.map((s) => ({ key: s, label: ACTION_STATUS[s].label, href: href(s), count: cnt(s) })),
      ]} />
      {type && <p className="text-sm text-slate-600">Tur: <b>{actionLabel(type)}</b> · <Link href={href(status)} className="underline">filtrni olib tashlash</Link></p>}

      {rows.length === 0 ? (
        <EmptyState icon={ListChecks} title="Amal yo'q" text="«Server va xizmatlar» yoki «Hodisalar» sahifasidan amal so'ralganda shu yerda paydo bo'ladi." />
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => {
            const a = toActionView(r, names);
            return (
              <li key={a.id} className="rounded-(--radius-card) border border-slate-200/80 bg-white p-4 shadow-(--shadow-card)">
                <div className="flex flex-wrap items-center gap-2">
                  <ActionStatusBadge s={a.status} />
                  <Link href={`/superadmin/amallar?type=${a.type}`} className="font-medium text-slate-900 hover:underline">{actionLabel(a.type)}</Link>
                  <ParamsText params={a.params} />
                  <span className="ml-auto text-xs text-slate-500 tabular" data-no-translit>{dt(a.requestedAt)}</span>
                </div>
                <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                  <span>Kim: <b className="font-medium text-slate-700">{a.requestedBy ?? "agent (avtomatik)"}</b></span>
                  <span>Kutish: <span className="tabular">{msBetween(a.requestedAt, a.startedAt)}</span></span>
                  <span>Bajarilish: <span className="tabular">{msBetween(a.startedAt, a.finishedAt)}</span></span>
                  {r.incident && <span>Hodisa: <Link className="underline" href={`/superadmin/hodisalar?id=${r.incident.id}`}>{r.incident.title}</Link></span>}
                </div>
                <div className="mt-2"><ActionOutput output={a.output} open={a.status === "FAILED" || a.status === "REJECTED"} /></div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
