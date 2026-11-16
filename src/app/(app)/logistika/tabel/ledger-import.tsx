"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, CircleHelp, FileSpreadsheet, Link2, Plus, Save, Trash2, Upload, X, XCircle } from "lucide-react";
import { Button, InfoButton } from "@/components/ui";
import { fmtNum } from "@/lib/format";
import { guessColumn, headerRowIndex, matchKey, num, numMoney, parseDateCell, str } from "@/lib/excel";
import type { LinkState, RowResult } from "@/lib/ledger-import";
import { LEDGER_TEXT_MAX as TEXT_MAX } from "@/lib/ledger-revenue";
import { cn } from "@/lib/utils";
import { ledgerImportCheckAction, ledgerImportSaveAction } from "../actions";
import { useLedgerOptions, type LedgerOptions, type LedgerVehicle } from "./ledger-forms";

/**
 * Hisob varag'i → «Excel orqali qo'shish»: dispetcher varag'i (Google Sheets / Excel) ko'rinishidagi jadval. Qatorlar
 * Excel'dan nusxalab joylanadi (Ctrl+V — birinchi katakdan butun qator/blok), fayldan yuklanadi yoki shu yerda yoziladi.
 * Yashil ustunlar o'zi hisoblanadi (DT / gaz normasi, yoqilg'i summasi, jami xarajat, daromad, foyda), «Sotuv reysi» —
 * shu mashinaning shu kungi yetkazilgan reysi bilan bog'lanish (serverda, `lib/ledger-import.ts`). Saqlashda bog'langan
 * qator reys qatoriga yoziladi, qolgani — qo'lda qator.
 */

type Field = "date" | "plate" | "driver" | "pickup" | "dropoff" | "trips" | "cargo" | "kmDt" | "kmGas" | "hDt" | "hGas"
  | "pay" | "payType" | "repair" | "parts" | "vulc" | "svcBank" | "svcCash" | "svcFree" | "note" | "ttn";
type Calc = "dtNorm" | "gasNorm" | "fuelSum" | "cost" | "income" | "profit" | "link";
type Row = Record<Field, string> & { key: string };
type Col = { f?: Field; calc?: Calc; label: string; w: number; num?: "money" | "qty"; list?: string };

/** Ko'rinish va joylashtirish (paste) tartibi — dispetcher varag'idagidek. Hisoblanadigan ustunlarga joylanmaydi. */
const COLS: Col[] = [
  { f: "date", label: "Sana", w: 104 },
  { f: "plate", label: "Mashina", w: 108, list: "li-plates" },
  { f: "driver", label: "Haydovchi", w: 170, list: "li-drivers" },
  { f: "pickup", label: "Qayerdan (yuklash)", w: 150, list: "li-pickups" },
  { f: "dropoff", label: "Qayerga (tushirish)", w: 200, list: "li-dropoffs" },
  { f: "trips", label: "Reys", w: 52, num: "qty" },
  { f: "cargo", label: "Yuk", w: 150, list: "li-cargos" },
  { f: "kmDt", label: "Probeg DTda (km)", w: 74, num: "qty" },
  { f: "kmGas", label: "Probeg gazda (km)", w: 74, num: "qty" },
  { f: "hDt", label: "Baraban DTda (soat)", w: 74, num: "qty" },
  { f: "hGas", label: "Baraban gazda (soat)", w: 74, num: "qty" },
  { f: "pay", label: "Ish haqi (so'm)", w: 100, num: "money" },
  { f: "payType", label: "To'lov turi (Naqd / Oylik)", w: 86, list: "li-paytypes" },
  { f: "repair", label: "Remont usta (so'm)", w: 100, num: "money" },
  { f: "parts", label: "Zapchast (so'm)", w: 100, num: "money" },
  { f: "vulc", label: "Vulkanizatsiya (so'm)", w: 106, num: "money" },
  { f: "svcBank", label: "Usluga — perechisleniya (so'm)", w: 112, num: "money" },
  { f: "svcCash", label: "Usluga — naqd (so'm)", w: 106, num: "money" },
  { f: "svcFree", label: "Usluga — tekin / o'zimizga (so'm)", w: 112, num: "money" },
  { f: "note", label: "Izoh", w: 180 },
  { calc: "dtNorm", label: "DT norma (l)", w: 72 },
  { calc: "gasNorm", label: "Gaz norma (m³)", w: 72 },
  { calc: "fuelSum", label: "Yoqilg'i summasi (so'm)", w: 100 },
  { calc: "cost", label: "Jami xarajat (so'm)", w: 100 },
  { calc: "income", label: "Jami daromad (so'm)", w: 100 },
  { calc: "profit", label: "Foyda (so'm)", w: 100 },
  { f: "ttn", label: "TTN №", w: 112 },
  { calc: "link", label: "Sotuv reysi (bog'lanish)", w: 280 },
];
const FIELDS = COLS.map((c) => c.f).filter((f): f is Field => !!f);
const NUM: Partial<Record<Field, "money" | "qty">> = Object.fromEntries(COLS.filter((c) => c.f && c.num).map((c) => [c.f, c.num]));

