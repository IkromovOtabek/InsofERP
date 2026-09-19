import Link from "next/link";
import { db } from "@/lib/db";
import { qty, money, dateTime } from "@/lib/format";
import { lastInboundMoves } from "@/lib/stock";
import { productionCapacity } from "@/lib/production-capacity";
import { unitLabel } from "@/lib/unit";
import { getSession } from "@/lib/auth";
import { Badge, Callout, Empty, LinkButton, PageHeader, Table, Td, Th, Tr, Tabs } from "@/components/ui";
import { cn } from "@/lib/utils";
import { Boxes, History, Factory, PackagePlus } from "lucide-react";

const TYPE_LABEL: Record<string, string> = {
  RECEIPT: "Kirim", PRODUCTION_CONSUME: "Zames chiqimi", PRODUCTION_OUTPUT: "Tayyor beton",
  SHIPMENT: "Jo'natish", ADJUSTMENT: "Inventarizatsiya", WRITE_OFF: "Hisobdan chiqarish",
};
const REF_LINK: Record<string, string> = { GoodsReceipt: "/receipts", ProductionBatch: "/production", Trip: "/trips" };
const REF_LABEL: Record<string, string> = { GoodsReceipt: "Kirim", ProductionBatch: "Zames", Trip: "Reys", Manual: "Qo'lda" };

export default async function StockPage({ searchParams }: { searchParams: Promise<{ tab?: string; added?: string; updated?: string; moved?: string }> }) {
  const { tab = "balance", added, updated, moved } = await searchParams;
  const s = await getSession();
  const canAdd = ["PRODUCTION", "WAREHOUSE", "PROCUREMENT", "DIRECTOR"].includes(s?.role ?? "");
  const [materials, products, mSums, pSums, last] = await Promise.all([
    db.material.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
    db.product.findMany({ where: { isActive: true, unit: "m3" }, orderBy: { code: "asc" } }),
    db.stockMove.groupBy({ by: ["materialId"], where: { materialId: { not: null } }, _sum: { qty: true } }),
    db.stockMove.groupBy({ by: ["productId"], where: { productId: { not: null } }, _sum: { qty: true } }),
    lastInboundMoves(),
  ]);
  const mb = new Map(mSums.map((x) => [x.materialId, Number(x._sum.qty ?? 0)]));
  const pb = new Map(pSums.map((x) => [x.productId, Number(x._sum.qty ?? 0)]));

  // O'rtacha tannarx: kirimlar va narxli boshlang'ich qoldiqlar bo'yicha
  const costs = await db.stockMove.groupBy({ by: ["materialId"], where: { type: { in: ["RECEIPT", "ADJUSTMENT"] }, unitCost: { not: null }, materialId: { not: null } }, _sum: { qty: true }, _avg: { unitCost: true } });
  const avgCost = new Map(costs.map((c) => [c.materialId, Number(c._avg.unitCost ?? 0)]));

  const moves = tab === "moves"
    ? await db.stockMove.findMany({ orderBy: { createdAt: "desc" }, take: 300, include: { material: true, product: true, warehouse: true, createdBy: true } })
    : [];
  // Ishlab chiqarish imkoni: hozirgi xomashyo qoldig'i bilan har mahsulotdan qancha chiqadi
  const capacity = tab === "capacity" ? await productionCapacity() : [];

  return (
    <div>
      <PageHeader title="Sklad" subtitle="Xomashyo qoldig'i — ishlab chiqarishning asosi: retseptlar shu xomashyolardan tuziladi, imkoniyat qoldiqqa qarab hisoblanadi."
        action={canAdd ? <LinkButton href="/stock/materials/new"><PackagePlus size={16} /> Xomashyo qo&apos;shish</LinkButton> : undefined} />
      <Tabs current={tab} items={[{ key: "balance", label: "Qoldiqlar", href: "/stock?tab=balance", icon: Boxes }, { key: "capacity", label: "Ishlab chiqarish imkoni", href: "/stock?tab=capacity", icon: Factory }, { key: "moves", label: "Harakat jurnali", href: "/stock?tab=moves", icon: History }]} />
      {added != null && (
        <Callout tone="success" title="Xomashyo qo'shildi">Yangi: {added} ta · yangilandi: {updated ?? 0} ta · boshlang&apos;ich qoldiq yozildi: {moved ?? 0} ta. <Link href="/stock?tab=capacity" className="underline">Ishlab chiqarish imkonini ko&apos;rish</Link></Callout>
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
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <div>
            <h2 className="mb-3 font-semibold">Xomashyo</h2>
            <Table>
              <thead><tr><Th>Nomi</Th><Th right>Qoldiq</Th><Th right>Minimal</Th><Th right>O'rt. narx</Th><Th right>Qiymati</Th><Th>Holat</Th><Th>Oxirgi kirim (kim)</Th></tr></thead>
              <tbody>
                {materials.map((m) => {
                  const b = mb.get(m.id) ?? 0, c = avgCost.get(m.id) ?? 0, l = last.materials.get(m.id);
                  return (
                    <Tr key={m.id}>
                      <Td className="font-medium">{m.name}</Td>
                      <Td right className={b < 0 ? "text-red-600" : ""}>{qty(b)} {m.unit}</Td>
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
          </div>
          <div>
            <h2 className="mb-3 font-semibold">Tayyor beton (ishlab chiqarilgan − jo'natilgan)</h2>
            <Table>
              <thead><tr><Th>Marka</Th><Th right>Qoldiq</Th></tr></thead>
              <tbody>{products.map((p) => <Tr key={p.id}><Td className="font-medium">{p.name}</Td><Td right>{qty(pb.get(p.id) ?? 0)} m³</Td></Tr>)}</tbody>
            </Table>
            <p className="mt-2 text-xs text-slate-500">Tayyor beton saqlanmaydi — bu raqam zames qilingan, lekin hali nakladnoy yozilmagan hajmni ko'rsatadi. Nolga yaqin bo'lishi kerak. Dona mahsulotlar (ustun, blok) qoldig'i — <Link href="/astatka" className="underline">Astatka</Link> sahifasida.</p>
          </div>
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
                <Td>{m.refType === "Manual" && m.note?.startsWith("Boshlang'ich") ? "Boshlang'ich qoldiq" : TYPE_LABEL[m.type]}</Td>
                <Td>{m.material?.name ?? m.product?.name}</Td>
                <Td right className={Number(m.qty) < 0 ? "text-red-600" : "text-emerald-700"}>{Number(m.qty) > 0 ? "+" : ""}{qty(m.qty)} {m.material?.unit ?? m.product?.unit}</Td>
                <Td>{m.warehouse.name}</Td>
                <Td>{m.refType && m.refId && REF_LINK[m.refType] ? <Link href={`${REF_LINK[m.refType]}/${m.refId}`} className="hover:underline">{REF_LABEL[m.refType] ?? m.refType}</Link> : m.refType === "Manual" ? "Qo'lda" : "—"}</Td>
                <Td>{m.createdBy.fullName}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}
