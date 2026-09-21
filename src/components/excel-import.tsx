"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { FileSpreadsheet, Download, Upload, AlertTriangle, CheckCircle2, Maximize2, Eye, EyeOff, PencilLine, Check, X, ScanLine } from "lucide-react";
import { Button, FormError, Select, Table, Td, Th, Tr } from "@/components/ui";
import { DocScan, type ScanResult } from "@/components/doc-scan";
import { guessColumn, num, str, type ImportField } from "@/lib/excel";
import { normalizeUnit } from "@/lib/unit";
import { fmtNum, money } from "@/lib/format";
import type { ActionState } from "@/lib/action";
import { cn } from "@/lib/utils";

type Row = Record<string, unknown>;
/**
 * Ko'rsatiladigan/yuboriladigan bitta qator: `i` — fayldagi tartib (tahrir shu bo'yicha saqlanadi),
 * `no` — jadvaldagi raqami, `n` — shu qatorga nechta fayl qatori birlashgani, `bad` — muammoli kataklar.
 */
type Flagged = { i: number; no: number; n: number; r: Row; bad: string[]; a?: Amount };
/** Qator bo'yicha pul: summa/NDS fayldan kelgan yoki hisoblangan. */
type Amount = { sum: number; nds: number; total: number; sumCalc: boolean; ndsCalc: boolean; mismatch: boolean };

/**
 * Summa/NDS ustunlarini boshqarish. `fill` berilsa fayldan kelmagan katak hisoblab to'ldiriladi
 * (summa = miqdor × narx, NDS = summa × rate); berilmasa faqat fayldagi qiymat ishlatiladi.
 * Ikkala holatda ham fayldagi summa miqdor × narxga to'g'ri kelmasa ogohlantiriladi.
 */
type AmountCols = { qtyKey: string; priceKey: string; sumKey: string; ndsKey?: string; rate?: number; fill?: boolean };

/**
 * Takroriy qatorlarni birlashtirish. `sum` — qo'shiladigan ustunlar (miqdor, summa, NDS);
 * qolgan hamma ustun "shaxsiy belgi": ularning birortasi boshqacha bo'lsa (masalan narxi yoki birligi)
 * qator birlashmaydi, alohida qoladi. `unitKeys` — birlik ustunlari: "letr" va "litir" bir xil deb qaraladi.
 */
type MergeCols = { sum: string[]; unitKeys?: string[] };

/**
 * Kamera bilan skaner: `endpoint` — rasmni o'qiydigan API, `enabled` — AI kaliti bormi (serverda tekshiriladi),
 * `meta` — hujjat sarlavhasidagi ma'lumot qaysi form maydoniga qo'yilishi ("supplier" → "supplierId").
 */
type ScanCols = { endpoint: string; enabled: boolean; meta?: Record<string, string>; label?: string };

/** Nomlarni taqqoslash uchun soddalashtirish: «"BODOMZOR SEMENT" MCHJ» → bodomzorsementmchj */
const flat = (s: string) => s.toLowerCase().replace(/[^a-z0-9а-яёўқғҳ]+/gi, "");

const PREVIEW = 15; // sahifada shuncha qator; qolgani "Batafsil ko'rish" modalida

/** Excel formulasining xatosi ("#VALUE!", "#N/A"…) — ma'lumot emas, bo'sh katak deb olinadi. */
const XL_ERR = /^#(value|ref|div\/0|n\/a|name|null|num|spill|calc|getting_data)[!?]?$/i;
const cell = (v: unknown) => (typeof v === "string" && XL_ERR.test(v.trim()) ? "" : v ?? "");

/**
 * Bir xil qatorlarni bitta qilib, `sumKeys` ustunlarini qo'shib chiqadi.
 * Tenglik `sumKeys`dan tashqari hamma maydon bo'yicha tekshiriladi — bitta ustunda farq bo'lsa, alohida qator.
 */
