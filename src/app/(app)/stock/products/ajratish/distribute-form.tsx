"use client";

import { useActionState, useMemo, useState } from "react";
import { ArrowRightLeft, Search } from "lucide-react";
import { distributeOwner } from "../actions";
import { Button, Field, FormActions, FormError, Input, LinkButton, Select } from "@/components/ui";
import { fmtNum } from "@/lib/format";
import { unitLabel } from "@/lib/unit";
import { cn } from "@/lib/utils";
import { blockEnterSubmit, submitKeepingState } from "../../../orders/order-form";

/** Ombor kaliti: brigada id yoki «umumiy» — umumiy hovli (server `null` qiladi) */
type Balance = { warehouseId: string; productId: string; owner: string; qty: number };
const COMMON = "umumiy";
const FORM_ID = "distribute-form";

/**
 * Bir ombordan bitta brigadaga bir nechta mahsulot: jadvalda manba ombordagi har mahsulot va uning qoldig'i,
 * «Ajratish» katagiga nechtasi o'tishi (bo'sh — o'tmaydi), «Hammasi» — qoldiqning hammasi.
 * Qidiruv qatorlarni faqat yashiradi — kiritilgan miqdorlar saqlanib qoladi.
 */
export function DistributeForm({ balances, products, brigades, ownerNames, warehouses, clientToken, initialFrom, initialTo }: {
  balances: Balance[];
  products: Record<string, { name: string; unit: string }>;
  /** Faol brigadalar — qabul qiluvchi */
  brigades: { id: string; name: string }[];
  /** Qoldig'i bor brigadalar nomi (nofaollari ham) — manba sifatida */
  ownerNames: Record<string, string>;
  warehouses: { id: string; name: string }[];
  clientToken: string;
  initialFrom: string;
  initialTo: string;
}) {
  const [state, action, pending] = useActionState(distributeOwner, undefined);
  const stocked = warehouses.filter((w) => balances.some((b) => b.warehouseId === w.id));
  const [wh, setWh] = useState(stocked[0]?.id ?? warehouses[0]?.id ?? "");
  // Manba omborlar: qoldig'i bor (shu skladda) — umumiy hovli birinchi
  const sources = useMemo(() => {
    const by = new Map<string, { qty: number; kinds: number }>();
    for (const b of balances) if (b.warehouseId === wh) { const c = by.get(b.owner) ?? { qty: 0, kinds: 0 }; c.qty += b.qty; c.kinds += 1; by.set(b.owner, c); }
    return [...by.entries()].map(([k, v]) => ({ key: k, name: k === COMMON ? "Umumiy hovli" : ownerNames[k] ?? "Brigada", ...v }))
      .sort((a, b) => (a.key === COMMON ? -1 : b.key === COMMON ? 1 : a.name.localeCompare(b.name, "uz", { numeric: true })));
  }, [balances, wh, ownerNames]);
  const [from, setFrom] = useState(sources.some((x) => x.key === initialFrom) ? initialFrom : sources[0]?.key ?? COMMON);
  const [to, setTo] = useState(initialTo);
  const [q, setQ] = useState("");
  const [qty, setQty] = useState<Record<string, string>>({});

  const rows = useMemo(() => balances.filter((b) => b.warehouseId === wh && b.owner === from)
    .map((b) => ({ ...b, ...products[b.productId]! }))
    .sort((a, b) => a.name.localeCompare(b.name, "uz", { numeric: true })), [balances, wh, from, products]);
  const targets = [...brigades.map((b) => ({ key: b.id, name: b.name })), ...(from !== COMMON ? [{ key: COMMON, name: "Umumiy hovli (brigadasiz)" }] : [])].filter((t) => t.key !== from);
  const needle = q.trim().toLowerCase();
  const picked = rows.filter((r) => Number(qty[r.productId]) > 0);
  const over = rows.filter((r) => Number(qty[r.productId]) > r.qty + 0.0005);
  const units = new Set(picked.map((r) => r.unit));
  const total = picked.reduce((s, r) => s + Number(qty[r.productId]), 0);
  const changeSource = (k: string) => { setFrom(k); setQty({}); if (to === k) setTo(""); };

  return (
    <div className="max-w-4xl space-y-5 rounded-(--radius-card) border border-slate-200/80 bg-white p-6 shadow-(--shadow-card)">
      <FormError error={state?.error} />
      {/* Xato qaytsa ham kiritilgani o'chmasin — yuborish onSubmit orqali (React 19 `<form action>` formani tozalaydi) */}
      <form id={FORM_ID} onSubmit={submitKeepingState(action)} onKeyDown={blockEnterSubmit} className="space-y-5">
        <input type="hidden" name="clientToken" value={clientToken} />
        <div className={cn("grid grid-cols-1 gap-4", stocked.length > 1 ? "sm:grid-cols-3" : "sm:grid-cols-2")}>
          {stocked.length > 1 ? (
            <Field label="Sklad"><Select name="warehouseId" value={wh} onChange={(e) => { setWh(e.target.value); setQty({}); }}>{stocked.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</Select></Field>
          ) : <input type="hidden" name="warehouseId" value={wh} />}
          <Field label="Qayerdan">
            <Select name="from" value={from} onChange={(e) => changeSource(e.target.value)}>
              {sources.length === 0 && <option value={COMMON}>Umumiy hovli — bo&apos;sh</option>}
              {sources.map((s) => <option key={s.key} value={s.key}>{s.name} — {fmtNum(s.qty)} ({s.kinds} xil)</option>)}
            </Select>
          </Field>
          <Field label="Qaysi brigadaga *">
            <Select name="to" value={targets.some((t) => t.key === to) ? to : ""} onChange={(e) => setTo(e.target.value)} required className={cn(!to && "text-slate-400")}>
              <option value="" disabled>Brigadani tanlang</option>
              {targets.map((t) => <option key={t.key} value={t.key}>{t.name}</option>)}
            </Select>
          </Field>
        </div>

        <div>
          <div className="mb-1.5 flex flex-wrap items-center justify-between gap-3">
            <span className="text-[13px] font-medium text-slate-700">Mahsulotlar — nechtasi brigadaga o&apos;tadi</span>
            <div className="relative w-full sm:w-64">
              <Search size={15} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-slate-400" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Mahsulot qidirish" className="h-9 pl-9" aria-label="Mahsulot qidirish" />
            </div>
          </div>
          <div className="overflow-hidden rounded-lg border border-slate-200">
            <div className="hidden grid-cols-[minmax(0,1fr)_120px_150px_92px] gap-2 border-b border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-500 sm:grid">
              <span>Mahsulot</span><span className="text-right">Omborda</span><span>Ajratish</span><span />
            </div>
            {rows.length === 0 && <div className="px-3 py-6 text-center text-sm text-slate-500">Bu omborda tayyor mahsulot yo&apos;q.</div>}
            {rows.map((r, i) => {
              const v = qty[r.productId] ?? "";
              const bad = Number(v) > r.qty + 0.0005;
              const hidden = needle && !r.name.toLowerCase().includes(needle);
              return (
                <div key={r.productId} className={cn("grid grid-cols-[minmax(0,1fr)_92px] items-center gap-2 border-b border-slate-100 px-3 py-2 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_120px_150px_92px]", hidden && "hidden", Number(v) > 0 && "bg-brand-50/40")}>
                  <input type="hidden" name="productId[]" value={r.productId} />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-slate-900" title={r.name}>{r.name}</div>
                    <div className="text-xs text-slate-500 sm:hidden">omborda {fmtNum(r.qty)} {unitLabel(r.unit)}</div>
                  </div>
                  <div className="hidden text-right text-sm tabular text-slate-700 sm:block">{fmtNum(r.qty)} <span className="text-slate-400">{unitLabel(r.unit)}</span></div>
                  <div className="relative col-start-1 sm:col-start-auto">
                    <Input name="qty[]" type="number" min="0" max={r.qty} step={r.unit === "dona" ? "1" : "0.001"} placeholder="0" value={v} aria-label={`${i + 1}-qator: ${r.name} — ajratish`}
                      onChange={(e) => setQty((m) => ({ ...m, [r.productId]: e.target.value }))}
                      className={cn("pr-12 text-right", bad && "border-red-300 text-red-600")} />
                    <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs text-slate-400">{unitLabel(r.unit)}</span>
                  </div>
                  <div className="col-start-2 row-start-1 flex justify-end sm:col-start-auto sm:row-start-auto">
                    <button type="button" onClick={() => setQty((m) => ({ ...m, [r.productId]: String(r.qty) }))}
                      className="rounded-md px-2 py-1 text-xs font-medium text-brand-700 hover:bg-brand-50">Hammasi</button>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-sm text-slate-500">
            <span>{rows.length} xil mahsulot omborda</span>
            {picked.length > 0 && <span>tanlandi: <b className="text-slate-900">{picked.length}</b> xil{units.size === 1 && <> · jami <b className="tabular text-slate-900">{fmtNum(total)}</b> {unitLabel([...units][0]!)}</>}</span>}
          </div>
          {over.length > 0 && <p className="mt-1 text-sm text-red-600">Omborda yetmaydi: {over.map((r) => r.name).join(", ")}</p>}
        </div>

        <Field label="Izoh" hint="Masalan: hovli sanog'i, 2-brigadaga topshirildi"><Input name="note" placeholder="Izoh (ixtiyoriy)" /></Field>
      </form>
      <FormActions>
        <Button type="submit" form={FORM_ID} disabled={pending || !to || picked.length === 0 || over.length > 0}>
          <ArrowRightLeft size={16} /> {pending ? "Ajratilmoqda…" : picked.length ? `Ajratish (${picked.length} xil)` : "Ajratish"}
        </Button>
        <LinkButton href="/stock?bolim=hovli#hovli" variant="secondary">Bekor</LinkButton>
      </FormActions>
    </div>
  );
}
