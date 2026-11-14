import Link from "next/link";
import { ArrowRightLeft, Boxes, HardHat, Warehouse } from "lucide-react";
import { stockSnapshot, type SnapshotProduct } from "@/lib/stock";
import { COMMON_KEY, ownerTurnover, type TurnCell } from "@/lib/brigade-products";
import { dateRu, dateTime, qty } from "@/lib/format";
import { unitShort } from "@/lib/unit";
import { Card, LinkButton, Section, Sheet, SheetFoot, SheetHead, SheetTd, SheetTh, SheetTr } from "@/components/ui";
import { StockPeriodBar, type StockPeriod } from "@/components/stock-period";
import { YardMovesHost } from "@/components/yard-moves-dialog";
import { yardMovesInfo } from "@/app/(app)/stock/yard-actions";
import { cn } from "@/lib/utils";

/**
 * Sklad → «Hovli va tayyor mahsulot»: dona mahsulot Excel jadvali ko'rinishida + beton kartalari.
 * Jadval: chapda mahsulot, tepada brigadalar (oxirida «Umumiy hovli»), har brigada ostida davrdagi Kirim / Chiqim va davr
 * oxiridagi Qoldiq (`lib/brigade-products.ts` → `ownerTurnover`); o'ngda Jami va hozirgi «Band / Erkin» (zayavkalar bandi
 * omborga bog'lanmaydi, `lib/stock.ts` → `stockSnapshot`). Davr — `?from=&to=` (standart joriy oy), ombor filtri `?ombor=`
 * (brigada id yoki «umumiy») faqat o'sha brigada ustunlarini qoldiradi. Qoldig'i va harakati yo'q nomlar pastda yig'iq ro'yxatda.
 */

const urlKey = (k: string) => (k === COMMON_KEY ? "umumiy" : k);

function ConcreteCard({ p }: { p: SnapshotProduct }) {
  const can = p.make?.canMake ?? 0;
  return (
    <Card className={cn("flex min-w-0 flex-col gap-1 p-3.5", p.make && can <= 0 && "border-red-200")}>
      <div className="truncate text-[13px] font-semibold text-slate-900" title={p.name}>{p.name}</div>
      {p.make ? (
        <>
          <div className={cn("text-xl leading-tight font-bold tabular", can > 0 ? "text-slate-900" : "text-red-600")}>{qty(can)} <span className="text-xs font-medium text-slate-400">m³</span></div>
          <div className="truncate text-[11px] text-slate-500" title={p.make.limiting ? `${p.make.limiting.name} — qoldiq ${qty(p.make.limiting.balance)} ${p.make.limiting.unit}` : undefined}>
            {p.make.limiting ? <>cheklovchi: {p.make.limiting.name}</> : "xomashyodan chiqadi"}
          </div>
        </>
      ) : <div className="text-[12px] text-slate-400">retsept kiritilmagan</div>}
    </Card>
  );
}

const EPS = 0.0005;
const ZERO: TurnCell = { in: 0, out: 0, close: 0 };
/** Katak: 0 — bo'sh (Excel'dagidek) */
const n = (v: number) => (Math.abs(v) > EPS ? qty(v) : "");
const live = (c: TurnCell) => Math.abs(c.in) > EPS || Math.abs(c.out) > EPS || Math.abs(c.close) > EPS;
/**
 * Bosiladigan katak: kassa/bank kabi oyna ochiladi — shu ombordagi harakatlar, kim kiritgani, sana va soat (`YardMovesHost`).
 * `owner`: brigada id, "" — umumiy hovli, "*" — butun sklad (Jami). `dir`: in/out — davrdagi kirim/chiqim, all — qoldiqqacha hammasi.
 */
