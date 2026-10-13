"use client";

import Link from "next/link";
import { startTransition, useActionState, useMemo, useRef, useState } from "react";
import { AlertTriangle, PackageMinus, Plus, Trash2 } from "lucide-react";
import { createRasxod } from "./actions";
import { MaterialField, type MaterialGroup } from "@/components/material-picker";
import { Button, Field, FormError, Input, Select } from "@/components/ui";
import { fmtNum } from "@/lib/format";
import { unitLabelRu } from "@/lib/unit";
import { cn } from "@/lib/utils";

type Opt = { id: string; name: string };
type Mat = { id: string; name: string; code: string; unit: string; groupId: string | null; price: number | null; approx: boolean };
type Line = { key: string; materialId: string; qty: string };

const EPS = 0.0005;
const num = (v: string) => Number(v.replace(/\s+/g, "").replace(",", ".")) || 0;

/**
 * Qatorlar — `Table` emas (u `overflow-x-auto`: MaterialField ochiladigan ro'yxati kesilardi), «Приход» formasidagidek grid:
 * keng ekranda Excel'ga o'xshash jadval, telefonda har qator alohida blok. № | Наименование | Ед Изм | Остаток | К-во | Цена | Сумма | ×
 */
const GRID = "xl:grid-cols-[28px_minmax(220px,1fr)_64px_110px_128px_120px_132px_36px]";
const HEAD = "px-2 py-2 text-[12.5px] font-semibold leading-tight text-slate-900";
/** Telefonda maydon nomi (keng ekranda ustun sarlavhasi bor). */
const Lbl = ({ children }: { children: React.ReactNode }) => <span className="mb-1 block text-xs font-medium text-slate-500 xl:hidden">{children}</span>;

/**
 * «Новый расход» formasi (ruscha). Qatorlar: Наименование · Ед Изм · Остаток (tanlangan sklad) · К-во · Цена · Сумма.
 * Miqdor qoldiqdan oshsa (bir xomashyo bir necha qatorda bo'lsa — yig'indisi) qator qizaradi va tugma yopiladi;
 * yakuniy tekshiruv serverda, qulf ostida (`issueStock`).
 * Yuborish — `onSubmit` + `startTransition(() => action(formData))`: `<form action>` bo'lsa React 19 xato bilan qaytgan
 * action'dan keyin formani reset qiladi va boshqariladigan Склад / Кому select'lari ko'rinishda standartga qaytib qoladi.
 */
