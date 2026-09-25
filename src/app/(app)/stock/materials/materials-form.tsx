"use client";

import { useActionState, useMemo, useState } from "react";
import { Plus, X, PackagePlus, MoreHorizontal } from "lucide-react";
import { importMaterials } from "../actions";
import { Button, FormError, Input, Select } from "@/components/ui";
import { MaterialPicker, type MaterialGroup } from "@/components/material-picker";
import { MoneyInput } from "@/components/money-input";
import { fmtNum, money } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Skladda mavjud xomashyo — nomi terilganda taklif qilinadi, tanlansa kodi, birligi va narxi o'zi to'ladi. */
export type MaterialOpt = { id: string; name: string; code: string; unit: string; price: number; minStock: number; groupId?: string | null };

type Row = { key: number; name: string; code: string; unit: string; qty: string; price: string; minStock: string; matId: string | null };
const UNITS: [string, string][] = [["kg", "kg"], ["t", "t"], ["l", "l"], ["m3", "m³"], ["dona", "dona"], ["m", "m"], ["m2", "m²"]];
const unitText = (u: string) => UNITS.find(([v]) => v === u)?.[1] ?? u;
const blank = (key: number): Row => ({ key, name: "", code: "", unit: "kg", qty: "", price: "", minStock: "", matId: null });
const VAT = 0.12; // NDS stavkasi — qoldiq × narxdan hisoblanadi, bazaga narx NDS'siz yoziladi
const GRID = "xl:grid-cols-[minmax(200px,1.5fr)_110px_88px_104px_116px_104px_120px_132px_32px]";
/** Qatordan summa, NDS va jami: bo'sh yoki xato qiymatda 0. */
const amount = (r: Row) => {
  const sum = (Number(r.qty) || 0) * (Number(r.price) || 0);
  return { sum, nds: sum * VAT, total: sum * (1 + VAT) };
};

/**
 * Nomi katagi: bosh harf terilganda mavjud xomashyolar chiqadi, o'ng chetidagi «…» tugmasi
 * butun ro'yxatni ochadi. Tanlangan xomashyoning kodi, birligi va oxirgi narxi qatorga o'zi yoziladi.
 */
