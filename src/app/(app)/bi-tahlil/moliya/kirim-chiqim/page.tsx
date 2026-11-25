import Link from "next/link";
import { ArrowDownCircle, ArrowUpCircle, Banknote, Scale } from "lucide-react";
import { requirePage } from "@/lib/page-guard";
import { db } from "@/lib/db";
import { addDays, delta, rangeQuery } from "@/lib/bi/core";
import { kirimChiqim, SALES_LINE, type KcParty } from "@/lib/fin-report/kirim-chiqim";
import { monthLabel } from "@/lib/fin-report/period";
import { fmtJami, isoDate, moneyShort, pct } from "@/lib/format";
import { Empty, Table, Td, Th, Tr } from "@/components/ui";
import { DateRangeBar } from "@/components/date-range-bar";
import { biContext, BiPage, type SP } from "../../shell";
import { Kpi, Panel } from "../../ui";
import { GroupTable } from "./group-table";

export const dynamic = "force-dynamic";

const BASE = "/bi-tahlil/moliya/kirim-chiqim";
const METHOD_LABEL = { CASH: "Naqd", BANK: "Bank (perechisleniye)" } as const;

function Parties({ title, rows, total, tone }: { title: string; rows: KcParty[]; total: number; tone: "in" | "out" }) {
  return (
    <Panel title={title} padded={false} info="Kontragent — mijoz, yetkazuvchi, xodim, brigada yoki kassa yozuvidagi «kimdan / kimga». Kontragentsiz yozuvlar bu ro'yxatga kirmaydi.">
      {rows.length ? (
        <Table className="rounded-none border-0 shadow-none">
          <thead><tr><Th>#</Th><Th>Kontragent</Th><Th right>Summa</Th><Th right>Ulush</Th><Th right>Yozuv</Th></tr></thead>
          <tbody>
            {rows.map((p, i) => (
              <Tr key={p.name}>
                <Td className="text-slate-400">{i + 1}</Td>
                <Td className="font-medium text-slate-800">{p.name}</Td>
                <Td right className={tone === "in" ? "text-emerald-700" : "text-red-700"}>{fmtJami(p.total)}</Td>
                <Td right className="text-slate-500">{total > 0 ? pct((p.total / total) * 100) : "–"}</Td>
                <Td right className="text-slate-400">{p.count}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      ) : <div className="p-4"><Empty text="Davrda kontragentli yozuv yo'q" /></div>}
    </Panel>
  );
}

export default async function Page({ searchParams }: { searchParams: Promise<SP> }) {
  await requirePage(BASE);
  const { sp, range } = await biContext(searchParams, BASE);
  const method = sp.method === "CASH" || sp.method === "BANK" ? sp.method : undefined;
  const accounts = await db.cashAccount.findMany({ where: { isActive: true }, select: { id: true, name: true, type: true }, orderBy: [{ type: "asc" }, { name: "asc" }] });
  const accountId = accounts.some((a) => a.id === sp.account) ? sp.account : undefined;

  const d = await kirimChiqim({ from: range.from, to: range.to, prevFrom: range.prevFrom, prevTo: range.prevTo, accountId, method });
  const net = d.totals.inn - d.totals.out, prevNet = d.totals.prevIn - d.totals.prevOut;
  const close = d.accounts.reduce((s, a) => s + a.close, 0), open = d.accounts.reduce((s, a) => s + a.open, 0);
  const keep = { account: accountId, method };
  const lastDay = addDays(range.to, -1);

  // Manba → Kirim-Chiqim jurnali (shu davr, hisob, to'lov usuli bilan). Mijoz to'lovlari jurnalda boshqa nom bilan — faqat «Kirim» tabi
  const jurnal = (tab: "INCOME" | "EXPENSE", category?: string) => `/cashflow?${new URLSearchParams({
    tab, from: isoDate(range.from), to: isoDate(lastDay), ...(accountId ? { account: accountId } : {}), ...(method ? { method } : {}), ...(category ? { category } : {}),
  })}`;
  const hrefIn = Object.fromEntries(d.income.map((g) => [g.name, jurnal("INCOME", g.name === SALES_LINE ? undefined : g.name)]));
  const hrefOut = Object.fromEntries(d.expense.map((g) => [g.name, jurnal("EXPENSE", g.name)]));
  const monthLabels = d.months.map(monthLabel);
  const filterLabel = accountId ? accounts.find((a) => a.id === accountId)!.name : method ? METHOD_LABEL[method] : "Barcha hisoblar";

  return (
    <BiPage title="Kirim-chiqim jamlanmasi" subtitle={`Moliya · ${filterLabel}`} tab="finance" range={range} period={false}
      info="Davrdagi pul kirimi va chiqimi manba va sub manba bo'yicha. Kirimga kassa kirimlari va mijoz to'lovlari («Savdo tushumi») kiradi. Hisoblararo o'tkazma (perekit), boshlang'ich qoldiq va bekor qilingan yozuvlar kirim ham, chiqim ham emas — ular faqat «Hisoblar» jadvalida qoldiqqa ta'sir qiladi.">
      <DateRangeBar base={BASE} from={range.from} to={lastDay} names={{ from: "from", to: "to" }} keep={keep} yearStart className="mb-3"
        label={`${range.label} · taqqoslash: ${range.prevLabel}`} />

      <form action={BASE} className="mb-5 flex flex-wrap items-center gap-2">
        {range.period === "custom" ? <><input type="hidden" name="from" value={isoDate(range.from)} /><input type="hidden" name="to" value={isoDate(lastDay)} /></> : <input type="hidden" name="period" value={range.period} />}
        <select name="account" aria-label="Hisob" defaultValue={accountId ?? ""} className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm">
          <option value="">Barcha hisoblar</option>
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <select name="method" aria-label="To'lov usuli" defaultValue={method ?? ""} className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm">
          <option value="">Naqd va bank</option>
          {(["CASH", "BANK"] as const).map((m) => <option key={m} value={m}>{METHOD_LABEL[m]}</option>)}
        </select>
        <button className="h-9 rounded-lg bg-slate-900 px-3 text-sm font-medium text-white hover:bg-slate-800">Ko&apos;rsatish</button>
        {(accountId || method) && <Link href={`${BASE}?${rangeQuery(range)}`} className="text-sm text-slate-500 hover:text-slate-900">Tozalash</Link>}
      </form>

      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4 [&>*]:min-w-0">
          <Kpi label="Jami kirim" value={moneyShort(d.totals.inn)} icon={ArrowDownCircle} tone="success" delta={delta(d.totals.inn, d.totals.prevIn)} deltaLabel={range.prevLabel} spark={d.trend.inn} href={jurnal("INCOME")} />
          <Kpi label="Jami chiqim" value={moneyShort(d.totals.out)} icon={ArrowUpCircle} tone="danger" delta={delta(d.totals.out, d.totals.prevOut)} invert deltaLabel={range.prevLabel} spark={d.trend.out} href={jurnal("EXPENSE")} />
          <Kpi label="Sof oqim" value={moneyShort(net)} icon={Scale} tone={net >= 0 ? "success" : "danger"} delta={delta(net, prevNet)} deltaLabel={range.prevLabel} hint="kirim − chiqim" />
          <Kpi label="Hisoblar qoldig'i" value={moneyShort(close)} icon={Banknote} tone="brand" delta={delta(close, open)} deltaLabel="davr boshidan" hint={`${isoDate(lastDay).split("-").reverse().join(".")} oxiriga`} />
        </div>

        {d.totals.count === 0 ? <Empty text="Tanlangan davrda kirim ham, chiqim ham yo'q" /> : (
          <div className="grid gap-5 2xl:grid-cols-2">
            <Panel title="Kirim — manba bo'yicha" padded={false} action={<span>{d.income.length} manba · manbani bosing — sub manbalar</span>}>
              <GroupTable groups={d.income} total={d.totals.inn} months={d.months} monthLabels={monthLabels} tone="in" hrefOf={hrefIn} />
            </Panel>
            <Panel title="Chiqim — manba bo'yicha" padded={false} action={<span>{d.expense.length} manba · manbani bosing — sub manbalar</span>}>
              <GroupTable groups={d.expense} total={d.totals.out} months={d.months} monthLabels={monthLabels} tone="out" hrefOf={hrefOut} />
            </Panel>
          </div>
        )}

        <Panel title="Hisoblar bo'yicha" padded={false} info="Boshlang'ich qoldiq — davr boshigacha bo'lgan barcha yozuvlar. «O'tkazma / boshl.» — hisoblararo perekit va boshlang'ich qoldiq yozuvlari (kirim-chiqimga kirmaydi). Yakuniy = boshlang'ich + kirim − chiqim ± o'tkazma.">
          <Table className="rounded-none border-0 shadow-none">
            <thead><tr><Th>Hisob</Th><Th>Turi</Th><Th right>Boshlang&apos;ich</Th><Th right>Kirim</Th><Th right>Chiqim</Th><Th right>O&apos;tkazma / boshl.</Th><Th right>Yakuniy</Th></tr></thead>
            <tbody>
              {d.accounts.map((a) => (
                <Tr key={a.id}>
                  <Td className="font-medium text-slate-800">{a.name}</Td>
                  <Td className="text-slate-500">{METHOD_LABEL[a.type]}</Td>
                  <Td right>{fmtJami(a.open)}</Td>
                  <Td right className="text-emerald-700">{a.inn ? fmtJami(a.inn) : "–"}</Td>
                  <Td right className="text-red-700">{a.out ? fmtJami(a.out) : "–"}</Td>
                  <Td right className="text-slate-500">{a.other ? fmtJami(a.other) : "–"}</Td>
                  <Td right className="font-semibold text-slate-900">{fmtJami(a.close)}</Td>
                </Tr>
              ))}
              <Tr className="border-t-2 border-slate-200 bg-brand-50/60">
                <Td className="font-bold">Jami</Td><Td />
                <Td right className="font-bold">{fmtJami(open)}</Td>
                <Td right className="font-bold text-emerald-700">{fmtJami(d.accounts.reduce((s, a) => s + a.inn, 0))}</Td>
                <Td right className="font-bold text-red-700">{fmtJami(d.accounts.reduce((s, a) => s + a.out, 0))}</Td>
                <Td right className="font-bold text-slate-500">{fmtJami(d.accounts.reduce((s, a) => s + a.other, 0))}</Td>
                <Td right className="font-bold">{fmtJami(close)}</Td>
              </Tr>
            </tbody>
          </Table>
        </Panel>

        <div className="grid gap-5 xl:grid-cols-2">
          <Parties title="Eng ko'p pul kirgan — top 10" rows={d.topIn} total={d.totals.inn} tone="in" />
          <Parties title="Eng ko'p pul ketgan — top 10" rows={d.topOut} total={d.totals.out} tone="out" />
        </div>
        {d.months.length === 0 && d.totals.count > 0 && <p className="text-xs text-slate-500">Oyma-oy ustunlar davr 2–12 oyni qamraganda chiqadi (masalan «Yil boshidan»).</p>}
      </div>
    </BiPage>
  );
}
