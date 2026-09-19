import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckCircle2, Unlock, XCircle, FileText, Factory, Truck, Wallet, Package, CreditCard, FileSignature, HardHat, Zap, Download, ScrollText, Paperclip, Upload } from "lucide-react";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { customerCredit } from "@/lib/finance";
import { money, date, qty, deliveryAt } from "@/lib/format";
import { Badge, Button, Callout, Card, CardHeader, DL, Empty, LinkButton, PageHeader, Progress, StatCard, StatusSteps, Td, Th, Tr } from "@/components/ui";
import { TaskStatusBadge } from "../../tasks/status";
import { unitLabel } from "@/lib/unit";
import { OrderStatusBadge, SALES_STATUSES } from "../status";
import { TripStatusBadge } from "../../trips/status";
import { InvoiceStatusBadge } from "../../invoices/status";
import { confirmOrder, unblockOrder, cancelOrder, toggleGuarantee } from "../actions";
import { BlacklistMark, ContractMark, CustomerName } from "@/components/customer-name";
import { ContractForm } from "./contract-form";
import { contractedIds } from "@/lib/finance";
import { CONTRACT_ACCEPT } from "@/lib/uploads";

const STEPS = [
  { key: "DRAFT", label: "Qoralama" }, { key: "CONFIRMED", label: "Tasdiqlangan" }, { key: "IN_PRODUCTION", label: "Ishlab chiqarish" },
  { key: "DELIVERED", label: "Yetkazildi" }, { key: "CLOSED", label: "Yopildi" },
];

