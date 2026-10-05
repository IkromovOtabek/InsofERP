import Link from "next/link";
import { notFound } from "next/navigation";
import { Banknote, PackageCheck, Scale, TrendingDown, TrendingUp, Undo2, Wallet } from "lucide-react";
import { db } from "@/lib/db";
import { requirePage } from "@/lib/page-guard";
import { supplierLedger, supplierPrices } from "@/lib/receipt-payables";
import { receiptTotal } from "@/lib/receipt-vat";
import { money, qty, date } from "@/lib/format";
import { unitLabel } from "@/lib/unit";
import { SUPPLY_COLOR, SUPPLY_LABEL } from "@/lib/supply";
import { Badge, Card, CardHeader, PageHeader, StatCard, Table, Td, Th, Tr } from "@/components/ui";
import { cn } from "@/lib/utils";
import { SupplierEditForm } from "../supplier-form";
import { supplierOpeningDues } from "@/lib/opening-balances";
import { canDo } from "@/lib/permissions";
import { SupplierPayForm } from "../../settings/boshlangich-qoldiq/forms";

/**
 * Yetkazuvchi kartasi: rekvizitlar (tahrirlash), hisob-kitob (qancha mol oldik, qancha to'ladik, qarz,
 * avans, qaytarilishi kerak bo'lgan pul), har xomashyoning oxirgi narxi va oxirgi kirimlar/ta'minotlar.
 */
