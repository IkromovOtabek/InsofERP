import Link from "next/link";
import { notFound } from "next/navigation";
import { Headset, PhoneIncoming, PhoneMissed, PhoneOutgoing, Timer } from "lucide-react";
import { Badge, Card, CardHeader, Empty, EmptyState, PageHeader, StatCard, Table, Tabs, Td, Th, Tr } from "@/components/ui";
import { requirePage } from "@/lib/page-guard";
import { canDo } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { formatPhone } from "@/lib/phone";
import { fmtNum, pct } from "@/lib/format";
import { crmUsers, telLink } from "@/lib/crm/clients";
import { fullIso, period, todayIso, tzDateTime, tzTime } from "@/lib/crm/dates";
import { callJournal, callQueue, callStats, JOURNAL_LIMIT, QUEUE_DAYS } from "@/lib/crm/callcenter";
import { canPbxCall, mmss } from "@/lib/pbx/me";
import { pbxEnabled } from "@/lib/pbx/onlinepbx";
import { CallButton } from "../call-button";
import { FilterSelect } from "../mijozlar/filters";
import { PeriodForm } from "../voronka/period-form";
import { CallNumber, DialPad, QueueButtons } from "./ui";

type SP = { tab?: string; davr?: string; dan?: string; gacha?: string; xodim?: string; yo?: string; q?: string };
const TABS = ["navbat", "jurnal", "statistika"] as const;

/** Kutish vaqti: «12 daq», «3 soat», «2 kun» */
function waited(from: Date, now = Date.now()) {
  const m = Math.max(0, Math.round((now - from.getTime()) / 60_000));
  if (m < 60) return `${m} daq`;
  if (m < 1440) return `${Math.floor(m / 60)} soat`;
  return `${Math.floor(m / 1440)} kun`;
}
const minText = (m: number | null) => (m == null ? "—" : m < 60 ? `${fmtNum(m, 0)} daq` : `${fmtNum(m / 60, 1)} soat`);

/**
 * Call-markaz: o'tkazib yuborilgan qo'ng'iroqlar navbati + terish paneli, qo'ng'iroqlar jurnali (yozuvlar bilan),
 * operatorlar statistikasi (menejer). Operator (CALL_CENTER) vebda shu sahifadan boshlaydi.
 */
export default async function CallCenterPage({ searchParams }: { searchParams: Promise<SP> }) {
  const s = await requirePage("/crm/callcenter");
  if (!canDo(s, "crm", "calls")) notFound();
  const sp = await searchParams;
  const manager = canDo(s, "crm", "manage");
  const tab = (TABS as readonly string[]).includes(sp.tab ?? "") && (sp.tab !== "statistika" || manager) ? sp.tab! : "navbat";
  const [pbx, enabled] = [await canPbxCall(s.userId), pbxEnabled()];

  const q = (extra: Partial<SP>) => {
    const p = new URLSearchParams(Object.entries({ ...sp, ...extra }).filter((e): e is [string, string] => !!e[1]));
    return `/crm/callcenter${p.size ? `?${p}` : ""}`;
  };

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Call-markaz" back={false}
        subtitle={enabled ? (pbx ? "onlinePBX ulangan — qo'ng'iroqlar kompyuterdan" : "onlinePBX ulangan, lekin sizga ichki raqam berilmagan") : "Telefoniya ulanmagan — qo'ng'iroqlar telefondan (tel:)"} />
      <Tabs current={tab} scroll={false} className="mb-4" items={[
        { key: "navbat", label: "Navbat", href: q({ tab: undefined, davr: undefined, dan: undefined, gacha: undefined, yo: undefined, q: undefined }) },
        { key: "jurnal", label: "Jurnal", href: q({ tab: "jurnal" }) },
        ...(manager ? [{ key: "statistika", label: "Statistika", href: q({ tab: "statistika", yo: undefined, q: undefined }) }] : []),
      ]} />
      {tab === "navbat" && <Queue userId={s.userId} pbx={pbx} />}
      {tab === "jurnal" && <Journal sp={sp} q={q} manager={manager} userId={s.userId} pbx={pbx} />}
      {tab === "statistika" && <Stats sp={sp} q={q} />}
    </div>
  );
}

