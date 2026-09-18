import Link from "next/link";
import { Plus, Search } from "lucide-react";
import { db } from "@/lib/db";
import { money } from "@/lib/format";
import { Badge, Empty, Input, LinkButton, PageHeader, Table, Td, Th, Tr } from "@/components/ui";

export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const customers = await db.customer.findMany({
    where: q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { inn: { contains: q } }, { phone: { contains: q } }] } : undefined,
    orderBy: { name: "asc" },
  });
  return (
    <div>
      <PageHeader title="Mijozlar" action={<LinkButton href="/customers/new"><Plus size={16} /> Yangi mijoz</LinkButton>} />
      <form className="relative mb-4 max-w-md"><Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><Input name="q" placeholder="Qidirish: nomi, INN, telefon" defaultValue={q} className="pl-9" /></form>
      <Table>
        <thead><tr><Th>Nomi</Th><Th>INN</Th><Th>Telefon</Th><Th right>Kredit limit</Th><Th>Holat</Th></tr></thead>
        <tbody>
          {customers.length === 0 && <Empty text="Mijozlar yo'q" />}
          {customers.map((c) => (
            <Tr key={c.id}>
              <Td><Link href={`/customers/${c.id}`} className="font-medium hover:underline">{c.name}</Link></Td>
              <Td>{c.inn ?? "—"}</Td>
              <Td>{c.phone ?? "—"}</Td>
              <Td right>{money(c.creditLimit)}</Td>
              <Td>{c.isActive ? <Badge color="green">Faol</Badge> : <Badge>Nofaol</Badge>}</Td>
            </Tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}
