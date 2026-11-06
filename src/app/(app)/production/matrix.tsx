"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Grid3x3, Search, Check, X, HardHat, Boxes, Factory, ClipboardList, KanbanSquare, AlarmClock, ArrowDownWideNarrow } from "lucide-react";
import { Card, CardHeader, Checkbox, Input, Select, Sheet, SheetFoot, SheetHead, SheetTd, SheetTh, SheetTr, StatCard, type SheetTone } from "@/components/ui";
import { date, fmtNum } from "@/lib/format";
import { DateMove } from "./date-move";
import { BlockTag } from "@/components/site-blocks";
import { unitLabel } from "@/lib/unit";
import { cn } from "@/lib/utils";
// Faqat tiplar: lib fayli Prisma (db) ni import qiladi — qiymat olinsa brauzer bundle'iga tushib qoladi
import type { MatrixAssign, MatrixOrder, MatrixProduct, ProductionMatrix } from "@/lib/production-matrix";
import type { UnitTotal } from "@/lib/unit";

/**
 * Ishlab chiqarish «Matritsa»si — zavodning Excel jadvali: mahsulot × zayavka, oxirida natija (qoldiq − band).
 * Ustunlar tayyorlik bo'yicha guruhlangan (Tayyor emas / Qisman tayyor / Tayyor), sarlavhadagi sanani bosib zayavka boshqa kunga
 * ko'chiriladi; son rangi — brigada holati, son bosilsa shu zayavka qatori «Brigada tayinlash» formasida ochiladi
 * (`/production?order=…&item=…`), u yerda brigada va miqdor tanlanadi.
 * Zayavka obyektning bir nechta blokiga bo'lingan bo'lsa — har blok alohida ustun (bir xil mijoz/obyekt, har xil blok).
 * Excel'dagidek bitta varaq: ~110 qator × 25 zayavka ustuni ichki aylantirishsiz ko'rinadi — ustunlar ekran eniga teng bo'linadi,
 * qator 25 px, uzun matn kesilmaydi (pastki qatorga o'raladi), sarlavha sahifa bo'ylab yopishib turadi.
 * Ostida «Zayavkalar doskasi»: holat bo'yicha ustunlar. Mahsulot tanlansa, doska shu mahsulotni olayotgan zayavkalarga toraytiriladi.
 * Ma'lumot `lib/production-matrix.ts` dan; bu yerda faqat filtr va ko'rinish.
 */

/** Doska ustunlari — zayavka qanchalik tayyor: hech narsa / bir qismi / hammasi (brigada bajargani, quyilgani, jo'natilgani, hovlidagi qoldiq). */
type ReadyCol = "none" | "part" | "ready";
const READY_LABEL: Record<ReadyCol, string> = { none: "Tayyor emas", part: "Qisman tayyor", ready: "Tayyor" };
const DOT: Record<ReadyCol, string> = { none: "bg-red-500", part: "bg-amber-500", ready: "bg-emerald-500" };
const BORDER: Record<ReadyCol, string> = { none: "border-red-400", part: "border-amber-400", ready: "border-emerald-400" };
const READY_TONE: Record<ReadyCol, SheetTone> = { none: "red", part: "yellow", ready: "green" };
/** Brigada tayinlash holati — doska kartasi pastida va matritsadagi son rangi */
const ASSIGN_LABEL: Record<MatrixAssign, string> = { none: "Brigada tayinlanmagan", part: "Qisman tayinlangan", full: "Brigada tayinlangan" };
const ASSIGN_DOT: Record<MatrixAssign, string> = { none: "bg-red-500", part: "bg-amber-500", full: "bg-emerald-500" };
/** Doska tayyorlik tartibida: tayyor emas → qisman → tayyor */
const FLOW: ReadyCol[] = ["none", "part", "ready"];

const n0 = (v: number) => fmtNum(v, 3);
const signed = (v: number) => (v > 0 ? "+" : v < 0 ? "−" : "") + fmtNum(Math.abs(v), 3);
const short = (o: MatrixOrder) => (o.dateUnknown ? "sanasiz" : date(new Date(o.deliveryDate)).slice(0, 5));
const isLate = (o: MatrixOrder, today: number) => !o.dateUnknown && o.status !== "ready" && new Date(o.deliveryDate).getTime() < today;

