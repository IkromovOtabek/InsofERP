import Link from "next/link";
import { ArrowRight, HardHat } from "lucide-react";
import { money, qty } from "@/lib/format";
import { fmtUnitTotals, unitLabel } from "@/lib/unit";
import type { BrigadeProducts } from "@/lib/brigade-pay";
import { Badge, Card, Progress } from "@/components/ui";

/**
 * Qaysi brigadada qanday mahsulot va necha pullik: ochiq topshiriqlar mahsulot bo'yicha (`lib/brigade-pay.ts` → `brigadeProducts`).
 * Har brigada — alohida karta: qoldiq (hali bajarilmagan) mahsulot soni va qiymati = qoldiq × mahsulot narxi (mahsulot kartochkasidagi narx —
 * skladda tayyor mahsulotning boshqa narxi yo'q). Ish haqi bu yerda emas — «Oylik» tabida.
 * Brigadalar sahifasi («Mahsulotlar») va ishlab chiqarish bosh sahifasida bir xil ko'rinadi (`compact` — faqat ishi borlar).
 */
export function BrigadeProductsView({ data, compact }: { data: BrigadeProducts; compact?: boolean }) {
  const list = (compact ? data.filter((b) => b.rows.length) : data).slice().sort((a, b) => (b.rows.length ? 1 : 0) - (a.rows.length ? 1 : 0));
  if (!list.length) return <Card className="text-sm text-slate-500">Brigadalarda ochiq topshiriq yo&apos;q.</Card>;
  const value = list.reduce((s, b) => s + b.value, 0);
  const count = fmtUnitTotals(list.flatMap((b) => b.rows.map((r) => ({ unit: r.unit, qty: r.left }))));
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {list.map((b) => (
          <Card key={b.id} className={b.rows.length ? "" : "opacity-80"}>
            <div className="flex items-start justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600"><HardHat size={16} /></div>
                <div className="min-w-0">
                  <Link href={`/tasks?brigade=${b.id}`} className="block font-semibold leading-snug hover:underline">{b.name}</Link>
                  <div className="truncate text-xs text-slate-500">{b.leader ?? "brigadir yo'q"}</div>
                </div>
              </div>
              {b.rows.length ? <Badge color="blue">{b.rows.length} xil</Badge> : <Badge color="slate">ish yo&apos;q</Badge>}
            </div>

            {b.rows.length > 0 && (
              <>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <div className="rounded-lg bg-slate-50 px-3 py-2">
                    <div className="text-[11px] uppercase tracking-wide text-slate-400">Soni</div>
                    <div className="font-semibold tabular">{fmtUnitTotals(b.rows.map((r) => ({ unit: r.unit, qty: r.left })))}</div>
                  </div>
                  <div className="rounded-lg bg-slate-50 px-3 py-2">
                    <div className="text-[11px] uppercase tracking-wide text-slate-400">Qiymati</div>
                    <div className="font-semibold tabular">{money(b.value)}</div>
                  </div>
                </div>
                <ul className="mt-3 space-y-2.5 text-sm">
                  {b.rows.map((r) => (
                    <li key={r.productId}>
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="min-w-0 truncate"><span className="font-medium">{r.code}</span> <span className="text-slate-500">{r.name}</span></span>
                        <span className="shrink-0 font-semibold tabular">{qty(r.left)} {unitLabel(r.unit)}</span>
                      </div>
                      <Progress value={r.done} max={r.given || 1} tone={r.done >= r.given && r.given > 0 ? "success" : "default"} />
                      <div className="mt-0.5 flex flex-wrap justify-between gap-x-3 text-[11px] text-slate-500">
                        <span className="whitespace-nowrap tabular">bajarildi {qty(r.done)} / {qty(r.given)}</span>
                        <span className="whitespace-nowrap tabular">{r.price > 0 ? <>{money(r.price)} × {qty(r.left)} = <b className="text-slate-700">{money(r.value)}</b></> : <span className="text-amber-700">narx yo&apos;q</span>}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            )}
            <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-2 text-xs text-slate-500">
              <span>{b.rows.length ? "hali ishlab chiqarilmagan qism" : "ochiq topshiriq yo'q"}</span>
              <Link href={`/tasks?brigade=${b.id}`} className="inline-flex items-center gap-1 hover:text-slate-900">Topshiriqlar <ArrowRight size={12} /></Link>
            </div>
          </Card>
        ))}
      </div>
      <Card className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="font-semibold">Jami brigadalarda (qoldiq)</span>
        <span className="tabular">{count} · <b>{money(value)}</b></span>
      </Card>
    </div>
  );
}
