import Link from "next/link";
import { Undo2 } from "lucide-react";
import { driverPaySums, type LedgerKind, type LedgerRow, type LedgerTotals } from "@/lib/driver-ledger";
import { date, dateTime, fmtNum } from "@/lib/format";
import { cn } from "@/lib/utils";
import { InfoButton, Sheet, SheetFoot, SheetHead, SheetTd, SheetTh, SheetTr } from "@/components/ui";
import { ExcelButton } from "@/app/(app)/logistika/excel-button";
import { ConfirmButton } from "../../payments/confirm-button";
import { cancelEntryAction } from "../actions";
import { KmFix, LedgerCell, LedgerEditButton, type LedgerField } from "./ledger-forms";

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

/**
 * Katakdagi qalam — qator turi bo'yicha qaysi ustun tahrirlanadi (tahrir oynasidagidek): ECO reysda sana, haydovchi, tushirish
 * joyi, yuk va kirim — reys/zayavkadan (reys kartasida), reyssiz kunda — faqat zapravka va xarajatlar. Hisoblanadigan
 * ustunlar (baraban sarfi, sarf, qoldiq, jami xarajat, foyda) qalamsiz — manba ustuni o'zgarsa o'zi qayta hisoblanadi.
 * Reys km'i — `KmFix` (km va baraban soati birga).
 */
const CELLS: Record<LedgerKind, readonly LedgerField[]> = {
  entry: ["date", "driver", "pickup", "dropoff", "trips", "cargo", "km", "hours", "fuel", "pay", "repair", "parts", "vulc", "other", "revenue", "note"],
  trip: ["pickup", "hours", "fuel", "pay", "repair", "parts", "vulc", "other", "note"],
  cost: ["fuel", "repair", "parts", "vulc", "other"],
};

/** Excel varaq nomi: taqiqlangan belgilarsiz, 31 belgigacha. */
const sheetName = (s: string) => s.replace(/[[\]:*?/\\]/g, " ").trim().slice(0, 31) || "Varaq";

const excelRow = (r: LedgerRow, money: boolean) => ({
  Sana: date(r.at), Hujjat: r.no, Manba: r.kind === "trip" ? "ECO / reys" : r.kind === "entry" ? "Qo'lda" : "Reyssiz xarajat",
  Mashina: r.plate, Haydovchi: r.driver, "Yuklash joyi": r.pickup, "Tushirish joyi": r.dropoff, Reys: r.trips, Yuk: r.cargo,
  "Probeg, km": r.km, "Baraban, soat": r.workHours, "Baraban sarfi": r.drumUse, Birlik: r.unit, "Qoldiq (oldin)": r.balBefore, Zapravka: r.refuel, Sarf: r.use, "Sarf, dizel l": r.useExtra, "Qoldiq (keyin)": r.balAfter,
  "Yoqilg'i, so'm": r.fuelSum, "Haydovchi haqi": r.pay, "Haq turi": r.amount == null ? (r.pay ? "Taklif" : null) : r.payType === "CASH" ? "Naqd" : "Oylik",
  "Ta'mir": r.repair, Zapchast: r.parts, Vulkanizator: r.vulc, "Boshqa xarajat": r.other, "Jami xarajat": r.total,
  // Dostavka / usluga alohida va foyda — faqat logistika moliyasini ko'radiganlarga (`canSeeLogiMoney`);
  // qolganlarga (dispetcher) — Excel'idagi «Выполнения в суммах»: П/Р, Н/Л, Обект
  ...(money ? {
    "Dostavka perech.": r.revBank, "Dostavka naqd": r.revCash, "Dostavka qarzga": r.revDebt,
    "Usluga perech.": r.svcBank, "Usluga naqd": r.svcCash, "Obyekt (zavod uchun)": r.revOther, Foyda: r.profit,
  } : {
    "Bajarilgan — perech.": r.revBank + r.svcBank, "Bajarilgan — naqd": r.revCash + r.svcCash, "Bajarilgan — qarzga": r.revDebt, "Obyekt (zavod uchun)": r.revOther,
  }), Izoh: r.remarks.join("; "),
});

type Rev = Pick<LedgerTotals, "revBank" | "revCash" | "revDebt" | "svcBank" | "svcCash" | "revOther">;
/** Bajarilgan ish ustuni: qiymat (qator yoki jami), qator katagida kirim qalami bormi. */
type RevCol = { key: string; v: (x: Rev) => number; edit: boolean };

