import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { dateTime, money, opAt, qty } from "@/lib/format";
import { lineDelivery, lineGoods, lineTotal, receiptAmounts } from "@/lib/receipt-vat";
import { resolveReceiptPayments, waybillFromNote } from "@/lib/receipts";
import { Copy, HardHat, Wrench } from "lucide-react";
import { Badge, Card, DL, LinkButton, PageHeader, Table, Td, Th, Tr } from "@/components/ui";
import { requirePage } from "@/lib/page-guard";
import { canDo } from "@/lib/permissions";
import { pathAllowed } from "@/lib/nav";
import { canSeePrixod } from "@/lib/stock-journal-access";
import { ConfirmButton } from "../../payments/confirm-button";
import { fixReceipt, stornoReceipt } from "../actions";
import { ReceiptInfoEdit } from "./info-edit";

export default async function ReceiptPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tahrir?: string }> }) {
  const s = await requirePage("/receipts");
  const { id } = await params;
  const sp = await searchParams;
  const r = await db.goodsReceipt.findUnique({
    where: { id },
    include: { supplier: true, warehouse: true, createdBy: true, items: { include: { material: true } }, supply: { select: { id: true } }, recipient: { select: { name: true } }, buyer: { select: { fullName: true } }, autoIssueTo: { select: { name: true } }, autoIssueBrigade: { select: { name: true } }, autoIssueEmployee: { select: { fullName: true } } },
  });
  if (!r) notFound();
  const autoTo = r.autoIssueTo?.name ?? (r.autoIssueBrigade ? `${r.autoIssueBrigade.name} (brigada)` : null) ?? (r.autoIssueEmployee ? `${r.autoIssueEmployee.fullName} (xodim)` : null);
  const { base, vat, total, delivery } = receiptAmounts(r.items);
  // Storno faqat direktor (yoki direktor bergan amal); to'lov bog'langan bo'lsa server rad etadi va sababini aytadi
  const [paid, cancelledBy, pays] = await Promise.all([
    db.cashTransaction.aggregate({ where: { type: "EXPENSE", refType: "GoodsReceipt", refId: id, cancelledAt: null }, _sum: { amount: true } }),
    r.cancelledById ? db.user.findUnique({ where: { id: r.cancelledById }, select: { fullName: true } }) : null,
    // To'lov turi (Деньги): kirimda belgilangani, bo'lmasa bog'langan to'lov hisobining turi
    resolveReceiptPayments([{ id: r.id, payment: r.payment }]),
  ]);
  const payment = pays.get(r.id) ?? null;
  const hasDelivery = delivery > 0;
  const paidSum = Number(paid._sum.amount ?? 0);
  const canStorno = !r.cancelledAt && !r.supply && canDo(s, "stock", "receipt_storno");
  // «Tuzatish» = storno + shu qatorlar bilan yangi kirim formasi: yangi kirim yozish huquqi ham kerak
  const canFix = canStorno && canDo(s, "stock", "receipt");
  // Rekvizitlar (TTN, manzil, izoh…) — qoldiq va pulga ta'sir qilmaydi, kirim yozadigan xodim tuzatadi
  const canEditInfo = !r.cancelledAt && canDo(s, "stock", "receipt");
  const [buyers, recipients] = canEditInfo
    ? await Promise.all([
      db.user.findMany({ where: { OR: [{ isActive: true, role: "PROCUREMENT" }, ...(r.buyerId ? [{ id: r.buyerId }] : [])] }, orderBy: { fullName: "asc" }, select: { id: true, fullName: true } }),
      db.stockRecipient.findMany({ where: { OR: [{ isActive: true }, ...(r.recipientId ? [{ id: r.recipientId }] : [])] }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    ])
    : [[], []];
  // Kelgan xomashyoni shu kirim qatorlari bilan brigadalarga taqsimlash (Sklad → Brigadalarga berish)
  const canDistribute = !r.cancelledAt && canDo(s, "stock", "brigade") && pathAllowed("/stock", s.role, s.perms);
  const info = <DL items={[
    { k: "Nakladnoy (TTN)", v: r.waybillNo ?? waybillFromNote(r.note) ?? "—" },
    { k: "To'lov turi", v: payment ? <Badge color={payment === "BANK" ? "blue" : "amber"} dot={false}>{payment === "BANK" ? "O'tkazma (bank)" : "Naqd (kassa)"}</Badge> : "—" },
    { k: "Kimga", v: r.recipient?.name ?? r.warehouse.name },
    { k: "Manzil", v: r.address ?? "—" },
    { k: "Snabjenets", v: r.buyer?.fullName ?? r.createdBy?.fullName ?? "—" },
    { k: "Nima uchun", v: r.purpose ?? "—" },
    ...(hasDelivery ? [{ k: "Dostavka", v: money(delivery) }] : []),
    ...(r.carrier ? [{ k: "Mashina (kim olib keldi)", v: r.carrier }] : []),
    ...(r.loadedFrom ? [{ k: "Qayerdan yuklandi", v: r.loadedFrom }] : []),
    ...(autoTo ? [{ k: "Kimga (darhol chiqim)", v: <>{autoTo} <span className="text-xs text-slate-500">— mol skladda qolmagan, Chiqim jurnalida «avto» qatori</span></> }] : []),
  ]} />;
  return (
    <div>
      <PageHeader back={{ href: "/receipts", label: "Kirim" }} title={`Kirim ${r.docNo}`} subtitle={`${opAt(r.date, r.createdAt)} · ${r.supplier.name} → ${r.warehouse.name}${r.createdBy ? ` · kiritdi: ${r.createdBy.fullName}` : ""}`}
        action={<>
          {/* Bekor qilingan kirim (masalan «Tuzatish» formasi saqlanmay qolgan) — shu qatorlar bilan yangi kirim formasi */}
          {r.cancelledAt && canDo(s, "stock", "receipt") && canSeePrixod(s) && <LinkButton href={`/stock/prixod/new?copy=${r.id}`} variant="secondary"><Copy size={16} /> Shu qatorlar bilan yangi kirim</LinkButton>}
          {canDistribute && <LinkButton href={`/stock?tab=brigades&receipt=${r.id}`} variant="secondary"><HardHat size={16} /> Brigadalarga taqsimlash</LinkButton>}
          {canFix && <ConfirmButton action={fixReceipt.bind(null, r.id)} goTo={`/stock/prixod/new?copy=${r.id}`} icon={<Wrench size={15} />} label="Tuzatish"
            question={`${paidSum > 0.005 ? `Kirimga ${money(paidSum)} to'lov bog'langan — avval to'lovni bekor qiling. ` : ""}${r.docNo} bekor qilinadi (xomashyo skladdan qaytariladi) va forma shu qatorlar bilan ochiladi. Yangi kirim faqat «Kirimni saqlash» bosilganda yoziladi — saqlamasangiz kirim umuman qolmaydi. Davom etasizmi?`}
            reason="required" okText="Bekor qilindi" className="h-9 px-3 text-sm" />}
          {canStorno && <ConfirmButton action={stornoReceipt.bind(null, r.id)} label="Bekor qilish" question={paidSum > 0.005 ? `Kirimga ${money(paidSum)} to'lov bog'langan — avval to'lovni bekor qiling. Baribir urinib ko'rasizmi?` : `${r.docNo} bekor qilinsinmi? Xomashyo skladdan qaytariladi`} reason="required" okText="Bekor qilindi" className="h-9 px-3 text-sm" />}
        </>} />
      {r.cancelledAt && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <Badge color="red">Bekor qilingan</Badge> {dateTime(r.cancelledAt)}{cancelledBy ? ` · ${cancelledBy.fullName}` : ""} — {r.cancelReason}. Sklad harakatlari teskari yozilgan; kirim qoldiq, tannarx va qarzga kirmaydi.
        </div>
      )}
      {/* QQS'siz summa + QQS = to'lanadigan jami (yetkazuvchi qarzi shu jami bo'yicha) */}
      <div className="mb-6 flex flex-wrap gap-3">
        <Card className="inline-block"><div className="text-sm text-slate-500">QQS&apos;siz</div><div className="mt-1 text-lg font-semibold tabular">{money(base)}</div>{hasDelivery && <div className="text-xs text-slate-500">shundan dostavka {money(delivery)}</div>}</Card>
        <Card className="inline-block"><div className="text-sm text-slate-500">QQS</div><div className="mt-1 text-lg font-semibold tabular">{money(vat)}</div></Card>
        <Card className="inline-block"><div className="text-sm text-slate-500">Jami (QQS bilan)</div><div className={r.cancelledAt ? "mt-1 text-xl font-semibold text-slate-400 line-through" : "mt-1 text-xl font-semibold"}>{money(total)}</div>{paidSum > 0.005 && <div className="text-xs text-slate-500">to&apos;langan {money(paidSum)}</div>}</Card>
      </div>
      {/* «Приход» jurnali rekvizitlari (Sklad → Приход) — eski kirimlarda ko'pi bo'sh */}
      <div id="rekvizit" className="mb-6 max-w-2xl scroll-mt-20">
        <Card>
          {canEditInfo ? (
            <ReceiptInfoEdit id={r.id} defaultOpen={sp.tahrir === "1"}
              values={{
                waybillNo: r.waybillNo ?? waybillFromNote(r.note) ?? "", address: r.address ?? "", purpose: r.purpose ?? "", carrier: r.carrier ?? "",
                loadedFrom: r.loadedFrom ?? "", note: r.note ?? "", buyerId: r.buyerId ?? "", recipientId: r.recipientId ?? "",
              }}
              buyers={buyers.map((b) => ({ id: b.id, name: b.fullName }))} recipients={recipients}>
              {info}
            </ReceiptInfoEdit>
          ) : info}
        </Card>
      </div>
      <Table>
        <thead><tr><Th>Xomashyo</Th><Th right>Miqdor</Th><Th right>Narx (QQS&apos;siz)</Th><Th right>Summa (QQS&apos;siz)</Th>{hasDelivery && <Th right>Dostavka</Th>}<Th right>QQS</Th><Th right>Jami</Th></tr></thead>
        <tbody>{r.items.map((i) => <Tr key={i.id}><Td>{i.material.name}</Td><Td right>{qty(i.qty)} {i.material.unit}</Td><Td right>{money(i.price)}</Td><Td right>{money(lineGoods(i))}</Td>{hasDelivery && <Td right className="text-slate-600">{lineDelivery(i) ? money(lineDelivery(i)) : "—"}</Td>}<Td right className="text-slate-600">{i.vatRate ? `${money(i.vatAmount)} · ${i.vatRate}%` : "QQS'siz"}</Td><Td right className="font-medium">{money(lineTotal(i))}</Td></Tr>)}</tbody>
      </Table>
      {r.note && <p className="mt-4 text-sm text-slate-600">Izoh: {r.note}</p>}
    </div>
  );
}