export function RasxodForm({ warehouses, recipients, brigades, materials, groups, balances, clientToken, today, minDate, defaultTo }: {
  warehouses: Opt[]; recipients: Opt[]; brigades: Opt[]; materials: Mat[]; groups: MaterialGroup[];
  balances: Record<string, Record<string, number>>; clientToken: string; today: string; minDate: string; defaultTo: string;
}) {
  const [state, action, pending] = useActionState(createRasxod, undefined);
  const [whId, setWhId] = useState(warehouses[0]?.id ?? "");
  const [to, setTo] = useState(defaultTo);
  const [date, setDate] = useState(today);
  const [note, setNote] = useState("");
  const seq = useRef(1);
  const [lines, setLines] = useState<Line[]>([{ key: "l0", materialId: "", qty: "" }]);

  const bal = useMemo(() => balances[whId] ?? {}, [balances, whId]);
  const meta = useMemo(() => new Map(materials.map((m) => [m.id, m])), [materials]);
  const pickerMats = useMemo(
    () => materials.map((m) => ({ id: m.id, name: m.name, code: m.code, unit: m.unit, groupId: m.groupId, balance: bal[m.id] ?? 0 })),
    [materials, bal],
  );

  // Bir xomashyo bir necha qatorda — yig'indisi qoldiq bilan solishtiriladi
  const wanted = new Map<string, number>();
  for (const l of lines) if (l.materialId) wanted.set(l.materialId, (wanted.get(l.materialId) ?? 0) + num(l.qty));
  const overIds = new Set([...wanted.entries()].filter(([id, q]) => q > (bal[id] ?? 0) + EPS).map(([id]) => id));
  const filled = lines.filter((l) => l.materialId && num(l.qty) > 0);
  const total = filled.reduce((s, l) => s + num(l.qty) * (meta.get(l.materialId)?.price ?? 0), 0);
  const noPrice = filled.filter((l) => meta.get(l.materialId)?.price == null).map((l) => meta.get(l.materialId)!.name);
  const incomplete = lines.some((l) => l.materialId && !(num(l.qty) > 0));
  const blocked = pending || !to || !whId || filled.length === 0 || overIds.size > 0 || incomplete;

  const patch = (key: string, p: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...p } : l)));
  const add = () => setLines((ls) => [...ls, { key: `l${seq.current++}`, materialId: "", qty: "" }]);
  const remove = (key: string) => setLines((ls) => (ls.length > 1 ? ls.filter((l) => l.key !== key) : [{ key: `l${seq.current++}`, materialId: "", qty: "" }]));
  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (blocked) return;
    const fd = new FormData(e.currentTarget);
    startTransition(() => action(fd));
  };

  return (
    <form onSubmit={submit} lang="ru" className="space-y-5">
      <input type="hidden" name="clientToken" value={clientToken} />
      {filled.map((l) => (
        <span key={l.key} hidden>
          <input type="hidden" name="materialId[]" value={l.materialId} />
          <input type="hidden" name="qty[]" value={l.qty.replace(/\s+/g, "").replace(",", ".")} />
        </span>
      ))}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Число *">
          <Input type="date" name="date" value={date} onChange={(e) => setDate(e.target.value)} min={minDate} max={today} required />
        </Field>
        <Field label="Склад (От Кого) *">
          <Select name="warehouseId" value={whId} onChange={(e) => setWhId(e.target.value)} required>
            {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </Select>
        </Field>
        <Field label="Кому *">
          <Select name="to" value={to} onChange={(e) => setTo(e.target.value)} required aria-invalid={!to && state?.error ? true : undefined}>
            <option value="">— выберите —</option>
            {recipients.length > 0 && (
              <optgroup label="Получатели">
                {recipients.map((r) => <option key={r.id} value={`r:${r.id}`}>{r.name}</option>)}
              </optgroup>
            )}
            {brigades.length > 0 && (
              <optgroup label="Бригады">
                {brigades.map((b) => <option key={b.id} value={`b:${b.id}`}>{b.name}</option>)}
              </optgroup>
            )}
          </Select>
          <Link href="/stock/rasxod#recipients" className="mt-1 inline-block text-xs text-slate-500 underline-offset-2 hover:text-slate-800 hover:underline">
            Нет в списке? Добавить получателя
          </Link>
        </Field>
      </div>

      <div>
        <div className={cn("hidden overflow-hidden rounded-t-lg border border-b-0 border-slate-300/80 bg-red-50/70 xl:grid xl:items-center xl:gap-2", GRID)}>
          <div className={cn(HEAD, "text-center")}>№</div>
          <div className={HEAD}>Наименование</div>
          <div className={cn(HEAD, "text-center")}>Ед Изм</div>
          <div className={cn(HEAD, "text-right")}>Остаток</div>
          <div className={cn(HEAD, "text-right")}>К-во</div>
          <div className={cn(HEAD, "text-right")}>Цена</div>
          <div className={cn(HEAD, "text-right")}>Сумма</div>
          <div />
        </div>
        <div className="space-y-2 xl:space-y-0 xl:rounded-b-lg xl:border xl:border-slate-300/80">
          {lines.map((l, i) => {
            const m = l.materialId ? meta.get(l.materialId) : undefined;
            const u = m ? unitLabelRu(m.unit) : "";
            const q = num(l.qty);
            const have = l.materialId ? bal[l.materialId] ?? 0 : null;
            const over = !!l.materialId && overIds.has(l.materialId);
            const del = (
              <button type="button" onClick={() => remove(l.key)} aria-label={`Удалить строку ${i + 1}`} title="Удалить строку"
                className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600">
                <Trash2 size={15} />
              </button>
            );
            return (
              <div key={l.key} className={cn("grid grid-cols-2 gap-2 rounded-lg border border-slate-200 p-3 sm:grid-cols-4",
                "xl:items-center xl:rounded-none xl:border-0 xl:border-b xl:border-slate-200 xl:px-0 xl:py-1.5 xl:last:border-b-0", GRID,
                over && "border-red-200 bg-red-50/60")}>
                {/* Telefonda: qator raqami va o'chirish */}
                <div className="col-span-2 flex items-center justify-between sm:col-span-4 xl:hidden">
                  <span className="text-xs font-semibold text-slate-500">Строка {i + 1}</span>
                  {del}
                </div>
                <div className="hidden text-center text-xs text-slate-400 tabular xl:block">{i + 1}</div>
                <div className="col-span-2 sm:col-span-4 xl:col-span-1">
                  <Lbl>Наименование</Lbl>
                  <MaterialField materials={pickerMats} groups={groups} value={l.materialId} placeholder="Наименование или код"
                    onPick={(x) => patch(l.key, { materialId: x.id })} />
                </div>
                <div className="hidden text-center text-sm text-slate-600 xl:block">{u || "—"}</div>
                <div className="text-sm tabular xl:px-2 xl:text-right">
                  <Lbl>Остаток{u ? `, ${u}` : ""}</Lbl>
                  <span className={cn(have != null && have <= EPS ? "text-red-600" : "text-slate-600")}>{have == null ? "—" : fmtNum(have, 3)}</span>
                </div>
                <div>
                  <Lbl>К-во{u ? `, ${u}` : ""}</Lbl>
                  <Input value={l.qty} inputMode="decimal" placeholder="0" aria-label={`К-во, строка ${i + 1}`} autoComplete="off"
                    aria-invalid={over || undefined}
                    className={cn("h-9 text-right tabular", over && "border-red-400 text-red-700")}
                    onChange={(e) => patch(l.key, { qty: e.target.value })} />
                </div>
                <div className="text-sm whitespace-nowrap tabular xl:px-2 xl:text-right">
                  <Lbl>Цена{u ? ` за ${u}` : ""}</Lbl>
                  {!m ? <span className="text-slate-400">—</span>
                    : m.price == null ? <span className="inline-flex items-center gap-1 text-amber-700"><AlertTriangle size={13} /> нет цены</span>
                    : <span title={m.approx ? "«Дона сўм» не задана — средняя себестоимость" : "Дона сўм"}>{m.approx && <span className="mr-0.5 text-slate-400">≈</span>}{fmtNum(m.price, 2)}</span>}
                </div>
                <div className="text-sm font-medium whitespace-nowrap tabular xl:px-2 xl:text-right">
                  <Lbl>Сумма</Lbl>
                  {m && q > 0 && m.price != null ? fmtNum(q * m.price) : "—"}
                </div>
                <div className="hidden justify-center xl:flex">{del}</div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button type="button" variant="secondary" onClick={add}><Plus size={16} /> Добавить строку</Button>
        <div className="text-sm text-slate-500">
          Строк: <b className="text-slate-900">{filled.length}</b> · Итого: <b className="text-slate-900 tabular">{fmtNum(total)} сум</b>
        </div>
      </div>

      {overIds.size > 0 && (
        <p className="text-sm text-red-600">
          Больше остатка на складе: {[...overIds].map((id) => `${meta.get(id)?.name ?? "?"} (есть ${fmtNum(bal[id] ?? 0, 3)})`).join(", ")}
        </p>
      )}
      {noPrice.length > 0 && (
        <p className="flex items-start gap-1.5 text-sm text-amber-700">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" />
          Нет цены (Дона сўм не задана и прихода не было): {noPrice.join(", ")} — строка запишется без суммы.
        </p>
      )}

      <Field label="Примечание">
        <Input name="note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="Например: на ремонт, для объекта, по заявке №…" autoComplete="off" />
      </Field>

      <FormError error={state?.error} />
      <div className="flex justify-end">
        <Button disabled={blocked}><PackageMinus size={16} /> {pending ? "Запись…" : "Записать расход"}</Button>
      </div>
    </form>
  );
}
