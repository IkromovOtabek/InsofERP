import Link from "next/link";
import { db } from "@/lib/db";
import { requireRoles } from "@/lib/page-guard";
import { avgUnitCosts } from "@/lib/stock";
import { money, qty, dateTime } from "@/lib/format";
import { Callout, Card, PageHeader, Table, Td, Th, Tr } from "@/components/ui";
import { cn } from "@/lib/utils";
import { InventoryForm } from "./inventory-form";
import { DIRECTOR_NOTIFY_SUM } from "../adjust-const";

/**
 * Sklad → Inventarizatsiya (sanab chiqish). Tanlangan skladdagi har bir xomashyoning hisobdagi qoldig'i
 * ko'rsatiladi, sklad xodimi haqiqiy (sanalgan) miqdorni yozadi — farq ADJUSTMENT (±) bo'lib, sabab bilan
 * yoziladi. Oxirgi sanoqlar pastda (kim, qachon, qancha farq).
 */
export default async function InventoryPage({ searchParams }: { searchParams: Promise<{ wh?: string }> }) {
  await requireRoles(["WAREHOUSE"], { module: "stock", actions: ["adjust"] });
  const { wh } = await searchParams;
  const warehouses = await db.warehouse.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } });
  const current = warehouses.find((w) => w.id === wh) ?? warehouses[0];
  const [materials, sums, costs, recent] = await Promise.all([
    db.material.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true, code: true, unit: true } }),
    current ? db.stockMove.groupBy({ by: ["materialId"], where: { warehouseId: current.id, materialId: { not: null } }, _sum: { qty: true } }) : Promise.resolve([]),
    avgUnitCosts(),
    db.stockMove.findMany({
      where: { refType: "Inventory" }, orderBy: { createdAt: "desc" }, take: 30,
      include: { material: { select: { name: true, unit: true } }, warehouse: { select: { name: true } }, createdBy: { select: { fullName: true } } },
    }),
  ]);
  const bal = new Map(sums.map((x) => [x.materialId!, Number(x._sum.qty ?? 0)]));

  return (
    <div>
      <PageHeader back={{ href: "/stock", label: "Sklad" }} title="Inventarizatsiya"
        subtitle="Skladni sanab chiqing: hisobdagi va haqiqiy qoldiq solishtiriladi, farq sabab bilan qoldiqqa tuzatish bo'lib yoziladi." />
      {!current ? (
        <Callout tone="warning" title="Sklad yo'q">Avval Sozlamalarda sklad oching.</Callout>
      ) : (
        <>
          <Callout tone="info" title="Qanday ishlaydi">
            Faqat sanagan qatorlaringizni to&apos;ldiring — bo&apos;sh qator o&apos;zgarmaydi. Farq summasi {money(DIRECTOR_NOTIFY_SUM)} dan oshsa,
            yoziladi va direktorga xabar ketadi. Brak yoki yo&apos;qotish bo&apos;lsa — <Link href="/stock/spisanie" className="underline">Hisobdan chiqarish</Link>.
          </Callout>
          <Card className="mt-4">
            <InventoryForm
              warehouses={warehouses}
              warehouseId={current.id}
              rows={materials.map((m) => ({ id: m.id, name: m.name, code: m.code, unit: m.unit, book: Math.round((bal.get(m.id) ?? 0) * 1000) / 1000, cost: costs.get(m.id) ?? 0 }))}
            />
          </Card>
        </>
      )}

      <h2 className="mt-8 mb-2 font-semibold">Oxirgi sanoq farqlari</h2>
      <Table>
        <thead><tr><Th>Sana</Th><Th>Sklad</Th><Th>Xomashyo</Th><Th right>Farq</Th><Th right>Summa</Th><Th>Izoh</Th><Th>Kim</Th></tr></thead>
        <tbody>
          {recent.length === 0 && <tr><td colSpan={7} className="px-4 py-6 text-center text-sm text-slate-500">Hali sanoq yozilmagan</td></tr>}
          {recent.map((m) => (
            <Tr key={m.id}>
              <Td className="whitespace-nowrap text-slate-500">{dateTime(m.createdAt)}</Td>
              <Td>{m.warehouse.name}</Td>
              <Td className="font-medium">{m.material?.name ?? "—"}</Td>
              <Td right className={cn("font-semibold", Number(m.qty) < 0 ? "text-red-600" : "text-emerald-700")}>{Number(m.qty) > 0 ? "+" : ""}{qty(m.qty)} {m.material?.unit}</Td>
              <Td right>{m.unitCost ? money(Math.abs(Number(m.qty)) * Number(m.unitCost)) : "—"}</Td>
              <Td className="max-w-80 text-slate-600">{m.note}</Td>
              <Td className="text-slate-600">{m.createdBy.fullName}</Td>
            </Tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}
