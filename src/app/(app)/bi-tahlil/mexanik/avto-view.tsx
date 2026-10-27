import Link from "next/link";
import { Fuel, Gauge, Truck, Wallet } from "lucide-react";
import type { AvtoReport, AvtoRow } from "@/lib/fin-report/avto";
import { date, fmtNum, moneyShort } from "@/lib/format";
import { Section, StatCard, Table, Td, Th, Tr } from "@/components/ui";
import { ExcelButton } from "@/app/(app)/logistika/excel-button";
import { cn } from "@/lib/utils";
import { MonthBar, monthTitle } from "../month-bar";

/** «AVTOTRANSPORT TAHLILI — har bir mashina va kunlik solishtirish» (`lib/fin-report/avto.ts`). */
const N = ({ v, frac = 0, className }: { v: number | null; frac?: number; className?: string }) =>
  v == null || Math.abs(v) < (frac ? 0.05 : 1) ? <span className="text-slate-300">—</span> : <span className={className}>{fmtNum(v, frac)}</span>;
const diffCls = (v: number | null) => (v == null ? "" : v > 0.5 ? "font-semibold text-red-600" : v < -0.5 ? "text-emerald-700" : "");
const sticky = "sticky left-0 z-[1] bg-white";

export function AvtoView({ r, base }: { r: AvtoReport; base: string }) {
  const t = r.total;
  const hasDt = r.rows.some((x) => x.dtNorm != null || x.dtGiven), hasGas = r.rows.some((x) => x.gasNorm != null || x.gasGiven);
  const dtDiff = (x: AvtoRow) => (x.dtNorm != null ? x.dtGiven - x.dtNorm : null);
  const gasDiff = (x: AvtoRow) => (x.gasNorm != null ? x.gasGiven - x.gasNorm : null);
  const overFuel = t.fuelNormSum != null ? t.fuelSum - t.fuelNormSum : null;
  const normSum = r.rows.some((x) => x.fuelNormSum != null) ? r.rows.reduce((s, x) => s + (x.fuelNormSum ?? 0), 0) : null;
  const sheet = (x: AvtoRow) => ({
    Mashina: x.plate, Turi: [x.type, x.model].filter(Boolean).join(" · "), Reys: x.trips, "Probeg (km)": x.km, "Baraban (soat)": x.hours,
    "DT norma (l)": x.dtNorm, "DT berilgan (l)": x.dtGiven, "DT farq (l)": dtDiff(x), "Gaz norma (m3)": x.gasNorm, "Gaz zapravka (m3)": x.gasGiven, "Gaz farq (m3)": gasDiff(x),
    "Yoqilg'i summasi": x.fuelSum, "Yoqilg'i summasi, norma": x.fuelNormSum, "Ish haqi": x.pay, "Remont + zapchast": x.repair, "Boshqa xarajat": x.other, "Jami xarajat": x.total,
    Daromad: x.revenue, Foyda: x.profit, "Xarajat 1 km ga": x.perKm, "Kassadan chiqqan": x.cash, "Mexanik (to'langan so'rovlar)": x.mechanic, "Farq: kassa − mexanik": x.cashDiff, "Sklad kirimi reysi": x.supplyTrips,
  });
  const active = r.rows.filter((x) => x.trips || x.fuelSum || x.total || x.cash || x.mechanic);
  const idle = r.rows.length - active.length;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[17px] font-bold text-slate-900">Avtotransport tahlili — {monthTitle(r.month)}</h2>
        <span className="text-[13px] text-slate-500">Har bir mashina va kunlik solishtirish</span>
      </div>
      <MonthBar base={base} month={r.month}>
        <ExcelButton file={`Avtotransport tahlili ${r.month}`} sheets={[
          { name: "Har bir mashina", rows: [...r.rows, t].map(sheet) },
          { name: "Kunlik", rows: r.days.map((d) => ({ Sana: date(d.date), Reys: d.trips, "Probeg (km)": d.km, "DT berilgan (l)": d.dtGiven, "Gaz zapravka (m3)": d.gasGiven, "Yoqilg'i summasi": d.fuelSum, "Ish haqi": d.pay, "Remont + zapchast": d.repair, "Mexanik naqd": d.mechanic, Kassa: d.cash, "Farq: kassa − mexanik": d.cashDiff, Daromad: d.revenue, Foyda: d.profit })) },
        ]} />
      </MonthBar>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatCard label="Reyslar" value={fmtNum(t.trips)} hint={`${fmtNum(t.km)} km · ${active.length} mashina ishladi`} icon={Truck} />
        <StatCard label="Yoqilg'i (berilgan)" value={moneyShort(t.fuelSum)} hint={normSum != null ? `norma ${moneyShort(normSum)}${overFuel != null && Math.abs(overFuel) >= 1 ? ` · ${overFuel > 0 ? "ortiqcha" : "tejaldi"} ${moneyShort(Math.abs(t.fuelSum - normSum))}` : ""}` : "norma kiritilmagan"} icon={Fuel} tone={normSum != null && t.fuelSum > normSum * 1.05 ? "danger" : "default"} />
        <StatCard label="Jami xarajat" value={moneyShort(t.total)} hint={t.perKm != null ? `1 km ga ${fmtNum(t.perKm)} so'm` : "yoqilg'i + ish haqi + remont"} icon={Gauge} />
        <StatCard label="Foyda (dastavka)" value={moneyShort(t.profit)} hint={`daromad ${moneyShort(t.revenue)}`} icon={Wallet} tone={t.profit < 0 ? "danger" : "success"} />
      </div>

      <Section title="1. Har bir mashina bo'yicha (oy boshidan)" className="mt-2">
        <Table maxHeight="70vh">
          <thead>
            <tr>
              <Th className="left-0 z-[3]">Mashina</Th>
              <Th right>Reys</Th><Th right>Probeg, km</Th><Th right>Baraban, soat</Th>
              {hasDt && <><Th right className="text-amber-700">DT norma, l</Th><Th right className="text-amber-700">DT berilgan, l</Th><Th right className="text-amber-700">DT farq, l</Th></>}
              {hasGas && <><Th right className="text-sky-700">Gaz norma, m³</Th><Th right className="text-sky-700">Gaz zapravka, m³</Th><Th right className="text-sky-700">Gaz farq, m³</Th></>}
              <Th right>Yoqilg&apos;i summasi</Th><Th right>Yoqilg&apos;i, norma</Th><Th right>Ish haqi</Th><Th right>Remont + zapchast</Th><Th right>Boshqa</Th>
              <Th right className="text-slate-700">Jami xarajat</Th><Th right>Daromad</Th><Th right>Foyda</Th><Th right>1 km ga</Th>
              <Th right className="text-violet-700">Kassadan chiqqan</Th><Th right className="text-violet-700">Mexanik</Th><Th right className="text-violet-700">Farq: kassa − mexanik</Th>
              <Th right>Sklad kirimi reysi</Th>
            </tr>
          </thead>
          <tbody>
            {active.map((x) => (
              <Tr key={x.id}>
                <Td className={cn(sticky, "min-w-44")}>
                  <Link href={`/logistika/transport/${x.id}`} className="font-semibold hover:underline">{x.plate}</Link>
                  <div className="text-xs font-normal text-slate-500">{[x.type, x.model].filter(Boolean).join(" · ")}</div>
                </Td>
                <Td right><N v={x.trips} /></Td><Td right><N v={x.km} /></Td><Td right><N v={x.hours} frac={1} /></Td>
                {hasDt && <><Td right><N v={x.dtNorm} frac={1} /></Td><Td right><N v={x.dtGiven} frac={1} /></Td><Td right><N v={dtDiff(x)} frac={1} className={diffCls(dtDiff(x))} /></Td></>}
                {hasGas && <><Td right><N v={x.gasNorm} frac={1} /></Td><Td right><N v={x.gasGiven} frac={1} /></Td><Td right><N v={gasDiff(x)} frac={1} className={diffCls(gasDiff(x))} /></Td></>}
                <Td right><N v={x.fuelSum} /></Td><Td right><N v={x.fuelNormSum} className="text-slate-500" /></Td><Td right><N v={x.pay} /></Td><Td right><N v={x.repair} /></Td><Td right><N v={x.other} /></Td>
                <Td right className="bg-slate-50 font-semibold text-slate-900"><N v={x.total} /></Td>
                <Td right><N v={x.revenue} /></Td>
                <Td right><N v={x.profit} className={x.profit < 0 ? "font-semibold text-red-600" : "font-semibold text-emerald-700"} /></Td>
                <Td right><N v={x.perKm} /></Td>
                <Td right><N v={x.cash} /></Td><Td right><N v={x.mechanic} /></Td><Td right><N v={x.cashDiff} className={Math.abs(x.cashDiff) >= 1 ? "font-semibold text-amber-700" : ""} /></Td>
                <Td right><N v={x.supplyTrips} /></Td>
              </Tr>
            ))}
            {active.length === 0 && <tr><td colSpan={24} className="px-4 py-10 text-center text-sm text-slate-500">Bu oyda transport harakati yo&apos;q</td></tr>}
          </tbody>
          {active.length > 0 && (
            <tfoot>
              <tr className="bg-slate-50 font-bold text-slate-900 [&>td]:whitespace-nowrap [&>td]:border-t-2 [&>td]:border-slate-200 [&>td]:px-4 [&>td]:py-3 [&>td:not(:first-child)]:text-right [&>td]:tabular">
                <td className="sticky left-0 bg-slate-50">JAMI</td>
                <td>{fmtNum(t.trips)}</td><td>{fmtNum(t.km)}</td><td>{fmtNum(t.hours, 1)}</td>
                {hasDt && <><td>{t.dtNorm != null ? fmtNum(t.dtNorm, 1) : "—"}</td><td>{fmtNum(t.dtGiven, 1)}</td><td>{t.dtNorm != null ? fmtNum(t.dtGiven - t.dtNorm, 1) : "—"}</td></>}
                {hasGas && <><td>{t.gasNorm != null ? fmtNum(t.gasNorm, 1) : "—"}</td><td>{fmtNum(t.gasGiven, 1)}</td><td>{t.gasNorm != null ? fmtNum(t.gasGiven - t.gasNorm, 1) : "—"}</td></>}
                <td>{fmtNum(t.fuelSum)}</td><td>{normSum != null ? fmtNum(normSum) : "—"}</td><td>{fmtNum(t.pay)}</td><td>{fmtNum(t.repair)}</td><td>{fmtNum(t.other)}</td>
                <td>{fmtNum(t.total)}</td><td>{fmtNum(t.revenue)}</td><td className={t.profit < 0 ? "text-red-600" : ""}>{fmtNum(t.profit)}</td><td>{t.perKm != null ? fmtNum(t.perKm) : "—"}</td>
                <td>{fmtNum(t.cash)}</td><td>{fmtNum(t.mechanic)}</td><td>{fmtNum(t.cashDiff)}</td><td>{fmtNum(t.supplyTrips)}</td>
              </tr>
            </tfoot>
          )}
        </Table>
        {idle > 0 && <p className="mt-2 text-[13px] text-slate-500">Bu oyda harakati bo&apos;lmagan {idle} ta faol mashina jadvalda ko&apos;rsatilmadi (Excel faylida bor).</p>}
      </Section>

      <Section title="2. Kunlik: mexanik hisoboti ↔ kassa">
        <Table maxHeight="70vh">
          <thead>
            <tr>
              <Th className="left-0 z-[3]">Sana</Th><Th right>Reys</Th><Th right>Probeg, km</Th>
              {hasDt && <Th right>DT berilgan, l</Th>}{hasGas && <Th right>Gaz zapravka, m³</Th>}
              <Th right>Yoqilg&apos;i summasi</Th><Th right>Ish haqi</Th><Th right>Remont + zapchast</Th>
              <Th right className="text-violet-700">Mexanik naqd</Th><Th right className="text-violet-700">Kassa</Th><Th right className="text-violet-700">Farq: kassa − mexanik</Th>
              <Th right>Daromad</Th><Th right>Foyda</Th>
            </tr>
          </thead>
          <tbody>
            {r.days.map((d) => {
              const empty = !d.trips && !d.fuelSum && !d.pay && !d.repair && !d.cash && !d.mechanic;
              return (
                <Tr key={d.date.toISOString()} className={empty ? "text-slate-400" : undefined}>
                  <Td className={cn(sticky, "whitespace-nowrap", empty && "font-normal text-slate-400")}>{date(d.date)}</Td>
                  <Td right><N v={d.trips} /></Td><Td right><N v={d.km} /></Td>
                  {hasDt && <Td right><N v={d.dtGiven} frac={1} /></Td>}{hasGas && <Td right><N v={d.gasGiven} frac={1} /></Td>}
                  <Td right><N v={d.fuelSum} /></Td><Td right><N v={d.pay} /></Td><Td right><N v={d.repair} /></Td>
                  <Td right><N v={d.mechanic} /></Td><Td right><N v={d.cash} /></Td><Td right><N v={d.cashDiff} className={Math.abs(d.cashDiff) >= 1 ? "font-semibold text-amber-700" : ""} /></Td>
                  <Td right><N v={d.revenue} /></Td><Td right><N v={d.profit} className={d.profit < 0 ? "text-red-600" : "text-emerald-700"} /></Td>
                </Tr>
              );
            })}
          </tbody>
        </Table>
      </Section>

      <ul className="space-y-1 text-[13px] text-slate-500">
        <li>Probeg — zavod → obyekt → zavod (GPS izi, bo&apos;lmasa zayavkadagi masofa × 2), haydovchi tabeli bilan bir xil. Norma — transport kartasidagi 100 km va soatlik norma.</li>
        <li>Daromad — zayavka dastavka haqi reyslarga hajm ulushida. Kassadan chiqqan — izohida yoki «kimga» ustunida shu mashina raqami to&apos;liq yozilgan chiqimlar.</li>
        <li>Mexanik — to&apos;langan mexanik so&apos;rovlari. Farq 0 bo&apos;lmasa — kassa chiqimi so&apos;rovsiz qilingan yoki so&apos;rov boshqa mashinaga yozilgan.</li>
      </ul>
    </div>
  );
}
