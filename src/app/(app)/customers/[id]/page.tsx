import Link from "next/link";
import { canDo } from "@/lib/permissions";
import { notFound } from "next/navigation";
import { Wallet, ClipboardList, CreditCard, ArrowRight, Plus, Smartphone, FileText, Scale, Building2, FileBadge2 } from "lucide-react";
import { db } from "@/lib/db";
import { requireRoles } from "@/lib/page-guard";
import { customerCredit, contractedIds } from "@/lib/finance";
import { siteDebts } from "@/lib/customer-sites";
import { SitesPanel } from "./sites-panel";
import { money, date, isoDate, opAt } from "@/lib/format";
import { Callout, Card, CardHeader, Empty, LinkButton, PageHeader, StatCard, Td, Th, Tr } from "@/components/ui";
import { InvoiceStatusBadge } from "../../invoices/status";
import { InvoiceEditButton } from "../../invoices/invoice-edit";
import { cancelInvoice } from "../../invoices/actions";
import { ConfirmButton } from "../../payments/confirm-button";
import { CustomerForm } from "../customer-form";
import { deleteCustomer } from "../actions";
import { DeleteButton } from "@/components/delete-button";
import { BlacklistMark, ContractMark } from "@/components/customer-name";
import { OrderStatusBadge } from "../../orders/status";
import { customerAppStatus } from "@/lib/eco/customers";
import { AppAccount } from "../app-account";
import { receivablesReport } from "@/lib/receivables";
import { orderTotal } from "@/lib/order-total";
import { geoSearchEnabled } from "@/lib/geo";
import { MergePanel } from "./merge-panel";

