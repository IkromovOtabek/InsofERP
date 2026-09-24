"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Grid3x3, Plus, X } from "lucide-react";
import { createProductMatrix } from "@/lib/catalog-actions";
import { PRODUCT_UNITS } from "@/lib/unit";
import { PRODUCT_KINDS } from "@/lib/catalog";
import { MoneyInput } from "@/components/money-input";
import { Button, Checkbox, Field, FormError, Input, inputCls, Select, Textarea } from "@/components/ui";
import { fmtNum } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Har satrda bitta qiymat; bo'sh satrlar tashlanadi. Vergul bilan yozilsa ham ajratiladi. */
const lines = (s: string) =>
  s.split(/[\n;]+/).flatMap((x) => (x.includes(",") ? x.split(",") : [x])).map((x) => x.trim()).filter(Boolean);

const digits = (v: string) => v.replace(/\D/g, "").replace(/^0+(?=\d)/, "");

/** Shablon bo'yicha mahsulot nomi: {qator} va {ustun} o'rniga qator/ustun nomi qo'yiladi. */
const buildName = (tpl: string, row: string, col: string) =>
  tpl.replaceAll("{qator}", row).replaceAll("{ustun}", col).replace(/\s+/g, " ").trim();

const PLACEHOLDER_ROWS = "M200\nM250\nM300";
const PLACEHOLDER_COLS = "1,5 m\n2 m\n3 m";
const SEP = "\u0001"; // qator/ustun kalitini ajratish uchun (nomlarda uchramaydi)
const MAX = 500; // serverdagi cheklov bilan bir xil: bir urinishda shuncha mahsulot

/**
 * Matritsa ko'rinishida mahsulot qo'shish — 1C dagi "xarakteristikalar matritsasi" kabi.
 * Qatorlar (masalan markalar) × ustunlar (masalan o'lchovlar): har kesishma bitta mahsulot.
 * Katakni belgilab yoki bekor qilib kerakli kombinatsiyalar tanlanadi, katakka o'z narxi yozilishi mumkin.
 * Hammasi ochiq turgan papkaga tushadi; "har qator uchun papka" belgilansa qator nomi bilan papka ochiladi.
 */
