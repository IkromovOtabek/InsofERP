"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { FilterX, Undo2 } from "lucide-react";
import type { LedgerKind, LedgerRow, LedgerTotals } from "@/lib/driver-ledger";
import { driverPaySums, ledgerTotals } from "@/lib/ledger-totals";
import { date, dateTime, fmtNum } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button, ColumnFilter, InfoButton, Sheet, SheetFoot, SheetHead, SheetTd, SheetTh, SheetTr, type FilterOption, type SheetTone, type SortDir } from "@/components/ui";
import { ExcelButton } from "@/app/(app)/logistika/excel-button";
import { ConfirmButton } from "../../payments/confirm-button";
import { cancelEntryAction } from "../actions";
import { KmFix, LedgerCell, LedgerEditButton, type LedgerField } from "./ledger-forms";
import { LedgerImportButton } from "./ledger-import";

/** Bo'sh / nol — «—», aks holda son (pul — butun so'm). */
const N = ({ v, frac = 0, neg }: { v: number | null; frac?: number; neg?: boolean }) =>
  v == null || Math.abs(v) < (frac ? 0.05 : 1) ? <span className="text-slate-300">—</span>
    : <span className={neg && v < 0 ? "font-semibold text-red-600" : undefined}>{fmtNum(v, frac)}</span>;

/** Sarf matni: «51,5» yoki «Dizel + metan» da «40 m³ + 12 l». */
const fuelUseCell = (r: LedgerRow) => (r.useExtra != null && Math.abs(r.useExtra) >= 0.05
  ? <span title="metan + dizel">{r.use != null && Math.abs(r.use) >= 0.05 ? fmtNum(r.use, 1) : "—"} <span className="text-slate-400">+ {fmtNum(r.useExtra, 1)} l</span></span>
  : <N v={r.use} frac={1} />);

/** Haq holati: narxlangan / qo'lda — summa; reysda narx qo'yilmagan bo'lsa taklif (sariq). */
const payTitle = (r: LedgerRow) => (r.amount == null ? `Taklif: ${r.suggestText ?? ""}`
  : `${r.payType === "CASH" ? "Naqd" : r.payType === "PAYROLL" ? "Oylik" : "Narxlangan"}${r.approvedAt ? " · tasdiqlangan" : r.payType ? " · tasdiq kutilmoqda" : ""}`);

/** Excel importidagi qator: probeg / baraban soati DT va gaz bo'yicha alohida — katak ustida ko'rinadi. */
const splitTitle = (total: number | null, gas: number | null, unit: string) =>
  gas == null || total == null ? undefined : `DT: ${fmtNum(Math.max(0, total - gas), 1)} ${unit} · gaz: ${fmtNum(gas, 1)} ${unit}`;

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
  "Probeg, km": r.km, "shundan gazda, km": r.kmGas, "Baraban, soat": r.workHours, "shundan gazda, soat": r.hoursGas,
  "Baraban sarfi": r.drumUse, Birlik: r.unit, "Qoldiq (oldin)": r.balBefore, Zapravka: r.refuel, Sarf: r.use, "Sarf, dizel l": r.useExtra, "Qoldiq (keyin)": r.balAfter,
  "Yoqilg'i normasi, so'm": r.fuelSum, "Haydovchi haqi": r.pay, "Haq turi": r.amount == null ? (r.pay ? "Taklif" : null) : r.payType === "CASH" ? "Naqd" : "Oylik",
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
type RevCol = { key: string; title: string; v: (x: Rev) => number; edit: boolean };

// ───────────────────────── Ustun filtrlari (Excel kabi) ─────────────────────────

type ColKind = "date" | "num" | "text";
/** Filtr ustuni: `val` — filtr qiymati (son — yaxlitlangan matn), `frac` — son ustunining kasr xonasi. */
type Col = { key: string; title: string; kind: ColKind; val: (r: LedgerRow) => string; frac?: number };