/**
 * Haydovchi tabelining hisob varag'i (dispetcher Excel'i ko'rinishida) — `lib/driver-ledger.ts`.
 * Reys qatori o'zi tushadi (ECO bermagan km / baraban soati qalam bilan yoziladi), qo'lda qator — «Qator qo'shish» dan,
 * reyssiz kun — mashinaning shu kungi zapravka/xarajati. Naqd haqli qator sariq (Excel'dagi «НАХТ»).
 * Har katakdagi qalam — shu ustunni (`LedgerCell`, `CELLS`), qator oxiridagisi — hamma ustunni bitta oynada (`LedgerEditButton`,
 * `lib/ledger-edit.ts`); ikkalasi bitta server amali bilan saqlanadi.
 * Excel: bitta mashina — bitta varaq; «Hammasi» da har mashina alohida varaq + jamlanma.
 * Jami xarajat va bajarilgan ish (summada) — hammaga. `money` (direktor, ish boshqaruvchi, mexanik — `lib/logistics-finance.ts`
 * → `canSeeLogiMoney`): bajarilgan ish dostavka / usluga bo'yicha alohida (perech. / naqd) va Foyda. Qolganlarga (dispetcher) —
 * dispetcher Excel'idagidek «Общая расход» va «Выполнения в суммах»: perech., naqd (dostavka + usluga), obyekt; Foyda yo'q
 * (ekranda ham, Excel'da ham).
 */
