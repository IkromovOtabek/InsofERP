import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { customerMarks } from "@/lib/finance";
import { CustomerName } from "@/components/customer-name";
import { date, dateTime, qty } from "@/lib/format";
import { Badge, Card, PageHeader, Table, Td, Th, Tr } from "@/components/ui";
import { unitLabel } from "@/lib/unit";
import { requirePage } from "@/lib/page-guard";
import { canDo } from "@/lib/permissions";
import { ConfirmButton } from "../../payments/confirm-button";
import { stornoBatch } from "../actions";

export default async function BatchPage({ params }: { params: Promise<{ id: string }> }) {
  const s = await requirePage("/production");
  const { id } = await params;
  const b = await db.productionBatch.findUnique({
    where: { id },
    include: { product: true, recipe: { include: { items: { include: { material: true, product: true } } } }, order: { include: { customer: true } }, createdBy: true },
  });
  if (!b) notFound();
  const marks = await customerMarks(b.order ? [b.order.customerId] : []);
  const moves = await db.stockMove.findMany({ where: { refType: "ProductionBatch", refId: id }, orderBy: { createdAt: "asc" }, include: { material: true, product: true, warehouse: true } });
  const cancelledBy = b.cancelledById ? await db.user.findUnique({ where: { id: b.cancelledById }, select: { fullName: true } }) : null;
  // Storno faqat direktor (yoki direktor bergan amal); mahsulot jo'natilgan bo'lsa server rad etadi
  const canStorno = !b.cancelledAt && canDo(s, "production", "batch_storno");

  return (
    <div>
      <PageHeader title={`Zames ${b.batchNo}`} subtitle={`${date(b.date)} · ${b.shift}-smena · ${b.createdBy.fullName}`}
        action={canStorno ? <ConfirmButton action={stornoBatch.bind(null, b.id)} label="Storno" question={`${b.batchNo} storno qilinsinmi? Xomashyo skladga qaytadi, ${qty(b.qtyM3)} ${unitLabel(b.product.unit)} mahsulot qoldiqdan chiqariladi`} reason="required" okText="Storno qilindi" className="h-9 px-3 text-sm" /> : undefined} />
      {b.cancelledAt && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <Badge color="red">Storno</Badge> {dateTime(b.cancelledAt)}{cancelledBy ? ` · ${cancelledBy.fullName}` : ""} — {b.cancelReason}. Sklad harakatlari teskari yozilgan; zames ishlab chiqarish hisobiga kirmaydi.
        </div>
      )}
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card><div className="text-sm text-slate-500">Marka</div><div className="mt-1 text-lg font-semibold">{b.product.name}</div><div className="text-xs text-slate-500">retsept v{b.recipe.version}</div></Card>
        <Card><div className="text-sm text-slate-500">Miqdor</div><div className="mt-1 text-lg font-semibold">{qty(b.qtyM3)} {unitLabel(b.product.unit)}</div></Card>
        <Card><div className="text-sm text-slate-500">Zayavka</div><div className="mt-1 text-lg font-semibold">{b.order ? <Link href={`/orders/${b.order.id}`} className="hover:underline">{b.order.orderNo}</Link> : "—"}</div>{b.order && <div className="text-xs text-slate-500"><CustomerName name={b.order.customer.name} blacklisted={marks.black.has(b.order.customerId)} contracted={marks.contract.has(b.order.customerId)} /></div>}</Card>
      </div>
      <h2 className="mb-3 font-semibold">Sklad harakati</h2>
      <Table>
        <thead><tr><Th>Turi</Th><Th>Nomi</Th><Th right>Norma (1 {unitLabel(b.product.unit)})</Th><Th right>Miqdor</Th><Th>Sklad</Th></tr></thead>
        <tbody>
          {moves.map((m) => {
            // Ingredient xomashyo yoki mahsulot bo'lishi mumkin — harakat ham shunga qarab material yoki productId bilan yozilgan
            const norm = b.recipe.items.find((i) => (m.materialId && i.materialId === m.materialId) || (m.productId && i.productId === m.productId));
            const unit = m.material?.unit ?? m.product?.unit;
            return (
              <Tr key={m.id}>
                <Td>{m.type === "PRODUCTION_CONSUME" ? (Number(m.qty) < 0 ? "Chiqim" : "Storno (qaytdi)") : (Number(m.qty) > 0 ? "Kirim" : "Storno (chiqarildi)")}</Td>
                <Td>{m.material?.name ?? m.product?.name}</Td>
                <Td right>{norm ? `${qty(norm.qtyPerM3)} ${unit}` : "—"}</Td>
                <Td right className={Number(m.qty) < 0 ? "text-red-600" : "text-emerald-700"}>{qty(m.qty)} {unit}</Td>
                <Td>{m.warehouse.name}</Td>
              </Tr>
            );
          })}
        </tbody>
      </Table>
      {b.note && <p className="mt-4 text-sm text-slate-600">Izoh: {b.note}</p>}
    </div>
  );
}
