import Link from "next/link";
import { ArrowRight, Banknote, Boxes, ClipboardList, Clock, Container, HandCoins, Landmark, PiggyBank, UserPlus, Wallet } from "lucide-react";
import type { CashAccountType, OrderStatus } from "@/generated/prisma";
import { requirePage } from "@/lib/page-guard";
import { pathAllowed } from "@/lib/nav";
import { customerMarks } from "@/lib/finance";
import { salesOverview } from "@/lib/overview/sales";
import { date, fmtNum, isoDate, money, moneyShort, pct } from "@/lib/format";
import { fmtUnitTotals } from "@/lib/unit";
import { Badge, Callout, Empty, PageHeader, Section, StatCard, Table, Td, Th, Tr } from "@/components/ui";
import { CustomerName } from "@/components/customer-name";
import { DayRangeBar, parseDayRange } from "@/app/(app)/bi-tahlil/month-bar";
import { ORDER_STATUS, OrderStatusBadge, SALES_STATUSES } from "../../orders/status";

export const dynamic = "force-dynamic";

const BASE = "/sales/umumiy";
const STATUSES = Object.keys(ORDER_STATUS) as OrderStatus[];
const PRODUCTS_TOP = 10;
const METHOD_LABEL: Record<CashAccountType, string> = { CASH: "Naqd (kassa)", BANK: "Perechisleniye (bank)" };

function More({ href, label = "Batafsil" }: { href?: string; label?: string }) {
  if (!href) return null;
  return <Link href={href} className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-900">{label} <ArrowRight size={14} /></Link>;
}

/**
 * Sotuv — umumiy ko'rinish: bo'limning asosiy raqamlari bitta sahifada (`lib/overview/sales.ts`).
 * Davr (sukut — shu oy): sotuv (realizatsiya), zayavkalar holati, tushgan pul, mahsulot / mijoz / sotuvchi kesimi, yangi mijozlar.
 * Joriy holat (davrga bog'liq emas): debitorka va ochiq bosh to'lov so'rovlari. Har blokda batafsil sahifaga havola —
 * foydalanuvchiga ochiq bo'lsagina.
 */