function mergeRows(rows: { r: Row; i: number }[], keys: string[], { sum: sumKeys, unitKeys = [] }: MergeCols) {
  const idKeys = keys.filter((k) => !sumKeys.includes(k));
  // Taqqoslash uchun qiymat: birlik — kanonik ko'rinishda, raqam — soni bo'yicha ("9,818" = 9818), matn — kichik harfda
  const idOf = (r: Row, k: string) => {
    const v = str(r[k]);
    if (unitKeys.includes(k)) return normalizeUnit(v) ?? v.toLowerCase();
    const n = num(v);
    return v !== "" && Number.isFinite(n) ? String(n) : v.toLowerCase();
  };
  const out: { r: Row; i: number; n: number }[] = [];
  const at = new Map<string, number>();
  for (const { r, i } of rows) {
    const id = idKeys.map((k) => idOf(r, k)).join("|\u0000|");
    const j = at.get(id);
    if (j === undefined) { at.set(id, out.length); out.push({ r: { ...r }, i, n: 1 }); continue; }
    const g = out[j];
    g.n++;
    for (const k of sumKeys) {
      if (str(g.r[k]) === "" && str(r[k]) === "") continue; // ikkalasi ham bo'sh — bo'sh qoladi
      const a = num(g.r[k]), b = num(r[k]);
      g.r[k] = (Number.isFinite(a) ? a : 0) + (Number.isFinite(b) ? b : 0);
    }
  }
  return out;
}

/**
 * Umumiy Excel import: fayl → brauzerda o'qiladi (SheetJS) → ustunlar maydonlarga moslanadi → oldindan ko'rish → server action.
 * Server action `rows` (JSON, maydon kalitlari bo'yicha) va `children` ichidagi qo'shimcha maydonlarni oladi.
 * Ko'p qator bir vaqtda yuboriladi — bitta hujjat / bitta import.
 */
