import Link from "next/link";
import type { CrmResultGroup, Prisma } from "@/generated/prisma";
import { Badge, Card, EmptyState, PageHeader, Tabs } from "@/components/ui";
import { db } from "@/lib/db";
import { requirePage } from "@/lib/page-guard";
import { canDo } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { money } from "@/lib/format";
import { crmUsers } from "@/lib/crm/clients";
import { dbToIso, fullIso, isoToDb, period, shortIso, todayIso } from "@/lib/crm/dates";
import { GROUP_COLOR, RESULT_SECTIONS } from "@/lib/crm/labels";
import { FilterSelect } from "../mijozlar/filters";
import { PeriodForm } from "../voronka/period-form";

const LIMIT = 300;
type SP = { davr?: string; dan?: string; gacha?: string; xodim?: string; guruh?: string };

/** Aloqalar jurnali (CRM_SPEC 4.5, 5 — «📝 Aloqalar»): operator — o'z aloqalari, menejer — hammasi (xodim filtri, bekor qilinganlar ham). */
export default async function ContactsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const s = await requirePage("/crm/aloqalar");
  const sp = await searchParams;
  const manager = canDo(s, "crm", "manage");
  const today = todayIso();
  const per = period(sp, today);
  const section = RESULT_SECTIONS.find((x) => x.label === sp.guruh);
  const where: Prisma.CrmContactWhereInput = {
    date: { gte: isoToDb(per.from), lte: isoToDb(per.to) },
    ...(manager ? (sp.xodim ? { userId: sp.xodim } : {}) : { userId: s.userId, cancelledAt: null }),
    ...(sp.guruh === "Natijasiz" ? { resultId: null } : section ? { result: { group: { in: section.groups as CrmResultGroup[] } } } : {}),
  };
  const [rows, total, users] = await Promise.all([
    db.crmContact.findMany({
      where, orderBy: [{ date: "desc" }, { createdAt: "desc" }], take: LIMIT,
      select: {
        id: true, date: true, note: true, offeredPrice: true, nextContactDate: true, cancelledAt: true,
        customer: { select: { id: true, name: true } }, result: { select: { label: true, group: true } },
        channel: { select: { label: true } }, user: { select: { fullName: true } },
      },
    }),
    db.crmContact.count({ where }),
    manager ? crmUsers() : [],
  ]);

  const q = (extra: Partial<SP>) => {
    const base: SP = { davr: per.key === "bugun" ? undefined : per.key, dan: per.key === "tanlov" ? per.from : undefined, gacha: per.key === "tanlov" ? per.to : undefined, xodim: sp.xodim, guruh: sp.guruh };
    const p = new URLSearchParams(Object.entries({ ...base, ...extra }).filter((e): e is [string, string] => !!e[1]));
    return `/crm/aloqalar${p.size ? `?${p}` : ""}`;
  };
  const groups = ["Hammasi", ...RESULT_SECTIONS.map((x) => x.label), "Natijasiz"];

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Aloqalar" back={false} subtitle={`${per.from === per.to ? fullIso(per.from) : `${fullIso(per.from)} — ${fullIso(per.to)}`} · ${total} ta${manager ? "" : " (mening)"}`} />
      <Tabs current={per.key} scroll={false} className="mb-3" items={[
        { key: "bugun", label: "Bugun", href: q({ davr: undefined, dan: undefined, gacha: undefined }) },
        { key: "hafta", label: "Hafta", href: q({ davr: "hafta", dan: undefined, gacha: undefined }) },
        { key: "oy", label: "Oy", href: q({ davr: "oy", dan: undefined, gacha: undefined }) },
        { key: "tanlov", label: "O'zim tanlayman", href: q({ davr: "tanlov", dan: per.from, gacha: per.to }) },
      ]} />
      <div className="mb-3 flex flex-wrap items-end gap-2">
        {per.key === "tanlov" && <PeriodForm from={per.from} to={per.to} xodim={sp.xodim} />}
        {manager && <FilterSelect name="xodim" value={sp.xodim ?? ""} placeholder="Barcha xodimlar" options={users.map((u) => ({ id: u.id, label: u.fullName }))} />}
      </div>
      <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
        {groups.map((g) => {
          const on = (sp.guruh ?? "Hammasi") === g;
          return (
            <Link key={g} href={q({ guruh: g === "Hammasi" ? undefined : g })} scroll={false} aria-current={on ? "page" : undefined}
              className={cn("inline-flex min-h-10 shrink-0 items-center rounded-full border px-3.5 text-[13px] font-medium", on ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-600")}>
              {g}
            </Link>
          );
        })}
      </div>

      {rows.length === 0 ? <EmptyState title="Bu davrda aloqa yo'q" /> : (
        <Card padded={false}>
          <ul className="divide-y divide-slate-100">
            {rows.map((x) => (
              <li key={x.id} className={cn(x.cancelledAt && "opacity-50")}>
                <Link href={`/crm/mijozlar/${x.customer.id}`} className="block px-4 py-3 hover:bg-slate-50">
                  <div className="flex items-start justify-between gap-2">
                    <span className="min-w-0 truncate font-medium text-slate-900">{x.customer.name}</span>
                    <span className="shrink-0 text-xs tabular text-slate-500">{shortIso(dbToIso(x.date), today)}</span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-slate-500">
                    {x.result ? <Badge color={GROUP_COLOR[x.result.group]}>{x.result.label}</Badge> : <Badge>Natija yo'q</Badge>}
                    {x.cancelledAt && <Badge color="red" dot={false}>Bekor qilingan</Badge>}
                    <span>{[x.channel?.label, manager ? x.user.fullName : null, x.offeredPrice ? money(x.offeredPrice) : null].filter(Boolean).join(" · ")}</span>
                    {x.nextContactDate && <span className="text-slate-700">→ {shortIso(dbToIso(x.nextContactDate), today)}</span>}
                  </div>
                  {x.note && <p className="mt-1 line-clamp-2 whitespace-pre-line text-sm text-slate-700">{x.note}</p>}
                </Link>
              </li>
            ))}
          </ul>
          {total > LIMIT && <p className="border-t border-slate-100 px-4 py-3 text-center text-sm text-slate-500">Yana {total - LIMIT} ta — davrni qisqartiring</p>}
        </Card>
      )}
    </div>
  );
}
