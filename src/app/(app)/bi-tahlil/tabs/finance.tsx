import Link from "next/link";
import { TrendingUp, Wallet, Landmark, Percent, FileWarning, Users, ShoppingCart, PiggyBank } from "lucide-react";
import { financeTab } from "@/lib/bi/finance";
import { type Range, type Gran, autoGran } from "@/lib/bi/core";
import { money, moneyShort, fmtNum, dateTime } from "@/lib/format";
import { Table, Th, Td, Tr, Empty, Select } from "@/components/ui";
import { BarChart, DonutChart, HBarList, LineChart, Waterfall } from "@/components/ui/charts";
import { Kpi, Delta, Panel, Why, Insight, Action, Note, Tag, Pager, ExportLink, Chip, tabHref } from "../ui";
import { ROUTES } from "../ui";
import type { SP } from "../page";
import { cn } from "@/lib/utils";

export async function FinanceTab({ range, sp }: { range: Range; sp: SP }) {
  const gran: Gran = sp.gran === "day" || sp.gran === "week" || sp.gran === "month" ? sp.gran : autoGran(range.days);
  const page = Math.max(1, Number(sp.page) || 1), size = [25, 50, 100].includes(Number(sp.size)) ? Number(sp.size) : 25;
  const d = await financeTab(range, gran, page, size, sp.account);
  const k = d.kpis, L = d.loss, cf = d.cashForecast;
  const share = (v: number) => (L.totalPerDay > 0 ? (v / L.totalPerDay) * 100 : 0);

  return (
    <div className="space-y-6">
      {/* Bugun qancha pul yo'qotyapman */}
      <Panel title="Bugun qancha pul yo'qotyapman?" eyebrow="Moliyaviy nazorat · pul qayerdan oqyapti va kassada nima bo'ladi" info="Yo'qotish kanallari: stockout, debitorka, bloklangan, dead stock, bekor qilingan, chegirma, brak. OQIM — har kuni ketayotgan; ZAXIRA — muzlagan pulning kapital narxi.">
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
          <div className="lg:col-span-1">
            <div className="text-[32px] font-bold leading-none tracking-tight text-red-600 tabular">{moneyShort(L.totalPerDay)} <span className="text-base font-medium text-slate-500">so'm/kun</span></div>
            <div className="mt-1.5 text-[13px] text-slate-600">Oyiga ekvivalenti: <b>{moneyShort(L.totalPerDay * 30)} so'm</b></div>
            <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-lg bg-slate-50 p-2.5"><div className="text-slate-400">Oqim yo'qotishi</div><div className="text-base font-semibold tabular">{moneyShort(L.channels.filter((c) => c.flow === "OQIM").reduce((s, c) => s + c.perDay, 0))}<span className="ml-1 text-[10px] font-normal text-slate-400">so'm/kun</span></div></div>
              <div className="rounded-lg bg-slate-50 p-2.5"><div className="text-slate-400">Muzlagan pul</div><div className="text-base font-semibold tabular">{moneyShort(L.frozen)}<span className="ml-1 text-[10px] font-normal text-slate-400">qoldiq</span></div></div>
              <div className="rounded-lg bg-slate-50 p-2.5"><div className="text-slate-400">Eng katta teshik</div><div className="text-base font-semibold">{L.biggest.title}</div><div className="text-[10px] text-slate-400">{fmtNum(share(L.biggest.perDay), 0)}% yo'qotishning</div></div>
              <div className="rounded-lg bg-slate-50 p-2.5"><div className="text-slate-400">Davr yo'qotishi</div><div className="text-base font-semibold tabular">{moneyShort(L.channels.reduce((s, c) => s + c.periodTotal, 0))}</div><div className="text-[10px] text-slate-400">{range.days} kun</div></div>
            </div>
          </div>
          <div className="lg:col-span-2">
            <HBarList data={L.channels.map((c) => ({ label: c.title, value: c.perDay, hint: `${fmtNum(share(c.perDay), 1)}%`, tone: "danger" as const }))} formatValue={(v) => `${moneyShort(v)}/kun`} />
            <div className="mt-3"><Insight>Bugungi holatda kuniga taxminan {money(Math.round(L.totalPerDay))} yo'qotilmoqda (oyiga ≈ {moneyShort(L.totalPerDay * 30)} so'm). Eng katta teshik — {L.biggest.title} ({fmtNum(share(L.biggest.perDay), 1)}%, kuniga {moneyShort(L.biggest.perDay)} so'm). Bundan tashqari {moneyShort(L.frozen)} so'm aylanmadan chiqib, qarz va zaxirada muzlab turibdi.</Insight></div>
          </div>
        </div>
      </Panel>

      {/* Kanallar */}
      <div>
        <div className="mb-3 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-slate-400">Yo'qotishlar · kanal bo'yicha · kattadan kichikka</div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {L.channels.map((c, i) => (
            <div key={c.key} className="rounded-(--radius-card) border border-slate-200/80 bg-white p-4 shadow-(--shadow-card)">
              <div className="flex items-start justify-between gap-2"><div><div className="text-[11px] font-semibold text-slate-400">#{i + 1}</div><div className="font-semibold">{c.title}</div><div className="text-xs text-slate-500">{c.sub}</div></div><div className="flex gap-1"><Tag>{c.kind}</Tag><Tag>{c.flow}</Tag></div></div>
              <div className="mt-2 text-xl font-bold tabular text-red-600">{moneyShort(c.perDay)} <span className="text-xs font-normal text-slate-400">so'm/kun</span></div>
              <div className="text-xs text-slate-500">{c.frozen !== undefined && `Muzlagan qoldiq: ${moneyShort(c.frozen)} so'm · `}Davrda jami: {moneyShort(c.periodTotal)} so'm</div>
              <div className="mt-2 text-[12.5px] font-medium text-slate-800">{c.count}</div>
              <p className="mt-1 text-xs leading-relaxed text-slate-600">{c.text}</p>
              <div className="mt-2.5"><Action href={c.href}>{c.action}</Action></div>
            </div>
          ))}
        </div>
      </div>

      {/* Cash forecast */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Panel title="Cash Forecast — 7 kun" info="Boshlang'ich — barcha kassa/hisoblarga kelib tushgan to'lovlar jami (tizimda xarajat moduli yo'q). Kutilayotgan tushum — so'nggi 30 kun kunlik o'rtacha, ochiq debitorka bilan cheklangan. Yomon/yaxshi stsenariy — ±1σ.">
          <div className="grid grid-cols-2 gap-3 text-[13px] md:grid-cols-4">
            <div><div className="text-xs text-slate-400">7 kundan keyin</div><div className="text-lg font-bold tabular text-emerald-600">{moneyShort(cf.after7)}</div></div>
            <div><div className="text-xs text-slate-400">Yomon stsenariy</div><div className="text-lg font-bold tabular">{moneyShort(cf.low7)}</div></div>
            <div><div className="text-xs text-slate-400">Kutilayotgan tushum</div><div className="text-lg font-bold tabular">+{moneyShort(cf.expectedIn)}</div></div>
            <div><div className="text-xs text-slate-400">Xavf holati</div><div className={cn("text-lg font-bold", cf.risk === "Yuqori" ? "text-red-600" : cf.risk === "O'rta" ? "text-amber-600" : "text-emerald-600")}>{cf.risk}</div></div>
          </div>
          <div className="mt-3"><LineChart labels={cf.rows.map((r) => r.label)} series={[{ name: "Kutilayotgan", values: cf.rows.map((r) => cf.start + r.base), color: "#0d78ff" }, { name: "Yomon", values: cf.rows.map((r) => cf.start + r.low), color: "#fa1636", dashed: true }, { name: "Yaxshi", values: cf.rows.map((r) => cf.start + r.high), color: "#00cb80", dashed: true }]} formatValue={moneyShort} height={150} area={false} /></div>
          <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900"><b>Agar hech narsa qilmasangiz:</b> kunlik o'rtacha tushum {moneyShort(cf.perDay)} so'm (σ = {moneyShort(cf.sigma)}). Ochiq debitorka {moneyShort(cf.receivable)} so'm — shu tempda {cf.coverDays === null ? "—" : `${fmtNum(cf.coverDays, 0)} kunda`} undiriladi. {cf.risk === "Yuqori" ? "Tushum juda notekis — yirik chiqimni kutilayotgan to'lov kelgandan keyin rejalashtiring." : "Zaxira barqaror."}</div>
          <Why label="Prognoz qanday hisoblangan (3 ta taxmin)"><p>1. Kelajak tushum — so'nggi 30 kun o'rtachasi bilan bir xil.</p><p>2. Tushum ochiq debitorkadan oshmaydi.</p><p>3. Tarqoqlik (σ) tarixiy kunlik tushumlardan olingan.</p></Why>
        </Panel>
        <Panel title="P&L Waterfall" info="Bazaviy tushumdan foydagacha. Tannarx — retsept × xomashyo o'rtacha kirim narxi. * Ish haqi, energiya, transport xarajatlari tizimda yo'q — bu yalpi foyda darajasi.">
          <Waterfall steps={d.waterfall} formatValue={moneyShort} />
          <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs"><div className="rounded-lg bg-slate-50 py-2"><div className="text-slate-400">Gross margin</div><div className="text-base font-semibold tabular">{fmtNum(k.margin, 1)}%</div></div><div className="rounded-lg bg-slate-50 py-2"><div className="text-slate-400">Chegirma</div><div className="text-base font-semibold tabular text-amber-600">{moneyShort(k.discount)}</div></div><div className="rounded-lg bg-slate-50 py-2"><div className="text-slate-400">Brak</div><div className="text-base font-semibold tabular text-red-600">{moneyShort(k.writeOff)}</div></div></div>
        </Panel>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        <Kpi label="Jami sotuv tushumi" value={moneyShort(k.revenue.cur)} delta={k.revenue.delta} icon={TrendingUp} tone="brand" />
        <Kpi label="Yalpi foyda" value={moneyShort(k.gross.cur)} delta={k.gross.delta} icon={Wallet} tone={k.gross.cur >= 0 ? "success" : "danger"} hint={`Marja ${fmtNum(k.margin, 1)}%`} />
        <Kpi label="Foyda*" value={moneyShort(k.profit)} icon={PiggyBank} tone={k.profit >= 0 ? "success" : "danger"} hint="brakdan keyin" />
        <Kpi label="Kassa tushumi" value={moneyShort(k.cashIn.cur)} delta={k.cashIn.delta} icon={Landmark} tone="success" />
        <Kpi label="Xomashyo xaridi" value={moneyShort(k.purchases.cur)} delta={k.purchases.delta} invert icon={ShoppingCart} tone="info" />
        <Kpi label="Debitorka" value={moneyShort(k.receivable)} icon={FileWarning} tone={k.receivable ? "warning" : "default"} hint={`${k.debtors} qarzdor`} href={tabHref(range, "customers", { debt: "yes" })} />
        <Kpi label="Kassalardagi pul" value={moneyShort(k.cashTotal)} icon={Percent} hint="tushumlar jami" />
        <Kpi label="Faol mijozlar" value={`${k.activeCustomers} / ${k.totalCustomers}`} icon={Users} tone="violet" hint={`Faollik ${fmtNum(d.activeRate, 0)}%`} />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Panel title="Xarajat tuzilmasi" info="Davr ichidagi xomashyo xaridlari yetkazuvchi bo'yicha + brak. Boshqa xarajat turlari tizimda yuritilmaydi.">
          {d.expenses.length ? <DonutChart data={d.expenses.slice(0, 8)} formatValue={moneyShort} center={{ value: moneyShort(d.expenseTotal), label: "jami" }} /> : <Note>Davrda xarid yo'q.</Note>}
        </Panel>
        <Panel className="xl:col-span-2" title="CashFlow trendi" info="Kassa/bank tushumlari va kumulyativ." action={<div className="flex gap-1">{(["day", "week", "month"] as const).map((g) => <Chip key={g} active={gran === g} href={tabHref(range, "finance", { gran: g })}>{{ day: "Kunlik", week: "Haftalik", month: "Oylik" }[g]}</Chip>)}</div>}>
          <BarChart data={d.flow.map((f) => ({ label: f.label, value: f.value }))} tone="success" formatValue={moneyShort} labelEvery={Math.max(1, Math.ceil(d.flow.length / 12))} height={120} />
          <div className="mt-3"><LineChart labels={d.flow.map((f) => f.label)} series={[{ name: "Kumulyativ tushum", values: d.cumulative, color: "#0d78ff" }]} formatValue={moneyShort} labelEvery={Math.max(1, Math.ceil(d.flow.length / 12))} height={110} /></div>
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Panel title="Daromad vs Xarajat — 6 oy" info="Sotuv tushumi, xomashyo xaridi va kassa tushumi oylar bo'yicha.">
          <LineChart labels={d.months.labels} series={[{ name: "Sotuv", values: d.months.revenue, color: "#ffa800" }, { name: "Xarid", values: d.months.purchases, color: "#fa1636" }, { name: "Kassa", values: d.months.cash, color: "#00cb80" }]} formatValue={moneyShort} height={160} area={false} />
        </Panel>
        <Panel title="AKB dinamikasi — 6 oy" info="Oyda kamida bitta zayavka bergan mijozlar soni.">
          <BarChart data={d.months.labels.map((l, i) => ({ label: l, value: d.months.active[i] }))} tone="violet" formatValue={(v) => `${v} ta`} height={160} />
        </Panel>
        <Panel title="Debitorka aging" info="Ochiq schyotlar yoshi.">
          <HBarList data={["0–30", "31–60", "61–90", "90+"].map((l, i) => ({ label: `${l} kun`, value: d.aging[i], tone: (["success", "info", "warning", "danger"] as const)[i] }))} formatValue={moneyShort} />
          <div className="mt-3 flex items-center justify-between text-xs text-slate-500"><span>Jami</span><b className="text-slate-800">{money(d.aging.reduce((a, b) => a + b, 0))}</b></div>
          <div className="mt-2"><Action href={tabHref(range, "customers", { debt: "yes" })}>Qarzdorlar ro'yxati</Action></div>
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Panel title="Kassa balanslari" info="Har kassa/hisob bo'yicha: davr tushumi va jami tushumlar." padded={false}>
          <Table className="rounded-none border-0 shadow-none"><thead><tr><Th>Kassa / hisob</Th><Th right>Davr</Th><Th right>Jami</Th></tr></thead><tbody>{d.accountRows.length === 0 && <Empty text="Kassa yo'q" />}{d.accountRows.map((a) => <Tr key={a.id}><Td>{a.name} <span className="text-xs text-slate-400">{a.type === "CASH" ? "naqd" : "bank"}</span></Td><Td right>{moneyShort(a.period)}</Td><Td right className="font-semibold">{moneyShort(a.total)}</Td></Tr>)}</tbody></Table>
        </Panel>
        <Panel title="Top 10 to'lov" info="Davr ichidagi eng katta tranzaksiyalar." padded={false}>
          <Table className="rounded-none border-0 shadow-none"><thead><tr><Th>Sana</Th><Th>Mijoz</Th><Th right>Summa</Th></tr></thead><tbody>{d.topPayments.length === 0 && <Empty text="To'lov yo'q" />}{d.topPayments.map((p) => <Tr key={p.id}><Td className="whitespace-nowrap text-slate-500">{dateTime(p.date)}</Td><Td className="truncate">{p.customer.name}</Td><Td right className="font-semibold">{moneyShort(Number(p.amount))}</Td></Tr>)}</tbody></Table>
        </Panel>
        <Panel title="Moliyaviy ko'rsatkichlar" info="Bu davr vs oldingi davr." padded={false}>
          <Table className="rounded-none border-0 shadow-none"><thead><tr><Th>Ko'rsatkich</Th><Th right>Bu davr</Th><Th right>O'tgan davr</Th><Th right>Δ</Th></tr></thead><tbody>{d.indicators.map((x) => <Tr key={x.label}><Td>{x.label}</Td><Td right>{x.unit === "so'm" ? moneyShort(x.cur) : x.unit === "%" ? `${fmtNum(x.cur, 1)}%` : fmtNum(x.cur, x.unit === "m³" ? 1 : 0)}</Td><Td right className="text-slate-500">{x.unit === "so'm" ? moneyShort(x.prev) : x.unit === "%" ? `${fmtNum(x.prev, 1)}%` : fmtNum(x.prev, x.unit === "m³" ? 1 : 0)}</Td><Td right><Delta value={x.delta} invert={x.label === "Chegirma" || x.label === "Xomashyo xaridi"} /></Td></Tr>)}</tbody></Table>
        </Panel>
      </div>

      <Panel title="Tranzaksiyalar" info="Kassa/bank tushumlari — davr bo'yicha." padded={false} action={<ExportLink type="payments" range={range} />}>
        <form method="get" action={ROUTES.finance} className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-3 text-[13px]">
          <input type="hidden" name="period" value={range.period === "custom" ? "month" : range.period} />
          <Select name="account" defaultValue={sp.account ?? ""} className="h-8 w-52"><option value="">Barcha kassa</option>{d.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select>
          <Select name="size" defaultValue={String(size)} className="h-8 w-20"><option value="25">25</option><option value="50">50</option><option value="100">100</option></Select>
          <button className="h-8 rounded-lg bg-slate-900 px-3 text-xs font-medium text-white">Qo'llash</button>
        </form>
        <Table className="rounded-none border-0 shadow-none"><thead><tr><Th>Sana</Th><Th>Mijoz</Th><Th>Kassa / hisob</Th><Th>Schyot</Th><Th right>Summa</Th><Th>Izoh</Th></tr></thead><tbody>{d.list.rows.length === 0 && <Empty text="Tranzaksiya yo'q" />}{d.list.rows.map((p) => <Tr key={p.id}><Td className="whitespace-nowrap text-slate-500">{dateTime(p.date)}</Td><Td><Link href={`/customers/${p.customerId}`} className="hover:underline">{p.customer.name}</Link></Td><Td>{p.cashAccount.name}</Td><Td>{p.invoice?.invoiceNo ?? "—"}</Td><Td right className="font-semibold">{money(Number(p.amount))}</Td><Td className="text-xs text-slate-500">{p.note ?? ""}</Td></Tr>)}</tbody></Table>
        <Pager total={d.list.total} page={d.list.page} size={d.list.size} href={(p) => tabHref(range, "finance", { page: String(p), size: String(size), ...(sp.account ? { account: sp.account } : {}) })} />
      </Panel>
    </div>
  );
}
