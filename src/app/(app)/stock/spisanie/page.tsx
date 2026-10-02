import Link from "next/link";
import { db } from "@/lib/db";
import { requireRoles } from "@/lib/page-guard";
import { avgUnitCosts } from "@/lib/stock";
import { money, qty, dateTime } from "@/lib/format";
import { Callout, Card, PageHeader, Table, Td, Th, Tr } from "@/components/ui";
import { WriteOffForm } from "./writeoff-form";
import { DIRECTOR_NOTIFY_SUM } from "../adjust-const";

/**
 * Sklad → Xomashyoni hisobdan chiqarish (spisanie): brak, yo'qotish, muddati o'tgan.
 * StockMove WRITE_OFF (−), sabab majburiy, skladdagi qoldiqdan oshmaydi.
 */
export default async function WriteOffPage({ searchParams }: { searchParams: Promise<{ wh?: string }> }) {
  await requireRoles(["WAREHOUSE"]);
  const { wh } = await searchParams;
  const warehouses = await db.warehouse.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } });
  const current = warehouses.find((w) => w.id === wh) ?? warehouses[0];
  const [materials, sums, costs, recent] = await Promise.all([
    db.material.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true, code: true, unit: true } }),
    current ? db.stockMove.groupBy({ by: ["materialId"], where: { warehouseId: current.id, materialId: { not: null } }, _sum: { qty: true } }) : Promise.resolve([]),
    avgUnitCosts(),
    db.stockMove.findMany({
      where: { type: "WRITE_OFF", materialId: { not: null } }, orderBy: { createdAt: "desc" }, take: 30,
      include: { material: { select: { name: true, unit: true } }, warehouse: { select: { name: true } }, createdBy: { select: { fullName: true } } },
    }),
  ]);
  const bal = new Map(sums.map((x) => [x.materialId!, Number(x._sum.qty ?? 0)]));
  const stock = materials
    .map((m) => ({ id: m.id, name: m.name, code: m.code, unit: m.unit, balance: Math.round((bal.get(m.id) ?? 0) * 1000) / 1000, cost: costs.get(m.id) ?? 0 }))
    .filter((m) => m.balance > 0.0005);

  return (
    <div>
      <PageHeader back={{ href: "/stock", label: "Sklad" }} title="Xomashyoni hisobdan chiqarish"
        subtitle="Brak, yo'qotish, muddati o'tgan xomashyo — sabab bilan skladdan chiqariladi. Qoldiqdan ko'p chiqarib bo'lmaydi." />
      {!current ? (
        <Callout tone="warning" title="Sklad yo'q">Avval Sozlamalarda sklad oching.</Callout>
      ) : (
        <>
          <Callout tone="info" title="Eslatma">
            Summasi {money(DIRECTOR_NOTIFY_SUM)} dan katta hisobdan chiqarish direktorga xabar qilinadi. Sanoqda topilgan farq —{" "}
            <Link href="/stock/inventarizatsiya" className="underline">Inventarizatsiya</Link> orqali.
          </Callout>
          <Card className="mt-4"><WriteOffForm warehouses={warehouses} warehouseId={current.id} materials={stock} /></Card>
        </>
      )}

      <h2 className="mt-8 mb-2 font-semibold">Oxirgi hisobdan chiqarishlar</h2>
      <Table>
        <thead><tr><Th>Sana</Th><Th>Sklad</Th><Th>Xomashyo</Th><Th right>Miqdor</Th><Th right>Summa</Th><Th>Sabab</Th><Th>Kim</Th></tr></thead>
        <tbody>
          {recent.length === 0 && <tr><td colSpan={7} className="px-4 py-6 text-center text-sm text-slate-500">Hali hisobdan chiqarilmagan</td></tr>}
          {recent.map((m) => (
            <Tr key={m.id}>
              <Td className="whitespace-nowrap text-slate-500">{dateTime(m.createdAt)}</Td>
              <Td>{m.warehouse.name}</Td>
              <Td className="font-medium">{m.material?.name ?? "—"}</Td>
              <Td right className="font-semibold text-red-600">{qty(m.qty)} {m.material?.unit}</Td>
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
