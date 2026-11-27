import Link from "next/link";
import { ChevronRight, X } from "lucide-react";
import { Avatar, Badge, Card, CardHeader, Empty, PageHeader, Table, Tabs, Td, Th, Tr } from "@/components/ui";
import { db } from "@/lib/db";
import { requirePage } from "@/lib/page-guard";
import { canDo } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { fmtNum, money } from "@/lib/format";
import { crmUsers } from "@/lib/crm/clients";
import { addDaysIso, fullIso, isoToDb, todayIso } from "@/lib/crm/dates";
import { funnel } from "@/lib/crm/funnel";
import { FUNNEL_STAGES, STATUS_COLOR, STATUS_LABEL } from "@/lib/crm/labels";
import { FilterSelect } from "../mijozlar/filters";
import { PeriodForm } from "./period-form";

const COLORS = ["bg-red-500", "bg-orange-500", "bg-amber-500", "bg-yellow-400", "bg-lime-500", "bg-green-500", "bg-emerald-600"];
const MONTHS = ["Yanvar", "Fevral", "Mart", "Aprel", "May", "Iyun", "Iyul", "Avgust", "Sentyabr", "Oktyabr", "Noyabr", "Dekabr"];
const MONTHS_IN = ["Yanvarda", "Fevralda", "Martda", "Aprelda", "Mayda", "Iyunda", "Iyulda", "Avgustda", "Sentyabrda", "Oktyabrda", "Noyabrda", "Dekabrda"];
const pct = (v: number) => `${fmtNum(v, v < 10 && v > 0 ? 1 : 0)}%`;

type SP = { davr?: string; dan?: string; gacha?: string; xodim?: string; bosqich?: string; kutish?: string };

function period(sp: SP, today: string): { from: string; to: string; key: string } {
  if (sp.davr === "hafta") {
    const dow = (isoToDb(today).getUTCDay() + 6) % 7; // dushanba = 0
    return { from: addDaysIso(today, -dow), to: today, key: "hafta" };
  }
  if (sp.davr === "oy") return { from: `${today.slice(0, 8)}01`, to: today, key: "oy" };
  if (sp.davr === "tanlov" && /^\d{4}-\d{2}-\d{2}$/.test(sp.dan ?? "") && /^\d{4}-\d{2}-\d{2}$/.test(sp.gacha ?? "")) {
    const [a, b] = [sp.dan!, sp.gacha!].sort();
    return { from: a, to: b, key: "tanlov" };
  }
  return { from: today, to: today, key: "bugun" };
}