function Cell({ productId, owner, dir, v, title }: { productId: string; owner: string; dir: "in" | "out" | "all"; v: number; title: string }) {
  const t = Math.abs(v) > EPS ? qty(v) : "";
  if (!t) return null;
  return (
    <button type="button" data-ym-p={productId} data-ym-o={owner} data-ym-d={dir} title={title}
      className="-mx-1 w-[calc(100%+0.5rem)] cursor-pointer rounded px-1 text-right tabular decoration-dotted underline-offset-2 hover:bg-white/70 hover:underline focus-visible:outline-2 focus-visible:outline-brand-500">{t}</button>
  );
}

type Row = { productId: string; name: string; unit: string; byOwner: Record<string, TurnCell>; total: TurnCell };

export async function YardStatus({ ombor, period, canDistribute = false }: {
  /** Ombor filtri (`?ombor=`): brigada id yoki «umumiy»; bo'sh — hammasi */
  ombor?: string;
  /** Kirim / chiqim davri; qoldiq — davr oxiriga */
  period: StockPeriod;
  /** «Brigadalarga ajratish» tugmasi (`stock` → `products`) */
  canDistribute?: boolean;
}) {
  const [s, t] = await Promise.all([stockSnapshot(), ownerTurnover(period)]);
  const snap = new Map(s.pieces.map((p) => [p.id, p]));
  const cellOf = (r: Row, k: string) => r.byOwner[k] ?? ZERO;
  const colName = new Map(t.columns.map((c) => [urlKey(c.key), c.name]));
  // Noma'lum (bo'sh) ombor tanlansa — filtrsiz
  const pick = ombor && colName.has(ombor) ? ombor : null;
  const dbKey = pick === "umumiy" ? COMMON_KEY : pick;
  const cols = dbKey !== null ? t.columns.filter((c) => c.key === dbKey) : t.columns;
  // Qatorlar: davrda harakati yoki qoldig'i bor + zayavkaga band qilingani bor (hovlida yo'q bo'lsa ham — yetishmaydi)
  const seen = new Set(t.rows.map((r) => r.productId));
  const bandOnly: Row[] = s.pieces.filter((p) => !seen.has(p.id) && Math.abs(p.owned) > EPS)
    .map((p) => ({ productId: p.id, name: p.name, unit: p.unit, byOwner: {}, total: ZERO }));
  const all: Row[] = [...t.rows, ...bandOnly].sort((a, b) => a.name.localeCompare(b.name, "uz", { numeric: true }));
  const rows = dbKey !== null ? all.filter((r) => live(cellOf(r, dbKey))) : all;
  const empty = dbKey !== null ? [] : s.pieces.filter((p) => !seen.has(p.id) && Math.abs(p.owned) <= EPS);
  const bandOf = (r: Row) => snap.get(r.productId)?.owned ?? 0;
  const freeOf = (r: Row) => { const p = snap.get(r.productId); return p ? p.free : r.total.close; };
  const sum = (f: (r: Row) => number) => rows.reduce((a, r) => a + f(r), 0);

  const baseQ = { bolim: "hovli", from: period.fromStr, to: period.toStr };
  const chipHref = (k: string | null) => `/stock?${new URLSearchParams({ ...baseQ, ...(k ? { ombor: k } : {}) }).toString()}#hovli`;
  const chip = (href: string, on: boolean, label: string, v: number, common = false) => (
    <Link key={href} href={href} scroll={false}
      className={cn("inline-flex max-w-full items-center gap-1.5 rounded-full border px-3 py-1 text-[12.5px] transition", on ? "border-brand-300 bg-brand-50 font-semibold text-brand-800" : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900", common && !on && "border-dashed")}>
      <span className="truncate">{label}</span><span className={cn("tabular", on ? "text-brand-700" : "text-slate-400")}>{qty(v)}</span>
    </Link>
  );
  // Tepadagi ko'rsatkichlar — doim butun hovli, hozirgi holat (davr va ombor filtri faqat jadvalga)
  const inYard = s.pieces.filter((p) => Math.abs(p.total) > EPS || Math.abs(p.owned) > EPS);
  const freeTotal = inYard.reduce((a, p) => a + Math.max(0, p.free), 0);
  const bandTotal = inYard.reduce((a, p) => a + Math.max(0, p.owned), 0);
  const concrete = [...s.concrete].sort((a, b) => (b.make?.canMake ?? -1) - (a.make?.canMake ?? -1));
  const betonMax = concrete.reduce((a, p) => Math.max(a, p.make?.canMake ?? 0), 0);
  const groups = [...cols.map((c) => c.key), "__jami"];

  return (
    <Section id="hovli" title="Hovli va tayyor mahsulot" action={<span className="text-xs text-slate-500">ma&apos;lumot · {dateTime(s.asOf)}</span>}>
      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            { k: "Hovlida erkin", v: `${qty(freeTotal)} dona`, c: "text-emerald-600", h: "zayavkalarga band qilinmagan" },
            { k: "Zayavkalarga band", v: `${qty(bandTotal)} dona`, c: "text-blue-600", h: `${inYard.filter((p) => p.owned > 0).length} xil mahsulot` },
            { k: "Hovlidagi nomlar", v: `${inYard.length} xil`, c: "text-slate-900", h: `yana ${s.pieces.length - inYard.length} tasining qoldig'i yo'q` },
            { k: "Beton — xomashyodan", v: `${qty(betonMax)} m³ gacha`, c: betonMax > 0 ? "text-slate-900" : "text-red-600", h: `${concrete.length} marka · eng ko'p chiqadigani` },
          ].map((x) => (
            <Card key={x.k} className="p-4">
              <div className="text-xs text-slate-500">{x.k}</div>
              <div className={cn("mt-1 text-xl font-bold tabular", x.c)}>{x.v}</div>
              <div className="mt-0.5 text-[11px] text-slate-400">{x.h}</div>
            </Card>
          ))}
        </div>

        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 text-sm">
            <span className="inline-flex items-center gap-1.5 font-semibold text-slate-900"><Boxes size={15} className="text-slate-400" /> Dona mahsulotlar — brigadalar bo&apos;yicha kirim, chiqim, qoldiq</span>
            {canDistribute && (
              <LinkButton href={pick && pick !== "umumiy" ? `/stock/products/ajratish?to=${pick}` : "/stock/products/ajratish"} size="sm" variant="secondary">
                <ArrowRightLeft size={15} /> Brigadalarga ajratish
              </LinkButton>
            )}
          </div>
          <StockPeriodBar base="/stock" period={period} hidden={{ bolim: "hovli", ...(pick ? { ombor: pick } : {}) }} />
          {/* Ombor filtri: faqat bitta brigada ustunlari; raqam — davr oxiridagi qoldiq */}
          {t.columns.length > 1 && (
            <div className="flex flex-wrap items-center gap-1.5" role="navigation" aria-label="Brigada omborlari">
              <span className="mr-1 inline-flex items-center gap-1 text-xs font-medium text-slate-500"><HardHat size={13} /> Ombor:</span>
              {chip(chipHref(null), !pick, "Hammasi", t.rows.reduce((a, r) => a + r.total.close, 0))}
              {t.columns.map((c) => chip(chipHref(urlKey(c.key)), pick === urlKey(c.key), c.name, t.rows.reduce((a, r) => a + cellOf(r, c.key).close, 0), c.owner === null))}
            </div>
          )}
          <YardMovesHost load={yardMovesInfo} from={period.fromStr} to={period.toStr} periodLabel={`Davr: ${period.label}`}>
          <Sheet lang="uz" maxHeight="75vh">
            <SheetHead>
              <tr>
                <SheetTh rowSpan={2} tone="yellow" className="sticky left-0 z-20 min-w-56 text-left">Mahsulot</SheetTh>
                {cols.map((c) => (
                  <SheetTh key={c.key} colSpan={3} tone={c.owner ? "blue" : "plain"} title={c.name} className="max-w-64 whitespace-normal">
                    {c.owner ? <Link href={`/oluvchi/b/${c.owner}`} className="hover:underline">{c.name}</Link> : c.name}
                  </SheetTh>
                ))}
                <SheetTh colSpan={3} tone="gray" title="Butun sklad: brigadalar va umumiy hovli. Ko'chirish kirim/chiqimga qo'shilmaydi">Jami</SheetTh>
                <SheetTh colSpan={2} tone="gray" title="Zayavkalarga band qilingani va erkin qismi — hozirgi holat">Hozir</SheetTh>
              </tr>
              <tr>
                {groups.flatMap((k) => [
                  <SheetTh key={`${k}-i`} tone="green">Kirim</SheetTh>,
                  <SheetTh key={`${k}-o`} tone="red">Chiqim</SheetTh>,
                  <SheetTh key={`${k}-q`} tone="gray">Qoldiq</SheetTh>,
                ])}
                <SheetTh tone="blue">Band</SheetTh>
                <SheetTh tone="green">Erkin</SheetTh>
              </tr>
            </SheetHead>
            <tbody>
              {rows.length === 0 && (
                <tr><SheetTd colSpan={groups.length * 3 + 3} center muted className="py-10">{pick ? `${colName.get(pick)} omborida bu davrda harakat ham, qoldiq ham yo'q` : "Hovlida dona mahsulot yo'q"}</SheetTd></tr>
              )}
              {rows.map((r, i) => {
                const band = bandOf(r), free = freeOf(r);
                return (
                  <SheetTr key={r.productId}>
                    <SheetTd tone="yellow" className="sticky left-0 z-[1] min-w-56">
                      <span className="mr-1.5 inline-block w-5 text-right text-[11px] text-slate-400 tabular">{i + 1}</span>
                      <Link href={`/stock/products/${r.productId}`} className="font-medium text-slate-900 hover:underline">{r.name}</Link>
                      <span className="ml-1 text-[11px] text-slate-400">{unitShort(r.unit)}</span>
                    </SheetTd>
                    {cols.flatMap((c) => {
                      const x = cellOf(r, c.key);
                      return [
                        <SheetTd key={`${c.key}-i`} right tone="green"><Cell productId={r.productId} owner={c.key} dir="in" v={x.in} title={`${c.name}: kirim — kim, qachon (bosing)`} /></SheetTd>,
                        <SheetTd key={`${c.key}-o`} right tone="red"><Cell productId={r.productId} owner={c.key} dir="out" v={x.out} title={`${c.name}: chiqim — kim, qachon (bosing)`} /></SheetTd>,
                        <SheetTd key={`${c.key}-q`} right tone="gray" className={cn("font-semibold", x.close < -EPS ? "text-red-600" : "text-slate-900")}><Cell productId={r.productId} owner={c.key} dir="all" v={x.close} title={`${c.name}: qoldiq — barcha harakatlar (bosing)`} /></SheetTd>,
                      ];
                    })}
                    <SheetTd right tone="green" strong><Cell productId={r.productId} owner="*" dir="in" v={r.total.in} title="Butun sklad: kirim — kim, qachon (bosing)" /></SheetTd>
                    <SheetTd right tone="red" strong><Cell productId={r.productId} owner="*" dir="out" v={r.total.out} title="Butun sklad: chiqim — kim, qachon (bosing)" /></SheetTd>
                    <SheetTd right className={cn("font-bold", r.total.close > EPS ? "bg-emerald-100 text-emerald-900" : r.total.close < -EPS ? "bg-red-100 text-red-700" : "text-slate-400")}>{Math.abs(r.total.close) > EPS ? <Cell productId={r.productId} owner="*" dir="all" v={r.total.close} title="Butun sklad: barcha harakatlar (bosing)" /> : qty(r.total.close)}</SheetTd>
                    <SheetTd right className="font-semibold text-blue-700">{n(band)}</SheetTd>
                    <SheetTd right className={cn("font-semibold", free < -EPS ? "text-red-600" : "text-emerald-700")}>
                      {free < -EPS ? <span title="Band qilingani hovlidagidan ko'p — yetishmaydi">{qty(free)}</span> : n(free)}
                    </SheetTd>
                  </SheetTr>
                );
              })}
            </tbody>
            {rows.length > 0 && (
              <SheetFoot>
                <tr>
                  <SheetTd className="sticky left-0 z-[1]">Jami <span className="font-normal text-slate-500">· {rows.length} ta mahsulot</span></SheetTd>
                  {cols.flatMap((c) => [
                    <SheetTd key={`${c.key}-i`} right className="text-emerald-800">{n(sum((r) => cellOf(r, c.key).in))}</SheetTd>,
                    <SheetTd key={`${c.key}-o`} right className="text-red-700">{n(sum((r) => cellOf(r, c.key).out))}</SheetTd>,
                    <SheetTd key={`${c.key}-q`} right>{qty(sum((r) => cellOf(r, c.key).close))}</SheetTd>,
                  ])}
                  <SheetTd right className="text-emerald-800">{n(sum((r) => r.total.in))}</SheetTd>
                  <SheetTd right className="text-red-700">{n(sum((r) => r.total.out))}</SheetTd>
                  <SheetTd right>{qty(sum((r) => r.total.close))}</SheetTd>
                  <SheetTd right className="text-blue-700">{n(sum(bandOf))}</SheetTd>
                  <SheetTd right className="text-emerald-800">{n(sum(freeOf))}</SheetTd>
                </tr>
              </SheetFoot>
            )}
          </Sheet>
          </YardMovesHost>
          <p className="text-xs text-slate-500">
            Kirim / chiqim — {period.label}; qoldiq — {dateRu(new Date(`${period.toStr}T00:00:00`))} oxiriga. Kirim: brigada topshirig&apos;i, «Tayyor mahsulot qo&apos;shish»,
            obyektdan qaytgani va boshqa ombordan ko&apos;chirilgani; chiqim: reys, brak va boshqa omborga ko&apos;chirilgani. Ko&apos;chirish «Jami» ga qo&apos;shilmaydi.
            Band / Erkin — hozirgi holat. Kirim, chiqim yoki qoldiq sonini bosing — kim, qaysi kuni va soat nechada kiritgani ochiladi. Taqsimlash yoki ko&apos;chirish — mahsulot nomini bosing.
          </p>
          {empty.length > 0 && (
            <details className="group/empty">
              <summary className="cursor-pointer list-none text-[12.5px] font-medium text-slate-500 hover:text-slate-900 [&::-webkit-details-marker]:hidden">
                <span className="group-open/empty:hidden">Qoldig&apos;i yo&apos;q mahsulotlar — {empty.length} ta</span><span className="hidden group-open/empty:inline">Yig&apos;ish</span>
              </summary>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {empty.map((p) => (
                  <Link key={p.id} href={`/stock/products/${p.id}`} className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[12px] text-slate-600 hover:border-slate-300 hover:text-slate-900">
                    {p.name}{p.make && p.make.canMake > 0 && <span className="text-slate-400"> · chiqadi {qty(p.make.canMake)}</span>}
                  </Link>
                ))}
              </div>
            </details>
          )}
        </div>

        <div>
          <div className="mb-2 inline-flex items-center gap-1.5 text-sm font-semibold text-slate-900"><Warehouse size={15} className="text-slate-400" /> Beton — xomashyo qoldig&apos;idan qancha chiqadi</div>
          {concrete.length === 0
            ? <Card className="p-5 text-sm text-slate-500">Beton markasi kiritilmagan.</Card>
            : <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">{concrete.map((p) => <ConcreteCard key={p.id} p={p} />)}</div>}
          <p className="mt-2 text-xs text-slate-500">Beton saqlanmaydi — zakaz olingach tayyorlanadi; raqam hozirgi xomashyo qoldig&apos;i bilan retsept bo&apos;yicha.</p>
        </div>
      </div>
    </Section>
  );
}
