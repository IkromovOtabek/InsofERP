import Link from "next/link";
import { Undo2, Percent, Wallet, Hash, Receipt, Users, CalendarX } from "lucide-react";
import { biContext, BiPage } from "../../shell";
import { returnsTab } from "@/lib/bi/returns";
import { type Gran, autoGran } from "@/lib/bi/core";
import { money, moneyShort, fmtNum, qty, dateTime } from "@/lib/format";
import { Table, Th, Td, Tr, Empty, Select } from "@/components/ui";
import { BarChart, DonutChart, HBarList } from "@/components/ui/charts";
import { Kpi, Panel, Why, Insight, Action, Note, Pager, Chip, ExportLink, ROUTES, tabHref } from "../../ui";

export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { sp, range } = await biContext(searchParams);
  const gran: Gran = sp.gran === "day" || sp.gran === "week" || sp.gran === "month" ? sp.gran : autoGran(range.days);
  const page = Math.max(1, Number(sp.page) || 1), size = [25, 50, 100].includes(Number(sp.size)) ? Number(sp.size) : 25;
  const d = await returnsTab(range, gran, { product: sp.product, reason: sp.reason, seller: sp.seller, page, size });
  const k = d.kpis;
  const keep = { gran: sp.gran, product: sp.product, reason: sp.reason, seller: sp.seller };
  const href = (extra: Record<string, string>) => tabHref(range, "returns", { ...Object.fromEntries(Object.entries(keep).filter((kv): kv is [string, string] => !!kv[1])), ...extra });
  const labelEvery = Math.max(1, Math.ceil(d.dyn.length / 12));

  return (
    <BiPage title="Sotuvlar / Bekor qilingan zayavkalar" subtitle="Beton qaytarilmaydi — yo'qotish bekor qilingan zayavkalarda. Qancha tushum va foyda yo'qoldi, qaysi marka, qaysi sabab, qaysi sotuvchi va mijoz." tab="returns" range={range} keep={keep}>
      <div className="space-y-6">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <Kpi label="Bekor qilingan summa" value={moneyShort(k.total.cur)} delta={k.total.delta} invert icon={Undo2} tone={k.total.cur ? "danger" : "success"} hint={`${qty(k.volume)} m³ · ${k.lines} satr`} />
          <Kpi label="Bekor qilish ulushi" value={`${fmtNum(k.rate.cur, 2)}%`} delta={k.rateDelta} deltaLabel="p.p." invert icon={Percent} tone={k.rate.cur > 5 ? "danger" : k.rate.cur > 2 ? "warning" : "success"} hint="bekor / (bekor + sotuv)" />
          <Kpi label="Yo'qotilgan foyda" value={moneyShort(k.lostMargin.cur)} delta={k.lostMargin.delta} invert icon={Wallet} tone="warning" hint={k.total.cur ? `summaning ${fmtNum((k.lostMargin.cur / k.total.cur) * 100, 0)}%i (marja)` : "—"} />
          <Kpi label="Bekor qilish soni" value={String(k.count.cur)} delta={k.count.delta} invert icon={Hash} hint={`${k.lines} mahsulot satri`} />
          <Kpi label="O'rtacha bekor" value={moneyShort(k.avg.cur)} delta={k.avg.delta} invert icon={Receipt} hint="bitta zayavkaga" />
          <Kpi label="Bekor qilgan mijozlar" value={String(k.customers)} icon={Users} tone="violet" hint={`${k.products} ta marka bo'yicha`} />
        </div>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
          <Panel className="xl:col-span-2" title="Bekor qilish dinamikasi" info="Ustunlar — bekor qilingan summa; pastda — soni." action={<div className="flex gap-1">{(["day", "week", "month"] as const).map((g) => <Chip key={g} active={gran === g} href={href({ gran: g })}>{{ day: "Kunlik", week: "Haftalik", month: "Oylik" }[g]}</Chip>)}</div>}>
            {d.dyn.some((x) => x.value > 0) ? <BarChart data={d.dyn.map((x) => ({ label: x.label, value: x.value }))} tone="danger" formatValue={(v) => `${moneyShort(v)} so'm`} labelEvery={labelEvery} height={180} /> : <Note>Bu davrda bekor qilingan zayavka yo'q.</Note>}
            <div className="mt-3 border-t border-slate-100 pt-3"><div className="mb-1 text-xs font-medium text-slate-500">Soni</div><BarChart data={d.dynCount.map((x) => ({ label: x.label, value: x.value }))} tone="slate" formatValue={(v) => `${v} ta`} labelEvery={labelEvery} height={70} /></div>
          </Panel>
          <Panel title="Kun kesimi" info="Eng og'ir kun, o'rtacha kunlik va bekor qilish bo'lgan kunlar.">
            <div className="space-y-3 text-[13px]">
              <div className="rounded-lg border-l-4 border-red-400 bg-red-50/60 p-3"><div className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-red-700"><CalendarX size={12} /> Eng og'ir kun</div><div className="mt-0.5 font-semibold">{d.worst && d.worst.value > 0 ? `${d.worst.label} — ${moneyShort(d.worst.value)} so'm` : "—"}</div></div>
              <div className="rounded-lg bg-slate-50 p-3"><div className="text-[10.5px] font-semibold uppercase tracking-wider text-slate-400">O'rtacha kunlik</div><div className="mt-0.5 text-lg font-semibold tabular">{moneyShort(d.avgDaily)}</div></div>
              <div className="rounded-lg bg-slate-50 p-3"><div className="text-[10.5px] font-semibold uppercase tracking-wider text-slate-400">Bekor bo'lgan kunlar</div><div className="mt-0.5 text-lg font-semibold tabular">{d.daysWith} / {range.days}</div></div>
            </div>
          </Panel>
        </div>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
          <Panel title="Marka bo'yicha" info="Bekor qilingan summa ulushi — beton markasi kesimida.">
            {d.byProduct.length ? <DonutChart data={d.byProduct.slice(0, 8).map((p) => ({ label: p.name.split(" — ")[0], value: p.value }))} formatValue={(v) => `${moneyShort(v)} so'm`} center={{ value: String(d.byProduct.length), label: "marka" }} /> : <Note>Ma'lumot yo'q.</Note>}
          </Panel>
          <Panel title="Bekor qilish sabablari" info="Zayavka izohi (note) — bekor qilishda sabab yoziladi. «Ko'rsatilmagan» — izohsiz.">
            {d.byReason.length ? <HBarList data={d.byReason.slice(0, 8).map((x) => ({ label: x.name, value: x.value, hint: `${x.count} ta · ${fmtNum(x.share, 0)}%`, tone: x.name === "Ko'rsatilmagan" ? ("slate" as const) : ("danger" as const) }))} formatValue={moneyShort} /> : <Note>Ma'lumot yo'q.</Note>}
            {d.byReason.find((x) => x.name === "Ko'rsatilmagan") && <Why>Sababsiz bekor qilishlar ulushi katta bo'lsa, bekor qilishda izohni majburiy qiling — sifat, narx, muddat va logistika alohida hal qilinadi.</Why>}
          </Panel>
          <Panel title="Sotuvchi bo'yicha" info="Kim kiritgan zayavkalar ko'proq bekor bo'ladi.">
            {d.bySeller.length ? <HBarList data={d.bySeller.slice(0, 8).map((x) => ({ label: x.name, value: x.value, hint: `${x.count} ta · ${x.customers} mijoz` }))} formatValue={moneyShort} /> : <Note>Ma'lumot yo'q.</Note>}
          </Panel>
        </div>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <Panel title="Eng ko'p bekor qilingan markalar" padded={false}>
            <Table className="rounded-none border-0 shadow-none">
              <thead><tr><Th>#</Th><Th>Marka</Th><Th right>Summa</Th><Th right>Hajm</Th><Th right>Soni</Th><Th right>Ulush</Th></tr></thead>
              <tbody>{d.byProduct.length === 0 && <Empty text="Ma'lumot yo'q" />}{d.byProduct.slice(0, 10).map((p, i) => <Tr key={p.key}><Td className="text-slate-400">{i + 1}</Td><Td>{p.name}</Td><Td right>{moneyShort(p.value)}</Td><Td right>{qty(p.qty)} {p.unit}</Td><Td right>{p.count}</Td><Td right>{fmtNum(p.share, 1)}%</Td></Tr>)}</tbody>
            </Table>
          </Panel>
          <Panel title="Eng ko'p bekor qiladigan mijozlar" padded={false}>
            <Table className="rounded-none border-0 shadow-none">
              <thead><tr><Th>#</Th><Th>Mijoz</Th><Th right>Summa</Th><Th right>Hajm</Th><Th right>Soni</Th></tr></thead>
              <tbody>{d.byCustomer.length === 0 && <Empty text="Ma'lumot yo'q" />}{d.byCustomer.slice(0, 10).map((c, i) => <Tr key={c.key}><Td className="text-slate-400">{i + 1}</Td><Td><Link href={`/customers/${c.key}`} className="hover:underline">{c.name}</Link></Td><Td right>{moneyShort(c.value)}</Td><Td right>{qty(c.qty)} {c.unit}</Td><Td right>{c.count}</Td></Tr>)}</tbody>
            </Table>
          </Panel>
        </div>

        <Panel title="Batafsil bekor qilishlar" info="Bekor qilingan zayavka pozitsiyalari — davr bo'yicha." padded={false} action={<><span>{d.list.total} satr</span><ExportLink type="returns" range={range} /></>}>
          <form method="get" action={ROUTES.returns} className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-3 text-[13px]">
            {range.period === "custom" ? <><input type="hidden" name="from" value={range.from.toISOString().slice(0, 10)} /><input type="hidden" name="to" value={new Date(range.to.getTime() - 1).toISOString().slice(0, 10)} /></> : <input type="hidden" name="period" value={range.period} />}
            <Select name="product" defaultValue={sp.product ?? ""} className="h-8 w-52"><option value="">Barcha markalar</option>{d.productOptions.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>
            <Select name="reason" defaultValue={sp.reason ?? ""} className="h-8 w-48"><option value="">Barcha sabablar</option>{d.reasonOptions.map((x) => <option key={x} value={x}>{x}</option>)}</Select>
            <Select name="seller" defaultValue={sp.seller ?? ""} className="h-8 w-44"><option value="">Barcha sotuvchilar</option>{d.sellerOptions.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select>
            <Select name="size" defaultValue={String(size)} className="h-8 w-20"><option value="25">25</option><option value="50">50</option><option value="100">100</option></Select>
            <button className="h-8 rounded-lg bg-slate-900 px-3 text-xs font-medium text-white">Qo'llash</button>
            {(sp.product || sp.reason || sp.seller) && <Link href={tabHref(range, "returns")} className="text-xs text-slate-500 hover:underline">Tozalash</Link>}
          </form>
          <Table className="rounded-none border-0 shadow-none">
            <thead><tr><Th>Sana</Th><Th>Zayavka</Th><Th>Marka</Th><Th right>Miqdor</Th><Th right>Narx</Th><Th right>Summa</Th><Th>Sotuvchi</Th><Th>Mijoz</Th><Th>Sabab</Th></tr></thead>
            <tbody>
              {d.list.rows.length === 0 && <Empty text="Bekor qilingan zayavka topilmadi" />}
              {d.list.rows.map((x, i) => <Tr key={`${x.orderId}-${x.productId}-${i}`}><Td className="whitespace-nowrap text-slate-500">{dateTime(x.date)}</Td><Td><Link href={`/orders/${x.orderId}`} className="hover:underline">{x.orderNo}</Link></Td><Td>{x.code}</Td><Td right>{qty(x.qty)} {x.unit}</Td><Td right>{moneyShort(x.price)}</Td><Td right className="font-medium">{moneyShort(x.revenue)}</Td><Td className="text-xs">{x.seller}</Td><Td className="text-xs">{x.customer}</Td><Td className="text-xs text-slate-500">{x.reason}</Td></Tr>)}
            </tbody>
          </Table>
          <Pager total={d.list.total} page={d.list.page} size={d.list.size} href={(p) => href({ page: String(p), size: String(size) })} />
        </Panel>

        <Insight tone={k.total.cur ? "danger" : "success"}>{k.total.cur ? `Davrda ${money(k.total.cur)} lik zayavka bekor qilindi (${k.count.cur} ta) — yo'qotilgan foyda ${money(k.lostMargin.cur)}. Eng ko'p bekor bo'lgan marka — ${d.byProduct[0]?.name ?? "—"}${d.byReason[0] ? `, eng ko'p sabab — «${d.byReason[0].name}»` : ""}.` : "Davrda bekor qilingan zayavka yo'q."}</Insight>
        <div><Action href="/orders?status=CANCELLED">Bekor qilingan zayavkalar ro'yxatini ochish</Action></div>
      </div>
    </BiPage>
  );
}
