import Link from "next/link";
import { BellRing, ChevronLeft, ChevronRight, Coins, FileSpreadsheet, Fuel, Route, Settings2, Timer, Users } from "lucide-react";
import { db } from "@/lib/db";
import { requireRoles } from "@/lib/page-guard";
import { canDo } from "@/lib/permissions";
import { normMonth } from "@/lib/attendance-report";
import { monthTitle, shiftMonth, today } from "@/lib/davomat";
import { driverTariff, fuelNormText, payTrips, tariffSet, unpricedWhere, type PayTripRow } from "@/lib/driver-trip-pay";
import { driverLedger, fuelBalances } from "@/lib/driver-ledger";
import { date, dateTime, fmtNum, isoDate, money } from "@/lib/format";
import { Badge, Button, Callout, Card, CardHeader, Empty, PageHeader, Section, Select, StatCard, Table, Tabs, Td, Th, Tr } from "@/components/ui";
import { PriceAllButton, PriceForm, TariffForm } from "./tabel-forms";
import { LedgerSheet } from "./ledger-sheet";

export const dynamic = "force-dynamic";

const hours = (min: number | null) => (min == null ? "—" : min < 60 ? `${min} daq` : `${fmtNum(min / 60, 1)} soat`);

/** Yoqilg'i qoldig'i: «66,2 m³», manfiy — qizil (norma bo'yicha zapravkadan ko'p sarflangan). */
const Bal = ({ v, unit }: { v: number; unit: string }) => <span className={v < 0 ? "font-semibold text-red-600" : undefined}>{fmtNum(v, 1)} {unit}</span>;
type BalMap = Map<string, { after: number; unit: string }>;

/** Reys qatori — narxsizlar ro'yxati va haydovchi oyi uchun bir xil. */
function TripRows({ rows, canPrice, showDriver, bal }: { rows: PayTripRow[]; canPrice: boolean; showDriver: boolean; bal: BalMap }) {
  return (
    <Table>
      <thead>
        <tr>
          <Th>Sana · nakladnoy</Th>{showDriver && <Th>Haydovchi</Th>}<Th>Obyekt</Th>
          <Th right>Km</Th><Th right>Kutish</Th><Th right>Aylantirish</Th><Th right>Ishladi</Th><Th right>Norma (yoqilg&apos;i)</Th>
          <Th right>Qoldiq (yoqilg&apos;i)</Th><Th right>Taklif</Th><Th right>Narx</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <Tr key={r.id}>
            <Td className="text-sm"><span className="font-medium tabular">{r.no}</span><div className="text-xs text-slate-500">{dateTime(r.deliveredAt)} · {r.plate}</div></Td>
            {showDriver && <Td className="text-sm"><Link href={`/logistika/tabel?driver=${r.driverId}&oy=${isoDate(r.deliveredAt).slice(0, 7)}`} className="hover:underline">{r.driver}</Link></Td>}
            <Td className="max-w-48 truncate text-sm">{r.customer}</Td>
            <Td right className="tabular">{fmtNum(r.km, 0)}</Td>
            <Td right className="tabular">{r.vehicleType === "MIXER" ? hours(r.waitMin) : "—"}</Td>
            <Td right className="tabular">{r.drumTurns ?? "—"}</Td>
            <Td right className="tabular">{r.workHours != null ? `${fmtNum(r.workHours, 1)} soat` : <span className="text-amber-700">kiritilmagan</span>}</Td>
            <Td right className="tabular">{fuelNormText(r) ?? "—"}</Td>
            <Td right className="tabular">{(() => { const b = bal.get(r.id); return b ? <Bal v={b.after} unit={b.unit} /> : "—"; })()}</Td>
            <Td right className="tabular"><span title={r.suggestText}>{money(r.suggested)}</span><div className="text-[11px] text-slate-400">{r.suggestText}</div></Td>
            <Td right>
              {r.amount != null && <div className="font-semibold tabular">{money(r.amount)}</div>}
              {r.note && <div className="text-[11px] text-slate-500">{r.note}</div>}
              {canPrice ? <PriceForm tripId={r.id} suggested={r.suggested} amount={r.amount} /> : r.amount == null && <Badge color="amber">Narxsiz</Badge>}
            </Td>
          </Tr>
        ))}
      </tbody>
    </Table>
  );
}

