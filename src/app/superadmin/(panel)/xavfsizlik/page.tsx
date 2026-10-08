import Link from "next/link";
import { Ban, History, ShieldAlert, ShieldCheck } from "lucide-react";
import { control } from "@/lib/control/db";
import { isActionType } from "@/lib/control/monitor/contract";
import { CATEGORY_LABEL, SEVERITY, SOURCE_LABEL, actionLabel, dt, type SeverityT } from "@/lib/control/monitor/shared";
import { Badge, Card, CardHeader, EmptyState } from "@/components/ui";
import { PageHeader } from "../../_ui";
import { ConnBadge, RefreshOn } from "../_monitor/live";
import { ActionButton } from "../_monitor/action-dialog";
import { Ago, IncidentStatusBadge, SeverityBadge } from "../_monitor/bits";

export const metadata = { title: "Kiberxavfsizlik" };
export const dynamic = "force-dynamic";

type Item = { title: string; severity: SeverityT; why: string; fix: string; actionType: string | null; params: Record<string, unknown> };

function items(v: unknown): Item[] {
  if (!Array.isArray(v)) return [];
  const sev = (s: unknown): SeverityT => {
    const u = String(s ?? "").toUpperCase();
    return (u in SEVERITY ? u : u === "CRIT" ? "CRITICAL" : "MEDIUM") as SeverityT;
  };
  return v.flatMap((x) => {
    if (!x || typeof x !== "object") return [];
    const o = x as Record<string, unknown>;
    return [{
      title: String(o.title ?? "—"), severity: sev(o.severity), why: String(o.why ?? ""), fix: String(o.fix ?? ""),
      actionType: typeof o.actionType === "string" && isActionType(o.actionType) ? o.actionType : null,
      params: o.params && typeof o.params === "object" && !Array.isArray(o.params) ? (o.params as Record<string, unknown>) : {},
    }];
  }).sort((a, b) => SEVERITY[b.severity].rank - SEVERITY[a.severity].rank);
}

const GRADE: Record<string, string> = {
  A: "bg-emerald-50 text-emerald-700 ring-emerald-200", B: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  C: "bg-amber-50 text-amber-700 ring-amber-200", D: "bg-red-50 text-red-700 ring-red-200",
  E: "bg-red-50 text-red-700 ring-red-200", F: "bg-red-100 text-red-800 ring-red-300",
};
const gradeCls = (g: string) => GRADE[g.trim().toUpperCase().charAt(0)] ?? "bg-slate-100 text-slate-700 ring-slate-200";

