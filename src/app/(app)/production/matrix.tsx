"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Grid3x3, Search, Check, X, HardHat, Boxes, Factory, ClipboardList, KanbanSquare, AlarmClock } from "lucide-react";
import { Card, CardHeader, Checkbox, Input, Sheet, SheetFoot, SheetHead, SheetTd, SheetTh, SheetTr, StatCard, type SheetTone } from "@/components/ui";
import { date, fmtNum } from "@/lib/format";
import { unitLabel } from "@/lib/unit";
import { cn } from "@/lib/utils";
// Faqat tiplar: lib fayli Prisma (db) ni import qiladi — qiymat olinsa brauzer bundle'iga tushib qoladi
import type { MatrixOrder, MatrixProduct, MatrixStatus, ProductionMatrix } from "@/lib/production-matrix";

/**
 * Ishlab chiqarish «Matritsa»si — zavodning Excel jadvali: mahsulot × zayavka, oxirida natija (qoldiq − band).
 * Ostida «Zayavkalar doskasi»: holat bo'yicha ustunlar. Mahsulot tanlansa, doska shu mahsulotni olayotgan zayavkalarga toraytiriladi.
 * Ma'lumot `lib/production-matrix.ts` dan; bu yerda faqat filtr va ko'rinish.
 */

const STATUSES: MatrixStatus[] = ["ready", "pour", "queue"];
const MATRIX_STATUS_LABEL: Record<MatrixStatus, string> = { ready: "Tayyor", pour: "Quyilmoqda", queue: "Navbatda" };
const TONE: Record<MatrixStatus, SheetTone> = { ready: "yellow", pour: "red", queue: "green" };
const DOT: Record<MatrixStatus, string> = { ready: "bg-amber-500", pour: "bg-red-500", queue: "bg-emerald-500" };
const BORDER: Record<MatrixStatus, string> = { ready: "border-amber-400", pour: "border-red-400", queue: "border-emerald-400" };
/** Doska ishlab chiqarish oqimi tartibida: navbatda → quyilmoqda → tayyor */
const FLOW: MatrixStatus[] = ["queue", "pour", "ready"];

const n0 = (v: number) => fmtNum(v, 3);
const signed = (v: number) => (v > 0 ? "+" : v < 0 ? "−" : "") + fmtNum(Math.abs(v), 3);
const short = (o: MatrixOrder) => (o.dateUnknown ? "sanasiz" : date(new Date(o.deliveryDate)).slice(0, 5));
const isLate = (o: MatrixOrder, today: number) => !o.dateUnknown && o.status !== "ready" && new Date(o.deliveryDate).getTime() < today;
const sumItems = (o: MatrixOrder) => Object.values(o.items).reduce((s, q) => s + q, 0);
const coverage = (o: MatrixOrder) => { const t = sumItems(o); return t ? Object.keys(o.items).reduce((s, k) => s + (o.alloc[k] ?? 0), 0) / t : 1; };

// Qotib turadigan ustunlar: chapda №, mahsulot, qoldiq; o'ngda natija. Kengliklar qat'iy — `left` shu yig'indidan.
const W_NO = "left-0 w-10 min-w-10 max-w-10";
const W_NAME = "left-10 w-[190px] min-w-[190px] max-w-[190px]";
const W_ST = "left-[230px] w-[76px] min-w-[76px] shadow-[inset_-2px_0_0_var(--color-slate-300)]";
const W_TT = "right-0 w-[104px] min-w-[104px] shadow-[inset_2px_0_0_var(--color-slate-300)]";
const C_NO = cn("sticky z-20", W_NO), C_NAME = cn("sticky z-20", W_NAME), C_ST = cn("sticky z-20", W_ST), C_TT = cn("sticky z-20", W_TT);
const B_NO = cn("sticky z-[1]", W_NO), B_NAME = cn("sticky z-[1]", W_NAME), B_ST = cn("sticky z-[1]", W_ST), B_TT = cn("sticky z-[1]", W_TT);

function Dot({ s }: { s: MatrixStatus }) {
  return <span aria-hidden className={cn("inline-block h-2 w-2 shrink-0 rounded-full", DOT[s])} />;
}

