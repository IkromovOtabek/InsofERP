import Link from "next/link";
import { notFound } from "next/navigation";
import { Receipt, Wallet, Truck, CalendarDays } from "lucide-react";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { customerCredit, contractedIds } from "@/lib/finance";
import { BlacklistMark, ContractMark } from "@/components/customer-name";
import { money, fmtNum, date, isoDate } from "@/lib/format";
import { payKindLabel } from "@/lib/sales-register";
import { Button, Card, Input, LinkButton, PageHeader, StatCard } from "@/components/ui";
import { RegisterTable, toView } from "../../register-table";

/**
 * Realizatsiya jurnali — bitta mijoz. Kassa/bank jadvalida mijoz nomi bosilganda shu sahifa ochiladi:
 * faqat o'sha mijozning qatorlari (jadvalda 20 ta bo'lsa — 20 tasi), jami miqdor va summasi bilan.
 */
export default async function CustomerRegisterPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  await requireSession(["CASHIER", "ACCOUNTING", "FINANCE"]);

  const from = sp.from ? new Date(sp.from) : undefined;
  const to = sp.to ? new Date(sp.to) : undefined;
  if (to) to.setHours(23, 59, 59, 999);
  const where = { customerId: id, ...(from || to ? { date: { ...(from ? { gte: from } : {}) , ...(to ? { lte: to } : {}) } } : {}) };

  const customer = await db.customer.findUnique({ where: { id }, select: { id: true, name: true, inn: true, phone: true } });
  if (!customer) notFound();

  const [rows, totals, byProduct, credit, contracted] = await Promise.all([
    db.salesRegister.findMany({ where, orderBy: [{ date: "desc" }, { createdAt: "desc" }], include: { customer: { select: { name: true } } } }),
    db.salesRegister.aggregate({ where, _count: { _all: true }, _sum: { qty: true, sum: true, nds: true, total: true, deliveryFee: true } }),
    db.salesRegister.groupBy({ by: ["productName", "unit"], where, _count: { _all: true }, _sum: { qty: true, total: true }, orderBy: { _sum: { total: "desc" } } }),
    customerCredit(id),
    contractedIds([id]),
  ]);

  // Naqd / o'tkazma bo'yicha bo'linish — "Деньги" ustuni
  const byPay = new Map<string, { count: number; total: number }>();
  for (const r of rows) {
    const k = payKindLabel(r.payType);
    const a = byPay.get(k) ?? { count: 0, total: 0 };
    byPay.set(k, { count: a.count + 1, total: a.total + Number(r.total) });
  }

  const count = totals._count._all;
  const sumTotal = Number(totals._sum.total ?? 0);

  return (
    <div>
      <PageHeader
        back={{ href: "/payments?tab=jurnal", label: "Kassa / bank — jurnal" }}
        title={<>{customer.name}{credit.blacklisted && <BlacklistMark className="text-xs" />}{contracted.has(id) && <ContractMark className="text-xs" />}</>}
        subtitle={`Realizatsiya jurnali · ${[customer.inn && `INN ${customer.inn}`, customer.phone].filter(Boolean).join(" · ") || "mijozning barcha qatorlari"}`}
        action={<LinkButton href={`/customers/${id}`} variant="secondary">Mijoz kartasi</LinkButton>}
      />

      <div className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatCard label="Qatorlar" value={fmtNum(count)} hint={from || to ? "tanlangan davrda" : "butun jurnal"} icon={Receipt} />
        <StatCard label="Miqdor (jami)" value={fmtNum(Number(totals._sum.qty ?? 0), 3)} hint={byProduct.map((p) => p.unit).filter((u, i, a) => a.indexOf(u) === i).join(", ")} icon={Truck} />
        <StatCard label="Summa + NDS" value={money(Number(totals._sum.sum ?? 0))} hint={`NDS ${money(Number(totals._sum.nds ?? 0))} · dostavka ${money(Number(totals._sum.deliveryFee ?? 0))}`} icon={Receipt} />
        <StatCard label="Itogo summa" value={money(sumTotal)} tone="success" icon={Wallet} hint={[...byPay.entries()].map(([k, v]) => `${k}: ${money(v.total)}`).join(" · ") || undefined} />
      </div>

      <div className="mb-5 grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <h2 className="mb-3 font-semibold">Mahsulot bo&apos;yicha</h2>
          {byProduct.length === 0 ? <p className="text-sm text-slate-500">Qator yo&apos;q</p> : (
            <ul className="space-y-1.5 text-sm">
              {byProduct.map((p) => (
                <li key={`${p.productName}|${p.unit}`} className="flex items-center justify-between gap-3">
                  <span className="min-w-0 truncate text-slate-700">{p.productName} <span className="text-xs text-slate-400">· {p._count._all} ta qator</span></span>
                  <span className="shrink-0 tabular-nums text-slate-500">{fmtNum(Number(p._sum.qty ?? 0), 3)} {p.unit} · <span className="font-medium text-slate-900">{money(Number(p._sum.total ?? 0))}</span></span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <h2 className="mb-3 flex items-center gap-2 font-semibold"><CalendarDays size={16} className="text-slate-400" /> Davr</h2>
          <form className="flex flex-wrap items-center gap-2 text-sm">
            <Input name="from" type="date" defaultValue={from ? isoDate(from) : ""} className="h-9 w-36" />
            <span className="text-slate-400">—</span>
            <Input name="to" type="date" defaultValue={to ? isoDate(to) : ""} className="h-9 w-36" />
            <Button variant="secondary" className="h-9 text-sm">Ko&apos;rsatish</Button>
            {(from || to) && <Link href={`/payments/mijoz/${id}`} className="text-xs text-slate-500 hover:underline">tozalash</Link>}
          </form>
          <div className="mt-3 space-y-1 text-xs text-slate-500">
            <div>Qarz (ochiq schyotlar): <span className="font-medium text-slate-800">{money(credit.debt)}</span></div>
            <div>Bo&apos;sh limit: <span className="font-medium text-slate-800">{money(credit.free)}</span></div>
            {rows.length > 0 && <div>Oxirgi qator: {date(rows[0].date)}</div>}
          </div>
        </Card>
      </div>

      <h2 className="mb-3 font-semibold">Qatorlar <span className="text-sm font-normal text-slate-500">· {count} ta</span></h2>
      <RegisterTable rows={rows.map(toView)} showCustomer={false} />
    </div>
  );
}
