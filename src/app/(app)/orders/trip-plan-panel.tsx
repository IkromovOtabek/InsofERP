"use client";

import { useEffect, useMemo, useState } from "react";
import { Boxes, Clock, Container, Gauge, Route, Truck, Weight } from "lucide-react";
import { Badge, Button, Callout, Card, CardHeader, StatCard, Table, Td, Th, Tr, type BadgeColor } from "@/components/ui";
import { fmtNum, isoDate, date as fmtDate } from "@/lib/format";
import { concretePlan, piecePlan, PLAN, type DayFleet, type PlanWarn, type VehicleUse } from "@/lib/trip-plan";
import { loadDayFleet } from "./plan-actions";

export type PlanRow = { code: string; name: string; unit: string; qty: number };

const STATE: Record<VehicleUse["state"], { l: string; c: BadgeColor }> = {
  use: { l: "Ishlaydi", c: "green" },
  partial: { l: "Qisman band", c: "amber" },
  busy: { l: "Band", c: "slate" },
  reserved: { l: "Boshqa zayavka", c: "violet" },
  repair: { l: "Ta'mirda", c: "red" },
  spare: { l: "Zaxira", c: "blue" },
};

const n1 = (n: number) => fmtNum(n, 1);
const dur = (min: number) => {
  const m = Math.round(min);
  return m >= 60 ? `${Math.floor(m / 60)} soat${m % 60 ? ` ${m % 60} daq` : ""}` : `${m} daq`;
};

/**
 * Zayavka formasidagi «Reys va transport hisobi»: mahsulot, miqdor, masofa, nasos va sana o'zgarishi bilan
 * jonli qayta hisoblanadi — necha reys, nechta mashina, o'zimiznikidan qaysilari bo'sh, yana nechtasini yollash kerak.
 * Mantiq — `lib/trip-plan.ts`, kunlik bandlik — `lib/trip-plan-day.ts`.
 */