export default async function OrderPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ guarantee?: string; contract?: string }> }) {
  const { id } = await params;
  const { guarantee, contract: justContracted } = await searchParams;
  const s = await getSession();
  const o = await db.order.findUnique({
    where: { id },
    include: {
      customer: true, createdBy: true,
      items: { include: { product: true, brigade: true, task: true } },
      batches: { orderBy: { date: "desc" } },
      trips: { include: { vehicle: true, driver: true }, orderBy: { createdAt: "desc" } },
      invoices: { where: { status: { not: "CANCELLED" } }, include: { payments: true } },
      payments: { include: { cashAccount: true }, orderBy: { date: "asc" } },
    },
  });
  if (!o || !s) notFound();
  const total = o.items.reduce((sum, i) => sum + Number(i.qtyM3) * Number(i.price), 0);
  const totalM3 = o.items.reduce((sum, i) => sum + Number(i.qtyM3), 0);
  const producedM3 = o.batches.reduce((sum, b) => sum + Number(b.qtyM3), 0);
  const shippedM3 = o.trips.filter((t) => t.status !== "CANCELLED").reduce((sum, t) => sum + Number(t.qtyM3), 0);
  // To'langan: schyot to'lovlari + zayavkaga bog'langan avans (bir to'lov ikkala joyda bo'lishi mumkin — id bo'yicha bir marta)
  const paidMap = new Map<string, number>();
  for (const i of o.invoices) for (const x of i.payments) paidMap.set(x.id, Number(x.amount));
  for (const x of o.payments) paidMap.set(x.id, Number(x.amount));
  const paid = [...paidMap.values()].reduce((a, b) => a + b, 0);
  const prepaid = o.payments.reduce((sum, x) => sum + Number(x.amount), 0);
  const [credit, contractedSet] = await Promise.all([customerCredit(o.customerId), contractedIds([o.customerId])]);
  const contracted = contractedSet.has(o.customerId); // mijozning boshqa shartnomali zayavkasi ham bo'lishi mumkin
  const hasContract = !!o.contractNo && o.contractAmount != null;
  const contractAmount = hasContract ? Number(o.contractAmount) : 0;
  const contractLeft = contractAmount - total; // shartnoma summasidan mahsulot summasi ayirilgan qoldiq
  const canContract = ["SALES", "ACCOUNTING", "DIRECTOR"].includes(s.role) && o.status !== "CANCELLED";
  const hasFile = !!o.contractFile;
  const fileHref = `/orders/${id}/contract/file`;
  const accepted = SALES_STATUSES.includes(o.status);

  const isSales = ["SALES", "DIRECTOR"].includes(s.role);
  const isDirector = s.role === "DIRECTOR";
  const canInvoice = ["ACCOUNTING", "SALES", "DIRECTOR"].includes(s.role) && ["CONFIRMED", "IN_PRODUCTION", "DELIVERED"].includes(o.status) && o.invoices.length === 0;
  const canCancel = ["DRAFT", "BLOCKED", "CONFIRMED"].includes(o.status) && isSales && o.batches.length === 0 && o.trips.length === 0;
  const stepKey = o.status === "BLOCKED" ? "CONFIRMED" : o.status === "CANCELLED" ? "DRAFT" : o.status;
  const isProduction = ["PRODUCTION", "DIRECTOR"].includes(s.role);
  const needsAssign = ["DRAFT", "CONFIRMED", "IN_PRODUCTION"].includes(o.status) && o.items.some((i) => !i.task);

  return (
    <div>
      <PageHeader
        back={accepted ? { href: "/sales", label: "Sotuv" } : { href: "/orders", label: "Zayavkalar" }}
        title={`Zayavka ${o.orderNo}`}
        subtitle={<>{date(o.date)} · {o.createdBy.fullName} · <CustomerName name={o.customer.name} blacklisted={credit.blacklisted} contracted={contracted} /></>}
        action={
          <>
            {o.status === "DRAFT" && isSales && <form action={confirmOrder.bind(null, id)}><Button variant="success"><CheckCircle2 size={16} /> Qabul qilish</Button></form>}
            {o.status === "BLOCKED" && isDirector && <form action={unblockOrder.bind(null, id)}><Button variant="success"><Unlock size={16} /> Blokdan chiqarish</Button></form>}
            {needsAssign && isProduction && <LinkButton href={`/production?order=${id}`} variant="secondary"><HardHat size={16} /> Brigada tayinlash</LinkButton>}
            {o.onCredit && o.status !== "CANCELLED" && <LinkButton href={`/orders/${id}/guarantee`} variant={o.guaranteeAt ? "secondary" : "primary"}><FileSignature size={16} /> Kafolat xati</LinkButton>}
            {hasContract && hasFile && <a href={fileHref} target="_blank" rel="noopener" className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50"><ScrollText size={16} /> Shartnoma {o.contractNo}</a>}
            {canInvoice && <LinkButton href={`/invoices/new?orderId=${id}`} variant="secondary"><FileText size={16} /> Schyot yozish</LinkButton>}
            {canCancel && <form action={cancelOrder.bind(null, id)}><Button variant="ghost" className="text-red-600 hover:bg-red-50"><XCircle size={16} /> Bekor qilish</Button></form>}
          </>
        }
      />

      {o.status === "BLOCKED" && (
        <Callout tone="danger" title="Kredit limiti yetmadi">
          Limit {money(credit.limit)}, ishlatilgan {money(credit.used)} (qarz {money(credit.debt)} + ochiq zayavkalar {money(credit.open)}), bu zayavka {money(total)}. Faqat direktor blokdan chiqara oladi.
        </Callout>
      )}
      {credit.blacklisted && (
        <Callout tone="danger" title="Mijoz qora ro'yxatda">
          Limit {money(credit.limit)} to'liq ishlatilgan (qarz {money(credit.debt)}, ochiq zayavkalar {money(credit.open)}).{" "}
          {o.status === "DRAFT" ? "Qabul qilinsa zayavka bloklanadi — avval qarz to'lansin yoki direktor limitni oshirsin." : "Bu mijozga yangi zayavka ochilmaydi; jo'natish va schyot yozishda ehtiyot bo'ling — qarz to'langach belgi avtomatik olinadi."}{" "}
          <Link href={`/customers/${o.customerId}`} className="underline">Mijoz kartasi</Link>
        </Callout>
      )}
      {o.status === "CONFIRMED" && (
        <Callout tone="success" title="Zayavka qabul qilindi">
          Zayavka Sotuv bo'limiga o'tdi va ishlab chiqarishga tushdi. Sotuv ro'yxati: <Link href="/sales" className="underline">Sotuv</Link>.
        </Callout>
      )}
      {o.status === "CANCELLED" && <Callout tone="warning">Bu zayavka bekor qilingan.</Callout>}
      {hasContract && (
        <Callout tone={hasFile ? (justContracted ? "success" : "info") : "warning"} title={hasFile ? `Shartnoma ${o.contractNo} · ${date(o.contractAt ?? o.createdAt)}` : `Shartnoma ${o.contractNo} saqlandi — Didox'da imzolangan faylni tizimga yuklang`}>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <span>Shartnoma summasi <b>{money(contractAmount)}</b> − mahsulot <b>{money(total)}</b> = {contractLeft >= 0 ? <>qoldiq <b className="text-emerald-700">{money(contractLeft)}</b></> : <b className="text-red-600">mahsulot summasi shartnomadan {money(-contractLeft)} ga oshdi</b>}</span>
            {hasFile ? (
              <>
                <a href={fileHref} target="_blank" rel="noopener" className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"><Paperclip size={14} /> {o.contractFileName ?? "Shartnoma fayli"}</a>
                <a href={`${fileHref}?download=1`} className="inline-flex items-center gap-1 text-xs underline"><Download size={12} /> yuklab olish</a>
                {o.contractFileAt && <span className="text-xs opacity-70">yuklandi {date(o.contractFileAt)}</span>}
              </>
            ) : (
              <span className="text-xs">Fayl hali yuklanmagan — isbot uchun imzolangan shartnoma tizimda bo&apos;lishi kerak.</span>
            )}
          </div>
        </Callout>
      )}
      {canContract && (!hasContract || !hasFile) && (
        <Card className="mb-5 border-blue-200/70">
          <CardHeader title={hasContract ? "Imzolangan shartnomani yuklash" : "Shartnoma qilish"} icon={hasContract ? Upload : ScrollText}
            description={hasContract ? "Didox'da imzolangan shartnoma faylini (PDF yoki rasm) tizimga yuklang — u isbot sifatida saqlanadi." : "Summa kiritilsa shartnoma raqami beriladi va mahsulot summasi shartnomadan ayirilib qoldiq ko'rsatiladi. Didox'dagi imzolangan faylni shu yerda yoki keyin yuklaysiz."} />
          <ContractForm orderId={id} current={hasContract ? contractAmount : null} hasFile={hasFile} accept={CONTRACT_ACCEPT} />
        </Card>
      )}
      {canContract && hasContract && hasFile && (
        <details className="mb-5 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm">
          <summary className="cursor-pointer text-slate-600">Shartnoma summasini o&apos;zgartirish yoki faylni almashtirish</summary>
          <div className="pt-3"><ContractForm orderId={id} current={contractAmount} hasFile accept={CONTRACT_ACCEPT} /></div>
        </details>
      )}
      {o.onCredit && o.status !== "CANCELLED" && (
        <Callout tone={o.guaranteeAt ? "success" : "warning"} title={o.guaranteeAt ? `Kafolat xati qabul qilingan · ${date(o.guaranteeAt)}` : guarantee ? "Zayavka qarzga saqlandi — kafolat xatini chop eting" : "Kafolat xati hali olinmagan"}>
          <div className="flex flex-wrap items-center gap-3">
            <span>Qarzga beriladigan mahsulot uchun mijoz kafolat xatini to&apos;ldirib, imzo va muhr qo&apos;yadi. <Link href={`/orders/${id}/guarantee`} className="underline">Xatni ochish / chop etish</Link></span>
            {isSales && <form action={toggleGuarantee.bind(null, id)}><Button variant={o.guaranteeAt ? "ghost" : "secondary"} className="h-8 text-xs">{o.guaranteeAt ? "Belgini olib tashlash" : "Imzolangan xat qabul qilindi"}</Button></form>}
          </div>
        </Callout>
      )}

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
            { k: "Mijoz", v: <CustomerName name={o.customer.name} blacklisted={credit.blacklisted} href={`/customers/${o.customerId}`} /> },
            { k: "Telefon", v: o.customer.phone },
            { k: "Yetkazish", v: <span className="font-medium">{deliveryAt(o.deliveryDate, o.deliveryTime)}</span> },
            { k: "Manzil", v: o.deliveryAddress },
            { k: "Nasos", v: o.needsPump ? "Kerak" : "Yo'q" },
            { k: "Dastavka", v: o.needsDelivery ? "Kerak" : "Mijoz o'zi olib ketadi" },
            { k: "Ustuvorlik", v: o.isUrgent ? <Badge color="red"><Zap size={11} /> Zarur</Badge> : "Oddiy" },
            { k: "To'lov", v: o.onCredit ? "Qarzga (kafolat xati)" : "Oldindan" },
            ...(hasContract ? [
              { k: "Shartnoma", v: <span className="inline-flex items-center gap-1.5"><ContractMark short /><span className="font-medium">{o.contractNo}</span>{hasFile ? <a href={fileHref} target="_blank" rel="noopener" className="inline-flex items-center gap-1 text-xs text-blue-700 underline"><Paperclip size={12} /> fayl</a> : <span className="text-xs text-amber-700">fayl yuklanmagan</span>}</span> },
              { k: "Shartnoma summasi", v: <span className="font-semibold">{money(contractAmount)}</span> },
              { k: "Shartnoma qoldig'i", v: <span className={contractLeft >= 0 ? "font-semibold text-emerald-700" : "font-semibold text-red-600"}>{money(contractLeft)}</span> },
            ] : []),
            ...(!o.onCredit ? [{ k: "Oldindan olindi", v: prepaid > 0
              ? <span className="inline-flex flex-wrap items-center justify-end gap-2"><span className="whitespace-nowrap font-semibold text-emerald-700">{money(prepaid)}</span><span className="text-xs text-slate-500">{o.payments.map((x) => x.cashAccount.name).filter((v, i, a) => a.indexOf(v) === i).join(", ")}</span>{total - paid > 0.005 ? <Badge color="amber">qoldiq {money(total - paid)}</Badge> : <Badge color="green">to&apos;liq</Badge>}</span>
              : <span className="text-slate-400">hali olinmagan</span> }] : []),
            { k: "Kredit limit", v: <span className="inline-flex items-center gap-1.5"><CreditCard size={14} className="text-slate-400" />{money(credit.limit)}</span> },
            { k: "Bo'sh limit", v: <span className={credit.free <= 0 ? "font-semibold text-red-600" : "font-semibold text-emerald-700"}>{money(credit.free)}{credit.blacklisted && <BlacklistMark className="ml-1.5" />}</span> },
            ...(o.note ? [{ k: "Izoh", v: o.note }] : []),
            ...o.invoices.map((inv) => ({ k: `Schyot ${inv.invoiceNo}`, v: <span className="inline-flex flex-wrap items-center justify-end gap-2"><span className="whitespace-nowrap">{money(inv.amount)}</span><InvoiceStatusBadge status={inv.status} /></span> })),
          ]} />
        </Card>
        <Card padded={false} className="lg:col-span-3">
          <div className="px-5 pt-5"><CardHeader title="Mahsulotlar" /></div>
          <table className="w-full text-sm">
            <thead><tr><Th>Mahsulot</Th><Th right>Miqdor</Th><Th right>Narx</Th><Th right>Summa</Th><Th>Brigada</Th><Th right>Bajarildi / qoldiq</Th></tr></thead>
            <tbody>
              {o.items.map((i) => {
                const t = i.task, tq = t ? Number(t.qty) : 0, td = t ? Number(t.doneQty) : 0;
                return (
                  <Tr key={i.id}>
                    <Td>{i.product.name}</Td><Td right>{qty(i.qtyM3)} {unitLabel(i.product.unit)}</Td><Td right>{money(i.price)}</Td><Td right className="font-semibold">{money(Number(i.qtyM3) * Number(i.price))}</Td>
                    <Td>{i.brigade?.name ?? <span className="text-slate-400">—</span>}{t && <div className="mt-0.5"><TaskStatusBadge status={t.status} /></div>}</Td>
                    <Td right>{t ? <><span className="text-emerald-700">{qty(td)}</span> / <span className={tq - td > 0 ? "font-semibold text-amber-700" : "text-slate-400"}>{qty(Math.max(0, tq - td))}</span><div className="mt-1 ml-auto w-20"><Progress value={td} max={tq} tone={td >= tq ? "success" : "default"} /></div></> : <span className="text-slate-400">—</span>}</Td>
                  </Tr>
                );
              })}
              <tr className="bg-slate-50/70"><Td className="font-semibold">Jami</Td><Td right className="font-semibold">{qty(totalM3)}</Td><Td /><Td right className="font-semibold">{money(total)}</Td><Td colSpan={2} className="text-xs text-slate-500">{needsAssign ? <span className="inline-flex items-center gap-1"><HardHat size={13} /> Brigada hali tayinlanmagan — Ishlab chiqarish bo&apos;limida tayinlanadi</span> : <Link href="/tasks" className="inline-flex items-center gap-1 hover:underline"><HardHat size={13} /> Topshiriqlar</Link>}</Td></tr>
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