// Ustun kengliklari `<colgroup>` da (table-fixed): №, mahsulot, qoldiq va natija qat'iy, zayavka ustunlari qolgan enni teng bo'lishadi.
// Qoldiq va natija ustunlari chegarasi qalinroq — zayavkalar bloki ko'zga ajralib tursin.
const C_ST = "px-1.5 shadow-[inset_-2px_0_0_var(--color-slate-300)]";
const C_TT = "px-1.5 shadow-[inset_2px_0_0_var(--color-slate-300)]";
/** Matn kesilmaydi: so'z sig'masa ham bo'linib keyingi qatorga o'tadi */
const WRAP = "whitespace-normal [overflow-wrap:anywhere]";

/**
 * Matritsa qatorlari tartibi. Sukut — nomi bo'yicha (server tartibi). «O'lchami» — nomdagi raqamlar bo'yicha:
 * «PK 48-12-8» → turi «pk», o'lchami [48, 12, 8]; bir turdagi mahsulotlar ichida kattasi (uzunligi, keyin eni) tepada.
 * Turi — raqamgacha bo'lgan marka (PK, FBS, BR…): «Kovak plita PK 60.12» ham PK qatoriga tushadi; markasiz nomda — raqamgacha qismi.
 * Tanlov shu brauzerda eslab qolinadi.
 */
type RowSort = "name" | "size" | "band" | "need";
const ROW_SORTS: { key: RowSort; label: string }[] = [
  { key: "name", label: "Nomi bo'yicha" },
  { key: "size", label: "O'lchami: kattasi tepada" },
  { key: "band", label: "Band: ko'pi tepada" },
  { key: "need", label: "Kamomad: ko'pi tepada" },
];
const SORT_STORE = "production:matrix-sort";
const sizeOf = (name: string) => {
  const i = name.search(/\d/);
  const head = i < 0 ? name : name.slice(0, i);
  const mark = head.split(/[^A-Za-zА-Яа-яЁё]+/).filter((w) => w.length >= 2 && w === w.toUpperCase()).pop();
  return { kind: (mark ?? head.trim()).toLowerCase(), dims: (name.match(/\d+/g) ?? []).map(Number) };
};
const bySize = (a: string, b: string) => {
  const x = sizeOf(a), y = sizeOf(b);
  if (x.kind !== y.kind) return x.kind.localeCompare(y.kind, "uz");
  for (let k = 0; k < Math.max(x.dims.length, y.dims.length); k++) {
    const d = (y.dims[k] ?? -1) - (x.dims[k] ?? -1);
    if (d) return d;
  }
  return 0;
};

function Dot({ s }: { s: ReadyCol }) {
  return <span aria-hidden className={cn("inline-block h-2 w-2 shrink-0 rounded-full", DOT[s])} />;
}

