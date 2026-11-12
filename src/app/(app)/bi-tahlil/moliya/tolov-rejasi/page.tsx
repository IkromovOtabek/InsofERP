import { ArrowDownLeft, CalendarClock, Landmark, Repeat, TrendingUp, Truck } from "lucide-react";
import { requirePage } from "@/lib/page-guard";
import { canDo } from "@/lib/permissions";
import { db } from "@/lib/db";
import { fmtNum, moneyShort, pct } from "@/lib/format";
import { startOfDay } from "@/lib/fin-report/calendar";
import { loadCategories, makeResolver } from "@/lib/fin-report/categories";
import { StatCard } from "@/components/ui";
import { biContext, BiPage, type SP } from "../../shell";
import { PaymentPlanView } from "@/app/(app)/moliya/tolov-rejasi/view";

export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<SP> }) {
  await requirePage("/bi-tahlil/moliya/tolov-rejasi");
  const { s, range } = await biContext(searchParams);
  const [settings, recurring, planned, nodes] = await Promise.all([
    db.companySettings.findUnique({ where: { id: "main" }, select: { supplierPaymentDays: true, cashPlanFactor: true, dividendPct: true } }),
    db.recurringPayment.findMany({ where: { cancelledAt: null }, select: { name: true, category: true, dayOfMonth: true, amount: true, isActive: true, loanId: true } }),
    db.plannedFlow.findMany({ where: { status: "PLANNED" }, select: { type: true, amount: true, date: true } }),
    loadCategories(),
  ]);

  // Statistika — ko'rinishdagi «Oylik jami» bilan bir ta'rif: faqat faol doimiy to'lovlar, bir martalik — hali bajarilmagan (PLANNED)
  const resolve = makeResolver(nodes);
  const active = recurring.filter((r) => r.isActive).map((r) => ({ ...r, amount: Number(r.amount) }));
  const stopped = recurring.length - active.length;
  const monthlyFixed = active.reduce((x, r) => x + r.amount, 0);
  const creditTax = active.filter((r) => { const top = resolve(r.category)?.top; return !!r.loanId || top?.needs === "LOAN" || top?.pnlLine === "TAX"; }).reduce((x, r) => x + r.amount, 0);
  const biggest = active.reduce<(typeof active)[number] | null>((m, r) => (!m || r.amount > m.amount ? r : m), null);
  const today = startOfDay(new Date());
  const outs = planned.filter((p) => p.type !== "INCOME"), ins = planned.filter((p) => p.type === "INCOME");
  const outSum = outs.reduce((x, p) => x + Number(p.amount), 0), inSum = ins.reduce((x, p) => x + Number(p.amount), 0);
  const overdue = outs.filter((p) => p.date < today).length;
  const days = settings?.supplierPaymentDays ?? 7;

  return (
    <BiPage title="Moliya" subtitle="To'lov rejasi — sozlamalar (sariq kataklarni o'zingiz o'zgartirasiz), to'lov kalendari shundan hisoblanadi" tab="finance" range={range} period={false}>
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Doimiy to'lovlar, oyiga" value={moneyShort(monthlyFixed)} hint={`${active.length} ta faol${stopped ? ` · ${stopped} ta to'xtatilgan` : ""}`} icon={Repeat} tone="brand" />
        <StatCard label="Kredit va soliqlar, oyiga" value={moneyShort(creditTax)} hint={monthlyFixed > 0 ? `doimiy to'lovlarning ${pct((creditTax / monthlyFixed) * 100)}` : "doimiy to'lov kiritilmagan"} icon={Landmark} />
        <StatCard label="Eng katta doimiy to'lov" value={biggest ? moneyShort(biggest.amount) : "—"} hint={biggest ? `${biggest.name} · har oy ${biggest.dayOfMonth}-kuni` : "doimiy to'lov kiritilmagan"} icon={TrendingUp} />
        <StatCard label="Bir martalik to'lovlar" value={moneyShort(outSum)} hint={`${outs.length} ta${overdue ? ` · ${overdue} tasi muddati o'tgan` : ""}`} icon={CalendarClock} tone={overdue ? "warning" : "default"} />
        <StatCard label="Kutilayotgan tushumlar" value={moneyShort(inSum)} hint={`${ins.length} ta va'da qilingan`} icon={ArrowDownLeft} tone="success" />
        <StatCard label="Ta'minotchiga to'lov muddati" value={`${days} kun`} hint={`reja koeffitsiyenti ${fmtNum(Number(settings?.cashPlanFactor ?? 1), 2)} · divident ${fmtNum(Number(settings?.dividendPct ?? 100))}%`} icon={Truck} />
      </div>
      <PaymentPlanView canWrite={canDo(s, "moliya", "plan")} />
    </BiPage>
  );
}
