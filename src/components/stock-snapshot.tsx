import Link from "next/link";
import { Warehouse, ArrowRight } from "lucide-react";
import { stockSnapshot, type LastMove } from "@/lib/stock";
import { qty, dateTime } from "@/lib/format";
import { unitLabel } from "@/lib/unit";
import { Badge, Card, CardHeader, Th, Td, Tr } from "@/components/ui";

function Who({ last }: { last: LastMove | null }) {
  if (!last) return <span className="text-slate-400">—</span>;
  return (
    <span className="text-slate-600">
      <span className="font-medium text-slate-800">{last.by}</span>
      <span className="text-slate-400"> · {dateTime(last.date)}</span>
    </span>
  );
}

/**
 * Sotuvchi uchun sklad surati. Raqamlar sklad/snabjeniye xodimlari kiritgan kirimlardan
 * (StockMove) olinadi — har qatorda oxirgi kirimni kim va qachon kiritgani ko'rinadi,
 * shunda mijoz bilan gaplashayotgan xodim aynan kimning ma'lumotiga tayanayotganini biladi.
 */
export async function StockSnapshotCard({ compact = false }: { compact?: boolean }) {
  const s = await stockSnapshot();
  return (
    <Card padded={false}>
      <div className="px-5 pt-5">
        <CardHeader
          title="Sklad holati"
          icon={Warehouse}
          description={`Sklad xodimlari kiritgan ma'lumot · ${dateTime(s.asOf)}`}
          action={<Link href="/stock" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-900">Sklad <ArrowRight size={14} /></Link>}
        />
      </div>

      {s.pieces.length > 0 && (
        <div className="border-t border-slate-100">
          <div className="px-5 pb-1 pt-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Dona mahsulotlar (hovlida)</div>
          <table className="w-full text-sm">
            <thead><tr><Th>Mahsulot</Th><Th right>Erkin</Th><Th right>Band</Th><Th right>Jami</Th>{!compact && <Th>Oxirgi kirim (kim)</Th>}</tr></thead>
            <tbody>
              {s.pieces.map((p) => (
                <Tr key={p.id}>
                  <Td><Link href={`/astatka/${p.id}`} className="font-medium hover:underline">{p.name}</Link> <span className="text-slate-400">{unitLabel(p.unit)}</span></Td>
                  <Td right className={p.free > 0 ? "font-semibold text-emerald-600" : "text-slate-400"}>{qty(p.free)}</Td>
                  <Td right className="text-blue-600">{qty(p.owned)}</Td>
                  <Td right>{qty(p.total)}</Td>
                  {!compact && <Td><Who last={p.last} /></Td>}
                </Tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {s.concrete.length > 0 && (
        <div className="border-t border-slate-100">
          <div className="px-5 pb-1 pt-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Tayyor beton (zames qilingan, jo'natilmagan)</div>
          <table className="w-full text-sm">
            <thead><tr><Th>Marka</Th><Th right>m³</Th>{!compact && <Th>Oxirgi zames (kim)</Th>}</tr></thead>
            <tbody>
              {s.concrete.map((p) => (
                <Tr key={p.id}>
                  <Td className="font-medium">{p.name}</Td>
                  <Td right>{qty(p.balance)}</Td>
                  {!compact && <Td><Who last={p.last} /></Td>}
                </Tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="border-t border-slate-100">
        <div className="px-5 pb-1 pt-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Xomashyo (ishlab chiqarish imkoniyati)</div>
        <table className="w-full text-sm">
          <thead><tr><Th>Nomi</Th><Th right>Qoldiq</Th><Th>Holat</Th>{!compact && <Th>Oxirgi kirim (kim)</Th>}</tr></thead>
          <tbody>
            {s.materials.map((m) => (
              <Tr key={m.id}>
                <Td className="font-medium">{m.name}</Td>
                <Td right className={m.balance < 0 ? "text-red-600" : ""}>{qty(m.balance)} {m.unit}</Td>
                <Td>{m.low ? <Badge color="red">Kam qoldi</Badge> : <Badge color="green">Yetarli</Badge>}</Td>
                {!compact && <Td><Who last={m.last} /></Td>}
              </Tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="px-5 py-3 text-xs text-slate-500">Kirim hujjatlari va ularni kim kiritgani — <Link href="/receipts" className="underline">Kirim (snabjeniye)</Link> bo'limida.</p>
    </Card>
  );
}
