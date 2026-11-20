import Link from "next/link";
import { ArrowDownWideNarrow, Crown, FileSpreadsheet, Hourglass, HandCoins, Scale, Search, SlidersHorizontal, Truck, UserRound, Users, Wallet, X } from "lucide-react";
import { type SP } from "../shell";
import { type AgeReport, type DebtSheet, AGE_LABELS, AGE_STATUS, CUSTOMER_KIND_LABEL } from "@/lib/fin-report/debts";
import type { Akt } from "@/lib/fin-report/akt";
import { MONTHS_UZ } from "@/lib/bi/plans";
import { date, dateRu, dateShort, fmtJami, fmtNum, isoDate, moneyShort } from "@/lib/format";
import { Badge, type BadgeColor, Card, InfoButton, Input, StatCard, Table, Td, Th, Tr } from "@/components/ui";
import { ExcelButton } from "@/app/(app)/logistika/excel-button";
import { DebtFixButton, OpeningFixButton, PartyEditButton, PencilLink } from "./debt-dialogs";
import { cn } from "@/lib/utils";

/**
 * Tahlil → Mijozlar: tahlil va «Insof 2026» jadvalidagi qarz varaqlari. Sidebar'da «Mijozlar» ostida ham shu havolalar (`lib/nav.ts`).
 * URL: `sana` (YYYY-MM-DD, sukut — bugun), `q` (nom bo'yicha qidiruv), `tur` (CASH / BANK), `holat` (0–3),
 * `qism` (debitor / kreditor — kim kimga qarz), `dan` (qarz varaqlarida davr boshi, sukut — oy boshi),
 * `smin` / `smax` (qarz varaqlari: davr oxiridagi summa oralig'i, so'm), `sort` — katta summa tepada: `qarz` / `avans`
 * (davr oxiri ustuni, sarlavhasini bosib), `summa` (eski havolalar: qarz yoki avansning kattasi).
 */

const qs = (o: Record<string, string | undefined>) => { const s = new URLSearchParams(Object.entries(o).filter((kv): kv is [string, string] => !!kv[1])).toString(); return s ? `?${s}` : ""; };


const monthName = (d: Date) => `${MONTHS_UZ[d.getMonth()]} ${d.getFullYear()} y.`;
const dm = (d: Date) => `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}`;
const isToday = (d: Date) => isoDate(d) === isoDate(new Date());
const Num = ({ v, className }: { v: number; className?: string }) => (Math.abs(v) < 1 ? <span className="text-slate-300">—</span> : <span className={className}>{fmtNum(v)}</span>);