export function ProductionMatrixView({ data }: { data: ProductionMatrix }) {
  const [sel, setSel] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [stf, setStf] = useState<Record<MatrixStatus, boolean>>({ ready: true, pour: true, queue: true });
  const [onlyDef, setOnlyDef] = useState(false);
  const [hideEmpty, setHideEmpty] = useState(true);
  // Bugungi kun boshi — kechikkanlarni belgilash uchun (render paytida bir marta)
  const [today] = useState(() => { const t = new Date(); t.setHours(0, 0, 0, 0); return t.getTime(); });

  const byId = useMemo(() => new Map(data.products.map((p) => [p.id, p])), [data.products]);
  const net = (p: MatrixProduct) => p.stock - p.band;
  const needle = q.trim().toLowerCase();
  const prodMatch = (p: MatrixProduct) => !needle || p.name.toLowerCase().includes(needle) || p.code.toLowerCase().includes(needle);
  const ordMatch = (o: MatrixOrder) => !needle || o.customer.toLowerCase().includes(needle) || Object.keys(o.items).some((id) => { const p = byId.get(id); return !!p && prodMatch(p); });

  const cols = data.orders.filter((o) => stf[o.status] && ordMatch(o));
  const rows = data.products.filter((p) => prodMatch(p) && !(hideEmpty && p.stock <= 0 && p.band <= 0) && !(onlyDef && net(p) >= 0));
  const groups = STATUSES.map((s) => ({ s, n: cols.filter((o) => o.status === s).length })).filter((g) => g.n);
  const maxDef = Math.max(1, ...data.products.map((p) => -net(p)));

  const totals = data.products.reduce((a, p) => { const n = net(p); a.stock += Math.max(0, p.stock); a.band += p.band; if (n < 0) { a.need -= n; a.kinds++; } return a; }, { stock: 0, band: 0, need: 0, kinds: 0 });
  const lateN = data.orders.filter((o) => isLate(o, today)).length;
  const cnt = STATUSES.reduce((a, s) => ({ ...a, [s]: data.orders.filter((o) => o.status === s).length }), {} as Record<MatrixStatus, number>);
  const selP = sel ? byId.get(sel) : undefined;
  const pick = (id: string) => setSel((cur) => (cur === id ? null : id));


  return (
    <div className="mb-8 flex flex-col gap-5">
      <Card padded={false}>
        <div className="px-5 pt-5">
          <CardHeader icon={Grid3x3} title="Sklad va zayavkalar" description="Natija = skladdagi qoldiq − zayavkalarda band. Manfiy son — shuncha quyish kerak. Katakni bossangiz, pastdagi doskada shu mahsulotni olayotgan zayavkalar chiqadi." />
        </div>
        <div className="grid grid-cols-2 gap-3 px-5 lg:grid-cols-4">
          <StatCard label="Skladda tayyor" value={`${n0(totals.stock)} dona`} hint={`${data.products.filter((p) => p.stock > 0).length} turdagi mahsulot`} icon={Boxes} />
          <StatCard label="Zayavkalarda band" value={`${n0(totals.band)} dona`} hint={`${data.orders.length} ta ochiq zayavka`} icon={ClipboardList} />
          <StatCard label="Quyish kerak" value={`${n0(totals.need)} dona`} hint={`${totals.kinds} turda kamomad`} icon={Factory} tone={totals.need > 0 ? "danger" : "success"} />
          <StatCard label="Muddati o'tgan" value={lateN} hint="tayyor bo'lmagan zayavkalar" icon={AlarmClock} tone={lateN ? "warning" : "default"} />
        </div>

        <div className="flex flex-wrap items-center gap-2 px-5 pt-4">
          <label className="relative w-full sm:w-64">
            <Search size={15} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-slate-400" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Mahsulot yoki mijoz…" aria-label="Qidirish" className="h-9 pl-9" />
          </label>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Holat">
            {STATUSES.map((s) => (
              <button key={s} type="button" aria-pressed={stf[s]} onClick={() => setStf((x) => ({ ...x, [s]: !x[s] }))}
                className={cn("inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-[13px] font-medium transition pointer-coarse:h-11", stf[s] ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white text-slate-500 hover:bg-slate-50")}>
                <Dot s={s} /> {MATRIX_STATUS_LABEL[s]} <span className="tabular text-[11px] opacity-70">{cnt[s]}</span>
              </button>
            ))}
          </div>
          <Checkbox label="Faqat kamomad" checked={onlyDef} onChange={(e) => setOnlyDef(e.target.checked)} className="ml-1" />
          <Checkbox label="Bo'sh qatorlarni yashirish" checked={hideEmpty} onChange={(e) => setHideEmpty(e.target.checked)} />
        </div>

        <div className="p-5 pt-3">
          <Sheet lang="uz" maxHeight="66vh">
            <SheetHead>
              <tr>
                <SheetTh tone="plain" className={C_NO}><span className="sr-only">№</span></SheetTh>
                <SheetTh tone="plain" className={cn(C_NAME, "text-left")}>Mahsulot</SheetTh>
                <SheetTh tone="plain" className={C_ST}>Skladda</SheetTh>
                {groups.map((g) => <SheetTh key={g.s} tone={TONE[g.s]} colSpan={g.n}>{MATRIX_STATUS_LABEL[g.s]}</SheetTh>)}
                <SheetTh tone="plain" className={C_TT}>Natija</SheetTh>
              </tr>
              <tr>
                <SheetTh tone="plain" className={C_NO}>№</SheetTh>
                <SheetTh tone="plain" className={cn(C_NAME, "text-left font-medium text-slate-500")}>{rows.length} / {data.products.length} qator</SheetTh>
                <SheetTh tone="plain" className={cn(C_ST, "font-medium text-slate-500")}>qoldiq</SheetTh>
                {cols.map((o) => (
                  <SheetTh key={o.id} tone={TONE[o.status]} className="w-[72px] min-w-[72px] max-w-[72px] px-1 align-bottom whitespace-normal" title={`${o.customer} · ${o.dateUnknown ? "sana aniq emas" : date(new Date(o.deliveryDate))} · ${MATRIX_STATUS_LABEL[o.status]}`}>
                    <Link href={`/orders/${o.id}`} className="line-clamp-2 text-[11.5px] leading-tight hover:underline">{o.customer}</Link>
                    <span className={cn("mt-0.5 block text-[11px] font-medium", isLate(o, today) ? "text-red-700" : "text-slate-600")}>{short(o)}{o.isUrgent && " · zarur"}</span>
                  </SheetTh>
                ))}
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
                    <SheetTd center muted className={cn(B_NO, bg)}><button type="button" onClick={() => pick(p.id)} className="w-full">{i + 1}</button></SheetTd>
                    <SheetTd strong className={cn(B_NAME, bg)}><button type="button" onClick={() => pick(p.id)} className="block w-full truncate text-left" title={p.name}>{p.name}</button></SheetTd>
                    <SheetTd right strong className={cn(B_ST, bg)}>{n0(p.stock)}</SheetTd>
                    {cols.map((o) => {
                      const v = o.items[p.id];
                      if (!v) return <SheetTd key={o.id} tone={TONE[o.status]} />;
                      const g = o.alloc[p.id] ?? 0;
                      return (
                        <SheetTd key={o.id} center className="p-1">
                          <button type="button" onClick={() => pick(p.id)} title={`Skladdan ${n0(g)} / ${n0(v)}`}
                            className={cn("min-w-9 rounded px-1.5 py-0.5 font-semibold tabular", g >= v ? "bg-emerald-50 text-emerald-700" : g > 0 ? "bg-amber-50 text-amber-700" : "bg-red-50 text-red-700")}>{n0(v)}</button>
                        </SheetTd>
                      );
                    })}
                    <SheetTd right className={cn(B_TT, bg)}>
                      <span className="inline-flex items-center justify-end gap-2">
                        <span className={cn("tabular", n < 0 ? "font-bold text-red-700" : n > 0 ? "font-semibold text-emerald-700" : "text-slate-400")}>{signed(n)}</span>
                        <span aria-hidden className="flex h-1.5 w-9 justify-end overflow-hidden rounded-full bg-slate-100">{n < 0 && <span className="h-full bg-red-500" style={{ width: `${Math.max(8, (-n / maxDef) * 100)}%` }} />}</span>
                      </span>
                    </SheetTd>
                  </SheetTr>
                );
              })}
            </tbody>
            <SheetFoot>
              <tr>
                <SheetTd className={B_NO} />
                <SheetTd className={B_NAME}>Jami</SheetTd>
                <SheetTd right className={B_ST}>{n0(rows.reduce((s, p) => s + Math.max(0, p.stock), 0))}</SheetTd>
                {cols.map((o) => <SheetTd key={o.id} center>{n0(rows.reduce((s, p) => s + (o.items[p.id] ?? 0), 0))}</SheetTd>)}
                <SheetTd right className={cn(B_TT, "text-red-700")}>{signed(rows.reduce((s, p) => s + Math.min(0, net(p)), 0))}</SheetTd>
              </tr>
            </SheetFoot>
          </Sheet>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
            <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-emerald-100" /> skladdan yopiladi</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-amber-100" /> qisman</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-red-100" /> yetmaydi</span>
            <span>Qoldiq avval tayyor, keyin eski sanali zayavkalarga taqsimlanadi.</span>
          </div>
        </div>
      </Card>

      <Board data={data} cols={cols} sel={selP} net={selP ? net(selP) : 0} byId={byId} today={today} onClear={() => setSel(null)} onPick={pick} />
    </div>
  );
}