const BLANK = "(Bo'sh)";
const pad = (n: number) => String(n).padStart(2, "0");
const dayOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
/** Son ustuni qiymati: 0 / bo'sh — "" (Excel'dagi bo'sh katak), aks holda yaxlitlangan son. */
const numVal = (v: number | null | undefined, frac = 0) => (v == null || Math.abs(v) < (frac ? 0.05 : 1) ? "" : String(Number(v.toFixed(frac))));
const SORT_TEXT: Record<ColKind, [string, string]> = {
  date: ["Eskidan yangiga", "Yangidan eskiga"],
  num: ["Kichikdan kattaga", "Kattadan kichikka"],
  text: ["A → Z", "Z → A"],
};
const optLabel = (c: Col, v: string) => (!v ? BLANK : c.kind === "num" ? fmtNum(Number(v), c.frac ?? 0) : c.kind === "date" ? v.split("-").reverse().join(".") : v);
/** Filtr oynasidagi qiymatlar tartibi: sana — yangisi tepada, son — o'sish, matn — alifbo; bo'sh — oxirida. */
const optCmp = (c: Col) => (a: FilterOption, b: FilterOption) =>
  !a.value !== !b.value ? (a.value ? -1 : 1)
  : c.kind === "date" ? b.value.localeCompare(a.value)
  : c.kind === "num" ? Number(a.value) - Number(b.value)
  : a.label.localeCompare(b.label);
const rowCmp = (c: Col) => (a: LedgerRow, b: LedgerRow) =>
  c.kind === "date" ? a.at.getTime() - b.at.getTime()
  : c.kind === "num" ? (Number(c.val(a)) || 0) - (Number(c.val(b)) || 0)
  : c.val(a).localeCompare(c.val(b));

/**
 * Haydovchi tabelining hisob varag'i (dispetcher Excel'i ko'rinishida) — `lib/driver-ledger.ts`.
 * Reys qatori o'zi tushadi (ECO bermagan km / baraban soati qalam bilan yoziladi), qo'lda qator — «Qator qo'shish» yoki
 * «Excel orqali qo'shish» dan, reyssiz kun — mashinaning shu kungi zapravka/xarajati. Naqd haqli qator sariq (Excel'dagi «НАХТ»).
 * Har katakdagi qalam — shu ustunni (`LedgerCell`, `CELLS`), qator oxiridagisi — hamma ustunni bitta oynada (`LedgerEditButton`,
 * `lib/ledger-edit.ts`); ikkalasi bitta server amali bilan saqlanadi.
 * Har ustun sarlavhasida Excel kabi filtr va saralash (`ColumnFilter`) — brauzerda; jami qatori, haydovchi jamlanmasi va
 * Excel yuklamasi ko'rinib turgan (filtrdan o'tgan) qatorlar bo'yicha.
 * Excel: bitta mashina — bitta varaq; «Hammasi» da har mashina alohida varaq + jamlanma.
 * Jami xarajat va bajarilgan ish (summada) — hammaga. `money` (direktor, ish boshqaruvchi, mexanik — `lib/logistics-finance.ts`
 * → `canSeeLogiMoney`): bajarilgan ish dostavka / usluga bo'yicha alohida (perech. / naqd) va Foyda. Qolganlarga (dispetcher) —
 * dispetcher Excel'idagidek «Общая расход» va «Выполнения в суммах»: perech., naqd (dostavka + usluga), obyekt; Foyda yo'q
 * (ekranda ham, Excel'da ham).
 */
