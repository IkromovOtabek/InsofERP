import { Radio } from "lucide-react";
import { requireRoles } from "@/lib/page-guard";
import { monitorRows } from "@/lib/logistics-monitor";
import { minutesLabel } from "@/lib/logistics";
import { Badge, Card, CardHeader, Empty, PageHeader, Table, Td, Th, Tr } from "@/components/ui";
import { LiveDrivers } from "../../trips/live-drivers";
import { DelayText, PhaseBadge, TripLink } from "../ui";

export const dynamic = "force-dynamic";

const hm = (d: Date | null) => (d ? `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}` : "—");

/**
 * GPS / Monitoring (TZ 9): real vaqt joylashuvi, marshrut, tezlik, to'xtashlar, ETA, kechikish.
 * Xarita — mavjud jonli xarita (15 s da yangilanadi); jadval sahifa bilan 30 s da.
 */
export default async function MonitoringPage() {
  await requireRoles(["LOGISTICS", "PRODUCTION", "SUPERVISOR"]);
  const { rows, gpsSilentMin, error } = await monitorRows();
  return (
    <div>
      <PageHeader title="GPS / Monitoring" subtitle="Yo'ldagi transport: joylashuv, tezlik, to'xtashlar, obyektgacha ETA. Mashinani bossangiz — yurgan yo'li chiziladi" />
      <LiveDrivers title="Jonli xarita" />
      {error && <p className="mt-2 text-xs text-amber-700">ECO: {error}</p>}
      <Card padded={false} className="mt-5">
        <div className="px-5 pt-5"><CardHeader title="Yo'ldagi reyslar" description={`GPS ${gpsSilentMin} daqiqadan ko'p kelmasa — qizil`} icon={Radio} /></div>
        <Table>
          <thead><tr><Th>Nakladnoy</Th><Th>Transport</Th><Th>Bosqich</Th><Th>Chiqdi</Th><Th right>Yurdi</Th><Th right>Tezlik</Th><Th>To'xtashlar</Th><Th right>Qoldi</Th><Th right>ETA</Th><Th>Reja</Th><Th>Kechikish</Th><Th>GPS</Th></tr></thead>
          <tbody>
            {rows.length === 0 && <Empty text="Hozir yo'lda mashina yo'q" />}
            {rows.map((t) => (
              <Tr key={t.id}>
                <Td><TripLink id={t.id} noteNo={t.noteNo} /><div className="max-w-[12rem] truncate text-xs text-slate-500">{t.customer}</div></Td>
                <Td><div className="tabular">{t.plate}</div><div className="text-xs text-slate-500">{t.driver}</div></Td>
                <Td><PhaseBadge phase={t.phase} /></Td>
                <Td className="tabular text-sm">{hm(t.departedAt ?? t.loadedAt)}</Td>
                <Td right className="tabular">{t.km ? `${t.km.toFixed(1)} km` : "—"}</Td>
                <Td right className="tabular">{t.speedKmh != null ? `${t.speedKmh} km/s` : t.avgKmh != null ? <span className="text-slate-500">o'rt. {t.avgKmh}</span> : "—"}</Td>
                <Td className="text-sm">
                  {t.stopNowMin != null ? <Badge color={t.stopNowMin >= 15 ? "red" : "amber"}>turibdi {minutesLabel(t.stopNowMin)}</Badge> : null}
                  {t.stops.length > 0 && <div className="text-xs text-slate-500">{t.stops.length} ta · {minutesLabel(t.stops.reduce((a, s) => a + s.minutes, 0))}</div>}
                  {t.stops.length === 0 && t.stopNowMin == null && <span className="text-slate-400">—</span>}
                </Td>
                <Td right className="tabular">{t.fix?.remainingKm != null ? `${t.fix.remainingKm.toFixed(1)} km` : "—"}</Td>
                <Td right className="tabular">{t.fix?.etaMin != null && t.phase === "ON_ROAD" ? `${t.fix.etaMin} daq` : "—"}</Td>
                <Td className="tabular text-sm">{hm(t.plannedAt)}</Td>
                <Td><DelayText min={t.delayMin} level={t.level} /></Td>
                <Td>{t.fixAgeMin == null ? <Badge color="red">nuqta yo'q</Badge> : t.fixAgeMin >= gpsSilentMin ? <Badge color="red">{t.fixAgeMin} daq jim</Badge> : <Badge color="green">{t.fixAgeMin} daq oldin</Badge>}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </Card>
      <p className="mt-3 text-xs text-slate-500">To'xtash — 60 m radiusda 5 daqiqadan ko'p turish. ETA: ECO bersa o'shani, bo'lmasa obyektgacha masofa ÷ o'rtacha tezlik (Logistika sozlamalari).</p>
    </div>
  );
}