export function ExcelImport({ fields, action, children, submitLabel = "Import qilish", templateName = "namuna", example, amountCols, merge, scan }: {
  fields: ImportField[];
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  children?: React.ReactNode;
  submitLabel?: string;
  templateName?: string;
  example?: Record<string, string | number>;
  amountCols?: AmountCols;
  merge?: MergeCols;
  scan?: ScanCols;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const [fileName, setFileName] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [map, setMap] = useState<Record<string, string>>({});
  const [parseErr, setParseErr] = useState("");
  const [modal, setModal] = useState(false); // "Batafsil ko'rish" oynasi
  const [editing, setEditing] = useState(false); // oynada kataklarni tahrirlash
  const [edits, setEdits] = useState<Record<string, string>>({}); // "qator:maydon" → yangi qiymat
  const [onlyBad, setOnlyBad] = useState(false); // faqat muammoli qatorlarni ko'rsatish
  const [skipBad, setSkipBad] = useState(false); // muammoli qatorlarni o'tkazib yuborib import qilish
  const [mergeOn, setMergeOn] = useState(true); // takroriy qatorlarni birlashtirib, miqdorlarni qo'shish
  const [scanNote, setScanNote] = useState(""); // skanerdan nima o'qilgani haqida qisqa xabar
  const formRef = useRef<HTMLFormElement>(null);

  const onFile = async (f: File | undefined) => {
    setParseErr(""); setRows([]); setHeaders([]); setMap({}); setScanNote("");
    setModal(false); setEditing(false); setEdits({}); setOnlyBad(false); setSkipBad(false);
    if (!f) return;
    setFileName(f.name);
    try {
      const XLSX = await import("xlsx");
      // raw: CSV/matnda "2,5" kabi qiymatlar raqamga aylantirilmasin (25 bo'lib ketadi) — `num()` o'zi tozalaydi
      // CSV/matn — UTF-8 satr sifatida (kirill sarlavhalar buzilmasin), Excel — baytlar
      const isText = /\.(csv|txt)$/i.test(f.name) || f.type.startsWith("text/");
      const wb = isText ? XLSX.read(await f.text(), { type: "string", raw: true }) : XLSX.read(await f.arrayBuffer(), { type: "array", raw: true });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "", raw: true });
      // Birinchi bo'sh bo'lmagan qator — sarlavha; qolganlari ma'lumot
      const hi = aoa.findIndex((r) => r.some((c) => str(c) !== ""));
      if (hi < 0) { setParseErr("Fayl bo'sh"); return; }
      const hdr = aoa[hi].map((c, i) => str(c) || `Ustun ${i + 1}`);
      const data = aoa.slice(hi + 1).filter((r) => r.some((c) => str(c) !== "")).map((r) => Object.fromEntries(hdr.map((h, i) => [h, cell(r[i])])));
      setHeaders(hdr); setRows(data);
      const taken = new Set<string>(); const m: Record<string, string> = {};
      for (const fl of fields) { const g = guessColumn(hdr, fl.synonyms, taken); if (g) { m[fl.key] = g; taken.add(g); } }
      setMap(m);
    } catch (e) { setParseErr(`Faylni o'qib bo'lmadi: ${e instanceof Error ? e.message : String(e)}`); }
  };

  /**
   * Skaner natijasi: qatorlar xuddi Excel'dan kelgandek jadvalga tushadi (ustunlar to'g'ridan-to'g'ri mos),
   * hujjat sarlavhasi (yetkazuvchi, sana, raqam) esa formadagi tegishli maydonlarga qo'yiladi.
   */
  const onScan = (r: ScanResult) => {
    const hdr = fields.map((f) => f.label);
    setFileName(`Skaner${r.doc.docNo ? ` · № ${r.doc.docNo}` : ""}`);
    setParseErr("");
    setHeaders(hdr);
    setRows(r.rows.map((row) => Object.fromEntries(fields.map((f) => [f.label, row[f.key] ?? ""]))));
    setMap(Object.fromEntries(fields.map((f) => [f.key, f.label])));
    setEdits({}); setOnlyBad(false); setSkipBad(false); setModal(false); setEditing(false);
    setScanNote([`${r.rows.length} ta qator o'qildi`, ...applyMeta(r.doc)].join(" · "));
  };

  /** Hujjat sarlavhasini formaga qo'yadi; nima qo'yilgani (yoki topilmagani) haqida qisqa izohlar qaytaradi. */
  const applyMeta = (doc: ScanResult["doc"]): string[] => {
    const form = formRef.current;
    if (!form || !scan?.meta) return [];
    const out: string[] = [];
    for (const [key, name] of Object.entries(scan.meta)) {
      const v = (doc as Record<string, string>)[key]?.trim();
      if (!v) continue;
      const el = form.elements.namedItem(name);
      if (el instanceof HTMLSelectElement) {
        const want = flat(v);
        const opt = [...el.options].find((o) => o.value && flat(o.text) && (flat(o.text) === want || flat(o.text).includes(want) || want.includes(flat(o.text))));
        if (opt) { el.value = opt.value; out.push(`yetkazuvchi: ${opt.text}`); }
        else out.push(`«${v}» ro'yxatda topilmadi — qo'lda tanlang`);
      } else if (el instanceof HTMLInputElement && el.type === "date") {
        if (/^\d{4}-\d{2}-\d{2}$/.test(v)) { el.value = v; out.push(`sana: ${v}`); }
      } else if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        if (!el.value.trim()) { el.value = key === "docNo" ? `Nakladnoy № ${v}` : v; out.push(`№ ${v}`); }
      }
    }
    return out;
  };

  const downloadTemplate = async () => {
    const XLSX = await import("xlsx");
    const ws = XLSX.utils.json_to_sheet([Object.fromEntries(fields.map((f) => [f.label, example?.[f.key] ?? ""]))]);
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "Import");
    XLSX.writeFile(wb, `${templateName}.xlsx`);
  };

  // Moslangan qatorlar — server shu JSON ni oladi. Oynada tahrirlangan katak fayldagi qiymatdan ustun turadi.
  const mapped = useMemo(() => rows.map((r, i) => Object.fromEntries(fields.map((f) => {
    const e = edits[`${i}:${f.key}`];
    return [f.key, e !== undefined ? e : map[f.key] ? r[map[f.key]] : ""];
  }))), [rows, map, fields, edits]);
  const missingRequired = fields.filter((f) => f.required && !map[f.key]);
  const numericKeys = fields.filter((f) => /qty|price|amount|sum|nds/.test(f.key)).map((f) => f.key);
  const requiredKeys = fields.filter((f) => f.required).map((f) => f.key);
  // Majburiy maydonlari butunlay bo'sh qator — faylning ortiqcha satri (izoh, "jami", bo'sh qator):
  // muammo emas, shunchaki import qilinmaydi — aks holda katta fayl bitta tugmani ham bloklab qo'yadi
  const isBlank = (r: Row) => requiredKeys.length > 0 && requiredKeys.every((k) => str(r[k]) === "");
  // Fayldagi tartib (`i`) saqlanadi — tahrirlar shu raqam bo'yicha yoziladi
  const dataRows = mapped.map((r, i) => ({ r, i })).filter((x) => !isBlank(x.r));
  const blankCount = mapped.length - dataRows.length;
  // Takroriy qatorlar bitta qatorga yig'iladi (miqdorlar qo'shiladi); bitta ustunda farq bo'lsa — alohida qator
  const view = merge && mergeOn ? mergeRows(dataRows, fields.map((f) => f.key), merge) : dataRows.map((x) => ({ ...x, n: 1 }));
  const mergedAway = dataRows.length - view.length;

  // Summa/NDS: fayldagi qiymat ustun, bo'lmasa (fill bo'lsa) miqdor × narxdan hisoblanadi
  const ac = amountCols;
  const amount = (r: Row): Amount | undefined => {
    if (!ac) return undefined;
    const calc = num(r[ac.qtyKey]) * num(r[ac.priceKey]);
    const base = Number.isFinite(calc) ? calc : 0;
    const fs = str(r[ac.sumKey]) === "" ? NaN : num(r[ac.sumKey]);
    const fn = ac.ndsKey && str(r[ac.ndsKey]) !== "" ? num(r[ac.ndsKey]) : NaN;
    const hasFs = Number.isFinite(fs), hasFn = Number.isFinite(fn);
    const sum = hasFs ? fs : ac.fill ? base : 0;
    const nds = hasFn ? fn : ac.fill && ac.rate ? sum * ac.rate : 0;
    return {
      sum, nds, total: sum + nds,
      sumCalc: !hasFs && !!ac.fill && base > 0,
      ndsCalc: !hasFn && !!ac.fill && !!ac.rate && sum > 0,
      mismatch: hasFs && base > 0 && Math.abs(fs - base) > 0.5,
    };
  };

  // Har qator uchun muammoli katak kalitlari: majburiy maydon bo'sh yoki raqam noto'g'ri
  const flagged: Flagged[] = view.map((g, pos) => ({
    i: g.i, no: pos + 1, n: g.n, r: g.r,
    a: amount(g.r),
    bad: [
      ...fields.filter((f) => f.required && str(g.r[f.key]) === "").map((f) => f.key),
      ...numericKeys.filter((k) => str(g.r[k]) !== "" && Number.isNaN(num(g.r[k]))),
    ],
  }));
  const badList = flagged.filter((x) => x.bad.length > 0);
  const allRows = flagged.map((x) => x.r);
  const validRows = flagged.filter((x) => x.bad.length === 0).map((x) => x.r);
  const emptyCells = badList.reduce((n, x) => n + x.bad.length, 0);
  const editCount = Object.keys(edits).length;
  const ready = allRows.length > 0 && missingRequired.length === 0 && badList.length === 0;
  // Muammolilarini tashlab, qolganini qo'shish mumkin bo'lgan holat
  const canSkip = allRows.length > 0 && missingRequired.length === 0 && badList.length > 0 && validRows.length > 0;
  const submitValid = () => { flushSync(() => setSkipBad(true)); formRef.current?.requestSubmit(); };
  const mismatches = flagged.filter((x) => x.a?.mismatch).length;

  const source = onlyBad ? badList : flagged;
  const totals = source.reduce((a, x) => (x.a ? { sum: a.sum + x.a.sum, nds: a.nds + x.a.nds, total: a.total + x.a.total } : a), { sum: 0, nds: 0, total: 0 });

  // Oyna ochiq ekan: Esc bilan yopiladi, orqa fon skroll qilinmaydi
  useEffect(() => {
    if (!modal) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setModal(false); };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [modal]);

  const setCell = (i: number, key: string, v: string) => { setSkipBad(false); setEdits((e) => ({ ...e, [`${i}:${key}`]: v })); };
  const colCount = 1 + fields.length;

  const headRow = (
    <tr><Th>#</Th>{fields.map((f) => <Th key={f.key} right={numericKeys.includes(f.key)}>{f.label}{f.required && " *"}</Th>)}</tr>
  );

  /** Bitta qator: `canEdit` bo'lsa kataklar input bo'lib chiqadi. */
  const renderRow = (x: Flagged, canEdit: boolean) => {
    const a = x.a;
    return (
      <Tr key={x.no} className={x.bad.length ? "bg-red-50/60" : undefined}>
        <Td className="whitespace-nowrap text-slate-400">
          {x.no}
          {x.n > 1 && <span className="ml-1 rounded bg-sky-100 px-1 text-[10px] font-medium text-sky-700" title={`Faylda ${x.n} ta bir xil qator edi — miqdorlari qo'shildi`}>×{x.n}</span>}
        </Td>
        {fields.map((f) => {
          const v = str(x.r[f.key]);
          // Birlashtirilgan (qo'shilgan) raqam — mingliklar bilan ko'rsatiladi; serverga baribir to'liq qiymat ketadi
          const shown = typeof x.r[f.key] === "number" ? fmtNum(x.r[f.key] as number, 3) : v;
          const isBad = x.bad.includes(f.key);
          const edited = edits[`${x.i}:${f.key}`] !== undefined;
          const right = numericKeys.includes(f.key);
          if (canEdit) {
            return (
              <Td key={f.key} className={cn("px-2 py-1.5", isBad && "bg-red-100/70")}>
                <input value={v} onChange={(e) => setCell(x.i, f.key, e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") e.preventDefault(); }}
                  placeholder={isBad ? "to'ldiring" : a && ((ac?.sumKey === f.key && a.sumCalc) || (ac?.ndsKey === f.key && a.ndsCalc)) ? fmtNum(ac?.sumKey === f.key ? a.sum : a.nds) : ""}
                  className={cn("w-full min-w-24 rounded-md border bg-white px-2 py-1 text-sm text-slate-900 outline-none focus:border-slate-900",
                    isBad ? "border-red-300 placeholder:text-red-400" : edited ? "border-emerald-300" : "border-slate-200")} />
              </Td>
            );
          }
          if (isBad) return <Td key={f.key} right={right} className="bg-red-100/70 font-medium text-red-700">{v || "bo'sh"}</Td>;
          // Fayldan kelmagan summa/NDS — hisoblangani kursiv, bo'zroq
          if (a && v === "" && ((ac?.sumKey === f.key && a.sumCalc) || (ac?.ndsKey === f.key && a.ndsCalc))) {
            return <Td key={f.key} right className="italic text-slate-400"><span title="Faylda yo'q — miqdor × narxdan hisoblandi">{fmtNum(ac?.sumKey === f.key ? a.sum : a.nds)}</span></Td>;
          }
          // Fayldagi summa miqdor × narxga to'g'ri kelmasa — sariq belgi
          if (a?.mismatch && ac?.sumKey === f.key) {
            return <Td key={f.key} right className="bg-amber-100/70 font-medium text-amber-800"><span title={`Miqdor × narx = ${fmtNum(num(x.r[ac.qtyKey]) * num(x.r[ac.priceKey]))}`}>{v}</span></Td>;
          }
          return <Td key={f.key} right={right} className={edited ? "font-medium text-emerald-700" : undefined}>{shown || <span className="text-slate-300">—</span>}</Td>;
        })}
      </Tr>
    );
  };

  const emptyRow = <Tr><Td colSpan={colCount} className="py-6 text-center text-slate-500">Muammoli qator yo&apos;q</Td></Tr>;

  const totalsRow = ac && totals.total > 0 && (
    <tfoot>
      <tr className="bg-slate-50">
        <Td colSpan={colCount} right className="text-slate-600">
          Jami {source.length} ta qator · summa {money(totals.sum)} · NDS {money(totals.nds)} · <span className="font-semibold text-slate-900">jami {money(totals.total)}</span>
        </Td>
      </tr>
    </tfoot>
  );

  /** Takroriy qatorlarni birlashtirish tugmasi (sahifada ham, oynada ham bitta holat). */
  const mergeToggle = merge && rows.length > 0 && (
    <label className={cn("inline-flex cursor-pointer items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition",
      mergeOn ? "border-sky-300 bg-sky-50 text-sky-800" : "border-slate-200 bg-white text-slate-700 hover:border-slate-400 hover:bg-slate-50")}>
      <input type="checkbox" checked={mergeOn} className="h-3.5 w-3.5 rounded border-slate-300"
        onChange={(e) => { setSkipBad(false); setEditing(false); setMergeOn(e.target.checked); }} />
      Bir xil qatorlarni birlashtirish
      {mergeOn && mergedAway > 0 && <span className="font-normal">· {dataRows.length} → {view.length} ta qator</span>}
    </label>
  );

  /** Muammoli qatorlar filtri — sahifada ham, oynada ham bir xil holatni boshqaradi. */
  const badFilterBtn = badList.length > 0 && (
    <button type="button" onClick={() => setOnlyBad((v) => !v)}
      className={cn("inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs font-medium transition",
        onlyBad ? "border-red-300 bg-red-50 text-red-700" : "border-slate-200 bg-white text-slate-700 hover:border-slate-400 hover:bg-slate-50")}>
      {onlyBad ? <><EyeOff size={13} /> Hammasini ko&apos;rsatish</> : <><Eye size={13} /> Bo&apos;sh kataklarni ko&apos;rish ({badList.length} ta qator)</>}
    </button>
  );

  return (
    <form ref={formRef} action={formAction} className="space-y-5">
      <FormError error={state?.error} />
      <input type="hidden" name="rows" value={JSON.stringify(skipBad ? validRows : allRows)} />
      {children}

      <div className="rounded-lg border-2 border-dashed border-slate-300 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
              <span className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-xs font-medium text-white hover:bg-slate-700"><FileSpreadsheet size={14} /> Excel faylni tanlash</span>
              <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
            </label>
            {scan?.enabled && <DocScan endpoint={scan.endpoint} label={scan.label} onResult={onScan} />}
            <span className="text-sm text-slate-500">{fileName || ".xlsx, .xls yoki .csv"}</span>
          </div>
          <button type="button" onClick={downloadTemplate} className="inline-flex items-center gap-1 text-xs text-slate-600 hover:underline"><Download size={13} /> Namuna faylni yuklab olish</button>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          Birinchi qator — ustun sarlavhalari. Ustunlar tartibi muhim emas: quyida har bir maydon qaysi ustundan olinishini tanlaysiz.
          {scan?.enabled && " Nakladnoy qog'ozda bo'lsa — kamera bilan suratga oling, qatorlar o'zi to'ldiriladi."}
        </p>
        {scan && !scan.enabled && <p className="mt-1 text-xs text-slate-400">Kamera bilan o&apos;qish uchun AI kaliti sozlanmagan (.env → ANTHROPIC_API_KEY yoki GROQ_API_KEY).</p>}
        {scanNote && (
          <p className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-sky-50 px-3 py-1.5 text-xs text-sky-800">
            <ScanLine size={13} /> Skanerdan: {scanNote}. Saqlashdan oldin qatorlarni tekshiring.
          </p>
        )}
        {parseErr && <p className="mt-2 text-sm text-red-600">{parseErr}</p>}
      </div>

      {headers.length > 0 && (
        <>
          <div>
            <div className="mb-2 text-sm font-medium text-slate-700">Ustunlarni moslash <span className="font-normal text-slate-500">· {fields.length} ta ustun · {rows.length} ta qator topildi{blankCount > 0 && ` (${blankCount} tasi bo'sh — o'tkazib yuboriladi)`}</span></div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {fields.map((f) => (
                <label key={f.key} className="text-sm">
                  <span className="mb-1 block text-xs text-slate-500">{f.label}{f.required && " *"}</span>
                  <Select value={map[f.key] ?? ""} onChange={(e) => {
                    setSkipBad(false);
                    // ustun almashtirilganda shu maydon bo'yicha qo'lda tahrirlar bekor qilinadi
                    setEdits((prev) => Object.fromEntries(Object.entries(prev).filter(([k]) => !k.endsWith(`:${f.key}`))));
                    setMap((m) => ({ ...m, [f.key]: e.target.value }));
                  }} className={cn(f.required && !map[f.key] && "border-red-300")}>
                    <option value="">— olinmaydi —</option>
                    {headers.map((h) => <option key={h} value={h}>{h}</option>)}
                  </Select>
                  {f.hint && <span className="mt-0.5 block text-[11px] text-slate-400">{f.hint}</span>}
                </label>
              ))}
            </div>
          </div>

          <div>
            <div className="mb-2 flex flex-wrap items-center gap-3 text-sm">
              <span className="font-medium text-slate-700">Oldindan ko&apos;rish</span>
              {ready
                ? <span className="inline-flex items-center gap-1 text-xs text-emerald-700"><CheckCircle2 size={13} /> Hammasi joyida — {allRows.length} ta qator import qilinadi</span>
                : <span className="inline-flex items-center gap-1 text-xs text-amber-700"><AlertTriangle size={13} /> {missingRequired.length ? `Majburiy maydon moslanmagan: ${missingRequired.map((f) => f.label).join(", ")}` : `${badList.length} ta qatorda ${emptyCells} ta katak bo'sh yoki noto'g'ri`}</span>}
              {mismatches > 0 && <span className="inline-flex items-center gap-1 text-xs text-amber-700"><AlertTriangle size={13} /> {mismatches} ta qatorda summa miqdor × narxga to&apos;g&apos;ri kelmadi</span>}
              {editCount > 0 && <span className="text-xs text-emerald-700">{editCount} ta katak qo&apos;lda tahrirlandi</span>}
            </div>
            {merge && (
              <div className="mb-2 flex flex-wrap items-center gap-3">
                {mergeToggle}
                <span className="text-xs text-slate-500">
                  {mergeOn
                    ? `Nomi va boshqa ustunlari bir xil qatorlar bitta bo'ldi — ${merge.sum.length > 1 ? "miqdor va summalar" : "miqdorlar"} qo'shildi. Bironta ustunda farq bo'lsa (masalan narxi), qator alohida qoladi.`
                    : "Har bir fayl qatori alohida yuboriladi."}
                </span>
              </div>
            )}
            <Table>
              <thead>{headRow}</thead>
              <tbody>
                {source.slice(0, PREVIEW).map((x) => renderRow(x, false))}
                {source.length === 0 && emptyRow}
              </tbody>
              {totalsRow}
            </Table>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <button type="button" onClick={() => setModal(true)}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:border-slate-400 hover:bg-slate-50">
                <Maximize2 size={13} /> Batafsil ko&apos;rish va tahrirlash ({source.length} ta qator)
              </button>
              {badFilterBtn}
              {source.length > PREVIEW && <span className="text-xs text-slate-500">… va yana {source.length - PREVIEW} ta qator</span>}
              {ac?.fill && <span className="text-xs text-slate-500">Summa/NDS faylda bo&apos;lmasa miqdor × narxdan hisoblanadi (kursiv bilan).</span>}
            </div>
          </div>
        </>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button disabled={pending || !ready}><Upload size={15} /> {pending ? "Import qilinmoqda…" : `${submitLabel}${allRows.length ? ` (${allRows.length})` : ""}`}</Button>
        {canSkip && (
          <>
            <Button type="button" variant="secondary" disabled={pending} onClick={submitValid}>
              <Upload size={15} /> {pending ? "Import qilinmoqda…" : `Bo'sh kataklarsiz qo'shish (${validRows.length} ta)`}
            </Button>
            <span className="text-xs text-slate-500">{badList.length} ta muammoli qator o&apos;tkazib yuboriladi</span>
          </>
        )}
      </div>

      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-3 backdrop-blur-sm sm:p-6"
          onMouseDown={(e) => { if (e.target === e.currentTarget) setModal(false); }}>
          <div className="flex max-h-full w-full max-w-[96rem] flex-col overflow-hidden rounded-(--radius-card) border border-slate-200 bg-white shadow-2xl">
            <header className="flex flex-wrap items-center gap-3 border-b border-slate-200 px-4 py-3">
              <span className="font-semibold text-slate-900">{fileName || "Import"} <span className="font-normal text-slate-500">· {source.length} ta qator · {fields.length} ta ustun</span></span>
              {merge && mergeOn
                ? <span className="text-xs text-slate-500">Tahrirlash uchun &ldquo;Bir xil qatorlarni birlashtirish&rdquo;ni o&apos;chiring</span>
                : (
                  <button type="button" onClick={() => setEditing((v) => !v)}
                    className={cn("inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs font-medium transition",
                      editing ? "border-emerald-300 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-white text-slate-700 hover:border-slate-400 hover:bg-slate-50")}>
                    {editing ? <><Check size={13} /> Tahrirni tugatish</> : <><PencilLine size={13} /> Tahrirlash</>}
                  </button>
                )}
              {mergeToggle}
              {badFilterBtn}
              {editCount > 0 && <span className="text-xs text-emerald-700">{editCount} ta katak tahrirlandi</span>}
              {badList.length > 0 && <span className="text-xs text-amber-700">{badList.length} ta qatorda {emptyCells} ta katak bo&apos;sh yoki noto&apos;g&apos;ri</span>}
              <button type="button" onClick={() => setModal(false)} aria-label="Yopish"
                className="ml-auto inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-900"><X size={18} /></button>
            </header>

            <div className="min-h-0 flex-1 overflow-auto">
              <table className="w-full text-sm">
                <thead>{headRow}</thead>
                <tbody>
                  {source.map((x) => renderRow(x, editing))}
                  {source.length === 0 && emptyRow}
                </tbody>
              </table>
            </div>

            <footer className="flex flex-wrap items-center gap-3 border-t border-slate-200 px-4 py-3">
              {ac && totals.total > 0 && (
                <span className="text-xs text-slate-500">{source.length} ta qator · summa {money(totals.sum)} · NDS {money(totals.nds)} · jami <span className="font-semibold text-slate-800">{money(totals.total)}</span></span>
              )}
              <div className="ml-auto flex flex-wrap items-center gap-2">
                {canSkip && <Button type="button" variant="secondary" size="sm" disabled={pending} onClick={submitValid}><Upload size={14} /> Bo&apos;sh kataklarsiz qo&apos;shish ({validRows.length} ta)</Button>}
                <Button type="button" variant={ready ? "primary" : "ghost"} size="sm" onClick={() => setModal(false)}>{ready ? "Tayyor" : "Yopish"}</Button>
              </div>
            </footer>
          </div>
        </div>
      )}
    </form>
  );
}
