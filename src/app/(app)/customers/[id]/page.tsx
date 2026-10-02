import Link from "next/link";
import { notFound } from "next/navigation";
import { Wallet, ClipboardList, CreditCard, ArrowRight, Plus, Smartphone, FileText, Scale, Building2 } from "lucide-react";
import { db } from "@/lib/db";
import { requireRoles } from "@/lib/page-guard";
import { customerCredit, contractedIds } from "@/lib/finance";
import { siteDebts } from "@/lib/customer-sites";
import { SitesPanel } from "./sites-panel";
import { money, date } from "@/lib/format";
import { Callout, Card, CardHeader, Empty, LinkButton, PageHeader, StatCard, Td, Th, Tr } from "@/components/ui";
import { InvoiceStatusBadge } from "../../invoices/status";
import { CustomerForm } from "../customer-form";
import { BlacklistMark, ContractMark } from "@/components/customer-name";
import { OrderStatusBadge } from "../../orders/status";
import { customerAppStatus } from "@/lib/eco/customers";
import { AppAccount } from "../app-account";

export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await requireRoles(["SALES", "ACCOUNTING", "FINANCE"]);
  const c = await db.customer.findUnique({ where: { id }, include: { orders: { orderBy: { date: "desc" }, take: 10, include: { items: true } } } });
  if (!c) notFound();
  const [{ limit, debt, open, used, free, blacklisted }, contracted, appStatus, invoices, payments, sites] = await Promise.all([
    customerCredit(id), contractedIds([id]), c.isInternal ? null : customerAppStatus(id),
    // Schyot va to'lov tarixi — mijoz kartasida (to'liq hisob — Akt sverki)
    db.invoice.findMany({ where: { customerId: id }, orderBy: { date: "desc" }, take: 15, include: { payments: { select: { amount: true } }, order: { select: { id: true, orderNo: true } } } }),
    db.payment.findMany({ where: { customerId: id }, orderBy: [{ date: "desc" }, { createdAt: "desc" }], take: 15, include: { invoice: { select: { invoiceNo: true } }, order: { select: { orderNo: true } }, cashAccount: { select: { name: true } }, createdBy: { select: { fullName: true } }, register: { select: { id: true } } } }),
    siteDebts(id),
  ]);
  const canOrder = ["SALES", "DIRECTOR"].includes(s.role) && c.isActive && !blacklisted;
  const canEditSites = ["SALES", "ACCOUNTING", "FINANCE", "DIRECTOR"].includes(s.role);

  return (
    <div>
      <PageHeader back={{ href: "/customers", label: "Mijozlar" }} title={<>{c.name}{blacklisted && <BlacklistMark className="text-xs" />}{contracted.has(id) && <ContractMark className="text-xs" />}</>} subtitle={[c.inn && `INN ${c.inn}`, c.phone].filter(Boolean).join(" · ") || undefined}
        action={<>
          <LinkButton href={`/customers/${id}/akt`} variant="secondary"><Scale size={16} /> Akt sverki</LinkButton>
          {canOrder && <LinkButton href={`/orders/new?customer=${id}`}><Plus size={16} /> Zayavka</LinkButton>}
        </>} />
      {blacklisted && (
        <div className="mb-4"><Callout tone="danger" title="Mijoz qora ro'yxatda">Limit {money(limit)} to'liq ishlatilgan: qarz {money(debt)} + ochiq zayavkalar {money(open)}. Yangi zayavka ochilmaydi. Qarz to'langach mijoz avtomatik ro'yxatdan chiqadi; direktor, Finance yoki Buxgalteriya limitni oshirishi mumkin.</Callout></div>
      )}
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatCard label="Kredit limit" value={money(limit)} icon={CreditCard} hint="standart 100 mln" />
        <StatCard label="Qarz (debitorka)" value={money(debt)} icon={Wallet} tone={debt > 0 ? "danger" : "success"} />
        <StatCard label="Ochiq zayavkalar" value={money(open)} icon={ClipboardList} hint="schyot yozilmagan" />
        <StatCard label="Bo'sh limit" value={money(free)} icon={CreditCard} tone={free <= 0 ? "danger" : "info"} hint={`ishlatilgan ${money(used)}`} />
      </div>

      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Ma'lumotlar" />
          <CustomerForm customer={{ ...c, creditLimit: c.creditLimit.toString() }} canEditLimit={["FINANCE", "ACCOUNTING", "DIRECTOR"].includes(s.role)} />
        </Card>
        <div className="space-y-5">
        {appStatus && (
          <Card>
            <CardHeader title="Ilova hisobi" icon={Smartphone} description="Mijoz Insof ECO ilovasida zayavkalarini va reyslarini kuzatishi uchun" />
            <AppAccount customerId={id} phone={c.phone} initial={appStatus} canLink={["SALES", "DIRECTOR"].includes(s.role)} />
          </Card>
        )}
        <Card padded={false}>
          <div className="px-5 pt-5"><CardHeader title="So'nggi zayavkalar" action={<span className="inline-flex items-center gap-3 text-sm"><Link href={`/orders?customer=${id}`} className="inline-flex items-center gap-1 text-slate-500 hover:text-slate-900">Kutayotgan</Link><Link href={`/sales?customer=${id}`} className="inline-flex items-center gap-1 text-slate-500 hover:text-slate-900">Sotuvlar <ArrowRight size={14} /></Link></span>} /></div>
          <div className="overflow-x-auto">
          <table className="w-full min-w-[420px] text-sm">
            <thead><tr><Th>№</Th><Th>Sana</Th><Th right>Summa</Th><Th>Holat</Th></tr></thead>
            <tbody>
              {c.orders.length === 0 && <Empty text="Zayavkalar yo'q" icon={ClipboardList} />}
              {c.orders.map((o) => (
                <Tr key={o.id}>
                  <Td><Link href={`/orders/${o.id}`} className="hover:underline">{o.orderNo}</Link></Td>
                  <Td>{date(o.deliveryDate)}</Td>
                  <Td right>{money(o.items.reduce((s, i) => s + Number(i.qtyM3) * Number(i.price), 0))}</Td>
                  <Td><OrderStatusBadge status={o.status} /></Td>
                </Tr>
              ))}
            </tbody>
          </table>
          </div>
        </Card>
        </div>
      </div>

      <div className="mt-5">
        <Card>
          <CardHeader title="Obyektlar" icon={Building2} description="Mijozning obyektlari va har obyekt bo'yicha qarz (yozilgan schyot − to'langan + schyotsiz ochiq zayavka)" />
          <div className="mt-4">
            <SitesPanel customerId={id} sites={sites} canEdit={canEditSites} />
          </div>
        </Card>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card padded={false}>
          <div className="px-5 pt-5"><CardHeader title="Schyotlar" icon={FileText} action={<Link href={`/customers/${id}/akt`} className="text-sm text-slate-500 hover:text-slate-900">Akt sverki</Link>} /></div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] text-sm">
              <thead><tr><Th>№</Th><Th>Sana</Th><Th right>Summa</Th><Th right>Qoldiq</Th><Th>Holat</Th></tr></thead>
              <tbody>
                {invoices.length === 0 && <Empty text="Schyot yo'q" icon={FileText} />}
                {invoices.map((i) => {
                  const left = Number(i.amount) - i.payments.reduce((x, p) => x + Number(p.amount), 0);
                  return (
                    <Tr key={i.id}>
                      <Td>{i.order ? <Link href={`/orders/${i.order.id}`} className="hover:underline">{i.invoiceNo}</Link> : i.invoiceNo}</Td>
                      <Td className="whitespace-nowrap">{date(i.date)}</Td>
                      <Td right className="whitespace-nowrap">{money(i.amount)}</Td>
                      <Td right className={`whitespace-nowrap ${left > 0.005 && i.status !== "CANCELLED" ? "text-red-600" : "text-slate-400"}`}>{i.status === "CANCELLED" ? "—" : money(left)}</Td>
                      <Td><InvoiceStatusBadge status={i.status} /></Td>
                    </Tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
        <Card padded={false}>
          <div className="px-5 pt-5"><CardHeader title="To'lovlar" icon={Wallet} /></div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] text-sm">
              <thead><tr><Th>Sana</Th><Th>Nima uchun</Th><Th>Hisob</Th><Th right>Summa</Th><Th>Kim kiritdi</Th></tr></thead>
              <tbody>
                {payments.length === 0 && <Empty text="To'lov yo'q" icon={Wallet} />}
                {payments.map((p) => (
                  <Tr key={p.id}>
                    <Td className="whitespace-nowrap">{date(p.date)}</Td>
                    <Td className="text-slate-600">{p.invoice ? `schyot ${p.invoice.invoiceNo}` : p.register ? "realizatsiya" : p.order ? `avans ${p.order.orderNo}` : "taqsimlanmagan"}</Td>
                    <Td className="text-slate-500">{p.cashAccount.name}</Td>
                    <Td right className="whitespace-nowrap font-medium text-emerald-700">+{money(p.amount)}</Td>
                    <Td className="text-slate-500">{p.createdBy?.fullName ?? "—"}</Td>
                  </Tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
}