export function TripPlanPanel({ rows, km, kmSource, pump, day, onApplyTrips }: {
  rows: PlanRow[]; km: number | null; kmSource: "ROUTE" | "LINE" | null; pump: boolean;
  /** "YYYY-MM-DD"; null — sana hali aniq emas (bandlik hisobga olinmaydi). */
  day: string | null;
  /** Dastavka qatoridagi reys sonini shu hisob bilan to'ldirish. */
  onApplyTrips: (n: number) => void;
}) {
  const [fleet, setFleet] = useState<DayFleet | null>(null);
  const [failed, setFailed] = useState(false);
  const fetchDay = day ?? "";

  useEffect(() => {
    let alive = true;
    const target = fetchDay || isoTomorrow();
    loadDayFleet(target)
      .then((f) => { if (alive) { setFleet(f); setFailed(false); } })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [fetchDay]);

  // Sana aniq bo'lmasa — bandliksiz: faqat parkning o'zi
  const view = useMemo<DayFleet | null>(() => {
    if (!fleet) return null;
    if (day) return fleet;
    return { ...fleet, vehicles: fleet.vehicles.map((v) => ({ ...v, busyMin: 0, busyNote: null })), other: { orders: 0, m3: 0, tons: 0, mixerMin: 0, truckMin: 0, pumps: 0 } };
  }, [fleet, day]);

  const m3 = rows.filter((r) => r.unit === "m³").reduce((s, r) => s + (r.qty > 0 ? r.qty : 0), 0);
  const pieces = rows.filter((r) => r.unit !== "m³" && r.qty > 0);
  const month = day ? parseDay(day).getMonth() : undefined;
  const concrete = m3 > 0 ? concretePlan({ m3, km, pump, fleet: view, month }) : null;
  const piece = pieces.length ? piecePlan({ items: pieces, km, fleet: view }) : null;

  if (!concrete && !piece) return null;
  const totalTrips = (concrete?.trips ?? 0) + (piece?.trips ?? 0);
  const kmText = km == null ? `${PLAN.defaultKm} km (taxminiy)` : `${n1(km)} km${kmSource === "LINE" ? " (to'g'ri chiziq)" : ""}`;

  return (
    <Card>
      <CardHeader icon={Truck} title="Reys va transport hisobi"
        description={`${day ? fmtDate(parseDay(day)) : "Sana aniq emas — bandlik hisobga olinmadi"} · masofa ${kmText}${view ? ` · smena ${dur(view.shiftMin)}` : ""}`}
        action={totalTrips > 0 ? <Button type="button" size="sm" variant="secondary" onClick={() => onApplyTrips(totalTrips)}>Dastavkaga {totalTrips} reys qo&apos;yish</Button> : undefined} />

      {failed && <Callout tone="warning">Transport bandligini olib bo&apos;lmadi — hisob o&apos;zimizning mashinalarsiz ko&apos;rsatilmoqda.</Callout>}
      {view && day && view.other.orders > 0 && (
        <p className="mb-3 text-xs text-slate-500">
          Shu kuni yana <b className="text-slate-700">{view.other.orders} ta zayavka</b>
          {view.other.m3 > 0 && <> · {n1(view.other.m3)} m³ beton</>}
          {view.other.tons > 0 && <> · {n1(view.other.tons)} t dona mahsulot</>} — transportning bir qismi ularga ketadi.
        </p>
      )}

      {concrete && (
        <section className="space-y-3">
          <h4 className="text-sm font-semibold text-slate-900">Beton · {n1(concrete.m3)} m³</h4>
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <StatCard icon={Route} label="Reys" value={concrete.trips}
              hint={concrete.days > 1 ? `${concrete.days} kunda` : concrete.lastLoad > 0 && concrete.trips > 1 ? `oxirgisi ${n1(concrete.lastLoad)} m³` : undefined} />
            <StatCard icon={Container} label="Mikser kerak" value={concrete.ownUsed + concrete.hired} tone={concrete.hired ? "warning" : "success"}
              hint={concrete.hired ? `${concrete.ownUsed} o'zimizniki + ${concrete.hired} yollanma` : "hammasi o'zimizniki"} />
            <StatCard icon={Gauge} label="Nasos" value={concrete.pumps || "—"} hint={pump ? `${concrete.rate} m³/soat` : `tarnov, ${concrete.rate} m³/soat`} />
            <StatCard icon={Clock} label={concrete.days > 1 ? "Quyish, kuniga" : "Quyish"} value={dur(concrete.pourMin)} tone={concrete.days > 1 ? "danger" : "default"}
              hint={concrete.trips > 1 ? `har ${Math.round(concrete.intervalMin)} daqiqada mikser` : undefined} />
          </div>

          <CycleBar parts={[
            { l: "Yuklash", v: concrete.cycle.load, c: "bg-slate-400" },
            { l: "Yo'l", v: concrete.cycle.out, c: "bg-amber-400" },
            { l: "Obyekt", v: concrete.cycle.site, c: "bg-violet-400" },
            { l: "Tushirish", v: concrete.cycle.unload, c: "bg-emerald-500" },
            { l: "Yuvish", v: concrete.cycle.wash, c: "bg-sky-400" },
            { l: "Qaytish", v: concrete.cycle.back, c: "bg-amber-200" },
          ]} total={concrete.cycle.total} title="Bitta mikser aylanishi" />

          <VehicleTable rows={concrete.own} unit="m³" hired={concrete.hired ? { count: concrete.hired, trips: concrete.hiredTrips * concrete.days, amount: concrete.hiredM3 * concrete.days, cap: `${PLAN.hiredMixerM3} m³` } : null}
            days={concrete.days} empty="O'zimizda faol mikser yo'q" />
          <Warns list={concrete.warns} />
        </section>
      )}

      {piece && (
        <section className={concrete ? "mt-6 space-y-3 border-t border-slate-100 pt-5" : "space-y-3"}>
          <h4 className="text-sm font-semibold text-slate-900">Dona mahsulot · {pieces.length} xil</h4>
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <StatCard icon={Weight} label="Yuk og'irligi" value={`${n1(piece.tons)} t`} hint={piece.unknown.length ? `${piece.unknown.length} xil hisobga kirmadi` : "taxminiy, GOST bo'yicha"} />
            <StatCard icon={Route} label="Reys" value={piece.trips} />
            <StatCard icon={Truck} label="Bort mashina kerak" value={piece.ownUsed + piece.hired} tone={piece.hired ? "warning" : "success"}
              hint={piece.hired ? `${piece.ownUsed} o'zimizniki + ${piece.hired} yollanma (${PLAN.hiredTruckT} t)` : "hammasi o'zimizniki"} />
            <StatCard icon={Clock} label="Bitta reys" value={dur(piece.cycleMin)} hint="yuklash, yo'l, tushirish, qaytish" />
          </div>

          <VehicleTable rows={piece.own} unit="t" hired={piece.hired ? { count: piece.hired, trips: piece.hiredTrips, amount: piece.loads.filter((l) => l.hired).reduce((s, l) => s + l.kg, 0) / 1000, cap: `${PLAN.hiredTruckT} t` } : null}
            days={1} empty="O'zimizda faol bort mashina yo'q" />

          {piece.loads.length > 0 && <Loads loads={piece.loads} />}
          <Warns list={piece.warns} />
        </section>
      )}

      <p className="mt-4 text-[11px] leading-relaxed text-slate-400">
        Taxminiy reja: o&apos;rtacha tezlik {PLAN.speedLoaded}/{PLAN.speedEmpty} km/soat, yuklash {PLAN.loadMin} daq, nasos {PLAN.pumpRate}–{PLAN.pumpMax} m³/soat, yollanma mikser {PLAN.hiredMixerM3} m³.
        Mashina sig&apos;imi — Logistika → Transport kartasidagi «sig&apos;im» (bir reysdagi haqiqiy yuk).
      </p>
    </Card>
  );
}

function CycleBar({ parts, total, title }: { parts: { l: string; v: number; c: string }[]; total: number; title: string }) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between text-xs">
        <span className="font-medium text-slate-600">{title}</span>
        <span className="font-semibold text-slate-900">{dur(total)}</span>
      </div>
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
        {parts.map((p) => <div key={p.l} className={p.c} style={{ width: `${(p.v / total) * 100}%` }} title={`${p.l}: ${Math.round(p.v)} daq`} />)}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500">
        {parts.map((p) => <span key={p.l} className="inline-flex items-center gap-1"><span className={`h-2 w-2 rounded-full ${p.c}`} />{p.l} {Math.round(p.v)}</span>)}
      </div>
    </div>
  );
}

