import Link from "next/link";
import { db } from "@/lib/db";
import { requireRoles } from "@/lib/page-guard";
import { finishedUnitCosts } from "@/lib/bi/core";
import { PRODUCT_INVENTORY_REF } from "@/lib/stock-adjust";
import { money, qty, dateTime } from "@/lib/format";
import { unitLabel } from "@/lib/unit";
import { Callout, Card, PageHeader, Table, Td, Th, Tr } from "@/components/ui";
import { cn } from "@/lib/utils";
import { InventoryForm } from "../inventory-form";
import { DIRECTOR_NOTIFY_SUM } from "../../adjust-const";

/**
 * Sklad → Tayyor mahsulot sanog'i (sanoq akti). Tanlangan skladdagi har bir dona mahsulotning (plita, kolso, FBS…) hisobdagi
 * qoldig'i ko'rsatiladi, sklad xodimi sanalgan miqdorni yozadi — farq ADJUSTMENT (±) bo'lib, akt raqami va sabab bilan yoziladi
 * (`lib/stock-adjust.ts` → `saveProductCount`). Oy oxiri sanog'i (Sarvar rejasi 2-bosqich) shu yerda.
 */
export default async function ProductInventoryPage({ searchParams }: { searchParams: Promise<{ wh?: string }> }) {
  await requireRoles(["WAREHOUSE"], { module: "stock", actions: ["adjust"] });
  const { wh } = await searchParams;
  const warehouses = await db.warehouse.findMany({ where: { isActive: true }, orderBy: [{ isDefault: "desc" }, { name: "asc" }], select: { id: true, name: true } });
  const current = warehouses.find((w) => w.id === wh) ?? warehouses[0];
  const [products, sums, costs, recent] = await Promise.all([
    db.product.findMany({ where: { isActive: true, unit: { not: "m3" } }, orderBy: { name: "asc" }, select: { id: true, name: true, code: true, unit: true } }),
    current ? db.stockMove.groupBy({ by: ["productId"], where: { warehouseId: current.id, productId: { not: null } }, _sum: { qty: true } }) : Promise.resolve([]),
    finishedUnitCosts(),
    db.stockMove.findMany({
      where: { refType: PRODUCT_INVENTORY_REF }, orderBy: { createdAt: "desc" }, take: 30,
      include: { product: { select: { name: true, unit: true } }, warehouse: { select: { name: true } }, createdBy: { select: { fullName: true } } },
    }),
  ]);
  const bal = new Map(sums.map((x) => [x.productId!, Number(x._sum.qty ?? 0)]));

  return (
    <div>
      <PageHeader back={{ href: "/stock/inventarizatsiya", label: "Inventarizatsiya" }} title="Tayyor mahsulot sanog'i"
        info={<>
          <p>Hovlidagi tayyor dona mahsulotni sanab chiqing: hisobdagi va haqiqiy qoldiq solishtiriladi, farq sanoq akti raqami va sabab bilan qoldiqqa tuzatish bo&apos;lib yoziladi. Ortiqcha — umumiy hovliga, kamomad — avval umumiy hovlidan, keyin brigada omborlaridan.</p>
          <p>Faqat sanagan qatorlaringizni to&apos;ldiring — bo&apos;sh qator o&apos;zgarmaydi. Farq tannarx bo&apos;yicha {money(DIRECTOR_NOTIFY_SUM)} dan oshsa direktorga xabar ketadi. Beton (m³) sanalmaydi. Xomashyo — <Link href="/stock/inventarizatsiya" className="underline">Inventarizatsiya</Link>.</p>
        </>} />
      {!current ? (
        <Callout tone="warning" title="Sklad yo'q">Avval Sozlamalarda sklad oching.</Callout>
      ) : (
        <Card>
          <InventoryForm kind="product" warehouses={warehouses} warehouseId={current.id}
            rows={products.map((p) => ({ id: p.id, name: p.name, code: p.code, unit: p.unit, book: Math.round((bal.get(p.id) ?? 0) * 1000) / 1000, cost: costs.get(p.id) ?? 0 }))} />
        </Card>
      )}

      <h2 className="mt-8 mb-2 font-semibold">Oxirgi sanoq aktlari</h2>
      <Table>
        <thead><tr><Th>Sana</Th><Th>Sklad</Th><Th>Mahsulot</Th><Th right>Farq</Th><Th>Izoh</Th><Th>Kim</Th></tr></thead>
        <tbody>
          {recent.length === 0 && <tr><td colSpan={6} className="px-4 py-6 text-center text-sm text-slate-500">Hali tayyor mahsulot sanog&apos;i yozilmagan</td></tr>}
          {recent.map((m) => (
            <Tr key={m.id}>
              <Td className="whitespace-nowrap text-slate-500">{dateTime(m.createdAt)}</Td>
              <Td>{m.warehouse.name}</Td>
              <Td className="font-medium">{m.product?.name ?? "—"}</Td>
              <Td right className={cn("font-semibold", Number(m.qty) < 0 ? "text-red-600" : "text-emerald-700")}>{Number(m.qty) > 0 ? "+" : ""}{qty(m.qty)} {m.product ? unitLabel(m.product.unit) : ""}</Td>
              <Td className="max-w-96 text-slate-600">{m.note}</Td>
              <Td className="text-slate-600">{m.createdBy.fullName}</Td>
            </Tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}