export function LedgerSheet({ rows, month, file, showDriver, showPlate, canEdit, money, openTrip, vehicleId = null }: {
  rows: LedgerRow[]; month: string; file: string; showDriver: boolean; showPlate: boolean; canEdit: boolean; money: boolean;
  /** `?tahrir=<reys>` — reys kartasidan haydovchi o'rniga yetkazilgach: shu reys qatorining tahrir oynasi o'zi ochiladi */
  openTrip?: string | null;
  /** Ochiq mashina varag'i (tab) — «Excel orqali qo'shish» da bo'sh «Mashina» katagi shu mashina */
  vehicleId?: string | null;
}) {
  // Zayavkada to'lov turi yo'q (qarzga) dostavka bo'lsa — alohida ustun (bo'lmasa ko'rsatilmaydi)
  const debt = rows.some((r) => r.revDebt >= 1);
  // Ustunlar (filtr qiymatlari shu yerdan) — varaq ko'rinishi o'zgarmasa qayta tuzilmaydi
  const { revCols, colOf } = useMemo(() => {
    const debtCol: RevCol[] = debt ? [{ key: "debt", title: "Qarzga", v: (x) => x.revDebt, edit: false }] : [];
    const revCols: RevCol[] = money
      ? [{ key: "bank", title: "Dostavka perech.", v: (x) => x.revBank, edit: true }, { key: "cash", title: "Dostavka naqd", v: (x) => x.revCash, edit: true }, ...debtCol,
        { key: "svcBank", title: "Usluga perech.", v: (x) => x.svcBank, edit: true }, { key: "svcCash", title: "Usluga naqd", v: (x) => x.svcCash, edit: true },
        { key: "obj", title: "Obyekt", v: (x) => x.revOther, edit: true }]
      : [{ key: "bank", title: "Perech.", v: (x) => x.revBank + x.svcBank, edit: true }, { key: "cash", title: "Naqd", v: (x) => x.revCash + x.svcCash, edit: true }, ...debtCol,
        { key: "obj", title: "Obyekt", v: (x) => x.revOther, edit: true }];

    const cols: Col[] = [
      { key: "sana", title: "Sana", kind: "date", val: (r) => dayOf(r.at) },
      ...(showDriver ? [{ key: "driver", title: "Haydovchi", kind: "text" as const, val: (r: LedgerRow) => r.driver ?? "" }] : []),
      { key: "pickup", title: "Yuklash joyi", kind: "text", val: (r) => (r.pickup === "—" ? "" : r.pickup) },
      { key: "dropoff", title: "Tushirish joyi", kind: "text", val: (r) => r.dropoff },
      { key: "trips", title: "Reys", kind: "num", val: (r) => numVal(r.trips) },
      { key: "cargo", title: "Yuk", kind: "text", val: (r) => (r.cargo === "—" ? "" : r.cargo) },
      { key: "km", title: "Probeg, km", kind: "num", val: (r) => numVal(r.km) },
      { key: "hours", title: "Baraban, soat", kind: "num", frac: 1, val: (r) => numVal(r.workHours, 1) },
      { key: "drumUse", title: "Baraban sarfi", kind: "num", frac: 1, val: (r) => numVal(r.drumUse, 1) },
      { key: "balBefore", title: "Qoldiq (oldin)", kind: "num", frac: 1, val: (r) => numVal(r.balBefore, 1) },
      { key: "refuel", title: "Zapravka", kind: "num", frac: 1, val: (r) => numVal(r.refuel, 1) },
      { key: "use", title: "Sarf", kind: "num", frac: 1, val: (r) => numVal(r.use, 1) },
      { key: "balAfter", title: "Qoldiq (keyin)", kind: "num", frac: 1, val: (r) => numVal(r.balAfter, 1) },
      { key: "fuelSum", title: "Yoqilg'i normasi, so'm", kind: "num", val: (r) => numVal(r.fuelSum) },
      { key: "pay", title: "Haydovchi haqi", kind: "num", val: (r) => numVal(r.pay) },
      { key: "repair", title: "Ta'mir", kind: "num", val: (r) => numVal(r.repair) },
      { key: "parts", title: "Zapchast", kind: "num", val: (r) => numVal(r.parts) },
      { key: "vulc", title: "Vulkanizator", kind: "num", val: (r) => numVal(r.vulc) },
      { key: "other", title: "Boshqa", kind: "num", val: (r) => numVal(r.other) },
      { key: "total", title: "Jami xarajat", kind: "num", val: (r) => numVal(r.total) },
      ...revCols.map((c): Col => ({ key: `rev-${c.key}`, title: c.title, kind: "num", val: (r) => numVal(c.v(r)) })),
      ...(money ? [{ key: "profit", title: "Foyda", kind: "num" as const, val: (r: LedgerRow) => numVal(r.profit) }] : []),
      { key: "note", title: "Izoh", kind: "text", val: (r) => [r.realId ? "Realizatsiya" : null, r.partial.length ? `Qisman: ${r.partial.join(", ")}` : null, r.dup ? `Takror? ${r.dup}` : null, r.payType === "CASH" ? "Naqd" : null, ...r.remarks].filter(Boolean).join(" · ") },
    ];
    const colOf = new Map(cols.map((c) => [c.key, c]));
    return { revCols, colOf };
  }, [debt, money, showDriver]);

  const [filters, setFilters] = useState<Record<string, Set<string>>>({});
  const [sort, setSort] = useState<{ key: string; dir: SortDir } | null>(null);
  // Mashina tabi yoki davr almashsa (boshqa qatorlar) — eski filtr qiymatlari yangi varaqda bo'lmasligi mumkin, lekin
  // Excel'dagidek filtr saqlanadi; ko'rinmay qolgan qator — «Filtrlarni tozalash» bilan qaytadi

  const passes = useCallback((r: LedgerRow, except?: string) => Object.entries(filters).every(([k, set]) => {
    if (k === except) return true;
    const c = colOf.get(k);
    return !c || set.has(c.val(r));
  }), [filters, colOf]);

  const shown = useMemo(() => {
    const list = rows.filter((r) => passes(r));
    const c = sort ? colOf.get(sort.key) : undefined;
    // Sukut: eng yangi kun tepada (Realizatsiyadagidek); kun ichida varaqdagi tartib qoladi — sort barqaror
    if (!c || !sort) return list.map((r, i) => ({ r, i, d: dayOf(r.at) })).sort((a, b) => (a.d < b.d ? 1 : a.d > b.d ? -1 : a.i - b.i)).map((x) => x.r);
    const cmp = rowCmp(c), dir = sort.dir === "asc" ? 1 : -1;
    return list.map((r, i) => ({ r, i })).sort((a, b) => dir * cmp(a.r, b.r) || a.i - b.i).map((x) => x.r);
  }, [rows, passes, sort, colOf]);

  const total = useMemo(() => ledgerTotals(shown), [shown]);
  const sums = useMemo(() => driverPaySums(shown), [shown]);
  const units = new Set(shown.map((r) => r.unit));
  const unit = units.size === 1 ? [...units][0] : units.size === 0 ? (rows[0]?.unit ?? "m³ / l") : "m³ / l";
  const filtered = Object.keys(filters).length > 0;

  // Excel'dagidek: ustun qiymatlari — shu ustundan boshqa hamma filtrdan o'tgan qatorlardan
  const optionsFor = (c: Col) => () => {
    const m = new Map<string, number>();
    for (const r of rows) if (passes(r, c.key)) { const v = c.val(r); m.set(v, (m.get(v) ?? 0) + 1); }
    return [...m].map(([value, count]) => ({ value, label: optLabel(c, value), count })).sort(optCmp(c));
  };
  const setFilter = (k: string, v: Set<string> | null) => setFilters((f) => { const n = { ...f }; if (v) n[k] = v; else delete n[k]; return n; });

  /** Sarlavha katagi: nomi, saralash belgisi va filtr tugmasi. */
  const fth = (key: string, label: React.ReactNode, o: { rowSpan?: number; right?: boolean; tone?: SheetTone; title?: string } = {}) => {
    const c = colOf.get(key)!;
    return (
      <SheetTh rowSpan={o.rowSpan} tone={o.tone} title={o.title}>
        <div className={cn("flex items-center gap-1.5", o.right ? "justify-end" : "justify-between")}>
          <span className={cn("inline-flex items-center gap-1", o.right && "text-right")}>
            <span>{label}</span>
            {sort?.key === key && <span className="text-[11px] text-slate-500" aria-label={sort.dir === "asc" ? "o'sish bo'yicha" : "kamayish bo'yicha"}>{sort.dir === "asc" ? "↑" : "↓"}</span>}
          </span>
          <ColumnFilter label={c.title} options={optionsFor(c)} selected={filters[key]} onChange={(v) => setFilter(key, v)}
            sort={sort?.key === key ? sort.dir : null} onSort={(dir) => setSort({ key, dir })} sortText={SORT_TEXT[c.kind]} />
        </div>
      </SheetTh>
    );
  };

  // 19 asosiy ustun + Jami xarajat + bajarilgan ish (+ Foyda)
  const colCount = 20 + revCols.length + (money ? 1 : 0) + (showDriver ? 1 : 0) + (canEdit ? 1 : 0);

  // Excel — ekrandagi filtr va tartibdagi qatorlar, barcha mashinalar bitta varaqda («Mashina» ustuni bilan)
  const excel = async () => {
    const plates = [...new Set(shown.map((r) => r.plate))];
    return [
      { name: sheetName(plates.length === 1 ? plates[0]! : "Hisob varag'i"), rows: shown.map((r) => excelRow(r, money)) },
      { name: "Jamlanma", rows: sums.map((d) => ({ Haydovchi: d.driver, Oylik: d.payroll, Naqd: d.cash, "Narxsiz (taklif)": d.suggested, Jami: d.total })) },
    ];
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <InfoButton title="Hisob varag'i">
            <p>Reys yetkazilganda o&apos;zi tushadi: km — ECO/GPS izi (bo&apos;lmasa zayavka masofasi × 2), baraban soati — haydovchi yoki reys vaqti.</p>
            <p>{canEdit ? "Har katakdagi qalam — shu ustunni, qator oxiridagisi — butun qatorni tahrirlaydi." : "ECO bermagan km — km katagidagi qalam bilan yoziladi."} Sarf — transport normasi, qoldiq — mashina bo&apos;yicha zapravkalar minus sarf.</p>
            <p>Ustun nomi yonidagi tugma — Excel kabi filtr va saralash; jami qatori va Excel filtrdagi qatorlar bo&apos;yicha.</p>
            <p><span className="rounded bg-amber-100 px-1 text-amber-800">Sariq</span> — naqd haq.</p>
          </InfoButton>
          {filtered && (
            <>
              <span className="text-sm text-slate-500 tabular">{shown.length} / {rows.length} qator</span>
              <Button type="button" size="sm" variant="secondary" onClick={() => setFilters({})}><FilterX size={14} /> Filtrlarni tozalash</Button>
            </>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canEdit && <LedgerImportButton vehicleId={vehicleId} />}
          <ExcelButton file={file} load={excel} />
        </div>
      </div>
      <Sheet lang="uz">
        <SheetHead>
          <tr>
            {fth("sana", "Sana", { rowSpan: 2 })}
            {showDriver && fth("driver", "Haydovchi", { rowSpan: 2 })}
            {fth("pickup", "Yuklash joyi", { rowSpan: 2 })}
            {fth("dropoff", "Tushirish joyi", { rowSpan: 2 })}
            {fth("trips", "Reys", { rowSpan: 2, right: true })}
            {fth("cargo", "Yuk", { rowSpan: 2 })}
            {fth("km", "Probeg, km", { rowSpan: 2, right: true })}
            {fth("hours", "Baraban, soat", { rowSpan: 2, right: true, title: "Mikser barabani ishlagan soat" })}
            {fth("drumUse", "Baraban sarfi", { rowSpan: 2, right: true, tone: "blue", title: "Baraban soati × soat normasi" })}
            <SheetTh colSpan={4} tone="blue">Gaz / yoqilg&apos;i, {unit}</SheetTh>
            {fth("fuelSum", <>Yoqilg&apos;i normasi, so&apos;m</>, { rowSpan: 2, right: true, tone: "blue" })}
            {fth("pay", "Haydovchi haqi", { rowSpan: 2, right: true })}
            <SheetTh colSpan={4} tone="red">Xarajat</SheetTh>
            {fth("total", "Jami xarajat", { rowSpan: 2, right: true, tone: "red", title: "Umumiy rasxod: yoqilg'i + haydovchi haqi + ta'mir + zapchast + vulkanizator + boshqa" })}
            {money ? <>
              <SheetTh colSpan={debt ? 3 : 2} tone="green" title="Zayavka dastavka haqi (reyslarga hajm ulushida) va qo'lda qator">Dostavka summasi</SheetTh>
              <SheetTh colSpan={2} tone="green" title="Tashqi xizmat (usluga) kirimi — qo'lda qator">Usluga prixod</SheetTh>
              {fth("rev-obj", <>Obyekt<span className="block text-[11px] font-medium">zavod uchun</span></>, { rowSpan: 2, right: true, tone: "green", title: "Zavodning o'zi uchun ish — zavodga olib kelingan narsa (logistika daromadi, foydaga kiradi)" })}
              {fth("profit", "Foyda", { rowSpan: 2, right: true, tone: "yellow" })}
            </> : (
              <SheetTh colSpan={revCols.length} tone="green" title="Dostavka (zayavka dastavka haqi, qo'lda qator) va usluga kirimi to'lov turi bo'yicha; obyekt — zavodning o'zi uchun ish">Bajarilgan ish (summada)</SheetTh>
            )}
            {fth("note", "Izoh", { rowSpan: 2 })}
            {canEdit && <SheetTh rowSpan={2}><span className="sr-only">Amal</span></SheetTh>}
          </tr>
          <tr>
            {fth("balBefore", "Qoldiq", { right: true, tone: "blue", title: "Qatordan oldingi qoldiq" })}
            {fth("refuel", "Zapravka", { right: true, tone: "blue" })}
            {fth("use", "Sarf", { right: true, tone: "blue" })}
            {fth("balAfter", "Qoldiq", { right: true, tone: "blue", title: "Qatordan keyingi qoldiq" })}
            {fth("repair", "Ta'mir", { right: true, tone: "red" })}
            {fth("parts", "Zapchast", { right: true, tone: "red" })}
            {fth("vulc", "Vulkanizator", { right: true, tone: "red" })}
            {fth("other", "Boshqa", { right: true, tone: "red" })}
            {money ? <>
              {fth("rev-bank", "Perech.", { right: true, tone: "green", title: "Perechisleniye" })}
              {fth("rev-cash", "Naqd", { right: true, tone: "green" })}
              {debt && fth("rev-debt", "Qarzga", { right: true, tone: "green", title: "Zayavkada to'lov turi ko'rsatilmagan — mijoz keyin to'laydi" })}
              {fth("rev-svcBank", "Perech.", { right: true, tone: "green", title: "Perechisleniye" })}
              {fth("rev-svcCash", "Naqd", { right: true, tone: "green" })}
            </> : <>
              {fth("rev-bank", "Perech.", { right: true, tone: "green", title: "Perechisleniye (П/Р): dostavka + usluga" })}
              {fth("rev-cash", "Naqd", { right: true, tone: "green", title: "Naqd (Н/Л): dostavka + usluga" })}
              {debt && fth("rev-debt", "Qarzga", { right: true, tone: "green", title: "Zayavkada to'lov turi ko'rsatilmagan — mijoz keyin to'laydi" })}
              {fth("rev-obj", "Obyekt", { right: true, tone: "green", title: "Zavodning o'zi uchun ish — zavodga olib kelingan narsa" })}
            </>}
          </tr>
        </SheetHead>
        <tbody>
          {shown.length === 0 && (
            <SheetTr><SheetTd colSpan={colCount} center muted className="py-8">
              {rows.length ? "Filtrga mos qator yo'q" : "Bu oyda qator yo'q — reys yetkazilganda o'zi tushadi yoki qo'lda qo'shing"}
            </SheetTd></SheetTr>
          )}
          {shown.map((r) => {
            const missing = r.kind === "trip" && (r.km < 1 || r.workHours == null);
            const kmNode = <span className={missing ? "text-amber-700" : undefined} title={missing ? "ECO km yoki baraban soatini bermadi" : splitTitle(r.km, r.kmGas, "km")}><N v={r.km} /></span>;
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
                <SheetTd right>{ed("hours", "Baraban, soat", <span title={splitTitle(r.workHours, r.hoursGas, "soat")}><N v={r.workHours} frac={1} /></span>, true)}</SheetTd>
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
                  {ed("note", "Izoh", <span className="block truncate" title={[r.partial.length ? `Qisman: ${r.partial.join(", ")} yozilmagan` : null, r.dup ? `Takror? ${r.dup}` : null, ...r.remarks].filter(Boolean).join(" · ")}>
                    {r.realId && <span className="mr-1 rounded bg-blue-50 px-1 font-semibold text-blue-700">Realizatsiya</span>}
                    {r.partial.length > 0 && <span className="mr-1 rounded bg-amber-100 px-1 font-semibold text-amber-800">Qisman: {r.partial.join(", ")}</span>}
                    {r.dup && <span className="mr-1 rounded bg-red-50 px-1 font-semibold text-red-700">Takror? {r.dup}</span>}
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
        {shown.length > 0 && (
          <SheetFoot sticky>
            <tr>
              <SheetTd colSpan={showDriver ? 4 : 3}>Jami: {total.rows} qator{filtered ? ` (${rows.length} tadan)` : ""}</SheetTd>
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

      {/* Excel'dagi ISMI / OYLIK / NAXT — varaqdagi (filtrdagi) haydovchilar haqi */}
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
