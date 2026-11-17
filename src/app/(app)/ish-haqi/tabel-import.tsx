"use client";

import { useActionState, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, FileSpreadsheet, Upload } from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtNum } from "@/lib/format";
import { Badge, Button, Field, FormError, FormSuccess, Input, Select } from "@/components/ui";
import { applyTabelImportAction, previewTabelImportAction, type PreviewState } from "./tabel-actions";

/**
 * Excel'dan tabel importi: 1) fayl → tabel varaqlari (Ауп, brigadalar, Поврименшики…) va ismlarning xodimlarga mosligi;
 * 2) topilmagan ismlarga xodim tanlanadi (tanlov eslab qolinadi) → soatlar tabelga yoziladi. Bo'sh katak tabelga tegmaydi.
 */
export function TabelImport({ month, monthLabel, employees }: { month: string; monthLabel: string; employees: { id: string; fullName: string; position: string }[] }) {
  const router = useRouter();
  const [state, action, pending] = useActionState<PreviewState, FormData>(previewTabelImportAction, undefined);
  const preview = state?.preview;
  const [pick, setPick] = useState<Record<string, string>>({});
  const [applying, setApplying] = useState(false);
  const [result, setResult] = useState<{ error?: string; note?: string; skipped?: string[] } | null>(null);

  const chosen = (key: string, auto?: string) => (key in pick ? pick[key]! : auto ?? "");
  const people = useMemo(() => preview?.people ?? [], [preview]);
  const ready = people.filter((p) => chosen(p.key, p.match?.employeeId));
  const empName = useMemo(() => new Map(employees.map((e) => [e.id, e.fullName])), [employees]);

  async function apply() {
    if (!preview) return;
    setApplying(true);
    setResult(null);
    const payload = ready.map((p) => ({ key: p.key, employeeId: chosen(p.key, p.match?.employeeId), hours: p.hours, remember: p.key in pick || p.match?.how === "o'xshash" }));
    let r: { error?: string; saved?: number; skipped?: string[] };
    try { r = await applyTabelImportAction(preview.month, payload); } catch { r = { error: "Saqlanmadi — internet yoki sessiyani tekshiring" }; }
    setApplying(false);
    if (r.error) { setResult({ error: r.error }); return; }
    setResult({ note: `${ready.length} xodim, ${fmtNum(r.saved ?? 0)} katak tabelga yozildi`, skipped: r.skipped });
    router.refresh();
  }

  return (
    <div className="space-y-3">
      <form action={action} className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="month" value={month} />
        <Field label={`Excel fayli (.xlsx) — ${monthLabel} tabeliga`} className="min-w-72 flex-1" hint="«Ф.И.О.» va 1..31 kun ustunlari bor barcha varaqlar o'qiladi (Ауп, brigadalar, Поврименшики, Сваршики, БРУ…)">
          <Input name="file" type="file" accept=".xlsx" required className="pt-1.5" onChange={() => { setPick({}); setResult(null); }} />
        </Field>
        <Button variant="secondary" disabled={pending}><FileSpreadsheet size={15} /> {pending ? "O'qilmoqda…" : "Ko'rib chiqish"}</Button>
      </form>
      <FormError error={state?.error} />
      {preview && (
        <div className="space-y-3">
          {preview.warnings.map((w) => <p key={w} className="text-sm text-amber-700">{w}</p>)}
          <div className="flex flex-wrap gap-1.5 text-xs text-slate-600">
            <span className="font-medium">{state?.fileName}:</span>
            {preview.sheets.map((s) => <Badge key={s.name} color="slate">{s.name} · {s.people}</Badge>)}
          </div>
          <div className="max-h-[50vh] overflow-auto rounded-lg border border-slate-200">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-slate-50 text-xs text-slate-500">
                <tr><th className="px-3 py-2 text-left">Excel&apos;dagi ism</th><th className="px-3 py-2 text-left">Varaq</th><th className="px-3 py-2 text-right">Soat</th><th className="px-3 py-2 text-left">ERP xodimi</th></tr>
              </thead>
              <tbody>
                {people.map((p) => {
                  const val = chosen(p.key, p.match?.employeeId);
                  const opts = [...p.candidates.map((c) => c.id), ...(p.match ? [p.match.employeeId] : [])];
                  return (
                    <tr key={p.key} className={cn("border-t border-slate-100", !val && "bg-amber-50/50")}>
                      <td className="px-3 py-1.5 font-medium text-slate-900">{p.name}{p.maxDay > 12 && <span className="ml-1.5 inline-flex items-center gap-0.5 text-xs font-normal text-amber-700" title="Bir nechta varaqdan qo'shilganda bir kunga 12 soatdan ko'p chiqdi — tekshiring"><AlertTriangle size={12} /> kuniga {fmtNum(p.maxDay)} soat</span>}</td>
                      <td className="px-3 py-1.5 text-xs text-slate-500">{p.sheets.join(", ")}</td>
                      <td className="px-3 py-1.5 text-right tabular">{fmtNum(p.total, 2)}</td>
                      <td className="px-3 py-1.5">
                        <div className="flex items-center gap-2">
                          <Select value={val} onChange={(e) => setPick((x) => ({ ...x, [p.key]: e.target.value }))} className="h-8 min-w-60 text-sm" aria-label={`${p.name} — ERP xodimi`}>
                            <option value="">— o&apos;tkazib yuborish —</option>
                            {[...new Set(opts)].length > 0 && <optgroup label="O'xshashlar">{[...new Set(opts)].map((id) => <option key={id} value={id}>{empName.get(id) ?? id}</option>)}</optgroup>}
                            <optgroup label="Barcha xodimlar">{employees.map((e) => <option key={e.id} value={e.id}>{e.fullName} · {e.position}</option>)}</optgroup>
                          </Select>
                          {p.match && !(p.key in pick) && <Badge color={p.match.how === "o'xshash" ? "amber" : "green"}>{p.match.how === "alias" ? "eslab qolingan" : p.match.how}</Badge>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" onClick={() => void apply()} disabled={applying || !ready.length}><Upload size={15} /> {applying ? "Yozilmoqda…" : `Tabelga yozish (${ready.length} / ${people.length})`}</Button>
            <span className="text-xs text-slate-500">Faqat soat yozilgan kunlar yoziladi; Excel&apos;da bo&apos;sh kun tabelda o&apos;zgarmaydi. Qo&apos;lda tanlangan moslik keyingi safar eslab qolinadi.</span>
          </div>
          {result?.error && <FormError error={result.error} />}
          {result?.note && <FormSuccess text={result.note} />}
          {result?.skipped?.length ? <p className="text-xs text-amber-700">Yozilmadi: {result.skipped.slice(0, 5).join("; ")}{result.skipped.length > 5 ? ` va yana ${result.skipped.length - 5}` : ""}</p> : null}
        </div>
      )}
    </div>
  );
}
