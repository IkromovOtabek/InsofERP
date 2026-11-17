"use client";

import { useActionState, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, FileSpreadsheet, Upload } from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtNum } from "@/lib/format";
import { Badge, Button, Field, FormError, FormSuccess, Input, Select } from "@/components/ui";
import { applyTabelImportAction, previewTabelImportAction, type PreviewState } from "./tabel-actions";

/**
 * Excel'dan tabel importi: 1) fayl → oddiy tabel varaqlari (Ауп, Поврименшики, Сваршики) va brigada varaqlari
 * (Илхом, Столба, БРУ… — soat, kunlik soni, narx, brak) hamda ismlarning xodimlarga mosligi;
 * 2) topilmaganlari tanlanadi (tanlov eslab qolinadi) → oddiy soat davomatga, brigada varaqlari brigada varag'iga yoziladi.
 * Brigada uchun ERP hisobi Excel'dagi «сумма» bilan solishtirib ko'rsatiladi.
 */
export function TabelImport({ month, monthLabel, employees }: { month: string; monthLabel: string; employees: { id: string; fullName: string; position: string }[] }) {
  const router = useRouter();
  const [state, action, pending] = useActionState<PreviewState, FormData>(previewTabelImportAction, undefined);
  const preview = state?.preview;
  const [pick, setPick] = useState<Record<string, string>>({});
  const [bpick, setBpick] = useState<Record<string, string>>({});
  const [applying, setApplying] = useState(false);
  const [result, setResult] = useState<{ error?: string; note?: string; skipped?: string[] } | null>(null);

  const chosen = (key: string, auto?: string) => (key in pick ? pick[key]! : auto ?? "");
  const bchosen = (sheet: string, auto?: string) => (sheet in bpick ? bpick[sheet]! : auto ?? "");
  const people = useMemo(() => preview?.people ?? [], [preview]);
  const brigades = useMemo(() => preview?.brigades ?? [], [preview]);
  const ready = people.filter((p) => chosen(p.key, p.match?.employeeId));
  const bready = brigades.filter((b) => bchosen(b.sheet, b.match?.brigadeId));
  const empName = useMemo(() => new Map(employees.map((e) => [e.id, e.fullName])), [employees]);

  async function apply() {
    if (!preview) return;
    setApplying(true);
    setResult(null);
    const payload = ready.map((p) => ({ key: p.key, employeeId: chosen(p.key, p.match?.employeeId), hours: p.hours, bsheets: p.bsheets, remember: p.key in pick || p.match?.how === "o'xshash" }));
    const bpayload = bready.map((b) => {
      const v = bchosen(b.sheet, b.match?.brigadeId);
      return { sheet: b.sheet, brigadeId: v, newName: v === "new" ? b.sheet : undefined, remember: b.sheet in bpick, lines: b.lines, brak: b.brak };
    });
    let r: { error?: string; saved?: number; skipped?: string[] };
    try { r = await applyTabelImportAction(preview.month, payload, bpayload); } catch { r = { error: "Saqlanmadi — internet yoki sessiyani tekshiring" }; }
    setApplying(false);
    if (r.error) { setResult({ error: r.error }); return; }
    setResult({ note: `${ready.length} xodim, ${bready.length} brigada varag'i — ${fmtNum(r.saved ?? 0)} katak yozildi`, skipped: r.skipped });
    router.refresh();
  }

  return (
    <div className="space-y-3">
      <form action={action} className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="month" value={month} />
        <Field label={`Excel fayli (.xlsx) — ${monthLabel} tabeliga`} className="min-w-72 flex-1" hint="«Ф.И.О.» va 1..31 kun ustunlari bor barcha varaqlar: oddiy tabel (Ауп, Поврименшики…) va brigada varaqlari (soni va narx bloki bilan)">
          <Input name="file" type="file" accept=".xlsx" required className="pt-1.5" onChange={() => { setPick({}); setBpick({}); setResult(null); }} />
        </Field>
        <Button variant="secondary" disabled={pending}><FileSpreadsheet size={15} /> {pending ? "O'qilmoqda…" : "Ko'rib chiqish"}</Button>
      </form>
      <FormError error={state?.error} />
      {preview && (
        <div className="space-y-4">
          {preview.warnings.map((w) => <p key={w} className="text-sm text-amber-700">{w}</p>)}
          <div className="flex flex-wrap gap-1.5 text-xs text-slate-600">
            <span className="font-medium">{state?.fileName}:</span>
            {preview.sheets.map((s) => <Badge key={s.name} color={s.kind === "brigade" ? "blue" : "slate"}>{s.name} · {s.people}</Badge>)}
          </div>

          {brigades.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-sm font-semibold text-slate-900">Brigada varaqlari → brigada varag&apos;i (soat, kunlik soni, narx, brak)</h4>
              <div className="overflow-auto rounded-lg border border-slate-200">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-xs text-slate-500">
                    <tr><th className="px-3 py-2 text-left">Varaq</th><th className="px-3 py-2 text-left">Mahsulot qatorlari</th><th className="px-3 py-2 text-right">Fond</th><th className="px-3 py-2 text-right">Brak</th><th className="px-3 py-2 text-left">Excel bilan</th><th className="px-3 py-2 text-left">ERP brigadasi</th></tr>
                  </thead>
                  <tbody>
                    {brigades.map((b) => {
                      const v = bchosen(b.sheet, b.match?.brigadeId);
                      return (
                        <tr key={b.sheet} className={cn("border-t border-slate-100", !v && "bg-amber-50/50")}>
                          <td className="px-3 py-1.5"><div className="font-medium text-slate-900">{b.sheet}</div><div className="text-xs text-slate-500">{b.title ? `${b.title} · ` : ""}{b.people} kishi</div></td>
                          <td className="px-3 py-1.5 text-xs text-slate-600">{b.lines.map((l) => `${l.name} — ${fmtNum(Math.round(l.rate))}`).join("; ")}</td>
                          <td className="px-3 py-1.5 text-right tabular">{fmtNum(b.pool)}</td>
                          <td className="px-3 py-1.5 text-right tabular">{b.brak ? fmtNum(b.brak) : "—"}</td>
                          <td className="px-3 py-1.5 text-xs">
                            {b.check.diff.length === 0
                              ? <span className="inline-flex items-center gap-1 text-emerald-700"><CheckCircle2 size={13} /> {b.check.ok} kishi — mos</span>
                              : <span className="text-amber-700" title={b.check.diff.map((d) => `${d.name}: ERP ${fmtNum(d.erp)} / Excel ${fmtNum(d.excel)}`).join("\n")}><AlertTriangle size={13} className="mr-0.5 inline" />{b.check.ok} mos, {b.check.diff.length} farq: {b.check.diff.slice(0, 2).map((d) => `${d.name} ${d.excel - d.erp > 0 ? "+" : ""}${fmtNum(d.excel - d.erp)}`).join("; ")} (Excel formulasiga qo&apos;lda qo&apos;shilgan — bonus bo&apos;lsa alohida kiriting)</span>}
                          </td>
                          <td className="px-3 py-1.5">
                            <div className="flex items-center gap-2">
                              <Select value={v} onChange={(e) => setBpick((x) => ({ ...x, [b.sheet]: e.target.value }))} className="h-8 min-w-52 text-sm" aria-label={`${b.sheet} — ERP brigadasi`}>
                                <option value="">— o&apos;tkazib yuborish —</option>
                                <option value="new">+ Yangi brigada: «{b.sheet}»</option>
                                {preview.allBrigades.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                              </Select>
                              {b.match && !(b.sheet in bpick) && <Badge color={b.match.how === "alias" ? "green" : "amber"}>{b.match.how === "alias" ? "eslab qolingan" : b.match.how}</Badge>}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="space-y-2">
            <h4 className="text-sm font-semibold text-slate-900">Xodimlar</h4>
            <div className="max-h-[50vh] overflow-auto rounded-lg border border-slate-200">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10 bg-slate-50 text-xs text-slate-500">
                  <tr><th className="px-3 py-2 text-left">Excel&apos;dagi ism</th><th className="px-3 py-2 text-left">Varaq</th><th className="px-3 py-2 text-right">Soat</th><th className="px-3 py-2 text-left">ERP xodimi</th></tr>
                </thead>
                <tbody>
                  {people.map((p) => {
                    const val = chosen(p.key, p.match?.employeeId);
                    const opts = [...new Set([...p.candidates.map((c) => c.id), ...(p.match ? [p.match.employeeId] : [])])];
                    return (
                      <tr key={p.key} className={cn("border-t border-slate-100", !val && "bg-amber-50/50")}>
                        <td className="px-3 py-1.5 font-medium text-slate-900">{p.name}{p.maxDay > 12 && <span className="ml-1.5 inline-flex items-center gap-0.5 text-xs font-normal text-amber-700" title="Bir nechta varaqdan qo'shilganda bir kunga 12 soatdan ko'p chiqdi — tekshiring"><AlertTriangle size={12} /> kuniga {fmtNum(p.maxDay)} soat</span>}</td>
                        <td className="px-3 py-1.5 text-xs text-slate-500">{p.sheets.join(", ")}</td>
                        <td className="px-3 py-1.5 text-right tabular">{fmtNum(p.total, 2)}</td>
                        <td className="px-3 py-1.5">
                          <div className="flex items-center gap-2">
                            <Select value={val} onChange={(e) => setPick((x) => ({ ...x, [p.key]: e.target.value }))} className="h-8 min-w-60 text-sm" aria-label={`${p.name} — ERP xodimi`}>
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
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" onClick={() => void apply()} disabled={applying || (!ready.length && !bready.length)}><Upload size={15} /> {applying ? "Yozilmoqda…" : `Tabelga yozish (${ready.length}/${people.length} xodim, ${bready.length}/${brigades.length} brigada)`}</Button>
            <span className="text-xs text-slate-500">Faqat qiymat yozilgan kunlar yoziladi; Excel&apos;da bo&apos;sh kun tabelda o&apos;zgarmaydi. Qo&apos;lda tanlangan moslik keyingi safar eslab qolinadi.</span>
          </div>
          {result?.error && <FormError error={result.error} />}
          {result?.note && <FormSuccess text={result.note} />}
          {result?.skipped?.length ? <p className="text-xs text-amber-700">Yozilmadi: {result.skipped.slice(0, 5).join("; ")}{result.skipped.length > 5 ? ` va yana ${result.skipped.length - 5}` : ""}</p> : null}
        </div>
      )}
    </div>
  );
}
