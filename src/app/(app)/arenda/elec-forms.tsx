"use client";

import Link from "next/link";
import { useActionState, useEffect, useState, useTransition } from "react";
import { Check, Pencil, X } from "lucide-react";
import { Input, SheetTd, SheetTr } from "@/components/ui";
import { MoneyInput } from "@/components/money-input";
import { fmtNum } from "@/lib/format";
import { cn } from "@/lib/utils";
import { saveRentElec, saveRentElecBill } from "./actions";

export type ElecRowData = {
  leaseId: string; shopId: string; name: string; tenantName: string | null; former: boolean;
  meterStart: number | null; meterEnd: number | null; kwh: number; price: number; extra: number; sum: number; metered: boolean;
  fixed: number; paidCash: number; paidBank: number; paidDirect: number; paid: number; left: number; note: string | null;
};

const cell = (v: number) => (Math.abs(v) < 0.005 ? "–" : fmtNum(v));
const num = (v: number | null) => (v == null ? "" : String(v));
const dec = (v: string) => Number(v.replace(",", "."));

/**
 * Svet varag'ining qatori (Excel «Свет отчёт» ustunlari). Qalam — ko'rsatkichlar, hisoblagichsiz joyda summa,
 * litsevoyga to'langan va izoh shu qatorda tahrirlanadi; summa tarif va ustama bo'yicha darhol qayta hisoblanadi.
 */
