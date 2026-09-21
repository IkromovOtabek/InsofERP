import Link from "next/link";
import { ArrowDownLeft, ArrowUpRight, Wallet, Landmark, Trash2 } from "lucide-react";
import { db } from "@/lib/db";
import { customerMarks } from "@/lib/finance";
import { CustomerName } from "@/components/customer-name";
import { requireSession } from "@/lib/auth";
import { money, date, isoDate } from "@/lib/format";
import { Badge, Button, Card, Empty, PageHeader, StatCard, Table, Tabs, Td, Th, Tr, Input } from "@/components/ui";
import { TxForm } from "./tx-form";
import { deleteCashTx } from "./actions";
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES } from "./categories";

type Row = { id: string; date: Date; kind: "INCOME" | "EXPENSE"; account: string; category: string; who: string; note: string | null; amount: number; href?: string; deletable: boolean; blacklisted?: boolean; contracted?: boolean };

/** Kirim-Chiqim: mijoz to'lovlari (Payment) + boshqa kirimlar va barcha chiqimlar (CashTransaction) bitta jurnalda. */
export default async function CashflowPage({ searchParams }: { searchParams: Promise<{ tab?: string; from?: string; to?: string; account?: string }> }) {
  const s = await requireSession(["CASHIER", "ACCOUNTING", "FINANCE"]);
  const canDelete = ["ACCOUNTING", "FINANCE", "DIRECTOR"].includes(s.role);
  const sp = await searchParams;
  const tab = sp.tab ?? "all";
  const now = new Date();
  const from = new Date(sp.from ?? isoDate(new Date(now.getFullYear(), now.getMonth(), 1)));
  const to = new Date(sp.to ?? isoDate(now)); to.setHours(23, 59, 59, 999);
  const acc = sp.account || undefined;

  const [accounts, suppliers, payments, txs, allPay, allTx] = await Promise.all([
    db.cashAccount.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
    db.supplier.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.payment.findMany({ where: { date: { gte: from, lte: to }, ...(acc ? { cashAccountId: acc } : {}) }, include: { customer: true, invoice: true, cashAccount: true } }),
    db.cashTransaction.findMany({ where: { date: { gte: from, lte: to }, ...(acc ? { cashAccountId: acc } : {}) }, include: { cashAccount: true, supplier: true, createdBy: true } }),
    db.payment.groupBy({ by: ["cashAccountId"], _sum: { amount: true } }),
    db.cashTransaction.groupBy({ by: ["cashAccountId", "type"], _sum: { amount: true } }),
  ]);

  const marks = await customerMarks(payments.map((p) => p.customerId));
  // Hisob qoldiqlari (butun davr): mijoz to'lovlari + kirim − chiqim
  const balance = new Map<string, number>();
  for (const p of allPay) balance.set(p.cashAccountId, (balance.get(p.cashAccountId) ?? 0) + Number(p._sum.amount ?? 0));
  for (const t of allTx) balance.set(t.cashAccountId, (balance.get(t.cashAccountId) ?? 0) + (t.type === "INCOME" ? 1 : -1) * Number(t._sum.amount ?? 0));

  const rows: Row[] = [
    ...payments.map((p): Row => ({ id: p.id, date: p.date, kind: "INCOME", account: p.cashAccount.name, category: p.invoice ? `Mijoz to'lovi · ${p.invoice.invoiceNo}` : "Mijoz avansi", who: p.customer.name, note: p.note, amount: Number(p.amount), href: `/customers/${p.customerId}`, deletable: false, blacklisted: marks.black.has(p.customerId), contracted: marks.contract.has(p.customerId) })),
    // Hujjatdan avtomatik yozilgan chiqim (kirim hujjati / sklad kirimi) — ustiga bosilsa batafsili ochiladi
    ...txs.map((t): Row => ({
      id: t.id, date: t.date, kind: t.type, account: t.cashAccount.name,
      category: t.refType ? `Kirim · ${t.category}` : t.category,
      who: t.supplier?.name ?? t.counterparty ?? "—", note: t.note, amount: Number(t.amount),
      href: t.refType === "GoodsReceipt" && t.refId ? `/receipts/${t.refId}`
        : t.refType === "StockIn" && t.refId ? `/stock?tab=moves&ref=${t.refId}`
        : undefined,
      deletable: !t.refType, // hujjatga bog'langanini bu yerdan o'chirib bo'lmaydi — hujjatning o'zidan tuzatiladi
    })),
  ].filter((r) => tab === "all" || r.kind === tab).sort((a, b) => b.date.getTime() - a.date.getTime());

  const inc = rows.filter((r) => r.kind === "INCOME").reduce((x, r) => x + r.amount, 0);
  const exp = rows.filter((r) => r.kind === "EXPENSE").reduce((x, r) => x + r.amount, 0);
  const byCat = new Map<string, number>();
  for (const r of rows.filter((r) => r.kind === "EXPENSE")) byCat.set(r.category, (byCat.get(r.category) ?? 0) + r.amount);
  const qs = (t: string) => `/cashflow?tab=${t}&from=${isoDate(from)}&to=${isoDate(to)}${acc ? `&account=${acc}` : ""}`;

  return (
    <div>
      <PageHeader title="Kirim-Chiqim" subtitle="Pul oqimi jurnali: mijoz to'lovlari (Kassa/bank'dan avtomatik), boshqa kirimlar va barcha chiqimlar." />
      <div className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatCard label="Kirim (davr)" value={money(inc)} icon={ArrowDownLeft} tone="success" />
        <StatCard label="Chiqim (davr)" value={money(exp)} icon={ArrowUpRight} tone={exp > 0 ? "danger" : "default"} />
        <StatCard label="Sof oqim" value={money(inc - exp)} icon={Wallet} tone={inc - exp >= 0 ? "success" : "danger"} />
        <StatCard label="Hisoblar qoldig'i" value={money([...balance.values()].reduce((a, b) => a + b, 0))} icon={Landmark} hint={accounts.map((a) => `${a.name}: ${money(balance.get(a.id) ?? 0)}`).join(" · ")} />
      </div>

      <div className="mb-6 grid grid-cols-1 gap-5 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <h2 className="mb-3 font-semibold">Yangi kirim / chiqim</h2>
          <TxForm accounts={accounts.map((a) => ({ id: a.id, name: a.name }))} suppliers={suppliers} incomeCats={INCOME_CATEGORIES} expenseCats={EXPENSE_CATEGORIES} />
        </Card>
        <Card className="lg:col-span-2">
          <h2 className="mb-3 font-semibold">Chiqimlar kategoriya bo&apos;yicha</h2>
          {byCat.size === 0 ? <p className="text-sm text-slate-500">Davrda chiqim yo&apos;q</p> : (
            <ul className="space-y-1.5 text-sm">
              {[...byCat.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => (
                <li key={k} className="flex items-center justify-between gap-3"><span className="truncate text-slate-700">{k}</span><span className="font-medium tabular-nums">{money(v)}</span></li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <Tabs current={tab} className="mb-0" items={[{ key: "all", label: "Hammasi", href: qs("all") }, { key: "INCOME", label: "Kirim", href: qs("INCOME") }, { key: "EXPENSE", label: "Chiqim", href: qs("EXPENSE") }]} />
        <form className="flex flex-wrap items-center gap-2 text-sm">
          <input type="hidden" name="tab" value={tab} />
          <Input name="from" type="date" defaultValue={isoDate(from)} className="h-9 w-40" />
          <span className="text-slate-400">—</span>
          <Input name="to" type="date" defaultValue={isoDate(to)} className="h-9 w-40" />
          <select name="account" defaultValue={acc ?? ""} className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm"><option value="">Barcha hisoblar</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
          <Button variant="secondary" className="h-9 text-sm">Ko&apos;rsatish</Button>
        </form>
      </div>
      <Table>
        <thead><tr><Th>Sana</Th><Th>Turi</Th><Th>Kategoriya</Th><Th>Kimdan / kimga</Th><Th>Hisob</Th><Th right>Summa</Th><Th>Izoh</Th><Th></Th></tr></thead>
        <tbody>
          {rows.length === 0 && <Empty text="Davrda harakat yo'q" />}
          {rows.map((r) => (
            <Tr key={r.id}>
              <Td>{date(r.date)}</Td>
              <Td>{r.kind === "INCOME" ? <Badge color="green">Kirim</Badge> : <Badge color="red">Chiqim</Badge>}</Td>
              <Td>{r.href ? <Link href={r.href} className="font-medium text-slate-800 hover:underline">{r.category} →</Link> : r.category}</Td>
              <Td><CustomerName name={r.who} blacklisted={!!r.blacklisted} contracted={!!r.contracted} href={r.href} /></Td>
              <Td className="text-slate-500">{r.account}</Td>
              <Td right className={r.kind === "INCOME" ? "font-medium text-emerald-700" : "font-medium text-red-600"}>{r.kind === "INCOME" ? "+" : "−"}{money(r.amount)}</Td>
              <Td className="text-slate-500">{r.note ?? ""}</Td>
              <Td>{r.deletable && canDelete && <form action={deleteCashTx.bind(null, r.id)}><Button variant="ghost" className="h-7 px-1.5 text-red-600 hover:bg-red-50" title="O'chirish"><Trash2 size={14} /></Button></form>}</Td>
            </Tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}