export default async function SupplierCard({ params }: { params: Promise<{ id: string }> }) {
  const s = await requirePage("/suppliers");
  const { id } = await params;
  const sup = await db.supplier.findUnique({ where: { id } });
  if (!sup) notFound();
  const [ledger, prices, receipts, supply] = await Promise.all([
    supplierLedger(id),
    supplierPrices(id),
    db.goodsReceipt.findMany({
      where: { supplierId: id }, orderBy: { date: "desc" }, take: 20,
      include: { items: { select: { qty: true, price: true, vatAmount: true } }, warehouse: { select: { name: true } } },
    }),
    db.supplyRequest.findMany({ where: { supplierId: id }, orderBy: { date: "desc" }, take: 10, include: { items: { select: { qty: true, price: true } } } }),
  ]);
  const canEdit = ["WAREHOUSE", "PROCUREMENT", "ACCOUNTING", "DIRECTOR"].includes(s.role);
  // Boshlang'ich qarzni shu kartadan ham to'lash ("Boshlang'ich qoldiqlar" bo'limidagi bilan bir action) — moliya huquqi bilan
  const canPay = canDo(s, "cashflow", "pay");
  const [dues, accounts] = canPay && ledger.opening > 0.005
    ? await Promise.all([
      supplierOpeningDues(id),
      db.cashAccount.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    ])
    : [[], []];

  return (
    <div>
      <PageHeader back={{ href: "/suppliers", label: "Yetkazuvchilar" }}
        title={<>{sup.name} {sup.isActive ? <Badge color="green">Faol</Badge> : <Badge>Nofaol</Badge>}</>}
        subtitle={[sup.inn ? `INN ${sup.inn}` : null, sup.vatPayer ? "QQS to'lovchisi" : "QQS to'lovchisi emas", sup.phone, `qo'shilgan ${date(sup.createdAt)}`].filter(Boolean).join(" · ")} />

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-5">
        <StatCard label="Jami olingan mol (QQS bilan)" value={money(ledger.received)} icon={PackageCheck} tone="brand" />
        <StatCard label="Jami to'langan" value={money(ledger.paid)} icon={Wallet} tone="info" />
        <StatCard label="Qarzimiz (to'lanmagan kirim)" value={money(ledger.debt)} hint={`${ledger.unpaid.length} ta kirim${ledger.opening > 0.005 ? ` + boshlang'ich qoldiq ${money(ledger.opening)}` : ""}`} icon={Banknote} tone={ledger.debt > 0 ? "danger" : "success"} />
        <StatCard label="Avans (mol kutilmoqda)" value={money(ledger.advance)} icon={Scale} tone={ledger.advance > 0 ? "warning" : "default"} />
        <StatCard label="Qaytarilishi kerak" value={money(ledger.refundDue)} hint="bekor qilingan ta'minot" icon={Undo2} tone={ledger.refundDue > 0 ? "danger" : "default"} />
      </div>

      {canEdit && (
        <Card className="mt-5">
          <CardHeader title="Rekvizitlar" description="Nomi, INN, telefon, manzil va mas'ul shaxs — o'zgarish auditda qoladi" />
          <SupplierEditForm id={sup.id} value={{ name: sup.name, inn: sup.inn ?? "", phone: sup.phone ?? "", address: sup.address ?? "", contactPerson: sup.contactPerson ?? "", vatPayer: sup.vatPayer }} />
        </Card>
      )}

      {dues.some((d) => d.left > 0.005) && (
        <Card className="mt-5">
          <CardHeader title="Boshlang'ich qarz (tizimga o'tish sanasidagi)" description="To'lov Kirim-Chiqimga chiqim bo'lib yoziladi; qisman to'lash mumkin" />
          <div className="space-y-2">
            {dues.filter((d) => d.left > 0.005).map((d) => (
              <div key={d.id} className="flex flex-wrap items-center gap-3 text-sm">
                <span>{date(d.date)} holatiga: <b className="text-red-600">{money(d.left)}</b>{d.paid > 0.005 && <span className="text-slate-500"> (jami {money(d.amount)}, to&apos;langan {money(d.paid)})</span>}</span>
                <SupplierPayForm id={d.id} left={d.left} accounts={accounts.map((a) => ({ id: a.id, label: a.name }))} />
              </div>
            ))}
          </div>
        </Card>
      )}

      {ledger.unpaid.length > 0 && (
        <div className="mt-6">
          <h2 className="mb-2 font-semibold">To&apos;lanmagan kirimlar</h2>
          <Table>
            <thead><tr><Th>Kirim</Th><Th>Sana</Th><Th right>Qator</Th><Th right>Summa</Th></tr></thead>
            <tbody>
              {ledger.unpaid.map((r) => (
                <Tr key={r.id}>
                  <Td><Link href={`/receipts/${r.id}`} className="font-medium hover:underline">{r.docNo}</Link></Td>
                  <Td>{date(r.date)}</Td><Td right>{r.lines}</Td><Td right className="font-semibold text-red-600">{money(r.left)}{r.paid > 0.005 && <span className="block text-xs font-normal text-slate-500">jami {money(r.total)}, to&apos;langan {money(r.paid)}</span>}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}

      <div className="mt-6">
        <h2 className="mb-2 font-semibold">Narxlar tarixi (har xomashyoning oxirgi narxi)</h2>
        <Table>
          <thead><tr><Th>Xomashyo</Th><Th right>Oxirgi narx</Th><Th right>Oldingi narx</Th><Th right>Farq</Th><Th>Oxirgi kirim</Th><Th right>Kirimlar</Th></tr></thead>
          <tbody>
            {prices.length === 0 && <tr><td colSpan={6} className="px-4 py-6 text-center text-sm text-slate-500">Bu yetkazuvchidan hali kirim yo&apos;q</td></tr>}
            {prices.map((p) => {
              const d = p.prev ? ((p.price - p.prev) / p.prev) * 100 : null;
              return (
                <Tr key={p.materialId}>
                  <Td className="font-medium">{p.name}</Td>
                  <Td right className="font-semibold">{money(p.price)} <span className="text-xs font-normal text-slate-400">/ {unitLabel(p.unit)}</span></Td>
                  <Td right className="text-slate-500">{p.prev != null ? money(p.prev) : "—"}</Td>
                  <Td right className={cn("text-xs font-medium", d == null ? "text-slate-400" : d > 0 ? "text-red-600" : "text-emerald-700")}>
                    {d == null ? "—" : <span className="inline-flex items-center gap-0.5">{d > 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}{d > 0 ? "+" : ""}{d.toFixed(1)}%</span>}
                  </Td>
                  <Td className="whitespace-nowrap text-slate-600">{date(p.date)} · {qty(p.qty)} {unitLabel(p.unit)}</Td>
                  <Td right className="text-slate-500">{p.receipts}</Td>
                </Tr>
              );
            })}
          </tbody>
        </Table>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-2">
        <div>
          <h2 className="mb-2 font-semibold">Oxirgi kirimlar</h2>
          <Table>
            <thead><tr><Th>Kirim</Th><Th>Sana</Th><Th>Sklad</Th><Th right>Summa (QQS bilan)</Th></tr></thead>
            <tbody>
              {receipts.length === 0 && <tr><td colSpan={4} className="px-4 py-6 text-center text-sm text-slate-500">Kirim yo&apos;q</td></tr>}
              {receipts.map((r) => (
                <Tr key={r.id}>
                  <Td><Link href={`/receipts/${r.id}`} className="font-medium hover:underline">{r.docNo}</Link></Td>
                  <Td className="whitespace-nowrap">{date(r.date)}</Td>
                  <Td>{r.warehouse.name}</Td>
                  <Td right>{money(receiptTotal(r.items))}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </div>
        <div>
          <h2 className="mb-2 font-semibold">Ta&apos;minot zayavkalari</h2>
          <Table>
            <thead><tr><Th>Zayavka</Th><Th>Sana</Th><Th>Holat</Th><Th right>Reja</Th></tr></thead>
            <tbody>
              {supply.length === 0 && <tr><td colSpan={4} className="px-4 py-6 text-center text-sm text-slate-500">Zayavka yo&apos;q</td></tr>}
              {supply.map((r) => (
                <Tr key={r.id}>
                  <Td><Link href={`/taminot/${r.id}`} className="font-medium hover:underline">{r.docNo}</Link></Td>
                  <Td className="whitespace-nowrap">{date(r.date)}</Td>
                  <Td><Badge color={SUPPLY_COLOR[r.status]}>{SUPPLY_LABEL[r.status]}</Badge></Td>
                  <Td right>{money(r.items.reduce((x, i) => x + Number(i.qty) * Number(i.price), 0) + Number(r.deliveryCost))}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </div>
      </div>
    </div>
  );
}
