import Link from "next/link";
import { ArrowDownLeft, ArrowUpRight, Calculator, Fuel, HandCoins, Landmark, PackageOpen, Route, TrendingDown, TrendingUp } from "lucide-react";
import { driverLedger, driverPaySums, fuelBalances, type LedgerRow } from "@/lib/driver-ledger";
import { logiJournal } from "@/lib/logistics-finance";
import { dispatcherStock } from "@/lib/dispatcher-stock";
import { fmtNum, isoDate, money, moneyShort } from "@/lib/format";
import { Card, CardHeader, Empty, Section, StatCard, Table, Td, Th, Tr } from "@/components/ui";
import type { DayRange } from "@/app/(app)/bi-tahlil/month-bar";

/** Qatorlarni mashina bo'yicha yig'ish: reys, km, kirim, chiqim, foyda. */
function byVehicle(rows: LedgerRow[]) {
  const out = new Map<string, { id: string; plate: string; trips: number; km: number; revenue: number; total: number; profit: number }>();
  for (const r of rows) {
    const v = out.get(r.vehicleId) ?? { id: r.vehicleId, plate: r.plate, trips: 0, km: 0, revenue: 0, total: 0, profit: 0 };
    v.trips += r.trips; v.km += r.km; v.revenue += r.revenue; v.total += r.total; v.profit += r.profit;
    out.set(r.vehicleId, v);
  }
  return [...out.values()].sort((a, b) => b.profit - a.profit || a.plate.localeCompare(b.plate));
}

const Line = ({ label, v, strong }: { label: string; v: number; strong?: boolean }) => (
  <Tr className={strong ? "bg-slate-50 font-semibold" : undefined}><Td>{label}</Td><Td right>{Math.abs(v) >= 1 ? money(v) : <span className="text-slate-300">—</span>}</Td></Tr>
);

/**
 * Logistika moliya → «Umumiy»: logistikaning hamma muhim raqami bitta joyda — bajarilgan ish (kirim: dostavka, usluga, obyekt),
 * tannarx (chiqim), foyda, logistika kassasi qoldig'i va davrdagi pul harakati, to'lanishi kerak so'rovlar, reys/km/yoqilg'i,
 * mashinalar va haydovchilar kesimi, dispetcher omboridagi mol. Kirim/chiqim/foyda — Hisob varag'i bilan bitta manba (`driverLedger`).
 */
