import Link from "next/link";
import { ArrowDownLeft, ArrowUpRight, CircleAlert, CircleCheck, HandCoins, Landmark, Receipt, Scale, ShoppingCart, TrendingUp, Wallet } from "lucide-react";
import { todayData } from "@/lib/fin-report/today";
import { boshqaruvPaneli } from "@/lib/fin-report/panel";
import { CAL_KIND_LABEL } from "@/lib/fin-report/calendar";
import { getCompany } from "@/lib/company";
import { date, dateTime, fmtNum, moneyShort, pct } from "@/lib/format";
import { Badge, Card, CardHeader, Input, StatCard } from "@/components/ui";
import { cn } from "@/lib/utils";
import { FoydaZararBlock, IshlabChiqarishBlock, KunlikBlock, KunlikChart, PulQoldiqlari, QarzlarBlock, SotuvBlock, XomAshyoBlock } from "./boshqaruv-paneli";

/**
 * Direktor «Bugun» ekrani — bosh sahifada direktor uchun sukut («Insof 2026» → «INSOF MCHJ — BOSHQARUV PANELI»):
 * sana tanlanadi (sukut — bugun); 8 ta asosiy raqam, pul qoldiqlari, sotuv, ishlab chiqarish va tayyor mahsulot,
 * xom-ashyo skladi, qarzlar, oy foyda-zarari, kunlik sotuv va tushum — `lib/fin-report/panel.ts`.
 * Bugun ko'rilganda yana: kunlik sotuv diagrammasi, «E'tibor bering» (Nazorat bilan) va yaqin to'lovlar — `today.ts`.
 */
