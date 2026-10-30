import Link from "next/link";
import { HardHat } from "lucide-react";
import { money, qty } from "@/lib/format";
import { unitLabel } from "@/lib/unit";
import type { BrigadeProducts } from "@/lib/brigade-pay";
import { Badge, Card, Empty, Th, Td, Tr } from "@/components/ui";

/**
 * Qaysi brigadada qanday mahsulot va necha pullik: ochiq topshiriqlar mahsulot bo'yicha (`lib/brigade-pay.ts` → `brigadeProducts`).
 * Summa — qoldiq (hali bajarilmagan) qism: ish haqi = qoldiq × sdelka narxi, sotuv qiymati = qoldiq × mahsulot narxi.
 * Brigadalar sahifasi («Mahsulotlar») va ishlab chiqarish bosh sahifasida bir xil ko'rinadi.
 */
export function BrigadeProductsView({ data, compact }: { data: BrigadeProducts; compact?: boolean }) {
  const list = compact ? data.filter((b) => b.rows.length) : data;
  if (!list.length) return <Card className="text-sm text-slate-500">Brigadalarda ochiq topshiriq yo&apos;q.</Card>;
  const wage = list.reduce((s, b) => s + b.wage, 0), value = list.reduce((s, b) => s + b.value, 0);
  return (
    <Card padded={false}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead><tr><Th>Brigada / mahsulot</Th><Th right>Berilgan</Th><Th right>Bajarildi</Th><Th right>Qoldiq</Th><Th right>Ish haqi (qoldiq)</Th><Th right>Sotuv qiymati (qoldiq)</Th></tr></thead>
          <tbody>
            {list.map((b) => [
              <tr key={b.id} className="bg-slate-50/70">
                <td className="px-4 py-2 font-semibold" colSpan={4}>
                  <span className="inline-flex items-center gap-2"><HardHat size={14} className="text-slate-400" /><Link href={`/tasks?brigade=${b.id}`} className="hover:underline">{b.name}</Link></span>
                  <span className="ml-2 text-xs font-normal text-slate-500">{b.leader ?? "brigadir yo'q"} · {b.rows.length} xil mahsulot</span>
                  {b.noRate > 0 && <span className="ml-2"><Badge color="amber">{b.noRate} tasida sdelka narxi yo&apos;q</Badge></span>}
                </td>
                <td className="px-4 py-2 text-right font-semibold tabular">{money(b.wage)}</td>
                <td className="px-4 py-2 text-right font-semibold tabular">{money(b.value)}</td>
              </tr>,
              ...b.rows.map((r) => (
                <Tr key={`${b.id}-${r.productId}`}>
                  <Td className="pl-10"><span className="font-medium">{r.code}</span> <span className="text-slate-500">{r.name}</span></Td>
                  <Td right className="tabular text-slate-500">{qty(r.given)} {unitLabel(r.unit)}</Td>
                  <Td right className="tabular text-emerald-700">{qty(r.done)}</Td>
                  <Td right className="font-medium tabular">{qty(r.left)} {unitLabel(r.unit)}</Td>
                  <Td right className="tabular">{r.rate > 0 ? <>{money(r.wage)}<div className="text-[11px] text-slate-400">{money(r.rate)} / {unitLabel(r.unit)}</div></> : <span className="text-xs text-amber-700">narx yo&apos;q</span>}</Td>
                  <Td right className="tabular">{money(r.value)}<div className="text-[11px] text-slate-400">{money(r.price)} / {unitLabel(r.unit)}</div></Td>
                </Tr>
              )),
              ...(b.rows.length ? [] : [<Tr key={`${b.id}-none`}><Td colSpan={6} className="pl-10 text-xs text-slate-400">ochiq topshiriq yo&apos;q</Td></Tr>]),
            ])}
            {list.length === 0 && <Empty text="Brigada yo'q" icon={HardHat} />}
          </tbody>
          <tfoot>
            <tr className="border-t border-slate-200 font-semibold"><td className="px-4 py-2.5" colSpan={4}>Jami brigadalarda</td><td className="px-4 py-2.5 text-right tabular">{money(wage)}</td><td className="px-4 py-2.5 text-right tabular">{money(value)}</td></tr>
          </tfoot>
        </table>
      </div>
    </Card>
  );
}
