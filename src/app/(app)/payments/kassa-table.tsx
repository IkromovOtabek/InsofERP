"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowDownLeft, ArrowUpRight, Banknote, Landmark, Search, Wallet, X } from "lucide-react";
import { Badge, Card, ColumnFilter, Empty, Sheet, SheetFoot, SheetHead, SheetTd, SheetTh, StatCard, type FilterOption, type SortDir } from "@/components/ui";
import { CustomerName } from "@/components/customer-name";
import { money } from "@/lib/format";
import { cn } from "@/lib/utils";
import { CashRow } from "./cash-detail";
import type { CashRowKind } from "./row-detail";
import { ExcelButton } from "../logistika/excel-button";

export type KassaAccount = { id: string; name: string; type: "CASH" | "BANK" };

/** Jurnal qatori — serverda tayyorlanadi (`kassa-jurnal.tsx`), filtr va saralash shu yerda, brauzerda. */
export type KassaRow = {
  /** `day` — YYYY-MM-DD (filtr qiymati), `at` — ekrandagi sana (soati bilan), `ts`/`cts` — saralash */
  key: string; day: string; at: string; ts: number; cts: number;
  accountId: string; account: string; method: "CASH" | "BANK";
  inc: number; exp: number; transfer: boolean;
  manba: string; sub: string; who: string; whoHref?: string; blacklisted?: boolean; contracted?: boolean;
  note: string; by: string; href?: string; cancelled: string | null;
  /** Qator bosilganda ochiladigan tafsilot: perekit oyog'i — o'tkazma hujjati, qolganlari — yozuvning o'zi */
  kind: CashRowKind; rowId: string;
};

const METHOD = { CASH: "Naqd", BANK: "Perechisleniye" } as const;
const BLANK = "(Bo'sh)";
/** Ekranda bir vaqtda chiziladigan qatorlar; jami va Excel — filtrdagi hamma qator bo'yicha */
const MAX_RENDER = 1000;

/** YYYY-MM-DD → `lib/format` dagi `date()` ko'rinishi (DD/MM/YYYY) */
const dayText = (iso: string) => iso.split("-").reverse().join("/");

type ColKey = "sana" | "hisob" | "usul" | "kirim" | "chiqim" | "manba" | "sub" | "who" | "izoh";
type Col = { key: ColKey; title: string; kind: "date" | "num" | "text"; val: (r: KassaRow) => string };
const COLS: Col[] = [
  { key: "sana", title: "Sana", kind: "date", val: (r) => r.day },
  { key: "hisob", title: "Hisob", kind: "text", val: (r) => r.account },
  { key: "usul", title: "To'lov turi", kind: "text", val: (r) => METHOD[r.method] },
  { key: "kirim", title: "Kirim", kind: "num", val: (r) => (r.inc ? String(r.inc) : "") },
  { key: "chiqim", title: "Chiqim", kind: "num", val: (r) => (r.exp ? String(r.exp) : "") },
  { key: "manba", title: "Manba", kind: "text", val: (r) => r.manba },
  { key: "sub", title: "Sub manba", kind: "text", val: (r) => r.sub },
  { key: "who", title: "Kontragent", kind: "text", val: (r) => r.who },
  { key: "izoh", title: "Izoh", kind: "text", val: (r) => r.note },
];
const COL = Object.fromEntries(COLS.map((c) => [c.key, c])) as Record<ColKey, Col>;

const SORT_TEXT: Record<Col["kind"], [string, string]> = {
  date: ["Eskidan yangiga", "Yangidan eskiga"],
  num: ["Kichikdan kattaga", "Kattadan kichikka"],
  text: ["A → Z", "Z → A"],
};

const optLabel = (c: Col, v: string) => (!v ? BLANK : c.kind === "num" ? money(Number(v)) : c.kind === "date" ? dayText(v) : v);

/** Qatorlarni saralash: sana — sana, keyin kiritilgan vaqt; summa — son; matn — alifbo */
const rowCmp = (c: Col) => (a: KassaRow, b: KassaRow) =>
  c.kind === "date" ? a.ts - b.ts || a.cts - b.cts
  : c.key === "kirim" ? a.inc - b.inc
  : c.key === "chiqim" ? a.exp - b.exp
  : c.val(a).localeCompare(c.val(b));