/**
 * Haydovchilar tabeli (dispetcher): yetkazilgan har reys o'zi tushadi — km, obyektda kutish, mikser aylantirish,
 * ishlagan soat, yoqilg'i normasi va tarif bo'yicha taklif. Dispetcher narx qo'yadi; narxsizlari tepada alohida
 * (har 12 soatda eslatma). Narxlangan reyslar oy yakunida Ish haqi vedomostiga «Reyslar» bo'lib tushadi.
 * «Hisob varag'i» (`?view=hisob`) — dispetcher Excel'i: gaz qoldig'i/zapravka/sarf, xarajatlar, dastavka daromadi, foyda.
 */
export default async function DriverTabelPage({ searchParams }: { searchParams: Promise<{ oy?: string; driver?: string; view?: string; transport?: string }> }) {
  const s = await requireRoles(["LOGISTICS", "DISPATCHER"], { module: "logistika" });
  const sp = await searchParams;
  const month = normMonth(sp.oy);
  const [y, m] = month.split("-").map(Number);
  const from = new Date(y!, m! - 1, 1), to = new Date(y!, m!, 1);
  const canPrice = canDo(s, "logistika", "pay");
  const view = sp.view === "hisob" ? "hisob" : "tabel";
  const filtered = !!(sp.driver || sp.transport);
  const [unpriced, monthTrips, tariff, full, filteredLedger, monthVehicles] = await Promise.all([
    payTrips(unpricedWhere()),
    payTrips({ status: "DELIVERED", deliveredAt: { gte: from, lt: to }, ...(sp.driver ? { driverId: sp.driver } : {}) }, 3000),
    driverTariff(),
    // Yoqilg'i qoldig'i mashina bo'yicha — oyning hamma reysidan (haydovchi filtri qoldiqni buzmasin)
    driverLedger(from, to),
    view === "hisob" && filtered ? driverLedger(from, to, { driverId: sp.driver, vehicleId: sp.transport }) : null,
    view === "hisob"
      ? db.trip.groupBy({ by: ["vehicleId"], where: { status: "DELIVERED", deliveredAt: { gte: from, lt: to }, ...(sp.driver ? { driverId: sp.driver } : {}) } })
        .then((g) => db.vehicle.findMany({ where: { id: { in: g.map((x) => x.vehicleId) } }, select: { id: true, plate: true }, orderBy: { plate: "asc" } }))
      : [],
  ]);

  const ledger = view === "hisob" ? filteredLedger ?? full : null;
  const balOf: BalMap = new Map(full.rows.map((r) => [r.id, { after: r.balAfter, unit: r.unit }]));
  const balances = fuelBalances(full.rows);
  const balById = new Map(balances.map((b) => [b.vehicleId, b]));
  // Haydovchi oxirgi yurgan mashinalari (yangisi oldin) — jadvaldagi qoldiq ustuni uchun
  const driverVehicles = new Map<string, string[]>();
  for (const r of [...full.rows].reverse()) {
    const list = driverVehicles.get(r.driverId) ?? [];
    if (!list.includes(r.vehicleId)) list.push(r.vehicleId);
    driverVehicles.set(r.driverId, list);
  }

  // Haydovchilar bo'yicha oy jami
  const byDriver = new Map<string, { id: string; name: string; trips: number; km: number; wait: number; hours: number; turns: number; fuelL: number; fuelM3: number; sum: number; unpriced: number }>();
  for (const r of monthTrips) {
    const d = byDriver.get(r.driverId) ?? { id: r.driverId, name: r.driver, trips: 0, km: 0, wait: 0, hours: 0, turns: 0, fuelL: 0, fuelM3: 0, sum: 0, unpriced: 0 };
    d.trips++; d.km += r.km; d.wait += r.vehicleType === "MIXER" ? r.waitMin ?? 0 : 0; d.hours += r.workHours ?? 0; d.turns += r.drumTurns ?? 0;
    // Norma birligi bo'yicha alohida: dizel — l, metan — m³ («Dizel + metan» reysda ikkalasi)
    if (r.fuelUnit === "m³") d.fuelM3 += r.fuelNorm ?? 0; else d.fuelL += r.fuelNorm ?? 0;
    d.fuelM3 += r.gasNorm ?? 0;
    if (r.amount != null) d.sum += r.amount; else d.unpriced++;
    byDriver.set(r.driverId, d);
  }
  const drivers = [...byDriver.values()].sort((a, b) => b.sum - a.sum || a.name.localeCompare(b.name));
  const total = { trips: monthTrips.length, km: drivers.reduce((a, d) => a + d.km, 0), sum: drivers.reduce((a, d) => a + d.sum, 0), unpriced: drivers.reduce((a, d) => a + d.unpriced, 0) };
  const picked = sp.driver ? drivers.find((d) => d.id === sp.driver) ?? null : null;
  const cur = today().slice(0, 7);
  const qs = (o: { oy?: string; driver?: string | null; view?: string; transport?: string | null }) => {
    const p = new URLSearchParams({ oy: o.oy ?? month });
    const driver = o.driver === undefined ? sp.driver : o.driver, v = o.view ?? view, tr = o.transport === undefined ? sp.transport : o.transport;
    if (driver) p.set("driver", driver);
    if (v === "hisob") { p.set("view", "hisob"); if (tr) p.set("transport", tr); }
    return `/logistika/tabel?${p}`;
  };
  const link = (oy: string) => qs({ oy });

  return (
    <div>
      <PageHeader title="Haydovchilar tabeli" subtitle="Yetkazilgan reyslar o'zi tushadi · narxni dispetcher qo'yadi · narxlangani oylikka (Ish haqi) kiradi" />

      {!tariffSet(tariff) && <Callout tone="warning" title="Tarif kiritilmagan">Taklif narx 0 chiqadi — pastdagi «Tarif» bo&apos;limida km va kutish narxini kiriting.</Callout>}

      {/* ── Narx belgilanmagan reyslar — «propushenniy»: hal bo'lmaguncha shu yerda va eslatmada ── */}
      <Card padded={false} className={unpriced.length ? "border-amber-300 ring-2 ring-amber-100" : undefined}>
        <div id="narxsiz" className="scroll-mt-20 px-5 pt-5">
          <CardHeader title={`Narx belgilanmagan reyslar${unpriced.length ? ` (${unpriced.length})` : ""}`} icon={BellRing}
            description="Narx qo'yilgach reys haydovchi tabeliga va oylikka qo'shiladi"
            action={canPrice && unpriced.length > 1 ? <PriceAllButton ids={unpriced.map((r) => r.id)} /> : undefined} />
        </div>
        {unpriced.length === 0 ? <div className="px-5 pb-5 text-sm text-emerald-700">Hamma yetkazilgan reysga narx qo&apos;yilgan</div>
          : <TripRows rows={unpriced} canPrice={canPrice} showDriver bal={balOf} />}
      </Card>

      <Section title={picked ? `${picked.name} — ${monthTitle(month)}` : `Oy bo'yicha: ${monthTitle(month)}`}
        action={
          <div className="flex items-center gap-1 text-sm">
            {picked && <Link href={qs({ driver: null })} className="mr-2 text-blue-700 hover:underline">Hamma haydovchilar</Link>}
            <Link href={link(shiftMonth(month, -1))} className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100" aria-label="Oldingi oy"><ChevronLeft size={16} /></Link>
            <span className="font-medium">{monthTitle(month)}</span>
            {month < cur && <Link href={link(shiftMonth(month, 1))} className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100" aria-label="Keyingi oy"><ChevronRight size={16} /></Link>}
          </div>
        }>
        <div className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-4 [&>*]:min-w-0">
          <StatCard label="Reyslar" value={picked ? picked.trips : total.trips} icon={Route} tone="info" href="#oy-jadval" />
          <StatCard label="Km" value={fmtNum(picked ? picked.km : total.km, 0)} hint="zavod → obyekt → zavod" icon={Users} href="#oy-jadval" />
          <StatCard label="Narxlangan summa" value={money(picked ? picked.sum : total.sum)} hint="oylikka tushadi" icon={Coins} tone="success" href="#oy-jadval" />
          <StatCard label="Narxsiz" value={picked ? picked.unpriced : total.unpriced} icon={Timer} tone={(picked ? picked.unpriced : total.unpriced) ? "warning" : "default"} href="#narxsiz" />
        </div>

        {(() => {
          // Haydovchi tanlangan bo'lsa — faqat u yurgan mashinalar (qoldiq baribir butun mashina bo'yicha)
          const list = picked ? balances.filter((b) => driverVehicles.get(picked.id)?.includes(b.vehicleId)) : balances;
          if (!list.length) return null;
          return (
            <Card padded={false} className="mb-4">
              <div className="px-5 pt-5">
                <CardHeader title="Yoqilg'i qoldig'i" icon={Fuel}
                  description="Transport bo'yicha: oy boshidagi qoldiq + zapravka − norma sarfi (km × 100 km normasi + baraban soati × soat normasi)" />
              </div>
              <Table>
                <thead><tr><Th>Transport</Th><Th>Haydovchilar</Th><Th right>Reys</Th><Th right>Oy boshida</Th><Th right>Zapravka</Th><Th right>Sarf (norma)</Th><Th right>Qoldiq</Th></tr></thead>
                <tbody>
                  {list.map((b) => (
                    <Tr key={b.vehicleId}>
                      <Td className="font-medium"><Link href={qs({ view: "hisob", transport: b.vehicleId })} className="hover:underline">{b.plate}</Link></Td>
                      <Td className="text-sm text-slate-600">{b.drivers.join(", ")}</Td>
                      <Td right className="tabular">{b.trips}</Td>
                      <Td right className="tabular"><Bal v={b.opening} unit={b.unit} /></Td>
                      <Td right className="tabular">{fmtNum(b.refuel, 1)} {b.unit}</Td>
                      <Td right className="tabular">{fmtNum(b.use, 1)} {b.unit}</Td>
                      <Td right className="font-semibold tabular"><Bal v={b.closing} unit={b.unit} /></Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </Card>
          );
        })()}

        <div id="oy-jadval" className="scroll-mt-20" />
        <Tabs className="mb-3" current={view} items={[
          { key: "tabel", label: "Reyslar va narx", href: qs({ view: "tabel" }), icon: Route },
          { key: "hisob", label: "Hisob varag'i", href: qs({ view: "hisob" }), icon: FileSpreadsheet },
        ]} />
        {ledger ? (
          <>
            <form method="get" action="/logistika/tabel" className="mb-3 flex flex-wrap items-center gap-2">
              <input type="hidden" name="oy" value={month} />
              <input type="hidden" name="view" value="hisob" />
              {sp.driver && <input type="hidden" name="driver" value={sp.driver} />}
              <Select name="transport" defaultValue={sp.transport ?? ""} className="w-56" aria-label="Transport">
                <option value="">Hamma transport</option>
                {monthVehicles.map((v) => <option key={v.id} value={v.id}>{v.plate}</option>)}
              </Select>
              <Button type="submit" variant="secondary">Ko&apos;rsatish</Button>
            </form>
            {ledger.rows.length === 0 ? <Card><Empty text="Bu oyda yetkazilgan reys yo'q" icon={Route} /></Card>
              : <LedgerSheet rows={ledger.rows} total={ledger.total} month={month} showDriver={!picked}
                file={`Haydovchi tabeli ${month}${picked ? ` ${picked.name}` : ""}${sp.transport ? ` ${monthVehicles.find((v) => v.id === sp.transport)?.plate ?? ""}` : ""}`} />}
          </>
        ) : picked ? (
          <Card padded={false}>
            {monthTrips.length === 0 ? <Empty text="Bu oyda yetkazilgan reys yo'q" icon={Route} /> : <TripRows rows={[...monthTrips].reverse()} canPrice={canPrice} showDriver={false} bal={balOf} />}
          </Card>
        ) : (
          <Card padded={false}>
            <Table>
              <thead><tr><Th>Haydovchi</Th><Th right>Reys</Th><Th right>Km</Th><Th right>Kutish</Th><Th right>Ishlagan soat</Th><Th right>Aylantirish</Th><Th right>Yoqilg&apos;i normasi</Th><Th right>Yoqilg&apos;i qoldig&apos;i</Th><Th right>Narxsiz</Th><Th right>Summa</Th></tr></thead>
              <tbody>
                {drivers.length === 0 && <Empty text="Bu oyda yetkazilgan reys yo'q" icon={Users} />}
                {drivers.map((d) => (
                  <Tr key={d.id}>
                    <Td><Link href={qs({ driver: d.id })} className="font-medium hover:underline">{d.name}</Link></Td>
                    <Td right className="tabular">{d.trips}</Td>
                    <Td right className="tabular">{fmtNum(d.km, 0)}</Td>
                    <Td right className="tabular">{hours(d.wait)}</Td>
                    <Td right className="tabular">{fmtNum(d.hours, 1)}</Td>
                    <Td right className="tabular">{d.turns || "—"}</Td>
                    <Td right className="tabular">{[d.fuelL ? `${fmtNum(d.fuelL, 0)} l` : null, d.fuelM3 ? `${fmtNum(d.fuelM3, 0)} m³` : null].filter(Boolean).join(" + ") || "—"}</Td>
                    <Td right className="tabular text-sm">
                      {(driverVehicles.get(d.id) ?? []).map((vid) => balById.get(vid)).filter((b) => !!b).map((b) => (
                        <div key={b.vehicleId} className="whitespace-nowrap"><span className="text-xs text-slate-500">{b.plate}</span> <Bal v={b.closing} unit={b.unit} /></div>
                      ))}
                    </Td>
                    <Td right>{d.unpriced ? <Badge color="amber">{d.unpriced}</Badge> : <span className="text-slate-400">0</span>}</Td>
                    <Td right className="font-semibold tabular">{money(d.sum)}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </Card>
        )}
        <p className="mt-2 text-xs text-slate-500">Yoqilg&apos;i normasi: km × 100 km normasi + ishlagan soat × turib ishlash normasi (metan — m³, dizel — l). Oylik {date(new Date(y!, m!, 0))} gacha yetkazilgan reyslardan.</p>
      </Section>

      <Section title="Tarif">
        <Card>
          <CardHeader title="Reys haqi tarifi" icon={Settings2} description="Taklif = reys + km × tarif + mikser kutish soati × tarif (1000 so'mga yaxlitlanadi)" />
          {canPrice ? <TariffForm v={{ drvTripRate: tariff.trip, drvKmRate: tariff.km, drvWaitHourRate: tariff.waitHour }} />
            : <p className="text-sm text-slate-600">Reys: {money(tariff.trip)} · 1 km: {money(tariff.km)} · kutish: {money(tariff.waitHour)} / soat. Tarifni dispetcher o&apos;zgartiradi.</p>}
        </Card>
      </Section>
    </div>
  );
}