function NamePicker({ row, options, groups, canCreate, onPick, onText }: {
  row: Row; options: MaterialOpt[]; groups: MaterialGroup[]; canCreate: boolean; onPick: (m: MaterialOpt) => void; onText: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [modal, setModal] = useState(false); // «…» bosilgan — to'liq spravochnik oynasi
  const [all, setAll] = useState(false);
  const list = useMemo(() => {
    const t = row.name.trim().toLowerCase();
    if (all || !t) return options.slice(0, 60);
    const starts = options.filter((o) => o.name.toLowerCase().startsWith(t));
    const rest = options.filter((o) => !o.name.toLowerCase().startsWith(t) && (o.name.toLowerCase().includes(t) || o.code.toLowerCase().includes(t)));
    return [...starts, ...rest].slice(0, 60);
  }, [options, row.name, all]);
  const close = () => { setOpen(false); setAll(false); };

  return (
    <div className="relative col-span-2 xl:col-span-1">
      <Input value={row.name} placeholder="Sement M400" autoComplete="off" className="pr-10"
        onChange={(e) => { onText(e.target.value); setAll(false); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(close, 150)}
        onKeyDown={(e) => { if (e.key === "Escape") close(); }} />
      <button type="button" aria-label="Mavjud xomashyolar" title="Xomashyo spravochnigi"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => { close(); setModal(true); }}
        className="absolute right-1 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-slate-400 transition hover:bg-slate-100 hover:text-slate-700">
        <MoreHorizontal size={16} />
      </button>
      <MaterialPicker
        open={modal}
        materials={options}
        groups={groups}
        canCreate={canCreate}
        initialQuery={row.name}
        onPick={(m) => onPick(options.find((o) => o.id === m.id) ?? (m as MaterialOpt))}
        onCreate={(name) => onText(name)}
        onClose={() => setModal(false)}
      />
      {open && (
        <div className="absolute z-30 mt-1 max-h-72 w-full min-w-[280px] overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
          {options.length === 0 ? (
            <div className="px-3 py-2 text-sm text-slate-500">Skladda hali xomashyo yo&apos;q — birinchisini shu yerda kiriting.</div>
          ) : list.length === 0 ? (
            <div className="px-3 py-2 text-sm text-slate-500">Topilmadi — yangi xomashyo sifatida qo&apos;shiladi.</div>
          ) : list.map((o) => (
            <button key={o.id} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => { onPick(o); close(); }}
              className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-slate-50">
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-slate-900">{o.name}</span>
                <span className="block truncate text-xs text-slate-500">{o.code} · {unitText(o.unit)}</span>
              </span>
              <span className="shrink-0 text-xs text-slate-500">{o.price > 0 ? `${fmtNum(o.price)} so'm` : "narx yo'q"}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Hisoblanadigan katak (NDS, Jami summa) — qoldiq × narxdan o'zi to'ladi, qo'lda tahrirlanmaydi. */
function CalcCell({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <div>
      <span className="mb-1 block text-[11px] text-slate-500 xl:hidden">{label}</span>
      <Input readOnly tabIndex={-1} value={value > 0 ? fmtNum(value) : ""} placeholder="0"
        className={cn("text-right tabular", strong && "font-semibold text-slate-900")} />
    </div>
  );
}

/** Qo'lda xomashyo qo'shish: bir nechta qator birdan, saqlanganda ro'yxatga tushadi va boshlang'ich qoldiq yoziladi. */
export function MaterialsForm({ children, existing = [], groups = [], canCreate = false }: { children?: React.ReactNode; existing?: MaterialOpt[]; groups?: MaterialGroup[]; canCreate?: boolean }) {
  const [state, action, pending] = useActionState(importMaterials, undefined);
  const [rows, setRows] = useState<Row[]>([blank(1)]);
  const update = (key: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const pick = (key: number, m: MaterialOpt) => update(key, {
    matId: m.id, name: m.name, code: m.code, unit: m.unit,
    price: m.price > 0 ? String(Math.round(m.price * 100) / 100) : "",
    minStock: m.minStock > 0 ? String(m.minStock) : "",
  });
  const filled = rows.filter((r) => r.name.trim());
  const totals = rows.reduce((a, r) => { const x = amount(r); return { sum: a.sum + x.sum, nds: a.nds + x.nds, total: a.total + x.total }; }, { sum: 0, nds: 0, total: 0 });
  return (
    <form action={action} className="space-y-4">
      <FormError error={state?.error} />
      <input type="hidden" name="rows" value={JSON.stringify(filled.map((r) => ({ name: r.name, code: r.code, unit: r.unit, qty: r.qty, price: r.price, minStock: r.minStock })))} />
      {children}
      <div className={cn("hidden gap-2 text-[11px] font-medium uppercase tracking-wide text-slate-500 xl:grid", GRID)}>
        <span>Nomi *</span><span>Kodi</span><span>Birlik</span><span>Qoldiq</span><span>Narx (birlik)</span><span>Minimal</span>
        <span className="text-right">NDS {fmtNum(VAT * 100)}%</span><span className="text-right">Jami summa</span><span />
      </div>
      <div className="space-y-2">
        {rows.length === 0 && <p className="rounded-lg border border-dashed border-slate-200 px-3 py-4 text-center text-sm text-slate-500">Qator qolmadi — pastdagi «Qator qo&apos;shish» tugmasini bosing.</p>}
        {rows.map((r) => {
          const a = amount(r);
          return (
          <div key={r.key} className={cn("grid grid-cols-2 gap-2 rounded-lg border border-slate-100 p-2 xl:items-center xl:border-0 xl:p-0", GRID)}>
            <NamePicker row={r} options={existing} groups={groups} canCreate={canCreate} onPick={(m) => pick(r.key, m)} onText={(v) => update(r.key, { name: v, matId: null })} />
            <Input placeholder="avto" value={r.code} onChange={(e) => update(r.key, { code: e.target.value, matId: null })} />
            <Select value={r.unit} onChange={(e) => update(r.key, { unit: e.target.value })}>{UNITS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>
            <Input type="number" step="0.001" min="0" placeholder="0" value={r.qty} onChange={(e) => update(r.key, { qty: e.target.value })} />
            <MoneyInput value={r.price} onChange={(v) => update(r.key, { price: v })} decimals={2} suffix={null} />
            <Input type="number" step="0.001" min="0" placeholder="0" value={r.minStock} onChange={(e) => update(r.key, { minStock: e.target.value })} />
            <CalcCell label={`NDS ${fmtNum(VAT * 100)}%`} value={a.nds} />
            <CalcCell label="Jami summa" value={a.total} strong />
            <button type="button" onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))} className="flex h-10 items-center justify-center text-slate-400 hover:text-red-600" aria-label="Qatorni o'chirish" title="Qatorni o'chirish"><X size={16} /></button>
          </div>
          );
        })}
      </div>

      <button type="button" onClick={() => setRows((rs) => [...rs, blank(Date.now())])} className="text-sm font-medium hover:underline"><span className="inline-flex items-center gap-1"><Plus size={14} /> Qator qo&apos;shish</span></button>

      {totals.sum > 0 && (
        <div className="flex flex-wrap justify-end gap-x-6 gap-y-1 rounded-lg bg-slate-50 px-3 py-2 text-sm">
          <span className="text-slate-500">NDS&apos;siz: <b className="text-slate-800">{money(totals.sum)}</b></span>
          <span className="text-slate-500">NDS {fmtNum(VAT * 100)}%: <b className="text-slate-800">{money(totals.nds)}</b></span>
          <span className="text-slate-500">Jami: <b className="text-slate-900">{money(totals.total)}</b></span>
        </div>
      )}
      <p className="text-xs text-slate-500">Nomi katagiga bosh harfni yozsangiz mavjud xomashyolar chiqadi, o&apos;ng chetdagi «…» tugmasi butun ro&apos;yxatni ochadi — tanlaganda kodi, birligi va oxirgi narxi o&apos;zi to&apos;ladi. NDS {fmtNum(VAT * 100)}% va jami summa qoldiq × narxdan hisoblanadi (so&apos;m) — skladga narx NDS&apos;siz yoziladi. Kodi bo&apos;sh qolsa nomdan yasaladi. Qoldiq kiritilsa u boshlang&apos;ich qoldiq sifatida skladga yoziladi (Harakat jurnalida &quot;Qo&apos;lda&quot;). Mavjud nom bo&apos;lsa — qoldiq ustiga qo&apos;shiladi.</p>
      <Button disabled={pending || filled.length === 0}><PackagePlus size={15} /> {pending ? "Saqlanmoqda…" : `Saqlash${filled.length ? ` (${filled.length})` : ""}`}</Button>
    </form>
  );
}