export function ElecRow({ row, no, month, canEdit, kwhPrice, markup }: { row: ElecRowData; no: number; month: string; canEdit: boolean; kwhPrice: number; markup: number }) {
  const [edit, setEdit] = useState(false);
  const [state, action, pending] = useActionState(saveRentElec.bind(null, row.leaseId, month), undefined);
  const [, start] = useTransition();
  const init = () => ({ meterStart: num(row.meterStart), meterEnd: num(row.meterEnd), amount: row.metered ? "" : num(row.sum || row.fixed || null), paidDirect: row.paidDirect ? String(row.paidDirect) : "", note: row.note ?? "" });
  const [val, setVal] = useState(init);
  useEffect(() => { if (state?.ok) setEdit(false); }, [state]);
  const leftTone = row.left > 0.005 ? "text-red-600" : row.left < -0.005 ? "text-emerald-700" : "text-slate-400";
  const who = <>
    <Link href={`/arenda/dokon/${row.shopId}`} className="hover:underline">{row.name}</Link>
    {row.tenantName && <span className="block text-xs font-normal text-slate-500">{row.tenantName}{row.former ? " · sobiq ijarachi" : ""}</span>}
  </>;

  if (edit) {
    const a = val.meterStart ? dec(val.meterStart) : null, b = val.meterEnd ? dec(val.meterEnd) : null;
    const kwh = a != null && b != null && b >= a ? b - a : 0;
    const metered = kwh > 0 && kwhPrice > 0;
    const price = metered ? Math.round(kwh * kwhPrice) : 0, extra = metered ? Math.round((price * markup) / 100) : 0;
    const sum = metered ? price + extra : Number(val.amount || 0);
    const save = () => {
      const fd = new FormData();
      fd.set("meterStart", val.meterStart); fd.set("meterEnd", val.meterEnd);
      fd.set("amount", metered ? "0" : val.amount || "0"); fd.set("paidDirect", val.paidDirect || "0"); fd.set("note", val.note);
      start(() => action(fd));
    };
    const inp = (k: "meterStart" | "meterEnd", label: string) => (
      <SheetTd right className="min-w-28 p-1">
        <Input value={val[k]} inputMode="decimal" aria-label={label} className="h-8 text-right" onChange={(e) => setVal((o) => ({ ...o, [k]: e.target.value }))} />
      </SheetTd>
    );
    return (
      <SheetTr className="bg-amber-50/60">
        <SheetTd right muted>{no}</SheetTd>
        <SheetTd strong className="sticky left-0 z-[1] bg-white">{who}{state?.error && <span role="alert" className="block text-xs font-normal text-red-600">{state.error}</span>}</SheetTd>
        {inp("meterStart", "Avvalgi ko'rsatkich")}
        {inp("meterEnd", "Hozirgi ko'rsatkich")}
        <SheetTd right>{kwh ? fmtNum(kwh, 1) : "–"}</SheetTd>
        <SheetTd right>{cell(price)}</SheetTd>
        <SheetTd right>{cell(extra)}</SheetTd>
        <SheetTd right tone="yellow" strong className="min-w-32 p-1">
          {metered ? cell(sum) : <MoneyInput value={val.amount} onChange={(v) => setVal((o) => ({ ...o, amount: v }))} ariaLabel="Svet summasi (hisoblagichsiz)" suffix={null} className="h-8 text-right" />}
        </SheetTd>
        <SheetTd right>{cell(row.fixed)}</SheetTd>
        <SheetTd right className="min-w-32 p-1">
          <MoneyInput value={val.paidDirect} onChange={(v) => setVal((o) => ({ ...o, paidDirect: v }))} ariaLabel="Litsevoyga to'langan" placeholder="litsevoyga" suffix={null} className="h-8 text-right" />
          {row.paidCash + row.paidBank > 0 && <span className="block text-[11px] text-slate-500">+ kassaga {fmtNum(row.paidCash + row.paidBank)}</span>}
        </SheetTd>
        <SheetTd right muted>avto</SheetTd>
        <SheetTd className="min-w-56 p-1">
          <div className="flex items-center gap-1">
            <Input value={val.note} onChange={(e) => setVal((o) => ({ ...o, note: e.target.value }))} onKeyDown={(e) => { if (e.key === "Enter") save(); }} aria-label="Izoh" placeholder="kartaga tashagan…" className="h-8 text-xs" />
            <button type="button" onClick={save} disabled={pending} aria-label="Saqlash" className="rounded-md bg-emerald-600 p-1.5 text-white hover:bg-emerald-700 disabled:opacity-50"><Check size={14} /></button>
            <button type="button" onClick={() => { setEdit(false); setVal(init()); }} aria-label="Bekor qilish" className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100"><X size={14} /></button>
          </div>
        </SheetTd>
      </SheetTr>
    );
  }

  return (
    <SheetTr>
      <SheetTd right muted>{no}</SheetTd>
      <SheetTd strong className="sticky left-0 z-[1] max-w-72 whitespace-normal bg-white">{who}</SheetTd>
      <SheetTd right>{row.meterStart != null ? fmtNum(row.meterStart, 1) : "–"}</SheetTd>
      <SheetTd right>{row.meterEnd != null ? fmtNum(row.meterEnd, 1) : <span className="text-xs text-amber-700">{row.metered || row.meterStart != null ? "kiritilmagan" : "–"}</span>}</SheetTd>
      <SheetTd right>{row.kwh ? fmtNum(row.kwh, 1) : "–"}</SheetTd>
      <SheetTd right>{cell(row.price)}</SheetTd>
      <SheetTd right>{cell(row.extra)}</SheetTd>
      <SheetTd right tone="yellow" strong>{cell(row.sum)}</SheetTd>
      <SheetTd right>{cell(row.fixed)}</SheetTd>
      <SheetTd right tone="green">
        {cell(row.paid)}
        {row.paidDirect > 0 && <span className="block text-[11px] text-slate-500">litsevoy {fmtNum(row.paidDirect)}</span>}
      </SheetTd>
      <SheetTd right strong className={leftTone}>{cell(row.left)}</SheetTd>
      <SheetTd className="min-w-40 text-xs text-slate-600">
        <div className="flex items-start justify-between gap-2">
          <span className="whitespace-normal">{row.note}</span>
          {canEdit && <button type="button" onClick={() => { setVal(init()); setEdit(true); }} aria-label={`${row.name} — svetni tahrirlash`} title="Ko'rsatkich va to'lovni kiritish" className="shrink-0 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><Pencil size={13} /></button>}
        </div>
      </SheetTd>
    </SheetTr>
  );
}

/** «To'lashimiz kerak» — joy bo'yicha elektr kompaniyasiga oylik to'lov (qatorning o'zida tahrirlanadi). */
export function ElecBill({ location, month, amount, canEdit }: { location: string; month: string; amount: number | null; canEdit: boolean }) {
  const [edit, setEdit] = useState(false);
  const [state, action, pending] = useActionState(saveRentElecBill.bind(null, location, month), undefined);
  const [v, setV] = useState(amount ? String(amount) : "");
  const [, start] = useTransition();
  useEffect(() => { if (state?.ok) setEdit(false); }, [state]);
  if (!edit) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <span className={cn("tabular-nums", !amount && "text-slate-400")}>{amount ? fmtNum(amount) : "kiritilmagan"}</span>
        {canEdit && <button type="button" onClick={() => setEdit(true)} aria-label={`${location} — to'lashimiz kerak summasi`} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><Pencil size={12} /></button>}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1">
      <MoneyInput value={v} onChange={setV} ariaLabel="To'lashimiz kerak" suffix={null} className="h-8 w-36 text-right" />
      <button type="button" disabled={pending} onClick={() => { const fd = new FormData(); fd.set("amount", v || "0"); start(() => action(fd)); }} aria-label="Saqlash" className="rounded-md bg-emerald-600 p-1.5 text-white hover:bg-emerald-700 disabled:opacity-50"><Check size={14} /></button>
      <button type="button" onClick={() => setEdit(false)} aria-label="Bekor qilish" className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100"><X size={14} /></button>
      {state?.error && <span role="alert" className="text-xs text-red-600">{state.error}</span>}
    </span>
  );
}
