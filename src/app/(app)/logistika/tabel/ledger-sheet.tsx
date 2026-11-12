import Link from "next/link";
import { Undo2 } from "lucide-react";
import { driverPaySums, type LedgerRow, type LedgerTotals } from "@/lib/driver-ledger";
import { date, dateTime, fmtNum } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Sheet, SheetFoot, SheetHead, SheetTd, SheetTh, SheetTr } from "@/components/ui";
import { ExcelButton } from "@/app/(app)/logistika/excel-button";
import { ConfirmButton } from "../../payments/confirm-button";
import { cancelEntryAction } from "../actions";
import { KmFix, LedgerEditButton } from "./ledger-forms";

/** Bo'sh / nol — «—», aks holda son (pul — butun so'm). */
const N = ({ v, frac = 0, neg }: { v: number | null; frac?: number; neg?: boolean }) =>
  v == null || Math.abs(v) < (frac ? 0.05 : 1) ? <span className="text-slate-300">—</span>
    : <span className={neg && v < 0 ? "font-semibold text-red-600" : undefined}>{fmtNum(v, frac)}</span>;

/** Sarf matni: «51,5» yoki «Dizel + metan» da «40 m³ + 12 l». */
const fuelUseCell = (r: LedgerRow) => (r.useExtra != null
  ? <span title="metan + dizel">{r.use != null ? fmtNum(r.use, 1) : "—"} <span className="text-slate-400">+ {fmtNum(r.useExtra, 1)} l</span></span>
  : <N v={r.use} frac={1} />);

/** Haq holati: narxlangan / qo'lda — summa; reysda narx qo'yilmagan bo'lsa taklif (sariq). */
const payTitle = (r: LedgerRow) => (r.amount == null ? `Taklif: ${r.suggestText ?? ""}`
  : `${r.payType === "CASH" ? "Naqd" : r.payType === "PAYROLL" ? "Oylik" : "Narxlangan"}${r.approvedAt ? " · tasdiqlangan" : r.payType ? " · tasdiq kutilmoqda" : ""}`);

/** Excel varaq nomi: taqiqlangan belgilarsiz, 31 belgigacha. */
const sheetName = (s: string) => s.replace(/[[\]:*?/\\]/g, " ").trim().slice(0, 31) || "Varaq";

const excelRow = (r: LedgerRow, money: boolean) => ({
  Sana: date(r.at), Hujjat: r.no, Manba: r.kind === "trip" ? "ECO / reys" : r.kind === "entry" ? "Qo'lda" : "Reyssiz xarajat",
  Mashina: r.plate, Haydovchi: r.driver, "Yuklash joyi": r.pickup, "Tushirish joyi": r.dropoff, Reys: r.trips, Yuk: r.cargo,
  "Probeg, km": r.km, "Baraban, soat": r.workHours, "Baraban sarfi": r.drumUse, Birlik: r.unit, "Qoldiq (oldin)": r.balBefore, Zapravka: r.refuel, Sarf: r.use, "Sarf, dizel l": r.useExtra, "Qoldiq (keyin)": r.balAfter,
  "Yoqilg'i, so'm": r.fuelSum, "Haydovchi haqi": r.pay, "Haq turi": r.amount == null ? (r.pay ? "Taklif" : null) : r.payType === "CASH" ? "Naqd" : "Oylik",
  "Ta'mir": r.repair, Zapchast: r.parts, Vulkanizator: r.vulc, "Boshqa xarajat": r.other,
  // Jami xarajat, daromad va foyda — faqat logistika moliyasini ko'radiganlarga (`canSeeLogiMoney`)
  ...(money ? { "Jami xarajat": r.total, "P/R": r.revBank, "N/L": r.revCash, Obyekt: r.revOther, Foyda: r.profit } : {}), Izoh: r.remarks.join("; "),
});

/**
 * Haydovchi tabelining hisob varag'i (dispetcher Excel'i ko'rinishida) — `lib/driver-ledger.ts`.
 * Reys qatori o'zi tushadi (ECO bermagan km / baraban soati qalam bilan yoziladi), qo'lda qator — «Qator qo'shish» dan,
 * reyssiz kun — mashinaning shu kungi zapravka/xarajati. Naqd haqli qator sariq (Excel'dagi «НАХТ»).
 * Har qator oxiridagi qalam — hamma ustunni bitta oynada tahrirlash (`LedgerEditButton`, `lib/ledger-edit.ts`).
 * Excel: bitta mashina — bitta varaq; «Hammasi» da har mashina alohida varaq + jamlanma.
 * `money` — Jami xarajat, daromad (P/R, N/L, Obyekt), Foyda va pul jamlari: faqat direktor, ish boshqaruvchi, mexanik
 * (`lib/logistics-finance.ts` → `canSeeLogiMoney`). Qolganlarga bu ustunlar ham, Excel'da ham yuborilmaydi.
 */