async function Queue({ userId, pbx }: { userId: string; pbx: boolean }) {
  const rows = await callQueue();
  const now = Date.now();
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_20rem] lg:items-start">
      <Card padded={false}>
        <div className="px-4 pt-4"><CardHeader title={`Javob berilmagan qo'ng'iroqlar · ${rows.length}`} description={`Oxirgi ${QUEUE_DAYS} kun. Shu raqam bilan gaplashilgach navbatdan o'zi chiqadi`} icon={PhoneMissed} /></div>
        {rows.length === 0 ? <div className="px-4 pb-4"><EmptyState title="Navbat bo'sh — barcha qo'ng'iroqlarga javob berilgan" /></div> : (
          <ul className="divide-y divide-slate-100 border-t border-slate-100">
            {rows.map((r) => {
              const mine = r.takenBy?.id === userId;
              const long = now - r.firstAt.getTime() > 30 * 60_000;
              return (
                <li key={r.id} className={cn("flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3", mine && "bg-emerald-50/40")}>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      {r.customer
                        ? <Link href={`/crm/mijozlar/${r.customer.id}`} className="truncate font-medium text-slate-900 hover:underline">{r.customer.name}</Link>
                        : <span className="font-medium text-slate-900">{r.phone ? formatPhone(r.phone) : "Raqam yashirin"}</span>}
                      {r.count > 1 && <Badge color="red">{r.count} marta</Badge>}
                      {r.takenBy && <Badge color={mine ? "green" : "slate"}>{mine ? "Sizda" : r.takenBy.name}</Badge>}
                    </div>
                    <div className="mt-0.5 text-[13px] text-slate-500">
                      {[r.customer && r.phone ? formatPhone(r.phone) : null, `oxirgisi ${tzDateTime(r.lastAt)}`, r.customer?.owner].filter(Boolean).join(" · ")}
                    </div>
                    <div className={cn("mt-0.5 text-[13px] font-medium", long ? "text-red-600" : "text-amber-700")}>Kutmoqda: {waited(r.firstAt, now)}</div>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {r.customer
                      ? <CallButton customerId={r.customer.id} tel={telLink(r.phone)} pbx={pbx && !!r.phone} variant="round" label={`Qo'ng'iroq: ${r.customer.name}`} />
                      : r.phone && <CallNumber phone={r.phone} pbx={pbx} />}
                    {!r.customer && r.phone && <Link href={`/crm/mijozlar/new?phone=${encodeURIComponent(r.phone)}`} className="inline-flex min-h-9 items-center rounded-lg border border-slate-200 px-2.5 text-[13px] font-medium text-slate-700 hover:bg-slate-50">Mijoz yaratish</Link>}
                    {r.customer && <Link href={`/crm/mijozlar/${r.customer.id}/aloqa?back=${encodeURIComponent("/crm/callcenter")}`} className="inline-flex min-h-9 items-center rounded-lg border border-slate-200 px-2.5 text-[13px] font-medium text-slate-700 hover:bg-slate-50">Aloqa yozish</Link>}
                    <QueueButtons ids={r.ids} takenByMe={mine} takenByOther={r.takenBy && !mine ? r.takenBy.name : null} />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      <Card>
        <CardHeader title="Raqam terish" description="Avval sizning ilovangiz jiringlaydi, ko'targach raqamga ulanadi" icon={Headset} />
        <DialPad pbx={pbx} />
      </Card>
    </div>
  );
}

const DIRS = [
  { key: "", label: "Hammasi" }, { key: "IN", label: "Kiruvchi" }, { key: "OUT", label: "Chiquvchi" }, { key: "MISSED", label: "O'tkazib yuborilgan" },
];

async function Journal({ sp, q, manager, userId, pbx }: { sp: SP; q: (e: Partial<SP>) => string; manager: boolean; userId: string; pbx: boolean }) {
  const per = period(sp, todayIso());
  const [{ rows, total }, users] = await Promise.all([
    callJournal({ from: per.from, to: per.to, dir: sp.yo, userId: manager ? sp.xodim : sp.xodim === "men" ? userId : null, q: sp.q }),
    manager ? crmUsers() : [],
  ]);
  return (
    <div>
      <Tabs current={per.key} scroll={false} className="mb-3" items={[
        { key: "bugun", label: "Bugun", href: q({ davr: undefined, dan: undefined, gacha: undefined }) },
        { key: "hafta", label: "Hafta", href: q({ davr: "hafta", dan: undefined, gacha: undefined }) },
        { key: "oy", label: "Oy", href: q({ davr: "oy", dan: undefined, gacha: undefined }) },
        { key: "tanlov", label: "O'zim tanlayman", href: q({ davr: "tanlov", dan: per.from, gacha: per.to }) },
      ]} />
      <div className="mb-3 flex flex-wrap items-end gap-2">
        {per.key === "tanlov" && <PeriodForm from={per.from} to={per.to} xodim={sp.xodim} keep={{ tab: "jurnal", yo: sp.yo, q: sp.q }} />}
        {manager
          ? <FilterSelect name="xodim" value={sp.xodim ?? ""} placeholder="Barcha operatorlar" options={users.map((u) => ({ id: u.id, label: u.fullName }))} />
          : <FilterSelect name="xodim" value={sp.xodim ?? ""} placeholder="Barcha qo'ng'iroqlar" options={[{ id: "men", label: "Faqat meniki" }]} />}
        <form className="flex gap-2">
          {Object.entries({ tab: "jurnal", davr: sp.davr, dan: sp.dan, gacha: sp.gacha, xodim: sp.xodim, yo: sp.yo }).map(([k, v]) => v ? <input key={k} type="hidden" name={k} value={v} /> : null)}
          <input name="q" defaultValue={sp.q ?? ""} placeholder="Raqam yoki mijoz" aria-label="Qidirish"
            className="h-10 w-48 rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus:border-slate-400" />
        </form>
      </div>
      <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
        {DIRS.map((d) => {
          const on = (sp.yo ?? "") === d.key;
          return (
            <Link key={d.key} href={q({ yo: d.key || undefined })} scroll={false} aria-current={on ? "page" : undefined}
              className={cn("inline-flex min-h-10 shrink-0 items-center rounded-full border px-3.5 text-[13px] font-medium", on ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-600")}>
              {d.label}
            </Link>
          );
        })}
      </div>
      <p className="mb-2 text-[13px] text-slate-500">{per.from === per.to ? fullIso(per.from) : `${fullIso(per.from)} — ${fullIso(per.to)}`} · {total} ta{total > JOURNAL_LIMIT ? ` (oxirgi ${JOURNAL_LIMIT} tasi ko'rsatilgan)` : ""}</p>
      <Table>
        <thead><tr><Th>Vaqt</Th><Th>Yo&apos;nalish</Th><Th>Mijoz / raqam</Th><Th>Operator</Th><Th right>Gaplashdi</Th><Th>Yozuv</Th><Th></Th></tr></thead>
        <tbody>
          {rows.length === 0 && <Empty text="Bu davrda qo'ng'iroq yo'q" />}
          {rows.map((r) => {
            const Icon = r.direction === "MISSED" ? PhoneMissed : r.direction === "OUT" ? PhoneOutgoing : PhoneIncoming;
            const live = r.state !== "ENDED";
            return (
              <Tr key={r.id}>
                <Td className="whitespace-nowrap">{tzDateTime(r.startedAt)}</Td>
                <Td className="whitespace-nowrap">
                  <span className={cn("inline-flex items-center gap-1.5", r.direction === "MISSED" || (r.direction === "OUT" && r.talkSec === 0 && !live) ? "text-red-600" : "text-emerald-700")}>
                    <Icon size={15} /> {live ? "Davom etmoqda" : r.direction === "MISSED" ? "O'tkazib yuborilgan" : r.direction === "OUT" ? "Chiquvchi" : "Kiruvchi"}
                  </span>
                  {r.direction === "MISSED" && <div className="text-xs text-slate-500">{r.handledAt ? `hal qilindi ${tzTime(r.handledAt)}${r.handledBy ? ` · ${r.handledBy.fullName}` : ""}` : "navbatda"}</div>}
                </Td>
                <Td>
                  {r.customer ? <Link href={`/crm/mijozlar/${r.customer.id}`} className="font-medium text-slate-900 hover:underline">{r.customer.name}</Link> : <span className="text-slate-500">Bazada yo&apos;q</span>}
                  <div className="text-xs text-slate-500">{r.phone ? formatPhone(r.phone) : "—"}</div>
                </Td>
                <Td className="whitespace-nowrap">{r.user?.fullName ?? (r.ext ? `ichki ${r.ext}` : "—")}</Td>
                <Td right>{r.talkSec > 0 ? mmss(r.talkSec) : "—"}</Td>
                <Td>{r.talkSec > 0 && !live ? <audio controls preload="none" src={`/api/pbx/record/${r.uuid}`} className="h-8 w-56" /> : null}</Td>
                <Td>
                  <div className="flex items-center justify-end gap-1.5">
                    {r.phone && (r.customer
                      ? <CallButton customerId={r.customer.id} tel={telLink(r.phone)} pbx={pbx} variant="round" label={`Qo'ng'iroq: ${r.customer.name}`} />
                      : <CallNumber phone={r.phone} pbx={pbx} label="Qayta" />)}
                    {r.customer && !r.contactId && <Link href={`/crm/mijozlar/${r.customer.id}/aloqa?back=${encodeURIComponent("/crm/callcenter?tab=jurnal")}`} className="whitespace-nowrap rounded-lg border border-slate-200 px-2.5 py-1.5 text-[13px] font-medium text-slate-700 hover:bg-slate-50">Aloqa yozish</Link>}
                    {!r.customer && r.phone && <Link href={`/crm/mijozlar/new?phone=${encodeURIComponent(r.phone)}`} className="whitespace-nowrap rounded-lg border border-slate-200 px-2.5 py-1.5 text-[13px] font-medium text-slate-700 hover:bg-slate-50">Mijoz yaratish</Link>}
                  </div>
                </Td>
              </Tr>
            );
          })}
        </tbody>
      </Table>
    </div>
  );
}

async function Stats({ sp, q }: { sp: SP; q: (e: Partial<SP>) => string }) {
  const per = period(sp, todayIso());
  const [st, users] = await Promise.all([callStats(per.from, per.to, sp.xodim), crmUsers()]);
  const answerRate = st.inbound ? (st.inAnswered / st.inbound) * 100 : 0;
  const maxH = Math.max(1, ...st.hours.map((h) => h.in + h.out));
  const hours = st.hours.filter((h) => h.hour >= 7 && h.hour <= 21 || h.in + h.out > 0);
  return (
    <div>
      <Tabs current={per.key} scroll={false} className="mb-3" items={[
        { key: "bugun", label: "Bugun", href: q({ davr: undefined, dan: undefined, gacha: undefined }) },
        { key: "hafta", label: "Hafta", href: q({ davr: "hafta", dan: undefined, gacha: undefined }) },
        { key: "oy", label: "Oy", href: q({ davr: "oy", dan: undefined, gacha: undefined }) },
        { key: "tanlov", label: "O'zim tanlayman", href: q({ davr: "tanlov", dan: per.from, gacha: per.to }) },
      ]} />
      <div className="mb-4 flex flex-wrap items-end gap-2">
        {per.key === "tanlov" && <PeriodForm from={per.from} to={per.to} xodim={sp.xodim} keep={{ tab: "statistika" }} />}
        <FilterSelect name="xodim" value={sp.xodim ?? ""} placeholder="Barcha operatorlar" options={users.map((u) => ({ id: u.id, label: u.fullName }))} />
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Kiruvchi" value={st.inbound} hint={`javob berildi ${pct(answerRate, 0)}`} icon={PhoneIncoming} tone={answerRate >= 90 || !st.inbound ? "success" : answerRate >= 75 ? "warning" : "danger"} />
        <StatCard label="O'tkazib yuborilgan" value={st.missed} hint={st.missedOpen ? `${st.missedOpen} tasi hali navbatda` : "hammasi hal qilingan"} icon={PhoneMissed} tone={st.missedOpen ? "danger" : "default"} href={st.missedOpen ? "/crm/callcenter" : undefined} />
        <StatCard label="Chiquvchi" value={st.outbound} hint={`gaplashildi ${st.outAnswered}`} icon={PhoneOutgoing} />
        <StatCard label="Qayta qo'ng'iroq tezligi" value={minText(st.avgCallbackMin)} hint={`o'rtacha gaplashuv ${mmss(Math.round(st.avgTalkSec))}`} icon={Timer} />
      </div>

      <Card className="mt-4">
        <CardHeader title="Operatorlar" description={`${per.from === per.to ? fullIso(per.from) : `${fullIso(per.from)} — ${fullIso(per.to)}`}`} />
        <Table>
          <thead><tr><Th>Operator</Th><Th right>Chiquvchi</Th><Th right>Gaplashdi</Th><Th right>Kiruvchiga javob</Th><Th right>Jami gaplashuv</Th><Th right>Qayta qo&apos;ng&apos;iroq</Th><Th right>O&apos;rtacha tezlik</Th></tr></thead>
          <tbody>
            {st.operators.length === 0 && <Empty text="Davrda qo'ng'iroq yo'q" />}
            {st.operators.map((o) => (
              <Tr key={o.userId}>
                <Td>{o.name}</Td><Td right>{o.out}</Td><Td right>{o.outAnswered}{o.out ? <span className="text-slate-400"> · {pct((o.outAnswered / o.out) * 100, 0)}</span> : null}</Td>
                <Td right>{o.inAnswered}</Td><Td right>{mmss(o.talkSec)}</Td><Td right>{o.callbacks}</Td><Td right>{minText(o.avgCallbackMin)}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </Card>

      <Card className="mt-4">
        <CardHeader title="Soatlar bo'yicha yuklama" description="Kiruvchi va chiquvchi qo'ng'iroqlar soni (Toshkent vaqti); qizil — o'tkazib yuborilganlar" />
        {st.total === 0 ? <EmptyState title="Davrda qo'ng'iroq yo'q" /> : (
          <div className="grid gap-1.5">
            {hours.map((h) => (
              <div key={h.hour} className="flex items-center gap-2 text-[13px]">
                <span className="w-12 shrink-0 tabular text-slate-500">{String(h.hour).padStart(2, "0")}:00</span>
                <div className="flex h-5 min-w-0 flex-1 overflow-hidden rounded bg-slate-50">
                  <div className="bg-emerald-400" style={{ width: `${((h.in - h.missed) / maxH) * 100}%` }} title={`Kiruvchi: ${h.in - h.missed}`} />
                  <div className="bg-red-400" style={{ width: `${(h.missed / maxH) * 100}%` }} title={`O'tkazib yuborilgan: ${h.missed}`} />
                  <div className="bg-blue-400" style={{ width: `${(h.out / maxH) * 100}%` }} title={`Chiquvchi: ${h.out}`} />
                </div>
                <span className="w-16 shrink-0 text-right tabular text-slate-600">{h.in + h.out}</span>
              </div>
            ))}
            <div className="mt-2 flex flex-wrap gap-4 text-xs text-slate-500">
              <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-emerald-400" /> Kiruvchi</span>
              <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-red-400" /> O&apos;tkazib yuborilgan</span>
              <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-blue-400" /> Chiquvchi</span>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