function Board({ data, cols, sel, net, byId, today, onClear, onPick }: {
  data: ProductionMatrix; cols: MatrixOrder[]; sel?: MatrixProduct; net: number; byId: Map<string, MatrixProduct>; today: number; onClear: () => void; onPick: (id: string) => void;
}) {
  const list = sel ? data.orders.filter((o) => o.items[sel.id]) : cols;
  const sorted = (s: MatrixStatus) => list.filter((o) => o.status === s).sort((a, b) => a.deliveryDate.localeCompare(b.deliveryDate));
  return (
    <Card padded={false}>
      <div className="px-5 pt-5">
        <CardHeader icon={KanbanSquare}
          title={sel ? `Zayavkalar doskasi · ${sel.name}` : "Zayavkalar doskasi"}
          description={sel ? "Shu mahsulotni olayotgan zayavkalar. Boshqa mahsulotni tanlash uchun jadvaldagi qatorni bosing." : "Mahsulotni tanlang — qaysi zayavkalar olayotgani shu yerda chiqadi. Hozir barcha ochiq zayavkalar."}
          action={sel ? <button type="button" onClick={onClear} className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-900"><X size={14} /> Tanlovni olish</button> : undefined} />
      </div>
      {sel && (
        <div className="grid grid-cols-3 gap-3 px-5 pb-1 sm:max-w-md">
          {[{ k: "Skladda", v: n0(sel.stock), c: "" }, { k: "Band", v: n0(sel.band), c: "" }, { k: "Natija", v: signed(net), c: net < 0 ? "text-red-700" : net > 0 ? "text-emerald-700" : "text-slate-400" }].map((x) => (
            <div key={x.k} className="rounded-lg border border-slate-200 px-3 py-2"><div className="text-xs text-slate-500">{x.k}</div><div className={cn("text-lg font-semibold tabular text-slate-900", x.c)}>{x.v} <span className="text-xs font-normal text-slate-400">{unitLabel(sel.unit)}</span></div></div>
          ))}
        </div>
      )}
      <div className="grid gap-3 overflow-x-auto p-5 md:grid-cols-3">
        {FLOW.map((s) => {
          const l = sorted(s);
          return (
            <div key={s} className="flex min-w-0 flex-col gap-2 rounded-(--radius-card) border border-slate-200 bg-slate-50 p-2.5">
              <div className={cn("flex items-center gap-2 border-b-2 px-1 pb-2 text-sm font-semibold text-slate-900", BORDER[s])}>
                <Dot s={s} /> {MATRIX_STATUS_LABEL[s]}
                <span className="ml-auto text-xs font-normal tabular text-slate-500">{l.length} ta · {n0(l.reduce((a, o) => a + sumItems(o), 0))} dona</span>
              </div>
              {l.length === 0 && <div className="rounded-lg border border-dashed border-slate-300 py-6 text-center text-sm text-slate-400">Bo&apos;sh</div>}
              {l.map((o) => {
                const cov = coverage(o), late = isLate(o, today);
                return (
                  <div key={o.id} className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-white p-2.5 shadow-xs">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <Link href={`/orders/${o.id}`} className="block truncate font-semibold text-slate-900 hover:underline">{o.customer}</Link>
                        <div className="text-xs text-slate-500">{o.dateUnknown ? "Sana aniq emas" : date(new Date(o.deliveryDate))} · {n0(sumItems(o))} dona</div>
                      </div>
                      {late ? <span className="shrink-0 rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-700">Kechikmoqda</span> : o.isUrgent ? <span className="shrink-0 rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-700">Zarur</span> : null}
                    </div>
                    <div className="flex flex-col gap-0.5 text-[12.5px]">
                      {Object.entries(o.items).map(([pid, v]) => {
                        const g = o.alloc[pid] ?? 0, p = byId.get(pid);
                        return (
                          <button key={pid} type="button" onClick={() => onPick(pid)} title={`Skladdan ${n0(g)} / ${n0(v)}`}
                            className={cn("grid grid-cols-[minmax(0,1fr)_auto_44px] items-center gap-2 rounded px-1 py-0.5 text-left hover:bg-slate-50", sel?.id === pid && "bg-brand-50")}>
                            <span className="truncate text-slate-700">{p?.name ?? "—"}</span>
                            <span className="font-semibold tabular text-slate-900">{n0(v)}</span>
                            {g >= v ? <Check size={14} className="justify-self-end text-emerald-600" /> : <span className="justify-self-end text-[11px] font-semibold tabular text-red-700">−{n0(v - g)}</span>}
                          </button>
                        );
                      })}
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-red-100"><div className="h-full bg-emerald-500" style={{ width: `${Math.round(cov * 100)}%` }} /></div>
                    <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
                      <span>Skladdan {Math.round(cov * 100)}% yopiladi</span>
                      {s === "queue" ? <Link href={`/production?order=${o.id}`} className="inline-flex items-center gap-1 font-medium text-slate-900 hover:underline"><HardHat size={13} /> Tayinlash</Link>
                        : s === "pour" ? <Link href="/tasks" className="font-medium text-slate-700 hover:underline">Topshiriqlar</Link>
                        : <Link href={`/orders/${o.id}`} className="font-medium text-slate-700 hover:underline">Zayavka</Link>}
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