/** Fayldan yuklashda sarlavha → ustun (kichik harf, qism mosligi; tartib muhim — aniqrog'i oldin). */
const SYN: [Field, string[]][] = [
  ["date", ["sana", "дата", "date"]],
  ["plate", ["mashina", "машина", "transport", "транспорт", "gos", "гос"]],
  ["driver", ["haydovchi", "водител", "f.i.o", "фио"]],
  ["pickup", ["qayerdan", "yuklash", "откуда", "погруз"]],
  ["dropoff", ["qayerga", "tushirish", "куда", "выгруз", "obyekt", "объект"]],
  ["trips", ["reys", "рейс"]],
  ["cargo", ["yuk", "груз"]],
  ["kmDt", ["probeg dt", "пробег дт", "km dt", "dtda (km"]],
  ["kmGas", ["probeg gaz", "пробег газ", "km gaz", "gazda (km"]],
  ["hDt", ["baraban dt", "барабан дт", "dtda (soat"]],
  ["hGas", ["baraban gaz", "барабан газ", "gazda (soat"]],
  ["payType", ["to'lov turi", "tolov turi", "to‘lov turi", "naqd / oylik", "тип оплат"]],
  ["pay", ["ish haqi", "haydovchi haqi", "зарплат", "оплата труд"]],
  ["repair", ["remont", "ta'mir", "ремонт"]],
  ["parts", ["zapchast", "запчаст"]],
  ["vulc", ["vulkan", "вулкан"]],
  ["svcBank", ["perechis", "перечис"]],
  ["svcFree", ["tekin", "o'zimizga", "бесплат"]],
  ["svcCash", ["usluga — naqd", "usluga - naqd", "usluga naqd", "наличн"]],
  ["note", ["izoh", "примеч", "коммент"]],
  ["ttn", ["ttn", "ттн"]],
];
const TOTAL_ROW = /^(jami|итого|итог|всего|жами)\b/i;

const START_ROWS = 12;
let seq = 0;
const blank = (): Row => ({ key: `r${Date.now().toString(36)}${(seq++).toString(36)}`, ...Object.fromEntries(FIELDS.map((f) => [f, ""])) as Record<Field, string> });
const filled = (r: Row) => FIELDS.some((f) => r[f].trim() !== "");

const showDay = (iso: string) => iso.split("-").reverse().join(".");
/** Katak soni: pul — «450.000» ham 450 000; bo'sh / o'qilmagan — null. */
const nv = (r: Row, f: Field): number | null => {
  const t = r[f].trim();
  if (!t) return null;
  const x = NUM[f] === "money" ? numMoney(t) : num(t);
  return Number.isFinite(x) ? x : null;
};
const n0 = (r: Row, f: Field) => nv(r, f) ?? 0;
const badNum = (r: Row, f: Field) => !!NUM[f] && r[f].trim() !== "" && nv(r, f) == null;
/** Sonni Excel'dagidek ko'rsatish: «1 300 000», «2,5». */
const numCell = (f: Field, v: string) => {
  const t = v.trim();
  if (!t) return "";
  const x = NUM[f] === "money" ? numMoney(t) : num(t);
  return Number.isFinite(x) ? fmtNum(x, NUM[f] === "money" ? 0 : Number.isInteger(x) ? 0 : 1) : t;
};
/** To'lov turi: «Naqd» / «НАХТ» / «cash» — naqd; «Oylik» / «oy» — oylik; bo'sh — oylik (varaqdagidek, naqd — belgilanadi). */
const payTypeOf = (v: string): "" | "CASH" | "PAYROLL" | null => {
  const k = matchKey(v);
  if (!k) return "";
  if (/^(naqd|naxt|nakt|nal|cash)/.test(k)) return "CASH";
  if (/^(oylik|oy|payroll|zarplata|perech)/.test(k)) return "PAYROLL";
  return null;
};

/** Mashina: to'liq raqam yoki uning bir qismi («468») — bitta mashinaga mos kelsa. */
function vehicleBy(text: string, list: LedgerVehicle[]): LedgerVehicle | null {
  const k = matchKey(text);
  if (!k) return null;
  const exact = list.find((v) => matchKey(v.plate) === k);
  if (exact) return exact;
  const part = list.filter((v) => matchKey(v.plate).includes(k));
  return part.length === 1 ? part[0]! : null;
}
/** Haydovchi: to'liq ism yoki qisqartma («Abdukarimov G») — har so'z ism so'zlaridan birining boshi bo'lsa; bitta bo'lsin. */
function driverBy(text: string, list: LedgerOptions["drivers"]): LedgerOptions["drivers"][number] | null {
  const k = matchKey(text);
  if (!k) return null;
  const exact = list.find((d) => matchKey(d.name) === k);
  if (exact) return exact;
  const words = text.split(/\s+/).map(matchKey).filter(Boolean);
  const hit = list.filter((d) => { const nw = d.name.split(/\s+/).map(matchKey); return words.every((w) => nw.some((x) => x.startsWith(w))); });
  return hit.length === 1 ? hit[0]! : null;
}

// Ranglar shaffof emas va tungi rejimda ham o'qiladi: rang karta foniga aralashtiriladi (`components/ui/sheet.tsx` dagidek)
const mix = (hex: string, pct: number) => `color-mix(in srgb, ${hex} ${pct}%, var(--color-white))`;
const HEAD_NAVY = "#24375a";
const CALC_HEAD = mix("#16a34a", 34), CALC_BG = mix("#16a34a", 9), TTN_HEAD = mix("#eab308", 55), TTN_BG = mix("#eab308", 14);