export function LedgerSheet({ rows, total, month, file, showDriver, showPlate, canEdit, money }: {
  rows: LedgerRow[]; total: LedgerTotals; month: string; file: string; showDriver: boolean; showPlate: boolean; canEdit: boolean; money: boolean;
}) {
  const units = new Set(rows.map((r) => r.unit));
  const unit = units.size === 1 ? [...units][0] : "m³ / l";
  const sums = driverPaySums(rows);
  const plates = [...new Set(rows.map((r) => r.plate))];
  const sheets = [
    ...(plates.length > 1 ? plates.map((p) => ({ name: sheetName(p), rows: rows.filter((r) => r.plate === p).map((r) => excelRow(r, money)) })) : [{ name: sheetName(plates[0] ?? "Hisob varag'i"), rows: rows.map((r) => excelRow(r, money)) }]),
    { name: "Jamlanma", rows: sums.map((d) => ({ Haydovchi: d.driver, Oylik: d.payroll, Naqd: d.cash, "Narxsiz (taklif)": d.suggested, Jami: d.total })) },
  ];
  const cols = (money ? 24 : 19) + (showDriver ? 1 : 0) + (canEdit ? 1 : 0);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-3xl text-xs text-slate-500">
          Reys yetkazilganda o&apos;zi tushadi: km — ECO/GPS izi (bo&apos;lmasa zayavka masofasi × 2), baraban soati — haydovchi yoki reys vaqti.
          ECO bermagan bo&apos;lsa — km katagidagi qalam bilan yozing{canEdit ? ", butun qatorni — oxiridagi qalam bilan" : ""}. Sarf — transport normasi, qoldiq — mashina bo&apos;yicha zapravkalar minus sarf.
          <span className="ml-1 rounded bg-amber-100 px-1 text-amber-800">Sariq</span> — naqd haq.
        </p>
        <ExcelButton file={file} sheets={sheets} />
      </div>
      <Sheet lang="uz">
        <SheetHead>
          <tr>
            <SheetTh rowSpan={2}>Sana</SheetTh>
            {showDriver && <SheetTh rowSpan={2}>Haydovchi</SheetTh>}
            <SheetTh rowSpan={2}>Yuklash joyi</SheetTh>
            <SheetTh rowSpan={2}>Tushirish joyi</SheetTh>
            <SheetTh rowSpan={2} right>Reys</SheetTh>
            <SheetTh rowSpan={2}>Yuk</SheetTh>
            <SheetTh rowSpan={2} right>Probeg, km</SheetTh>
            <SheetTh rowSpan={2} right title="Mikser barabani ishlagan soat">Baraban, soat</SheetTh>
            <SheetTh rowSpan={2} right tone="blue" title="Baraban soati × soat normasi">Baraban sarfi</SheetTh>
            <SheetTh colSpan={4} tone="blue">Gaz / yoqilg&apos;i, {unit}</SheetTh>
            <SheetTh rowSpan={2} right tone="blue">Yoqilg&apos;i, so&apos;m</SheetTh>
            <SheetTh rowSpan={2} right>Haydovchi haqi</SheetTh>
            <SheetTh colSpan={4} tone="red">Xarajat</SheetTh>
            {money && <>
              <SheetTh rowSpan={2} right tone="red">Jami xarajat</SheetTh>
              <SheetTh colSpan={3} tone="green">Bajarilgan (summada)</SheetTh>
              <SheetTh rowSpan={2} right tone="yellow">Foyda</SheetTh>
            </>}
            <SheetTh rowSpan={2}>Izoh</SheetTh>
            {canEdit && <SheetTh rowSpan={2}><span className="sr-only">Amal</span></SheetTh>}
          </tr>
          <tr>
            <SheetTh right tone="blue">Qoldiq</SheetTh><SheetTh right tone="blue">Zapravka</SheetTh><SheetTh right tone="blue">Sarf</SheetTh><SheetTh right tone="blue">Qoldiq</SheetTh>
            <SheetTh right tone="red">Ta&apos;mir</SheetTh><SheetTh right tone="red">Zapchast</SheetTh><SheetTh right tone="red">Vulkanizator</SheetTh><SheetTh right tone="red">Boshqa</SheetTh>
            {money && <>
              <SheetTh right tone="green" title="Perechisleniye">P/R</SheetTh><SheetTh right tone="green" title="Naqd">N/L</SheetTh>
              <SheetTh right tone="green" title="Obyektda olingan (qo'lda) yoki zayavkada to'lov turi ko'rsatilmagan">Obyekt</SheetTh>
            </>}
          </tr>
        </SheetHead>
        <tbody>
          {rows.length === 0 && <SheetTr><SheetTd colSpan={cols} center muted className="py-8">Bu oyda qator yo&apos;q — reys yetkazilganda o&apos;zi tushadi yoki qo&apos;lda qo&apos;shing</SheetTd></SheetTr>}
          {rows.map((r) => {
            const missing = r.kind === "trip" && (r.km < 1 || r.workHours == null);
            const kmNode = <span className={missing ? "text-amber-700" : undefined} title={missing ? "ECO km yoki baraban soatini bermadi" : undefined}><N v={r.km} /></span>;
            return (
              <SheetTr key={`${r.kind}:${r.id}`} className={cn(r.payType === "CASH" && "[&>td]:bg-amber-100!", r.kind === "cost" && "text-slate-500 italic")}>
                <SheetTd className="whitespace-nowrap">
                  {r.kind === "trip" ? <Link href={`/trips/${r.id}`} className="hover:underline">{dateTime(r.at)}</Link> : date(r.at)}
                  {r.kind === "entry" && <span className="block text-[10px] font-semibold text-amber-700" title={r.no}>qo&apos;lda · {r.no}</span>}
                  {r.kind === "cost" && <span className="block text-[10px] font-semibold text-slate-400">reyssiz</span>}
                  {showPlate && <div className="text-[11px] text-slate-500">{r.plate}</div>}
                </SheetTd>
                {showDriver && <SheetTd className="whitespace-nowrap">{r.driverId ? <Link href={`/logistika/tabel?bolim=hisob&oy=${month}&driver=${r.driverId}`} className="hover:underline">{r.driver}</Link> : <span className="text-slate-300">—</span>}</SheetTd>}
                <SheetTd className="max-w-40 truncate">{r.pickup}</SheetTd>
                <SheetTd className="max-w-52"><div className="truncate font-medium" title={r.dropoff}>{r.dropoff}</div>{r.address && <div className="truncate text-[11px] text-slate-500">{r.address}</div>}</SheetTd>
                <SheetTd right><N v={r.trips} /></SheetTd>
                <SheetTd className="whitespace-nowrap">{r.cargo}</SheetTd>
                <SheetTd right>{r.kind === "trip" && canEdit ? <KmFix tripId={r.id} km={r.km} hours={r.workHours}>{kmNode}</KmFix> : kmNode}</SheetTd>
                <SheetTd right><N v={r.workHours} frac={1} /></SheetTd>
                <SheetTd right tone="blue"><N v={r.drumUse} frac={1} /></SheetTd>
                <SheetTd right tone="blue"><N v={r.balBefore} frac={1} neg /></SheetTd>
                <SheetTd right tone="blue"><N v={r.refuel} frac={1} /></SheetTd>
                <SheetTd right tone="blue">{fuelUseCell(r)}</SheetTd>
                <SheetTd right tone="blue" strong><N v={r.balAfter} frac={1} neg /></SheetTd>
                <SheetTd right tone="blue"><span title={r.fuelPriceMissing ? "Zapravka narxi topilmadi — summa to'liq emas" : undefined} className={r.fuelPriceMissing ? "text-amber-700" : undefined}><N v={r.fuelSum} /></span></SheetTd>
                <SheetTd right><span title={r.pay ? payTitle(r) : undefined} className={r.amount == null && r.pay ? "text-amber-700" : undefined}><N v={r.pay} /></span></SheetTd>
                <SheetTd right tone="red"><N v={r.repair} /></SheetTd>
                <SheetTd right tone="red"><N v={r.parts} /></SheetTd>
                <SheetTd right tone="red"><N v={r.vulc} /></SheetTd>
                <SheetTd right tone="red"><N v={r.other} /></SheetTd>
                {money && <>
                  <SheetTd right tone="red" strong><N v={r.total} /></SheetTd>
                  <SheetTd right tone="green"><N v={r.revBank} /></SheetTd>
                  <SheetTd right tone="green"><N v={r.revCash} /></SheetTd>
                  <SheetTd right tone="green"><N v={r.revOther} /></SheetTd>
                  <SheetTd right tone="yellow" strong><N v={r.profit} neg /></SheetTd>
                </>}
                <SheetTd className="max-w-48 truncate text-[12px] text-slate-600">
                  {r.payType === "CASH" && <span className="mr-1 font-semibold text-amber-800">Naqd</span>}
                  <span title={r.remarks.join(" · ")}>{r.remarks.join(" · ")}</span>
                </SheetTd>
                {canEdit && (
                  <SheetTd className="whitespace-nowrap">
                    <span className="inline-flex items-center gap-0.5">
                      <LedgerEditButton kind={r.kind} id={r.id} />
                      {r.kind === "entry" && !(r.payType === "CASH" && r.approvedAt) && (
                        <ConfirmButton action={cancelEntryAction.bind(null, r.id)} reason="required" label="" title="Qatorni bekor qilish" icon={<Undo2 size={14} />}
                          question={`${r.no} (${date(r.at)} · ${r.plate}) bekor qilinsinmi? Zapravka va xarajati ham bekor bo'ladi.`} okText="Bekor qilindi" className="h-7 px-1.5" />
                      )}
                    </span>
                  </SheetTd>
                )}
              </SheetTr>
            );
          })}
        </tbody>
        {rows.length > 0 && (
          <SheetFoot>
            <tr>
              <SheetTd colSpan={showDriver ? 4 : 3}>Jami: {total.rows} qator</SheetTd>
              <SheetTd right><N v={total.trips} /></SheetTd>
              <SheetTd />
              <SheetTd right><N v={total.km} /></SheetTd>
              <SheetTd right><N v={total.hours} frac={1} /></SheetTd>
              <SheetTd right><N v={total.drumUse} frac={1} /></SheetTd>
              <SheetTd />
              <SheetTd right><N v={total.refuel} frac={1} /></SheetTd>
              <SheetTd right>{[total.useGas ? `${fmtNum(total.useGas, 1)} m³` : null, total.useDt ? `${fmtNum(total.useDt, 1)} l` : null].filter(Boolean).join(" + ") || "—"}</SheetTd>
              <SheetTd />
              {/* Pul jamlari — faqat logistika moliyasini ko'radiganlarga */}
              {money ? <>
                <SheetTd right><N v={total.fuelSum} /></SheetTd>
                <SheetTd right><N v={total.pay} /></SheetTd>
                <SheetTd right><N v={total.repair} /></SheetTd>
                <SheetTd right><N v={total.parts} /></SheetTd>
                <SheetTd right><N v={total.vulc} /></SheetTd>
                <SheetTd right><N v={total.other} /></SheetTd>
                <SheetTd right><N v={total.total} /></SheetTd>
                <SheetTd right><N v={total.revBank} /></SheetTd>
                <SheetTd right><N v={total.revCash} /></SheetTd>
                <SheetTd right><N v={total.revOther} /></SheetTd>
                <SheetTd right><N v={total.profit} neg /></SheetTd>
              </> : <SheetTd colSpan={6} />}
              <SheetTd colSpan={canEdit ? 2 : 1} />
            </tr>
          </SheetFoot>
        )}
      </Sheet>

      {/* Excel'dagi ISMI / OYLIK / NAXT — varaqdagi haydovchilar haqi */}
      {sums.length > 0 && (
        <Sheet lang="uz" className="w-fit" maxHeight="none">
          <SheetHead>
            <tr>
              <SheetTh tone="yellow">Haydovchi</SheetTh><SheetTh tone="yellow" right>Oylik</SheetTh><SheetTh tone="yellow" right>Naqd</SheetTh>
              <SheetTh tone="yellow" right title="Reysga hali narx qo'yilmagan — tarif bo'yicha taklif">Narxsiz (taklif)</SheetTh><SheetTh tone="yellow" right>Jami</SheetTh>
            </tr>
          </SheetHead>
          <tbody>
            {sums.map((d) => (
              <SheetTr key={d.driverId}>
                <SheetTd className="whitespace-nowrap font-medium">{d.driver}</SheetTd>
                <SheetTd right><N v={d.payroll} /></SheetTd>
                <SheetTd right className={d.cash ? "bg-amber-100" : undefined}><N v={d.cash} /></SheetTd>
                <SheetTd right><span className="text-amber-700"><N v={d.suggested} /></span></SheetTd>
                <SheetTd right strong><N v={d.total} /></SheetTd>
              </SheetTr>
            ))}
          </tbody>
          {sums.length > 1 && (
            <SheetFoot>
              <tr>
                <SheetTd>Jami</SheetTd>
                <SheetTd right><N v={sums.reduce((a, d) => a + d.payroll, 0)} /></SheetTd>
                <SheetTd right><N v={sums.reduce((a, d) => a + d.cash, 0)} /></SheetTd>
                <SheetTd right><N v={sums.reduce((a, d) => a + d.suggested, 0)} /></SheetTd>
                <SheetTd right><N v={sums.reduce((a, d) => a + d.total, 0)} /></SheetTd>
              </tr>
            </SheetFoot>
          )}
        </Sheet>
      )}
    </div>
  );
}
