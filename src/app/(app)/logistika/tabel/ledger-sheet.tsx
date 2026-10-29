import Link from "next/link";
import type { LedgerRow, LedgerTotals } from "@/lib/driver-ledger";
import { date, fmtNum } from "@/lib/format";
import { Sheet, SheetFoot, SheetHead, SheetTd, SheetTh, SheetTr } from "@/components/ui";
import { ExcelButton } from "@/app/(app)/logistika/excel-button";

/** Bo'sh / nol — «—», aks holda son (pul — butun so'm). */
const N = ({ v, frac = 0, neg }: { v: number | null; frac?: number; neg?: boolean }) =>
  v == null || Math.abs(v) < (frac ? 0.05 : 1) ? <span className="text-slate-300">—</span>
    : <span className={neg && v < 0 ? "font-semibold text-red-600" : undefined}>{fmtNum(v, frac)}</span>;

/** Sarf matni: «51,5» yoki «Dizel + metan» da «40 m³ + 12 l». */
const fuelUseCell = (r: LedgerRow) => (r.useExtra != null
  ? <span title="metan + dizel">{r.use != null ? fmtNum(r.use, 1) : "—"} <span className="text-slate-400">+ {fmtNum(r.useExtra, 1)} l</span></span>
  : <N v={r.use} frac={1} />);

/**
 * Haydovchi tabelining hisob varag'i (dispetcher Excel'i ko'rinishida) — `lib/driver-ledger.ts`.
 * Har reys yetkazilganda o'zi tushadi; qo'lda kiritiladigan narsa yo'q (reys haqi — dispetcher narxi yoki taklif).
 */