/** Sana, qidiruv va Excel — har uch hisobot tepasida. */
function Toolbar({ base, day, start, allTime, sp, keep, excel, extra, entry, placeholder }: { base: string; day: Date; start?: Date; allTime?: boolean; sp: SP; keep: Record<string, string | undefined>; excel: React.ReactNode; extra?: React.ReactNode; entry?: React.ReactNode; placeholder: string }) {
  const monthIso = isoDate(new Date(day.getFullYear(), day.getMonth(), 1));
  return (
    <form method="get" action={base} className="mb-4 flex flex-wrap items-center gap-2">
      {Object.entries(keep).map(([k, v]) => v && <input key={k} type="hidden" name={k} value={v} />)}
      <label className="relative min-w-44 flex-1 sm:max-w-72">
        <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <Input name="q" defaultValue={sp.q ?? ""} placeholder={placeholder} className="h-9 pl-9" />
      </label>
      {start && (
        <div className="ml-auto flex items-center gap-1 rounded-lg border border-slate-200 p-0.5 text-[13px]">
          {/* Davr: boshidan (sukut) yoki shu oy — «Dan» maydonini qo'lda ham tanlash mumkin */}
          <Link href={`${base}${qs({ ...keep, q: sp.q, sana: sp.sana })}`} className={cn("rounded-md px-2.5 py-1 font-medium", allTime ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100")}>Boshidan</Link>
          <Link href={`${base}${qs({ ...keep, q: sp.q, sana: sp.sana, dan: monthIso })}`} className={cn("rounded-md px-2.5 py-1 font-medium", !allTime && isoDate(start) === monthIso ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100")}>Shu oy</Link>
        </div>
      )}
      {start && (
        <label className="flex items-center gap-1.5 text-xs text-slate-500">Dan
          <Input type="date" name="dan" defaultValue={allTime ? "" : isoDate(start)} max={isoDate(new Date())} className="h-9 w-40" />
        </label>
      )}
      <label className={cn("flex items-center gap-1.5 text-xs text-slate-500", !start && "ml-auto")}>{start ? "Gacha" : "Sana"}
        <Input type="date" name="sana" defaultValue={isoDate(day)} max={isoDate(new Date())} className="h-9 w-40" />
      </label>
      <button className="h-9 rounded-lg bg-slate-900 px-3 text-sm font-medium text-white hover:bg-slate-800">Ko&apos;rsatish</button>
      {!isToday(day) && <Link href={`${base}${qs({ ...keep, q: sp.q })}`} className="h-9 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">Bugun</Link>}
      {extra}
      {excel}
      {entry}
    </form>
  );
}

function Chip({ href, on, children, count }: { href: string; on: boolean; children: React.ReactNode; count?: number }) {
  return (
    <Link href={href} className={cn("inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[13px] font-medium transition", on ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-600 hover:border-slate-300")}>
      {children}{count != null && <span className={cn("tabular text-xs", on ? "text-white/70" : "text-slate-400")}>{count}</span>}
    </Link>
  );
}

const filterName = <T extends { name: string }>(rows: T[], q?: string) => {
  const s = q?.trim().toLowerCase();
  return s ? rows.filter((r) => r.name.toLowerCase().includes(s)) : rows;
};

// ───────────────────── Summa filtri (qarz varaqlari) ─────────────────────

const SUM_PRESETS = [1_000_000, 10_000_000, 50_000_000, 100_000_000];
/** «10 000 000», «10000000» → 10000000; bo'sh yoki noto'g'ri — filtr yo'q. */
const parseSum = (v?: string) => { const n = Number((v ?? "").replace(/[\s,'_]/g, "")); return v && Number.isFinite(n) && n > 0 ? n : undefined; };

/**
 * «Summa» tugmasi — asboblar qatorida, Excel oldida; bosilsa panel ochiladi (JS'siz, `<details>`).
 * Maydonlar Toolbar formasining ichida: «Qo'llash» qidiruv, sana va boshqa filtrlarni ham saqlab yuboradi
 * (saralash `sort` — yashirin maydonda). «Katta summa tepada» — jadvaldagi davr oxiri ustunlari sarlavhasida.
 */
function SumFilter({ on, label, side, smin, smax, sort, presets, clearHref }: {
  on: boolean; label: string; side: string; smin?: number; smax?: number; sort?: string;
  presets: { v: number; href: string; on: boolean }[]; clearHref: string;
}) {
  return (
    <details className="relative">
      <summary className={cn("flex h-9 cursor-pointer list-none items-center gap-1.5 rounded-lg border px-3 text-sm font-medium transition [&::-webkit-details-marker]:hidden",
        on ? "border-amber-300 bg-amber-50 text-amber-800" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50")}>
        {/* Qiymat Ko'rinish qatoridagi chipda to'liq — tugmada faqat belgi (asboblar qatori bir qatorda sig'sin) */}
        <SlidersHorizontal size={15} /> Summa{on && <span className="h-2 w-2 rounded-full bg-amber-500" title={label} />}
      </summary>
      <div className="absolute right-0 z-30 mt-2 w-80 rounded-xl border border-slate-200 bg-white p-3 shadow-lg">
        <div className="text-xs font-semibold text-slate-500">Davr oxiridagi summa · {side}</div>
        <div className="mt-2 grid grid-cols-4 gap-1.5">
          {presets.map((p) => (
            <Link key={p.v} href={p.href} className={cn("rounded-lg border px-2 py-1.5 text-center text-[13px] font-medium transition", p.on ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 text-slate-700 hover:bg-slate-50")}>
              ≥ {moneyShort(p.v)}
            </Link>
          ))}
        </div>
        <div className="mt-3 flex items-center gap-1.5 text-xs text-slate-500">
          <Input name="smin" defaultValue={smin != null ? fmtNum(smin) : ""} placeholder="dan, so'm" inputMode="numeric" className="h-9" />
          <span>–</span>
          <Input name="smax" defaultValue={smax != null ? fmtNum(smax) : ""} placeholder="gacha, so'm" inputMode="numeric" className="h-9" />
        </div>
        {sort && <input type="hidden" name="sort" value={sort} />}
        <div className="mt-3 flex items-center justify-between gap-2">
          <Link href={clearHref} className="text-[13px] font-medium text-slate-500 hover:text-slate-900 hover:underline">Tozalash</Link>
          <button className="h-9 rounded-lg bg-slate-900 px-4 text-sm font-medium text-white hover:bg-slate-800">Qo&apos;llash</button>
        </div>
      </div>
    </details>
  );
}

// ───────────────────── Qarzdorlik / haqdorlik: davr boshi → sotib olgan → to'lagan → davr oxiri ─────────────────────

/** Jadval ranglari — «Insof 2026» dagi «Xaridorlar qarzi» varag'idek: kulrang nom/davr boshi, ko'k aylanma, yashil davr oxiri. */
const SH = {
  head: "bg-[#c8cfb6] text-slate-900 dark:bg-[#383e30]",
  headMid: "bg-[#d9e4f2] text-slate-900 dark:bg-[#26324a]",
  headNow: "bg-[#e3ecc8] text-slate-900 dark:bg-[#33402a]",
  cell: "bg-[#ececec] dark:bg-[#1f2328]",
  cellMid: "bg-[#f3f7fc] dark:bg-[#1c2333]",
  cellNow: "bg-[#f4f7ea] dark:bg-[#20291c]",
  hover: "group-hover:bg-[#dfe6f2] dark:group-hover:bg-[#28334a]",
  line: "border border-[#d4d6cf] dark:border-slate-200",
  split: "border-l-2 border-l-[#6b9a3f]",
} as const;

type Row = DebtSheet["rows"][number];

/**
 * «Ta'minotchilar oldidagi qarzdorlik» va «Xaridorlar qarzdorligi» — bir xil ko'rinish, 4 ustun (Otabek, 2026-11-14):
 *  1) davr boshidagi qarzdorlik / haqdorlik (qarzdorlik — ular bizga qarz, haqdorlik — biz ularga qarzmiz),
 *  2) shu davrda sotib olgan (ta'minotchida — bizga bergan mahsulot) — bosilsa nima, qachon, qancha olgani,
 *  3) shundan to'lagan — bosilsa to'lovlar, 4) davr oxiridagi qarzdorlik / haqdorlik.
 * Qator nomi — akt sverka. Har ustunda qalam (Otabek, 2026-11-17): nom — nomi va mijoz turi (naqd / perechisleniye),
 * davr boshi — boshlang'ich qoldiq, sotib olgan / to'lagan — tafsilotda har yozuvni tahrirlash, davr oxiri — qoldiqni tuzatish.
 */
export function DebtSheetView({ who, s, sp, base, company, entryHref, canFix, canEditParty, transfer }: {
  who: "supplier" | "customer"; s: DebtSheet; sp: SP; base: string; company: string;
  /** «Qarzlarni kiritish» sahifasi (Excel / qo'lda, tahrir, kamaytirish, o'chirish) — kiritish huquqi borlarga */
  entryHref?: string;
  /** Summa ustunlaridagi qalamlar — boshlang'ich qoldiq, tafsilot, «Qoldiqni tuzatish» (qarz kiritish huquqi) */
  canFix?: boolean;
  /** Nom ustunidagi qalam — nomi va mijoz turi (mijoz: «customers → edit», ta'minotchi: «stock → suppliers») */
  canEditParty?: boolean;
  /** «Boshqa mijoz to'lovi» tugmasi (faqat xaridorlar) */
  transfer?: React.ReactNode;
}) {
  const sup = who === "supplier";
  const kind = sp.tur === "CASH" || sp.tur === "BANK" ? sp.tur : undefined;
  // Qarzdorlik — ular bizga qarz (mijoz qarzi; ta'minotchiga bergan avansimiz), haqdorlik — biz ularga qarzmiz.
  // Ma'lumotda `debt` — musbat qoldiq: mijozda u bizga qarz, ta'minotchida biz qarzmiz — ko'rinishda shunga qarab almashtiriladi
  const owes = (x: { debt: number; advance: number }) => (sup ? x.advance : x.debt);
  const owed = (x: { debt: number; advance: number }) => (sup ? x.debt : x.advance);
  const qism = sp.qism === "debitor" || sp.qism === "kreditor" ? sp.qism : undefined;
  const isDebitor = (r: Row) => owes(r.now) >= 1;
  const isKreditor = (r: Row) => owed(r.now) >= 1;
  const named = filterName(s.rows, sp.q);
  // Summa filtri — davr oxiridagi summa: tanlangan qism ustuni, «Hammasi»da qarzdorlik yoki haqdorlikning kattasi
  const amt = (r: Row) => (qism === "debitor" ? owes(r.now) : qism === "kreditor" ? owed(r.now) : Math.max(r.now.debt, r.now.advance));
  const smin = parseSum(sp.smin), smax = parseSum(sp.smax);
  // Saralash — davr oxiri ustunlari (`qarz` — qarzdorlik, `avans` — haqdorlik), sotib olgan / to'lagan; `summa` — eski havolalar
  const sort = ["qarz", "avans", "summa", "sotuv", "tolov"].includes(sp.sort ?? "") ? sp.sort : undefined;
  const sortVal = (r: Row) => (sort === "qarz" ? owes(r.now) : sort === "avans" ? owed(r.now) : sort === "sotuv" ? r.sold : sort === "tolov" ? r.paid : amt(r));
  const sumOn = smin != null || smax != null;
  const sumKeep = { smin: smin != null ? String(smin) : undefined, smax: smax != null ? String(smax) : undefined, sort };
  const rows = named
    .filter((r) => !qism || (qism === "debitor" ? isDebitor(r) : isKreditor(r)))
    .filter((r) => (smin == null || amt(r) >= smin) && (smax == null || amt(r) <= smax))
    .sort((a, b) => (sort ? sortVal(b) - sortVal(a) : 0));
  const d1 = s.allTime ? "boshidan" : dateShort(s.monthStart), d2 = dateShort(s.day);
  const dan = isoDate(s.monthStart), sana = isoDate(s.day);
  // Boshidan (sukut) — `dan` URL'da yurmaydi
  const danKeep = s.allTime ? undefined : dan;
  const sumNamed = (f: (r: Row) => number) => named.reduce((a, r) => a + f(r), 0);
  const t = named === s.rows ? s.total : { open: { debt: sumNamed((r) => r.open.debt), advance: sumNamed((r) => r.open.advance) }, sold: sumNamed((r) => r.sold), paid: sumNamed((r) => r.paid), now: { debt: sumNamed((r) => r.now.debt), advance: sumNamed((r) => r.now.advance) } };
  const sumRows = (f: (r: Row) => number) => rows.reduce((a, r) => a + f(r), 0);
  const ft = { open: { debt: sumRows((r) => r.open.debt), advance: sumRows((r) => r.open.advance) }, sold: sumRows((r) => r.sold), paid: sumRows((r) => r.paid), now: { debt: sumRows((r) => r.now.debt), advance: sumRows((r) => r.now.advance) } };
  const debitorSum = owes(t.now), kreditorSum = owed(t.now);
  const qismHref = (v?: string) => `${base}${qs({ dan: danKeep, sana: sp.sana, q: sp.q, tur: kind, qism: v, ...sumKeep })}`;
  const sumHref = (o: Partial<typeof sumKeep>) => `${base}${qs({ dan: danKeep, sana: sp.sana, q: sp.q, tur: kind, qism, ...sumKeep, ...o })}`;
  const sumLabel = smin != null && smax != null ? `${moneyShort(smin)} – ${moneyShort(smax)}` : smin != null ? `${moneyShort(smin)} dan ko'p` : smax != null ? `${moneyShort(smax)} gacha` : "";
  const sumSide = qism === "debitor" ? "qarzdorlik" : qism === "kreditor" ? "haqdorlik" : "qarzdorlik yoki haqdorlik";
  const SORT_LABEL: Record<string, string> = { qarz: `${d2} qarzdorlik bo'yicha`, avans: `${d2} haqdorlik bo'yicha`, sotuv: sup ? "olgan mahsulot bo'yicha" : "sotib olgan bo'yicha", tolov: "to'lagan bo'yicha", summa: "summa bo'yicha" };
  /** Ustun sarlavhasi: bosilsa — shu ustun bo'yicha katta summa tepada, yana bosilsa — nomi bo'yicha */
  const SortTh = ({ k, label, className, rowSpan }: { k: string; label: string; className: string; rowSpan?: number }) => (
    <th className={className} rowSpan={rowSpan} aria-sort={sort === k ? "descending" : "none"}>
      <Link href={sumHref({ sort: sort === k ? undefined : k })} title={sort === k ? "Nomi bo'yicha saralash (A → Z)" : "Katta summa tepada"}
        className={cn("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 ring-1 ring-black/10 transition dark:ring-white/15", sort === k ? "bg-[#2c4a6e] font-semibold text-[#fff] ring-[#2c4a6e]" : "hover:bg-black/5 dark:hover:bg-white/10")}>
        {label} <ArrowDownWideNarrow size={13} className={sort === k ? "" : "opacity-60"} />
      </Link>
    </th>
  );
  const sheetTitle = sup ? "Ta'minotchilar oldidagi qarzdorlik" : "Xaridorlar qarzdorligi";
  const soldLabel = sup ? "Bizga bergan" : "Sotib olgan";
  const paidLabel = sup ? "Biz to'lagan" : "To'lagan";
  const delta = (a: number, b: number) => (Math.abs(b - a) < 1 ? "davr boshidagidek" : `davr boshiga nisbatan ${b > a ? "+" : "−"}${moneyShort(Math.abs(b - a))}`);
  const col = sup ? "Ta'minotchi" : "Xaridor";
  const detail = (id: string, tab?: string) => `${base}/${id}${qs({ dan, gacha: sana, tab })}`;
  const excelRows = rows.map((r) => ({
    [col]: r.name, ...(sup ? {} : { "Mijoz turi": r.kind ? CUSTOMER_KIND_LABEL[r.kind] : "" }),
    [`Qarzdorlik ${d1}`]: owes(r.open) || null, [`Haqdorlik ${d1}`]: owed(r.open) || null,
    [soldLabel]: r.sold || null, [paidLabel]: r.paid || null,
    [`Qarzdorlik ${d2}`]: owes(r.now) || null, [`Haqdorlik ${d2}`]: owed(r.now) || null,
  }));
  // Debitorka / kreditorka summalari kasrsiz, so'mgacha yaxlitlab (2026-11-20, foydalanuvchi talabi) — Jami qatori bilan bir xil
  const Amt = ({ v }: { v: number }) => (Math.abs(v) < 0.5 ? null : <>{fmtJami(v)}</>);
  const num = "whitespace-nowrap px-3 py-1.5 text-right tabular";
  /** Katakdagi summa — bosilsa tafsilot (qatorning akt havolasi ustida) */
  const CellLink = ({ href, v, title }: { href: string; v: number; title: string }) => (Math.abs(v) < 0.5 ? null
    : <Link href={href} title={title} className="relative z-10 rounded px-0.5 underline decoration-slate-300 decoration-dotted underline-offset-4 hover:bg-white/70 hover:decoration-slate-700">{fmtJami(v)}</Link>);
  /** Summa katagi: chapda qalam (huquq bo'lsa), o'ngda summa */
  const Cell = ({ pen, children }: { pen?: React.ReactNode; children: React.ReactNode }) => (
    <div className="flex items-center justify-end gap-1">{pen}<span className="min-w-0">{children}</span></div>
  );
  const fromLabel = dateRu(s.monthStart);
  const span = 7;

  return (
    <div className="space-y-5">
      <Toolbar base={base} day={s.day} start={s.monthStart} allTime={s.allTime} sp={sp} keep={{ tur: kind, qism }} placeholder={sup ? "Ta'minotchi nomi…" : "Xaridor nomi…"}
        extra={<SumFilter on={sumOn} label={sumLabel} side={sumSide} smin={smin} smax={smax} sort={sort}
          presets={SUM_PRESETS.map((v) => ({ v, href: sumHref({ smin: String(v), smax: undefined }), on: smin === v && smax == null }))}
          clearHref={sumHref({ smin: undefined, smax: undefined })} />}
        entry={<>
          {transfer}
          {entryHref && (
            <Link href={entryHref} title={sup ? "Ta'minotchi qarzini Excel'dan yoki qo'lda kiritish, tahrirlash va kamaytirish" : "Mijoz qarzini Excel'dan yoki qo'lda kiritish, tahrirlash va kamaytirish"}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 text-sm font-medium text-white hover:bg-emerald-700">
              <FileSpreadsheet size={15} /> Qarzlarni kiritish
            </Link>
          )}
        </>}
        excel={<ExcelButton file={`${sheetTitle} ${sana}`} sheets={[{ name: sup ? "Ta'minotchilar" : "Xaridorlar", rows: excelRows }]} />} />

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatCard label={`Qarzdorlik (bizga qarz), ${d2}`} value={moneyShort(owes(t.now))} hint={delta(owes(t.open), owes(t.now))} icon={HandCoins} tone={owes(t.now) > owes(t.open) ? "danger" : "success"} href={qismHref("debitor")} />
        <StatCard label={`Haqdorlik (biz qarzmiz), ${d2}`} value={moneyShort(owed(t.now))} hint={delta(owed(t.open), owed(t.now))} icon={sup ? Truck : Wallet} tone="info" href={qismHref("kreditor")} />
        <StatCard label={`${soldLabel}, ${d1} – ${d2}`} value={moneyShort(t.sold)} hint={`${paidLabel}: ${moneyShort(t.paid)}`} icon={sup ? Truck : FileSpreadsheet} tone="brand" href={sumHref({ sort: "sotuv" })} />
        <StatCard label={sup ? "Ta'minotchilar" : "Xaridorlar"} value={fmtNum(named.length)} hint={`qarzdor: ${named.filter(isDebitor).length} · haqdor: ${named.filter(isKreditor).length}`} icon={sup ? Truck : UserRound} href={qismHref()} />
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-xs font-medium text-slate-500">Ko&apos;rinish:</span>
        <Chip href={qismHref()} on={!qism} count={named.length}>Hammasi</Chip>
        <Chip href={qismHref("debitor")} on={qism === "debitor"} count={named.filter(isDebitor).length}>Qarzdorlik · bizga qarz · {moneyShort(debitorSum)}</Chip>
        <Chip href={qismHref("kreditor")} on={qism === "kreditor"} count={named.filter(isKreditor).length}>Haqdorlik · biz qarzmiz · {moneyShort(kreditorSum)}</Chip>
        {sumOn && (
          <Link href={sumHref({ smin: undefined, smax: undefined })} title="Summa filtrini olib tashlash"
            className="inline-flex items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-[13px] font-medium text-amber-800 hover:bg-amber-100">
            Summa: {sumLabel} <span className="tabular text-xs text-amber-600">{rows.length}</span><X size={13} />
          </Link>
        )}
      </div>

      {!sup && s.kinds && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs font-medium text-slate-500">Mijoz turi:</span>
          <Chip href={`${base}${qs({ dan: danKeep, sana: sp.sana, q: sp.q, qism, ...sumKeep })}`} on={!kind} count={s.kinds.ALL}>Hammasi</Chip>
          <Chip href={`${base}${qs({ dan: danKeep, sana: sp.sana, q: sp.q, qism, ...sumKeep, tur: "CASH" })}`} on={kind === "CASH"} count={s.kinds.CASH}>Naqd</Chip>
          <Chip href={`${base}${qs({ dan: danKeep, sana: sp.sana, q: sp.q, qism, ...sumKeep, tur: "BANK" })}`} on={kind === "BANK"} count={s.kinds.BANK}>Perechisleniye</Chip>
        </div>
      )}

      {/* Varaq: sarlavha bloki + jadval — jadvaldagi «Xaridorlar qarzi» varag'idek */}
      <div className="overflow-hidden rounded-xl border border-[#d4d6cf] bg-white dark:border-slate-200">
        <div className="border-b border-[#d4d6cf] px-3 py-2 dark:border-slate-200">
          <div className="flex flex-wrap items-center justify-between gap-2 text-[15px] font-bold text-slate-900">
            <span>{company}</span>
            <span className="tabular">{s.allTime ? `${dateRu(s.day)} holatiga` : `${dateRu(s.monthStart)} – ${dateRu(s.day)}`}</span>
          </div>
          <div className="mt-1 text-[22px] font-bold leading-tight text-slate-900">
            {sheetTitle}{s.allTime ? "" : ` — ${monthName(s.day)}`}
            <InfoButton title={sheetTitle} size="md" className="ml-1">
              <p>Qarzdorlik — {sup ? "ta'minotchi" : "mijoz"} bizga qarz; haqdorlik — biz unga qarzmiz. Davr boshi + {soldLabel.toLowerCase()} − {paidLabel.toLowerCase()} = davr oxiri.</p>
              <p>{soldLabel} yoki {paidLabel.toLowerCase()} summasini bosing — nima, qachon va qancha ekani, har yozuvni tahrirlash yoki o&apos;chirish. Nomni bosing — akt sverka.</p>
              <p>Har ustundagi qalam: nom — {sup ? "nomini" : "nomi va mijoz turini (naqd / perechisleniye)"} tahrirlash; davr boshi — boshlang&apos;ich qoldiqni tuzatish; {soldLabel.toLowerCase()} va {paidLabel.toLowerCase()} — tafsilotda har yozuvni tahrirlash; davr oxiri — qoldiqni tuzatish.</p>
              <p>
                {sup
                  ? "Hisob: boshlang'ich qoldiq + kirim hujjatlari (QQS va dostavka bilan) − ta'minotchiga to'langan pul."
                  : "Hisob: boshlang'ich qoldiq + schyotlar va Realizatsiyadagi barcha sotuv (Naqd, Perechisleniye, Qarz) − to'lovlar va kassada shu mijozga bog'langan kirim ± boshqa mijoz to'lagan qarz. Kassa yozuvida «Kimdan» nomi mijoz nomiga mos kelsa, o'zi bog'lanadi."}
              </p>
              {s.allTime && <p>Davr — boshidan; «Dan» sanasini tanlasangiz, shu kungacha bo&apos;lgan hammasi davr boshidagi qoldiqqa yig&apos;iladi.</p>}
            </InfoButton>
          </div>
          <div className="mt-0.5 text-[13px] text-slate-500">Saralash: {sort ? `${SORT_LABEL[sort]} (katta → kichik)` : "nomi bo'yicha (A → Z)"}</div>
        </div>
        <div className="overflow-auto" style={{ maxHeight: "70vh" }}>
          <table className="w-full min-w-[980px] border-collapse text-[14px] text-slate-900">
            <thead className="sticky top-0 z-20">
              <tr>
                <th rowSpan={2} className={cn(SH.line, SH.head, "px-3 py-1.5 text-left align-top font-normal")}>{col}</th>
                <th colSpan={2} className={cn(SH.line, SH.head, "px-3 py-1.5 text-center font-normal")}>{s.allTime ? "Boshlang'ich qoldiq" : `${d1} holatiga`}</th>
                <SortTh k="sotuv" label={soldLabel} rowSpan={2} className={cn(SH.line, SH.headMid, "w-[13%] px-2 py-1 text-center align-middle font-normal")} />
                <SortTh k="tolov" label={paidLabel} rowSpan={2} className={cn(SH.line, SH.headMid, "w-[13%] px-2 py-1 text-center align-middle font-normal")} />
                <th colSpan={2} className={cn(SH.line, SH.headNow, SH.split, "px-3 py-1.5 text-center font-normal")}>{d2} holatiga</th>
              </tr>
              <tr>
                <th className={cn(SH.line, SH.head, "w-[12%] px-3 py-1 text-center font-normal")}>Qarzdorlik</th>
                <th className={cn(SH.line, SH.head, "w-[12%] px-3 py-1 text-center font-normal")}>Haqdorlik</th>
                <SortTh k="qarz" label="Qarzdorlik" className={cn(SH.line, SH.headNow, SH.split, "w-[13%] px-2 py-1 text-center font-normal")} />
                <SortTh k="avans" label="Haqdorlik" className={cn(SH.line, SH.headNow, "w-[13%] px-2 py-1 text-center font-normal")} />
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={span} className={cn(SH.line, "px-4 py-10 text-center text-sm text-slate-500")}>{sp.q || qism ? "Filtr bo'yicha hech narsa topilmadi" : "Bu davrda hisob-kitob yo'q"}</td></tr>}
              {rows.map((r) => {
                const open = owes(r.open) - owed(r.open), now = owes(r.now) - owed(r.now);
                const openPen = (side: "qarz" | "haq") => canFix && <OpeningFixButton who={who} id={r.id} name={r.name} from={dan} fromLabel={fromLabel} to={sana} allTime={s.allTime} now={open} side={side} />;
                const nowPen = (side: "qarz" | "haq") => canFix && <DebtFixButton who={who} id={r.id} name={r.name} day={sana} now={now} side={side} />;
                return (
                  <tr key={r.id} className="group relative cursor-pointer">
                    <td className={cn(SH.line, SH.cell, SH.hover, "min-w-56 px-3 py-1.5")}>
                      <div className="flex items-center gap-1">
                        {/* Butun qator — akt sverka havolasi (after: qatorni qoplaydi); summalar o'z tafsilotiga */}
                        <Link href={detail(r.id)} className="min-w-0 after:absolute after:inset-0 after:content-['']" title={`${r.name} — akt sverka`}>{r.name}</Link>
                        {!sup && !kind && r.kind === "CASH" && <span className="shrink-0"><Badge color="green" dot={false}>naqd</Badge></span>}
                        {canEditParty && <span className="ml-auto"><PartyEditButton who={who} id={r.id} name={r.name} kind={r.kind} kindSet={r.kindSet} cardHref={sup ? `/suppliers/${r.id}` : `/customers/${r.id}`} /></span>}
                      </div>
                    </td>
                    <td className={cn(SH.line, SH.cell, num, SH.hover)}><Cell pen={openPen("qarz")}><CellLink href={detail(r.id, "qoldiq")} v={owes(r.open)} title="Boshlang'ich qoldiq — tafsilot" /></Cell></td>
                    <td className={cn(SH.line, SH.cell, num, SH.hover)}><Cell pen={openPen("haq")}><CellLink href={detail(r.id, "qoldiq")} v={owed(r.open)} title="Boshlang'ich qoldiq — tafsilot" /></Cell></td>
                    <td className={cn(SH.line, SH.cellMid, num, SH.hover)}><Cell pen={canFix && <PencilLink href={detail(r.id, "sotuv")} title={`${soldLabel} — har yozuvni tahrirlash yoki o'chirish`} />}><CellLink href={detail(r.id, "sotuv")} v={r.sold} title={`${soldLabel} — mahsulotlar, sana, miqdor`} /></Cell></td>
                    <td className={cn(SH.line, SH.cellMid, num, SH.hover, r.paid < 0 && "text-red-700")}><Cell pen={canFix && <PencilLink href={detail(r.id, "tolov")} title={`${paidLabel} — har to'lovni tahrirlash yoki o'chirish`} />}><CellLink href={detail(r.id, "tolov")} v={r.paid} title={`${paidLabel} — to'lovlar`} /></Cell></td>
                    <td className={cn(SH.line, SH.cellNow, SH.split, num, SH.hover, owes(r.now) >= 1 && "font-semibold text-red-700")}><Cell pen={nowPen("qarz")}><Amt v={owes(r.now)} /></Cell></td>
                    <td className={cn(SH.line, SH.cellNow, num, SH.hover, owed(r.now) >= 1 && "font-semibold text-emerald-700")}><Cell pen={nowPen("haq")}><Amt v={owed(r.now)} /></Cell></td>
                  </tr>
                );
              })}
            </tbody>
            {rows.length > 0 && (
              <tfoot className="sticky bottom-0 z-20">
                <tr className="font-bold">
                  <td className={cn(SH.line, SH.head, "px-3 py-2")}>Jami</td>
                  <td className={cn(SH.line, SH.head, num, "py-2")}>{fmtJami(owes(ft.open))}</td>
                  <td className={cn(SH.line, SH.head, num, "py-2")}>{fmtJami(owed(ft.open))}</td>
                  <td className={cn(SH.line, SH.headMid, num, "py-2")}>{fmtJami(ft.sold)}</td>
                  <td className={cn(SH.line, SH.headMid, num, "py-2")}>{fmtJami(ft.paid)}</td>
                  <td className={cn(SH.line, SH.headNow, SH.split, num, "py-2")}>{fmtJami(owes(ft.now))}</td>
                  <td className={cn(SH.line, SH.headNow, num, "py-2")}>{fmtJami(owed(ft.now))}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
}

// ───────────────────── Mijozlar qarzi — qancha vaqtdan beri turibdi ─────────────────────

const LEVEL = [
  { bar: "bg-emerald-400", cell: "bg-emerald-50/70", badge: "green" },
  { bar: "bg-blue-400", cell: "bg-blue-50/70", badge: "blue" },
  { bar: "bg-amber-400", cell: "bg-amber-50/80", badge: "amber" },
  { bar: "bg-red-500", cell: "bg-red-50 text-red-700 font-semibold", badge: "red" },
] as const satisfies readonly { bar: string; cell: string; badge: BadgeColor }[];

export function DebtAgeView({ r, sp, base }: { r: AgeReport; sp: SP; base: string }) {
  const holat = sp.holat != null && /^[0-3]$/.test(sp.holat) ? Number(sp.holat) : null;
  const rows = filterName(r.rows, sp.q).filter((x) => holat == null || x.level === holat);
  const since = r.since ? dm(r.since) : null;
  const noPay = (x: AgeReport["rows"][number]) => (x.daysNoPay != null ? fmtNum(x.daysNoPay) : since ? `${since} dan beri to'lamagan` : "to'lamagan");
  const excelRows = rows.map((x) => ({
    Mijoz: x.name, "Jami qarz, so'm": x.debt, ...Object.fromEntries(AGE_LABELS.map((l, i) => [l, x.buckets[i] || null])),
    "Oxirgi xarid": x.lastSale ? date(x.lastSale) : "", "Oxirgi to'lov": x.lastPay ? date(x.lastPay) : "", "To'lovsiz necha kun": noPay(x), "Sotuvchi (oxirgi)": x.seller ?? "", Holat: AGE_STATUS[x.level]!,
  }));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[17px] font-bold text-slate-900">
          Mijozlar qarzi — qancha vaqtdan beri turibdi
          <InfoButton title="Mijozlar qarzi — qancha vaqtdan beri turibdi" className="ml-1">
            <p>To&apos;lov eng eski qarzni yopadi — qolgan qarz eng oxirgi olingan tovarlar.</p>
            <p>Naqd va perechisleniye birga. Qarz yoshi — to&apos;lanmagan schyot sanasidan {date(r.day)} gacha. Holat — mijozning eng eski to&apos;lanmagan qarzi qaysi oraliqda.</p>
          </InfoButton>
        </h2>
      </div>
      <Toolbar base={base} day={r.day} sp={sp} keep={{ holat: sp.holat }} placeholder="Mijoz nomi…"
        excel={<ExcelButton file={`Mijozlar qarzi ${isoDate(r.day)}`} sheets={[{ name: "Qarz yoshi", rows: excelRows }]} />} />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 2xl:grid-cols-5">
        <StatCard label="Jami qarz (bizga)" value={moneyShort(r.total)} hint={fmtNum(r.total)} icon={HandCoins} tone="brand" href={`${base}${qs({ sana: sp.sana, q: sp.q })}`} />
        <StatCard label="30 kundan eski" value={moneyShort(r.over30)} hint={r.total ? `${fmtNum((r.over30 / r.total) * 100, 0)}% qarz` : undefined} icon={Hourglass} tone={r.over30 ? "warning" : "success"} href={`${base}${qs({ sana: sp.sana, q: sp.q, holat: "2" })}`} />
        <StatCard label="60 kundan eski" value={moneyShort(r.over60)} hint={r.total ? `${fmtNum((r.over60 / r.total) * 100, 0)}% qarz` : undefined} icon={Hourglass} tone={r.over60 ? "danger" : "success"} href={`${base}${qs({ sana: sp.sana, q: sp.q, holat: "3" })}`} />
        <StatCard label="Qarzdorlar soni" value={fmtNum(r.debtors)} hint={`60 kundan eski: ${r.levels[3]}`} icon={Users} href={`${base}${qs({ sana: sp.sana })}`} />
        <StatCard label="Eng katta qarzdor" value={r.top ? moneyShort(r.top.debt) : "—"} hint={r.top?.name} icon={Crown} tone={r.top ? "warning" : "default"} href={r.top ? `${base}${qs({ sana: sp.sana, q: r.top.name })}` : undefined} />
      </div>

      {r.total > 0 && (
        <Card>
          <div className="mb-3 flex items-baseline justify-between gap-2">
            <div className="text-[14px] font-semibold text-slate-900">Qarz yoshi bo&apos;yicha taqsimot <span className="font-normal text-slate-400">· bosib filtrlang</span></div>
            <div className="text-xs text-slate-500">{date(r.day)} holatiga</div>
          </div>
          <div className="flex h-4 w-full overflow-hidden rounded-full bg-slate-100">
            {r.buckets.map((v, i) => v > 0 && <div key={i} className={LEVEL[i]!.bar} style={{ width: `${(v / r.total) * 100}%` }} title={`${AGE_LABELS[i]}: ${fmtNum(v)}`} />)}
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
            {AGE_LABELS.map((l, i) => {
              const on = holat === i;
              return (
                <Link key={l} href={`${base}${qs({ sana: sp.sana, q: sp.q, holat: on ? undefined : String(i) })}`}
                  className={cn("rounded-xl border px-3 py-2.5 transition hover:shadow-sm", on ? "border-slate-900 ring-1 ring-slate-900" : "border-slate-200")}>
                  <div className="flex items-center gap-2 text-[12px] font-medium text-slate-500"><span className={cn("h-2.5 w-2.5 rounded-full", LEVEL[i]!.bar)} />{l}</div>
                  <div className={cn("mt-1 text-[17px] font-bold tabular", i === 3 && r.buckets[i] ? "text-red-600" : "text-slate-900")}>{moneyShort(r.buckets[i]!)}</div>
                  <div className="text-[12px] text-slate-500">{r.total ? fmtNum((r.buckets[i]! / r.total) * 100, 0) : 0}% · {r.levels[i]} ta mijoz</div>
                </Link>
              );
            })}
          </div>
        </Card>
      )}

      {holat != null && (
        <div className="flex flex-wrap items-center gap-2 text-[13px] text-slate-600">
          Faqat <Badge color={LEVEL[holat]!.badge}>{AGE_STATUS[holat]}</Badge> — {rows.length} ta mijoz
          <Link href={`${base}${qs({ sana: sp.sana, q: sp.q })}`} className="font-medium text-slate-900 underline">Hammasini ko&apos;rsatish</Link>
        </div>
      )}

      <Table maxHeight="70vh">
        <thead>
          <tr>
            <Th>Mijoz</Th>
            <Th right>Jami qarz, so&apos;m</Th>
            {AGE_LABELS.map((l) => <Th key={l} right>{l}</Th>)}
            <Th>Oxirgi xarid</Th>
            <Th>Oxirgi to&apos;lov</Th>
            <Th right>To&apos;lovsiz, kun</Th>
            <Th>Sotuvchi (oxirgi)</Th>
            <Th>Holat</Th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={11} className="px-4 py-10 text-center text-sm text-slate-500">{r.debtors ? "Filtr bo'yicha mijoz yo'q" : "Qarzdor mijoz yo'q"}</td></tr>}
          {rows.map((x) => (
            <Tr key={x.id}>
              <Td><Link href={`/customers/${x.id}`} className="block max-w-64 truncate hover:underline" title={x.name}>{x.name}</Link></Td>
              <Td right className="font-semibold text-slate-900">{fmtNum(x.debt)}</Td>
              {x.buckets.map((v, i) => <Td key={i} right className={cn(v >= 1 && LEVEL[i]!.cell)}><Num v={v} /></Td>)}
              <Td className="whitespace-nowrap">{x.lastSale ? date(x.lastSale) : <span className="text-slate-300">—</span>}</Td>
              <Td className="whitespace-nowrap">{x.lastPay ? date(x.lastPay) : <span className="text-slate-300">—</span>}</Td>
              <Td right className={cn(x.daysNoPay == null ? "text-[12px] text-red-600" : x.daysNoPay > 30 ? "font-semibold text-red-600" : "")}>{noPay(x)}</Td>
              <Td className="whitespace-nowrap text-slate-600">{x.seller ?? <span className="text-slate-300">—</span>}</Td>
              <Td><Badge color={LEVEL[x.level]!.badge}>{AGE_STATUS[x.level]}</Badge></Td>
            </Tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}

// ───────────────────── Akt sverka — tepadagi qisqa statistika (chop etilmaydi) ─────────────────────

/** Saldo: musbat — ular bizga qarz, manfiy — biz ularga qarzmiz (akt ishorasi, `lib/fin-report/akt.ts`). */
const saldoHint = (v: number) => (v > 0.005 ? "ular bizga qarz" : v < -0.005 ? "biz ularga qarzmiz" : "qarz yo'q");

export function AktStats({ akt }: { akt: Akt }) {
  const sup = akt.who === "supplier";
  const nDebit = akt.lines.filter((l) => l.debit > 0).length, nCredit = akt.lines.filter((l) => l.credit > 0).length;
  return (
    <div className="mx-auto mb-4 grid max-w-4xl grid-cols-2 gap-3 md:grid-cols-4 print:hidden">
      <StatCard label={`Davr boshi saldo, ${dateShort(akt.from)}`} value={moneyShort(Math.abs(akt.opening))} hint={saldoHint(akt.opening)} icon={Scale} />
      <StatCard label={sup ? "To'lovimiz (debet)" : "Sotuv (debet)"} value={moneyShort(akt.debit)} hint={`${nDebit} ta yozuv`} icon={sup ? Wallet : FileSpreadsheet} tone="info" />
      <StatCard label={sup ? "Kirim hujjatlari (kredit)" : "To'lovlar (kredit)"} value={moneyShort(akt.credit)} hint={`${nCredit} ta yozuv`} icon={sup ? Truck : Wallet} tone="success" />
      <StatCard label={`Davr oxiri saldo, ${dateShort(akt.to)}`} value={moneyShort(Math.abs(akt.closing))} hint={saldoHint(akt.closing)} icon={HandCoins} tone={Math.abs(akt.closing) > 0.005 ? "warning" : "success"} />
    </div>
  );
}
