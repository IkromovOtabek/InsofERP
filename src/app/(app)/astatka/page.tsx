import Link from "next/link";
import { Boxes, Plus, ChevronRight } from "lucide-react";
import { ostatkaSummary } from "@/lib/ostatka";
import { qty } from "@/lib/format";
import { unitLabel } from "@/lib/unit";
import { Badge, EmptyState, LinkButton, PageHeader, Table, Td, Th, Tr } from "@/components/ui";

export default async function AstatkaPage() {
  const rows = await ostatkaSummary();
  const total = rows.reduce((s, r) => s + r.total, 0);
  const free = rows.reduce((s, r) => s + r.free, 0);
  const owned = rows.reduce((s, r) => s + r.owned, 0);

  return (
    <div>
      <PageHeader title="Astatka" subtitle="Hovlida tayyor turgan mahsulotlar. Qatorni bosib, kimga band qilinganini ko'ring." action={<LinkButton href="/astatka/new"><Plus size={16} /> Qo'shish</LinkButton>} />
      {rows.length === 0 ? (
        <EmptyState icon={Boxes} title="Dona mahsulotlar yo'q" text={"Sozlamalar → Beton markalari bo'limida birligi \"dona\" bo'lgan mahsulot (ustun, blok, bordyur…) qo'shing."}
          action={<LinkButton href="/settings?tab=products" variant="secondary">Mahsulot qo'shish</LinkButton>} />
      ) : (
        <Table>
          <thead><tr><Th>Mahsulot</Th><Th>Kod</Th><Th>Birlik</Th><Th right>Jami</Th><Th right>Erkin</Th><Th right>Band</Th><Th>Holat</Th><Th></Th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <Tr key={r.id} className="[&>td]:py-4 [&>td]:text-[15px]">
                <Td><Link href={`/astatka/${r.id}`} className="hover:underline">{r.name}</Link></Td>
                <Td className="text-slate-500">{r.code}</Td>
                <Td className="text-slate-500">{unitLabel(r.unit)}</Td>
                <Td right className="font-semibold">{qty(r.total)}</Td>
                <Td right className="text-lg font-semibold text-emerald-600">{qty(r.free)}</Td>
                <Td right className="text-lg font-semibold text-blue-600">{qty(r.owned)}</Td>
                <Td>{r.shortage > 0 ? <Badge color="red">{qty(r.shortage)} yetishmaydi</Badge> : r.free > 0 ? <Badge color="green">Erkin bor</Badge> : r.total > 0 ? <Badge color="blue">Hammasi band</Badge> : <Badge>Bo'sh</Badge>}</Td>
                <Td><Link href={`/astatka/${r.id}`} className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-900">Ochish <ChevronRight size={14} /></Link></Td>
              </Tr>
            ))}
            <tr className="bg-slate-50/80 [&>td]:py-4 [&>td]:text-[15px]">
              <Td className="font-semibold">Jami mahsulot</Td><Td /><Td />
              <Td right className="font-semibold">{qty(total)}</Td>
              <Td right className="text-lg font-semibold text-emerald-600">{qty(free)} ta</Td>
              <Td right className="text-lg font-semibold text-blue-600">{qty(owned)} ta</Td>
              <Td colSpan={2} className="text-sm text-slate-500">erkin / band</Td>
            </tr>
          </tbody>
        </Table>
      )}
    </div>
  );
}
