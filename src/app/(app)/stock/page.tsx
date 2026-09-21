import Link from "next/link";
import { db } from "@/lib/db";
import { qty, money, dateTime } from "@/lib/format";
import { lastInboundMoves } from "@/lib/stock";
import { productionCapacity } from "@/lib/production-capacity";
import { ostatkaSummary } from "@/lib/ostatka";
import { unitLabel } from "@/lib/unit";
import { getSession } from "@/lib/auth";
import { Badge, Callout, Empty, LinkButton, PageHeader, Table, Td, Th, Tr, Tabs } from "@/components/ui";
import { cn } from "@/lib/utils";
import { Boxes, History, Factory, PackagePlus, Plus, ChevronRight } from "lucide-react";

const TYPE_LABEL: Record<string, string> = {
  RECEIPT: "Kirim", PRODUCTION_CONSUME: "Zames chiqimi", PRODUCTION_OUTPUT: "Tayyor beton",
  SHIPMENT: "Jo'natish", ADJUSTMENT: "Inventarizatsiya", WRITE_OFF: "Hisobdan chiqarish",
};
const REF_LINK: Record<string, string> = { GoodsReceipt: "/receipts", ProductionBatch: "/production", Trip: "/trips" };
const REF_LABEL: Record<string, string> = { GoodsReceipt: "Kirim", ProductionBatch: "Zames", Trip: "Reys", Manual: "Qo'lda", StockIn: "Sklad kirimi" };