/** Filtr oynasidagi qiymatlar tartibi: sana — yangisi tepada, summa — o'sish, matn — alifbo; bo'sh — oxirida */
const optCmp = (c: Col) => (a: FilterOption, b: FilterOption) =>
  !a.value !== !b.value ? (a.value ? -1 : 1)
  : c.kind === "date" ? b.value.localeCompare(a.value)
  : c.kind === "num" ? Number(a.value) - Number(b.value)
  : a.label.localeCompare(b.label);

const KINDS = [
  { key: "", label: "Hammasi" },
  { key: "in", label: "Kirim" },
  { key: "out", label: "Chiqim" },
  { key: "perekit", label: "Perekit" },
] as const;
type Kind = (typeof KINDS)[number]["key"];

/**
 * Kassa jurnali jadvali: tepada filtr (hisob — Naqd / Perechisleniye va har bir bank katakchasi, «Hamma banklar»;
 * turi; qidiruv), har ustunda Excel kabi filtr va saralash, pastda tanlangan kun(lar) jami (yopishqoq qator).
 * Sana oralig'i serverda (sahifa tepasida — `KassaDateBar`), qolgan filtrlar brauzerda — darhol ishlaydi.
 */
export function KassaJournal({ rows, accounts, from, to, initial, truncated }: {
  rows: KassaRow[]; accounts: KassaAccount[]; from: string; to: string;
  initial: { account?: string; kind?: string; manba?: string; q?: string };
  /** Davrda yuklash chegarasidan ko'p yozuv bo'lsa — nechtasi bor edi */
  truncated?: number;
}) {
  const [accSel, setAccSel] = useState<Set<string>>(() => new Set(initial.account ? [initial.account] : []));
  const [kind, setKind] = useState<Kind>(() => (KINDS.some((k) => k.key === initial.kind) ? (initial.kind as Kind) : ""));
  const [q, setQ] = useState(initial.q ?? "");
  const [filters, setFilters] = useState<Partial<Record<ColKey, Set<string>>>>(() => (initial.manba ? { manba: new Set([initial.manba]) } : {}));
  const [sort, setSort] = useState<{ key: ColKey; dir: SortDir }>({ key: "sana", dir: "desc" });
  // Tepadagi sana o'zgarsa (sahifa qayta yuklanmaydi — filtrlar saqlanadi) «Sana» ustuni filtri tozalanadi: eski kunlar yangi davrda yo'q
  const [period0, setPeriod0] = useState(`${from}_${to}`);
  if (period0 !== `${from}_${to}`) {
    setPeriod0(`${from}_${to}`);
    setFilters((f) => { const n = { ...f }; delete n.sana; return n; });
  }

  const qn = q.trim().toLowerCase();
  // Tepadagi filtrlar (hisob, turi, qidiruv) — ustun filtrlari qiymatlari shulardan keyingi qatorlardan olinadi
  const base = useMemo(() => rows.filter((r) =>
    (accSel.size === 0 || accSel.has(r.accountId))
    && (!kind || (kind === "perekit" ? r.transfer : !r.transfer && (kind === "in" ? r.inc > 0 : r.exp > 0)))
    && (!qn || [r.who, r.note, r.manba, r.sub, r.account].some((x) => x.toLowerCase().includes(qn))),
  ), [rows, accSel, kind, qn]);

  const passes = useCallback((r: KassaRow, except?: ColKey) => COLS.every((c) => {
    const f = c.key === except ? undefined : filters[c.key];
    return !f || f.has(c.val(r));
  }), [filters]);

  const shown = useMemo(() => {
    const cmp = rowCmp(COL[sort.key]);
    const dir = sort.dir === "asc" ? 1 : -1;
    return base.filter((r) => passes(r)).sort((a, b) => dir * cmp(a, b) || b.cts - a.cts);
  }, [base, passes, sort]);

  // Excel'dagidek: ustun qiymatlari — shu ustundan boshqa hamma filtrdan o'tgan qatorlardan
  const optionsFor = (c: Col) => () => {
    const m = new Map<string, number>();
    for (const r of base) if (passes(r, c.key)) { const v = c.val(r); m.set(v, (m.get(v) ?? 0) + 1); }
    return [...m].map(([value, count]) => ({ value, label: optLabel(c, value), count })).sort(optCmp(c));
  };
  const setFilter = (k: ColKey, v: Set<string> | null) => setFilters((f) => { const n = { ...f }; if (v) n[k] = v; else delete n[k]; return n; });

  // Jami — perekit (pul kompaniya ichida ko'chgan) va bekor qilinganlarsiz; perekit alohida ko'rsatiladi
  let inc = 0, exp = 0, trIn = 0, trOut = 0;
  for (const r of shown) {
    if (r.cancelled) continue;
    if (r.transfer) { trIn += r.inc; trOut += r.exp; } else { inc += r.inc; exp += r.exp; }
  }
  const days = filters.sana;
  const period = days?.size === 1 ? dayText([...days][0]) : days ? `${days.size} kun` : from === to ? dayText(from) : `${dayText(from)} — ${dayText(to)}`;

  const colFilters = COLS.filter((c) => filters[c.key]);
  const anyFilter = accSel.size > 0 || !!kind || !!qn || colFilters.length > 0;
  const clearAll = () => { setAccSel(new Set()); setKind(""); setQ(""); setFilters({}); };
  const view = shown.slice(0, MAX_RENDER);

  // Excel — ekrandagi filtr va tartibdagi BARCHA qatorlar (1000 cheklovisiz), oxirida jami
  const excel = async () => [{
    name: "Kassa jurnali",
    rows: [
      ...shown.map((r) => ({
        Sana: dayText(r.day), Hisob: r.account, "To'lov turi": METHOD[r.method], Kirim: r.inc || null, Chiqim: r.exp || null,
        Manba: r.manba, "Sub manba": r.sub || null, Kontragent: r.who || null, Izoh: r.note || null, Kiritdi: r.by || null,
        Holat: r.cancelled ? `Bekor qilingan: ${r.cancelled}` : null,
      })),
      { Sana: "Jami", Hisob: period, "To'lov turi": "", Kirim: inc, Chiqim: exp, Manba: "perekit va bekor qilinganlarsiz", "Sub manba": null, Kontragent: null, Izoh: null, Kiritdi: null, Holat: null },
    ],
  }];

  const th = (c: Col, opts: { right?: boolean; tone?: "plain" | "green" | "red"; className?: string } = {}) => (
    <SheetTh key={c.key} tone={opts.tone ?? "plain"} className={cn("text-left", opts.className)}>
      <div className={cn("flex items-center gap-1.5", opts.right ? "justify-end" : "justify-between")}>
        <span className="inline-flex items-center gap-1">
          {c.title}
          {sort.key === c.key && <span className="text-[11px] text-slate-500" aria-label={sort.dir === "asc" ? "o'sish bo'yicha" : "kamayish bo'yicha"}>{sort.dir === "asc" ? "↑" : "↓"}</span>}
        </span>
        <ColumnFilter label={c.title} options={optionsFor(c)} selected={filters[c.key]} onChange={(v) => setFilter(c.key, v)}
          sort={sort.key === c.key ? sort.dir : null} onSort={(dir) => setSort({ key: c.key, dir })} sortText={SORT_TEXT[c.kind]} />
      </div>
    </SheetTh>
  );

  return (
    <>
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label="Kirim" value={money(inc)} icon={ArrowDownLeft} tone="success" hint={period} />
        <StatCard label="Chiqim" value={money(exp)} icon={ArrowUpRight} tone={exp > 0 ? "danger" : "default"} hint={period} />
        <StatCard label="Sof oqim" value={money(inc - exp)} icon={Wallet} tone={inc - exp >= 0 ? "success" : "danger"} hint="perekit va bekor qilinganlarsiz" />
      </div>

      <div className="mb-2 flex flex-wrap items-end justify-between gap-3">
        <h2 className="min-w-0 flex-1 font-semibold">
          Kassa jurnali <span className="text-sm font-normal text-slate-500">· {shown.length} ta yozuv{shown.length !== rows.length ? ` (${rows.length} tadan)` : ""}{shown.length > view.length ? ` — oxirgi ${view.length} tasi ko'rsatilgan, Excel'da hammasi` : ""}</span>
          <span className="block text-xs font-normal text-slate-500">Ustun nomi yonidagi tugma — Excel kabi filtr va saralash. Qatorni bosing — kim va qachon kiritgani, amallar tarixi; tahrirlash, bekor qilish va o&apos;chirish (ruxsatga qarab)</span>
        </h2>
        <ExcelButton file={`Kassa jurnali ${from} — ${to}`} load={excel} />
      </div>

      {truncated != null && (
        <p className="mb-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">Davrda {truncated} ta yozuv bor — oxirgi {rows.length} tasi yuklandi. To&apos;liq ko&apos;rish uchun sana oralig&apos;ini toraytiring.</p>
      )}

      {/* Filtr — jurnal (ikkinchi ro'yxat) ustida */}
      <Card padded={false} className="mb-3 space-y-2.5 px-3 py-2.5 text-sm">
        <AccountFilter accounts={accounts} sel={accSel} setSel={setAccSel} />
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-14 shrink-0 text-xs font-semibold text-slate-500">Turi</span>
          <div className="inline-flex rounded-lg border border-slate-200 p-0.5" role="group" aria-label="Yozuv turi">
            {KINDS.map((k) => (
              <button key={k.key} type="button" onClick={() => setKind(k.key)} aria-pressed={kind === k.key}
                className={cn("rounded-md px-3 py-1 text-[13px] font-medium transition", kind === k.key ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100")}>{k.label}</button>
            ))}
          </div>
          <div className="relative">
            <Search size={14} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-slate-400" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Kontragent, izoh, manba…" aria-label="Qidiruv"
              className="h-8 w-56 rounded-lg border border-slate-300 bg-white pr-2 pl-8 text-[13px] text-slate-900 placeholder:text-slate-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/25 focus:outline-none" />
          </div>
          {colFilters.map((c) => (
            <button key={c.key} type="button" onClick={() => setFilter(c.key, null)} title="Ustun filtrini olib tashlash"
              className="inline-flex items-center gap-1 rounded-full border border-brand-300 bg-brand-50 px-2 py-0.5 text-xs font-medium text-slate-800 hover:bg-brand-100">
              {c.title}: {filters[c.key]!.size === 1 ? optLabel(c, [...filters[c.key]!][0]) : `${filters[c.key]!.size} ta`} <X size={12} />
            </button>
          ))}
          {anyFilter && (
            <button type="button" onClick={clearAll} className="ml-auto text-xs font-medium text-slate-500 hover:text-slate-900 hover:underline">Filtrlarni tozalash</button>
          )}
        </div>
      </Card>

      <Sheet lang="uz" maxHeight="75vh">
        <SheetHead>
          <tr>
            <SheetTh tone="plain" className="w-10">№</SheetTh>
            {th(COL.sana)}
            {th(COL.hisob)}
            {th(COL.usul)}
            {th(COL.kirim, { right: true, tone: "green" })}
            {th(COL.chiqim, { right: true, tone: "red" })}
            {th(COL.manba)}
            {th(COL.sub)}
            {th(COL.who)}
            {th(COL.izoh, { className: "min-w-72" })}
          </tr>
        </SheetHead>
        <tbody>
          {view.length === 0 && <Empty text={rows.length ? "Filtrga mos yozuv yo'q" : "Davrda kirim-chiqim yo'q"} />}
          {view.map((r, i) => {
            const amt = r.cancelled ? "text-slate-400 line-through" : r.transfer ? "text-sky-700" : "";
            return (
              <CashRow key={r.key} kind={r.kind} id={r.rowId} className={r.cancelled ? "bg-slate-50/60 text-slate-400" : undefined}>
                <SheetTd center muted>{i + 1}</SheetTd>
                <SheetTd className="whitespace-nowrap">{r.at}</SheetTd>
                <SheetTd className="whitespace-nowrap">{r.account}</SheetTd>
                <SheetTd className="whitespace-nowrap"><Badge color={r.method === "CASH" ? "amber" : "slate"} dot={false}>{METHOD[r.method]}</Badge></SheetTd>
                <SheetTd right tone="green" className={cn("font-medium", amt || "text-emerald-700")}>{r.inc ? money(r.inc) : ""}</SheetTd>
                <SheetTd right tone="red" className={cn("font-medium", amt || "text-red-600")}>{r.exp ? money(r.exp) : ""}</SheetTd>
                <SheetTd className="whitespace-nowrap">
                  {r.href ? <Link href={r.href} className="font-medium text-slate-800 hover:underline">{r.manba} →</Link> : r.manba}
                  {r.cancelled && <span className="mt-1 block"><Badge color="slate">Bekor qilingan</Badge></span>}
                </SheetTd>
                <SheetTd className="whitespace-nowrap text-slate-600">{r.sub}</SheetTd>
                <SheetTd>{r.who ? <CustomerName name={r.who} blacklisted={!!r.blacklisted} contracted={!!r.contracted} href={r.whoHref} /> : <span className="text-slate-300">—</span>}</SheetTd>
                <SheetTd className="text-slate-600">
                  {r.note}
                  {r.cancelled && <span className="block text-xs text-red-600">Bekor qilindi: {r.cancelled}</span>}
                </SheetTd>
              </CashRow>
            );
          })}
        </tbody>
        <SheetFoot sticky>
          <tr>
            <SheetTd colSpan={4} className="whitespace-nowrap">Jami · {period} <span className="font-normal text-slate-500">· {shown.length} ta yozuv</span></SheetTd>
            <SheetTd right className="text-emerald-700">{money(inc)}</SheetTd>
            <SheetTd right className="text-red-600">{money(exp)}</SheetTd>
            <SheetTd colSpan={4} className="whitespace-nowrap">
              Sof oqim: <span className={inc - exp >= 0 ? "text-emerald-700" : "text-red-600"}>{money(inc - exp)}</span>
              {(trIn > 0 || trOut > 0) && <span className="ml-3 font-normal text-sky-700">Perekit: +{money(trIn)} / −{money(trOut)}</span>}
              <span className="ml-3 text-xs font-normal text-slate-500">perekit va bekor qilinganlar jamiga kirmaydi</span>
            </SheetTd>
          </tr>
        </SheetFoot>
      </Sheet>
    </>
  );
}

/**
 * Hisob filtri: «Naqd» va «Perechisleniye» katakchalari (guruhni butunlay tanlaydi), Perechisleniye yonida har bir bank
 * o'z katakchasi bilan, «Hamma banklar» — faqat bank hisoblari, «Barcha hisoblar» — filtrsiz. Hech narsa tanlanmasa — hammasi.
 */
function AccountFilter({ accounts, sel, setSel }: { accounts: KassaAccount[]; sel: Set<string>; setSel: (s: Set<string>) => void }) {
  const cash = accounts.filter((a) => a.type === "CASH");
  const banks = accounts.filter((a) => a.type === "BANK");
  const set = (ids: string[], on: boolean) => { const n = new Set(sel); for (const id of ids) if (on) n.add(id); else n.delete(id); setSel(n); };
  const onlyBanks = banks.length > 0 && sel.size === banks.length && banks.every((b) => sel.has(b.id));

  // `each` — har bir hisob o'z katakchasi bilan (banklar doim; kassa — bittadan ko'p bo'lsa)
  const group = (label: string, icon: typeof Banknote, list: KassaAccount[], allTitle: string, each: boolean) => {
    const k = list.filter((a) => sel.has(a.id)).length;
    const Icon = icon;
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-slate-200 px-2.5 py-1">
        <label className="inline-flex cursor-pointer items-center gap-1.5 font-semibold text-slate-900" title={allTitle}>
          <input type="checkbox" className="accent-brand-600" checked={k > 0 && k === list.length} onChange={() => set(list.map((a) => a.id), k < list.length)}
            ref={(el) => { if (el) el.indeterminate = k > 0 && k < list.length; }} />
          <Icon size={14} className="text-slate-500" /> {label}
        </label>
        {each && list.map((a) => (
          <label key={a.id} className="inline-flex cursor-pointer items-center gap-1.5 border-l border-slate-200 pl-3 text-slate-700">
            <input type="checkbox" className="accent-brand-600" checked={sel.has(a.id)} onChange={() => set([a.id], !sel.has(a.id))} />
            {a.name}
          </label>
        ))}
      </div>
    );
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="w-14 shrink-0 text-xs font-semibold text-slate-500">Hisob</span>
      <button type="button" onClick={() => setSel(new Set())} aria-pressed={sel.size === 0}
        className={cn("rounded-lg border px-3 py-1 text-[13px] font-medium transition", sel.size === 0 ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 text-slate-600 hover:bg-slate-100")}>Barcha hisoblar</button>
      {cash.length > 0 && group("Naqd", Banknote, cash, cash.length === 1 ? cash[0].name : "Barcha kassalar", cash.length > 1)}
      {banks.length > 0 && group("Perechisleniye", Landmark, banks, "Barcha banklarni tanlash", true)}
      {banks.length > 0 && (
        <button type="button" onClick={() => setSel(new Set(banks.map((b) => b.id)))} aria-pressed={onlyBanks}
          className={cn("inline-flex items-center gap-1.5 rounded-lg border px-3 py-1 text-[13px] font-medium transition", onlyBanks ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 text-slate-600 hover:bg-slate-100")}>
          <Landmark size={14} /> Hamma banklar
        </button>
      )}
    </div>
  );
}
