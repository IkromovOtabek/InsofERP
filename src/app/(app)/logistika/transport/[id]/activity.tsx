import Link from "next/link";
import { Coins, Fuel, Gauge, MapPin, Package, Receipt, Route, Users, Wallet, Wrench } from "lucide-react";
import { fmtLoad, type VehicleReport } from "@/lib/vehicle-report";
import { TRIP_STEP } from "@/lib/trips";
import { date, fmtNum, money, moneyShort } from "@/lib/format";
import { Badge, Empty, Section, StatCard, Table, Td, Th, Tr } from "@/components/ui";
import { ExcelButton } from "../../excel-button";
import { TripLink } from "../../ui";
import { type DayRange, DayRangeBar } from "@/app/(app)/bi-tahlil/month-bar";

const N = ({ v, frac = 0 }: { v: number; frac?: number }) => (Math.abs(v) < (frac ? 0.05 : 1) ? <span className="text-slate-300">—</span> : <>{fmtNum(v, frac)}</>);

/**
 * Transport kartasi → «Faoliyat va xarajat»: tanlangan davrda necha reys / zayavka, qancha yuk, qayerga va kimga,
 * qanday xarajat yozilgan, daromad va foyda (`lib/vehicle-report.ts`, pul — Tahlil → Avtotransport bilan bitta manba).
 */
