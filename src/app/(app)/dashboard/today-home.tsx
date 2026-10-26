import Link from "next/link";
import { ArrowRight, CalendarRange, CircleAlert, CircleCheck, HandCoins, Landmark, TrendingUp, Wallet, Scale } from "lucide-react";
import { todayData } from "@/lib/fin-report/today";
import { CAL_KIND_LABEL } from "@/lib/fin-report/calendar";
import { date, fmtNum, money, moneyShort, pct } from "@/lib/format";
import { Badge, Card, CardHeader, StatCard } from "@/components/ui";
import { cn } from "@/lib/utils";
import { ForecastChart } from "../moliya/forecast-chart";

/**
 * Direktor «Bugun» ekrani — bosh sahifada direktor uchun sukut (shablon 01, «Insof 2026» → Dashboard):
 * 5 ta asosiy raqam, 30 kunlik kassa prognozi, e'tibor bering, pul qoldiqlari, 7 kunlik majburiy to'lovlar, oy natijasi.
 * Ma'lumot — `lib/fin-report/today.ts` (kalendar, PNL, debitorka, kreditlar bilan bitta manba).
 */
export async function TodayHome() {
  const d = await todayData();
  const { cal } = d;
  const levelCls = { crit: "border-red-200 bg-red-50", warn: "border-amber-200 bg-amber-50/70", ok: "border-emerald-200 bg-emerald-50/70" } as const;
  const lastBal = cal.days[cal.days.length - 1]?.balance ?? cal.start;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 2xl:grid-cols-5">
        <StatCard label="Jami pul, hozir" value={moneyShort(d.cash.total)} hint={`bugun +${moneyShort(d.cash.inToday)} / −${moneyShort(d.cash.outToday)}`} icon={Wallet} href="/moliya?tab=dds" />
        <StatCard label="Oy sotuvi" value={moneyShort(d.sales.month)} hint={d.sales.plan ? `reja ${moneyShort(d.sales.plan)} · ${pct(d.sales.pct ?? 0, 0)}` : "reja kiritilmagan"} icon={TrendingUp} tone={d.sales.pct !== null && d.sales.pct < 50 ? "warning" : "success"} href="/bi-tahlil/sotuvlar" />
        <StatCard label="Oy sof foydasi" value={moneyShort(d.profit.net)} hint={d.profit.margin !== null ? `marja ${pct(d.profit.margin)} · hisoblangan` : "hisoblangan PNL"} icon={Scale} tone={d.profit.net < 0 ? "danger" : "brand"} href="/moliya" />
        <StatCard label="Bizga qarz" value={moneyShort(d.receivable.total)} hint={d.receivable.over60 ? `60+ kun: ${moneyShort(d.receivable.over60)}` : `${d.receivable.debtors} ta qarzdor`} icon={HandCoins} tone={d.receivable.over60 ? "warning" : "default"} href="/bi-tahlil/mijozlar" />
        <StatCard label="Bizning qarzimiz" value={moneyShort(d.payable.total)} hint={`kredit ${moneyShort(d.payable.loans)} · ta'minotchi ${moneyShort(d.payable.suppliers)}`} icon={Landmark} tone={d.payable.total > d.cash.total ? "danger" : "default"} href="/moliya/kreditlar" />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Kassa prognozi, 30 kun" icon={CalendarRange} description="Tushum − ta'minotchilar − majburiy va kundalik to'lovlar" action={<Link href="/moliya/kalendar" className="inline-flex items-center gap-1 text-[13px] font-semibold text-slate-600 hover:text-slate-900">Kalendar <ArrowRight size={14} /></Link>} />
          <ForecastChart days={cal.days} height={200} />
          <div className="mt-3 grid grid-cols-1 gap-2 text-[13px] sm:grid-cols-3">
            <div className={cn("rounded-lg px-3 py-2", cal.min.balance < 0 ? "bg-red-50 text-red-800" : "bg-slate-50 text-slate-700")}>Eng past qoldiq: <b className="tabular">{moneyShort(cal.min.balance)}</b> · {date(cal.min.date)}</div>
            <div className="rounded-lg bg-slate-50 px-3 py-2 text-slate-700">30 kun oxirida: <b className="tabular">{moneyShort(lastBal)}</b></div>
            <div className="rounded-lg bg-slate-50 px-3 py-2 text-slate-700">Kunlik tushum: <b className="tabular">{moneyShort(cal.perDayIn)}</b></div>
          </div>
        </Card>
        <Card>
          <CardHeader title="Bugun e'tibor bering" icon={CircleAlert} />
          <ul className="space-y-2">
            {d.attention.map((a) => (
              <li key={a.key}>
                <Link href={a.href} className={cn("flex items-start gap-2.5 rounded-lg border px-3 py-2.5 transition hover:shadow-sm", levelCls[a.level])}>
                  {a.level === "ok" ? <CircleCheck size={17} className="mt-0.5 shrink-0 text-emerald-600" /> : <CircleAlert size={17} className={cn("mt-0.5 shrink-0", a.level === "crit" ? "text-red-600" : "text-amber-600")} />}
                  <span className="min-w-0">
                    <span className="block text-[14px] font-semibold text-slate-900">{a.title}</span>
                    <span className="block text-[13px] text-slate-600">{a.text}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader title="Pul qoldiqlari" icon={Wallet} />
          <dl className="divide-y divide-slate-100 text-sm">
            {d.cash.accounts.map((a) => (
              <div key={a.id} className="flex items-center justify-between gap-3 py-2">
                <dt className="min-w-0 truncate text-slate-600">{a.name} <span className="text-[12px] text-slate-400">{a.type === "CASH" ? "naqd" : "bank"}</span></dt>
                <dd className={cn("font-semibold tabular", a.balance < 0 && "text-red-600")}>{fmtNum(a.balance)}</dd>
              </div>
            ))}
            <div className="flex items-center justify-between gap-3 py-2"><dt className="font-semibold text-slate-900">Jami</dt><dd className="font-bold tabular">{fmtNum(d.cash.total)}</dd></div>
          </dl>
        </Card>
        <Card>
          <CardHeader title="Yaqin to'lovlar, 7 kun" icon={CalendarRange} action={<Link href="/moliya/tolov-rejasi" className="text-[13px] font-semibold text-slate-600 hover:text-slate-900">Reja</Link>} />
          {d.week.length === 0 ? <p className="text-sm text-slate-500">7 kun ichida aniq sanali to&apos;lov yo&apos;q.</p> : (
            <ul className="divide-y divide-slate-100 text-sm">
              {d.week.slice(0, 7).map((i, k) => (
                <li key={k} className="flex items-start justify-between gap-3 py-2">
                  <span className="min-w-0">
                    <span className="block truncate text-slate-800">{i.who}</span>
                    <span className="block text-[12px] text-slate-500">{date(i.date)} · {CAL_KIND_LABEL[i.kind]}{i.overdue && <> · <Badge color="red">o&apos;tgan</Badge></>}</span>
                  </span>
                  <span className="shrink-0 font-semibold tabular text-red-600">−{fmtNum(i.amount)}</span>
                </li>
              ))}
              {d.week.length > 7 && <li className="py-2 text-[13px] text-slate-500">yana {d.week.length - 7} ta — <Link href="/moliya/kalendar" className="underline">kalendarda</Link></li>}
            </ul>
          )}
          <div className={cn("mt-3 flex justify-between rounded-lg px-3 py-2 text-[13px]", cal.dividend.left < 0 ? "bg-red-50 text-red-800" : "bg-slate-50 text-slate-700")}>
            <span>Divident limiti qoldig&apos;i</span><b className="tabular">{money(cal.dividend.left)}</b>
          </div>
        </Card>
        <Card>
          <CardHeader title="Oy natijasi" icon={Scale} description="hisoblangan PNL, joriy oy" action={<Link href="/moliya" className="text-[13px] font-semibold text-slate-600 hover:text-slate-900">PNL</Link>} />
          <dl className="divide-y divide-slate-100 text-sm">
            {[
              ["Daromad (QQSsiz)", d.profit.income],
              ["Yalpi foyda", d.profit.gross],
              ["Operatsion foyda", d.profit.operating],
              ["Zavod sof foydasi", d.profit.net],
            ].map(([k, v]) => (
              <div key={k as string} className="flex items-center justify-between gap-3 py-2">
                <dt className="text-slate-600">{k}{d.profit.income ? <span className="ml-1 text-[12px] text-slate-400">{pct(((v as number) / d.profit.income) * 100)}</span> : null}</dt>
                <dd className={cn("font-semibold tabular", (v as number) < 0 && "text-red-600")}>{fmtNum(v as number)}</dd>
              </div>
            ))}
          </dl>
        </Card>
      </div>
    </div>
  );
}
