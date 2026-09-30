import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft, ChevronRight, History, SlidersHorizontal, Wallet } from "lucide-react";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { getCompany } from "@/lib/company";
import { monthTitle, shiftMonth, today, validMonth } from "@/lib/davomat";
import { EXPENSE_CATEGORIES } from "@/app/(app)/cashflow/categories";
import { dateTime, money } from "@/lib/format";
import { Card, CardHeader, PageHeader } from "@/components/ui";
import { BudgetForm, ThresholdForm, type BudgetRow } from "./budget-form";

/**
 * Xarajat byudjeti (TZ §4, §6): har kategoriya uchun oylik byudjet va limit, fakt/prognoz yonida.
 * Chegaralar (norma / e'tibor / kritik) ham shu yerda — egasi dashbordi shu qoidalar bilan rang beradi.
 */
export default async function BudgetPage({ searchParams }: { searchParams: Promise<{ oy?: string }> }) {
  const s = await getSession();
  if (s?.role !== "DIRECTOR") redirect("/dashboard?denied=1");
  const ym = validMonth((await searchParams).oy) ?? today().slice(0, 7);
  const [year, month] = ym.split("-").map(Number);
  const mStart = new Date(year, month - 1, 1), mEnd = new Date(year, month, 1), hStart = new Date(year, month - 4, 1);
  const now = new Date();
  const daysPassed = now >= mEnd ? Math.round((mEnd.getTime() - mStart.getTime()) / 86400000) : now < mStart ? 0 : now.getDate();
  const daysInMonth = Math.round((mEnd.getTime() - mStart.getTime()) / 86400000);

  const [company, budgets, fact, hist, history] = await Promise.all([
    getCompany(),
    db.expenseBudget.findMany({ where: { year, month } }),
    db.cashTransaction.groupBy({ by: ["category"], where: { type: "EXPENSE", date: { gte: mStart, lt: mEnd } }, _sum: { amount: true } }),
    db.cashTransaction.findMany({ where: { type: "EXPENSE", date: { gte: hStart, lt: mStart } }, select: { category: true, amount: true, date: true } }),
    db.auditLog.findMany({ where: { entity: "ExpenseBudget", entityId: ym }, orderBy: { createdAt: "desc" }, take: 10, include: { user: { select: { fullName: true } } } }),
  ]);
  const factBy = new Map(fact.map((f) => [f.category, Number(f._sum.amount ?? 0)]));
  const histBy = new Map<string, Set<string>>(), histSum = new Map<string, number>();
  for (const h of hist) { histSum.set(h.category, (histSum.get(h.category) ?? 0) + Number(h.amount)); (histBy.get(h.category) ?? histBy.set(h.category, new Set()).get(h.category)!).add(`${h.date.getFullYear()}-${h.date.getMonth()}`); }
  const cats = [...new Set([...EXPENSE_CATEGORIES, ...budgets.map((b) => b.category), ...fact.map((f) => f.category)])];
  const rows: BudgetRow[] = cats.map((cat) => {
    const b = budgets.find((x) => x.category === cat);
    const f = factBy.get(cat) ?? 0, months = histBy.get(cat)?.size ?? 0;
    return { cat, amount: b ? Number(b.amount) : null, limit: b?.limit ? Number(b.limit) : null, fact: f, forecast: daysPassed > 0 ? (f / daysPassed) * daysInMonth : 0, histAvg: months ? (histSum.get(cat) ?? 0) / months : null };
  });

  return (
    <div>
      <PageHeader eyebrow="Egasi dashbordi" title="Xarajat byudjeti va chegaralar" subtitle="Har kategoriya uchun oylik byudjet. Byudjetdan oshgan xarajat dashbordda qizil, rejalashtirilmagan — alohida ro'yxatda." back={{ href: "/dashboard", label: "Bosh sahifa" }}
        action={
          <div className="flex items-center gap-1 text-sm">
            <Link href={`?oy=${shiftMonth(ym, -1)}`} className="rounded-md p-1.5 hover:bg-slate-100" aria-label="Oldingi oy"><ChevronLeft size={16} /></Link>
            <span className="px-2 font-medium">{monthTitle(ym)}</span>
            <Link href={`?oy=${shiftMonth(ym, 1)}`} className="rounded-md p-1.5 hover:bg-slate-100" aria-label="Keyingi oy"><ChevronRight size={16} /></Link>
          </div>
        } />

      <Card padded={false} className="mb-6">
        <div className="px-5 pt-5"><CardHeader title={`Byudjet — ${monthTitle(ym)}`} description="Limit bo'sh qolsa byudjetning o'zi limit hisoblanadi. Fakt — Kirim-Chiqimdagi chiqimlar (ta'minot zayavkasidan avtomatik yozilganlar ham)." icon={Wallet} /></div>
        <div className="px-5 pb-5"><BudgetForm month={ym} rows={rows} prevMonth={shiftMonth(ym, -1)} /></div>
      </Card>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Holat chegaralari" description="Norma / e'tibor / kritik qoidalari — dashborddagi ranglar shu qiymatlardan hisoblanadi (TZ §16)." icon={SlidersHorizontal} />
          <ThresholdForm t={{ alertWarnPct: company.alertWarnPct, alertCritPct: company.alertCritPct, stockWarnDays: company.stockWarnDays, stockCritDays: company.stockCritDays, overdueDays: company.overdueDays, supplyDirectorLimit: Number(company.supplyDirectorLimit) }} />
        </Card>
        <Card>
          <CardHeader title="O'zgarishlar tarixi" description="Shu oy byudjetini kim va qachon o'zgartirgani" icon={History} />
          {history.length === 0 ? <p className="text-sm text-slate-500">Hali o&apos;zgarish yo&apos;q.</p> : (
            <ul className="space-y-2 text-sm">
              {history.map((h) => {
                const after = (h.after as { c: string; a: number }[] | { copiedFrom?: string; count?: number } | null);
                const total = Array.isArray(after) ? after.reduce((s, r) => s + r.a, 0) : null;
                return (
                  <li key={h.id} className="border-l-2 border-slate-200 pl-3">
                    <div className="font-medium">{h.user.fullName} <span className="text-xs font-normal text-slate-400">· {dateTime(h.createdAt)}</span></div>
                    <div className="text-xs text-slate-500">{Array.isArray(after) ? `${after.length} kategoriya · jami ${money(total ?? 0)}` : after && "copiedFrom" in after ? `${after.copiedFrom} dan ${after.count} ta nusxalandi` : "—"}</div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
