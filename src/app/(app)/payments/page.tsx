import Link from "next/link";
import { FileSpreadsheet, Trash2, Users, Receipt, Wallet } from "lucide-react";
import { db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma";
import { customerMarks, markedName } from "@/lib/finance";
import { CustomerName } from "@/components/customer-name";
import { getSession } from "@/lib/auth";
import { money, date, fmtNum, isoDate } from "@/lib/format";
import { Badge, Button, Callout, Card, Empty, LinkButton, PageHeader, StatCard, Table, Tabs, Td, Th, Tr, Input } from "@/components/ui";
import { PaymentForm } from "./payment-form";
import { RegisterTable, toView } from "./register-table";
import { deleteImportBatch } from "./actions";

/**
 * Kassa / bank — ikki ko'rinish:
 *  · To'lovlar — qo'lda qayd etilgan mijoz to'lovlari;
 *  · Realizatsiya jurnali — Excel'dan yuklangan kunlik jo'natma jadvali (mijoz nomi bosilsa uning sahifasi).
 */
export default async function PaymentsPage({ searchParams }: { searchParams: Promise<{ tab?: string; from?: string; to?: string; batch?: string }> }) {
  const sp = await searchParams;
  const s = await getSession();
  const canDelete = ["ACCOUNTING", "FINANCE", "DIRECTOR"].includes(s?.role ?? "");
  const tab = sp.tab === "jurnal" ? "jurnal" : "tolovlar";
  const batch = sp.batch || undefined;
  // Jurnal sanasi bo'yicha filtr — ko'rsatilmasa butun jurnal (oxirgi 500 qator)
  const from = sp.from ? new Date(sp.from) : undefined;
  const to = sp.to ? new Date(sp.to) : undefined;
  if (to) to.setHours(23, 59, 59, 999);
  const regWhere: Prisma.SalesRegisterWhereInput = { ...(batch ? { batch } : {}), ...(from || to ? { date: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}) };

  const accounts = await db.cashAccount.findMany({ where: { isActive: true }, include: { payments: { select: { amount: true } } } });
  const [regCount, regTotals] = await Promise.all([
    db.salesRegister.count(),
    db.salesRegister.aggregate({ where: regWhere, _sum: { sum: true, nds: true, total: true, qty: true }, _count: { _all: true } }),
  ]);

  const qs = (t: string) => `/payments?tab=${t}${from ? `&from=${isoDate(from)}` : ""}${to ? `&to=${isoDate(to)}` : ""}${batch ? `&batch=${batch}` : ""}`;

  return (
    <div>
      <PageHeader
        title="Kassa / bank"
        action={<LinkButton href="/payments/import" variant="secondary"><FileSpreadsheet size={15} /> Excel orqali qo&apos;shish</LinkButton>}
      />

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        {accounts.map((a) => (
          <Card key={a.id}>
            <div className="text-sm text-slate-500">{a.name} <span className="text-xs">({a.type === "CASH" ? "naqd" : "bank"})</span></div>
            <div className="mt-1 text-xl font-semibold">{money(a.payments.reduce((x, p) => x + Number(p.amount), 0))}</div>
            <div className="text-xs text-slate-500">kirimlar jami</div>
          </Card>
        ))}
      </div>

      <Tabs current={tab} items={[
        { key: "tolovlar", label: "To'lovlar", href: qs("tolovlar"), icon: Wallet },
        { key: "jurnal", label: "Realizatsiya jurnali", href: qs("jurnal"), icon: Receipt, count: regCount },
      ]} />

      {tab === "tolovlar" ? <PaymentsTab /> : (
        <JurnalTab where={regWhere} batch={batch} canDelete={canDelete} from={from} to={to}
          totals={{ rows: regTotals._count._all, qty: Number(regTotals._sum.qty ?? 0), sum: Number(regTotals._sum.sum ?? 0), nds: Number(regTotals._sum.nds ?? 0), total: Number(regTotals._sum.total ?? 0) }} />
      )}
    </div>
  );
}

/* ───────── To'lovlar ───────── */

async function PaymentsTab() {
  const [payments, accounts, customers, openInvoices] = await Promise.all([
    db.payment.findMany({ orderBy: { date: "desc" }, take: 200, include: { customer: true, invoice: true, cashAccount: true } }),
    db.cashAccount.findMany({ where: { isActive: true }, select: { id: true, name: true } }),
    db.customer.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.invoice.findMany({ where: { status: { in: ["OPEN", "PARTIAL"] } }, include: { payments: true } }),
  ]);
  const marks = await customerMarks([...customers.map((c) => c.id), ...payments.map((p) => p.customerId)]);
  // Qora ro'yxatdagilar tanlovda ham belgili — kassir to'lovni qaysi mijozga yozayotganini biladi
  const custOpts = customers.map((c) => ({ id: c.id, name: markedName(c.name, c.id, marks) }));
  const invOpts = openInvoices.map((i) => ({ id: i.id, invoiceNo: i.invoiceNo, customerId: i.customerId, remaining: Number(i.amount) - i.payments.reduce((s, p) => s + Number(p.amount), 0) }));

  return (
    <>
      <Card className="mb-6"><h2 className="mb-3 font-semibold">Yangi to&apos;lov (kirim)</h2><PaymentForm customers={custOpts} invoices={invOpts} accounts={accounts} /></Card>
      <h2 className="mb-3 font-semibold">So&apos;nggi to&apos;lovlar</h2>
      <Table>
        <thead><tr><Th>Sana</Th><Th>Mijoz</Th><Th>Schyot</Th><Th>Kassa/hisob</Th><Th right>Summa</Th><Th>Izoh</Th></tr></thead>
        <tbody>
          {payments.length === 0 && <Empty text="To'lovlar yo'q" />}
          {payments.map((p) => (
            <Tr key={p.id}>
              <Td>{date(p.date)}</Td>
              <Td><CustomerName name={p.customer.name} blacklisted={marks.black.has(p.customerId)} contracted={marks.contract.has(p.customerId)} href={`/customers/${p.customerId}`} /></Td>
              <Td>{p.invoice?.invoiceNo ?? <span className="text-slate-400">avans</span>}</Td>
              <Td>{p.cashAccount.name}</Td><Td right className="font-medium text-emerald-700">+{money(p.amount)}</Td><Td className="text-slate-500">{p.note ?? ""}</Td>
            </Tr>
          ))}
        </tbody>
      </Table>
    </>
  );
}

/* ───────── Realizatsiya jurnali ───────── */

async function JurnalTab({ where, batch, canDelete, from, to, totals }: {
  where: Prisma.SalesRegisterWhereInput; batch?: string; canDelete: boolean; from?: Date; to?: Date;
  totals: { rows: number; qty: number; sum: number; nds: number; total: number };
}) {
  const [rows, byCustomer, imports] = await Promise.all([
    db.salesRegister.findMany({ where, orderBy: [{ date: "desc" }, { createdAt: "desc" }], take: 500, include: { customer: { select: { name: true } } } }),
    db.salesRegister.groupBy({ by: ["customerId"], where, _count: { _all: true }, _sum: { total: true, qty: true } }),
    db.salesRegister.groupBy({ by: ["batch"], _count: { _all: true }, _max: { createdAt: true }, orderBy: { _max: { createdAt: "desc" } }, take: 6 }),
  ]);
  const names = new Map((await db.customer.findMany({ where: { id: { in: byCustomer.map((c) => c.customerId) } }, select: { id: true, name: true } })).map((c) => [c.id, c.name]));
  const marks = await customerMarks(byCustomer.map((c) => c.customerId));
  const cust = byCustomer
    .map((c) => ({ id: c.customerId, name: names.get(c.customerId) ?? "—", count: c._count._all, total: Number(c._sum.total ?? 0), qty: Number(c._sum.qty ?? 0) }))
    .sort((a, b) => b.total - a.total);

  return (
    <>
      {batch && (
        <Callout tone="success" title="Excel importi">
          Shu partiyadagi {totals.rows} ta qator ko&apos;rsatilmoqda.{" "}
          <Link href="/payments?tab=jurnal" className="font-medium underline">Butun jurnalni ko&apos;rish</Link>
          {canDelete && (
            <form action={deleteImportBatch.bind(null, batch)} className="mt-2">
              <Button variant="secondary" className="h-8 text-xs text-red-600"><Trash2 size={13} /> Partiyani qaytarish (qatorlar va kirimlar o&apos;chadi)</Button>
            </form>
          )}
        </Callout>
      )}

      <div className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatCard label="Qatorlar" value={fmtNum(totals.rows)} hint={`${cust.length} ta mijoz`} icon={Receipt} />
        <StatCard label="Miqdor (jami)" value={fmtNum(totals.qty, 3)} icon={Wallet} />
        <StatCard label="Summa + NDS" value={money(totals.sum)} hint={`NDS ${money(totals.nds)}`} icon={Receipt} />
        <StatCard label="Itogo summa" value={money(totals.total)} tone="success" icon={Wallet} />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <form className="flex flex-wrap items-center gap-2 text-sm">
          <input type="hidden" name="tab" value="jurnal" />
          {batch && <input type="hidden" name="batch" value={batch} />}
          <Input name="from" type="date" defaultValue={from ? isoDate(from) : ""} className="h-9 w-40" />
          <span className="text-slate-400">—</span>
          <Input name="to" type="date" defaultValue={to ? isoDate(to) : ""} className="h-9 w-40" />
          <Button variant="secondary" className="h-9 text-sm">Ko&apos;rsatish</Button>
          {(from || to) && <Link href="/payments?tab=jurnal" className="text-xs text-slate-500 hover:underline">filtrni tozalash</Link>}
        </form>
      </div>

      <div className="mb-5 grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <h2 className="mb-3 flex items-center gap-2 font-semibold"><Users size={16} className="text-slate-400" /> Mijozlar bo&apos;yicha</h2>
          {cust.length === 0 ? <p className="text-sm text-slate-500">Jurnal bo&apos;sh</p> : (
            <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {cust.slice(0, 30).map((c) => (
                <li key={c.id}>
                  {/* Mijoz ustiga bosilsa — faqat o'sha mijozning qatorlari alohida sahifada */}
                  <Link href={`/payments/mijoz/${c.id}`} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2 text-sm transition hover:border-slate-400 hover:bg-slate-50">
                    <span className="flex min-w-0 items-center gap-2">
                      <CustomerName name={c.name} blacklisted={marks.black.has(c.id)} contracted={marks.contract.has(c.id)} short />
                      <Badge color="slate" dot={false}>{c.count} ta</Badge>
                    </span>
                    <span className="shrink-0 font-medium tabular-nums">{money(c.total)}</span>
                  </Link>
                </li>
              ))}
              {cust.length > 30 && <li className="px-3 py-2 text-xs text-slate-500">… va yana {cust.length - 30} ta mijoz</li>}
            </ul>
          )}
        </Card>
        <Card>
          <h2 className="mb-3 flex items-center gap-2 font-semibold"><FileSpreadsheet size={16} className="text-slate-400" /> Oxirgi importlar</h2>
          {imports.length === 0 ? (
            <p className="text-sm text-slate-500">Hali Excel yuklanmagan. <Link href="/payments/import" className="font-medium text-slate-800 underline">Yuklash →</Link></p>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {imports.map((b) => (
                <li key={b.batch} className="flex items-center justify-between gap-2">
                  <Link href={`/payments?tab=jurnal&batch=${b.batch}`} className="min-w-0 truncate text-slate-700 hover:underline">
                    {b._max.createdAt ? date(b._max.createdAt) : "—"} · {b._count._all} ta qator
                  </Link>
                  {canDelete && (
                    <form action={deleteImportBatch.bind(null, b.batch)}>
                      <Button variant="ghost" className="h-7 px-1.5 text-red-600 hover:bg-red-50" title="Partiyani qaytarish"><Trash2 size={14} /></Button>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <h2 className="mb-3 font-semibold">Jurnal {rows.length < totals.rows && <span className="text-sm font-normal text-slate-500">· oxirgi {rows.length} ta qator ({totals.rows} tadan)</span>}</h2>
      <RegisterTable rows={rows.map(toView)} marks={marks} />
    </>
  );
}