export function VehicleActivity({ r, period, base, plate, tripsClosed, ordersOpen }: {
  r: VehicleReport; period: DayRange; base: string; plate: string; tripsClosed: boolean; ordersOpen: boolean;
}) {
  const a = r.row;
  const fuelText = [a.dtGiven ? `${fmtNum(a.dtGiven, 1)} l` : "", a.gasGiven ? `${fmtNum(a.gasGiven, 1)} m³` : ""].filter(Boolean).join(" · ");
  const fuelNorm = [a.dtNorm != null ? `${fmtNum(a.dtNorm, 1)} l` : "", a.gasNorm != null ? `${fmtNum(a.gasNorm, 1)} m³` : ""].filter(Boolean).join(" · ");
  const counted = r.costs.reduce((s, c) => s + c.sum, 0);
  const file = `${plate} faoliyati ${period.label.replace(/[:/]/g, "")}`;

  return (
    <div className="space-y-5">
      <DayRangeBar base={base} range={period}>
        <ExcelButton file={file} sheets={[
          { name: "Reyslar", rows: r.trips.map((t) => ({ Sana: date(t.date), Nakladnoy: t.noteNo, Zayavka: t.orderNo, Mijoz: t.customer, Obyekt: t.place, Haydovchi: t.driver, "Beton, m3": t.load.m3 || null, Dona: t.load.dona || null, "Og'irlik, t": t.load.t ? Math.round(t.load.t * 100) / 100 : null, "Probeg, km": Math.round(t.km), Daromad: Math.round(t.revenue), Holat: TRIP_STEP[t.status] ?? t.status })) },
          { name: "Qayerga", rows: r.places.map((p) => ({ Obyekt: p.name, Manzil: p.address, Mijoz: p.customer, Reys: p.trips, Zayavka: p.orders, Yuk: fmtLoad(p.load), "Probeg, km": Math.round(p.km), Daromad: Math.round(p.revenue) })) },
          { name: "Xarajatlar", rows: r.ledger.map((x) => ({ Sana: date(x.date), Turi: x.label, Izoh: x.note, Summa: x.amount, "Jamiga kiradi": x.counted ? "ha" : "yo'q (xizmat jurnali)" })) },
        ]} />
      </DayRangeBar>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4 [&>*]:min-w-0">
        <StatCard label="Reyslar" value={`${r.trips.length} ta`} hint={`${r.orders} ta zayavkada · ${r.days} kun ishladi`} icon={Route} tone="brand" href="#reyslar" />
        <StatCard label="Tashilgan yuk" value={fmtLoad(r.load)} hint={r.load.tApprox ? "tonna — og'irlik GOST bo'yicha taxminiy" : "beton · dona · og'irlik"} icon={Package} tone="info" href="#qayerga" />
        <StatCard label="Jami xarajat" value={moneyShort(a.total)} hint={a.perKm != null ? `1 km ga ${fmtNum(a.perKm)} so'm · reysga ${r.trips.length ? moneyShort(a.total / r.trips.length) : "—"}` : "yoqilg'i + ish haqi + ta'mir + boshqa"} icon={Coins} href="#xarajatlar" />
        <StatCard label="Foyda" value={moneyShort(a.profit)} hint={`daromad (dastavka) ${moneyShort(a.revenue)}`} icon={Wallet} tone={a.profit < 0 ? "danger" : a.revenue ? "success" : "default"} href="#xarajatlar" />
        <StatCard label="Probeg" value={`${fmtNum(a.km)} km`} hint={a.hours ? `baraban ${fmtNum(a.hours, 1)} soat` : "zavod → obyekt → zavod"} icon={Gauge} href="#reyslar" />
        <StatCard label="Yoqilg'i" value={moneyShort(a.fuelSum)} hint={fuelText ? `${fuelText}${fuelNorm ? ` · norma ${fuelNorm}` : ""}` : "zapravka yozilmagan"} icon={Fuel} href="#xarajatlar" />
        <StatCard label="Ta'mir va zapchast" value={moneyShort(a.repair)} hint={r.service.count ? `${r.service.count} ta texnik xizmat · ${moneyShort(r.service.sum)}` : "texnik xizmat yozilmagan"} icon={Wrench} tone={a.repair ? "warning" : "default"} href="#yozuvlar" />
        <StatCard label="Ish haqi" value={moneyShort(a.pay)} hint={r.drivers.length ? r.drivers.map((d) => `${d.name} (${d.trips})`).join(", ") : "reys yo'q"} icon={Users} href="#reyslar" />
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-5 [&>*]:min-w-0">
        <Section id="xarajatlar" title="Xarajatlar — turi bo'yicha" className="mt-0 xl:col-span-2">
          <Table>
            <thead><tr><Th>Turi</Th><Th right>Soni</Th><Th right>Summa</Th><Th right>Ulush</Th></tr></thead>
            <tbody>
              {r.costs.length === 0 && <Empty text="Bu davrda xarajat yozilmagan" icon={Receipt} />}
              {r.costs.map((c) => (
                <Tr key={c.label}><Td className="text-sm">{c.label}</Td><Td right className="tabular">{c.count}</Td><Td right className="tabular">{money(c.sum)}</Td><Td right className="tabular text-slate-500">{counted ? `${fmtNum((c.sum / counted) * 100, 0)}%` : "—"}</Td></Tr>
              ))}
              {r.costs.length > 0 && (
                <>
                  <tr className="bg-slate-50 font-semibold text-slate-900"><Td>Jami xarajat</Td><Td /><Td right className="tabular">{money(a.total)}</Td><Td /></tr>
                  <tr><Td>Daromad (dastavka haqi)</Td><Td /><Td right className="tabular">{money(a.revenue)}</Td><Td /></tr>
                  <tr className="font-semibold"><Td>Foyda</Td><Td /><Td right className={`tabular ${a.profit < 0 ? "text-red-600" : "text-emerald-700"}`}>{money(a.profit)}</Td><Td /></tr>
                </>
              )}
            </tbody>
          </Table>
          <p className="mt-2 text-xs text-slate-500">
            Daromad — zayavka dastavka haqi reyslarga hajm ulushida. Texnik xizmat jurnalidagi narx jamiga qo&apos;shilmaydi (ta&apos;mir xarajati alohida yoziladi).
            {a.cash > 0.5 && <> Kassadan izohida shu raqam bilan chiqqan: {money(a.cash)}.</>}
          </p>
        </Section>

        <Section id="qayerga" title="Qayerga qatnadi" className="mt-0 xl:col-span-3">
          <Table>
            <thead><tr><Th>Obyekt / manzil</Th><Th right>Reys</Th><Th right>Zayavka</Th><Th>Yuk</Th><Th right>Probeg</Th><Th right>Daromad</Th></tr></thead>
            <tbody>
              {r.places.length === 0 && <Empty text="Bu davrda reys yo'q" icon={MapPin} />}
              {r.places.map((p) => (
                <Tr key={p.key}>
                  <Td className="min-w-48">
                    {p.siteId ? <Link href={`/logistika/obyektlar/${p.siteId}`} className="font-medium hover:underline">{p.name}</Link> : <span className="font-medium">{p.name}</span>}
                    <div className="max-w-xs truncate text-xs text-slate-500">{p.customer}{p.siteId && p.address !== p.name ? ` · ${p.address}` : ""}</div>
                  </Td>
                  <Td right className="tabular">{p.trips}</Td>
                  <Td right className="tabular">{p.orders}</Td>
                  <Td className="whitespace-nowrap text-sm tabular">{fmtLoad(p.load)}</Td>
                  <Td right className="tabular"><N v={p.km} /></Td>
                  <Td right className="tabular"><N v={p.revenue} /></Td>
                </Tr>
              ))}
            </tbody>
          </Table>
          {r.customers.length > 1 && (
            <p className="mt-2 text-xs text-slate-500">Mijozlar: {r.customers.map((c) => `${c.name} — ${c.trips} reys, ${fmtLoad(c.load)}`).join("; ")}</p>
          )}
        </Section>
      </div>

      <Section id="reyslar" title={`Reyslar — ${period.label}`}>
        <Table maxHeight="70vh">
          <thead><tr><Th>Sana</Th><Th>Nakladnoy</Th><Th>Zayavka / mijoz</Th><Th>Qayerga</Th><Th>Haydovchi</Th><Th>Yuk</Th><Th right>Probeg</Th><Th right>Daromad</Th><Th>Holat</Th></tr></thead>
          <tbody>
            {r.trips.length === 0 && <Empty text="Bu davrda reys yo'q" icon={Route} />}
            {r.trips.map((t) => (
              <Tr key={t.id}>
                <Td className="whitespace-nowrap text-sm tabular">{date(t.date)}</Td>
                <Td><TripLink id={t.id} noteNo={t.noteNo} plain={tripsClosed} /></Td>
                <Td className="text-sm">
                  {ordersOpen ? <Link href={`/orders/${t.orderId}`} className="font-medium tabular hover:underline">{t.orderNo}</Link> : <span className="font-medium tabular">{t.orderNo}</span>}
                  <div className="text-xs text-slate-500">{t.customer}</div>
                </Td>
                <Td className="max-w-xs truncate text-sm">{t.place}</Td>
                <Td className="whitespace-nowrap text-sm">{t.driver}</Td>
                <Td className="whitespace-nowrap text-sm tabular">{fmtLoad(t.load)}</Td>
                <Td right className="tabular"><N v={t.km} /></Td>
                <Td right className="tabular"><N v={t.revenue} /></Td>
                <Td><Badge color={t.status === "DELIVERED" ? "green" : t.status === "ON_ROAD" ? "blue" : "slate"}>{TRIP_STEP[t.status] ?? t.status}</Badge></Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </Section>

      <Section id="yozuvlar" title="Xarajat yozuvlari (sana bo'yicha)">
        <Table maxHeight="60vh">
          <thead><tr><Th>Sana</Th><Th>Turi</Th><Th>Izoh</Th><Th right>Summa</Th></tr></thead>
          <tbody>
            {r.ledger.length === 0 && <Empty text="Bu davrda zapravka, xarajat yoki texnik xizmat yozilmagan" icon={Receipt} />}
            {r.ledger.map((x) => (
              <Tr key={`${x.kind}-${x.id}`} className={x.counted ? undefined : "text-slate-500"}>
                <Td className="whitespace-nowrap text-sm tabular">{date(x.date)}</Td>
                <Td className="text-sm">{x.label}{!x.counted && <span className="ml-1.5"><Badge>jamiga kirmaydi</Badge></span>}</Td>
                <Td className="max-w-md text-sm text-slate-600">{x.note || "—"}</Td>
                <Td right className="tabular">{x.amount ? money(x.amount) : "—"}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </Section>
    </div>
  );
}
