import Link from "next/link";
import { AlertTriangle, CalendarClock, ChevronLeft, ChevronRight, Package, Send } from "lucide-react";
import { requireRoles } from "@/lib/page-guard";
import { pathAllowed } from "@/lib/nav";
import { skladLogistika } from "@/lib/sklad-logistika";
import { date, fmtNum, isoDate } from "@/lib/format";
import type { LoadKind } from "@/lib/unit";
import { Badge, PageHeader, Section, StatCard } from "@/components/ui";
import { cn } from "@/lib/utils";
import { byLoad, HOLAT, isHolat, isLoadKind, LOAD_CARD, LOAD_FILTER, loadHint, loadsText, zayavkaHref, ZayavkaTable, type Holat } from "../mechanic-home";

export const dynamic = "force-dynamic";

/**
 * «Kunlik zayavkalar» — Mexanik bosh sahifasidagi «Bugungi nazorat» kartalari shu sahifani ochadi:
 * tanlangan kunning zayavkalari yuk turi (`birlik`: m3 / dona / t) va holat (`holat`) bo'yicha.
 * Raqamlar bosh sahifa bilan bitta manbadan — `skladLogistika()`.
 */
export default async function Page({ searchParams }: { searchParams: Promise<{ date?: string; birlik?: string; holat?: string }> }) {
  const s = await requireRoles(["MECHANIC", "LOGISTICS", "DISPATCHER", "FINANCE", "ACCOUNTING"]);
  const sp = await searchParams;
  const d = await skladLogistika(sp.date);
  const kind = isLoadKind(sp.birlik) ? sp.birlik : null;
  const holat = isHolat(sp.holat) ? sp.holat : null;
  const t = d.today;

  // Sukut — shu kunning zayavkalari; «Oldingi kunlardan» / «Muammoli» filtrida kechikkanlari ham
  const pool = holat === "kechikkan" || holat === "muammoli" ? d.orders : d.orders.filter((o) => !o.overdue);
  const shown = pool.filter((o) => (!kind || byLoad(o, kind)) && (!holat || HOLAT[holat].test(o)));
  const dayArg = d.isToday ? undefined : d.day;
  const href = (birlik: LoadKind | null, h: Holat | null = holat) => zayavkaHref({ day: dayArg, birlik, holat: h });
  const dayHref = (x: Date) => zayavkaHref({ day: x, birlik: kind, holat });
  const prev = new Date(d.day); prev.setDate(prev.getDate() - 1);
  const title = [kind ? LOAD_CARD[kind].label : null, holat ? HOLAT[holat].label : null].filter(Boolean).join(" · ");
  const chip = (active: boolean) => cn("rounded-full border px-3 py-1 font-medium transition", active ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-600 hover:border-slate-300");
  const count = (k: LoadKind | null, h: Holat | null) => (h === "kechikkan" || h === "muammoli" ? d.orders : d.orders.filter((o) => !o.overdue)).filter((o) => (!k || byLoad(o, k)) && (!h || HOLAT[h].test(o))).length;

  return (
    <div>
      <PageHeader back={{ href: d.isToday ? "/dashboard" : `/dashboard?date=${isoDate(d.day)}`, label: "Bosh sahifa" }}
        title={`Kunlik zayavkalar${title ? ` — ${title}` : ""}`}
        subtitle={<>{d.isToday ? "Bugun" : "Kun"}: {date(d.day)} · {loadsText(t.loads)}</>} />

      <div className="mb-4 flex flex-wrap items-center gap-1 text-sm">
        <Link href={dayHref(prev)} className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100" aria-label="Oldingi kun"><ChevronLeft size={16} /></Link>
        <span className="font-medium tabular">{date(d.day)}</span>
        <Link href={dayHref(d.next)} className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100" aria-label="Keyingi kun"><ChevronRight size={16} /></Link>
        {!d.isToday && <Link href={zayavkaHref({ birlik: kind, holat })} className="ml-2 text-xs text-blue-700 hover:underline">Bugun</Link>}
        {!d.isToday && <Badge>boshqa kun</Badge>}
      </div>

      {/* Yuk turi kartalari — m³, dona, tonna; bosilsa jadval shu turga filtrlanadi (yana bosilsa — filtr olinadi) */}
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {t.loads.map((l) => {
          const c = LOAD_CARD[l.kind];
          return <StatCard key={l.kind} label={`${c.label}${kind === l.kind ? " · tanlangan" : ""}`} value={`${fmtNum(l.qty, l.kind === "dona" ? 0 : 2)} ${c.unit}`} hint={loadHint(l)} icon={c.icon} tone={kind === l.kind ? "brand" : l.orders ? c.tone : "default"} href={href(kind === l.kind ? null : l.kind)} />;
        })}
        <StatCard label="Zayavkalar soni" value={`${t.orders} ta`} hint={`${loadsText(t.loads)}${t.drafts ? ` · ${t.drafts} tasi tasdiqlanmagan` : ""}`} icon={Package} tone="brand" href={href(null, null)} />
      </div>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label="Jo'natilgan" value={`${t.shipped} ta`} hint={t.shippedVolume} icon={Send} tone={holat === "jonatilgan" ? "brand" : t.shipped ? "success" : "default"} href={href(kind, holat === "jonatilgan" ? null : "jonatilgan")} />
        <StatCard label="Qolgan zayavka" value={`${t.left} ta`} hint={t.leftVolume} icon={CalendarClock} tone={holat === "qolgan" ? "brand" : t.left ? "warning" : "success"} href={href(kind, holat === "qolgan" ? null : "qolgan")} />
        <StatCard label="Muammoli / kechikkan" value={`${t.problem} ta`} hint={t.overdue ? `${t.overdue} tasi oldingi kunlardan` : "kechikish, blok, reys muammosi"} icon={AlertTriangle} tone={holat === "muammoli" ? "brand" : t.problem ? "danger" : "success"} href={href(kind, holat === "muammoli" ? null : "muammoli")} />
      </div>

      <Section title={`Zayavkalar — ${shown.length} ta`}>
        <div className="mb-2 flex flex-wrap items-center gap-1.5 text-[13px]">
          <span className="mr-1 text-xs text-slate-500">Yuk turi:</span>
          {([null, "m3", "dona", "t"] as const).map((k) => (
            <Link key={k ?? "all"} href={href(k)} className={chip(kind === k)}>{k ? LOAD_CARD[k].label : "Hammasi"} <span className="tabular opacity-70">{count(k, holat)}</span></Link>
          ))}
        </div>
        <div className="mb-3 flex flex-wrap items-center gap-1.5 text-[13px]">
          <span className="mr-1 text-xs text-slate-500">Holat:</span>
          {([null, "jonatilgan", "qolgan", "muammoli", "kechikkan"] as const).map((h) => (
            <Link key={h ?? "all"} href={href(kind, h)} className={chip(holat === h)}>{h ? HOLAT[h].label : "Hammasi"} <span className="tabular opacity-70">{count(kind, h)}</span></Link>
          ))}
        </div>
        <ZayavkaTable orders={shown} orderHref={pathAllowed("/orders", s.role, s.perms)}
          empty={kind ? `Bu kunda ${LOAD_FILTER[kind]} zayavkasi yo'q` : holat ? `«${HOLAT[holat].label}» zayavka yo'q` : "Bu kunda zayavka yo'q"} />
        {!holat && t.overdue > 0 && (
          <p className="mt-2 text-xs text-slate-500">
            Oldingi kunlardan jo&apos;natilmay qolgan yana {t.overdue} ta zayavka bor — <Link href={href(kind, "kechikkan")} className="text-blue-700 hover:underline">ko&apos;rish</Link>.
          </p>
        )}
      </Section>
    </div>
  );
}
