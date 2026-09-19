import Link from "next/link";
import { notFound } from "next/navigation";
import { Wallet, ClipboardList, CreditCard, ArrowRight, Plus } from "lucide-react";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { customerCredit, contractedIds } from "@/lib/finance";
import { money, date } from "@/lib/format";
import { Callout, Card, CardHeader, Empty, LinkButton, PageHeader, StatCard, Td, Th, Tr } from "@/components/ui";
import { CustomerForm } from "../customer-form";
import { BlacklistMark, ContractMark } from "@/components/customer-name";
import { OrderStatusBadge } from "../../orders/status";

export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await requireSession(["SALES", "ACCOUNTING", "FINANCE"]);
  const c = await db.customer.findUnique({ where: { id }, include: { orders: { orderBy: { date: "desc" }, take: 10, include: { items: true } } } });
  if (!c) notFound();
  const [{ limit, debt, open, used, free, blacklisted }, contracted] = await Promise.all([customerCredit(id), contractedIds([id])]);
  const canOrder = ["SALES", "DIRECTOR"].includes(s.role) && c.isActive && !blacklisted;

  return (
    <div>
      <PageHeader back={{ href: "/customers", label: "Mijozlar" }} title={<>{c.name}{blacklisted && <BlacklistMark className="text-xs" />}{contracted.has(id) && <ContractMark className="text-xs" />}</>} subtitle={[c.inn && `INN ${c.inn}`, c.phone].filter(Boolean).join(" · ") || undefined}
        action={canOrder ? <LinkButton href={`/orders/new?customer=${id}`}><Plus size={16} /> Zayavka</LinkButton> : undefined} />
      {blacklisted && (
        <div className="mb-4"><Callout tone="danger" title="Mijoz qora ro'yxatda">Limit {money(limit)} to'liq ishlatilgan: qarz {money(debt)} + ochiq zayavkalar {money(open)}. Yangi zayavka ochilmaydi. Qarz to'langach mijoz avtomatik ro'yxatdan chiqadi; direktor yoki Finance limitni oshirishi mumkin.</Callout></div>
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
          <CustomerForm customer={{ ...c, creditLimit: c.creditLimit.toString() }} canEditLimit={["FINANCE", "DIRECTOR"].includes(s.role)} />
        </Card>
        <Card padded={false}>
          <div className="px-5 pt-5"><CardHeader title="So'nggi zayavkalar" action={<span className="inline-flex items-center gap-3 text-sm"><Link href={`/orders?customer=${id}`} className="inline-flex items-center gap-1 text-slate-500 hover:text-slate-900">Kutayotgan</Link><Link href={`/sales?customer=${id}`} className="inline-flex items-center gap-1 text-slate-500 hover:text-slate-900">Sotuvlar <ArrowRight size={14} /></Link></span>} /></div>
          <table className="w-full text-sm">
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
        </Card>
      </div>
    </div>
  );
}
