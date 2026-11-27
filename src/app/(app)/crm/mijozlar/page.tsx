import Link from "next/link";
import { ChevronRight, FileSpreadsheet, Plus, Search } from "lucide-react";
import { Avatar, Badge, Card, EmptyState, Input, LinkButton, PageHeader, Tabs } from "@/components/ui";
import { requirePage } from "@/lib/page-guard";
import { canDo } from "@/lib/permissions";
import { crmOptions, crmUsers, listClients, LIST_LIMIT, type ClientFilter } from "@/lib/crm/clients";
import { STATUS_COLOR, STATUS_LABEL, T } from "@/lib/crm/labels";
import { FilterSelect } from "./filters";

const FILTERS: ClientFilter[] = ["all", "new", "active", "waiting", "refusal"];

export default async function CrmClientsPage({ searchParams }: { searchParams: Promise<{ q?: string; f?: string; manba?: string; xodim?: string }> }) {
  const s = await requirePage("/crm/mijozlar");
  const sp = await searchParams;
  const filter = (FILTERS as string[]).includes(sp.f ?? "") ? (sp.f as ClientFilter) : "all";
  const [{ rows, total }, opts, users] = await Promise.all([
    listClients({ q: sp.q, filter, sourceId: sp.manba, ownerId: sp.xodim }),
    crmOptions(),
    crmUsers(),
  ]);
  const canAdd = canDo(s, "crm", "client");
  const href = (f: ClientFilter) => {
    const p = new URLSearchParams(Object.entries({ q: sp.q, manba: sp.manba, xodim: sp.xodim, f: f === "all" ? undefined : f }).filter((e): e is [string, string] => !!e[1]));
    return `/crm/mijozlar${p.size ? `?${p}` : ""}`;
  };

  return (
    <div>
      <PageHeader title={T.clients.title} back={false} subtitle={sp.q ? T.clients.searchAllHint : undefined}
        action={<>
          {canDo(s, "crm", "import") && <LinkButton href="/crm/import" variant="secondary" className="hidden sm:inline-flex"><FileSpreadsheet size={16} /> Import</LinkButton>}
          {canAdd && <LinkButton href="/crm/mijozlar/new" className="hidden sm:inline-flex"><Plus size={16} /> {T.clients.add}</LinkButton>}
        </>} />

      <form className="relative mb-3">
        {sp.f && <input type="hidden" name="f" value={sp.f} />}
        {sp.manba && <input type="hidden" name="manba" value={sp.manba} />}
        {sp.xodim && <input type="hidden" name="xodim" value={sp.xodim} />}
        <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <Input name="q" type="search" aria-label="Qidirish" placeholder={T.clients.search} defaultValue={sp.q} className="pl-9" enterKeyHint="search" />
      </form>

      <Tabs current={filter} scroll={false} className="mb-3" items={FILTERS.map((f) => ({ key: f, label: T.filter[f], href: href(f) }))} />
      <div className="mb-4 flex gap-2">
        <FilterSelect name="manba" value={sp.manba ?? ""} placeholder={T.clients.allSources} options={opts.SOURCE} />
        <FilterSelect name="xodim" value={sp.xodim ?? ""} placeholder={T.clients.allOwners} options={users.map((u) => ({ id: u.id, label: u.fullName }))} />
      </div>

      {rows.length === 0 ? (
        <EmptyState title={sp.q || filter !== "all" || sp.manba || sp.xodim ? T.clients.empty : T.clients.emptyCrm} />
      ) : (
        <Card padded={false}>
          <ul className="divide-y divide-slate-100">
            {rows.map((c) => (
              <li key={c.id}>
                <Link href={`/crm/mijozlar/${c.id}`} className="flex min-h-16 items-center gap-3 px-4 py-3 transition hover:bg-slate-50">
                  <Avatar name={c.name} className="h-10 w-10" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-slate-900">{c.name}</div>
                    <div className="truncate text-[13px] text-slate-500">
                      {[c.region, c.source].filter(Boolean).join(" · ") || c.phone || "—"}
                      {!c.inCrm && <span className="ml-1 text-slate-400">· {T.clients.notCrm}</span>}
                    </div>
                  </div>
                  {c.inCrm && <Badge color={STATUS_COLOR[c.status]}>{STATUS_LABEL[c.status]}</Badge>}
                  <ChevronRight size={16} className="shrink-0 text-slate-300" />
                </Link>
              </li>
            ))}
          </ul>
          {total > LIST_LIMIT && <p className="border-t border-slate-100 px-4 py-3 text-center text-sm text-slate-500">{T.clients.more(total - LIST_LIMIT)}</p>}
        </Card>
      )}

      {/* Telefonda: pastki menyu ustida «＋» tugmasi */}
      {canAdd && (
        <Link href="/crm/mijozlar/new" aria-label={T.clients.add}
          className="fixed bottom-20 right-4 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-slate-900 text-white shadow-lg sm:hidden">
          <Plus size={26} />
        </Link>
      )}
    </div>
  );
}
