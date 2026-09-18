import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckCircle2, Unlock, XCircle, FileText, Factory, Truck, Wallet, Package } from "lucide-react";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { customerDebt } from "@/lib/finance";
import { money, date, qty } from "@/lib/format";
import { Button, Callout, Card, CardHeader, DL, Empty, LinkButton, PageHeader, Progress, StatCard, StatusSteps, Td, Th, Tr } from "@/components/ui";
import { OrderStatusBadge } from "../status";
import { TripStatusBadge } from "../../trips/status";
import { InvoiceStatusBadge } from "../../invoices/status";
import { confirmOrder, unblockOrder, cancelOrder } from "../actions";

const STEPS = [
  { key: "DRAFT", label: "Qoralama" }, { key: "CONFIRMED", label: "Tasdiqlangan" }, { key: "IN_PRODUCTION", label: "Ishlab chiqarish" },
  { key: "DELIVERED", label: "Yetkazildi" }, { key: "CLOSED", label: "Yopildi" },
];

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await getSession();
  const o = await db.order.findUnique({
    where: { id },
    include: {
      customer: true, createdBy: true,
      items: { include: { product: true } },
      batches: { orderBy: { date: "desc" } },
      trips: { include: { vehicle: true, driver: true }, orderBy: { createdAt: "desc" } },
      invoices: { where: { status: { not: "CANCELLED" } }, include: { payments: true } },
    },
  });
  if (!o || !s) notFound();
  const total = o.items.reduce((sum, i) => sum + Number(i.qtyM3) * Number(i.price), 0);
  const totalM3 = o.items.reduce((sum, i) => sum + Number(i.qtyM3), 0);
  const producedM3 = o.batches.reduce((sum, b) => sum + Number(b.qtyM3), 0);
  const shippedM3 = o.trips.filter((t) => t.status !== "CANCELLED").reduce((sum, t) => sum + Number(t.qtyM3), 0);
  const paid = o.invoices.reduce((sum, i) => sum + i.payments.reduce((p, x) => p + Number(x.amount), 0), 0);
  const debt = await customerDebt(o.customerId);

  const isSales = ["SALES", "DIRECTOR"].includes(s.role);
  const isDirector = s.role === "DIRECTOR";
  const canInvoice = ["ACCOUNTING", "SALES", "DIRECTOR"].includes(s.role) && ["CONFIRMED", "IN_PRODUCTION", "DELIVERED"].includes(o.status) && o.invoices.length === 0;
  const canCancel = ["DRAFT", "BLOCKED", "CONFIRMED"].includes(o.status) && isSales && o.batches.length === 0 && o.trips.length === 0;
  const stepKey = o.status === "BLOCKED" ? "CONFIRMED" : o.status === "CANCELLED" ? "DRAFT" : o.status;

  return (
    <div>
      <PageHeader
        back={{ href: "/orders", label: "Zayavkalar" }}
        title={`Zayavka ${o.orderNo}`}
        subtitle={`${date(o.date)} · ${o.createdBy.fullName} · ${o.customer.name}`}
        action={
          <>
            {o.status === "DRAFT" && isSales && <form action={confirmOrder.bind(null, id)}><Button variant="success"><CheckCircle2 size={16} /> Tasdiqlash</Button></form>}
            {o.status === "BLOCKED" && isDirector && <form action={unblockOrder.bind(null, id)}><Button variant="success"><Unlock size={16} /> Blokdan chiqarish</Button></form>}
            {canInvoice && <LinkButton href={`/invoices/new?orderId=${id}`} variant="secondary"><FileText size={16} /> Schyot yozish</LinkButton>}
            {canCancel && <form action={cancelOrder.bind(null, id)}><Button variant="ghost" className="text-red-600 hover:bg-red-50"><XCircle size={16} /> Bekor qilish</Button></form>}
          </>
        }
      />

      {o.status === "BLOCKED" && (
        <Callout tone="danger" title="Kredit limiti oshdi">
          Limit {money(o.customer.creditLimit)}, joriy qarz {money(debt)}, zayavka {money(total)}. Faqat direktor blokdan chiqara oladi.
        </Callout>
      )}
      {o.status === "CANCELLED" && <Callout tone="warning">Bu zayavka bekor qilingan.</Callout>}

      <Card className="mb-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <StatusSteps steps={STEPS} current={stepKey} failed={o.status === "BLOCKED"} />
          <OrderStatusBadge status={o.status} />
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatCard label="Summa" value={money(total)} icon={Wallet} hint={paid > 0 ? `to'landi ${money(paid)}` : undefined} />
        <StatCard label="Hajm" value={`${qty(totalM3)} m³`} icon={Package} hint={o.items.map((i) => i.product.code).join(", ")} />
        <StatCard label="Ishlab chiqarildi" value={`${qty(producedM3)} m³`} icon={Factory} tone={producedM3 >= totalM3 && totalM3 > 0 ? "success" : "default"} hint={<Progress value={producedM3} max={totalM3} />} />
        <StatCard label="Jo'natildi" value={`${qty(shippedM3)} m³`} icon={Truck} tone={shippedM3 >= totalM3 && totalM3 > 0 ? "success" : "default"} hint={<Progress value={shippedM3} max={totalM3} tone="success" />} />
      </div>

      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-5">
        <Card className="lg:col-span-2">
          <CardHeader title="Mijoz va yetkazish" />
          <DL items={[
            { k: "Mijoz", v: <Link href={`/customers/${o.customerId}`} className="hover:underline">{o.customer.name}</Link> },
            { k: "Telefon", v: o.customer.phone },
            { k: "Yetkazish sanasi", v: date(o.deliveryDate) },
            { k: "Manzil", v: o.deliveryAddress },
            { k: "Nasos", v: o.needsPump ? "Kerak" : "Yo'q" },
            ...(o.note ? [{ k: "Izoh", v: o.note }] : []),
            ...o.invoices.map((inv) => ({ k: `Schyot ${inv.invoiceNo}`, v: <span className="inline-flex flex-wrap items-center justify-end gap-2"><span className="whitespace-nowrap">{money(inv.amount)}</span><InvoiceStatusBadge status={inv.status} /></span> })),
          ]} />
        </Card>
        <Card padded={false} className="lg:col-span-3">
          <div className="px-5 pt-5"><CardHeader title="Mahsulotlar" /></div>
          <table className="w-full text-sm">
            <thead><tr><Th>Marka</Th><Th right>m³</Th><Th right>Narx</Th><Th right>Summa</Th></tr></thead>
            <tbody>
              {o.items.map((i) => <Tr key={i.id}><Td>{i.product.name}</Td><Td right>{qty(i.qtyM3)}</Td><Td right>{money(i.price)}</Td><Td right className="font-semibold">{money(Number(i.qtyM3) * Number(i.price))}</Td></Tr>)}
              <tr className="bg-slate-50/70"><Td className="font-semibold">Jami</Td><Td right className="font-semibold">{qty(totalM3)}</Td><Td /><Td right className="font-semibold">{money(total)}</Td></tr>
            </tbody>
          </table>
        </Card>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card padded={false}>
          <div className="px-5 pt-5"><CardHeader title="Zameslar" icon={Factory} /></div>
          <table className="w-full text-sm">
            <thead><tr><Th>№</Th><Th>Sana</Th><Th>Smena</Th><Th right>m³</Th></tr></thead>
            <tbody>
              {o.batches.length === 0 && <Empty text="Hali zames yo'q" icon={Factory} />}
              {o.batches.map((b) => <Tr key={b.id}><Td><Link href={`/production/${b.id}`} className="hover:underline">{b.batchNo}</Link></Td><Td>{date(b.date)}</Td><Td>{b.shift}</Td><Td right>{qty(b.qtyM3)}</Td></Tr>)}
            </tbody>
          </table>
        </Card>
        <Card padded={false}>
          <div className="px-5 pt-5"><CardHeader title="Reyslar" icon={Truck} /></div>
          <table className="w-full text-sm">
            <thead><tr><Th>Nakladnoy</Th><Th>Mikser</Th><Th>Haydovchi</Th><Th right>m³</Th><Th>Holat</Th></tr></thead>
            <tbody>
              {o.trips.length === 0 && <Empty text="Hali reys yo'q" icon={Truck} />}
              {o.trips.map((t) => <Tr key={t.id}><Td><Link href={`/trips/${t.id}`} className="hover:underline">{t.deliveryNoteNo}</Link></Td><Td className="tabular">{t.vehicle.plate}</Td><Td>{t.driver.fullName}</Td><Td right>{qty(t.qtyM3)}</Td><Td><TripStatusBadge status={t.status} /></Td></Tr>)}
            </tbody>
          </table>
        </Card>
      </div>
    </div>
  );
}
