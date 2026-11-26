import Link from "next/link";
import { Calculator, Fuel, HandCoins, Landmark, PackageOpen, Route, TrendingDown, TrendingUp } from "lucide-react";
import { driverLedger, driverPaySums, fuelBalances, type LedgerRow } from "@/lib/driver-ledger";
import { BAL_GROUPS, logiBalance, logiQoldiqNow } from "@/lib/logistics-balance";
import { dispatcherStock } from "@/lib/dispatcher-stock";
import { fmtNum, isoDate, money } from "@/lib/format";
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
  const [led, disp, now] = await Promise.all([driverLedger(period.from, period.to), dispatcherStock(), logiQoldiqNow()]);
  // To'rt raqam — Hisob varag'i kartalari bilan bitta hisob (`lib/logistics-balance.ts`): Tushum, Xarajat, Oylik, Qoldiq
  const bal = await logiBalance(period.from, period.to, led);
  const t = led.total;
  void accounts;
  const due = toPay.reduce((a, r) => a + Number(r.amount), 0);
  const unpriced = led.rows.filter((r) => r.kind === "trip" && r.amount == null && r.pay > 0);
  const vehicles = byVehicle(led.rows);
  const fuel = new Map(fuelBalances(led.rows).map((b) => [b.vehicleId, b]));
  const pays = driverPaySums(led.rows);
  const held = disp.rows.filter((r) => r.held > 0.0005);
  const heldSum = held.reduce((a, r) => a + r.held * (r.price ?? 0), 0);
  const range = `dan=${isoDate(period.from)}&gacha=${isoDate(new Date(period.to.getTime() - 1))}`;
  const hisob = (extra = "") => `/logistika/tabel?bolim=hisob&${range}${extra}`;
  const n = (v: number) => fmtNum(v, 0);
  const tp = bal.tushumParts;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4 [&>*]:min-w-0">
        <StatCard label="Tushum" tag="bajarilgan ish" value={money(bal.tushum)} hint={`dostavka ${n(tp.dostavka)} · usluga ${n(tp.usluga)} · zavod uchun ${n(tp.obyekt)}${tp.boshqa ? ` · boshqa ${n(tp.boshqa)}` : ""}`} icon={TrendingUp} tone="success" href={hisob("&karta=tushum")} />
        <StatCard label="Xarajat" tag="transportga ketgan" value={money(bal.xarajat)} hint={BAL_GROUPS.filter((g) => bal.xarajatByGroup[g] >= 1).map((g) => `${g.toLowerCase()} ${n(bal.xarajatByGroup[g])}`).join(" · ") || period.label} icon={TrendingDown} tone="warning" href={hisob("&karta=xarajat")} />
        <StatCard label="Haydovchilar oyligi" tag="hisoblangan" value={money(bal.oylik)} hint={`reys haqi · ${fmtNum(t.trips, 0)} reys`} icon={HandCoins} href={hisob("&karta=oylik")} />
        <StatCard label="Qoldiq" tag="tushum − xarajat − oylik" value={money(bal.qoldiq)} hint={period.label} icon={Calculator} tone={bal.qoldiq < 0 ? "danger" : "info"} href={hisob("&karta=jami")} />
        <StatCard label="Qoldiq — 1-noyabrdan beri" tag="hozirgi" value={money(now.qoldiq)} hint="logistika boshlig'i chiqimi shundan" icon={Landmark} tone={now.qoldiq < 0 ? "danger" : "brand"} />
        <StatCard label="To'lanishi kerak" tag="to'lanmagan" value={money(due)} hint={`${toPay.length} ta tasdiqlangan so'rov`} icon={HandCoins} tone={toPay.length ? "warning" : "default"} href="/logistika/moliya?tab=tolov" />
        <StatCard label="Reys va probeg" tag="reys · km" value={`${fmtNum(t.trips, 0)} reys`} hint={`${fmtNum(t.km, 0)} km${unpriced.length ? ` · narxsiz ${unpriced.length}` : ""}`} icon={Route} tone={unpriced.length ? "warning" : "info"} href={hisob("&karta=reys")} />
      </div>

      <div className="grid gap-5 xl:grid-cols-3 [&>*]:min-w-0">
        <Card padded={false}>
          <div className="px-5 pt-5"><CardHeader title="Tushum tarkibi" icon={TrendingUp} action={<Link href={hisob("&karta=tushum")} className="text-sm text-blue-700 hover:underline">Batafsil</Link>} /></div>
          <Table>
            <tbody>
              <Line label="Dostavka — perech." v={t.revBank} /><Line label="Dostavka — naqd" v={t.revCash} />
              {t.revDebt >= 1 && <Line label="Dostavka — qarzga (to'lov turi yo'q)" v={t.revDebt} />}
              <Line label="Usluga — perech." v={t.svcBank} /><Line label="Usluga — naqd" v={t.svcCash} />
              <Line label="Zavod uchun ish (obyekt)" v={t.revOther} />
              {tp.boshqa >= 1 && <Line label="Boshqa kirim (jurnal)" v={tp.boshqa} />}<Line label="Tushum" v={bal.tushum} strong />
              <Line label="− Xarajat" v={-bal.xarajat} /><Line label="− Haydovchilar oyligi" v={-bal.oylik} /><Line label="Qoldiq" v={bal.qoldiq} strong />
            </tbody>
          </Table>
        </Card>
        <Card padded={false}>
          <div className="px-5 pt-5"><CardHeader title="Xarajat tarkibi" icon={TrendingDown} action={<Link href={hisob("&karta=xarajat")} className="text-sm text-blue-700 hover:underline">Batafsil</Link>} /></div>
          <Table>
            <tbody>
              {BAL_GROUPS.map((g) => <Line key={g} label={g} v={bal.xarajatByGroup[g]} />)}
              <Line label="Xarajat" v={bal.xarajat} strong />
              <Line label="shundan zavod kassasidan (Transport)" v={bal.xarajatBySource.kassa} />
              <Line label="shundan mashina xarajati (sklad, ta'mir…)" v={bal.xarajatBySource.mashina} />
              <Line label="shundan Logistika moliyadan" v={bal.xarajatBySource.logistika} />
              <Line label="shundan dispetcher omboridan yoqilg'i" v={bal.xarajatBySource.sklad} />
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
                    <Td right>{d.payroll ? n(d.payroll) : "—"}</Td>
                    <Td right>{d.cash ? n(d.cash) : "—"}</Td>
                    <Td right className={d.suggested ? "text-amber-700" : undefined}>{d.suggested ? n(d.suggested) : "—"}</Td>
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
