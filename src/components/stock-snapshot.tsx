import Link from "next/link";
import { Warehouse, ArrowRight, Boxes, Factory, PackagePlus } from "lucide-react";
import { stockSnapshot, type LastMove, type MakeInfo, type SnapshotProduct } from "@/lib/stock";
import { qty, dateTime } from "@/lib/format";
import { unitLabel } from "@/lib/unit";
import { Badge, Card, CardHeader, Th, Td, Tr } from "@/components/ui";
import { cn } from "@/lib/utils";

function Who({ last }: { last: LastMove | null }) {
  if (!last) return <span className="text-slate-400">—</span>;
  return (
    <span className="text-slate-600">
      <span className="font-medium text-slate-800">{last.by}</span>
      <span className="text-slate-400"> · {dateTime(last.date)}</span>
    </span>
  );
}

/** Xomashyo qoldig'i bilan yana qancha ishlab chiqarish mumkin (retsept bo'yicha). */
function Make({ make, unit }: { make: MakeInfo; unit: string }) {
  if (!make) return <span className="text-slate-300" title="Retsept kiritilmagan">—</span>;
  return (
    <span className={cn("tabular", make.canMake > 0 ? "text-slate-700" : "text-red-600")} title={make.limiting ? `Cheklovchi: ${make.limiting.name} — qoldiq ${qty(make.limiting.balance)} ${make.limiting.unit}` : undefined}>
      {qty(make.canMake)} {unitLabel(unit)}
    </span>
  );
}

function SectionTitle({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="px-5 pb-1 pt-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">{title}</div>
      {hint && <div className="text-[11px] text-slate-400">{hint}</div>}
    </div>
  );
}

function NoRows({ text, href, action }: { text: string; href: string; action: string }) {
  return (
    <p className="px-5 pb-3 pt-1 text-xs text-slate-500">
      {text} <Link href={href} className="inline-flex items-center gap-1 font-medium text-slate-700 underline"><PackagePlus size={12} /> {action}</Link>
    </p>
  );
}

/** Bitta mahsulot qatori: erkin / band / jami va xomashyodan yana qancha chiqadi. */
function ProductRows({ rows, compact, freeLabelAsTotal }: { rows: SnapshotProduct[]; compact: boolean; freeLabelAsTotal?: boolean }) {
  return (
    <>
      {rows.map((p) => (
        <Tr key={p.id}>
          <Td>
            {freeLabelAsTotal
              ? <span className="font-medium">{p.name}</span>
              : <Link href={`/stock/products/${p.id}`} className="font-medium hover:underline">{p.name}</Link>}{" "}
            <span className="text-slate-400">{unitLabel(p.unit)}</span>
          </Td>
          <Td right className={p.free > 0 ? "font-semibold text-emerald-600" : "text-slate-400"}>{qty(p.free)}</Td>
          {!freeLabelAsTotal && <Td right className="text-blue-600">{qty(p.owned)}</Td>}
          {!freeLabelAsTotal && <Td right>{qty(p.total)}</Td>}
          <Td right><Make make={p.make} unit={p.unit} /></Td>
          {!compact && <Td><Who last={p.last} /></Td>}
        </Tr>
      ))}
    </>
  );
}

/**
 * Sotuv va zayavka bo'limi uchun korxonaning butun qoldig'i: hovlidagi dona mahsulot,
 * beton (zakaz olingach tayyorlanadi — xomashyodan qancha chiqishi) va Skladdagi xomashyo. Raqamlar sklad xodimlari kiritgan
 * kirimlardan (StockMove) olinadi — har qatorda oxirgi kirimni kim va qachon kiritgani
 * ko'rinadi, shunda zayavka qabul qilayotgan xodim kimning ma'lumotiga tayanayotganini biladi.
 *
 * compact — yon panel uchun (kim kiritgani ustuni yashiriladi).
 * layout="grid" — sahifa eni bo'ylab uchta ustun (zayavkalar ro'yxati sahifasi).
 */