export async function TodayHome({ date: dayParam }: { date?: string }) {
  const picked = dayParam && /^\d{4}-\d{2}-\d{2}$/.test(dayParam) ? new Date(`${dayParam}T00:00:00`) : undefined;
  const p = await boshqaruvPaneli(picked);
  const [d, company] = await Promise.all([p.isToday ? todayData() : Promise.resolve(null), getCompany()]);
  const k = p.kpi;
  const ymd = `${p.day.getFullYear()}-${String(p.day.getMonth() + 1).padStart(2, "0")}-${String(p.day.getDate()).padStart(2, "0")}`;
  const levelCls = { crit: "border-red-200 bg-red-50", warn: "border-amber-200 bg-amber-50/70", ok: "border-emerald-200 bg-emerald-50/70" } as const;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3 rounded-(--radius-card) border border-slate-200/80 bg-white px-4 py-3 shadow-(--shadow-card)">
        <div className="min-w-0">
          <div className="text-[15px] font-extrabold uppercase tracking-[0.06em] text-slate-900">{(company.legalName ?? company.name).toUpperCase()} — BOSHQARUV PANELI</div>
          <div className="mt-1 flex flex-wrap gap-x-5 gap-y-1 text-[13px] text-slate-500">
            <span>Sana: <b className="text-slate-800">{date(p.day)}</b></span>
            <span>Oy boshi: <b className="text-slate-800">{date(p.monthStart)}</b></span>
            <span>Oxirgi yozuv: <b className="text-slate-800">{p.lastEntry ? dateTime(p.lastEntry) : "—"}</b></span>
          </div>
        </div>
        <form method="get" className="flex items-center gap-2">
          <Input type="date" name="date" defaultValue={ymd} className="h-9 w-44" aria-label="Boshqa kunni ko'rish" />
          <button className="h-9 rounded-lg bg-slate-900 px-3 text-sm font-medium text-white hover:bg-slate-800">Ko&apos;rsatish</button>
          {!p.isToday && <Link href="/dashboard" className="h-9 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">Bugun</Link>}
        </form>
      </div>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatCard label={p.isToday ? "Jami pul (hozir)" : "Jami pul (kun oxiri)"} value={moneyShort(k.cash)} hint={fmtNum(k.cash)} icon={Wallet} href="/bi-tahlil/moliya/dds" />
        <StatCard label="Bugun kirim" value={moneyShort(k.inToday)} hint={fmtNum(k.inToday)} icon={ArrowDownLeft} tone="success" href="/cashflow" />
        <StatCard label="Bugun chiqim" value={moneyShort(k.outToday)} hint={fmtNum(k.outToday)} icon={ArrowUpRight} tone="danger" href="/cashflow" />
        <StatCard label="Bugun sotuv" value={moneyShort(k.salesToday)} hint={fmtNum(k.salesToday)} icon={ShoppingCart} href="/bi-tahlil/sotuvlar" />
        <StatCard label="Oy sotuvi" value={moneyShort(k.salesMonth)} hint={d?.sales.plan ? `reja ${moneyShort(d.sales.plan)} · ${pct(d.sales.pct ?? 0, 0)}` : fmtNum(k.salesMonth)} icon={TrendingUp} tone={d?.sales.pct != null && d.sales.pct < 50 ? "warning" : "success"} href="/bi-tahlil/sotuvlar" />
        <StatCard label="Oy zavod sof foydasi" value={moneyShort(k.netMonth)} hint={p.isToday ? "hisoblangan PNL" : "butun oy, hisoblangan PNL"} icon={Scale} tone={k.netMonth < 0 ? "danger" : "brand"} href="/bi-tahlil/moliya/pnl" />
        <StatCard label="Bizga qarzlar (haqdorlik)" value={moneyShort(k.receivable)} hint={d?.receivable.over60 ? `60+ kun: ${moneyShort(d.receivable.over60)}` : fmtNum(k.receivable)} icon={HandCoins} tone={d?.receivable.over60 ? "warning" : "default"} href="/bi-tahlil/mijozlar" />
        <StatCard label="Bizning qarzimiz" value={moneyShort(k.payable)} hint={`shundan bank kreditlari ${moneyShort(p.debts.bankLoans)}`} icon={Landmark} tone={k.payable > k.cash ? "danger" : "default"} href="/moliya/kreditlar" />
      </div>

      {/* Kassa prognozi o'rniga — kunlik sotuv va tushum diagrammasi (prognoz: Moliya → To'lov kalendari) */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className={d ? "min-w-0 xl:col-span-2" : "min-w-0 xl:col-span-3"}><KunlikChart p={p} /></div>
        {d && (
          <Card>
            <CardHeader title="Bugun e'tibor bering" icon={CircleAlert} action={<Link href="/dashboard?view=nazorat" className="text-[13px] font-semibold text-slate-600 hover:text-slate-900">Nazorat</Link>} />
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
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 2xl:grid-cols-3">
        <div className={d ? "2xl:col-span-2" : "2xl:col-span-3"}><PulQoldiqlari p={p} /></div>
        {d && (
          <Card>
            <CardHeader title="Yaqin to'lovlar, 7 kun" icon={Receipt} action={<Link href="/moliya/tolov-rejasi" className="text-[13px] font-semibold text-slate-600 hover:text-slate-900">Reja</Link>} />
            {d.week.length === 0 ? <p className="text-sm text-slate-500">7 kun ichida aniq sanali to&apos;lov yo&apos;q.</p> : (
              <ul className="divide-y divide-slate-100 text-sm">
                {d.week.slice(0, 6).map((i, n) => (
                  <li key={n} className="flex items-start justify-between gap-3 py-2">
                    <span className="min-w-0">
                      <span className="block truncate text-slate-800">{i.who}</span>
                      <span className="block text-[12px] text-slate-500">{date(i.date)} · {CAL_KIND_LABEL[i.kind]}{i.overdue && <> · <Badge color="red">o&apos;tgan</Badge></>}</span>
                    </span>
                    <span className="shrink-0 font-semibold tabular text-red-600">−{fmtNum(i.amount)}</span>
                  </li>
                ))}
                {d.week.length > 6 && <li className="py-2 text-[13px] text-slate-500">yana {d.week.length - 6} ta — <Link href="/moliya/kalendar" className="underline">kalendarda</Link></li>}
              </ul>
            )}
          </Card>
        )}
      </div>

      <SotuvBlock p={p} />
      <IshlabChiqarishBlock p={p} />
      <XomAshyoBlock p={p} />
      <div className="grid grid-cols-1 gap-6 2xl:grid-cols-5">
        <div className="2xl:col-span-3"><QarzlarBlock p={p} /></div>
        <div className="2xl:col-span-2"><FoydaZararBlock p={p} /></div>
      </div>
      <KunlikBlock p={p} />
    </div>
  );
}