export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await requireRoles(["SALES", "ACCOUNTING", "FINANCE"], { module: "customers" });
  const c = await db.customer.findUnique({ where: { id }, include: { orders: { orderBy: { date: "desc" }, take: 10, include: { items: true } } } });
  if (!c) notFound();
  const [{ limit, debt, advance, open, used, free, blacklisted }, contracted, appStatus, invoices, payments, sites, recv] = await Promise.all([
    customerCredit(id), contractedIds([id]), c.isInternal ? null : customerAppStatus(id),
    // Schyot va to'lov tarixi — mijoz kartasida (to'liq hisob — Akt sverki)
    db.invoice.findMany({ where: { customerId: id }, orderBy: { date: "desc" }, take: 15, include: { payments: { select: { amount: true } }, order: { select: { id: true, deliveryFee: true, items: { select: { qtyM3: true, price: true } } } } } }),
    db.payment.findMany({ where: { customerId: id }, orderBy: [{ date: "desc" }, { createdAt: "desc" }], take: 15, include: { invoice: { select: { invoiceNo: true } }, order: { select: { deliveryDate: true } }, cashAccount: { select: { name: true } }, createdBy: { select: { fullName: true } }, register: { select: { id: true } } } }),
    siteDebts(id),
    // Muddati o'tgan qism — yagona debitorka (to'lovlar FIFO bilan eng eski schyotlarga)
    receivablesReport({ ids: [id], includeInternal: true }),
  ]);
  const aged = recv.byCustomer.get(id);
  // Qora ro'yxat faqat «Qarzga»ni yopadi — naqd/perechisleniye zayavka ochilaveradi
  const canOrder = canDo(s, "orders", "create") && c.isActive;
  // Server amali (`saveSite`) bilan bir xil ruxsat — ruxsatlar daraxtida berilgan xodimga ham tugma chiqadi
  const canEditSites = canDo(s, "customers", "sites");
  // «Ma'lumotlar» formasi va o'chirish — `saveCustomer`/`deleteCustomer` bilan bir xil ruxsat; ruxsatsiz xodim faqat ko'radi
  const canEdit = canDo(s, "customers", "edit");
  // Schyot tahriri va bekor qilish — /invoices dagi bilan bir qoida (`sales.invoice_cancel`)
  const canInvoice = canDo(s, "sales", "invoice_cancel");

  return (
    <div>
      <PageHeader back={{ href: "/customers", label: "Mijozlar" }} title={<><span data-no-translit>{c.name}</span>{blacklisted && <BlacklistMark className="text-xs" />}{contracted.has(id) && <ContractMark className="text-xs" />}</>} subtitle={[c.inn && `INN ${c.inn}`, c.phone].filter(Boolean).join(" · ") || undefined}
        action={<>
          <LinkButton href={`/customers/${id}/akt`} variant="secondary"><Scale size={16} /> Akt sverki</LinkButton>
          {canDo(s, "offers", "create") && c.isActive && <LinkButton href={`/takliflar/new?customer=${id}`} variant="secondary"><FileBadge2 size={16} /> Tijorat taklifi</LinkButton>}
          {canOrder && <LinkButton href={`/orders/new?customer=${id}`}><Plus size={16} /> Zayavka</LinkButton>}
          {/* Ishlatilmagan karta o'chadi (ro'yxatga qaytadi); hujjatda uchrasa — nofaol qilinadi */}
          {canEdit && !c.isInternal && <DeleteButton action={deleteCustomer.bind(null, true)} id={id} name={c.name} title="Mijozni o'chirish (hujjatlarda ishlatilgan bo'lsa — nofaol qilinadi)" className="h-10 w-10" />}
        </>} />
      {blacklisted && (
        <div className="mb-4"><Callout tone="danger" title="Mijoz qora ro'yxatda">Limit {money(limit)} to'liq ishlatilgan: qarz {money(debt)} + ochiq zayavkalar {money(open)}. Qarzga zayavka ochilmaydi — naqd yoki perechisleniye bilan ochiladi. Qarz to'langach mijoz avtomatik ro'yxatdan chiqadi; direktor, Finance yoki Buxgalteriya limitni oshirishi mumkin.</Callout></div>
      )}
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatCard label="Kredit limit" value={money(limit)} icon={CreditCard} hint={limit > 0 ? undefined : "0 — faqat naqd / avans"} href="#malumotlar" />
        {advance > 0.005
          ? <StatCard label="Avans (oldindan to'langan)" value={money(advance)} icon={Wallet} tone="success" hint="schyotlardan ortiq to'lov" href={`/customers/${id}/akt`} />
          : <StatCard label="Qarz (debitorka)" value={money(debt)} icon={Wallet} tone={debt > 0 ? "danger" : "success"} hint={aged && aged.overdue > 0 ? `muddati o'tgan ${money(aged.overdue)} · ${aged.oldestDays} kun` : debt > 0 ? "schyotlar − barcha to'lovlar" : undefined} href={`/customers/${id}/akt`} />}
        <StatCard label="Ochiq zayavkalar" value={money(open)} icon={ClipboardList} hint="schyotsiz: qarzga + jo'natilgan naqd" href={`/orders?customer=${id}`} />
        <StatCard label="Bo'sh limit" value={money(free)} icon={CreditCard} tone={free <= 0 ? "danger" : "info"} hint={`ishlatilgan ${money(used)}`} href="#malumotlar" />
      </div>

      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
        <div id="malumotlar" className="scroll-mt-20"><Card>
          <CardHeader title="Ma'lumotlar" />
          {/* key: karta serverda o'zgarsa (masalan o'chirish o'rniga nofaol qilindi) forma yangi qiymatlar bilan qayta chiziladi */}
          <CustomerForm key={c.updatedAt.getTime()} customer={{ ...c, creditLimit: c.creditLimit.toString() }} canEditLimit={["FINANCE", "ACCOUNTING", "DIRECTOR"].includes(s.role)} readOnly={!canEdit} />
        </Card></div>
        <div className="space-y-5">
        {appStatus && (
          <Card>
            <CardHeader title="Ilova hisobi" icon={Smartphone} info="Mijoz Insof ECO ilovasida zayavkalarini va reyslarini kuzatishi uchun" />
            <AppAccount customerId={id} phone={c.phone} initial={appStatus} canLink={["SALES", "DIRECTOR"].includes(s.role)} />
          </Card>
        )}
        <Card padded={false}>
          <div className="px-5 pt-5"><CardHeader title="So'nggi zayavkalar" action={<span className="inline-flex items-center gap-3 text-sm"><Link href={`/orders?customer=${id}`} className="inline-flex items-center gap-1 text-slate-500 hover:text-slate-900">Kutayotgan</Link><Link href={`/sales?customer=${id}`} className="inline-flex items-center gap-1 text-slate-500 hover:text-slate-900">Sotuvlar <ArrowRight size={14} /></Link></span>} /></div>
          <div className="overflow-x-auto">
          <table className="w-full min-w-[420px] text-sm">
            <thead><tr><Th>Sana</Th><Th right>Summa</Th><Th>Holat</Th></tr></thead>
            <tbody>
              {c.orders.length === 0 && <Empty text="Zayavkalar yo'q" icon={ClipboardList} />}
              {c.orders.map((o) => (
                <Tr key={o.id}>
                  <Td><Link href={`/orders/${o.id}`} className="hover:underline">{date(o.deliveryDate)}</Link></Td>
                  <Td right>{money(orderTotal(o))}</Td>
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
          <CardHeader title="Obyektlar" icon={Building2} info="Mijozning obyektlari va har obyekt bo'yicha qarz (yozilgan schyot − to'langan + schyotsiz ochiq zayavka)" />
          <div className="mt-4">
            <SitesPanel customerId={id} sites={sites} canEdit={canEditSites} canOrder={canOrder} geoSearch={geoSearchEnabled()} />
          </div>
        </Card>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card padded={false}>
          <div className="px-5 pt-5"><CardHeader title="Schyotlar" icon={FileText} action={<Link href={`/customers/${id}/akt`} className="text-sm text-slate-500 hover:text-slate-900">Akt sverki</Link>} /></div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] text-sm">
              <thead><tr><Th>№</Th><Th>Sana</Th><Th right>Summa</Th><Th right>Qoldiq</Th><Th>Holat</Th>{canInvoice && <Th />}</tr></thead>
              <tbody>
                {invoices.length === 0 && <Empty text="Schyot yo'q" icon={FileText} />}
                {invoices.map((i) => {
                  const paid = i.payments.reduce((x, p) => x + Number(p.amount), 0);
                  const left = Number(i.amount) - paid;
                  return (
                    <Tr key={i.id}>
                      <Td>{i.order ? <Link href={`/orders/${i.order.id}`} className="hover:underline">{i.invoiceNo}</Link> : i.invoiceNo}</Td>
                      <Td className="whitespace-nowrap">{opAt(i.date, i.createdAt)}</Td>
                      <Td right className="whitespace-nowrap">{money(i.amount)}</Td>
                      <Td right className={`whitespace-nowrap ${left > 0.005 && i.status !== "CANCELLED" ? "text-red-600" : "text-slate-400"}`}>{i.status === "CANCELLED" ? "—" : money(left)}</Td>
                      <Td><InvoiceStatusBadge status={i.status} /></Td>
                      {canInvoice && (
                        <Td>
                          <div className="flex items-center gap-1">
                            {!i.isOpening && (i.status === "OPEN" || i.status === "PARTIAL") && <InvoiceEditButton inv={{ id: i.id, invoiceNo: i.invoiceNo, amount: Number(i.amount), date: isoDate(i.date), paid, max: i.order ? orderTotal(i.order) : null }} />}
                            {i.status === "OPEN" && paid === 0 && !i.isOpening && <ConfirmButton action={cancelInvoice.bind(null, i.id)} label="Bekor" question={`${i.invoiceNo} bekor qilinsinmi?`} reason="optional" okText="Bekor qilindi" className="h-7 px-2 text-xs" />}
                          </div>
                        </Td>
                      )}
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
                    <Td className="whitespace-nowrap">{opAt(p.date, p.createdAt)}</Td>
                    <Td className="text-slate-600">{p.invoice ? `schyot ${p.invoice.invoiceNo}` : p.register ? "realizatsiya" : p.order ? `avans · zayavka ${date(p.order.deliveryDate)}` : "taqsimlanmagan"}</Td>
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
      {/* Takror kartani asosiy kartaga birlashtirish — faqat direktor (server ham `requireSession(["DIRECTOR"])`) */}
      {s.role === "DIRECTOR" && !c.isInternal && <MergePanel sourceId={id} sourceName={c.name} />}
    </div>
  );
}