export function ProductionMatrixView({ data, board, all, filters, tab, stockHref, canMove }: { data: ProductionMatrix; board: BoardOrder[]; all: BoardOrder[]; filters: React.ReactNode; tab: string; stockHref?: string; canMove: boolean }) {
  const [sel, setSel] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [asf, setAsf] = useState<Record<ReadyCol, boolean>>({ none: true, part: true, ready: true });
  const [onlyDef, setOnlyDef] = useState(false);
  // Sukut bo'yicha hamma mahsulot ko'rinadi — matritsa o'z qutisida tepa-pastga aylanadi
  const [hideEmpty, setHideEmpty] = useState(false);
  const [sort, setSort] = useState<RowSort>("name");
  useEffect(() => {
    try {
      const v = localStorage.getItem(SORT_STORE);
      if (ROW_SORTS.some((x) => x.key === v)) setSort(v as RowSort);
    } catch { /* localStorage yopiq bo'lsa — sukut tartib */ }
  }, []);
  const pickSort = (v: RowSort) => { setSort(v); try { localStorage.setItem(SORT_STORE, v); } catch { /* ignore */ } };
  // Bugungi kun boshi — kechikkanlarni belgilash uchun (render paytida bir marta)
  const [today] = useState(() => { const t = new Date(); t.setHours(0, 0, 0, 0); return t.getTime(); });

  const byId = useMemo(() => new Map(data.products.map((p) => [p.id, p])), [data.products]);
  // Matritsa ustunlari doskadagidek tayyorlik bo'yicha guruhlanadi (Tayyor emas / Qisman tayyor / Tayyor)
  const allById = useMemo(() => new Map(all.map((o) => [o.id, o])), [all]);
  // Ustun tayyorligi — faqat shu ustundagi (blokdagi) qatorlar bo'yicha
  const readyMap = useMemo(() => new Map(data.orders.map((o) => {
    const b = allById.get(o.id);
    return [o.key, b ? readiness({ ...b, items: b.items.filter((i) => o.itemIds.includes(i.itemId)) }, o.alloc).col : "none"] as const;
  })), [data.orders, allById]);
  const readyOf = (o: MatrixOrder): ReadyCol => readyMap.get(o.key) ?? "none";
  const net = (p: MatrixProduct) => p.stock - p.band;
  const needle = q.trim().toLowerCase();
  const prodMatch = (p: MatrixProduct) => !needle || p.name.toLowerCase().includes(needle) || p.code.toLowerCase().includes(needle);
  const ordMatch = (o: MatrixOrder) => !needle || [o.customer, o.site ?? "", o.block ?? ""].some((x) => x.toLowerCase().includes(needle)) || Object.keys(o.items).some((id) => { const p = byId.get(id); return !!p && prodMatch(p); });

  const cols = data.orders.filter((o) => asf[readyOf(o)] && ordMatch(o))
    .sort((a, b) => FLOW.indexOf(readyOf(a)) - FLOW.indexOf(readyOf(b)) || a.deliveryDate.localeCompare(b.deliveryDate));
  const isEmpty = (p: MatrixProduct) => p.stock <= 0 && p.band <= 0;
  const rows = data.products.filter((p) => prodMatch(p) && !(hideEmpty && isEmpty(p)) && !(onlyDef && net(p) >= 0));
  // Teng bo'lsa — server tartibi (nomi bo'yicha) saqlanadi: sort barqaror
  if (sort === "size") rows.sort((a, b) => bySize(a.name, b.name));
  else if (sort === "band") rows.sort((a, b) => b.band - a.band);
  else if (sort === "need") rows.sort((a, b) => net(a) - net(b));
  const hiddenEmpty = hideEmpty ? data.products.filter((p) => prodMatch(p) && isEmpty(p) && !(onlyDef && net(p) >= 0)).length : 0;
  const groups = FLOW.map((s) => ({ s, n: cols.filter((o) => readyOf(o) === s).length })).filter((g) => g.n);
  const maxDef = Math.max(1, ...data.products.map((p) => -net(p)));

  // Kartalar — serverdagi birlik bo'yicha yig'indi (dona, m² alohida; beton sexga tushmaydi)
  const sm = data.summary;
  // Har birlik alohida qatorda — tor kartada ham o'qiladi
  const ut = (t: UnitTotal[]) => (t.length
    ? t.map((x, k) => <span key={x.unit} className={cn("block whitespace-nowrap", k > 0 && "text-base font-medium sm:text-lg")}>{n0(x.qty)} {unitLabel(x.unit)}</span>)
    : "0");
  const needAny = sm.need.length > 0;
  // Tugmadagi son — zayavkalar (bloklarga bo'lingani bitta zayavka)
  const cnt = FLOW.reduce((a, s) => ({ ...a, [s]: new Set(data.orders.filter((o) => readyOf(o) === s).map((o) => o.id)).size }), {} as Record<ReadyCol, number>);
  const selP = sel ? byId.get(sel) : undefined;
  const pick = (id: string) => setSel((cur) => (cur === id ? null : id));


  return (
    <div className="mb-8 flex flex-col gap-5">
      <Card padded={false}>
        <div className="px-5 pt-5">
          <CardHeader icon={Grid3x3} title="Sklad va zayavkalar" description="Natija = skladdagi qoldiq − zayavkalarda band. Manfiy son — shuncha quyish kerak. Sonni bossangiz — shu qatorga brigada tayinlaysiz (hammasini yoki bir qismini). Mahsulot nomini bossangiz — pastdagi doskada uni olayotgan zayavkalar chiqadi." />
        </div>
        <div className="grid grid-cols-2 gap-3 px-5 lg:grid-cols-4">
          <StatCard label="Skladda tayyor" value={ut(sm.stock)} hint={`${sm.stockKinds} turdagi mahsulot · beton saqlanmaydi`} icon={Boxes} href={stockHref} />
          <StatCard label="Zayavkalarda band" value={ut(sm.band)} hint={`${sm.orders} ta ochiq zayavka`} icon={ClipboardList} href="/production#doska" />
          <StatCard label="Quyish kerak" value={ut(sm.need)} hint={needAny ? `${sm.needKinds} turda kamomad` : "hammasi yetarli"} icon={Factory} tone={needAny ? "danger" : "success"} href="#matritsa" />
          <StatCard label="Muddati o'tgan" value={`${sm.late} ta`} hint="tayyor bo'lmagan zayavkalar" icon={AlarmClock} tone={sm.late ? "warning" : "default"} href="/production?tab=soon#doska" />
        </div>

        <div className="flex flex-wrap items-center gap-2 px-5 pt-4">
          <label className="relative w-full sm:w-64">
            <Search size={15} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-slate-400" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Mahsulot, mijoz, obyekt, blok…" aria-label="Qidirish" className="h-9 pl-9" />
          </label>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Tayyorlik">
            {FLOW.map((s) => (
              <button key={s} type="button" aria-pressed={asf[s]} onClick={() => setAsf((x) => ({ ...x, [s]: !x[s] }))}
                className={cn("inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-[13px] font-medium transition pointer-coarse:h-11", asf[s] ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white text-slate-500 hover:bg-slate-50")}>
                <span aria-hidden className={cn("inline-block h-2 w-2 shrink-0 rounded-full", DOT[s])} /> {READY_LABEL[s]} <span className="tabular text-[11px] opacity-70">{cnt[s]}</span>
              </button>
            ))}
          </div>
          <Checkbox label="Faqat kamomad" checked={onlyDef} onChange={(e) => setOnlyDef(e.target.checked)} className="ml-1" />
          <Checkbox label="Bo'sh qatorlarni yashirish" checked={hideEmpty} onChange={(e) => setHideEmpty(e.target.checked)} />
          <label className="inline-flex items-center gap-1.5 text-[13px] text-slate-600 sm:ml-auto">
            <ArrowDownWideNarrow size={15} className="text-slate-400" /> Saralash
            <Select value={sort} onChange={(e) => pickSort(e.target.value as RowSort)} aria-label="Saralash" className="h-9 w-auto pointer-coarse:h-11">
              {ROW_SORTS.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
            </Select>
          </label>
        </div>

        <div id="matritsa" className="scroll-mt-20 p-5 pt-3">
          {/* Ichki aylantirish yo'q: hamma qator ochiq, sahifa o'zi aylanadi, sarlavha yuqori panel (h-14) ostida yopishadi.
              Tor ekranda (< lg) 25 ustun sig'maydi — u yerda jadval gorizontal aylanadi */}
          <Sheet lang="uz" maxHeight="none" className="lg:overflow-visible [&_table]:table-fixed [&_table]:text-[14px] max-lg:[&_table]:min-w-[960px] lg:[&_thead]:top-14 [&_tbody_tr]:h-[25px] [&_tbody_td]:py-0.5 [&_tbody_td]:leading-5 [&_tfoot_td]:py-1">
            <colgroup>
              <col className="w-9" />
              <col className="w-[170px] 2xl:w-[230px]" />
              <col className="w-[68px]" />
              {cols.map((o) => <col key={o.key} />)}
              <col className="w-[100px]" />
            </colgroup>
            <SheetHead>
              <tr>
                <SheetTh tone="plain" className="px-1"><span className="sr-only">№</span></SheetTh>
                <SheetTh tone="plain" className="text-left">Mahsulot</SheetTh>
                <SheetTh tone="plain" className={C_ST}>Skladda</SheetTh>
                {groups.map((g) => <SheetTh key={g.s} tone={READY_TONE[g.s]} colSpan={g.n} className={cn(WRAP, "px-1")}>{READY_LABEL[g.s]}</SheetTh>)}
                <SheetTh tone="plain" className={C_TT}>Natija</SheetTh>
              </tr>
              <tr>
                <SheetTh tone="plain" className="px-1">№</SheetTh>
                <SheetTh tone="plain" className="text-left font-medium whitespace-normal text-slate-500">
                  {rows.length} / {data.products.length} qator
                  {hiddenEmpty > 0 && <button type="button" onClick={() => setHideEmpty(false)} className="block text-[11px] font-medium text-slate-900 underline-offset-2 hover:underline">{hiddenEmpty} ta bo&apos;sh qator yashirilgan — ko&apos;rsatish</button>}
                </SheetTh>
                <SheetTh tone="plain" className={cn(C_ST, "font-medium text-slate-500")}>qoldiq</SheetTh>
                {cols.map((o) => {
                  const r = readyOf(o), dateCls = cn("text-[11px] font-medium", isLate(o, today) ? "text-red-700" : "text-slate-600");
                  return (
                    <SheetTh key={o.key} tone={READY_TONE[r]} className={cn(WRAP, "px-1 align-bottom")} title={`${[o.customer, o.block && o.site, o.block].filter(Boolean).join(" · ")} · ${o.dateUnknown ? "sana aniq emas" : date(new Date(o.deliveryDate))} · ${READY_LABEL[r]} · ${ASSIGN_LABEL[o.assign].toLowerCase()}`}>
                      <Link href={`/orders/${o.id}`} className="block text-[12px] leading-tight hover:underline">{o.customer}</Link>
                      {/* Blokli ustun: bir xil obyekt nomi, ostida o'z bloki */}
                      {o.block && <>
                        {o.site && <span className="mt-0.5 block text-[10.5px] leading-tight font-medium text-slate-600">{o.site}</span>}
                        <BlockTag name={o.block} className="mt-1 gap-0.5 px-1 text-[10.5px]" />
                      </>}
                      <span className="mt-1 block">
                        {canMove && (allById.get(o.id)?.movable ?? true)
                          ? <DateMove o={o} name={o.customer} label={`${short(o)}${o.isUrgent ? " · zarur" : ""}`} className={dateCls} />
                          : <span className={dateCls}>{short(o)}{o.isUrgent && " · zarur"}</span>}
                      </span>
                    </SheetTh>
                  );
                })}
                <SheetTh tone="plain" className={cn(C_TT, "font-medium text-slate-500")}>qoldiq − band</SheetTh>
              </tr>
            </SheetHead>
            <tbody>
              {rows.length === 0 && <tr><SheetTd colSpan={cols.length + 4} center muted className="py-8">Filtrga mos mahsulot yo&apos;q</SheetTd></tr>}
              {rows.map((p, i) => {
                const n = net(p), on = sel === p.id;
                const bg = on ? "bg-brand-50" : "bg-white";
                return (
                  <SheetTr key={p.id} className={cn("cursor-pointer", on && "[&>td]:bg-brand-50")}>
                    <SheetTd center muted className={cn("px-1", bg)}><button type="button" onClick={() => pick(p.id)} className="w-full">{i + 1}</button></SheetTd>
                    <SheetTd strong className={cn("px-2", bg)}><button type="button" onClick={() => pick(p.id)} className={cn("block w-full text-left", WRAP)} title={p.name}>{p.name}</button></SheetTd>
                    <SheetTd right strong className={cn(C_ST, bg)}>{n0(p.stock)}</SheetTd>
                    {cols.map((o) => {
                      const v = o.items[p.id], c = o.cells[p.id];
                      if (!v || !c) return <SheetTd key={o.key} tone={READY_TONE[readyOf(o)]} />;
                      const left = Math.max(0, c.qty - c.given), st: MatrixAssign = left <= 0.0005 ? "full" : c.given > 0 ? "part" : "none";
                      return (
                        <SheetTd key={o.key} center className="px-0.5">
                          <Link href={`/production?order=${o.id}&item=${c.itemId}`}
                            title={`${o.customer}${o.block ? ` · ${o.block}` : ""} · ${p.name}\n${st === "full" ? "Tayinlangan" : st === "part" ? `Tayinlangan ${n0(c.given)} / ${n0(c.qty)}, qolgan ${n0(left)}` : "Brigada tayinlanmagan"}${c.brigades.length ? ` · ${c.brigades.join(", ")}` : ""}\nBosing — brigada tayinlash`}
                            className={cn("flex w-full flex-wrap items-center justify-center gap-x-1 rounded-sm px-0.5 text-[13px] leading-5 font-semibold tabular ring-1 ring-inset transition [overflow-wrap:anywhere] hover:ring-2",
                              st === "full" ? "bg-emerald-50 text-emerald-700 ring-emerald-200 hover:ring-emerald-400" : st === "part" ? "bg-amber-50 text-amber-700 ring-amber-200 hover:ring-amber-400" : "bg-red-50 text-red-700 ring-red-200 hover:ring-red-400")}>
                            {n0(v)}
                            {st === "part" && <span className="text-[10px] leading-4 font-medium">−{n0(left)}</span>}
                          </Link>
                        </SheetTd>
                      );
                    })}
                    <SheetTd right className={cn(C_TT, bg)}>
                      <span className="inline-flex items-center justify-end gap-1.5">
                        <span className={cn("tabular", n < 0 ? "font-bold text-red-700" : n > 0 ? "font-semibold text-emerald-700" : "text-slate-400")}>{signed(n)}</span>
                        <span aria-hidden className="flex h-1.5 w-5 justify-end overflow-hidden rounded-full bg-slate-100">{n < 0 && <span className="h-full bg-red-500" style={{ width: `${Math.max(8, (-n / maxDef) * 100)}%` }} />}</span>
                      </span>
                    </SheetTd>
                  </SheetTr>
                );
              })}
            </tbody>
            <SheetFoot>
              <tr>
                <SheetTd className="px-1" />
                <SheetTd className="px-2">Jami</SheetTd>
                <SheetTd right className={C_ST}>{n0(rows.reduce((s, p) => s + Math.max(0, p.stock), 0))}</SheetTd>
                {cols.map((o) => <SheetTd key={o.key} center className={cn(WRAP, "px-0.5 text-[12px]")}>{n0(rows.reduce((s, p) => s + (o.items[p.id] ?? 0), 0))}</SheetTd>)}
                <SheetTd right className={cn(C_TT, "text-red-700")}>{signed(rows.reduce((s, p) => s + Math.min(0, net(p)), 0))}</SheetTd>
              </tr>
            </SheetFoot>
          </Sheet>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
            <span>Ustun rangi — tayyorlik. Son rangi — brigada:</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-red-100 ring-1 ring-red-200" /> tayinlanmagan</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-amber-100 ring-1 ring-amber-200" /> qisman (−qolgani)</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-emerald-100 ring-1 ring-emerald-200" /> tayinlangan</span>
            <span>Sonni bosing — brigada va miqdor tanlanadi. Sanani bosing — boshqa kunga ko&apos;chirish.</span>
          </div>
        </div>
      </Card>

      <Board orders={board} filters={filters} tab={tab} data={data} sel={selP} net={selP ? net(selP) : 0} today={today} canMove={canMove} onClear={() => setSel(null)} onPick={pick} />
    </div>
  );
}

/**
 * Doska kartasi — «Ishlab chiqarish» filtrlari (Ochiq, Bugungilar, …) bo'yicha zayavka; beton (m³) zayavkalari ham.
 * Server (`page.tsx`) tayyorlaydi: ustun — topshiriqlardan, brigada holati — `itemTasks` dan.
 */
export type BoardOrder = {
  id: string; customer: string; deliveryDate: string; deliveryTime: string | null; dateUnknown: boolean; isUrgent: boolean;
  draft: boolean; pickup: boolean; blacklisted: boolean; soon: boolean; due: string | null;
  /** Yetkazilgan/yopilgan yoki barcha topshiriqlari bajarilgan */
  finished: boolean;
  /** Sanasini doskadan o'zgartirsa bo'ladi (yetkazilmagan, bekor qilinmagan) */
  movable: boolean;
  assign: MatrixAssign; brigades: string[];
  /** Obyekt nomi — qatorlar bloklarga bo'lingan bo'lsa kartada ko'rsatiladi */
  site: string | null;
  /** `done` — tayyor miqdor (brigada bajargani, quyilgani, jo'natilgani — kattasi), `shipped` — jo'natilgan ulushi; `block` — obyekt bloki */
  items: { itemId: string; productId: string; name: string; unit: string; qty: number; left: number; done: number; shipped: number; block: string | null }[];
};

/**
 * Zayavka tayyorligi (0..1) va ustuni. Mahsulot bo'yicha: tayyor = max(done, jo'natilgan + hovlidan ajratilgan qoldiq),
 * miqdordan oshmaydi; ulush — mahsulotlar ulushining o'rtachasi (m³ va dona qo'shilmaydi).
 */
function readiness(o: BoardOrder, alloc: Record<string, number> | undefined): { col: ReadyCol; pct: number } {
  if (o.finished) return { col: "ready", pct: 1 };
  const by = new Map<string, { qty: number; done: number; shipped: number }>();
  for (const i of o.items) {
    const x = by.get(i.productId) ?? { qty: 0, done: 0, shipped: 0 };
    x.qty += i.qty; x.done += i.done; x.shipped += i.shipped; by.set(i.productId, x);
  }
  const parts = [...by].filter(([, x]) => x.qty > 0).map(([pid, x]) => Math.min(1, Math.max(x.done, x.shipped + (alloc?.[pid] ?? 0)) / x.qty));
  if (!parts.length) return { col: "none", pct: 0 };
  const pct = parts.reduce((s, v) => s + v, 0) / parts.length;
  return { col: parts.every((v) => v >= 0.9995) ? "ready" : pct > 0.0005 ? "part" : "none", pct };
}

function Board({ orders, filters, tab, data, sel, net, today, canMove, onClear, onPick }: {
  orders: BoardOrder[]; filters: React.ReactNode; tab: string; data: ProductionMatrix; sel?: MatrixProduct; net: number; today: number; canMove: boolean; onClear: () => void; onPick: (id: string) => void;
}) {
  // Skladdan qoplanishi — faqat matritsadagi (dona) qatorlar uchun; blok ustunlari zayavka bo'yicha qo'shiladi
  const mx = new Map<string, { items: Record<string, number>; alloc: Record<string, number> }>();
  for (const c of data.orders) {
    const m = mx.get(c.id) ?? { items: {}, alloc: {} };
    for (const [pid, q] of Object.entries(c.items)) m.items[pid] = (m.items[pid] ?? 0) + q;
    for (const [pid, q] of Object.entries(c.alloc)) m.alloc[pid] = (m.alloc[pid] ?? 0) + q;
    mx.set(c.id, m);
  }
  const list = (sel ? orders.filter((o) => o.items.some((i) => i.productId === sel.id)) : orders)
    .map((o) => ({ o, r: readiness(o, mx.get(o.id)?.alloc) }));
  const sorted = (s: ReadyCol) => list.filter((x) => x.r.col === s);
  const tabQ = tab !== "open" ? `&tab=${tab}` : "";
  return (
    <Card padded={false}>
      <div id="doska" className="scroll-mt-20 px-5 pt-5">
        <CardHeader icon={KanbanSquare}
          title={sel ? `Zayavkalar doskasi · ${sel.name}` : "Zayavkalar doskasi"}
          description={sel ? "Shu mahsulotni olayotgan zayavkalar. Boshqa mahsulotni tanlash uchun jadvaldagi mahsulot nomini bosing." : "Mahsulotni tanlang — qaysi zayavkalar olayotgani shu yerda chiqadi. Filtr bo'yicha barcha zayavkalar (beton sexga tushmaydi — u logistikada)."}
          action={sel ? <button type="button" onClick={onClear} className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-900"><X size={14} /> Tanlovni olish</button> : undefined} />
      </div>
      <div className="px-5">{filters}</div>
      {sel && (
        <div className="grid grid-cols-3 gap-3 px-5 pb-1 sm:max-w-md">
          {[{ k: "Skladda", v: n0(sel.stock), c: "" }, { k: "Band", v: n0(sel.band), c: "" }, { k: "Natija", v: signed(net), c: net < 0 ? "text-red-700" : net > 0 ? "text-emerald-700" : "text-slate-400" }].map((x) => (
            <div key={x.k} className="rounded-lg border border-slate-200 px-3 py-2"><div className="text-xs text-slate-500">{x.k}</div><div className={cn("text-lg font-semibold tabular text-slate-900", x.c)}>{x.v} <span className="text-xs font-normal text-slate-400">{unitLabel(sel.unit)}</span></div></div>
          ))}
        </div>
      )}
      <div className="grid grid-cols-[repeat(3,minmax(250px,1fr))] gap-3 overflow-x-auto p-5 pt-1">
        {FLOW.map((s) => {
          const l = sorted(s);
          return (
            <div key={s} className="flex min-w-0 flex-col gap-2 rounded-(--radius-card) border border-slate-200 bg-slate-50 p-2.5">
              <div className={cn("flex items-center gap-2 border-b-2 px-1 pb-2 text-sm font-semibold text-slate-900", BORDER[s])}>
                <Dot s={s} /> {READY_LABEL[s]}
                <span className="ml-auto text-xs font-normal tabular text-slate-500">{l.length} ta</span>
              </div>
              {l.length === 0 && <div className="rounded-lg border border-dashed border-slate-300 py-6 text-center text-sm text-slate-400">Bo&apos;sh</div>}
              {l.map(({ o, r }) => {
                const m = mx.get(o.id);
                const when = `${o.dateUnknown ? "Sana aniq emas" : date(new Date(o.deliveryDate))}${o.deliveryTime ? ` · ${o.deliveryTime}` : ""}`;
                const late = !o.dateUnknown && s !== "ready" && new Date(o.deliveryDate).getTime() < today;
                return (
                  <div key={o.id} className={cn("flex flex-col gap-2 rounded-lg border bg-white p-2.5 shadow-xs", o.soon && s !== "ready" ? "border-red-200" : "border-slate-200")}>
                    <div className="flex flex-col gap-1">
                      <div className="min-w-0">
                        <Link href={`/orders/${o.id}`} className="block truncate font-semibold text-slate-900 hover:underline" title={o.customer}>{o.customer}</Link>
                        {o.site && o.items.some((it) => it.block) && <div className="truncate text-xs font-medium text-slate-600" title={o.site}>{o.site}</div>}
                        <div className={cn("flex flex-wrap gap-x-1.5 text-xs", o.soon && s !== "ready" ? "font-medium text-red-700" : "text-slate-500")}>
                          {canMove && o.movable ? <DateMove o={o} name={o.customer} label={when} /> : <span className="whitespace-nowrap">{when}</span>}
                          {o.due && s !== "ready" && <span className="whitespace-nowrap">· {o.due}</span>}
                          {o.pickup && <span className="whitespace-nowrap text-slate-500">· o&apos;zi oladi</span>}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-1 empty:hidden">
                        {o.blacklisted && <span className="rounded-full bg-red-600 px-2 py-0.5 text-[10.5px] font-semibold text-white">Qora ro&apos;yxat</span>}
                        {o.draft ? <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">Qoralama</span>
                          : late ? <span className="rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-700">Kechikmoqda</span> : null}
                        {o.isUrgent && <span className="rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-700">Zarur</span>}
                      </div>
                    </div>
                    <div className="flex flex-col gap-0.5 text-[12.5px]">
                      {o.items.map((it) => {
                        const dona = it.unit !== "m3", v = m?.items[it.productId], g = m?.alloc[it.productId] ?? 0;
                        return (
                          <button key={it.itemId} type="button" onClick={() => dona && onPick(it.productId)} disabled={!dona}
                            title={v !== undefined ? `Skladdan ${n0(g)} / ${n0(v)}` : undefined}
                            className={cn("grid grid-cols-[minmax(0,1fr)_auto_44px] items-center gap-2 rounded px-1 py-0.5 text-left", dona && "hover:bg-slate-50", sel?.id === it.productId && "bg-brand-50")}>
                            <span className="min-w-0 text-slate-700">{it.block && <BlockTag name={it.block} className="mr-1 align-[1px]" />}<span className="[overflow-wrap:anywhere]">{it.name}</span></span>
                            <span className="font-semibold whitespace-nowrap tabular text-slate-900">{n0(it.qty)} <span className="text-[11px] font-normal text-slate-400">{unitLabel(it.unit)}</span></span>
                            {v === undefined ? <span /> : g >= v ? <Check size={14} className="justify-self-end text-emerald-600" /> : <span className="justify-self-end text-[11px] font-semibold tabular text-red-700">−{n0(v - g)}</span>}
                          </button>
                        );
                      })}
                    </div>
                    {s === "part" && (
                      <div className="flex items-center gap-2 text-[11px] text-slate-500">
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-red-100"><div className="h-full bg-emerald-500" style={{ width: `${Math.round(r.pct * 100)}%` }} /></div>
                        tayyor {Math.round(r.pct * 100)}%
                      </div>
                    )}
                    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-2 text-xs">
                      <span className={cn("inline-flex min-w-0 items-center gap-1.5 font-medium", o.assign === "full" ? "text-emerald-700" : o.assign === "part" ? "text-amber-700" : "text-red-700")}>
                        <span aria-hidden className={cn("h-2 w-2 shrink-0 rounded-full", ASSIGN_DOT[o.assign])} />
                        <span className="truncate">{ASSIGN_LABEL[o.assign]}{o.brigades.length > 0 && <span className="font-normal text-slate-500"> · {o.brigades.join(", ")}</span>}</span>
                      </span>
                      {o.draft ? <span className="text-slate-400">sotuv tasdiqlashi kerak</span>
                        : o.assign !== "full" && s !== "ready" ? <Link href={`/production?order=${o.id}${tabQ}`} className="inline-flex items-center gap-1 font-medium text-slate-900 hover:underline"><HardHat size={13} /> Tayinlash</Link>
                        : <Link href="/tasks" className="font-medium text-slate-600 hover:underline">Topshiriqlar</Link>}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </Card>
  );
}
