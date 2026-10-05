import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { date, dateTime, money, qty } from "@/lib/format";
import { lineBase, lineTotal, receiptAmounts } from "@/lib/receipt-vat";
import { Badge, Card, PageHeader, Table, Td, Th, Tr } from "@/components/ui";
import { requirePage } from "@/lib/page-guard";
import { canDo } from "@/lib/permissions";
import { ConfirmButton } from "../../payments/confirm-button";
import { stornoReceipt } from "../actions";

export default async function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const s = await requirePage("/receipts");
  const { id } = await params;
  const r = await db.goodsReceipt.findUnique({ where: { id }, include: { supplier: true, warehouse: true, createdBy: true, items: { include: { material: true } }, supply: { select: { id: true } } } });
  if (!r) notFound();
  const { base, vat, total } = receiptAmounts(r.items);
  // Storno faqat direktor (yoki direktor bergan amal); to'lov bog'langan bo'lsa server rad etadi va sababini aytadi
  const [paid, cancelledBy] = await Promise.all([
    db.cashTransaction.aggregate({ where: { type: "EXPENSE", refType: "GoodsReceipt", refId: id }, _sum: { amount: true } }),
    r.cancelledById ? db.user.findUnique({ where: { id: r.cancelledById }, select: { fullName: true } }) : null,
  ]);
  const paidSum = Number(paid._sum.amount ?? 0);
  const canStorno = !r.cancelledAt && !r.supply && canDo(s, "stock", "receipt_storno");
  return (
    <div>
      <PageHeader back={{ href: "/receipts", label: "Kirim" }} title={`Kirim ${r.docNo}`} subtitle={`${date(r.date)} · ${r.supplier.name} → ${r.warehouse.name}${r.createdBy ? ` · kiritdi: ${r.createdBy.fullName}` : ""}`}
        action={canStorno ? <ConfirmButton action={stornoReceipt.bind(null, r.id)} label="Storno" question={paidSum > 0.005 ? `Kirimga ${money(paidSum)} to'lov bog'langan — avval to'lovni storno qiling. Baribir urinib ko'rasizmi?` : `${r.docNo} storno qilinsinmi? Xomashyo skladdan qaytariladi`} reason="required" okText="Storno qilindi" className="h-9 px-3 text-sm" /> : undefined} />
      {r.cancelledAt && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <Badge color="red">Storno</Badge> {dateTime(r.cancelledAt)}{cancelledBy ? ` · ${cancelledBy.fullName}` : ""} — {r.cancelReason}. Sklad harakatlari teskari yozilgan; kirim qoldiq, tannarx va qarzga kirmaydi.
        </div>
      )}
      {/* QQS'siz summa + QQS = to'lanadigan jami (yetkazuvchi qarzi shu jami bo'yicha) */}
      <div className="mb-6 flex flex-wrap gap-3">
        <Card className="inline-block"><div className="text-sm text-slate-500">QQS&apos;siz</div><div className="mt-1 text-lg font-semibold tabular">{money(base)}</div></Card>
        <Card className="inline-block"><div className="text-sm text-slate-500">QQS</div><div className="mt-1 text-lg font-semibold tabular">{money(vat)}</div></Card>
        <Card className="inline-block"><div className="text-sm text-slate-500">Jami (QQS bilan)</div><div className={r.cancelledAt ? "mt-1 text-xl font-semibold text-slate-400 line-through" : "mt-1 text-xl font-semibold"}>{money(total)}</div>{paidSum > 0.005 && <div className="text-xs text-slate-500">to&apos;langan {money(paidSum)}</div>}</Card>
      </div>
      <Table>
        <thead><tr><Th>Xomashyo</Th><Th right>Miqdor</Th><Th right>Narx (QQS&apos;siz)</Th><Th right>Summa (QQS&apos;siz)</Th><Th right>QQS</Th><Th right>Jami</Th></tr></thead>
        <tbody>{r.items.map((i) => <Tr key={i.id}><Td>{i.material.name}</Td><Td right>{qty(i.qty)} {i.material.unit}</Td><Td right>{money(i.price)}</Td><Td right>{money(lineBase(i))}</Td><Td right className="text-slate-600">{i.vatRate ? `${money(i.vatAmount)} · ${i.vatRate}%` : "QQS'siz"}</Td><Td right className="font-medium">{money(lineTotal(i))}</Td></Tr>)}</tbody>
      </Table>
      {r.note && <p className="mt-4 text-sm text-slate-600">Izoh: {r.note}</p>}
    </div>
  );
}