export async function LogiOverview({ period, accounts, toPay }: {
  period: DayRange; accounts: { id: string; name: string; balance: number }[]; toPay: { amount: unknown }[];
}) {
  const [led, j, disp] = await Promise.all([driverLedger(period.from, period.to), logiJournal(period.from, period.to), dispatcherStock()]);
  const t = led.total;
  const kassa = accounts.reduce((a, x) => a + x.balance, 0);
  const due = toPay.reduce((a, r) => a + Number(r.amount), 0);
  const unpriced = led.rows.filter((r) => r.kind === "trip" && r.amount == null && r.pay > 0);
  const vehicles = byVehicle(led.rows);
  const fuel = new Map(fuelBalances(led.rows).map((b) => [b.vehicleId, b]));
  const pays = driverPaySums(led.rows);
  const held = disp.rows.filter((r) => r.held > 0.0005);
  const heldSum = held.reduce((a, r) => a + r.held * (r.price ?? 0), 0);
  const delivery = t.revBank + t.revCash + t.revDebt, service = t.svcBank + t.svcCash;
  const range = `dan=${isoDate(period.from)}&gacha=${isoDate(new Date(period.to.getTime() - 1))}`;
  const hisob = (extra = "") => `/logistika/tabel?bolim=hisob&${range}${extra}`;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4 [&>*]:min-w-0">
        <StatCard label="Kirim (bajarilgan ish)" value={moneyShort(t.revenue)} hint={`dostavka ${moneyShort(delivery)} · usluga ${moneyShort(service)} · obyekt ${moneyShort(t.revOther)}`} icon={TrendingUp} tone="success" href={hisob()} />
        <StatCard label="Chiqim (tannarx)" value={moneyShort(t.total)} hint={`yoqilg'i ${moneyShort(t.fuelSum)} · haq ${moneyShort(t.pay)} · ta'mir ${moneyShort(t.repair + t.parts + t.vulc)}`} icon={TrendingDown} tone="warning" href={hisob()} />
        <StatCard label="Foyda" value={moneyShort(t.profit)} hint={t.revenue > 0 ? `rentabellik ${fmtNum((t.profit / t.revenue) * 100, 1)}%` : period.label} icon={Calculator} tone={t.profit < 0 ? "danger" : "info"} href="/logistika/moliya?tab=foyda" />
        <StatCard label="Logistika kassasi — qoldiq" value={moneyShort(kassa)} hint="hozirgi · zavod kassasiga kirmaydi" icon={Landmark} tone={kassa < 0 ? "danger" : "brand"} href="/logistika/moliya?tab=jurnal" />
        <StatCard label="Pul kirimi" value={moneyShort(j.totals.income)} hint={j.totals.transferIn ? `shundan zavoddan o'tkazma ${moneyShort(j.totals.transferIn)}` : period.label} icon={ArrowDownLeft} tone="success" href="/logistika/moliya?tab=jurnal" />
        <StatCard label="Pul chiqimi" value={moneyShort(j.totals.expense)} hint={`zavod hisobidan ${moneyShort(j.totals.expenseFactory)} · logistikadan ${moneyShort(j.totals.expenseLogi)}`} icon={ArrowUpRight} href="/logistika/moliya?tab=jurnal" />
        <StatCard label="To'lanishi kerak" value={moneyShort(due)} hint={`${toPay.length} ta tasdiqlangan so'rov`} icon={HandCoins} tone={toPay.length ? "warning" : "default"} href="/logistika/moliya?tab=tolov" />
        <StatCard label="Reys va probeg" value={`${fmtNum(t.trips, 0)} reys`} hint={`${fmtNum(t.km, 0)} km${unpriced.length ? ` · narxsiz ${unpriced.length}` : ""}`} icon={Route} tone={unpriced.length ? "warning" : "info"} href={hisob()} />
      </div>

      <div className="grid gap-5 xl:grid-cols-3 [&>*]:min-w-0">
        <Card padded={false}>
          <div className="px-5 pt-5"><CardHeader title="Kirim tarkibi" icon={TrendingUp} action={<Link href={hisob()} className="text-sm text-blue-700 hover:underline">Batafsil</Link>} /></div>
          <Table>
            <tbody>
              <Line label="Dostavka — perech." v={t.revBank} /><Line label="Dostavka — naqd" v={t.revCash} />
              {t.revDebt >= 1 && <Line label="Dostavka — qarzga (to'lov turi yo'q)" v={t.revDebt} />}
              <Line label="Usluga — perech." v={t.svcBank} /><Line label="Usluga — naqd" v={t.svcCash} />
              <Line label="Obyekt (zavod uchun)" v={t.revOther} /><Line label="Jami kirim" v={t.revenue} strong />
            </tbody>
          </Table>
        </Card>
        <Card padded={false}>
          <div className="px-5 pt-5"><CardHeader title="Chiqim tarkibi" icon={TrendingDown} action={<Link href={hisob()} className="text-sm text-blue-700 hover:underline">Batafsil</Link>} /></div>
          <Table>
            <tbody>
              <Line label="Yoqilg'i (norma × narx)" v={t.fuelSum} /><Line label="Haydovchi haqi" v={t.pay} /><Line label="Ta'mir" v={t.repair} />
              <Line label="Zapchast" v={t.parts} /><Line label="Vulkanizator" v={t.vulc} /><Line label="Boshqa" v={t.other} /><Line label="Jami chiqim" v={t.total} strong />
            </tbody>
          </Table>
        </Card>
        <Card padded={false}>
          <div className="px-5 pt-5"><CardHeader title="Haydovchilar haqi" icon={HandCoins} description={period.label} action={<Link href="/logistika/tabel?bolim=oylik" className="text-sm text-blue-700 hover:underline">Batafsil</Link>} /></div>
          {pays.length === 0 ? <div className="px-5 pb-5"><Empty text="Bu davrda haq yo'q" /></div> : (
            <Table>
              <thead><tr><Th>Haydovchi</Th><Th right>Oylik</Th><Th right>Naqd</Th><Th right>Narxsiz</Th></tr></thead>
              <tbody>
                {pays.slice(0, 10).map((d) => (
                  <Tr key={d.driverId}>
                    <Td className="whitespace-nowrap">{d.driver}</Td>
                    <Td right>{d.payroll ? moneyShort(d.payroll) : "—"}</Td>
                    <Td right>{d.cash ? moneyShort(d.cash) : "—"}</Td>
                    <Td right className={d.suggested ? "text-amber-700" : undefined}>{d.suggested ? moneyShort(d.suggested) : "—"}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>

      <Section title={`Mashinalar bo'yicha — ${period.label}`} action={<Link href={hisob()} className="text-sm text-blue-700 hover:underline">Hisob varag&apos;i</Link>}>
        {vehicles.length === 0 ? <Card><Empty text="Bu davrda reys va xarajat yo'q" icon={Route} /></Card> : (
          <Table>
            <thead><tr><Th>Mashina</Th><Th right>Reys</Th><Th right>Km</Th><Th right>Kirim</Th><Th right>Chiqim</Th><Th right>Foyda</Th><Th right>Yoqilg&apos;i qoldig&apos;i</Th></tr></thead>
            <tbody>
              {vehicles.map((v) => {
                const f = fuel.get(v.id);
                return (
                  <Tr key={v.id}>
                    <Td><Link href={hisob(`&transport=${v.id}`)} className="font-medium tabular hover:underline">{v.plate}</Link></Td>
                    <Td right>{v.trips || "—"}</Td>
                    <Td right>{v.km ? fmtNum(v.km, 0) : "—"}</Td>
                    <Td right>{v.revenue ? money(v.revenue) : "—"}</Td>
                    <Td right>{v.total ? money(v.total) : "—"}</Td>
                    <Td right className={`font-semibold ${v.profit < 0 ? "text-red-600" : v.profit > 0 ? "text-emerald-700" : "text-slate-400"}`}>{money(v.profit)}</Td>
                    <Td right className={f && f.closing < 0 ? "font-semibold text-red-600" : undefined}>{f ? `${fmtNum(f.closing, 1)} ${f.unit}` : "—"}</Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Section>

      <div className="grid gap-5 lg:grid-cols-2 [&>*]:min-w-0">
        <Card>
          <CardHeader title="Yoqilg'i" icon={Fuel} description={period.label} info="Zapravka va norma bo'yicha sarf" />
          <p className="text-sm text-slate-700">
            Sarf (norma): <b className="tabular">{[t.useGas ? `${fmtNum(t.useGas, 0)} m³` : null, t.useDt ? `${fmtNum(t.useDt, 0)} l` : null].filter(Boolean).join(" + ") || "—"}</b>
            {" · "}zapravka: <b className="tabular">{fmtNum(t.refuel, 0)}</b> · summa: <b className="tabular">{money(t.fuelSum)}</b>
          </p>
          {[...fuel.values()].some((b) => b.closing < 0) && <p className="mt-2 text-sm text-red-600">Minus qoldiq: {[...fuel.values()].filter((b) => b.closing < 0).map((b) => b.plate).join(", ")} — normadan ko&apos;p sarflangan yoki zapravka yozilmagan.</p>}
        </Card>
        <Card>
          <CardHeader title="Dispetcher ombori" icon={PackageOpen} info="Skladdan olingan, hali mashinaga berilmagan avto zapchast va yoqilg'i"
            action={<Link href="/stock/dispetcher" className="text-sm text-blue-700 hover:underline">Batafsil</Link>} />
          <p className="text-sm text-slate-700"><b className="tabular">{money(heldSum)}</b> · {held.length} xil{held.length ? `: ${held.slice(0, 4).map((r) => r.name).join(", ")}${held.length > 4 ? "…" : ""}` : ""}</p>
        </Card>
      </div>
    </div>
  );
}