/** Kiberxavfsizlik: AI hisobot (baho A–F), ustuvor tavsiyalar, xavfsizlik hodisalari, bloklangan IP'lar. */
export default async function SecurityPage() {
  const [reports, incidents, ipActions] = await Promise.all([
    control.securityReport.findMany({ orderBy: { createdAt: "desc" }, take: 20 }),
    control.incident.findMany({
      where: { OR: [{ source: { in: ["security", "ai"] } }, { category: "security" }], status: { in: ["OPEN", "ACKED"] } },
      orderBy: [{ severity: "desc" }, { lastSeenAt: "desc" }], take: 200,
      select: { id: true, title: true, severity: true, status: true, category: true, source: true, count: true, lastSeenAt: true },
    }),
    control.agentAction.findMany({ where: { type: { in: ["BLOCK_IP", "UNBLOCK_IP"] }, status: "DONE" }, orderBy: [{ finishedAt: "asc" }, { requestedAt: "asc" }] }),
  ]);
  const latest = reports[0] ?? null;
  const its = latest ? items(latest.items) : [];

  // Bloklangan IP'lar: bajarilgan BLOCK_IP lardan keyingi UNBLOCK_IP larni ayiramiz
  const blocked = new Map<string, { at: Date; by: string | null; incidentId: string | null }>();
  for (const a of ipActions) {
    const ip = (a.params as { ip?: unknown })?.ip;
    if (typeof ip !== "string") continue;
    if (a.type === "BLOCK_IP") blocked.set(ip, { at: a.finishedAt ?? a.requestedAt, by: a.requestedById, incidentId: a.incidentId });
    else blocked.delete(ip);
  }
  const byIds = [...new Set([...blocked.values()].map((b) => b.by).filter((x): x is string => !!x))];
  const admins = byIds.length ? await control.superAdmin.findMany({ where: { id: { in: byIds } }, select: { id: true, fullName: true } }) : [];
  const names = new Map(admins.map((a) => [a.id, a.fullName]));

  const groups = new Map<string, typeof incidents>();
  for (const i of incidents) groups.set(i.category, [...(groups.get(i.category) ?? []), i]);

  return (
    <div className="space-y-6">
      <RefreshOn what="security" />
      <PageHeader
        title={<>Kiberxavfsizlik <ConnBadge /></>}
        subtitle="Xavfsizlik skaneri topilmalari va AI tahlili. Tuzatish tugmalari faqat oq ro'yxatdagi amallarni agent navbatiga qo'yadi."
        action={
          <div className="flex flex-wrap gap-2">
            <ActionButton type="RUN_SECURITY_SCAN" label="Xavfsizlik skanerini ishga tushirish" icon="scan" />
            <ActionButton type="RUN_AI_ANALYSIS" label="AI tahlilni hozir boshlash" icon="bot" variant="primary" />
          </div>
        }
      />

      {!latest ? (
        <EmptyState icon={ShieldCheck} title="Hali AI hisobot yo'q" text="«AI tahlilni hozir boshlash» ni bosing yoki rejalashtirilgan tahlilni kuting. Agent o'rnatilmagan bo'lsa — PLATFORMA.md → Monitoring agenti." />
      ) : (
        <Card>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
            <div className={`flex h-24 w-24 shrink-0 flex-col items-center justify-center rounded-2xl ring-2 ring-inset ${gradeCls(latest.grade)}`} role="img" aria-label={`Umumiy baho: ${latest.grade}`}>
              <span className="text-5xl font-bold leading-none" data-no-translit>{latest.grade}</span>
              <span className="mt-1 text-[11px] font-medium">baho</span>
            </div>
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                <span data-no-translit>{dt(latest.createdAt.toISOString())}</span>
                <Badge color={latest.trigger === "manual" ? "violet" : "slate"}>{latest.trigger === "manual" ? "Qo'lda" : "Rejali"}</Badge>
                <code className="text-[11px]">{latest.model}</code>
              </div>
              <p className="whitespace-pre-line text-sm text-slate-800">{latest.summary}</p>
            </div>
          </div>
          {its.length > 0 && (
            <ol className="mt-5 space-y-3">
              {its.map((it, k) => (
                <li key={k} className="rounded-lg border border-slate-200 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-semibold text-slate-400 tabular">{k + 1}.</span>
                    <SeverityBadge s={it.severity} />
                    <span className="min-w-0 flex-1 font-medium text-slate-900 [overflow-wrap:anywhere]">{it.title}</span>
                    {it.actionType && <ActionButton type={it.actionType} params={it.params} label={`Tuzatish: ${actionLabel(it.actionType)}`} icon="wrench" variant="primary" />}
                  </div>
                  {it.why && <p className="mt-1.5 text-sm text-slate-600"><b className="font-medium text-slate-700">Nega xavfli:</b> {it.why}</p>}
                  {it.fix && <p className="mt-1 text-sm text-slate-600"><b className="font-medium text-slate-700">Nima qilish kerak:</b> {it.fix}</p>}
                </li>
              ))}
            </ol>
          )}
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Xavfsizlik hodisalari" description="Ochiq va ko'rilgan — toifa bo'yicha" icon={ShieldAlert} action={<Link href="/superadmin/hodisalar?source=security" className="text-sm font-medium text-slate-600 hover:underline">Hodisalar →</Link>} />
          {incidents.length === 0 ? <p className="text-sm text-slate-500">Ochiq xavfsizlik hodisasi yo&apos;q.</p> : (
            <div className="space-y-4">
              {[...groups].map(([cat, list]) => (
                <section key={cat} aria-label={CATEGORY_LABEL[cat] ?? cat}>
                  <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-slate-500">{CATEGORY_LABEL[cat] ?? cat} · {list.length}</h3>
                  <ul className="divide-y divide-slate-100">
                    {list.map((i) => (
                      <li key={i.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                        <SeverityBadge s={i.severity} /><IncidentStatusBadge s={i.status} />
                        <Link href={`/superadmin/hodisalar?id=${i.id}`} className="min-w-0 flex-1 basis-48 hover:underline [overflow-wrap:anywhere]">{i.title}</Link>
                        <span className="text-xs text-slate-500">{SOURCE_LABEL[i.source] ?? i.source}{i.count > 1 ? ` · ×${i.count}` : ""} · <Ago iso={i.lastSeenAt.toISOString()} /></span>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </Card>

        <Card>
          <CardHeader title="Bloklangan IP'lar" icon={Ban} action={<ActionButton type="BLOCK_IP" label="IP bloklash" icon="ban" variant="danger" />} />
          {blocked.size === 0 ? <p className="text-sm text-slate-500">Bloklangan manzil yo&apos;q.</p> : (
            <ul className="divide-y divide-slate-100">
              {[...blocked].map(([ip, b]) => (
                <li key={ip} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                  <div className="min-w-0">
                    <code className="font-medium">{ip}</code>
                    <div className="text-xs text-slate-500"><span data-no-translit>{dt(b.at.toISOString())}</span>{b.by ? ` · ${names.get(b.by) ?? "admin"}` : " · agent"}{b.incidentId ? <> · <Link className="underline" href={`/superadmin/hodisalar?id=${b.incidentId}`}>hodisa</Link></> : null}</div>
                  </div>
                  <ActionButton type="UNBLOCK_IP" params={{ ip }} label="Blokdan chiqarish" />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card>
        <CardHeader title="Hisobotlar tarixi" icon={History} />
        {reports.length === 0 ? <p className="text-sm text-slate-500">Hisobot yo&apos;q.</p> : (
          <ul className="divide-y divide-slate-100">
            {reports.map((r) => (
              <li key={r.id} className="flex items-start gap-3 py-2 text-sm">
                <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-sm font-bold ring-1 ring-inset ${gradeCls(r.grade)}`} data-no-translit aria-label={`Baho ${r.grade}`}>{r.grade}</span>
                <div className="min-w-0 flex-1">
                  <div className="text-xs text-slate-500"><span data-no-translit>{dt(r.createdAt.toISOString())}</span> · {r.trigger === "manual" ? "qo'lda" : "rejali"} · {Array.isArray(r.items) ? r.items.length : 0} ta tavsiya</div>
                  <p className="line-clamp-2 text-slate-700">{r.summary}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
