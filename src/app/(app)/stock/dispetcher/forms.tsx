"use client";

import { startTransition, useActionState, useEffect, useMemo, useState } from "react";
import { ArrowDownToLine, ArrowUpFromLine, Search, Truck } from "lucide-react";
import { Button, Field, FormError, FormSuccess, Input, Select } from "@/components/ui";
import { fmtNum } from "@/lib/format";
import { unitLabel } from "@/lib/unit";
import { today } from "@/lib/davomat";
import { cn } from "@/lib/utils";
import { issueAction, returnAction, takeAction } from "./actions";

export type PickRow = {
  id: string; code: string; name: string; unit: string; fuel: boolean; category: string; price: number | null;
  /** Olish: skladdagi qoldiq (tanlangan sklad); qaytarish: dispetcher qo'lidagi */
  avail: number; byWh?: Record<string, number>;
};
type Opt = { id: string; label: string };

const token = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Date.now() + Math.random()));
const num = (v: string) => { const n = Number(v.replace(/\s/g, "").replace(",", ".")); return Number.isFinite(n) ? n : 0; };

/**
 * Ro'yxatdan tanlab olish (yoki skladga qaytarish): har qatorda belgilash va miqdor; «Hammasi» — qoldiqning hammasini
 * yozadi (masalan salyarkaning hammasini olish). Bir martalik kalit — ikki marta bosilsa ikkinchi ko'chirish yozilmaydi.
 */
