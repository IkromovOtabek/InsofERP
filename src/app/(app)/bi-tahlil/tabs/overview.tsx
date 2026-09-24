import Link from "next/link";
import { TrendingUp, CalendarRange, Wallet, Landmark, Percent, Users, Truck, AlertTriangle, CheckCircle2 } from "lucide-react";
import { overviewTab } from "@/lib/bi/overview";
import { type Range, WEEKDAYS_FULL } from "@/lib/bi/core";
import { money, moneyShort, fmtNum, qty, date as fmtDate } from "@/lib/format";
import { Kpi, Delta, Panel, Why, Insight, Action, ScoreRing, Note, PeriodBar, tabHref } from "../ui";
import { HBarList } from "@/components/ui/charts";
import { cn } from "@/lib/utils";

const greeting = () => { const h = new Date().getHours(); return h < 12 ? "Xayrli tong" : h < 18 ? "Xayrli kun" : "Xayrli kech"; };

export async function OverviewTab({ range, name }: { range: Range; name: string }) {
  const d = await overviewTab(range);
  const today = new Date();
  const riskItems = [
    { key: "debt", title: "Qarz", value: d.risk.debt, count: `${d.risk.debtCount} ta mijoz xarid qilishni to'xtatgan (At Risk / Lost), lekin qarzi qolgan. Aloqa uzilgan sari bu pulni qaytarib olish qiyinlashadi.`, fix: "kassaga qaytadi", fixValue: d.risk.debt * 0.6, cost: d.risk.debt * (0.24 / 12), tone: "border-blue-400", color: "text-blue-600", href: tabHref(range, "customers", { debt: "yes" }) },
    { key: "profit", title: "Yo'qotilayotgan foyda", value: d.risk.lostProfit, count: `${d.loss.blockedOrders} ta zayavka kredit limit sabab bloklangan, ${d.loss.stockout.count} ta xomashyo tasdiqlangan zayavkalarga yetmaydi — sotuv shunchaki bo'lmayapti.`, fix: "yo'qotilmaydi", fixValue: d.risk.lostProfit * 0.7, cost: d.risk.lostProfit, tone: "border-amber-400", color: "text-amber-600", href: "/orders?status=BLOCKED" },
    { key: "frozen", title: "Muzlagan pul", value: d.risk.frozen, count: `${d.risk.frozenCount} ta xomashyo omborda 90 kundan beri ishlatilmay yotibdi. Pul kassada emas — omborda: yangi xomashyoga ham, qarzni yopishga ham ishlatib bo'lmaydi.`, fix: "kassaga qaytadi", fixValue: d.risk.frozen * 0.5, cost: d.risk.frozen * (0.24 / 12), tone: "border-violet-400", color: "text-violet-600", href: "/stock" },
  ];
  const share = (v: number) => (d.riskTotal > 0 ? Math.round((v / d.riskTotal) * 100) : 0);

  return (
    <div className="space-y-6">
      {/* Salomlashuv */}
      <div className="on-dark rounded-(--radius-card) bg-gradient-to-br from-ink-950 via-ink-900 to-slate-800 px-6 py-5 text-white shadow-(--shadow-pop)">
        <div className="flex items-center gap-2 text-xs text-slate-300"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> Ma'lumotlar jonli · {fmtDate(today)} {String(today.getHours()).padStart(2, "0")}:{String(today.getMinutes()).padStart(2, "0")}</div>
        <h2 className="mt-1.5 text-2xl font-semibold tracking-tight">{greeting()}, {name.split(" ")[0]}!</h2>
        <p className="mt-1 text-[14px] text-slate-300">Bugun <span className="font-medium text-white">{WEEKDAYS_FULL[today.getDay()]}, {fmtDate(today)}</span>. Bugungi sotuv <span className="font-semibold text-white">{moneyShort(d.todayRevenue)}</span> (<Delta value={d.todayDelta} label="kechagi kunga nisbatan" />) · {qty(d.todayM3)} m³ zayavka · {d.delivered}/{d.tripsToday} reys yetkazildi</p>
      </div>

      {/* Davr filtri — salomlashuvdan keyin (qobiqda emas: BiPage'ga period={false} berilgan) */}
      <PeriodBar range={range} tab="overview" className="mb-0" />

      {/* KPI */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Kpi label="Bugungi sotuv" value={moneyShort(d.todayRevenue)} delta={d.todayDelta} deltaLabel="kechaga" icon={TrendingUp} tone="brand" hint={`O'tgan oy o'rtachasi: ${moneyShort(d.month.planPerDay)}/kun`} spark={d.spark} />
        <Kpi label="Oylik sotuv" value={moneyShort(d.month.revenue)} delta={d.month.delta} deltaLabel="o'tgan oyga" icon={CalendarRange} tone="info" hint={<>Prognoz: <b>{moneyShort(d.month.forecast)}</b> · {d.month.daysLeft} kun qoldi</>} />
        <Kpi label="Yalpi foyda" value={moneyShort(d.kpis.gross.cur)} delta={d.kpis.gross.delta} icon={Wallet} tone={d.kpis.gross.cur >= 0 ? "success" : "danger"} hint={`Marja ${fmtNum(d.kpis.margin.cur, 1)}% (${d.kpis.margin.delta === null ? "—" : (d.kpis.margin.cur - d.kpis.margin.prev >= 0 ? "▲" : "▼") + fmtNum(Math.abs(d.kpis.margin.cur - d.kpis.margin.prev), 1) + " p.p."})`} />
        <Kpi label="Kassa tushumi" value={moneyShort(d.kpis.cashIn.cur)} delta={d.kpis.cashIn.delta} icon={Landmark} tone="success" hint={range.label} />
        <Kpi label="Debitorka" value={moneyShort(d.kpis.receivable)} icon={Percent} tone={d.kpis.receivable > 0 ? "warning" : "default"} hint={`${d.kpis.debtors} ta qarzdor mijoz`} href={tabHref(range, "customers", { debt: "yes" })} />
        <Kpi label="Faol mijozlar" value={`${d.kpis.active} / ${d.kpis.total}`} icon={Users} tone="violet" hint={`Faollik ${fmtNum(d.kpis.activeRate, 0)}% · Lost: ${d.kpis.lost}`} href={tabHref(range, "customers")} />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        {/* Biznes salomatligi */}
        <Panel title="Biznes salomatligi" eyebrow={range.label} info="5 ta ko'rsatkich × 20 ball: debitorka nazorati, xomashyo zaxirasi, marja, sotuv o'sishi, zayavka oqimi. Ma'lumoti yo'q ko'rsatkich ballanmaydi — ball qolganlari bo'yicha 100 ballik shkalaga keltiriladi.">
          <div className="flex flex-col items-center">
            <ScoreRing score={d.health} label={d.healthLabel} />
            <div className="mt-3 w-full space-y-2">
              {d.components.map((c) => (
                <div key={c.label}>
                  <div className="flex justify-between text-xs"><span className="text-slate-600">{c.label}</span><span className={cn("tabular font-medium", c.score === null ? "text-slate-400" : "text-slate-800")}>{c.score === null ? "—" : `${c.score}/20`}</span></div>
                  <div className="mt-0.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">{c.score !== null && <div className={cn("h-full rounded-full", c.score >= 15 ? "bg-emerald-500" : c.score >= 10 ? "bg-amber-500" : "bg-red-500")} style={{ width: `${(c.score / 20) * 100}%` }} />}</div>
                </div>
              ))}
            </div>
            <Why>{d.components.map((c) => <p key={c.label}><b>{c.label}:</b> {c.text}.</p>)}<p className="text-slate-500">Ball ≥75 — sog'lom, 50–74 — e'tibor talab, &lt;50 — xavfli. {d.health === null ? `Ball hisoblanmadi: ${d.healthBasis} ta ko'rsatkichda ma'lumot bor, kamida 3 tasi kerak.` : `Hisobga olingan ko'rsatkich: ${d.healthBasis} / ${d.components.length}.`}</p></Why>
          </div>
        </Panel>

        {/* Xavf ostidagi pul */}
        <Panel className="xl:col-span-2" title="Xavf ostidagi pul (Money Under Risk)" info="Joriy holatdan hisoblangan — taxmin emas. Uch joyda turibdi: mijozlarda qarz, bloklangan/xomashyosiz zayavkalardan yo'qotilayotgan foyda va omborda muzlagan xomashyo." action={<Link href={tabHref(range, "finance")} className="font-medium text-blue-600 hover:underline">Batafsil →</Link>}>
          <div className="text-[30px] font-bold leading-none tracking-tight text-red-600 tabular">{money(d.riskTotal)}</div>
          <p className="mt-2 text-[13px] text-slate-600">Bu pul hali yo'qolgan emas — xavf ostida. Yalpi marja {fmtNum(d.kpis.margin.cur, 1)}%. Hech narsa qilinmasa 30 kunlik kapital narxi: <b className="text-red-600">−{moneyShort(d.capitalCost30)} so'm</b>.</p>
          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
            {riskItems.map((it) => (
              <div key={it.key} className={cn("rounded-lg border-l-4 bg-slate-50/70 p-3.5", it.tone)}>
                <div className={cn("text-xl font-bold tabular", it.color)}>{moneyShort(it.value)}</div>
                <div className="text-[12.5px] font-semibold text-slate-800">{it.title} · {share(it.value)}%</div>
                <p className="mt-1 text-xs leading-relaxed text-slate-600">{it.count}</p>
                <div className="mt-2.5 rounded-md border border-slate-200 bg-white p-2 text-[11.5px]">
                  <div className="mb-1 flex justify-between text-[10px] font-semibold uppercase tracking-wider text-slate-400"><span>Pul ta'siri</span><span>30 kun · taxmin</span></div>
                  <div className="flex justify-between"><span className="text-slate-600">Hal qilsangiz — {it.fix}</span><span className="font-semibold text-emerald-600 tabular">+{moneyShort(it.fixValue)}</span></div>
                  <div className="flex justify-between"><span className="text-slate-600">Hal qilmasangiz</span><span className="font-semibold text-red-600 tabular">−{moneyShort(it.cost)}</span></div>
                </div>
                <Link href={it.href} className="mt-2 inline-block text-xs font-medium text-slate-700 hover:underline">Ro'yxatni ko'rish →</Link>
              </div>
            ))}
          </div>
          <Why>
            <p><b>Qarz</b> — At Risk / Lost segmentidagi mijozlarning ochiq schyotlari (schyot − to'lovlar).</p>
            <p><b>Yo'qotilayotgan foyda</b> — bloklangan zayavkalar summasi × marja + yetishmayotgan xomashyo qiymati.</p>
            <p><b>Muzlagan pul</b> — 90 kun retseptga kirmagan xomashyo qoldig'i × o'rtacha kirim narxi.</p>
            <p>Kapital narxi yillik 24% deb olingan (bank kreditiga ekvivalent).</p>
          </Why>
        </Panel>
      </div>

      {/* Bugungi vazifalar */}
      <Panel title={<span className="inline-flex items-center gap-1.5"><AlertTriangle size={15} className="text-amber-500" /> Bugungi {d.tasks.length} ta vazifa</span>} info="Pul bo'yicha tartiblangan — eng katta ta'sir birinchi. Har biri bir bosishda kerakli sahifaga olib boradi." padded={false}>
        {d.tasks.length === 0 ? <div className="px-5 py-8 text-center text-sm text-slate-500"><CheckCircle2 className="mx-auto mb-2 text-emerald-500" /> Bugun shoshilinch vazifa yo'q — hammasi nazoratda.</div> : (
          <ol className="divide-y divide-slate-100">
            {d.tasks.map((t) => (
              <li key={t.n} className="flex items-start gap-3 px-5 py-3">
                <span className={cn("mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white", t.tone === "danger" ? "bg-red-500" : t.tone === "warning" ? "bg-amber-500" : "bg-slate-500")}>{t.n}</span>
                <div className="min-w-0 flex-1">
                  <div className="text-[13.5px] font-semibold text-slate-900">{t.money > 0 && <span className="mr-1.5 text-red-600 tabular">{moneyShort(t.money)} so'm</span>}{t.title}</div>
                  <div className="text-xs text-slate-600">{t.text}</div>
                </div>
                <Link href={t.href} className="shrink-0 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800">Bajarish</Link>
              </li>
            ))}
          </ol>
        )}
      </Panel>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Panel title="Yo'qotishlar — kanal bo'yicha" info="Kuniga qancha pul ketyapti; kattadan kichikka." action={<Link href={tabHref(range, "finance")} className="font-medium text-blue-600 hover:underline">Moliya →</Link>}>
          <div className="mb-3 text-[13px] text-slate-600">Jami <b className="text-red-600">{moneyShort(d.loss.totalPerDay)} so'm/kun</b> · oyiga ≈ {moneyShort(d.loss.totalPerDay * 30)} so'm. Eng katta teshik — <b>{d.loss.biggest.title}</b>.</div>
          <HBarList data={d.loss.channels.filter((c) => c.perDay > 0).map((c) => ({ label: c.title, value: c.perDay, hint: "/kun", tone: "danger" as const }))} formatValue={(v) => moneyShort(v)} />
          {d.loss.channels.every((c) => c.perDay <= 0) && <Note>Yo'qotish kanallari bo'sh — ajoyib.</Note>}
        </Panel>
        <Panel title="Yaxshi xabar" info="Rejadan yuqori ko'rsatkichlar va kuchli tomonlar.">
          {d.goodNews.length === 0 && !d.topProduct ? <Note>Hozircha ajratib ko'rsatadigan ijobiy signal yo'q.</Note> : (
            <ul className="space-y-2 text-[13px]">
              {d.goodNews.map((g, i) => <li key={i} className="flex items-start gap-2"><CheckCircle2 size={15} className="mt-0.5 shrink-0 text-emerald-500" />{g}</li>)}
              {d.topProduct && <li className="flex items-start gap-2"><CheckCircle2 size={15} className="mt-0.5 shrink-0 text-emerald-500" />Eng ko'p sotilgan marka — <b>{d.topProduct.c}</b> ({moneyShort(d.topProduct.v)} so'm).</li>}
            </ul>
          )}
          <div className="mt-4 border-t border-slate-100 pt-3">
            <Insight title="QISQACHA">Oy boshidan {moneyShort(d.month.revenue)} so'm sotildi — o'tgan oyning {d.month.prev > 0 ? fmtNum((d.month.revenue / d.month.prev) * 100, 0) : "—"}%i. Hozirgi temp bilan oy oxirida {moneyShort(d.month.forecast)} so'm bo'ladi. {d.kpis.lost} ta mijoz xaridni to'xtatgan ({fmtNum(100 - d.kpis.activeRate, 0)}% baza). {d.materialsAtRisk} ta xomashyo xavf zonasida.</Insight>
          </div>
          <div className="mt-3"><Action href={tabHref(range, "forecast")}>Bashorat va anomaliyalarni ko'rish</Action></div>
        </Panel>
      </div>
      <div className="flex items-center gap-2 text-xs text-slate-400"><Truck size={13} /> Taqqoslash davri: {range.prevLabel}. Bugungi va oylik kartalar davr filtridan mustaqil.</div>
    </div>
  );
}
