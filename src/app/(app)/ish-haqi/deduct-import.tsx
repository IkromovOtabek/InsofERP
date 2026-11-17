"use client";

import { useActionState, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, FileSpreadsheet, Upload } from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtNum } from "@/lib/format";
import { DEDUCTION_CATS } from "@/lib/hr/deduction-cats";
import { Badge, Button, Field, FormError, FormSuccess, Input, Select } from "@/components/ui";
import { applyDeductImportAction, previewDeductImportAction, type DeductPreviewState } from "./ushlanma-actions";

/**
 * Ushlanmalar importi: C2026 (G–K ustunlari) → shu oy ushlanmalari, «Карз» → qarz qoldig'i, «Миб» → ijro varaqalari.
 * Varaqlar orasidagi nomuvofiqlik (masalan, C2026 qarz to'lovi ↔ «Карз») ogohlantirish bo'lib ko'rsatiladi.
 */
export function DeductImport({ month, monthLabel, employees }: { month: string; monthLabel: string; employees: { id: string; fullName: string; position: string }[] }) {
  const router = useRouter();
  const [state, action, pending] = useActionState<DeductPreviewState, FormData>(previewDeductImportAction, undefined);
  const preview = state?.preview;
  const [pick, setPick] = useState<Record<string, string>>({});
  const [applying, setApplying] = useState(false);
  const [result, setResult] = useState<{ error?: string; note?: string; skipped?: string[] } | null>(null);
  const people = useMemo(() => preview?.people ?? [], [preview]);
  const chosen = (key: string, auto?: string) => (key in pick ? pick[key]! : auto ?? "");
  const ready = people.filter((p) => chosen(p.key, p.match?.employeeId));
  const empName = useMemo(() => new Map(employees.map((e) => [e.id, e.fullName])), [employees]);

  async function apply() {
    if (!preview) return;
    setApplying(true);
    setResult(null);
    const payload = ready.map((p) => ({ key: p.key, employeeId: chosen(p.key, p.match?.employeeId), remember: p.key in pick || p.match?.how === "o'xshash", values: p.values as Record<string, number>, loan: p.loan, cases: p.cases }));
    let r: { error?: string; saved?: number; debts?: number; cases?: number; skipped?: string[] };
    try { r = await applyDeductImportAction(preview.month, payload); } catch { r = { error: "Saqlanmadi — internet yoki sessiyani tekshiring" }; }
    setApplying(false);
    if (r.error) { setResult({ error: r.error }); return; }
    setResult({ note: `${fmtNum(r.saved ?? 0)} ushlanma, ${r.debts ?? 0} qarz qoldig'i, ${r.cases ?? 0} ijro varaqasi yozildi`, skipped: r.skipped });
    router.refresh();
  }

  return (
    <div className="space-y-3">
      <form action={action} className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="month" value={month} />
        <Field label={`Excel fayli (.xlsx) — ${monthLabel} ushlanmalari`} className="min-w-72 flex-1" hint="C2026 (Алимент, Ойма-ой карз, Ойлик хисобидан карз, Туй пули, Штраф), «Карз» va «Миб карздорлик» varaqlari o'qiladi">
          <Input name="file" type="file" accept=".xlsx" required className="pt-1.5" onChange={() => { setPick({}); setResult(null); }} />
        </Field>
        <Button variant="secondary" disabled={pending}><FileSpreadsheet size={15} /> {pending ? "O'qilmoqda…" : "Ko'rib chiqish"}</Button>
      </form>
      <FormError error={state?.error} />
      {preview && (
        <div className="space-y-3">
          {preview.warnings.map((w) => <p key={w} className="text-sm text-amber-700">{w}</p>)}
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-600">
            <span className="font-medium">{state?.fileName}:</span>
            {preview.sources.map((s) => <Badge key={s} color="slate">{s}</Badge>)}
            <span className="ml-2">Jami: {DEDUCTION_CATS.filter((c) => preview.totals[c.key]).map((c) => `${c.label} ${fmtNum(preview.totals[c.key]!)}`).join(" · ")}</span>
          </div>
          <div className="max-h-[55vh] overflow-auto rounded-lg border border-slate-200">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-slate-50 text-xs text-slate-500">
                <tr><th className="px-3 py-2 text-left">Excel&apos;dagi ism</th><th className="px-3 py-2 text-left">Shu oy ushlanmalari</th><th className="px-3 py-2 text-left">Qarz / ijro daftari</th><th className="px-3 py-2 text-left">ERP xodimi</th></tr>
              </thead>
              <tbody>
                {people.map((p) => {
                  const val = chosen(p.key, p.match?.employeeId);
                  const opts = [...new Set([...p.candidates.map((c) => c.id), ...(p.match ? [p.match.employeeId] : [])])];
                  return (
                    <tr key={p.key} className={cn("border-t border-slate-100 align-top", !val && "bg-amber-50/50")}>
                      <td className="px-3 py-1.5 font-medium text-slate-900">
                        {p.name}
                        {p.warnings.map((w) => <div key={w} className="mt-0.5 flex items-start gap-1 text-xs font-normal text-amber-700"><AlertTriangle size={12} className="mt-0.5 shrink-0" /> {w}</div>)}
                      </td>
                      <td className="px-3 py-1.5 text-xs text-slate-700">{DEDUCTION_CATS.filter((c) => p.values[c.key]).map((c) => `${c.label} ${fmtNum(p.values[c.key]!)}`).join(" · ") || "—"}</td>
                      <td className="px-3 py-1.5 text-xs text-slate-700">
                        {p.loan && <div>Qarz qoldig&apos;i {fmtNum(p.loan.balance)}{p.loan.monthly ? `, oyiga ${fmtNum(p.loan.monthly)}` : ""}</div>}
                        {p.cases.map((c, i) => <div key={i}>Ijro{c.caseNo ? ` №${c.caseNo}` : ""}: {fmtNum(c.debt)}{c.percent ? ` (${c.percent}%)` : ""}{c.held ? `, shu oy ${fmtNum(c.held)}` : ""}</div>)}
                        {!p.loan && !p.cases.length && "—"}
                      </td>
                      <td className="px-3 py-1.5">
                        <div className="flex items-center gap-2">
                          <Select value={val} onChange={(e) => setPick((x) => ({ ...x, [p.key]: e.target.value }))} className="h-8 min-w-56 text-sm" aria-label={`${p.name} — ERP xodimi`}>
                            <option value="">— o&apos;tkazib yuborish —</option>
                            {opts.length > 0 && <optgroup label="O'xshashlar">{opts.map((id) => <option key={id} value={id}>{empName.get(id) ?? id}</option>)}</optgroup>}
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
            <Button type="button" onClick={() => void apply()} disabled={applying || !ready.length}><Upload size={15} /> {applying ? "Yozilmoqda…" : `Yozish (${ready.length} / ${people.length})`}</Button>
            <span className="text-xs text-slate-500">Shu oy ushlanmalari jadvalga, qarz qoldig&apos;i va ijro varaqalari daftarga (takror yozilmaydi).</span>
          </div>
          {result?.error && <FormError error={result.error} />}
          {result?.note && <FormSuccess text={result.note} />}
          {result?.skipped?.length ? <p className="text-xs text-amber-700">O&apos;tkazildi: {result.skipped.join("; ")}</p> : null}
        </div>
      )}
    </div>
  );
}
