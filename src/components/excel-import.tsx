"use client";

import { useActionState, useMemo, useState } from "react";
import { FileSpreadsheet, Download, Upload, AlertTriangle, CheckCircle2 } from "lucide-react";
import { Button, FormError, Select, Table, Td, Th, Tr } from "@/components/ui";
import { guessColumn, num, str, type ImportField } from "@/lib/excel";
import type { ActionState } from "@/lib/action";
import { cn } from "@/lib/utils";

type Row = Record<string, unknown>;

/**
 * Umumiy Excel import: fayl → brauzerda o'qiladi (SheetJS) → ustunlar maydonlarga moslanadi → oldindan ko'rish → server action.
 * Server action `rows` (JSON, maydon kalitlari bo'yicha) va `children` ichidagi qo'shimcha maydonlarni oladi.
 * Ko'p qator bir vaqtda yuboriladi — bitta hujjat / bitta import.
 */
export function ExcelImport({ fields, action, children, submitLabel = "Import qilish", templateName = "namuna", example }: {
  fields: ImportField[];
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  children?: React.ReactNode;
  submitLabel?: string;
  templateName?: string;
  example?: Record<string, string | number>;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const [fileName, setFileName] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [map, setMap] = useState<Record<string, string>>({});
  const [parseErr, setParseErr] = useState("");

  const onFile = async (f: File | undefined) => {
    setParseErr(""); setRows([]); setHeaders([]); setMap({});
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
      const data = aoa.slice(hi + 1).filter((r) => r.some((c) => str(c) !== "")).map((r) => Object.fromEntries(hdr.map((h, i) => [h, r[i] ?? ""])));
      setHeaders(hdr); setRows(data);
      const taken = new Set<string>(); const m: Record<string, string> = {};
      for (const fl of fields) { const g = guessColumn(hdr, fl.synonyms, taken); if (g) { m[fl.key] = g; taken.add(g); } }
      setMap(m);
    } catch (e) { setParseErr(`Faylni o'qib bo'lmadi: ${e instanceof Error ? e.message : String(e)}`); }
  };

  const downloadTemplate = async () => {
    const XLSX = await import("xlsx");
    const ws = XLSX.utils.json_to_sheet([Object.fromEntries(fields.map((f) => [f.label, example?.[f.key] ?? ""]))]);
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "Import");
    XLSX.writeFile(wb, `${templateName}.xlsx`);
  };

  // Moslangan qatorlar — server shu JSON ni oladi
  const mapped = useMemo(() => rows.map((r) => Object.fromEntries(fields.map((f) => [f.key, map[f.key] ? r[map[f.key]] : ""]))), [rows, map, fields]);
  const missingRequired = fields.filter((f) => f.required && !map[f.key]);
  const badRows = useMemo(() => mapped.filter((r) => fields.some((f) => f.required && str(r[f.key]) === "")).length, [mapped, fields]);
  const numericKeys = fields.filter((f) => /qty|price|amount/.test(f.key)).map((f) => f.key);
  const badNums = useMemo(() => mapped.filter((r) => numericKeys.some((k) => str(r[k]) !== "" && Number.isNaN(num(r[k])))).length, [mapped, numericKeys]);
  const ready = rows.length > 0 && missingRequired.length === 0 && badRows === 0 && badNums === 0;

  return (
    <form action={formAction} className="space-y-5">
      <FormError error={state?.error} />
      <input type="hidden" name="rows" value={JSON.stringify(mapped)} />
      {children}

      <div className="rounded-lg border-2 border-dashed border-slate-300 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
            <span className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-xs font-medium text-white hover:bg-slate-700"><FileSpreadsheet size={14} /> Excel faylni tanlash</span>
            <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
            <span className="text-slate-500">{fileName || ".xlsx, .xls yoki .csv"}</span>
          </label>
          <button type="button" onClick={downloadTemplate} className="inline-flex items-center gap-1 text-xs text-slate-600 hover:underline"><Download size={13} /> Namuna faylni yuklab olish</button>
        </div>
        <p className="mt-2 text-xs text-slate-500">Birinchi qator — ustun sarlavhalari. Ustunlar tartibi muhim emas: quyida har bir maydon qaysi ustundan olinishini tanlaysiz.</p>
        {parseErr && <p className="mt-2 text-sm text-red-600">{parseErr}</p>}
      </div>

      {headers.length > 0 && (
        <>
          <div>
            <div className="mb-2 text-sm font-medium text-slate-700">Ustunlarni moslash <span className="font-normal text-slate-500">· {rows.length} ta qator topildi</span></div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {fields.map((f) => (
                <label key={f.key} className="text-sm">
                  <span className="mb-1 block text-xs text-slate-500">{f.label}{f.required && " *"}</span>
                  <Select value={map[f.key] ?? ""} onChange={(e) => setMap((m) => ({ ...m, [f.key]: e.target.value }))} className={cn(f.required && !map[f.key] && "border-red-300")}>
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
                ? <span className="inline-flex items-center gap-1 text-xs text-emerald-700"><CheckCircle2 size={13} /> Hammasi joyida — {rows.length} ta qator import qilinadi</span>
                : <span className="inline-flex items-center gap-1 text-xs text-amber-700"><AlertTriangle size={13} /> {missingRequired.length ? `Majburiy maydon moslanmagan: ${missingRequired.map((f) => f.label).join(", ")}` : badRows ? `${badRows} ta qatorda majburiy qiymat bo'sh` : `${badNums} ta qatorda raqam noto'g'ri`}</span>}
            </div>
            <Table>
              <thead><tr><Th>#</Th>{fields.map((f) => <Th key={f.key}>{f.label}</Th>)}</tr></thead>
              <tbody>
                {mapped.slice(0, 15).map((r, i) => {
                  const bad = fields.some((f) => f.required && str(r[f.key]) === "") || numericKeys.some((k) => str(r[k]) !== "" && Number.isNaN(num(r[k])));
                  return <Tr key={i} className={bad ? "bg-red-50/60" : undefined}><Td className="text-slate-400">{i + 1}</Td>{fields.map((f) => <Td key={f.key}>{str(r[f.key]) || <span className="text-slate-300">—</span>}</Td>)}</Tr>;
                })}
              </tbody>
            </Table>
            {rows.length > 15 && <p className="mt-1 text-xs text-slate-500">… va yana {rows.length - 15} ta qator</p>}
          </div>
        </>
      )}

      <Button disabled={pending || !ready}><Upload size={15} /> {pending ? "Import qilinmoqda…" : `${submitLabel}${rows.length ? ` (${rows.length})` : ""}`}</Button>
    </form>
  );
}