export async function StockSnapshotCard({ compact = false, layout = "column", title = "Sklad holati" }: { compact?: boolean; layout?: "column" | "grid"; title?: string }) {
  const s = await stockSnapshot();
  const grid = layout === "grid";
  const cols = grid || compact; // ikkalasida ham "kim kiritgani" ustuni ko'rsatilmaydi
  const freeTotal = s.pieces.reduce((a, p) => a + p.free, 0);
  const lowCount = s.materials.filter((m) => m.low).length;

  const piecesBlock = (
    <div className={cn(!grid && "border-t border-slate-100")}>
      <SectionTitle title="Dona mahsulotlar (hovlida)" hint="erkin = zayavkalarga band qilinmagani" />
      {s.pieces.length === 0 ? (
        <NoRows text="Dona mahsulot yo'q." href="/stock/products/new" action="Skladga qo'shish" />
      ) : (
        <table className="w-full text-sm">
          <thead><tr><Th>Mahsulot</Th><Th right>Erkin</Th><Th right>Band</Th><Th right>Jami</Th><Th right>Yana chiqadi</Th>{!cols && <Th>Oxirgi kirim (kim)</Th>}</tr></thead>
          <tbody><ProductRows rows={s.pieces} compact={cols} /></tbody>
        </table>
      )}
    </div>
  );

  const concreteBlock = (
    <div className={cn(!grid && "border-t border-slate-100")}>
      <SectionTitle title="Beton (m³)" hint="zakaz olingach tayyorlanadi · raqam — xomashyodan retsept bo'yicha qancha chiqishi" />
      {s.concrete.length === 0 ? (
        <NoRows text="Beton markasi kiritilmagan." href="/settings?tab=products" action="Mahsulot qo'shish" />
      ) : (
        <table className="w-full text-sm">
          <thead><tr><Th>Marka</Th><Th right>Xomashyodan chiqadi</Th>{!cols && <Th>Cheklovchi xomashyo</Th>}</tr></thead>
          <tbody>
            {s.concrete.map((p) => (
              <Tr key={p.id}>
                <Td><span className="font-medium">{p.name}</span> <span className="text-slate-400">{unitLabel(p.unit)}</span></Td>
                <Td right><Make make={p.make} unit={p.unit} /></Td>
                {!cols && <Td className="text-slate-600">{p.make?.limiting ? <>{p.make.limiting.name} <span className="text-slate-400">· qoldiq {qty(p.make.limiting.balance)} {p.make.limiting.unit}</span></> : <span className="text-slate-400">—</span>}</Td>}
              </Tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );

  const materialsBlock = (
    <div className={cn(!grid && "border-t border-slate-100")}>
      <SectionTitle title="Xomashyo (Sklad)" hint="ishlab chiqarishning asosi" />
      {s.materials.length === 0 ? (
        <NoRows text="Xomashyo kiritilmagan." href="/stock/materials/new" action="Xomashyo qo'shish" />
      ) : (
        <table className="w-full text-sm">
          <thead><tr><Th>Nomi</Th><Th right>Qoldiq</Th><Th>Holat</Th>{!cols && <Th>Oxirgi kirim (kim)</Th>}</tr></thead>
          <tbody>
            {s.materials.map((m) => (
              <Tr key={m.id}>
                <Td className="font-medium">{m.name}</Td>
                <Td right className={m.balance < 0 ? "text-red-600" : ""}>{qty(m.balance)} {m.unit}</Td>
                <Td>{m.low ? <Badge color="red">Kam qoldi</Badge> : <Badge color="green">Yetarli</Badge>}</Td>
                {!cols && <Td><Who last={m.last} /></Td>}
              </Tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );

  return (
    <Card padded={false}>
      <div className="px-5 pt-5">
        <CardHeader
          title={title}
          icon={Warehouse}
          description={`Sklad xodimlari kiritgan ma'lumot · ${dateTime(s.asOf)}`}
          action={
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <Link href="/stock?tab=capacity" className="inline-flex items-center gap-1 text-slate-500 hover:text-slate-900"><Boxes size={14} /> Hovlidagi mahsulot</Link>
              <Link href="/stock?tab=capacity" className="inline-flex items-center gap-1 text-slate-500 hover:text-slate-900"><Factory size={14} /> Imkoniyat</Link>
              <Link href="/stock" className="inline-flex items-center gap-1 text-slate-500 hover:text-slate-900">Sklad <ArrowRight size={14} /></Link>
            </div>
          }
        />
        <div className="flex flex-wrap gap-x-4 gap-y-1 pb-1 text-xs text-slate-500">
          <span>Dona mahsulot: <b className="text-slate-900">{s.pieces.length}</b> nom · erkin <b className="text-emerald-700">{qty(freeTotal)}</b></span>
          <span>Beton markasi: <b className="text-slate-900">{s.concrete.length}</b></span>
          <span>Xomashyo: <b className="text-slate-900">{s.materials.length}</b> nom{lowCount > 0 && <span className="text-red-600"> · {lowCount} tasi kam qoldi</span>}</span>
        </div>
      </div>

      {grid ? (
        <div className="grid grid-cols-1 gap-x-4 border-t border-slate-100 pt-1 xl:grid-cols-3 xl:divide-x xl:divide-slate-100">
          {[piecesBlock, concreteBlock, materialsBlock].map((block, i) => (
            <div key={i} className="max-h-80 overflow-y-auto">{block}</div>
          ))}
        </div>
      ) : (
        <>{piecesBlock}{concreteBlock}{materialsBlock}</>
      )}

      <p className="border-t border-slate-100 px-5 py-3 text-xs text-slate-500">
        «Yana chiqadi» — hozirgi xomashyo qoldig&apos;i bilan retsept bo&apos;yicha ishlab chiqarish mumkin bo&apos;lgan miqdor.
        Kirim hujjatlari va ularni kim kiritgani — <Link href="/receipts" className="underline">Kirim</Link> bo&apos;limida.
      </p>
    </Card>
  );
}
