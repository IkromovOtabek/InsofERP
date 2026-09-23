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
import { Boxes, History, Factory, PackagePlus, Plus, ChevronRight, ClipboardList, HardHat, ShoppingBasket } from "lucide-react";
import { brigadeStocks, undistributedMaterials } from "@/lib/brigade-stock";
import { BrigadeDistributeForm, BrigadeReturnForm } from "./brigade-form";
import { Card, CardHeader } from "@/components/ui";

const TYPE_LABEL: Record<string, string> = {
  RECEIPT: "Kirim", PRODUCTION_CONSUME: "Zames chiqimi", PRODUCTION_OUTPUT: "Tayyor beton",
  SHIPMENT: "Jo'natish", ADJUSTMENT: "Inventarizatsiya", WRITE_OFF: "Hisobdan chiqarish",
  BRIGADE_ISSUE: "Brigadaga berildi", BRIGADE_RETURN: "Brigadadan qaytdi",
};
const REF_LINK: Record<string, string> = { GoodsReceipt: "/receipts", ProductionBatch: "/production", Trip: "/trips" };
const REF_LABEL: Record<string, string> = { GoodsReceipt: "Kirim", ProductionBatch: "Zames", Trip: "Reys", Manual: "Qo'lda", StockIn: "Sklad kirimi", Brigade: "Brigada" };

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
  // Yangi kelgan ta'minot (oxirgi 7 kun): "yangi mahsulotlar keldi" belgisi va brigadaga taqsimlash taklifi
  // Kelgan, lekin hali brigadalarga berilmagan mahsulotlar — "Brigadalar" yozuvi oldidagi raqam
  const undistributed = await undistributedMaterials();
  const arrivals = await db.supplyRequest.findMany({
    where: { status: "RECEIVED", updatedAt: { gte: new Date(Date.now() - 7 * 864e5) } },
    orderBy: { updatedAt: "desc" }, take: 5,
    include: { items: true, receipt: { select: { id: true, docNo: true } } },
  });
  // Brigadalar tabi: qoldiq, ishlab chiqarish imkoni va taqsimlash formasi
  const [brigStocks, warehouses] = tab === "brigades"
    ? await Promise.all([
        brigadeStocks(),
        db.warehouse.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
      ])
    : [[], []] as [Awaited<ReturnType<typeof brigadeStocks>>, { id: string; name: string }[]];

  const canMakeBy = new Map(capacity.map((c) => [c.productId, c]));
  const pieceTotals = pieces.reduce((a, r) => ({ total: a.total + r.total, free: a.free + r.free, owned: a.owned + r.owned }), { total: 0, free: 0, owned: 0 });

  return (
    <div>
      <PageHeader title="Sklad" subtitle="Xomashyo qoldig'i — ishlab chiqarishning asosi: retseptlar shu xomashyolardan tuziladi, imkoniyat qoldiqqa qarab hisoblanadi."
        action={canAdd ? (
          <div className="flex flex-wrap gap-2">
            <LinkButton href="/snabjeniye" variant="ghost"><ShoppingBasket size={16} /> Snabjeniye oynasi</LinkButton>
            <LinkButton href="/stock/products/new" variant="secondary"><Plus size={16} /> Tayyor mahsulot qo&apos;shish</LinkButton>
            <LinkButton href="/stock/materials/new" variant="secondary"><PackagePlus size={16} /> Xomashyo qo&apos;shish</LinkButton>
            {/* Kerakli mahsulotlar jadvali — snabjeniye zanjirining boshi */}
            <LinkButton href="/stock/supply/new"><ClipboardList size={16} /> Kerakli mahsulotlar</LinkButton>
          </div>
        ) : undefined} />
      <Tabs current={tab} items={[{ key: "balance", label: "Qoldiqlar", href: "/stock?tab=balance", icon: Boxes }, { key: "capacity", label: "Ishlab chiqarish imkoni", href: "/stock?tab=capacity", icon: Factory }, { key: "brigades", href: "/stock?tab=brigades", icon: HardHat,
          label: undistributed.count > 0
            ? <>Brigadalar <span className="rounded-full bg-red-100 px-1.5 py-0.5 text-[11px] font-bold text-red-700">{undistributed.count}</span></>
            : "Brigadalar" }, { key: "moves", label: "Harakat jurnali", href: "/stock?tab=moves", icon: History }]} />
      {added != null && (
        <Callout tone="success" title="Xomashyo qo'shildi">Yangi: {added} ta · yangilandi: {updated ?? 0} ta · boshlang&apos;ich qoldiq yozildi: {moved ?? 0} ta.{Number(guessed) > 0 && ` ${guessed} ta xomashyoning birligi faylda tanilmadi — "dona" qo'yildi, Sozlamalardan tuzatsangiz bo'ladi.`} <Link href="/stock?tab=capacity" className="underline">Ishlab chiqarish imkonini ko&apos;rish</Link></Callout>
      )}

      {arrivals.length > 0 && (tab === "balance" || tab === "brigades") && (
        <Callout tone="success" title={`Yangi mahsulotlar keldi — ${arrivals.length} ta ta'minot qabul qilindi`}>
          <ul className="space-y-0.5">
            {arrivals.map((a) => (
              <li key={a.id}>
                <Link href={`/taminot/${a.id}`} className="font-medium underline">{a.docNo}</Link>
                {" · "}{a.items.length} qator{a.receipt ? <> · kirim <Link href={`/receipts/${a.receipt.id}`} className="underline">{a.receipt.docNo}</Link></> : null}
                {" · "}{money(a.items.reduce((x, i) => x + Number(i.factQty ?? i.qty) * Number(i.factPrice ?? i.price), 0))}
              </li>
            ))}
          </ul>
          {tab !== "brigades" && <Link href="/stock?tab=brigades" className="mt-1 inline-block font-medium underline">Brigadalarga taqsimlash →</Link>}
        </Callout>
      )}

      {tab === "brigades" && (
        <div className="space-y-5">
          <Card padded={false}>
            <div className="p-5">
              <CardHeader icon={HardHat}
                title={undistributed.count > 0 ? `Brigadaga xomashyo berish · ${undistributed.count} ta mahsulot hali berilmagan` : "Brigadaga xomashyo berish"}
                description={undistributed.count > 0
                  ? `Taqsimlanmagan: ${undistributed.names.slice(0, 6).join(", ")}${undistributed.names.length > 6 ? ` va yana ${undistributed.names.length - 6} ta` : ""}. Berilgani sklad qoldig'idan chiqadi, brigada qoldig'iga o'tadi.`
                  : "Kelgan mahsulotlarni brigadalarga taqsimlaysiz: berilgani sklad qoldig'idan chiqadi, brigada qoldig'iga o'tadi. Topshiriq bajarilganda retsept bo'yicha o'zi kamayadi."} />
            </div>
            <div className="px-5 pb-5">
              {brigStocks.length === 0 ? (
                <p className="text-sm text-slate-500">Brigadalar yo&apos;q — avval <Link href="/brigades" className="underline">Brigadalar</Link> bo&apos;limida qo&apos;shing.</p>
              ) : (
                <BrigadeDistributeForm
                  brigades={brigStocks.map((b) => ({ id: b.id, name: b.name, leader: b.leader }))}
                  warehouses={warehouses}
                  materials={materials.filter((m) => (mb.get(m.id) ?? 0) > 0.0005).map((m) => ({ id: m.id, name: m.name, code: m.code, unit: m.unit, balance: mb.get(m.id) ?? 0 }))}
                />
              )}
            </div>
          </Card>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {brigStocks.map((b) => {
              const makes = b.makes.filter((m) => m.canMake > 0).sort((x, y) => y.canMake - x.canMake).slice(0, 6);
              return (
                <Card key={b.id} padded={false}>
                  <div className="p-5">
                    <CardHeader icon={HardHat} title={b.name}
                      description={`${b.leader ?? "brigadirsiz"} · ochiq topshiriq qoldig'i ${qty(b.openQty)}`}
                      action={<Badge color={b.value > 0 ? "green" : "slate"}>{money(b.value)}</Badge>} />
                    {b.materials.length === 0 ? (
                      <p className="text-sm text-slate-500">Qo&apos;lida xomashyo yo&apos;q — yuqoridagi forma orqali bering.</p>
                    ) : (
                      <table className="w-full text-sm">
                        <thead><tr className="text-left text-xs text-slate-500"><th className="py-1">Xomashyo</th><th className="py-1 text-right">Qoldiq</th><th className="py-1 text-right">Qiymati</th></tr></thead>
                        <tbody>
                          {b.materials.map((m) => (
                            <tr key={m.materialId} className="border-t border-slate-100">
                              <td className="py-1.5">{m.name}</td>
                              <td className={cn("py-1.5 text-right tabular", m.qty < 0 && "font-medium text-red-600")}>{qty(m.qty)} {unitLabel(m.unit)}</td>
                              <td className="py-1.5 text-right tabular text-slate-500">{money(m.cost)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                    {b.materials.length > 0 && warehouses[0] && (
                      <BrigadeReturnForm brigadeId={b.id} warehouseId={warehouses[0].id} materials={b.materials.map((m) => ({ materialId: m.materialId, name: m.name, unit: m.unit, qty: m.qty }))} />
                    )}
                    <h3 className="mt-4 mb-1.5 text-[13px] font-semibold text-slate-700">Shu xomashyo bilan ishlab chiqara oladi</h3>
                    {makes.length === 0 ? (
                      <p className="text-sm text-slate-500">Hech narsa — retsept xomashyosi yetishmaydi.</p>
                    ) : (
                      <ul className="space-y-1 text-sm">
                        {makes.map((m) => (
                          <li key={m.productId} className="flex items-center justify-between gap-3">
                            <span className="min-w-0 truncate text-slate-700">{m.product}</span>
                            <span className="shrink-0 font-semibold text-emerald-700 tabular">{qty(m.canMake)} {unitLabel(m.unit)}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>
          <p className="text-xs text-slate-500">Brigada qoldig&apos;i manfiy chiqsa — topshiriq skladdan xomashyo olmasdan bajarilgan (qarzga yozilgan): shu miqdorni brigadaga bersangiz nolga tushadi.</p>
        </div>
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
                <Td>{m.refType && m.refId && REF_LINK[m.refType] ? <Link href={`${REF_LINK[m.refType]}/${m.refId}`} className="hover:underline">{REF_LABEL[m.refType] ?? m.refType}</Link> : m.refType === "StockIn" && m.refId ? <Link href={`/stock?tab=moves&ref=${m.refId}`} className="hover:underline">Sklad kirimi</Link> : m.refType === "Brigade" ? <Link href="/stock?tab=brigades" className="hover:underline">Brigada</Link> : m.refType === "Manual" ? "Qo'lda" : "—"}</Td>
                <Td>{m.createdBy.fullName}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}
