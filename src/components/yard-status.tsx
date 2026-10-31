import Link from "next/link";
import { Boxes, Factory, Warehouse } from "lucide-react";
import { stockSnapshot, type SnapshotProduct } from "@/lib/stock";
import { dateTime, qty } from "@/lib/format";
import { unitLabel } from "@/lib/unit";
import { Card, Section } from "@/components/ui";
import { cn } from "@/lib/utils";

/**
 * Sklad → «Qoldiqlar»: hovlidagi dona mahsulot va beton — kartalar ko'rinishida (`RawStockStatus` ostida).
 * Har mahsulot kartasida: erkin (zayavkalarga band qilinmagan) qoldiq katta raqam bilan, erkin/band chizig'i,
 * xomashyo qoldig'idan retsept bo'yicha yana qancha chiqadi va oxirgi kirim (kim, qachon).
 * Qoldig'i yo'q nomlar pastda yig'iq ro'yxatda. Ma'lumot `lib/stock.ts` → `stockSnapshot` (Sotuv kartasi bilan bir manba).
 */

/** Xomashyodan yana qancha chiqadi — 0 bo'lsa qizil va qaysi xomashyo cheklayotgani. */
function MakeLine({ p }: { p: SnapshotProduct }) {
  if (!p.make) return <span className="text-slate-400">retsept yo&apos;q</span>;
  const none = p.make.canMake <= 0;
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1", none ? "text-red-600" : "text-slate-600")}
      title={p.make.limiting ? `Cheklovchi: ${p.make.limiting.name} — qoldiq ${qty(p.make.limiting.balance)} ${p.make.limiting.unit}` : undefined}>
      <Factory size={12} className="shrink-0" />
      <span className="truncate">yana chiqadi <b className="tabular">{qty(p.make.canMake)}</b>{none && p.make.limiting && ` · ${p.make.limiting.name} yo'q`}</span>
    </span>
  );
}

function PieceCard({ p }: { p: SnapshotProduct }) {
  const free = Math.max(0, p.free), band = Math.max(0, p.owned);
  const base = Math.max(free + band, 1);
  const short = p.free < 0; // band qilingani qoldiqdan ko'p — hovlida yetmaydi
  return (
    <Link href={`/stock/products/${p.id}`} className="group block min-w-0">
      <Card className={cn("flex h-full min-w-0 flex-col gap-2.5 p-4 transition group-hover:border-slate-300 group-hover:shadow-(--shadow-pop)", short && "border-red-200")}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 truncate text-[14px] font-semibold text-slate-900" title={p.name}>{p.name}</div>
          <span className="shrink-0 text-[11px] text-slate-400">{unitLabel(p.unit)}</span>
        </div>
        <div className="flex items-end justify-between gap-2">
          <div>
            <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400">erkin</div>
            <div className={cn("text-2xl leading-none font-bold tabular", short ? "text-red-600" : free > 0 ? "text-emerald-600" : "text-slate-400")}>{qty(p.free)}</div>
          </div>
          <div className="text-right text-[12px] leading-tight tabular text-slate-500">
            <div>jami <b className="text-slate-800">{qty(p.total)}</b></div>
            <div>band <b className="text-blue-600">{qty(p.owned)}</b></div>
          </div>
        </div>
        {/* Yashil — erkin, ko'k — zayavkalarga band */}
        <div className="flex h-2 w-full overflow-hidden rounded-full bg-slate-100" role="img" aria-label={`Erkin ${qty(free)}, band ${qty(band)}`}>
          <div className="h-full bg-emerald-500" style={{ width: `${(free / base) * 100}%` }} />
          <div className="h-full bg-blue-500" style={{ width: `${(band / base) * 100}%` }} />
        </div>
        <div className="flex flex-col gap-0.5 text-[11.5px]">
          <MakeLine p={p} />
          {p.last && <span className="truncate text-slate-400">oxirgi kirim: {p.last.by} · {dateTime(p.last.date)}</span>}
        </div>
      </Card>
    </Link>
  );
}

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

export async function YardStatus() {
  const s = await stockSnapshot();
  // Hovlida bori yoki zayavkaga band qilingani bor — karta; qolgani (qoldig'i yo'q) yig'iq ro'yxatda
  const active = s.pieces.filter((p) => Math.abs(p.total) > 0.0005 || Math.abs(p.owned) > 0.0005).sort((a, b) => b.total - a.total);
  const empty = s.pieces.filter((p) => !active.includes(p));
  const freeTotal = active.reduce((a, p) => a + Math.max(0, p.free), 0);
  const bandTotal = active.reduce((a, p) => a + Math.max(0, p.owned), 0);
  const concrete = [...s.concrete].sort((a, b) => (b.make?.canMake ?? -1) - (a.make?.canMake ?? -1));
  const betonMax = concrete.reduce((a, p) => Math.max(a, p.make?.canMake ?? 0), 0);

  return (
    <Section id="hovli" title="Hovli va tayyor mahsulot" action={<span className="text-xs text-slate-500">ma&apos;lumot · {dateTime(s.asOf)}</span>}>
      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            { k: "Hovlida erkin", v: `${qty(freeTotal)} dona`, c: "text-emerald-600", h: "zayavkalarga band qilinmagan" },
            { k: "Zayavkalarga band", v: `${qty(bandTotal)} dona`, c: "text-blue-600", h: `${active.filter((p) => p.owned > 0).length} xil mahsulot` },
            { k: "Hovlidagi nomlar", v: `${active.length} xil`, c: "text-slate-900", h: `yana ${empty.length} tasining qoldig'i yo'q` },
            { k: "Beton — xomashyodan", v: `${qty(betonMax)} m³ gacha`, c: betonMax > 0 ? "text-slate-900" : "text-red-600", h: `${concrete.length} marka · eng ko'p chiqadigani` },
          ].map((x) => (
            <Card key={x.k} className="p-4">
              <div className="text-xs text-slate-500">{x.k}</div>
              <div className={cn("mt-1 text-xl font-bold tabular", x.c)}>{x.v}</div>
              <div className="mt-0.5 text-[11px] text-slate-400">{x.h}</div>
            </Card>
          ))}
        </div>

        <div>
          <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <span className="inline-flex items-center gap-1.5 font-semibold text-slate-900"><Boxes size={15} className="text-slate-400" /> Dona mahsulotlar (hovlida)</span>
            <span className="inline-flex items-center gap-1.5 text-xs text-slate-500"><span className="h-2 w-2 rounded-full bg-emerald-500" /> erkin</span>
            <span className="inline-flex items-center gap-1.5 text-xs text-slate-500"><span className="h-2 w-2 rounded-full bg-blue-500" /> zayavkaga band</span>
          </div>
          {active.length === 0
            ? <Card className="p-5 text-sm text-slate-500">Hovlida dona mahsulot yo&apos;q.</Card>
            : <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">{active.map((p) => <PieceCard key={p.id} p={p} />)}</div>}
          {empty.length > 0 && (
            <details className="group/empty mt-2">
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