export function PickForm({ mode, rows, warehouses }: { mode: "take" | "return"; rows: PickRow[]; warehouses: Opt[] }) {
  const [state, action, pending] = useActionState(mode === "take" ? takeAction : returnAction, undefined);
  const [wh, setWh] = useState(warehouses[0]?.id ?? "");
  const [q, setQ] = useState("");
  const [qty, setQty] = useState<Record<string, string>>({});
  const [tk, setTk] = useState(token);
  const [note, setNote] = useState("");
  // Saqlangach — tanlov tozalanadi, yangi kalit
  useEffect(() => { if (state?.ok) { setQty({}); setNote(""); setTk(token()); } }, [state]);

  const availOf = (r: PickRow) => (mode === "take" ? r.byWh?.[wh] ?? 0 : r.avail);
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return rows.filter((r) => (!t || r.name.toLowerCase().includes(t) || r.code.toLowerCase().includes(t)));
  }, [rows, q]);
  const picked = Object.entries(qty).map(([materialId, v]) => ({ materialId, qty: num(v) })).filter((x) => x.qty > 0);
  const sum = picked.reduce((a, p) => a + p.qty * (rows.find((r) => r.id === p.materialId)?.price ?? 0), 0);

  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData();
    fd.set("warehouseId", wh); fd.set("rows", JSON.stringify(picked)); fd.set("note", note); fd.set("clientToken", tk);
    startTransition(() => action(fd));
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="relative min-w-56 flex-1">
          <Search size={15} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-slate-400" aria-hidden />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Qidirish: nomi yoki kodi" className="pl-9" aria-label="Qidirish" />
        </label>
        {warehouses.length > 1 && (
          <Field label={mode === "take" ? "Qaysi skladdan" : "Qaysi skladga"} className="w-56">
            <Select value={wh} onChange={(e) => setWh(e.target.value)}>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.label}</option>)}</Select>
          </Field>
        )}
      </div>
      <div className="max-h-[55vh] overflow-auto rounded-lg border border-slate-200">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-[1] bg-slate-50 text-left text-[12.5px] text-slate-600">
            <tr><th className="px-3 py-2">Mahsulot</th><th className="px-3 py-2 text-right">{mode === "take" ? "Skladda" : "Dispetcherda"}</th><th className="px-3 py-2 text-right">Narx</th><th className="w-48 px-3 py-2 text-right">Miqdor</th></tr>
          </thead>
          <tbody>
            {shown.length === 0 && <tr><td colSpan={4} className="px-3 py-6 text-center text-slate-400">{rows.length ? "Topilmadi" : mode === "take" ? "Skladda avto zapchast yoki yoqilg'i yo'q" : "Qo'lingizda hech narsa yo'q"}</td></tr>}
            {shown.map((r) => {
              const a = availOf(r), v = qty[r.id] ?? "", over = num(v) > a + 0.0005;
              return (
                <tr key={r.id} className={cn("border-t border-slate-100", num(v) > 0 && "bg-blue-50/60")}>
                  <td className="px-3 py-1.5">
                    <span className="font-medium text-slate-900">{r.name}</span>
                    <span className="ml-1.5 text-[11px] text-slate-400">{r.code}</span>
                    {r.fuel && <span className="ml-1.5 rounded bg-amber-100 px-1 text-[11px] font-medium text-amber-800">yoqilg&apos;i</span>}
                  </td>
                  <td className={cn("px-3 py-1.5 text-right tabular", a > 0 ? "text-slate-800" : "text-slate-400")}>{fmtNum(a, 3)} {unitLabel(r.unit)}</td>
                  <td className="px-3 py-1.5 text-right tabular text-slate-500">{r.price != null ? fmtNum(r.price, 0) : "—"}</td>
                  <td className="px-3 py-1.5">
                    <div className="flex items-center justify-end gap-1.5">
                      <Input type="number" min="0" step="any" value={v} disabled={a <= 0} onChange={(e) => setQty((x) => ({ ...x, [r.id]: e.target.value }))}
                        className={cn("h-8 w-28 text-right tabular", over && "border-red-400")} aria-label={`${r.name} miqdori`} />
                      <button type="button" disabled={a <= 0} onClick={() => setQty((x) => ({ ...x, [r.id]: String(a) }))}
                        className="rounded-md px-1.5 py-1 text-[12px] font-medium text-blue-700 hover:bg-blue-50 disabled:text-slate-300">Hammasi</button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Izoh" className="min-w-64 flex-1"><Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder={mode === "take" ? "masalan: haftalik salyarka" : "ortib qoldi"} /></Field>
        <Button disabled={pending || picked.length === 0}>
          {mode === "take" ? <ArrowDownToLine size={15} /> : <ArrowUpFromLine size={15} />}
          {pending ? "Saqlanmoqda…" : mode === "take" ? `O'zimga olish${picked.length ? ` (${picked.length})` : ""}` : `Skladga qaytarish${picked.length ? ` (${picked.length})` : ""}`}
        </Button>
        {picked.length > 0 && sum > 0 && <span className="pb-2 text-sm text-slate-500">≈ <b className="tabular text-slate-800">{fmtNum(sum, 0)}</b> so&apos;m</span>}
      </div>
      <FormError error={state?.error} />
      <FormSuccess text={state?.ok ? state.note : undefined} />
    </form>
  );
}

/**
 * Mashinaga berish: dispetcher qo'lidagi mahsulotdan — yoqilg'i zapravka bo'lib, zapchast transport xarajati bo'lib
 * mashinaga yoziladi. Mashina tanlansa uning asosiy haydovchisi taklif qilinadi.
 */
export function IssueForm({ held, vehicles, drivers }: { held: PickRow[]; vehicles: (Opt & { driverId: string | null })[]; drivers: Opt[] }) {
  const [state, action, pending] = useActionState(issueAction, undefined);
  const [tk, setTk] = useState(token);
  const [mat, setMat] = useState(held[0]?.id ?? "");
  const [veh, setVeh] = useState("");
  const [drv, setDrv] = useState("");
  const [qty, setQty] = useState("");
  const [key, setKey] = useState(0);
  useEffect(() => { if (state?.ok) { setTk(token()); setQty(""); setKey((k) => k + 1); } }, [state]);
  const m = held.find((r) => r.id === mat);
  const sum = m?.price != null ? num(qty) * m.price : null;

  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    fd.set("clientToken", tk);
    startTransition(() => action(fd));
  };
  if (!held.length) return <p className="text-sm text-slate-500">Qo&apos;lingizda mahsulot yo&apos;q — avval pastdagi ro&apos;yxatdan o&apos;zingizga oling.</p>;
  return (
    <form key={key} onSubmit={submit} className="space-y-3">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6 [&>*]:min-w-0">
        <Field label="Mashina *">
          <Select name="vehicleId" required value={veh} onChange={(e) => { setVeh(e.target.value); const d = vehicles.find((v) => v.id === e.target.value)?.driverId; if (d) setDrv(d); }}>
            <option value="">Tanlang</option>{vehicles.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
          </Select>
        </Field>
        <Field label="Mahsulot *" className="col-span-2">
          <Select name="materialId" required value={mat} onChange={(e) => setMat(e.target.value)}>
            {held.map((r) => <option key={r.id} value={r.id}>{r.name} — bor {fmtNum(r.avail, 3)} {unitLabel(r.unit)}</option>)}
          </Select>
        </Field>
        <Field label={`Miqdor *${m ? `, ${unitLabel(m.unit)}` : ""}`}>
          <Input name="qty" type="number" min="0" step="any" required value={qty} onChange={(e) => setQty(e.target.value)} className="text-right tabular" />
        </Field>
        <Field label="Sana"><Input name="date" type="date" defaultValue={today()} max={today()} /></Field>
        <Field label="Haydovchi">
          <Select name="driverId" value={drv} onChange={(e) => setDrv(e.target.value)}><option value="">—</option>{drivers.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}</Select>
        </Field>
        <Field label="Izoh" className="col-span-2 lg:col-span-4"><Input name="note" maxLength={300} placeholder="masalan: tormoz kolodkasi almashtirildi" /></Field>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button disabled={pending}><Truck size={15} /> {pending ? "Saqlanmoqda…" : "Mashinaga berish"}</Button>
        {m && <span className="text-sm text-slate-500">{m.fuel ? "Zapravka bo'lib yoziladi (hisob varag'i, yoqilg'i qoldig'i)" : "Transport xarajati (zapchast) bo'lib yoziladi"}{sum ? <> · ≈ <b className="tabular text-slate-800">{fmtNum(sum, 0)}</b> so&apos;m</> : null}</span>}
      </div>
      <FormError error={state?.error} />
      <FormSuccess text={state?.ok ? state.note : undefined} />
    </form>
  );
}
