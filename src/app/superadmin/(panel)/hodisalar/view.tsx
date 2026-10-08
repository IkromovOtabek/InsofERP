"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Siren, Wrench, X } from "lucide-react";
import { Button, EmptyState, Select } from "@/components/ui";
import { PageHeader } from "../../_ui";
import { isActionType } from "@/lib/control/monitor/contract";
import {
  CATEGORY_LABEL, SOURCE_LABEL, actionLabel, dt,
  type ActionView, type IncidentView,
} from "@/lib/control/monitor/shared";
import { ConnBadge, RefreshOn } from "../_monitor/live";
import { AckButton, ActionButton, ResolveButton } from "../_monitor/action-dialog";
import { ActionOutput, ActionStatusBadge, Ago, IncidentStatusBadge, ParamsText, SeverityBadge } from "../_monitor/bits";
import { CheckHelpInline, HelpButton, PageHelp, WithHelp } from "../_help/help";

export type IncidentFull = IncidentView & {
  detail: unknown; resolvedAt: string | null; ackedAt: string | null; ackedBy: string | null; notifiedAt: string | null;
  tenant: { id: string; slug: string; name: string } | null; actions: ActionView[];
};
type Filters = { status: string; severity: string; category: string; source: string; tenant: string };

const STATUS_OPTS: [string, string][] = [["active", "Ochiq va ko'rilgan"], ["OPEN", "Ochiq"], ["ACKED", "Ko'rilgan"], ["RESOLVED", "Yopilgan"], ["all", "Hammasi"]];
const SEV_OPTS: [string, string][] = [["", "Barcha darajalar"], ["CRITICAL", "Kritik"], ["HIGH", "Yuqori"], ["MEDIUM", "O'rta"], ["LOW", "Past"], ["INFO", "Ma'lumot"]];