function VehicleTable({ rows, unit, hired, days, empty }: {
  rows: VehicleUse[]; unit: string; days: number; empty: string;
  hired: { count: number; trips: number; amount: number; cap: string } | null;
}) {
  return (
    <Table>
        <thead><tr><Th>Mashina</Th><Th>Holat</Th><Th right>Reys</Th><Th right>Tashiydi</Th></tr></thead>
        <tbody>
          {rows.length === 0 && !hired && <tr><Td colSpan={4} className="text-center text-slate-400">{empty}</Td></tr>}
          {rows.map((v) => (
            <Tr key={v.id}>
              <Td><span className="font-semibold">{v.plate}</span> <span className="text-xs font-normal text-slate-500">{v.cap}</span></Td>
              <Td><div className="flex flex-wrap items-center gap-1.5"><Badge color={STATE[v.state].c}>{STATE[v.state].l}</Badge><span className="text-xs text-slate-500">{v.note}</span></div></Td>
              <Td right>{v.trips ? v.trips * days : "—"}</Td>
              <Td right>{v.amount ? `${n1(v.amount * days)} ${unit}` : "—"}</Td>
            </Tr>
          ))}
          {hired && (
            <Tr className="bg-amber-50/50">
              <Td><span className="font-semibold">Yollanma × {hired.count}</span> <span className="text-xs font-normal text-slate-500">{hired.cap} dan</span></Td>
              <Td><Badge color="amber">Yollash kerak</Badge></Td>
              <Td right>{hired.trips}</Td>
              <Td right>{n1(hired.amount)} {unit}</Td>
            </Tr>
          )}
        </tbody>
    </Table>
  );
}

function Loads({ loads }: { loads: { plate: string; hired: boolean; kg: number; capKg: number; lines: { name: string; qty: number; unit: string }[] }[] }) {
  const [all, setAll] = useState(false);
  const shown = all ? loads : loads.slice(0, 5);
  return (
    <div>
      <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-slate-600"><Boxes size={14} /> Reyslarga taqsimot</div>
      <ol className="space-y-1.5">
        {shown.map((l, i) => (
          <li key={i} className="rounded-lg border border-slate-100 px-3 py-2 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold text-slate-800">{i + 1}-reys · {l.plate}</span>
              <span className="tabular text-slate-500">{n1(l.kg / 1000)} / {n1(l.capKg / 1000)} t</span>
            </div>
            <div className="mt-1 text-slate-600">{l.lines.map((x) => `${x.name} — ${fmtNum(x.qty)} ${x.unit}`).join("; ")}</div>
          </li>
        ))}
      </ol>
      {loads.length > 5 && (
        <button type="button" onClick={() => setAll((v) => !v)} className="mt-1.5 text-xs font-medium text-brand-700 hover:underline">
          {all ? "Yig'ish" : `Yana ${loads.length - 5} reys`}
        </button>
      )}
    </div>
  );
}

function Warns({ list }: { list: PlanWarn[] }) {
  if (!list.length) return null;
  return <div>{list.map((w) => <Callout key={w.text} tone={w.tone}>{w.text}</Callout>)}</div>;
}

const isoTomorrow = () => isoDate(new Date(Date.now() + 86400000));
/** "2026-10-28" → mahalliy yarim tun (`lib/logistics` dagi `parseDay` serverda — u bazani import qiladi). */
const parseDay = (s: string) => { const [y, m, d] = s.split("-").map(Number); return new Date(y!, m! - 1, d); };
