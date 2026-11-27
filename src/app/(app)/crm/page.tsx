import Link from "next/link";
import { MessageCircle, Phone } from "lucide-react";
import { Badge, Card, EmptyState, PageHeader, Tabs } from "@/components/ui";
import { requirePage } from "@/lib/page-guard";
import { canDo } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { formatPhone } from "@/lib/phone";
import { crmUsers, telLink } from "@/lib/crm/clients";
import { fullIso, shortIso } from "@/lib/crm/dates";
import { STATUS_COLOR, STATUS_LABEL, T } from "@/lib/crm/labels";
import { todayList, type TodayBucket } from "@/lib/crm/today";
import { FilterSelect } from "./mijozlar/filters";

const VIEWS = ["now", "overdue", "today", "tomorrow", "later"] as const;
type View = (typeof VIEWS)[number];

/** Bosh ekran (CRM_SPEC 5.1): bugun kimga qo'ng'iroq qilish kerak. Operator — o'z mijozlari (xohlasa hammasi), menejer — hammasi, xodim filtri bilan. */
export default async function CrmToday({ searchParams }: { searchParams: Promise<{ v?: string; kim?: string; xodim?: string }> }) {
  const s = await requirePage("/crm");
  const sp = await searchParams;
  const manager = canDo(s, "crm", "manage");
  const view: View = (VIEWS as readonly string[]).includes(sp.v ?? "") ? (sp.v as View) : "now";
  const mineOnly = manager ? false : sp.kim !== "hammasi";
  const ownerId = mineOnly ? s.userId : manager && sp.xodim ? sp.xodim : null;
  const [{ today, rows, counts }, users] = await Promise.all([todayList({ ownerId }), manager ? crmUsers() : []]);
  const shown = rows.filter((r) => (view === "now" ? r.bucket === "overdue" || r.bucket === "today" : r.bucket === view));
  const canWrite = canDo(s, "crm", "contact");

  const href = (v: View, kim = sp.kim) => {
    const p = new URLSearchParams(Object.entries({ v: v === "now" ? undefined : v, kim, xodim: sp.xodim }).filter((e): e is [string, string] => !!e[1]));
    return `/crm${p.size ? `?${p}` : ""}`;
  };
  const chips: { key: View; label: string; n: number; tone: string }[] = [
    { key: "overdue", label: T.today.overdue, n: counts.overdue, tone: "border-red-200 bg-red-50 text-red-700" },
    { key: "today", label: T.today.today, n: counts.today, tone: "border-blue-200 bg-blue-50 text-blue-700" },
    { key: "tomorrow", label: T.today.tomorrow, n: counts.tomorrow, tone: "border-slate-200 bg-white text-slate-600" },
    { key: "later", label: T.today.later, n: counts.later, tone: "border-slate-200 bg-white text-slate-600" },
  ];

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title={T.today.title} back={false} subtitle={`${fullIso(today)} · ${T.today.count(counts.overdue + counts.today)}`} />

      {!manager && (
        <Tabs current={mineOnly ? "mine" : "all"} scroll={false} className="mb-3" items={[
          { key: "mine", label: T.today.mine, href: href(view, undefined) },
          { key: "all", label: T.today.all, href: href(view, "hammasi") },
        ]} />
      )}
      {manager && (
        <div className="mb-3 flex">
          <FilterSelect name="xodim" value={sp.xodim ?? ""} placeholder={T.clients.allOwners} options={users.map((u) => ({ id: u.id, label: u.fullName }))} />
        </div>
      )}

      <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
        {chips.map((c) => {
          const on = view === c.key || (view === "now" && (c.key === "overdue" || c.key === "today"));
          return (
            <Link key={c.key} href={view === c.key ? href("now") : href(c.key)} scroll={false} aria-current={view === c.key ? "page" : undefined}
              className={cn("inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-[13px] font-semibold transition", c.tone, on ? "ring-2 ring-current/30" : "opacity-70")}>
              {c.label} <span className="tabular">· {c.n}</span>
            </Link>
          );
        })}
      </div>

      {shown.length === 0 ? <EmptyState title={view === "now" ? T.today.empty : T.today.emptyOther} /> : (
        <Card padded={false}>
          <ul className="divide-y divide-slate-100">
            {shown.map((r) => {
              const tel = telLink(r.phone);
              return (
                <li key={r.id} className="flex items-stretch">
                  <Link href={`/crm/mijozlar/${r.id}`} className="min-w-0 flex-1 px-4 py-3 transition hover:bg-slate-50">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium text-slate-900">{r.name}</span>
                      <Badge color={STATUS_COLOR[r.status]}>{STATUS_LABEL[r.status]}</Badge>
                    </div>
                    <div className="mt-0.5 truncate text-[13px] text-slate-500">{[r.phone ? formatPhone(r.phone) : null, r.owner].filter(Boolean).join(" · ")}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 text-[13px]">
                      <DueLabel bucket={r.bucket} next={r.next} today={today} />
                      {(r.lastLabel || r.lastNote) && <span className="min-w-0 truncate text-slate-500">{T.today.lastNote}: {[r.lastLabel, r.lastNote].filter(Boolean).join(" — ")}</span>}
                    </div>
                  </Link>
                  <div className="flex shrink-0 items-center gap-1.5 pr-3">
                    {canWrite && (
                      <Link href={`/crm/mijozlar/${r.id}/aloqa?back=bugun`} aria-label={`${T.card.writeContact}: ${r.name}`}
                        className="flex h-11 w-11 items-center justify-center rounded-full border border-slate-200 text-slate-600 hover:bg-slate-50">
                        <MessageCircle size={18} />
                      </Link>
                    )}
                    {tel && (
                      <a href={tel} aria-label={`${T.card.call}: ${r.name}`} className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500 text-white shadow-sm hover:bg-emerald-600">
                        <Phone size={20} />
                      </a>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </div>
  );
}

function DueLabel({ bucket, next, today }: { bucket: TodayBucket; next: string; today: string }) {
  if (bucket === "overdue") return <span className="font-medium text-red-600">{T.today.overdueAt(shortIso(next, today))}</span>;
  if (bucket === "today") return <span className="font-medium text-blue-700">{T.today.today}</span>;
  if (bucket === "tomorrow") return <span className="font-medium text-slate-700">{T.today.tomorrow}</span>;
  return <span className="font-medium text-slate-700">{shortIso(next, today)}</span>;
}