export function LedgerSheet({ rows, total, month, file, showDriver, showPlate, canEdit, money, openTrip }: {
  rows: LedgerRow[]; total: LedgerTotals; month: string; file: string; showDriver: boolean; showPlate: boolean; canEdit: boolean; money: boolean;
  /** `?tahrir=<reys>` — reys kartasidan haydovchi o'rniga yetkazilgach: shu reys qatorining tahrir oynasi o'zi ochiladi */
  openTrip?: string | null;
}) {
  const units = new Set(rows.map((r) => r.unit));
  const unit = units.size === 1 ? [...units][0] : "m³ / l";
  const sums = driverPaySums(rows);
  const plates = [...new Set(rows.map((r) => r.plate))];
  const sheets = [
    ...(plates.length > 1 ? plates.map((p) => ({ name: sheetName(p), rows: rows.filter((r) => r.plate === p).map((r) => excelRow(r, money)) })) : [{ name: sheetName(plates[0] ?? "Hisob varag'i"), rows: rows.map((r) => excelRow(r, money)) }]),
    { name: "Jamlanma", rows: sums.map((d) => ({ Haydovchi: d.driver, Oylik: d.payroll, Naqd: d.cash, "Narxsiz (taklif)": d.suggested, Jami: d.total })) },
  ];
  // Zayavkada to'lov turi yo'q (qarzga) dostavka bo'lsa — alohida ustun (bo'lmasa ko'rsatilmaydi)
  const debt = rows.some((r) => r.revDebt >= 1);
  const debtCol: RevCol[] = debt ? [{ key: "debt", v: (x) => x.revDebt, edit: false }] : [];
  const revCols: RevCol[] = money
    ? [{ key: "bank", v: (x) => x.revBank, edit: true }, { key: "cash", v: (x) => x.revCash, edit: true }, ...debtCol,
      { key: "svcBank", v: (x) => x.svcBank, edit: true }, { key: "svcCash", v: (x) => x.svcCash, edit: true }, { key: "obj", v: (x) => x.revOther, edit: true }]
    : [{ key: "bank", v: (x) => x.revBank + x.svcBank, edit: true }, { key: "cash", v: (x) => x.revCash + x.svcCash, edit: true }, ...debtCol,
      { key: "obj", v: (x) => x.revOther, edit: true }];
  // 19 asosiy ustun + Jami xarajat + bajarilgan ish (+ Foyda)
  const cols = 20 + revCols.length + (money ? 1 : 0) + (showDriver ? 1 : 0) + (canEdit ? 1 : 0);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <InfoButton title="Hisob varag'i">
          <p>Reys yetkazilganda o&apos;zi tushadi: km — ECO/GPS izi (bo&apos;lmasa zayavka masofasi × 2), baraban soati — haydovchi yoki reys vaqti.</p>
          <p>{canEdit ? "Har katakdagi qalam — shu ustunni, qator oxiridagisi — butun qatorni tahrirlaydi." : "ECO bermagan km — km katagidagi qalam bilan yoziladi."} Sarf — transport normasi, qoldiq — mashina bo&apos;yicha zapravkalar minus sarf.</p>
          <p><span className="rounded bg-amber-100 px-1 text-amber-800">Sariq</span> — naqd haq.</p>
        </InfoButton>
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
            <SheetTh rowSpan={2} right tone="red" title="Umumiy rasxod: yoqilg'i + haydovchi haqi + ta'mir + zapchast + vulkanizator + boshqa">Jami xarajat</SheetTh>
            {money ? <>
              <SheetTh colSpan={debt ? 3 : 2} tone="green" title="Zayavka dastavka haqi (reyslarga hajm ulushida) va qo'lda qator">Dostavka summasi</SheetTh>
              <SheetTh colSpan={2} tone="green" title="Tashqi xizmat (usluga) kirimi — qo'lda qator">Usluga prixod</SheetTh>
              <SheetTh rowSpan={2} right tone="green" title="Zavodning o'zi uchun ish — zavodga olib kelingan narsa (logistika daromadi, foydaga kiradi)">Obyekt<span className="block text-[11px] font-medium">zavod uchun</span></SheetTh>
              <SheetTh rowSpan={2} right tone="yellow">Foyda</SheetTh>
            </> : (
              <SheetTh colSpan={revCols.length} tone="green" title="Dostavka (zayavka dastavka haqi, qo'lda qator) va usluga kirimi to'lov turi bo'yicha; obyekt — zavodning o'zi uchun ish">Bajarilgan ish (summada)</SheetTh>
            )}
            <SheetTh rowSpan={2}>Izoh</SheetTh>
            {canEdit && <SheetTh rowSpan={2}><span className="sr-only">Amal</span></SheetTh>}
          </tr>
          <tr>
            <SheetTh right tone="blue">Qoldiq</SheetTh><SheetTh right tone="blue">Zapravka</SheetTh><SheetTh right tone="blue">Sarf</SheetTh><SheetTh right tone="blue">Qoldiq</SheetTh>
            <SheetTh right tone="red">Ta&apos;mir</SheetTh><SheetTh right tone="red">Zapchast</SheetTh><SheetTh right tone="red">Vulkanizator</SheetTh><SheetTh right tone="red">Boshqa</SheetTh>
            {money ? <>
              <SheetTh right tone="green" title="Perechisleniye">Perech.</SheetTh><SheetTh right tone="green">Naqd</SheetTh>
              {debt && <SheetTh right tone="green" title="Zayavkada to'lov turi ko'rsatilmagan — mijoz keyin to'laydi">Qarzga</SheetTh>}
              <SheetTh right tone="green" title="Perechisleniye">Perech.</SheetTh><SheetTh right tone="green">Naqd</SheetTh>
            </> : <>
              <SheetTh right tone="green" title="Perechisleniye (П/Р): dostavka + usluga">Perech.</SheetTh>
              <SheetTh right tone="green" title="Naqd (Н/Л): dostavka + usluga">Naqd</SheetTh>
              {debt && <SheetTh right tone="green" title="Zayavkada to'lov turi ko'rsatilmagan — mijoz keyin to'laydi">Qarzga</SheetTh>}
              <SheetTh right tone="green" title="Zavodning o'zi uchun ish — zavodga olib kelingan narsa">Obyekt</SheetTh>
            </>}
          </tr>
        </SheetHead>
        <tbody>
          {rows.length === 0 && <SheetTr><SheetTd colSpan={cols} center muted className="py-8">Bu oyda qator yo&apos;q — reys yetkazilganda o&apos;zi tushadi yoki qo&apos;lda qo&apos;shing</SheetTd></SheetTr>}
          {rows.map((r) => {
            const missing = r.kind === "trip" && (r.km < 1 || r.workHours == null);
            const kmNode = <span className={missing ? "text-amber-700" : undefined} title={missing ? "ECO km yoki baraban soatini bermadi" : undefined}><N v={r.km} /></span>;
            const ed = (field: LedgerField, label: string, node: React.ReactNode, right = false) => (canEdit && CELLS[r.kind].includes(field)
              ? <LedgerCell kind={r.kind} id={r.id} field={field} label={label} right={right}>{node}</LedgerCell> : node);
            return (
              <SheetTr key={`${r.kind}:${r.id}`} className={cn(r.payType === "CASH" && "[&>td]:bg-amber-100!", r.kind === "cost" && "text-slate-500 italic")}>
                <SheetTd className="whitespace-nowrap">
                  {r.kind === "trip" ? <Link href={`/trips/${r.id}`} className="hover:underline">{dateTime(r.at)}</Link> : ed("date", "Sana", date(r.at))}
                  {r.kind === "entry" && <span className="block text-[10px] font-semibold text-amber-700" title={r.no}>qo&apos;lda · {r.no}</span>}
                  {r.kind === "cost" && <span className="block text-[10px] font-semibold text-slate-400">reyssiz</span>}
                  {showPlate && <div className="text-[11px] text-slate-500">{r.plate}</div>}
                </SheetTd>
                {showDriver && <SheetTd className="whitespace-nowrap">{ed("driver", "Haydovchi", r.driverId ? <Link href={`/logistika/tabel?bolim=hisob&oy=${month}&driver=${r.driverId}`} className="hover:underline">{r.driver}</Link> : <span className="text-slate-300">—</span>)}</SheetTd>}
                <SheetTd className="max-w-40">{ed("pickup", "Yuklash joyi", <span className="block truncate" title={r.pickup}>{r.pickup}</span>)}</SheetTd>
                <SheetTd className="max-w-52">{ed("dropoff", "Tushirish joyi", <><div className="truncate font-medium" title={r.dropoff}>{r.dropoff}</div>{r.address && <div className="truncate text-[11px] text-slate-500">{r.address}</div>}</>)}</SheetTd>
                <SheetTd right>{ed("trips", "Reys soni", <N v={r.trips} />, true)}</SheetTd>
                <SheetTd className="whitespace-nowrap">{ed("cargo", "Yuk", r.cargo)}</SheetTd>
                <SheetTd right>{r.kind === "trip" && canEdit ? <KmFix tripId={r.id} km={r.km} hours={r.workHours}>{kmNode}</KmFix> : ed("km", "Probeg, km", kmNode, true)}</SheetTd>
                <SheetTd right>{ed("hours", "Baraban, soat", <N v={r.workHours} frac={1} />, true)}</SheetTd>
                <SheetTd right tone="blue"><N v={r.drumUse} frac={1} /></SheetTd>
                <SheetTd right tone="blue"><N v={r.balBefore} frac={1} neg /></SheetTd>
                <SheetTd right tone="blue">{ed("fuel", "Zapravka", <N v={r.refuel} frac={1} />, true)}</SheetTd>
                <SheetTd right tone="blue">{fuelUseCell(r)}</SheetTd>
                <SheetTd right tone="blue" strong><N v={r.balAfter} frac={1} neg /></SheetTd>
                <SheetTd right tone="blue">{ed("fuel", "Yoqilg'i: zapravka va narxi", <span title={r.fuelPriceMissing ? "Zapravka narxi topilmadi — summa to'liq emas" : undefined} className={r.fuelPriceMissing ? "text-amber-700" : undefined}><N v={r.fuelSum} /></span>, true)}</SheetTd>
                <SheetTd right>{ed("pay", "Haydovchi haqi", <span title={r.pay ? payTitle(r) : undefined} className={r.amount == null && r.pay ? "text-amber-700" : undefined}><N v={r.pay} /></span>, true)}</SheetTd>
                <SheetTd right tone="red">{ed("repair", "Ta'mir", <N v={r.repair} />, true)}</SheetTd>
                <SheetTd right tone="red">{ed("parts", "Zapchast", <N v={r.parts} />, true)}</SheetTd>
                <SheetTd right tone="red">{ed("vulc", "Vulkanizator", <N v={r.vulc} />, true)}</SheetTd>
                <SheetTd right tone="red">{ed("other", "Boshqa xarajat", <N v={r.other} />, true)}</SheetTd>
                <SheetTd right tone="red" strong><N v={r.total} /></SheetTd>
                {revCols.map((c) => (
                  <SheetTd key={c.key} right tone="green">{c.edit ? ed("revenue", "Kirim (bajarilgan)", <N v={c.v(r)} />, true) : <N v={c.v(r)} />}</SheetTd>
                ))}
                {money && <SheetTd right tone="yellow" strong><N v={r.profit} neg /></SheetTd>}
                <SheetTd className="max-w-48 text-[12px] text-slate-600">
                  {ed("note", "Izoh", <span className="block truncate" title={r.remarks.join(" · ")}>
                    {r.payType === "CASH" && <span className="mr-1 font-semibold text-amber-800">Naqd</span>}
                    {r.remarks.join(" · ")}
                  </span>)}
                </SheetTd>
                {canEdit && (
                  <SheetTd className="whitespace-nowrap">
                    <span className="inline-flex items-center gap-0.5">
                      <LedgerEditButton kind={r.kind} id={r.id} autoOpen={!!openTrip && r.kind === "trip" && r.id === openTrip} />
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
              <SheetTd right><N v={total.fuelSum} /></SheetTd>
              <SheetTd right><N v={total.pay} /></SheetTd>
              <SheetTd right><N v={total.repair} /></SheetTd>
              <SheetTd right><N v={total.parts} /></SheetTd>
              <SheetTd right><N v={total.vulc} /></SheetTd>
              <SheetTd right><N v={total.other} /></SheetTd>
              <SheetTd right><N v={total.total} /></SheetTd>
              {revCols.map((c) => <SheetTd key={c.key} right><N v={c.v(total)} /></SheetTd>)}
              {/* Foyda — faqat logistika moliyasini ko'radiganlarga */}
              {money && <SheetTd right><N v={total.profit} neg /></SheetTd>}
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
