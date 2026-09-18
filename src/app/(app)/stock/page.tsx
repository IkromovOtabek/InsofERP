import Link from "next/link";
import { db } from "@/lib/db";
import { qty, money, dateTime } from "@/lib/format";
import { Badge, Empty, PageHeader, Table, Td, Th, Tr, Tabs } from "@/components/ui";
import { Boxes, History } from "lucide-react";

const TYPE_LABEL: Record<string, string> = {
  RECEIPT: "Kirim", PRODUCTION_CONSUME: "Zames chiqimi", PRODUCTION_OUTPUT: "Tayyor beton",
  SHIPMENT: "Jo'natish", ADJUSTMENT: "Inventarizatsiya", WRITE_OFF: "Hisobdan chiqarish",
};
const REF_LINK: Record<string, string> = { GoodsReceipt: "/receipts", ProductionBatch: "/production", Trip: "/trips" };
const REF_LABEL: Record<string, string> = { GoodsReceipt: "Kirim", ProductionBatch: "Zames", Trip: "Reys", Manual: "Qo'lda" };

export default async function StockPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab = "balance" } = await searchParams;
  const [materials, products, mSums, pSums] = await Promise.all([
    db.material.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
    db.product.findMany({ where: { isActive: true, unit: "m3" }, orderBy: { code: "asc" } }),
    db.stockMove.groupBy({ by: ["materialId"], where: { materialId: { not: null } }, _sum: { qty: true } }),
    db.stockMove.groupBy({ by: ["productId"], where: { productId: { not: null } }, _sum: { qty: true } }),
  ]);
  const mb = new Map(mSums.map((x) => [x.materialId, Number(x._sum.qty ?? 0)]));
  const pb = new Map(pSums.map((x) => [x.productId, Number(x._sum.qty ?? 0)]));

  // O'rtacha tannarx: kirimlar bo'yicha (∑qty·cost / ∑qty)
  const costs = await db.stockMove.groupBy({ by: ["materialId"], where: { type: "RECEIPT", materialId: { not: null } }, _sum: { qty: true }, _avg: { unitCost: true } });
  const avgCost = new Map(costs.map((c) => [c.materialId, Number(c._avg.unitCost ?? 0)]));

  const moves = tab === "moves"
    ? await db.stockMove.findMany({ orderBy: { createdAt: "desc" }, take: 300, include: { material: true, product: true, warehouse: true, createdBy: true } })
    : [];

  return (
    <div>
      <PageHeader title="Sklad" />
      <Tabs current={tab} items={[{ key: "balance", label: "Qoldiqlar", href: "/stock?tab=balance", icon: Boxes }, { key: "moves", label: "Harakat jurnali", href: "/stock?tab=moves", icon: History }]} />

      {tab === "balance" && (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <div>
            <h2 className="mb-3 font-semibold">Xomashyo</h2>
            <Table>
              <thead><tr><Th>Nomi</Th><Th right>Qoldiq</Th><Th right>Minimal</Th><Th right>O'rt. narx</Th><Th right>Qiymati</Th><Th>Holat</Th></tr></thead>
              <tbody>
                {materials.map((m) => {
                  const b = mb.get(m.id) ?? 0, c = avgCost.get(m.id) ?? 0;
                  return (
                    <Tr key={m.id}>
                      <Td className="font-medium">{m.name}</Td>
                      <Td right className={b < 0 ? "text-red-600" : ""}>{qty(b)} {m.unit}</Td>
                      <Td right className="text-slate-500">{qty(m.minStock)}</Td>
                      <Td right>{c ? money(c) : "—"}</Td>
                      <Td right>{money(b * c)}</Td>
                      <Td>{b < Number(m.minStock) ? <Badge color="red">Kam qoldi</Badge> : <Badge color="green">Yetarli</Badge>}</Td>
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
                <Td>{TYPE_LABEL[m.type]}</Td>
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