/** Voronka va hisobotlar (CRM_SPEC 5.5). Operator — faqat o'zi, menejer — hammasi yoki tanlangan xodim. */
export default async function FunnelPage({ searchParams }: { searchParams: Promise<SP> }) {
  const s = await requirePage("/crm/voronka");
  const sp = await searchParams;
  const manager = canDo(s, "crm", "manage");
  const today = todayIso();
  const per = period(sp, today);
  const userId = manager ? sp.xodim || null : s.userId;
  const [f, users] = await Promise.all([funnel({ from: per.from, to: per.to, userId }), manager ? crmUsers() : []]);

  const q = (extra: Record<string, string | undefined>) => {
    const base = { davr: per.key === "bugun" ? undefined : per.key, dan: per.key === "tanlov" ? per.from : undefined, gacha: per.key === "tanlov" ? per.to : undefined, xodim: sp.xodim };
    const p = new URLSearchParams(Object.entries({ ...base, ...extra }).filter((e): e is [string, string] => !!e[1]));
    return `/crm/voronka${p.size ? `?${p}` : ""}`;
  };
  const stageSel = Number(sp.bosqich) >= 1 && Number(sp.bosqich) <= 7 ? Number(sp.bosqich) : null;
  const waitSel = sp.kutish !== undefined ? f.waiting.find((w) => w.month === sp.kutish) : undefined;
  const listIds = stageSel ? [...f.levels.entries()].filter(([, v]) => v >= stageSel).map(([id]) => id) : waitSel?.ids ?? [];
  const list = listIds.length ? await db.customer.findMany({
    where: { id: { in: listIds } }, orderBy: { name: "asc" }, take: 300,
    select: { id: true, name: true, region: true, crmStatus: true, source: { select: { label: true } }, owner: { select: { fullName: true } } },
  }) : [];
  const monthLabel = (m: string) => (m ? `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}` : "Sanasiz");

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Voronka" back={false} subtitle={per.from === per.to ? fullIso(per.from) : `${fullIso(per.from)} — ${fullIso(per.to)}`} />

      <Tabs current={per.key} scroll={false} className="mb-3" items={[
        { key: "bugun", label: "Bugun", href: q({ davr: undefined, dan: undefined, gacha: undefined, bosqich: undefined }) },
        { key: "hafta", label: "Hafta", href: q({ davr: "hafta", dan: undefined, gacha: undefined }) },
        { key: "oy", label: "Oy", href: q({ davr: "oy", dan: undefined, gacha: undefined }) },
        { key: "tanlov", label: "O'zim tanlayman", href: q({ davr: "tanlov", dan: per.from, gacha: per.to }) },
      ]} />
      <div className="mb-4 flex flex-wrap items-end gap-2">
        {per.key === "tanlov" && <PeriodForm from={per.from} to={per.to} xodim={sp.xodim} />}
        {manager && <FilterSelect name="xodim" value={sp.xodim ?? ""} placeholder="Barcha xodimlar" options={users.map((u) => ({ id: u.id, label: u.fullName }))} />}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <Card>
          <CardHeader title="Voronka" description="Unikal mijozlar; bosqichni bosing — ro'yxat" />
          <div className="grid gap-1.5">
            {f.stages.map((st, i) => (
              <Link key={i} href={q({ bosqich: stageSel === i + 1 ? undefined : String(i + 1), kutish: undefined })} scroll={false}
                className="group mx-auto block w-full transition" style={{ maxWidth: `${100 - i * 6}%` }}>
                <div className={cn("flex min-h-11 items-center justify-between gap-2 rounded-lg px-3 py-1.5 text-white shadow-sm", COLORS[i], stageSel === i + 1 && "ring-3 ring-slate-900/40", i === 3 && "text-slate-900")}>
                  <span className="min-w-0 truncate text-[13px] font-semibold">{i + 1}. {FUNNEL_STAGES[i]}</span>
                  <span className="shrink-0 text-right tabular leading-tight">
                    <span className="text-base font-bold">{st.n}</span>
                    {i > 0 && <span className="ml-1.5 text-[11px] opacity-90">{pct(st.ofFirst)}</span>}
                  </span>
                </div>
              </Link>
            ))}
          </div>
          {/* Bosqichlar orasidagi o'tish */}
          <div className="mt-4 grid grid-cols-3 gap-2 text-center sm:grid-cols-6">
            {f.stages.slice(1).map((st, i) => (
              <div key={i} className="rounded-lg bg-slate-50 px-1 py-2">
                <div className="text-[11px] text-slate-500">{i + 1}→{i + 2}</div>
                <div className="text-sm font-semibold tabular text-slate-900">{f.stages[i].n ? pct(st.ofPrev) : "—"}</div>
              </div>
            ))}
          </div>
        </Card>

        <div className="grid content-start gap-4">
          <Card>
            <CardHeader title="Kutilayotgan" description={`${f.summary.waiting} ta mijoz — obyekt hali boshlanmagan`} />
            {f.waiting.length === 0 ? <p className="text-sm text-slate-500">Yo'q</p> : (
              <ul className="grid gap-1">
                {f.waiting.map((w) => (
                  <li key={w.month || "none"}>
                    <Link href={q({ kutish: sp.kutish === w.month ? undefined : w.month, bosqich: undefined })} scroll={false}
                      className={cn("flex min-h-10 items-center justify-between rounded-lg px-2 text-sm hover:bg-slate-50", sp.kutish === w.month && "bg-slate-100")}>
                      <span>{w.month ? `${MONTHS_IN[Number(w.month.slice(5, 7)) - 1]} ${w.n} ta obyekt boshlanadi` : `Sanasiz: ${w.n} ta`}</span>
                      <ChevronRight size={14} className="text-slate-400" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card>
            <CardHeader title="Otkaz sabablari" />
            {f.refusals.length === 0 ? <p className="text-sm text-slate-500">Davrda otkaz yo'q</p> : (
              <ul className="grid gap-1.5 text-sm">{f.refusals.map((r) => <li key={r.label} className="flex justify-between gap-2"><span>{r.label}</span><b className="tabular">{r.n}</b></li>)}</ul>
            )}
          </Card>
          <Card>
            <CardHeader title="To'lov" description="Davrdagi zayavkalar" info="Mijozning jami to'lagani uning zayavkalariga sana tartibida (eng eskisidan) taqsimlanadi — debitorka bilan bir xil manbadan." />
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div><div className="text-xs text-slate-500">To'liq to'langan</div><div className="text-lg font-bold tabular">{f.pay.paidOrders} / {f.pay.orders}</div></div>
              <div><div className="text-xs text-slate-500">To'langan summa</div><div className="text-lg font-bold tabular">{money(f.pay.paidSum)}</div></div>
            </div>
          </Card>
        </div>
      </div>

      {(stageSel || waitSel) && (
        <Card className="mt-4" padded={false}>
          <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
            <h2 className="text-sm font-semibold text-slate-900">{stageSel ? `${stageSel}. ${FUNNEL_STAGES[stageSel - 1]} — ${listIds.length} ta mijoz` : `Kutilayotgan: ${monthLabel(waitSel!.month)} — ${listIds.length} ta`}</h2>
            <Link href={q({ bosqich: undefined, kutish: undefined })} scroll={false} aria-label="Yopish" className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"><X size={16} /></Link>
          </div>
          {list.length === 0 ? <p className="px-4 py-6 text-center text-sm text-slate-500">Mijoz yo'q</p> : (
            <ul className="divide-y divide-slate-100">
              {list.map((c) => (
                <li key={c.id}>
                  <Link href={`/crm/mijozlar/${c.id}`} className="flex min-h-14 items-center gap-3 px-4 py-2 hover:bg-slate-50">
                    <Avatar name={c.name} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium text-slate-900">{c.name}</div>
                      <div className="truncate text-[13px] text-slate-500">{[c.region, c.source?.label, c.owner?.fullName].filter(Boolean).join(" · ")}</div>
                    </div>
                    {c.crmStatus && <Badge color={STATUS_COLOR[c.crmStatus]}>{STATUS_LABEL[c.crmStatus]}</Badge>}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      <Card className="mt-4">
        <CardHeader title="Xodimlar bo'yicha" description="Davrdagi aloqalar soni" />
        <Table>
          <thead><tr><Th>Xodim</Th><Th right>Jami aloqa</Th><Th right>Javob berdi</Th><Th right>Ko'tarmadi</Th><Th right>Taklif</Th><Th right>Zayafka</Th><Th right>Qimmat dedi</Th><Th right>Otkaz</Th></tr></thead>
          <tbody>
            {f.employees.length === 0 && <Empty text="Davrda aloqa yo'q" />}
            {f.employees.map((e) => (
              <Tr key={e.userId}><Td>{e.name}</Td><Td right>{e.total}</Td><Td right>{e.answered}</Td><Td right>{e.noAnswer}</Td><Td right>{e.offer}</Td><Td right>{e.order}</Td><Td right>{e.expensive}</Td><Td right>{e.refusal}</Td></Tr>
            ))}
            {f.employees.length > 1 && (
              <Tr className="font-semibold"><Td>Jami</Td><Td right>{f.summary.contacts}</Td><Td right>{f.summary.answered}</Td><Td right>{f.summary.noAnswer}</Td><Td right>{f.summary.offers}</Td><Td right>{f.summary.orders}</Td><Td right>{f.summary.expensive}</Td><Td right>{f.summary.refusals}</Td></Tr>
            )}
          </tbody>
        </Table>
      </Card>

      <Card className="mt-4">
        <CardHeader title="Lid manbalari" description="Qaysi manba ko'proq zayafka beradi" />
        <Table>
          <thead><tr><Th>Manba</Th><Th right>Mijozlar</Th><Th right>Zayafka</Th><Th right>Konversiya</Th></tr></thead>
          <tbody>
            {f.sources.length === 0 && <Empty text="Davrda mijoz yo'q" />}
            {f.sources.map((r) => <Tr key={r.id ?? "none"}><Td>{r.label}</Td><Td right>{r.clients}</Td><Td right>{r.orders}</Td><Td right>{pct(r.conv)}</Td></Tr>)}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}
