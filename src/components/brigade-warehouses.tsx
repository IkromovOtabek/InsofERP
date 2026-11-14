import Link from "next/link";
import { HardHat } from "lucide-react";
import { ownerOverview } from "@/lib/brigade-products";
import { qty } from "@/lib/format";
import { unitLabel } from "@/lib/unit";
import { Empty, InfoButton, Table, Td, Th, Tr } from "@/components/ui";
import { cn } from "@/lib/utils";

/**
 * «Brigada omborlari» — tayyor dona mahsulot qaysi brigada javobgarligida turgani (mahsulot × ombor).
 * Sklad → Ishlab chiqarish imkoni tabida. Ko'chirish — mahsulot sahifasida (qatordagi nom).
 */
export async function BrigadeWarehouses() {
  const { columns, rows } = await ownerOverview();
  const totals = Object.fromEntries(columns.map((c) => [c.key, rows.reduce((s, r) => s + (r.byOwner[c.key] ?? 0), 0)]));
  return (
    <div>
      <h2 className="mb-2 flex items-center gap-2 font-semibold"><HardHat size={18} className="text-slate-500" /> Brigada omborlari
        <InfoButton title="Brigada omborlari">
          <p>Brigada bajargan mahsulot o&apos;z omboriga tushadi, reysga yuklanganda va brak yozilganda o&apos;sha ombordan yechiladi.</p>
          <p>«Umumiy hovli» — hech bir brigadaga biriktirilmagan qoldiq (avvalgi kirimlar).</p>
          <p>Taqsimlash yoki ko&apos;chirish — mahsulot nomini bosing.</p>
        </InfoButton>
      </h2>
      <Table>
        <thead>
          <tr>
            <Th>Mahsulot</Th>
            {columns.map((c) => <Th key={c.key} right className={c.owner ? undefined : "bg-slate-100"}>{c.owner ? <Link href={`/oluvchi/b/${c.owner}`} className="hover:underline">{c.name}</Link> : c.name}</Th>)}
            <Th right>Jami</Th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && <Empty text="Hovlida dona mahsulot yo'q" icon={HardHat} />}
          {rows.map((r) => (
            <Tr key={r.productId}>
              <Td className="font-medium"><Link href={`/stock/products/${r.productId}#ombor`} className="hover:underline">{r.name}</Link></Td>
              {columns.map((c) => {
                const v = r.byOwner[c.key] ?? 0;
                return <Td key={c.key} right className={cn(!c.owner && "bg-slate-50/70", v < 0 ? "font-semibold text-red-600" : v > 0 ? "font-semibold text-slate-900" : "text-slate-300")}>{v ? qty(v) : "—"}</Td>;
              })}
              <Td right className="font-semibold">{qty(r.total)} <span className="font-normal text-slate-500">{unitLabel(r.unit)}</span></Td>
            </Tr>
          ))}
          {rows.length > 1 && (
            <tr className="bg-slate-50/80">
              <Td className="font-semibold">Jami</Td>
              {columns.map((c) => <Td key={c.key} right className="font-semibold">{qty(totals[c.key] ?? 0)}</Td>)}
              <Td right className="font-semibold">{qty(rows.reduce((s, r) => s + r.total, 0))}</Td>
            </tr>
          )}
        </tbody>
      </Table>
    </div>
  );
}
