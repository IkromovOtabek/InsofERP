import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft, ChevronRight, History, SlidersHorizontal, Wallet } from "lucide-react";
import { getSession } from "@/lib/auth";
import { getCompany } from "@/lib/company";
import { monthTitle, shiftMonth, today, validMonth } from "@/lib/davomat";
import { dateTime, money } from "@/lib/format";
import { Card, CardHeader, PageHeader } from "@/components/ui";
import { BudgetForm, ThresholdForm } from "./budget-form";
import { budgetMonth } from "@/lib/expense-budget";

/**
 * Xarajat byudjeti (TZ §4, §6): har kategoriya uchun oylik byudjet va limit, fakt/prognoz yonida.
 * Chegaralar (norma / e'tibor / kritik) ham shu yerda — egasi dashbordi shu qoidalar bilan rang beradi.
 */
export default async function BudgetPage({ searchParams }: { searchParams: Promise<{ oy?: string }> }) {
  const s = await getSession();
  if (s?.role !== "DIRECTOR") redirect("/dashboard?denied=1");
  const ym = validMonth((await searchParams).oy) ?? today().slice(0, 7);
  // Byudjet, fakt, prognoz va tarix — `lib/expense-budget.ts` (mobil ilova ham shu hisob)
  const [company, { rows, history }] = await Promise.all([getCompany(), budgetMonth(ym)]);

  return (
    <div>
      <PageHeader eyebrow="Egasi dashbordi" title="Xarajat byudjeti va chegaralar" info="Har kategoriya uchun oylik byudjet. Byudjetdan oshgan xarajat dashbordda qizil, rejalashtirilmagan — alohida ro'yxatda." back={{ href: "/dashboard", label: "Bosh sahifa" }}
        action={
          <div className="flex items-center gap-1 text-sm">
            <Link href={`?oy=${shiftMonth(ym, -1)}`} className="rounded-md p-1.5 hover:bg-slate-100" aria-label="Oldingi oy"><ChevronLeft size={16} /></Link>
            <span className="px-2 font-medium">{monthTitle(ym)}</span>
            <Link href={`?oy=${shiftMonth(ym, 1)}`} className="rounded-md p-1.5 hover:bg-slate-100" aria-label="Keyingi oy"><ChevronRight size={16} /></Link>
          </div>
        } />

      <Card padded={false} className="mb-6">
        <div className="px-5 pt-5"><CardHeader title={`Byudjet — ${monthTitle(ym)}`} info={<><p>Limit bo&apos;sh qolsa byudjetning o&apos;zi limit hisoblanadi.</p><p>Fakt — Kirim-Chiqimdagi chiqimlar (ta&apos;minot zayavkasidan avtomatik yozilganlar ham).</p></>} icon={Wallet} /></div>
        <div className="px-5 pb-5"><BudgetForm month={ym} rows={rows} prevMonth={shiftMonth(ym, -1)} warnPct={company.alertWarnPct} /></div>
      </Card>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Holat chegaralari" icon={SlidersHorizontal}
            info={<>
              <p>Norma / e&apos;tibor / kritik qoidalari — dashborddagi ranglar shu qiymatlardan hisoblanadi (TZ §16).</p>
              {/* Sahifa faqat direktorga ochiq (yuqorida redirect) — havola ham faqat unga ko'rinadi */}
              <p>Katta xarid chegarasi, kunlik zayavka va mijoz limitlari — <Link href="/settings?tab=limits" className="font-medium text-slate-700 underline hover:text-slate-900">Sozlamalar → Limitlar</Link></p>
            </>} />
          <ThresholdForm t={{ alertWarnPct: company.alertWarnPct, alertCritPct: company.alertCritPct, stockWarnDays: company.stockWarnDays, stockCritDays: company.stockCritDays, overdueDays: company.overdueDays }} />
        </Card>
        <Card>
          <CardHeader title="O'zgarishlar tarixi" info="Shu oy byudjetini kim va qachon o'zgartirgani" icon={History} />
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