export default async function StockPage({ searchParams }: { searchParams: Promise<{ tab?: string; added?: string; updated?: string; moved?: string; guessed?: string; ref?: string }> }) {
  const { tab = "balance", added, updated, moved, guessed, ref } = await searchParams;
  const s = await getSession();
  const canAdd = ["PRODUCTION", "WAREHOUSE", "PROCUREMENT", "DIRECTOR"].includes(s?.role ?? "");
  const [materials, mSums, last] = await Promise.all([
    db.material.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
    db.stockMove.groupBy({ by: ["materialId"], where: { materialId: { not: null } }, _sum: { qty: true } }),
    lastInboundMoves(),
  ]);
  const mb = new Map(mSums.map((x) => [x.materialId, Number(x._sum.qty ?? 0)]));

  // O'rtacha tannarx: kirimlar va narxli boshlang'ich qoldiqlar bo'yicha
  const costs = await db.stockMove.groupBy({ by: ["materialId"], where: { type: { in: ["RECEIPT", "ADJUSTMENT"] }, unitCost: { not: null }, materialId: { not: null } }, _sum: { qty: true }, _avg: { unitCost: true } });
  const avgCost = new Map(costs.map((c) => [c.materialId, Number(c._avg.unitCost ?? 0)]));

  // `ref` berilsa — faqat shu hujjat/partiya qatorlari (Kirim-Chiqimdan "batafsil" shu yerga olib keladi)
  const moves = tab === "moves"
    ? await db.stockMove.findMany({ where: ref ? { refId: ref } : undefined, orderBy: { createdAt: "desc" }, take: ref ? 500 : 300, include: { material: true, product: true, warehouse: true, createdBy: true } })
    : [];
  // Ishlab chiqarish imkoni: hozirgi xomashyo qoldig'i bilan har mahsulotdan qancha chiqadi;
  // shu yerda hovlida turgan dona mahsulot (erkin/band) va tayyor beton qoldig'i ham ko'rsatiladi
  const [capacity, pieces, concrete, cSums] = tab === "capacity"
    ? await Promise.all([
        productionCapacity(),
        ostatkaSummary(),
        db.product.findMany({ where: { isActive: true, unit: "m3" }, orderBy: { code: "asc" } }),
        db.stockMove.groupBy({ by: ["productId"], where: { productId: { not: null } }, _sum: { qty: true } }),
      ])
    : [[], [], [], []] as [Awaited<ReturnType<typeof productionCapacity>>, Awaited<ReturnType<typeof ostatkaSummary>>, [], []];
  const cb = new Map(cSums.map((x) => [x.productId, Number(x._sum.qty ?? 0)]));
  const canMakeBy = new Map(capacity.map((c) => [c.productId, c]));
  const pieceTotals = pieces.reduce((a, r) => ({ total: a.total + r.total, free: a.free + r.free, owned: a.owned + r.owned }), { total: 0, free: 0, owned: 0 });

  return (
    <div>
      <PageHeader title="Sklad" subtitle="Xomashyo qoldig'i — ishlab chiqarishning asosi: retseptlar shu xomashyolardan tuziladi, imkoniyat qoldiqqa qarab hisoblanadi."
        action={canAdd ? (
          <div className="flex flex-wrap gap-2">
            <LinkButton href="/stock/products/new" variant="secondary"><Plus size={16} /> Tayyor mahsulot qo&apos;shish</LinkButton>
            <LinkButton href="/stock/materials/new"><PackagePlus size={16} /> Xomashyo qo&apos;shish</LinkButton>
          </div>
        ) : undefined} />
      <Tabs current={tab} items={[{ key: "balance", label: "Qoldiqlar", href: "/stock?tab=balance", icon: Boxes }, { key: "capacity", label: "Ishlab chiqarish imkoni", href: "/stock?tab=capacity", icon: Factory }, { key: "moves", label: "Harakat jurnali", href: "/stock?tab=moves", icon: History }]} />
      {added != null && (
        <Callout tone="success" title="Xomashyo qo'shildi">Yangi: {added} ta · yangilandi: {updated ?? 0} ta · boshlang&apos;ich qoldiq yozildi: {moved ?? 0} ta.{Number(guessed) > 0 && ` ${guessed} ta xomashyoning birligi faylda tanilmadi — "dona" qo'yildi, Sozlamalardan tuzatsangiz bo'ladi.`} <Link href="/stock?tab=capacity" className="underline">Ishlab chiqarish imkonini ko&apos;rish</Link></Callout>
      )}

      {tab === "capacity" && (
        <div className="space-y-4">
          <Table>
            <thead><tr><Th>Mahsulot</Th><Th>Retsept</Th><Th right>Hozir ishlab chiqarish mumkin</Th><Th right>Zayavkalar ehtiyoji</Th><Th>Cheklovchi xomashyo</Th><Th>Holat</Th></tr></thead>
            <tbody>
              {capacity.length === 0 && <Empty text="Faol retseptli mahsulot yo'q — avval Retseptlar bo'limida retsept kiriting" icon={Factory} />}
              {capacity.map((c) => {
                const ok = c.remaining <= 0 ? c.canMake > 0 : c.canMake >= c.remaining;
                return (
                  <Tr key={c.productId}>
                    <Td className="font-medium">{c.product}</Td>
                    <Td><Link href={`/recipes/${c.productId}`} className="text-slate-500 hover:underline">v{c.version}</Link></Td>
                    <Td right className={cn("font-semibold", c.canMake <= 0 ? "text-red-600" : ok ? "text-emerald-700" : "text-amber-700")}>{qty(c.canMake)} {unitLabel(c.unit)}</Td>
                    <Td right className="text-slate-600">{c.remaining > 0 ? `${qty(c.remaining)} ${unitLabel(c.unit)}` : "—"}</Td>
                    <Td className="text-slate-600">{c.limiting ? <>{c.limiting.name} <span className="text-slate-400">· qoldiq {qty(c.limiting.balance)} {c.limiting.unit}, norma {qty(c.limiting.perUnit)}/{unitLabel(c.unit)}</span></> : "—"}</Td>
                    <Td>{c.canMake <= 0 ? <Badge color="red">Xomashyo yo&apos;q</Badge> : ok ? <Badge color="green">Yetarli</Badge> : <Badge color="amber">Zayavkaga yetmaydi</Badge>}</Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
          <div>
            <h2 className="mb-2 font-semibold">Dona mahsulotlar (hovlida)</h2>
            <Table>
              <thead><tr><Th>Mahsulot</Th><Th>Kod</Th><Th>Birlik</Th><Th right>Jami</Th><Th right>Erkin</Th><Th right>Band</Th><Th>Holat</Th><Th></Th></tr></thead>
              <tbody>
                {pieces.length === 0 && <Empty text={"Dona mahsulot yo'q — Sozlamalar → Beton markalari bo'limida birligi \"dona\" bo'lgan mahsulot (ustun, blok, bordyur…) qo'shing"} icon={Boxes} />}
                {pieces.map((r) => (
                  <Tr key={r.id} className="[&>td]:py-4 [&>td]:text-[15px]">
                    <Td><Link href={`/stock/products/${r.id}`} className="hover:underline">{r.name}</Link></Td>
                    <Td className="text-slate-500">{r.code}</Td>
                    <Td className="text-slate-500">{unitLabel(r.unit)}</Td>
                    <Td right className="font-semibold">{qty(r.total)}</Td>
                    <Td right className="text-lg font-semibold text-emerald-600">{qty(r.free)}</Td>
                    <Td right className="text-lg font-semibold text-blue-600">{qty(r.owned)}</Td>
                    <Td>{r.shortage > 0 ? <Badge color="red">{qty(r.shortage)} yetishmaydi</Badge> : r.free > 0 ? <Badge color="green">Erkin bor</Badge> : r.total > 0 ? <Badge color="blue">Hammasi band</Badge> : <Badge>Bo&apos;sh</Badge>}</Td>
                    <Td><Link href={`/stock/products/${r.id}`} className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-900">Ochish <ChevronRight size={14} /></Link></Td>
                  </Tr>
                ))}
                {pieces.length > 0 && (
                  <tr className="bg-slate-50/80 [&>td]:py-4 [&>td]:text-[15px]">
                    <Td className="font-semibold">Jami mahsulot</Td><Td /><Td />
                    <Td right className="font-semibold">{qty(pieceTotals.total)}</Td>
                    <Td right className="text-lg font-semibold text-emerald-600">{qty(pieceTotals.free)} ta</Td>
                    <Td right className="text-lg font-semibold text-blue-600">{qty(pieceTotals.owned)} ta</Td>
                    <Td colSpan={2} className="text-sm text-slate-500">erkin / band</Td>
                  </tr>
                )}
              </tbody>
            </Table>
            <p className="mt-2 text-xs text-slate-500">Hovlida tayyor turgan dona mahsulotlar (ustun, blok, bordyur…). Qatorni bosib, kimga band qilinganini ko&apos;rasiz. Qo&apos;lda kirim qilish — yuqoridagi «Tayyor mahsulot qo&apos;shish».</p>
          </div>

          <div>
            <h2 className="mb-2 font-semibold">Tayyor beton (ishlab chiqarilgan − jo&apos;natilgan)</h2>
            <Table>
              <thead><tr><Th>Marka</Th><Th right>Qoldiq</Th><Th right>Xomashyodan chiqadi</Th><Th>Cheklovchi xomashyo</Th></tr></thead>
              <tbody>
                {concrete.length === 0 && <Empty text="Beton markasi kiritilmagan — Sozlamalar → Beton markalari" icon={Factory} />}
                {concrete.map((p) => {
                  const c = canMakeBy.get(p.id);
                  return (
                    <Tr key={p.id} className="[&>td]:py-4 [&>td]:text-[15px]">
                      <Td className="font-medium">{p.name}</Td>
                      <Td right>{qty(cb.get(p.id) ?? 0)} m³</Td>
                      <Td right className={c ? (c.canMake > 0 ? "font-semibold text-emerald-700" : "font-semibold text-red-600") : "text-slate-400"}>{c ? `${qty(c.canMake)} m³` : "retsept yo'q"}</Td>
                      <Td className="text-slate-600">{c?.limiting ? <>{c.limiting.name} <span className="text-slate-400">· qoldiq {qty(c.limiting.balance)} {c.limiting.unit}</span></> : "—"}</Td>
                    </Tr>
                  );
                })}
              </tbody>
            </Table>
            <p className="mt-2 text-xs text-slate-500">Beton oldindan tayyorlanmaydi — zakaz olingandan keyin ishlab chiqariladi. Shuning uchun &quot;Qoldiq&quot; zames qilingan, lekin hali nakladnoy yozilmagan hajm (nolga yaqin bo&apos;lishi kerak); asosiy ko&apos;rsatkich — xomashyodan retsept bo&apos;yicha qancha chiqishi.</p>
          </div>

          {capacity.some((c) => c.items.some((i) => i.short > 0)) && (
            <div>
              <h2 className="mb-2 font-semibold">Zayavkalar uchun yetishmaydigan xomashyo</h2>
              <Table>
                <thead><tr><Th>Mahsulot</Th><Th>Xomashyo</Th><Th right>Qoldiq</Th><Th right>Kerak</Th><Th right>Yetishmaydi</Th></tr></thead>
                <tbody>
                  {capacity.flatMap((c) => c.items.filter((i) => i.short > 0).map((i) => (
                    <Tr key={`${c.productId}-${i.name}`}><Td>{c.product}</Td><Td className="font-medium">{i.name}</Td><Td right>{qty(i.balance)} {i.unit}</Td><Td right>{qty(c.remaining * i.perUnit)} {i.unit}</Td><Td right className="font-semibold text-red-600">{qty(i.short)} {i.unit}</Td></Tr>
                  )))}
                </tbody>
              </Table>
              <p className="mt-2 text-xs text-slate-500">Kerak = qabul qilingan, hali ishlab chiqarilmagan zayavkalar × retsept normasi. Yetishmayotganini <Link href="/receipts/import" className="underline">Kirim → Excel orqali</Link> yoki <Link href="/receipts/new" className="underline">Kirim</Link> bilan kiriting.</p>
            </div>
          )}
        </div>
      )}

      {tab === "balance" && (
        <div>
          <h2 className="mb-3 font-semibold">Xomashyo</h2>
          <Table>
            <thead><tr><Th>Nomi</Th><Th>Kodi</Th><Th right>Qoldiq</Th><Th right>Minimal</Th><Th right>O'rt. narx</Th><Th right>Qiymati</Th><Th>Holat</Th><Th>Oxirgi kirim (kim)</Th></tr></thead>
            <tbody>
              {materials.length === 0 && <Empty text="Xomashyo kiritilmagan — «Xomashyo qo'shish» tugmasi orqali kiriting" icon={Boxes} />}
              {materials.map((m) => {
                const b = mb.get(m.id) ?? 0, c = avgCost.get(m.id) ?? 0, l = last.materials.get(m.id);
                return (
                  <Tr key={m.id} className="[&>td]:py-4 [&>td]:text-[15px]">
                    <Td className="font-medium">{m.name}</Td>
                    <Td className="text-slate-500">{m.code}</Td>
                    <Td right className={cn("font-semibold", b < 0 && "text-red-600")}>{qty(b)} {m.unit}</Td>
                    <Td right className="text-slate-500">{qty(m.minStock)}</Td>
                    <Td right>{c ? money(c) : "—"}</Td>
                    <Td right>{money(b * c)}</Td>
                    <Td>{b < Number(m.minStock) ? <Badge color="red">Kam qoldi</Badge> : <Badge color="green">Yetarli</Badge>}</Td>
                    <Td className="text-slate-600">{l ? <><span className="font-medium text-slate-800">{l.by}</span><span className="text-slate-400"> · {dateTime(l.date)}</span></> : "—"}</Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
          <p className="mt-2 text-xs text-slate-500">Beton oldindan tayyorlanmaydi — zakaz olingandan keyin ishlab chiqariladi, shuning uchun bu yerda xomashyo qoldig&apos;i asosiy. Retsept bo&apos;yicha qaysi betondan qancha chiqishini <Link href="/stock?tab=capacity" className="underline">Ishlab chiqarish imkoni</Link> ko&apos;rsatadi. Hovlida turgan dona mahsulot va tayyor beton qoldig&apos;i — <Link href="/stock?tab=capacity" className="underline">Ishlab chiqarish imkoni</Link> bo&apos;limida.</p>
        </div>
      )}

      {tab === "moves" && ref && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm">
          <span className="text-slate-600">Bitta hujjat bo&apos;yicha: <b className="text-slate-900">{moves.length} qator</b>, jami <b className="text-slate-900">{money(moves.reduce((x, m) => x + Number(m.qty) * Number(m.unitCost ?? 0), 0))}</b></span>
          <Link href="/stock?tab=moves" className="font-medium text-slate-600 hover:text-slate-900 hover:underline">Barcha harakatlar →</Link>
        </div>
      )}
      {tab === "moves" && (
        <Table>
          <thead><tr><Th>Sana</Th><Th>Turi</Th><Th>Nomi</Th><Th right>Miqdor</Th><Th>Sklad</Th><Th>Hujjat</Th><Th>Kim</Th></tr></thead>
          <tbody>
            {moves.length === 0 && <Empty text="Harakatlar yo'q" />}
            {moves.map((m) => (
              <Tr key={m.id}>
                <Td>{dateTime(m.date)}</Td>
                <Td>{(m.refType === "Manual" || m.refType === "StockIn") && m.note?.startsWith("Boshlang'ich") ? "Boshlang'ich qoldiq" : TYPE_LABEL[m.type]}</Td>
                <Td>{m.material?.name ?? m.product?.name}</Td>
                <Td right className={Number(m.qty) < 0 ? "text-red-600" : "text-emerald-700"}>{Number(m.qty) > 0 ? "+" : ""}{qty(m.qty)} {m.material?.unit ?? m.product?.unit}</Td>
                <Td>{m.warehouse.name}</Td>
                <Td>{m.refType && m.refId && REF_LINK[m.refType] ? <Link href={`${REF_LINK[m.refType]}/${m.refId}`} className="hover:underline">{REF_LABEL[m.refType] ?? m.refType}</Link> : m.refType === "StockIn" && m.refId ? <Link href={`/stock?tab=moves&ref=${m.refId}`} className="hover:underline">Sklad kirimi</Link> : m.refType === "Manual" ? "Qo'lda" : "—"}</Td>
                <Td>{m.createdBy.fullName}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}
