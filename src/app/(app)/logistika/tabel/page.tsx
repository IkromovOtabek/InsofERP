import Link from "next/link";
import { BellRing, ChevronLeft, ChevronRight, Coins, Route, Settings2, Timer, Users } from "lucide-react";
import { requireRoles } from "@/lib/page-guard";
import { canDo } from "@/lib/permissions";
import { normMonth } from "@/lib/attendance-report";
import { monthTitle, shiftMonth, today } from "@/lib/davomat";
import { driverTariff, fuelNormText, payTrips, tariffSet, unpricedWhere, type PayTripRow } from "@/lib/driver-trip-pay";
import { date, dateTime, fmtNum, isoDate, money } from "@/lib/format";
import { Badge, Callout, Card, CardHeader, Empty, PageHeader, Section, StatCard, Table, Td, Th, Tr } from "@/components/ui";
import { PriceAllButton, PriceForm, TariffForm } from "./tabel-forms";

export const dynamic = "force-dynamic";

const hours = (min: number | null) => (min == null ? "—" : min < 60 ? `${min} daq` : `${fmtNum(min / 60, 1)} soat`);

/** Reys qatori — narxsizlar ro'yxati va haydovchi oyi uchun bir xil. */
function TripRows({ rows, canPrice, showDriver }: { rows: PayTripRow[]; canPrice: boolean; showDriver: boolean }) {
  return (
    <Table>
      <thead>
        <tr>
          <Th>Sana · nakladnoy</Th>{showDriver && <Th>Haydovchi</Th>}<Th>Obyekt</Th>
          <Th right>Km</Th><Th right>Kutish</Th><Th right>Aylantirish</Th><Th right>Ishladi</Th><Th right>Norma (yoqilg&apos;i)</Th>
          <Th right>Taklif</Th><Th right>Narx</Th>
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
 */
export default async function DriverTabelPage({ searchParams }: { searchParams: Promise<{ oy?: string; driver?: string }> }) {
  const s = await requireRoles(["LOGISTICS", "DISPATCHER"], { module: "logistika" });
  const sp = await searchParams;
  const month = normMonth(sp.oy);
  const [y, m] = month.split("-").map(Number);
  const from = new Date(y!, m! - 1, 1), to = new Date(y!, m!, 1);
  const canPrice = canDo(s, "logistika", "pay");
  const [unpriced, monthTrips, tariff] = await Promise.all([
    payTrips(unpricedWhere()),
    payTrips({ status: "DELIVERED", deliveredAt: { gte: from, lt: to }, ...(sp.driver ? { driverId: sp.driver } : {}) }, 3000),
    driverTariff(),
  ]);

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
  const link = (oy: string) => `/logistika/tabel?oy=${oy}${sp.driver ? `&driver=${sp.driver}` : ""}`;

  return (
    <div>
      <PageHeader title="Haydovchilar tabeli" subtitle="Yetkazilgan reyslar o'zi tushadi · narxni dispetcher qo'yadi · narxlangani oylikka (Ish haqi) kiradi" />

      {!tariffSet(tariff) && <Callout tone="warning" title="Tarif kiritilmagan">Taklif narx 0 chiqadi — pastdagi «Tarif» bo&apos;limida km va kutish narxini kiriting.</Callout>}

      {/* ── Narx belgilanmagan reyslar — «propushenniy»: hal bo'lmaguncha shu yerda va eslatmada ── */}
      <Card padded={false} className={unpriced.length ? "border-amber-300 ring-2 ring-amber-100" : undefined}>
        <div className="px-5 pt-5">
          <CardHeader title={`Narx belgilanmagan reyslar${unpriced.length ? ` (${unpriced.length})` : ""}`} icon={BellRing}
            description="Narx qo'yilgach reys haydovchi tabeliga va oylikka qo'shiladi"
            action={canPrice && unpriced.length > 1 ? <PriceAllButton ids={unpriced.map((r) => r.id)} /> : undefined} />
        </div>
        {unpriced.length === 0 ? <div className="px-5 pb-5 text-sm text-emerald-700">Hamma yetkazilgan reysga narx qo&apos;yilgan</div>
          : <TripRows rows={unpriced} canPrice={canPrice} showDriver />}
      </Card>

      <Section title={picked ? `${picked.name} — ${monthTitle(month)}` : `Oy bo'yicha: ${monthTitle(month)}`}
        action={
          <div className="flex items-center gap-1 text-sm">
            {picked && <Link href={`/logistika/tabel?oy=${month}`} className="mr-2 text-blue-700 hover:underline">Hamma haydovchilar</Link>}
            <Link href={link(shiftMonth(month, -1))} className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100" aria-label="Oldingi oy"><ChevronLeft size={16} /></Link>
            <span className="font-medium">{monthTitle(month)}</span>
            {month < cur && <Link href={link(shiftMonth(month, 1))} className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100" aria-label="Keyingi oy"><ChevronRight size={16} /></Link>}
          </div>
        }>
        <div className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-4 [&>*]:min-w-0">
          <StatCard label="Reyslar" value={picked ? picked.trips : total.trips} icon={Route} tone="info" />
          <StatCard label="Km" value={fmtNum(picked ? picked.km : total.km, 0)} hint="zavod → obyekt → zavod" icon={Users} />
          <StatCard label="Narxlangan summa" value={money(picked ? picked.sum : total.sum)} hint="oylikka tushadi" icon={Coins} tone="success" />
          <StatCard label="Narxsiz" value={picked ? picked.unpriced : total.unpriced} icon={Timer} tone={(picked ? picked.unpriced : total.unpriced) ? "warning" : "default"} />
        </div>

        {picked ? (
          <Card padded={false}>
            {monthTrips.length === 0 ? <Empty text="Bu oyda yetkazilgan reys yo'q" icon={Route} /> : <TripRows rows={[...monthTrips].reverse()} canPrice={canPrice} showDriver={false} />}
          </Card>
        ) : (
          <Card padded={false}>
            <Table>
              <thead><tr><Th>Haydovchi</Th><Th right>Reys</Th><Th right>Km</Th><Th right>Kutish</Th><Th right>Ishlagan soat</Th><Th right>Aylantirish</Th><Th right>Yoqilg&apos;i normasi</Th><Th right>Narxsiz</Th><Th right>Summa</Th></tr></thead>
              <tbody>
                {drivers.length === 0 && <Empty text="Bu oyda yetkazilgan reys yo'q" icon={Users} />}
                {drivers.map((d) => (
                  <Tr key={d.id}>
                    <Td><Link href={`/logistika/tabel?oy=${month}&driver=${d.id}`} className="font-medium hover:underline">{d.name}</Link></Td>
                    <Td right className="tabular">{d.trips}</Td>
                    <Td right className="tabular">{fmtNum(d.km, 0)}</Td>
                    <Td right className="tabular">{hours(d.wait)}</Td>
                    <Td right className="tabular">{fmtNum(d.hours, 1)}</Td>
                    <Td right className="tabular">{d.turns || "—"}</Td>
                    <Td right className="tabular">{[d.fuelL ? `${fmtNum(d.fuelL, 0)} l` : null, d.fuelM3 ? `${fmtNum(d.fuelM3, 0)} m³` : null].filter(Boolean).join(" + ") || "—"}</Td>
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