export function ProductMatrixAdd({ groupId, groupName, onDone, onCancel }: {
  groupId?: string | null;
  groupName?: string | null;
  onDone?: () => void;
  onCancel?: () => void;
}) {
  const router = useRouter();
  const [state, action, pending] = useActionState(createProductMatrix, undefined);
  const [rowsText, setRowsText] = useState("");
  const [colsText, setColsText] = useState("");
  const [tpl, setTpl] = useState("{qator} {ustun}");
  const [unit, setUnit] = useState("dona");
  const [kind, setKind] = useState<string>(PRODUCT_KINDS[1]);
  const [price, setPrice] = useState("");
  const [perRow, setPerRow] = useState(false);
  const [off, setOff] = useState<Set<string>>(new Set()); // belgisi olib tashlangan kataklar
  const [cellPrice, setCellPrice] = useState<Record<string, string>>({});

  /** Matritsa ustuni/qatori ro'yxatdan olib tashlanadi (matn maydonidagi shu satr o'chadi). */
  const dropValue = (text: string, value: string) => lines(text).filter((x) => x !== value).join("\n");
  /** Yangi ustun/qator: nomi keyin matn maydonida tahrirlanadi. */
  const addValue = (text: string, prefix: string) => {
    const list = lines(text);
    let n = list.length + 1;
    while (list.includes(`${prefix} ${n}`)) n++;
    return [...list, `${prefix} ${n}`].join("\n");
  };

  const rows = useMemo(() => lines(rowsText), [rowsText]);
  const cols = useMemo(() => lines(colsText), [colsText]);
  // Ustun berilmasa — bitta bo'sh ustun: shunda oddiy nomlar ro'yxati bo'lib qo'shiladi
  const colList = useMemo(() => (cols.length ? cols : [""]), [cols]);

  const key = (r: string, c: string) => `${r}${SEP}${c}`;
  const isOn = (r: string, c: string) => !off.has(key(r, c));
  const toggle = (r: string, c: string) => setOff((s) => {
    const n = new Set(s);
    const k = key(r, c);
    if (n.has(k)) n.delete(k); else n.add(k);
    return n;
  });
  /** Butun qator yoki ustunni birdan belgilash/bekor qilish. */
  const toggleMany = (pairs: [string, string][]) => setOff((s) => {
    const n = new Set(s);
    const allOn = pairs.every(([r, c]) => !n.has(key(r, c)));
    for (const [r, c] of pairs) { if (allOn) n.add(key(r, c)); else n.delete(key(r, c)); }
    return n;
  });

  const cells = useMemo(() => {
    const out: { name: string; row: string; price?: number }[] = [];
    const seen = new Set<string>();
    for (const r of rows) for (const c of colList) {
      if (off.has(`${r}${SEP}${c}`)) continue;
      const name = buildName(tpl, r, c);
      if (!name || seen.has(name.toLowerCase())) continue; // bir xil nom ikki marta yozilmaydi
      seen.add(name.toLowerCase());
      const p = digits(cellPrice[`${r}${SEP}${c}`] ?? "");
      out.push({ name, row: r, ...(p ? { price: Number(p) } : {}) });
    }
    return out;
  }, [rows, colList, off, tpl, cellPrice]);

  useEffect(() => { if (state?.ok) { router.refresh(); onDone?.(); } }, [state, router, onDone]);

  const basePrice = digits(price);

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="groupId" value={groupId ?? ""} />
      <input type="hidden" name="cells" value={JSON.stringify(cells)} />
      <input type="hidden" name="unit" value={unit} />
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="folderPerRow" value={perRow ? "1" : ""} />

      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <p className="text-slate-600">
          <span className="inline-flex items-center gap-1.5 font-medium text-slate-900"><Grid3x3 size={15} /> Matritsa</span>
          {" · joylashuvi: "}<b className="text-slate-900">{groupName ?? "Ro'yxat ildizi"}</b>
          {" · qator × ustun kesishmasidagi har belgilangan katak bitta mahsulot bo'ladi."}
        </p>
        {onCancel && <Button size="sm" variant="ghost" type="button" onClick={onCancel}><X size={15} /> Yopish</Button>}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Qatorlar" hint="har satrda bittasi — masalan marka; jadvaldagi «×» bilan ham o'chiriladi">
          <Textarea rows={4} value={rowsText} onChange={(e) => setRowsText(e.target.value)} placeholder={PLACEHOLDER_ROWS} />
        </Field>
        <Field label="Ustunlar" hint="har satrda bittasi — masalan o'lchov; bo'sh qoldirsangiz faqat qatorlar qo'shiladi. Jadvaldagi «+ Ustun» va «×» bilan ham boshqariladi">
          <Textarea rows={4} value={colsText} onChange={(e) => setColsText(e.target.value)} placeholder={PLACEHOLDER_COLS} />
        </Field>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <Field label="Nom shabloni" hint="{qator} va {ustun} o'rniga nomlar qo'yiladi" className="sm:col-span-2">
          <Input value={tpl} onChange={(e) => setTpl(e.target.value)} placeholder="{qator} {ustun}" />
        </Field>
        <Field label="Tovar turi">
          <Select value={kind} onChange={(e) => setKind(e.target.value)}>
            {PRODUCT_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
          </Select>
        </Field>
        <Field label="O'lchov birligi *">
          <Select value={unit} onChange={(e) => setUnit(e.target.value)}>
            {PRODUCT_UNITS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </Select>
        </Field>
        <Field label="Umumiy narx" hint="katakda narx yozilmagan mahsulotlarga shu narx tushadi" className="sm:col-span-2">
          <MoneyInput name="price" value={price} onChange={setPrice} placeholder="0" />
        </Field>
        <div className="flex items-end pb-2 sm:col-span-2">
          <Checkbox label="Har qator uchun alohida papka" checked={perRow} onChange={(e) => setPerRow(e.target.checked)} />
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white/60 px-3 py-6 text-center text-sm text-slate-500">
          Qatorlarni kiriting — matritsa shu yerda chiziladi.
          <div className="mt-2 flex justify-center gap-2">
            <Button type="button" size="sm" variant="secondary" onClick={() => setRowsText((t) => addValue(t, "Qator"))}><Plus size={14} /> Qator qo&apos;shish</Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setColsText((t) => addValue(t, "Ustun"))}><Plus size={14} /> Ustun qo&apos;shish</Button>
          </div>
        </div>
      ) : (
        <div className="max-h-72 overflow-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full border-collapse text-sm">
            <thead className="sticky top-0 bg-slate-50 text-xs text-slate-500">
              <tr>
                <th className="border-b border-slate-200 px-3 py-2 text-left font-medium">
                  <span className="flex items-center gap-2">
                    Qator / Ustun
                    <button type="button" onClick={() => setColsText((t) => addValue(t, "Ustun"))} title="Yangi ustun qo'shish"
                      className="inline-flex items-center gap-0.5 rounded border border-dashed border-slate-300 px-1.5 py-0.5 text-[11px] font-medium text-slate-500 transition hover:border-slate-500 hover:text-slate-800">
                      <Plus size={11} /> Ustun
                    </button>
                    <button type="button" onClick={() => setRowsText((t) => addValue(t, "Qator"))} title="Yangi qator qo'shish"
                      className="inline-flex items-center gap-0.5 rounded border border-dashed border-slate-300 px-1.5 py-0.5 text-[11px] font-medium text-slate-500 transition hover:border-slate-500 hover:text-slate-800">
                      <Plus size={11} /> Qator
                    </button>
                  </span>
                </th>
                {colList.map((c) => (
                  <th key={c} className="border-b border-l border-slate-200 px-2 py-2 text-left font-medium">
                    <span className="flex items-center justify-between gap-1">
                      <button type="button" onClick={() => toggleMany(rows.map((r) => [r, c] as [string, string]))} className="hover:underline" title="Ustunni belgilash yoki bekor qilish">
                        {c || "—"}
                      </button>
                      {/* Ustunni butunlay olib tashlash — «Ustunlar» ro'yxatidan ham o'chadi */}
                      {c && (
                        <button type="button" onClick={() => setColsText((t) => dropValue(t, c))} aria-label={`${c} ustunini o'chirish`} title="Ustunni o'chirish"
                          className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded text-slate-400 transition hover:bg-slate-100 hover:text-red-600"><X size={11} /></button>
                      )}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r}>
                  <th className="border-b border-slate-100 bg-slate-50/60 px-3 py-1.5 text-left font-medium whitespace-nowrap">
                    <span className="flex items-center justify-between gap-1">
                      <button type="button" onClick={() => toggleMany(colList.map((c) => [r, c] as [string, string]))} className="hover:underline" title="Qatorni belgilash yoki bekor qilish">
                        {r}
                      </button>
                      <button type="button" onClick={() => setRowsText((t) => dropValue(t, r))} aria-label={`${r} qatorini o'chirish`} title="Qatorni o'chirish"
                        className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded text-slate-400 transition hover:bg-slate-100 hover:text-red-600"><X size={11} /></button>
                    </span>
                  </th>
                  {colList.map((c) => {
                    const on = isOn(r, c);
                    const k = key(r, c);
                    return (
                      <td key={c} className={cn("border-b border-l border-slate-100 px-2 py-1.5", !on && "bg-slate-50")}>
                        <span className="flex items-center gap-1.5">
                          <input
                            type="checkbox"
                            checked={on}
                            onChange={() => toggle(r, c)}
                            className="h-4 w-4 shrink-0 rounded border-slate-300 accent-slate-900"
                            aria-label={buildName(tpl, r, c) || `${r} ${c}`}
                          />
                          <input
                            value={cellPrice[k] ? fmtNum(Number(cellPrice[k])) : ""}
                            onChange={(e) => setCellPrice((s) => ({ ...s, [k]: digits(e.target.value) }))}
                            disabled={!on}
                            inputMode="numeric"
                            placeholder={basePrice ? fmtNum(Number(basePrice)) : "narx"}
                            className={cn(inputCls, "h-8 w-28 px-2 text-right tabular")}
                            aria-label="Katak narxi"
                          />
                        </span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {cells.length > 0 && (
        <p className="text-xs text-slate-600">
          <b>{cells.length} ta</b> mahsulot qo&apos;shiladi: {cells.slice(0, 4).map((c) => c.name).join(", ")}{cells.length > 4 ? " …" : ""}
          {" · nomi mavjud mahsulotga to'g'ri kelsa takror yaratilmaydi, narxi yangilanadi."}
        </p>
      )}

      {cells.length > MAX && (
        <p className="text-xs text-amber-700">Bir marta {MAX} tagacha mahsulot qo&apos;shiladi — qator yoki ustunlarni kamaytiring.</p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={pending || !cells.length || cells.length > MAX}>
          <Plus size={15} /> {pending ? "Yozilmoqda…" : `Qo'shish${cells.length ? ` (${cells.length})` : ""}`}
        </Button>
        {onCancel && <Button size="sm" variant="ghost" type="button" onClick={onCancel}>Bekor</Button>}
      </div>
      <FormError error={state?.error} />
    </form>
  );
}

/** Sozlamalar → Mahsulotlar: «Matritsa bilan qo'shish» tugmasi va ochiladigan panel. */
export function ProductMatrixPanel() {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <Button type="button" size="sm" variant="secondary" onClick={() => setOpen(true)}>
        <Grid3x3 size={15} /> Matritsa bilan qo&apos;shish
      </Button>
    );
  }
  return (
    <div className="w-full rounded-(--radius-card) border border-slate-200 bg-slate-50/60 p-4">
      <ProductMatrixAdd onCancel={() => setOpen(false)} onDone={() => setOpen(false)} />
    </div>
  );
}