export default async function SalesOverviewPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await requirePage(BASE);
  const sp = await searchParams;
  const range = parseDayRange(sp);
  const d = await salesOverview(range.from, range.to);
  const marks = await customerMarks([...new Set([
    ...d.customers.filter((c) => c.real).map((c) => c.id), ...d.receivables.top.map((r) => r.customerId), ...d.newCustomers.list.map((c) => c.id),
  ])]);

  // Havola faqat foydalanuvchiga ochiq sahifaga (aks holda «Batafsil» chiqmaydi)
  const go = (...hrefs: string[]) => hrefs.find((h) => pathAllowed(h.split("?")[0]!, s.role, s.perms));
  const last = new Date(range.to.getFullYear(), range.to.getMonth(), range.to.getDate() - 1);
  const q = `from=${isoDate(range.from)}&to=${isoDate(last)}`;
  const customerHref = (id: string) => go(`/customers/${id}`);

  const live = STATUSES.filter((k) => k !== "CANCELLED").map((k) => d.byStatus.get(k));
  const orderCount = live.reduce((a, r) => a + (r?.n ?? 0), 0);
  const orderSum = live.reduce((a, r) => a + (r?.total ?? 0), 0);
  const orderUnits = fmtUnitTotals(live.flatMap((r) => r?.units ?? []));
  const accepted = SALES_STATUSES.reduce((a, k) => a + (d.byStatus.get(k)?.n ?? 0), 0);
  const recvIn = (t: CashAccountType) => d.received[t].payments + d.received[t].sales;
  const receivedTotal = recvIn("CASH") + recvIn("BANK");
  const req = (["CASH", "BANK"] as const).reduce((a, m) => ({ open: a.open + d.requests[m].open, left: a.left + d.requests[m].left, overdue: a.overdue + d.requests[m].overdue, overdueLeft: a.overdueLeft + d.requests[m].overdueLeft }), { open: 0, left: 0, overdue: 0, overdueLeft: 0 });
  const rv = d.receivables;

  return (
    <div>
      <PageHeader title="Sotuv — umumiy ko'rinish" back={{ href: "/sales", label: "Sotuv" }}
        subtitle="Sotuv bo'limining asosiy raqamlari bitta joyda. Sotuv — mijozga yetkazilgan mahsulot va Realizatsiya reestri (QQS bilan, Tahlil bilan bir xil); zayavkalar — zayavka sanasi bo'yicha; debitorka va pul so'rovlari — joriy holat." />
      <DayRangeBar base={BASE} range={range} />

      {req.overdue > 0 && (
        <Callout tone="warning" title="Muddati o'tgan bosh to'lovlar">
          {req.overdue} ta zayavkaning bosh to&apos;lovi yetkazish sanasidan o&apos;tib ham to&apos;liq tushmagan: {money(req.overdueLeft)} kutilmoqda.
        </Callout>
      )}

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatCard label="Sotuv (realizatsiya)" value={money(d.sales.total)} icon={Wallet} tone="brand" hint={`${d.sales.orders} ta zayavka · ${d.sales.customers} ta mijoz`} href={go(`/bi-tahlil/sotuvlar?${q}`, `/sales/realizatsiya?${q}`)} />
        <StatCard label="Sotilgan beton" value={`${fmtNum(d.sales.m3, 1)} m³`} icon={Container} hint={d.sales.m3AvgPrice ? `o'rtacha ${money(d.sales.m3AvgPrice)} / m³` : "yetkazilgan beton yo'q"} href={go(`/sales/realizatsiya?${q}`)} />
        <StatCard label="Dona mahsulot" value={d.sales.other.length ? fmtUnitTotals(d.sales.other) : "0"} icon={Boxes} hint="ustun, blok, plitka va boshqalar" href={go(`/bi-tahlil/mahsulotlar?${q}`)} />
        <StatCard label="Tushgan pul" value={money(receivedTotal)} icon={HandCoins} tone="success" hint={`naqd ${moneyShort(recvIn("CASH"))} · perechisleniye ${moneyShort(recvIn("BANK"))}`} href={go("/payments")} />
        <StatCard label="Zayavkalar" value={String(orderCount)} icon={ClipboardList} hint={`qabul qilingan ${accepted} · ${moneyShort(orderSum)}`} href={go("/orders")} />
        <StatCard label="Debitorka (joriy)" value={money(rv.total)} icon={Clock} tone={rv.total > 0 ? "danger" : "success"} hint={[rv.overdue > 0 ? `muddati o'tgan ${moneyShort(rv.overdue)}` : `${rv.debtors} ta qarzdor`, rv.advance > 0.005 ? `avans ${moneyShort(rv.advance)}` : ""].filter(Boolean).join(" · ")} href={go("/bi-tahlil/mijozlar/xaridorlar", "/customers")} />
        <StatCard label="Pul qabul qilish" value={money(req.left)} icon={PiggyBank} tone={req.overdue > 0 ? "warning" : "default"} hint={`${req.open} ta ochiq so'rov${req.overdue ? ` · ${req.overdue} tasi muddati o'tgan` : ""}`} href={go("/pul-qabul")} />
        <StatCard label="Yangi mijozlar" value={String(d.newCustomers.n)} icon={UserPlus} hint={`${d.newCustomers.bought} tasi davrda xarid qildi`} href={go("/customers")} />
      </div>

      <div className="grid gap-x-6 lg:grid-cols-2">
        <Section title="Zayavkalar holati" action={<More href={go("/orders")} />}>
          <Table>
            <thead><tr><Th>Holat</Th><Th right>Soni</Th><Th right>Hajm</Th><Th right>Summa</Th></tr></thead>
            <tbody>
              {d.byStatus.size === 0 && <Empty text="Davrda zayavka yo'q" />}
              {STATUSES.map((k) => {
                const r = d.byStatus.get(k);
                if (!r?.n) return null;
                const href = SALES_STATUSES.includes(k) ? go(`/sales?status=${k}&${q}`) : go(`/orders?status=${k}`);
                return (
                  <Tr key={k}>
                    <Td>{href ? <Link href={href} className="hover:underline"><OrderStatusBadge status={k} /></Link> : <OrderStatusBadge status={k} />}</Td>
                    <Td right>{r.n}</Td><Td right>{fmtUnitTotals(r.units)}</Td><Td right>{money(r.total)}</Td>
                  </Tr>
                );
              })}
              {orderCount > 0 && <Tr className="font-semibold"><Td>Jami (bekorsiz)</Td><Td right>{orderCount}</Td><Td right>{orderUnits}</Td><Td right>{money(orderSum)}</Td></Tr>}
            </tbody>
          </Table>
        </Section>

        <Section title="Mahsulot bo'yicha sotuv" action={<More href={go(`/bi-tahlil/mahsulotlar?${q}`, `/sales/realizatsiya?${q}`)} />}>
          <Table>
            <thead><tr><Th>Mahsulot</Th><Th right>Hajm</Th><Th right>Summa</Th><Th right>Ulush</Th></tr></thead>
            <tbody>
              {d.products.length === 0 && <Empty text="Davrda yetkazilgan sotuv yo'q" />}
              {d.products.slice(0, PRODUCTS_TOP).map((p) => (
                <Tr key={p.id}><Td>{p.name}</Td><Td right>{fmtUnitTotals(p.units)}</Td><Td right>{money(p.revenue)}</Td><Td right>{pct(p.share)}</Td></Tr>
              ))}
            </tbody>
          </Table>
          {d.products.length > PRODUCTS_TOP && <p className="mt-2 text-xs text-slate-500">Yana {d.products.length - PRODUCTS_TOP} ta mahsulot — batafsil sahifada.</p>}
        </Section>

        <Section title="Eng ko'p xarid qilgan mijozlar" action={<More href={go(`/bi-tahlil/sotuvlar?${q}`, `/sales?${q}`)} />}>
          <Table>
            <thead><tr><Th>Mijoz</Th><Th right>Hajm</Th><Th right>Zayavka</Th><Th right>Summa</Th></tr></thead>
            <tbody>
              {d.customers.length === 0 && <Empty text="Davrda sotuv yo'q" />}
              {d.customers.map((c) => (
                <Tr key={c.id}>
                  <Td><CustomerName name={c.name} blacklisted={marks.black.has(c.id)} contracted={marks.contract.has(c.id)} href={c.real ? customerHref(c.id) : undefined} /></Td>
                  <Td right>{fmtUnitTotals(c.units)}</Td><Td right>{c.orders}</Td><Td right>{money(c.revenue)}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Section>

        <Section title="Eng katta qarzdorlar (joriy)" action={<More href={go("/bi-tahlil/mijozlar/xaridorlar", "/customers")} />}>
          <Table>
            <thead><tr><Th>Mijoz</Th><Th right>Qarz</Th><Th right>Muddati o&apos;tgan</Th><Th right>Eng eski</Th></tr></thead>
            <tbody>
              {rv.top.length === 0 && <Empty text="Qarzdor mijoz yo'q" />}
              {rv.top.map((r) => (
                <Tr key={r.customerId}>
                  <Td><CustomerName name={r.name} blacklisted={marks.black.has(r.customerId)} contracted={marks.contract.has(r.customerId)} href={go(`/customers/${r.customerId}/akt`)} /></Td>
                  <Td right className="text-red-600">{money(r.debt)}</Td>
                  <Td right className={r.overdue > 0 ? "text-red-600" : "text-slate-400"}>{r.overdue > 0 ? money(r.overdue) : "—"}</Td>
                  <Td right>{r.oldestDays != null ? `${r.oldestDays} kun` : "—"}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
          {rv.debtors > rv.top.length && <p className="mt-2 text-xs text-slate-500">Jami {rv.debtors} ta qarzdor; muddati o&apos;tgan — {rv.overdueDays} kundan eski schyotlar.</p>}
        </Section>

        <Section title="Tushgan pul" action={<More href={go("/payments")} />}>
          <Table>
            <thead><tr><Th>Hisob</Th><Th right>Mijoz to&apos;lovlari</Th><Th right>«Savdo» kirimi</Th><Th right>Jami</Th></tr></thead>
            <tbody>
              {(["CASH", "BANK"] as const).map((t) => (
                <Tr key={t}><Td>{METHOD_LABEL[t]}</Td><Td right>{money(d.received[t].payments)}</Td><Td right>{money(d.received[t].sales)}</Td><Td right className="font-semibold">{money(recvIn(t))}</Td></Tr>
              ))}
              <Tr className="font-semibold"><Td>Jami</Td><Td right>{money(d.received.CASH.payments + d.received.BANK.payments)}</Td><Td right>{money(d.received.CASH.sales + d.received.BANK.sales)}</Td><Td right>{money(receivedTotal)}</Td></Tr>
            </tbody>
          </Table>
          <p className="mt-2 text-xs text-slate-500">«Savdo» kirimi — kassa jurnaliga to&apos;lov bo&apos;lib yozilmagan sotuv puli (chakana, Excel importi).</p>
        </Section>

        <Section title="Pul qabul qilish (ochiq so'rovlar)" action={<More href={go("/pul-qabul")} />}>
          <Table>
            <thead><tr><Th>Usul</Th><Th right>Ochiq</Th><Th right>Kutilmoqda</Th><Th right>Muddati o&apos;tgan</Th></tr></thead>
            <tbody>
              {(["CASH", "BANK"] as const).map((m) => (
                <Tr key={m}>
                  <Td>{m === "CASH" ? <Badge color="amber" dot={false}><Banknote size={12} /> Naqd</Badge> : <Badge color="blue" dot={false}><Landmark size={12} /> Perechisleniye</Badge>}</Td>
                  <Td right>{d.requests[m].open}</Td><Td right>{money(d.requests[m].left)}</Td>
                  <Td right className={d.requests[m].overdue ? "text-red-600" : "text-slate-400"}>{d.requests[m].overdue ? `${d.requests[m].overdue} · ${money(d.requests[m].overdueLeft)}` : "—"}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Section>

        <Section title="Sotuvchilar bo'yicha" action={<More href={go(`/bi-tahlil/agentlar?${q}`)} />}>
          <Table>
            <thead><tr><Th>Sotuvchi</Th><Th right>Mijoz</Th><Th right>Zayavka</Th><Th right>Summa</Th></tr></thead>
            <tbody>
              {d.sellers.length === 0 && <Empty text="Davrda sotuv yo'q" />}
              {d.sellers.map((x) => (
                <Tr key={x.id}><Td>{x.name}</Td><Td right>{x.customers}</Td><Td right>{x.orders}</Td><Td right>{money(x.revenue)}</Td></Tr>
              ))}
            </tbody>
          </Table>
          <p className="mt-2 text-xs text-slate-500">Sotuvchi — mijozga biriktirilgan agent, bo&apos;lmasa zayavkani kiritgan xodim{d.sellerCount > d.sellers.length ? `; jami ${d.sellerCount} ta` : ""}.</p>
        </Section>

        <Section title="Yangi mijozlar" action={<More href={go("/customers")} />}>
          <Table>
            <thead><tr><Th>Mijoz</Th><Th>Qo&apos;shilgan</Th><Th right>Davrdagi sotuv</Th></tr></thead>
            <tbody>
              {d.newCustomers.list.length === 0 && <Empty text="Davrda yangi mijoz qo'shilmagan" />}
              {d.newCustomers.list.map((c) => (
                <Tr key={c.id}>
                  <Td><CustomerName name={c.name} blacklisted={marks.black.has(c.id)} contracted={marks.contract.has(c.id)} href={customerHref(c.id)} /></Td>
                  <Td className="whitespace-nowrap">{date(c.createdAt)}</Td>
                  <Td right className={c.revenue > 0 ? undefined : "text-slate-400"}>{c.revenue > 0 ? money(c.revenue) : "—"}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
          {d.newCustomers.n > d.newCustomers.list.length && <p className="mt-2 text-xs text-slate-500">Jami {d.newCustomers.n} ta yangi mijoz.</p>}
        </Section>
      </div>
    </div>
  );
}