export function LedgerSheet({ rows, total, month, file, showDriver }: { rows: LedgerRow[]; total: LedgerTotals; month: string; file: string; showDriver: boolean }) {
  const units = new Set(rows.map((r) => r.unit));
  const unit = units.size === 1 ? [...units][0] : "m³ / l";
  const excel = rows.map((r) => ({
    Sana: date(r.deliveredAt), Nakladnoy: r.no, Mashina: r.plate, Haydovchi: r.driver, "Yuklash joyi": r.pickup, "Tushirish joyi": r.dropoff, Yuk: r.cargo,
    "Probeg, km": r.km, "Baraban, soat": r.workHours, Birlik: r.unit, "Qoldiq (oldin)": r.balBefore, Zapravka: r.refuel, Sarf: r.use, "Sarf, dizel l": r.useExtra, "Qoldiq (keyin)": r.balAfter,
    "Yoqilg'i, so'm": r.fuelSum, "Haydovchi haqi": r.pay, "Haq holati": r.amount != null ? "Narxlangan" : "Taklif", "Ta'mir": r.repair, Zapchast: r.parts, "Boshqa xarajat": r.other,
    "Jami xarajat": r.total, "Daromad P/R": r.revBank, "Daromad N/L": r.revCash, "Daromad (to'lov turi yo'q)": r.revOther, Foyda: r.profit, Izoh: r.remarks.join("; "),
  }));

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-slate-500">
          Reys yetkazilganda o&apos;zi tushadi: km — ECO/GPS izi (bo&apos;lmasa zayavka masofasi × 2), baraban soati — haydovchi yoki reys vaqti
          (yuklandi → yetkazildi), sarf — transport normasi, qoldiq — mashina bo&apos;yicha zapravkalar minus sarf.
        </p>
        <ExcelButton file={file} sheets={[{ name: "Hisob varag'i", rows: excel }]} />
      </div>
      <Sheet lang="uz">
        <SheetHead>
          <tr>
            <SheetTh rowSpan={2}>Sana</SheetTh>
            {showDriver && <SheetTh rowSpan={2}>Haydovchi</SheetTh>}
            <SheetTh rowSpan={2}>Yuklash joyi</SheetTh>
            <SheetTh rowSpan={2}>Tushirish joyi</SheetTh>
            <SheetTh rowSpan={2}>Yuk</SheetTh>
            <SheetTh rowSpan={2} right>Probeg, km</SheetTh>
            <SheetTh rowSpan={2} right title="Mikser barabani ishlagan soat">Baraban, soat</SheetTh>
            <SheetTh colSpan={4} tone="blue">Gaz / yoqilg&apos;i, {unit}</SheetTh>
            <SheetTh rowSpan={2} right tone="blue">Yoqilg&apos;i, so&apos;m</SheetTh>
            <SheetTh rowSpan={2} right>Haydovchi haqi</SheetTh>
            <SheetTh colSpan={3} tone="red">Xarajat</SheetTh>
            <SheetTh rowSpan={2} right tone="red">Jami xarajat</SheetTh>
            <SheetTh colSpan={3} tone="green">Bajarilgan (dastavka)</SheetTh>
            <SheetTh rowSpan={2} right tone="yellow">Foyda</SheetTh>
            <SheetTh rowSpan={2}>Izoh</SheetTh>
          </tr>
          <tr>
            <SheetTh right tone="blue">Qoldiq</SheetTh><SheetTh right tone="blue">Zapravka</SheetTh><SheetTh right tone="blue">Sarf</SheetTh><SheetTh right tone="blue">Qoldiq</SheetTh>
            <SheetTh right tone="red">Ta&apos;mir</SheetTh><SheetTh right tone="red">Zapchast</SheetTh><SheetTh right tone="red">Boshqa</SheetTh>
            <SheetTh right tone="green" title="Perechisleniye">P/R</SheetTh><SheetTh right tone="green" title="Naqd">N/L</SheetTh><SheetTh right tone="green" title="Zayavkada to'lov turi ko'rsatilmagan">Boshqa</SheetTh>
          </tr>
        </SheetHead>
        <tbody>
          {rows.map((r) => (
            <SheetTr key={r.id}>
              <SheetTd className="whitespace-nowrap">
                <Link href={`/trips/${r.id}`} className="hover:underline">{date(r.deliveredAt)}</Link>
                <div className="text-[11px] text-slate-500">{r.plate}</div>
              </SheetTd>
              {showDriver && <SheetTd className="whitespace-nowrap"><Link href={`/logistika/tabel?bolim=hisob&oy=${month}&driver=${r.driverId}`} className="hover:underline">{r.driver}</Link></SheetTd>}
              <SheetTd className="max-w-40 truncate" >{r.pickup}</SheetTd>
              <SheetTd className="max-w-52"><div className="truncate font-medium">{r.dropoff}</div>{r.address && <div className="truncate text-[11px] text-slate-500">{r.address}</div>}</SheetTd>
              <SheetTd className="whitespace-nowrap">{r.cargo}</SheetTd>
              <SheetTd right><N v={r.km} /></SheetTd>
              <SheetTd right><N v={r.workHours} frac={1} /></SheetTd>
              <SheetTd right tone="blue"><N v={r.balBefore} frac={1} neg /></SheetTd>
              <SheetTd right tone="blue"><N v={r.refuel} frac={1} /></SheetTd>
              <SheetTd right tone="blue">{fuelUseCell(r)}</SheetTd>
              <SheetTd right tone="blue" strong><N v={r.balAfter} frac={1} neg /></SheetTd>
              <SheetTd right tone="blue"><span title={r.fuelPriceMissing ? "Zapravka narxi topilmadi — summa to'liq emas" : undefined} className={r.fuelPriceMissing ? "text-amber-700" : undefined}><N v={r.fuelSum} /></span></SheetTd>
              <SheetTd right><span title={r.amount != null ? "Dispetcher narxi" : `Taklif: ${r.suggestText}`} className={r.amount == null ? "text-amber-700" : undefined}><N v={r.pay} /></span></SheetTd>
              <SheetTd right tone="red"><N v={r.repair} /></SheetTd>
              <SheetTd right tone="red"><N v={r.parts} /></SheetTd>
              <SheetTd right tone="red"><N v={r.other} /></SheetTd>
              <SheetTd right tone="red" strong><N v={r.total} /></SheetTd>
              <SheetTd right tone="green"><N v={r.revBank} /></SheetTd>
              <SheetTd right tone="green"><N v={r.revCash} /></SheetTd>
              <SheetTd right tone="green"><N v={r.revOther} /></SheetTd>
              <SheetTd right tone="yellow" strong><N v={r.profit} neg /></SheetTd>
              <SheetTd className="max-w-48 truncate text-[12px] text-slate-600">{r.remarks.join(" · ")}</SheetTd>
            </SheetTr>
          ))}
        </tbody>
        <SheetFoot>
          <tr>
            <SheetTd colSpan={showDriver ? 5 : 4}>Jami: {total.trips} reys</SheetTd>
            <SheetTd right><N v={total.km} /></SheetTd>
            <SheetTd right><N v={total.hours} frac={1} /></SheetTd>
            <SheetTd />
            <SheetTd right><N v={total.refuel} frac={1} /></SheetTd>
            <SheetTd right>{[total.useGas ? `${fmtNum(total.useGas, 1)} m³` : null, total.useDt ? `${fmtNum(total.useDt, 1)} l` : null].filter(Boolean).join(" + ") || "—"}</SheetTd>
            <SheetTd />
            <SheetTd right><N v={total.fuelSum} /></SheetTd>
            <SheetTd right><N v={total.pay} /></SheetTd>
            <SheetTd right><N v={total.repair} /></SheetTd>
            <SheetTd right><N v={total.parts} /></SheetTd>
            <SheetTd right><N v={total.other} /></SheetTd>
            <SheetTd right><N v={total.total} /></SheetTd>
            <SheetTd right><N v={total.revBank} /></SheetTd>
            <SheetTd right><N v={total.revCash} /></SheetTd>
            <SheetTd right><N v={total.revOther} /></SheetTd>
            <SheetTd right><N v={total.profit} neg /></SheetTd>
            <SheetTd />
          </tr>
        </SheetFoot>
      </Sheet>
    </div>
  );
}
