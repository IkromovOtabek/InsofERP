import Link from "next/link";
import { Plus, Search, ShieldAlert, FileSignature } from "lucide-react";
import { db } from "@/lib/db";
import { customersCredit, contractedIds } from "@/lib/finance";
import { ContractMark } from "@/components/customer-name";
import { money } from "@/lib/format";
import { Badge, Callout, Empty, Input, LinkButton, PageHeader, Table, Tabs, Td, Th, Tr } from "@/components/ui";

export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ q?: string; tab?: string }> }) {
  const { q, tab = "all" } = await searchParams;
  const [customers, credit, contracted] = await Promise.all([
    db.customer.findMany({
      where: q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { inn: { contains: q } }, { phone: { contains: q } }] } : undefined,
      orderBy: { name: "asc" },
    }),
    customersCredit(),
    contractedIds(),
  ]);
  const rows = customers.map((c) => ({ c, cr: credit.get(c.id)!, contract: contracted.has(c.id) }));
  const black = rows.filter((r) => r.c.isActive && r.cr.blacklisted);
  const withContract = rows.filter((r) => r.contract);
  const shown = tab === "black" ? black : tab === "contract" ? withContract : tab === "inactive" ? rows.filter((r) => !r.c.isActive) : rows;

  return (
    <div>
      <PageHeader title="Mijozlar" subtitle="Har bir mijozga standart 100 mln so'm kredit limit. Qarz + ochiq zayavkalar limitni to'ldirsa mijoz avtomatik qora ro'yxatga tushadi." action={<LinkButton href="/customers/new"><Plus size={16} /> Yangi mijoz</LinkButton>} />
      {black.length > 0 && tab !== "black" && (
        <div className="mb-4"><Callout tone="danger" title={`Qora ro'yxatda ${black.length} ta mijoz`}>Limit to'liq ishlatilgan — ularga yangi zayavka ochilmaydi. <Link href="/customers?tab=black" className="underline">Ro'yxatni ko'rish</Link></Callout></div>
      )}
      <Tabs current={tab} items={[
        { key: "all", label: "Hammasi", href: "/customers", count: rows.length },
        { key: "black", label: "Qora ro'yxat", href: "/customers?tab=black", count: black.length, icon: ShieldAlert },
        { key: "contract", label: "Shartnomali", href: "/customers?tab=contract", count: withContract.length, icon: FileSignature },
        { key: "inactive", label: "Nofaol", href: "/customers?tab=inactive" },
      ]} />
      <form className="relative mb-4 max-w-md"><Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><Input name="q" placeholder="Qidirish: nomi, INN, telefon" defaultValue={q} className="pl-9" /></form>
      <Table>
        <thead><tr><Th>Nomi</Th><Th>INN</Th><Th>Telefon</Th><Th right>Limit</Th><Th right>Ishlatilgan</Th><Th right>Bo'sh limit</Th><Th>Holat</Th></tr></thead>
        <tbody>
          {shown.length === 0 && <Empty text={tab === "black" ? "Qora ro'yxat bo'sh" : tab === "contract" ? "Shartnomali mijoz yo'q" : "Mijozlar yo'q"} />}
          {shown.map(({ c, cr, contract }) => (
            <Tr key={c.id}>
              <Td><span className="inline-flex items-center gap-1.5"><Link href={`/customers/${c.id}`} className="font-medium hover:underline">{c.name}</Link>{contract && <ContractMark />}</span></Td>
              <Td>{c.inn ?? "—"}</Td>
              <Td>{c.phone ?? "—"}</Td>
              <Td right>{money(cr.limit)}</Td>
              <Td right className={cr.used > 0 ? "text-amber-700" : "text-slate-400"}>{money(cr.used)}</Td>
              <Td right className={cr.free <= 0 ? "font-semibold text-red-600" : "text-emerald-700"}>{money(cr.free)}</Td>
              <Td>{!c.isActive ? <Badge>Nofaol</Badge> : cr.blacklisted ? <Badge color="red">Qora ro'yxat</Badge> : <Badge color="green">Faol</Badge>}</Td>
            </Tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}