/** Saqlashga tayyor qator (server `importRowSchema`) — mashina/haydovchi topilgan, sana o'qilgan. */
type Prepared = {
  key: string; date: string; vehicleId: string; driverId: string | null; pickup: string; dropoff: string; cargo: string;
  trips: number | null; kmDt: number | null; kmGas: number | null; hDt: number | null; hGas: number | null;
  pay: number | null; payType: "" | "CASH" | "PAYROLL"; repair: number | null; parts: number | null; vulc: number | null;
  svcBank: number | null; svcCash: number | null; svcFree: number | null; note: string; ttn: string;
};

export function LedgerImportButton({ vehicleId }: { vehicleId: string | null }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant="secondary" onClick={() => setOpen(true)}><FileSpreadsheet size={16} /> Excel orqali qo&apos;shish</Button>
      {open && <ImportDialog vehicleId={vehicleId} onClose={() => setOpen(false)} />}
    </>
  );
}

function ImportDialog({ vehicleId, onClose }: { vehicleId: string | null; onClose: () => void }) {
  const { options: o } = useLedgerOptions();
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>(() => Array.from({ length: START_ROWS }, blank));
  const [links, setLinks] = useState<Record<string, LinkState>>({});
  const [results, setResults] = useState<Record<string, RowResult>>({});
  const [token] = useState(() => crypto.randomUUID());
  const [checking, setChecking] = useState(false);
  const [saving, startSave] = useTransition();
  const [msg, setMsg] = useState<{ tone: "ok" | "error" | "warn"; text: string } | null>(null);
  const [confirm, setConfirm] = useState<string[] | null>(null);
  const tableRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const tabVehicle = vehicleId ? o.vehicles.find((v) => v.id === vehicleId) ?? null : null;

  // Esc — yopish (ochiq tasdiq paneli bo'lsa — avval u)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { if (confirm) setConfirm(null); else onClose(); } };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, confirm]);

  // ── Qatorning hisoblangan qiymatlari: sana (bo'sh — tepadagi qatorniki), mashina, haydovchi, normalar, pul ──
  const calc = useMemo(() => {
    let lastDate = "";
    return rows.map((r) => {
      const has = filled(r);
      const ownDate = r.date.trim() ? parseDateCell(r.date) : "";
      const date = r.date.trim() ? ownDate : has ? lastDate : "";
      if (ownDate) lastDate = ownDate;
      const v = r.plate.trim() ? vehicleBy(r.plate, o.vehicles) : tabVehicle;
      const d = r.driver.trim() ? driverBy(r.driver, o.drivers) : null;
      const defDriver = !r.driver.trim() && v?.driverId ? o.drivers.find((x) => x.id === v.driverId) ?? null : null;
      const pt = payTypeOf(r.payType);
      const kmDt = n0(r, "kmDt"), kmGas = n0(r, "kmGas"), hDt = n0(r, "hDt"), hGas = n0(r, "hGas");
      const dtNorm = v?.dt && (kmDt || hDt) ? (kmDt * v.dt[0]) / 100 + hDt * v.dt[1] : null;
      const gasNorm = v?.gas && (kmGas || hGas) ? (kmGas * v.gas[0]) / 100 + hGas * v.gas[1] : null;
      const fuelSum = (dtNorm ?? 0) * (v?.dtPrice ?? 0) + (gasNorm ?? 0) * (v?.gasPrice ?? 0);
      const pay = n0(r, "pay");
      const cost = fuelSum + pay + n0(r, "repair") + n0(r, "parts") + n0(r, "vulc");
      const l = links[r.key];
      const linked = l?.status === "linked";
      const income = linked ? l.trips.reduce((a, t) => a + t.revenue, 0) : n0(r, "svcBank") + n0(r, "svcCash") + n0(r, "svcFree");
      const errs: string[] = [];
      if (has) {
        if (!date) errs.push("Sana o'qilmadi — masalan 01.10.2026");
        if (!v) errs.push(r.plate.trim() ? `«${r.plate}» — mashina topilmadi (ro'yxatdan tanlang)` : "Mashinani yozing");
        if (r.driver.trim() && !d) errs.push(`«${r.driver}» — haydovchi topilmadi yoki bir nechta`);
        if (pt === null) errs.push("To'lov turi: Naqd yoki Oylik");
        for (const f of FIELDS) if (badNum(r, f)) errs.push(`${COLS.find((c) => c.f === f)!.label}: son emas`);
        for (const [f, max] of Object.entries(TEXT_MAX) as [Field, number][]) if (r[f].trim().length > max) errs.push(`${COLS.find((c) => c.f === f)!.label}: ${max} belgigacha`);
        if (!linked && [n0(r, "svcBank"), n0(r, "svcCash"), n0(r, "svcFree")].filter((x) => x > 0).length > 1) errs.push("Usluga summasi bitta ustunda bo'lsin");
        // Bog'lanish ma'lum bo'lgach: reysga bog'lanmagan qator — qo'lda qator, unga joy yoki izoh kerak
        if (!r.dropoff.trim() && !r.note.trim() && l && !linked) errs.push("Qayerga yoki izohni yozing");
      }
      return {
        has, date, v, d: d ?? defDriver, defDriver, pt, dtNorm, gasNorm, fuelSum, cost, income, profit: income - cost, errs,
        dtMissing: !!v && !v.dt && (kmDt > 0 || hDt > 0), gasMissing: !!v && !v.gas && (kmGas > 0 || hGas > 0),
      };
    });
  }, [rows, links, o, tabVehicle]);

  const prepared = useMemo(() => rows.flatMap((r, i): Prepared[] => {
    const c = calc[i]!;
    if (!c.has || c.errs.length || !c.v || !c.date) return [];
    return [{
      key: r.key, date: c.date, vehicleId: c.v.id, driverId: c.d?.id ?? null, pickup: r.pickup.trim(), dropoff: r.dropoff.trim(), cargo: r.cargo.trim(),
      trips: nv(r, "trips"), kmDt: nv(r, "kmDt"), kmGas: nv(r, "kmGas"), hDt: nv(r, "hDt"), hGas: nv(r, "hGas"),
      pay: nv(r, "pay"), payType: c.pt || (n0(r, "pay") > 0 ? "PAYROLL" : ""), repair: nv(r, "repair"), parts: nv(r, "parts"), vulc: nv(r, "vulc"),
      svcBank: nv(r, "svcBank"), svcCash: nv(r, "svcCash"), svcFree: nv(r, "svcFree"), note: r.note.trim(), ttn: r.ttn.trim(),
    }];
  }), [rows, calc]);

  // ── Sotuv reysi bilan bog'lanish: jadval o'zgargach 0,6 s dan keyin serverda tekshiriladi (sana va mashinasi bor
  // hamma qator — boshqa ustundagi xato bog'lanishni to'xtatmaydi) ──
  const checkKey = JSON.stringify(rows.flatMap((r, i) => {
    const c = calc[i]!;
    return c.has && c.v && c.date ? [[r.key, c.date, c.v.id, r.dropoff.trim(), r.cargo.trim(), nv(r, "trips"), r.ttn.trim(), nv(r, "kmDt"), nv(r, "kmGas")]] : [];
  }));
  const reqId = useRef(0);
  useEffect(() => {
    const list = JSON.parse(checkKey) as [string, string, string, string, string, number | null, string, number | null, number | null][];
    if (!list.length) { setLinks({}); return; }
    const id = ++reqId.current;
    const t = setTimeout(() => {
      setChecking(true);
      ledgerImportCheckAction(list.map(([key, date, vid, dropoff, cargo, trips, ttn, kmDt, kmGas]) => ({ key, date, vehicleId: vid, dropoff, cargo, trips, ttn, kmDt, kmGas })))
        .then((r) => { if (id === reqId.current && r.links) setLinks(r.links); })
        .catch(() => undefined)
        .finally(() => { if (id === reqId.current) setChecking(false); });
    }, 600);
    return () => clearTimeout(t);
  }, [checkKey]);

  // ── Tahrir ──
  const patch = (key: string, f: Field, v: string) => {
    setRows((all) => all.map((r) => (r.key === key ? { ...r, [f]: v } : r)));
    setResults((x) => { if (!x[key]) return x; const n = { ...x }; delete n[key]; return n; });
  };
  const onBlurCell = (key: string, f: Field, v: string) => {
    let t = v;
    if (NUM[f]) t = numCell(f, v);
    else if (f === "date") { const iso = parseDateCell(v); t = iso ? showDay(iso) : v.trim(); }
    else if (f === "payType") { const p = payTypeOf(v); t = p === "CASH" ? "Naqd" : p === "PAYROLL" ? "Oylik" : v.trim(); }
    else if (f === "plate") { const x = vehicleBy(v, o.vehicles); t = x ? x.plate : v.trim(); }
    else if (f === "driver") { const x = driverBy(v, o.drivers); t = x ? x.name : v.trim(); }
    if (t !== v) patch(key, f, t);
  };
  const focusCell = (row: number, col: number) => {
    const el = tableRef.current?.querySelector<HTMLInputElement>(`[data-row="${row}"][data-col="${col}"]`);
    if (el) { el.focus(); el.select(); }
  };
  /** Enter / Shift+Enter — pastga/tepaga; ↑↓ — ro'yxatsiz kataklarda; ←→ — kursor katak chetida bo'lsa (Excel'dagidek). */
  const onKey = (row: number, col: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    const el = e.currentTarget, listed = !!el.getAttribute("list");
    const go = (r: number, c: number) => { e.preventDefault(); focusCell(Math.max(0, Math.min(rows.length - 1, r)), Math.max(0, Math.min(FIELDS.length - 1, c))); };
    const all = el.selectionStart === 0 && el.selectionEnd === el.value.length;
    if (e.key === "Enter") { if (row === rows.length - 1 && !e.shiftKey) setRows((x) => [...x, blank()]); go(row + (e.shiftKey ? -1 : 1), col); }
    else if (e.key === "ArrowDown" && !listed) go(row + 1, col);
    else if (e.key === "ArrowUp" && !listed) go(row - 1, col);
    else if (e.key === "ArrowLeft" && (all || el.selectionEnd === 0) && col > 0) go(row, col - 1);
    else if (e.key === "ArrowRight" && (all || el.selectionStart === el.value.length) && col < FIELDS.length - 1) go(row, col + 1);
  };
  /** Excel'dan blok (tab va qator bilan) — joriy katakdan boshlab varaq tartibida yoyiladi; hisoblanadigan ustunlar o'tkazib yuboriladi. */
  const onPaste = (row: number, f: Field, e: React.ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData("text/plain");
    if (!/[\t\n]/.test(text.replace(/\r?\n$/, ""))) return;
    e.preventDefault();
    const grid = text.replace(/\r/g, "").replace(/\n$/, "").split("\n").map((l) => l.split("\t"));
    const start = COLS.findIndex((c) => c.f === f);
    setRows((all) => {
      const list = [...all];
      grid.forEach((cells, i) => {
        const at = row + i;
        while (list.length <= at) list.push(blank());
        const next = { ...list[at]! };
        cells.forEach((v, j) => {
          const to = COLS[start + j]?.f;
          if (!to) return;
          const t = v.trim();
          next[to] = NUM[to] ? numCell(to, t) : to === "date" ? (parseDateCell(t) ? showDay(parseDateCell(t)) : t) : t;
        });
        list[at] = next;
      });
      if (filled(list[list.length - 1]!)) list.push(blank());
      return list;
    });
    setResults({});
  };
  const addRows = () => setRows((x) => [...x, ...Array.from({ length: 10 }, blank)]);
  const removeRow = (key: string) => setRows((x) => { const n = x.filter((r) => r.key !== key); return n.length ? n : [blank()]; });
  const clearAll = () => { setRows(Array.from({ length: START_ROWS }, blank)); setResults({}); setLinks({}); setMsg(null); };

  // ── Fayldan yuklash: sarlavha bo'yicha ustunlar (topilmasa — varaq tartibida) ──
  const loadFile = async (file: File) => {
    try {
      const XLSX = await import("xlsx");
      // `raw` — CSV / matnli faylda «2,5» kasr 25 bo'lib qolmasin (o'zimiz `num` bilan o'qiymiz); xlsx kataklariga ta'sir qilmaydi
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array", raw: true });
      const ws = wb.Sheets[wb.SheetNames[0]!];
      if (!ws) throw new Error("Varaq bo'sh");
      const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: "" });
      const hi = headerRowIndex(aoa);
      if (hi < 0) throw new Error("Fayl bo'sh");
      const headers = (aoa[hi] ?? []).map((h) => str(h));
      const taken = new Set<string>();
      const at = new Map<Field, number>();
      for (const [f, syn] of SYN) {
        const h = guessColumn(headers, syn, taken);
        if (h) { taken.add(h); at.set(f, headers.indexOf(h)); }
      }
      // Sarlavha tanilmasa — ustunlar varaq tartibida deb olinadi (hisoblanadigan ustunlar o'tkazib)
      const positional = at.size < 4;
      // Tartib bo'yicha o'qilganda faqat birinchi katagi sana bo'lgan qatorlar (sarlavha va izoh qatorlari tushmaydi)
      const data = (positional ? aoa.filter((r) => !!parseDateCell(r[0])) : aoa.slice(hi + 1))
        .filter((r) => r.some((c) => str(c) !== "") && !TOTAL_ROW.test(str(r[0])));
      const list = data.map((cells) => {
        const r = blank();
        COLS.forEach((c, ci) => {
          if (!c.f) return;
          const v = cells[positional ? ci : at.get(c.f) ?? -1];
          if (v == null || str(v) === "") return;
          r[c.f] = c.f === "date" ? (parseDateCell(v) ? showDay(parseDateCell(v)) : str(v)) : NUM[c.f] ? numCell(c.f, typeof v === "number" ? String(v).replace(".", ",") : str(v)) : str(v);
        });
        return r;
      }).filter(filled);
      if (!list.length) throw new Error("Faylda qator topilmadi");
      setRows([...list, blank()]);
      setResults({});
      setMsg({ tone: "ok", text: `${list.length} ta qator fayldan olindi${positional ? " (sarlavha tanilmadi — ustunlar varaq tartibida)" : ""} — tekshirib, «Saqlash» ni bosing` });
    } catch (e) {
      setMsg({ tone: "error", text: `Faylni o'qib bo'lmadi: ${e instanceof Error ? e.message : "noma'lum xato"}` });
    }
  };

  // ── Saqlash ──
  const bad = rows.filter((r, i) => calc[i]!.has && calc[i]!.errs.length).length;
  const warnings = useMemo(() => {
    const w: string[] = [];
    const missing = prepared.filter((p) => links[p.key]?.status === "ttn-missing").length;
    const dup = prepared.filter((p) => { const l = links[p.key]; return l?.status === "no-sales" && l.dup; }).length;
    const svcIgnored = prepared.filter((p) => links[p.key]?.status === "linked" && ((p.svcBank ?? 0) + (p.svcCash ?? 0) + (p.svcFree ?? 0)) > 0).length;
    if (missing) w.push(`${missing} ta qatorda shu kuni sotuv reysi bor, lekin TTN yozilmagan — yangi qo'lda qator bo'lib tushadi (reys bilan ikki marta hisoblanishi mumkin)`);
    if (dup) w.push(`${dup} ta qator avval kiritilgan qatorga o'xshaydi (takror bo'lishi mumkin)`);
    if (svcIgnored) w.push(`${svcIgnored} ta reysga bog'langan qatorda usluga summasi bor — daromad zayavka dastavka haqidan olinadi, usluga yozilmaydi`);
    return w;
  }, [prepared, links]);

  const save = (force = false) => {
    if (!prepared.length) { setMsg({ tone: "error", text: bad ? "Qizil qatorlardagi xatoni tuzating" : "Saqlanadigan qator yo'q" }); return; }
    if (!force && warnings.length) { setConfirm(warnings); return; }
    setConfirm(null);
    setMsg(null);
    startSave(async () => {
      const r = await ledgerImportSaveAction(prepared, token);
      if (r.error || !r.results) { setMsg({ tone: "error", text: r.error ?? "Saqlab bo'lmadi" }); return; }
      const res = r.results;
      const ok = Object.entries(res).filter(([, x]) => "ok" in x).map(([k]) => k);
      const fail = Object.keys(res).length - ok.length;
      // Saqlangan qatorlar jadvaldan olinadi, xatoliklari qoladi (sababi qator oxirida)
      setRows((all) => { const n = all.filter((x) => !ok.includes(x.key)); return n.some(filled) ? n : [...n.filter(filled), ...Array.from({ length: START_ROWS }, blank)]; });
      setResults(Object.fromEntries(Object.entries(res).filter(([, x]) => "error" in x)));
      setMsg(fail
        ? { tone: "warn", text: `${ok.length} ta qator saqlandi, ${fail} tasida xato — qizil qatorlarni tuzatib, qayta saqlang` }
        : { tone: "ok", text: `${ok.length} ta qator saqlandi — hisob varag'ida ko'rinadi` });
      router.refresh();
    });
  };

  const totals = calc.reduce((t, c) => (c.has ? { cost: t.cost + c.cost, income: t.income + c.income, profit: t.profit + c.profit, n: t.n + 1 } : t), { cost: 0, income: 0, profit: 0, n: 0 });
  const cellCls = "border-r border-b border-slate-300/80";
  const inp = "h-7 w-full bg-transparent px-1.5 text-[11px] text-slate-900 outline-none focus:bg-sky-50 focus:ring-2 focus:ring-inset focus:ring-sky-500 placeholder:text-slate-400";

  const linkCell = (r: Row, i: number) => {
    const res = results[r.key];
    if (res && "error" in res) return <span className="flex items-start gap-1 text-red-700" title={res.error}><XCircle size={13} className="mt-px shrink-0" /><span className="line-clamp-2">{res.error}</span></span>;
    const c = calc[i]!;
    if (c.has && c.errs.length) return <span className="flex items-start gap-1 text-red-700" title={c.errs.join("\n")}><AlertTriangle size={13} className="mt-px shrink-0" /><span className="line-clamp-2">{c.errs[0]}{c.errs.length > 1 ? ` (+${c.errs.length - 1})` : ""}</span></span>;
    const l = links[r.key];
    if (!c.has || !l) return null;
    if (l.status === "linked") {
      const text = l.trips.map((t) => t.label).join(", ");
      return (
        <span className="flex items-start gap-1 text-emerald-700" title={`${l.auto ? "Mijoz nomi bo'yicha topildi" : "TTN bo'yicha"}: ${l.trips.map((t) => `${t.label} · ${t.customer}`).join("; ")} — saqlanganda shu reys qatoriga yoziladi`}>
          <Link2 size={13} className="mt-px shrink-0" /><span className="truncate">{text}{l.missing ? <span className="text-amber-700"> · yana {l.missing} ta topilmadi</span> : null}</span>
        </span>
      );
    }
    if (l.status === "ttn-missing") return <span className="flex items-center gap-1 text-amber-700" title="Shu mashinada shu kuni sotuv reysi bor, lekin mijoz nomi mos kelmadi — TTN raqamini yozing"><CircleHelp size={13} className="shrink-0" />TTN yozing ({l.count} ta sotuv reysi)</span>;
    if (l.status === "ttn-notfound") return <span className="flex items-center gap-1 text-red-700"><XCircle size={13} className="shrink-0" />TTN topilmadi: {l.ttn.join(", ")}</span>;
    if (l.status === "no-trip") return <span className="flex items-center gap-1 text-slate-500" title="Reys soni bo'sh — sotuv reysi bilan bog'lanmaydi, qo'lda qator bo'lib tushadi">reyssiz qator (remont, haq…)</span>;
    if (l.dup) return <span className="flex items-center gap-1 text-amber-700" title="Shu mashina, kun, joy, reys va km bilan qator allaqachon bor"><AlertTriangle size={13} className="shrink-0" />Takror bo&apos;lishi mumkin: {l.dup}</span>;
    return <span className="flex items-center gap-1 text-slate-500" title="Saqlanganda yangi qo'lda qator bo'lib tushadi"><XCircle size={13} className="shrink-0 text-slate-400" />shu kuni bu mashinada sotuv yo&apos;q</span>;
  };

  const calcCell = (c: (typeof calc)[number], k: Calc) => {
    if (!c.has) return null;
    const money = (v: number) => (Math.abs(v) >= 1 ? fmtNum(v, 0) : "");
    switch (k) {
      case "dtNorm": return c.dtMissing ? <span className="text-amber-700" title="Mashina kartasida dizel normasi yo'q">norma yo&apos;q</span> : c.dtNorm != null ? fmtNum(c.dtNorm, 1) : "";
      case "gasNorm": return c.gasMissing ? <span className="text-amber-700" title="Mashina kartasida gaz normasi yo'q">norma yo&apos;q</span> : c.gasNorm != null ? fmtNum(c.gasNorm, 1) : "";
      case "fuelSum": return money(c.fuelSum);
      case "cost": return money(c.cost);
      case "income": return money(c.income);
      case "profit": return money(c.profit);
      default: return null;
    }
  };

  return createPortal((
    <div className="fixed inset-0 z-50 flex bg-slate-900/50 p-2 sm:p-4" onMouseDown={(e) => { if (e.target === e.currentTarget && !rows.some(filled)) onClose(); }}>
      <div role="dialog" aria-label="Excel orqali qo'shish" className="flex min-h-0 w-full flex-col overflow-hidden rounded-(--radius-card) border border-slate-200 bg-white shadow-(--shadow-pop)">
        {/* Sarlavha va amallar */}
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-4 py-3">
          <div className="mr-auto min-w-0">
            <h2 className="flex items-center gap-1.5 text-base font-semibold tracking-tight">
              <FileSpreadsheet size={18} className="text-emerald-600" /> Excel orqali qo&apos;shish — hisob varag&apos;i
              <InfoButton title="Excel orqali qo'shish">
                <p>Excel yoki Google varag&apos;idan qatorlarni nusxalang va «Sana» katagiga joylang (Ctrl+V) — ustunlar shu tartibda tushadi. Yoki «Fayldan yuklash».</p>
                <p>Yashil ustunlar o&apos;zi hisoblanadi: DT / gaz normasi — mashina kartasidagi normadan, yoqilg&apos;i summasi — oxirgi zapravka narxidan (taxminiy).</p>
                <p>«Sotuv reysi» — shu mashinaning shu kungi yetkazilgan reysi: TTN yozilsa — shu raqam bo&apos;yicha, yozilmasa — «Qayerga» mijoz nomiga mos reys. Bog&apos;langan qator yangi qator ochmaydi: km, baraban soati, haq va xarajat reys qatoriga yoziladi (bir necha reys bo&apos;lsa — teng bo&apos;lib).</p>
                <p>Sana bo&apos;sh — tepadagi qator sanasi; mashina bo&apos;sh — ochiq varaq mashinasi; haydovchi bo&apos;sh — mashinaning asosiy haydovchisi; to&apos;lov turi bo&apos;sh — oylik.</p>
              </InfoButton>
            </h2>
            <p className="text-xs text-slate-500">
              {totals.n ? <>{totals.n} ta qator · xarajat <b className="tabular text-slate-700">{fmtNum(totals.cost, 0)}</b> · daromad <b className="tabular text-slate-700">{fmtNum(totals.income, 0)}</b> · foyda <b className={cn("tabular", totals.profit < 0 ? "text-red-600" : "text-emerald-700")}>{fmtNum(totals.profit, 0)}</b></> : "Qatorlarni joylang yoki yozing"}
              {checking && <span className="ml-2 text-slate-400">· sotuv reyslari tekshirilmoqda…</span>}
              {bad > 0 && <span className="ml-2 font-medium text-red-600">· {bad} ta qatorda xato</span>}
            </p>
          </div>
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void loadFile(f); e.target.value = ""; }} />
          <Button type="button" variant="secondary" size="sm" onClick={() => fileRef.current?.click()}><Upload size={14} /> Fayldan yuklash</Button>
          <Button type="button" variant="secondary" size="sm" onClick={addRows}><Plus size={14} /> 10 qator</Button>
          <Button type="button" variant="secondary" size="sm" onClick={clearAll} disabled={!rows.some(filled)}><Trash2 size={14} /> Tozalash</Button>
          <Button type="button" size="sm" onClick={() => save()} disabled={saving || !prepared.length}><Save size={14} /> {saving ? "Saqlanmoqda…" : `Saqlash${prepared.length ? ` (${prepared.length})` : ""}`}</Button>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-900" aria-label="Yopish"><X size={18} /></button>
        </div>

        {msg && (
          <div className={cn("flex items-center gap-2 border-b px-4 py-2 text-sm",
            msg.tone === "ok" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : msg.tone === "warn" ? "border-amber-200 bg-amber-50 text-amber-800" : "border-red-200 bg-red-50 text-red-800")}>
            {msg.tone === "ok" ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />} {msg.text}
          </div>
        )}
        {confirm && (
          <div className="space-y-2 border-b border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <div className="flex items-center gap-1.5 font-semibold"><AlertTriangle size={15} /> Saqlashdan oldin tekshiring</div>
            <ul className="list-disc space-y-0.5 pl-5">{confirm.map((w) => <li key={w}>{w}</li>)}</ul>
            <div className="flex gap-2">
              <Button type="button" size="sm" onClick={() => save(true)} disabled={saving}>Baribir saqlash</Button>
              <Button type="button" size="sm" variant="secondary" onClick={() => setConfirm(null)}>Ortga</Button>
            </div>
          </div>
        )}

        {/* Jadval — dispetcher varag'i ko'rinishida */}
        <div ref={tableRef} data-nav="off" className="min-h-0 flex-1 overflow-auto overscroll-contain">
          <table className="border-separate border-spacing-0 font-(family-name:--font-inter) text-[11px] tabular">
            <thead className="sticky top-0 z-10">
              <tr>
                <th className="sticky left-0 z-20 w-9 min-w-9 border-r border-b border-slate-400" style={{ background: HEAD_NAVY }} />
                {COLS.map((c, ci) => (
                  <th key={ci} style={{ minWidth: c.w, width: c.w, background: c.calc && c.calc !== "link" ? CALC_HEAD : c.f === "ttn" ? TTN_HEAD : c.calc === "link" ? CALC_HEAD : HEAD_NAVY }}
                    className={cn("border-r border-b border-slate-400 px-1.5 py-1.5 text-center align-middle text-[10px] leading-tight font-bold whitespace-normal",
                      c.calc || c.f === "ttn" ? "text-slate-900" : "text-[#fff]")}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const c = calc[i]!;
                const err = (c.has && c.errs.length > 0) || (results[r.key] && "error" in results[r.key]!);
                const cash = c.pt === "CASH";
                return (
                  <tr key={r.key} className="group">
                    <td className={cn("sticky left-0 z-[5] w-9 min-w-9 border-r border-b border-slate-300 bg-slate-100 text-center text-[11px] text-slate-500", err && "bg-red-100 text-red-700")}>
                      <span className="group-hover:hidden">{i + 1}</span>
                      <button type="button" tabIndex={-1} onClick={() => removeRow(r.key)} aria-label="Qatorni o'chirish" title="Qatorni o'chirish"
                        className="hidden w-full items-center justify-center text-slate-400 hover:text-red-600 group-hover:flex"><X size={13} /></button>
                    </td>
                    {COLS.map((col, ci) => {
                      if (col.calc) {
                        const neg = col.calc === "profit" && c.has && c.profit < -0.5;
                        return (
                          <td key={ci} className={cn(cellCls, "px-1.5 text-[11px]", col.calc === "link" ? "max-w-[260px]" : "text-right whitespace-nowrap text-slate-800", neg && "font-semibold text-red-700")}
                            style={{ background: neg ? mix("#dc2626", 16) : col.calc === "link" ? undefined : CALC_BG }}>
                            {col.calc === "link" ? linkCell(r, i) : calcCell(c, col.calc)}
                          </td>
                        );
                      }
                      const f = col.f!, fi = FIELDS.indexOf(f);
                      const ph = f === "date" && !r.date.trim() && c.has && c.date ? showDay(c.date)
                        : f === "plate" && !r.plate.trim() && tabVehicle ? tabVehicle.plate
                        : f === "driver" && !r.driver.trim() && c.defDriver ? c.defDriver.name
                        : f === "payType" && !r.payType.trim() && n0(r, "pay") > 0 ? "Oylik" : undefined;
                      const wrong = (f === "plate" && c.has && !c.v) || (f === "driver" && r.driver.trim() && !driverBy(r.driver, o.drivers)) || badNum(r, f)
                        || (f === "date" && c.has && !c.date) || (f === "payType" && c.pt === null);
                      return (
                        <td key={ci} className={cn(cellCls, wrong && "bg-red-50", cash && f === "payType" && "bg-amber-100")} style={f === "ttn" ? { background: TTN_BG } : undefined}>
                          <input value={r[f]} list={col.list} autoComplete="off" spellCheck={false} placeholder={ph}
                            data-row={i} data-col={fi} aria-label={`${i + 1}-qator: ${col.label}`}
                            inputMode={col.num ? "decimal" : undefined}
                            onChange={(e) => patch(r.key, f, e.target.value)}
                            onBlur={(e) => onBlurCell(r.key, f, e.target.value)}
                            onKeyDown={(e) => onKey(i, fi, e)}
                            onPaste={(e) => onPaste(i, f, e)}
                            className={cn(inp, col.num && "text-right", wrong && "text-red-700")} />
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
          <button type="button" onClick={addRows} className="m-2 inline-flex items-center gap-1 text-xs font-medium text-sky-700 hover:underline"><Plus size={13} /> 10 qator qo&apos;shish</button>
        </div>
        <datalist id="li-plates">{o.vehicles.map((v) => <option key={v.id} value={v.plate} />)}</datalist>
        <datalist id="li-drivers">{o.drivers.map((d) => <option key={d.id} value={d.name} />)}</datalist>
        <datalist id="li-pickups">{o.pickups.map((x) => <option key={x} value={x} />)}</datalist>
        <datalist id="li-dropoffs">{o.dropoffs.map((x) => <option key={x} value={x} />)}</datalist>
        <datalist id="li-cargos">{o.cargos.map((x) => <option key={x} value={x} />)}</datalist>
        <datalist id="li-paytypes"><option value="Oylik" /><option value="Naqd" /></datalist>
      </div>
    </div>
  ), document.body);
}