export function IncidentsView({ incidents, openId, filters, options }: {
  incidents: IncidentFull[]; openId: string | null; filters: Filters;
  options: { categories: string[]; sources: string[]; tenants: { slug: string; name: string }[] };
}) {
  const [sel, setSel] = useState<string | null>(openId);
  const form = useRef<HTMLFormElement>(null);
  const cur = incidents.find((i) => i.id === sel) ?? null;
  // ?id=… bilan filtrdan tashqari hodisa ham keladi — ro'yxatda emas, faqat tafsilot oynasida
  const shown = incidents.filter((i) => matches(i, filters));

  const select = (id: string | null) => {
    setSel(id);
    const u = new URL(window.location.href);
    if (id) u.searchParams.set("id", id); else u.searchParams.delete("id");
    window.history.replaceState(null, "", u);
  };

  return (
    <div className="space-y-4">
      <RefreshOn what="incidents" />
      <PageHeader title={<>Hodisalar <ConnBadge /> <PageHelp topic="page:hodisalar" /></>} subtitle="Monitoring, xavfsizlik skaneri va AI tahlili topgan muammolar. Bir xil muammo takrorlansa — yangi qator emas, hisoblagich oshadi." />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500" aria-label="Belgilar ma'nosi">
        <WithHelp topic="inc:severity">Daraja</WithHelp>
        <WithHelp topic="inc:status">Holat</WithHelp>
        <WithHelp topic="inc:source">Manba</WithHelp>
        <WithHelp topic="inc:category">Toifa</WithHelp>
        <WithHelp topic="inc:count">×N — takror</WithHelp>
        <WithHelp topic="inc:auto">Avtomatik yopilish va Telegram</WithHelp>
        <WithHelp topic="inc:filters">Filtrlar</WithHelp>
      </div>

      <form ref={form} method="get" className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap" aria-label="Hodisalar filtri">
        <FilterSelect name="status" label="Holat" value={filters.status} opts={STATUS_OPTS} onPick={() => form.current?.requestSubmit()} />
        <FilterSelect name="severity" label="Daraja" value={filters.severity} opts={SEV_OPTS} onPick={() => form.current?.requestSubmit()} />
        <FilterSelect name="category" label="Toifa" value={filters.category} opts={[["", "Barcha toifalar"], ...options.categories.map((c) => [c, CATEGORY_LABEL[c] ?? c] as [string, string])]} onPick={() => form.current?.requestSubmit()} />
        <FilterSelect name="source" label="Manba" value={filters.source} opts={[["", "Barcha manbalar"], ...options.sources.map((c) => [c, SOURCE_LABEL[c] ?? c] as [string, string])]} onPick={() => form.current?.requestSubmit()} />
        <FilterSelect name="tenant" label="Korxona" value={filters.tenant} opts={[["", "Barcha korxonalar"], ...options.tenants.map((t) => [t.slug, t.name] as [string, string])]} onPick={() => form.current?.requestSubmit()} />
        <noscript><Button type="submit" variant="secondary">Filtrlash</Button></noscript>
      </form>

      {shown.length === 0 ? (
        <EmptyState icon={Siren} title="Hodisa yo'q" text={filters.status === "active" ? "Hozir ochiq muammo yo'q. Agent o'rnatilmagan bo'lsa — PLATFORMA.md → Monitoring agenti." : "Tanlangan filtr bo'yicha hech narsa topilmadi."} />
      ) : (
        <ul className="divide-y divide-slate-100 overflow-hidden rounded-(--radius-card) border border-slate-200/80 bg-white shadow-(--shadow-card)">
          {shown.map((i) => (
            <li key={i.id}>
              <button type="button" onClick={() => select(i.id)} aria-haspopup="dialog"
                className={`flex w-full flex-col gap-1.5 px-4 py-3 text-left transition hover:bg-slate-50 sm:flex-row sm:items-center sm:gap-3 ${sel === i.id ? "bg-slate-50" : ""}`}>
                <span className="flex shrink-0 items-center gap-1.5"><SeverityBadge s={i.severity} /><IncidentStatusBadge s={i.status} /></span>
                <span className="min-w-0 flex-1 font-medium text-slate-900 [overflow-wrap:anywhere]">{i.title}</span>
                <span className="flex shrink-0 flex-wrap items-center gap-x-3 text-xs text-slate-500">
                  <span>{SOURCE_LABEL[i.source] ?? i.source} · {CATEGORY_LABEL[i.category] ?? i.category}</span>
                  {i.tenant && <span>{i.tenant.name}</span>}
                  {i.count > 1 && <span className="tabular">×{i.count}</span>}
                  <Ago iso={i.lastSeenAt} />
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {incidents.length >= 200 && <p className="text-xs text-slate-500">Eng muhim 200 tasi ko&apos;rsatildi — filtrni toraytiring.</p>}

      {cur && <Drawer i={cur} onClose={() => select(null)} />}
    </div>
  );
}

function matches(i: IncidentFull, f: Filters) {
  if (f.status === "active" && i.status === "RESOLVED") return false;
  if (!["active", "all"].includes(f.status) && i.status !== f.status) return false;
  return (!f.severity || i.severity === f.severity) && (!f.category || i.category === f.category) && (!f.source || i.source === f.source) && (!f.tenant || i.tenant?.slug === f.tenant);
}

function FilterSelect({ name, label, value, opts, onPick }: { name: string; label: string; value: string; opts: [string, string][]; onPick: () => void }) {
  return (
    <label className="block min-w-0 sm:w-48">
      <span className="sr-only">{label}</span>
      <Select name={name} defaultValue={value} onChange={onPick} aria-label={label}>{opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>
    </label>
  );
}

/** Tafsilot oynasi (o'ngdan chiqadi, telefonda butun ekran). */
function Drawer({ i, onClose }: { i: IncidentFull; onClose: () => void }) {
  const titleId = useId();
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !document.querySelector("[role=dialog][aria-modal=true]:not([data-drawer])")) onClose(); };
    document.addEventListener("keydown", onKey);
    box.current?.focus();
    return () => { document.removeEventListener("keydown", onKey); prev?.focus?.(); };
  }, [onClose, i.id]);

  const timeline = useMemo(() => {
    const ev: { at: string; text: React.ReactNode }[] = [{ at: i.firstSeenAt, text: "Birinchi marta aniqlandi" }];
    if (i.notifiedAt) ev.push({ at: i.notifiedAt, text: "Telegram ogohlantirishi yuborildi" });
    if (i.ackedAt) ev.push({ at: i.ackedAt, text: <>Ko&apos;rildi{i.ackedBy ? ` — ${i.ackedBy}` : ""}</> });
    for (const a of i.actions) {
      ev.push({ at: a.requestedAt, text: <>{actionLabel(a.type)} so&apos;raldi{a.requestedBy ? ` — ${a.requestedBy}` : ""}</> });
      if (a.finishedAt) ev.push({ at: a.finishedAt, text: <>{actionLabel(a.type)}: <ActionStatusBadge s={a.status} /></> });
    }
    if (i.count > 1 || i.lastSeenAt !== i.firstSeenAt) ev.push({ at: i.lastSeenAt, text: `Oxirgi marta ko'rildi (jami ${i.count} marta)` });
    if (i.resolvedAt) ev.push({ at: i.resolvedAt, text: "Yopildi" });
    return ev.sort((a, b) => a.at.localeCompare(b.at));
  }, [i]);

  const detail = i.detail as Record<string, unknown> | null;
  const resolution = detail && typeof detail === "object" ? (detail.resolution as { note?: string; byName?: string } | undefined) : undefined;
  const fixes = i.suggestedActions.filter((s) => isActionType(s.type));

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/45" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={box} data-drawer role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}
        className="flex h-full w-full flex-col overflow-y-auto bg-white shadow-(--shadow-pop) outline-none sm:max-w-xl">
        <div className="sticky top-0 z-10 flex items-start gap-3 border-b border-slate-200 bg-white px-5 py-4">
          <div className="min-w-0 flex-1">
            <div className="mb-1 flex flex-wrap items-center gap-1.5"><SeverityBadge s={i.severity} /><HelpButton topic="inc:severity" /><IncidentStatusBadge s={i.status} /><HelpButton topic="inc:status" /></div>
            <h2 id={titleId} className="text-base font-semibold text-slate-900 [overflow-wrap:anywhere]">{i.title}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Yopish" className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"><X size={18} /></button>
        </div>

        <div className="space-y-5 px-5 py-4">
          {i.status !== "RESOLVED" && (
            <div className="flex flex-wrap gap-2">
              {i.status === "OPEN" && <AckButton id={i.id} />}
              <ResolveButton id={i.id} />
            </div>
          )}
          <CheckHelpInline checkKey={i.key} />
          {resolution?.note && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900"><b>Yopish izohi{resolution.byName ? ` (${resolution.byName})` : ""}:</b> {resolution.note}</div>}

          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
            <dt className="text-slate-500"><WithHelp topic="inc:source">Manba</WithHelp></dt><dd>{SOURCE_LABEL[i.source] ?? i.source}</dd>
            <dt className="text-slate-500"><WithHelp topic="inc:category">Toifa</WithHelp></dt><dd>{CATEGORY_LABEL[i.category] ?? i.category}</dd>
            <dt className="text-slate-500">Korxona</dt><dd>{i.tenant ? <Link className="hover:underline" href={`/superadmin/korxonalar/${i.tenant.slug}`}>{i.tenant.name}</Link> : "—"}</dd>
            <dt className="text-slate-500">Kalit</dt><dd><code className="text-xs [overflow-wrap:anywhere]">{i.key}</code></dd>
            <dt className="text-slate-500"><WithHelp topic="inc:count">Takror</WithHelp></dt><dd className="tabular">{i.count} marta</dd>
          </dl>

          {fixes.length > 0 && i.status !== "RESOLVED" && (
            <section aria-label="Tavsiya etilgan tuzatishlar">
              <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-slate-900"><Wrench size={14} aria-hidden /> Tuzatish <HelpButton topic="inc:fix" /></h3>
              <div className="flex flex-wrap gap-2">
                {fixes.map((f, k) => <ActionButton key={k} type={f.type} params={f.params} incidentId={i.id} label={f.label ?? actionLabel(f.type)} icon="wrench" variant="primary" />)}
              </div>
            </section>
          )}

          <section aria-label="Vaqt chizig'i">
            <h3 className="mb-2 flex items-center gap-1 text-sm font-semibold text-slate-900">Vaqt chizig&apos;i <HelpButton topic="inc:timeline" /></h3>
            <ol className="relative space-y-2 border-l border-slate-200 pl-4">
              {timeline.map((e, k) => (
                <li key={k} className="text-sm">
                  <span aria-hidden className="absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-slate-400" />
                  <div className="text-xs text-slate-500 tabular" data-no-translit>{dt(e.at)}</div>
                  <div className="text-slate-800">{e.text}</div>
                </li>
              ))}
            </ol>
          </section>

          <section aria-label="Tafsilot">
            <h3 className="mb-2 flex items-center gap-1 text-sm font-semibold text-slate-900">Tafsilot <HelpButton topic="inc:detail" /></h3>
            {i.detail == null ? <p className="text-sm text-slate-500">—</p> : (
              <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-all rounded-lg border border-slate-200 bg-slate-50 p-3 font-mono text-[11px] leading-relaxed text-slate-800">{JSON.stringify(i.detail, null, 2)}</pre>
            )}
          </section>

          <section aria-label="Bog'liq amallar">
            <h3 className="mb-2 flex items-center gap-1 text-sm font-semibold text-slate-900">Bog&apos;liq amallar <HelpButton topic="act:status" /></h3>
            {i.actions.length === 0 ? <p className="text-sm text-slate-500">Hali amal bajarilmagan.</p> : (
              <ul className="space-y-3">
                {i.actions.map((a) => (
                  <li key={a.id} className="rounded-lg border border-slate-200 p-3">
                    <div className="mb-1 flex flex-wrap items-center gap-2 text-sm">
                      <ActionStatusBadge s={a.status} /><span className="font-medium">{actionLabel(a.type)}</span><ParamsText params={a.params} />
                    </div>
                    <div className="mb-1 text-xs text-slate-500">{a.requestedBy ?? "agent"} · <span data-no-translit>{dt(a.requestedAt)}</span></div>
                    <ActionOutput output={a.output} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
