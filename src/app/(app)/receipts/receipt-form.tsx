"use client";

import { X, Plus } from "lucide-react";

import { fmtNum, isoDate } from "@/lib/format";

import { useActionState, useState } from "react";
import { createReceipt } from "./actions";
import { Button, Field, FormError, Input, LinkButton, Select, Textarea, FormActions } from "@/components/ui";
import { MaterialField, type MaterialGroup, type MaterialRow } from "@/components/material-picker";
import { MoneyInput } from "@/components/money-input";

type Opt = { id: string; name: string };
type Material = MaterialRow;
type Row = { key: number; materialId: string; qty: string; price: string };

type Account = Opt & { type: "CASH" | "BANK" };

export function ReceiptForm({ suppliers, warehouses, materials, groups = [], canCreate = false, accounts }: { suppliers: Opt[]; warehouses: Opt[]; materials: Material[]; groups?: MaterialGroup[]; canCreate?: boolean; accounts: Account[] }) {
  const [state, action, pending] = useActionState(createReceipt, undefined);
  const [rows, setRows] = useState<Row[]>([{ key: 1, materialId: "", qty: "", price: "" }]);
  const update = (key: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const total = rows.reduce((s, r) => s + (Number(r.qty) || 0) * (Number(r.price) || 0), 0);
  const [scale, setScale] = useState({ gross: "", tare: "" });
  const kg = (v: string) => (v.trim() === "" ? null : Number(v.replace(/\s+/g, "").replace(",", ".")));
  const g = kg(scale.gross), t = kg(scale.tare);
  const netto = g != null && t != null && Number.isFinite(g) && Number.isFinite(t) ? g - t : null;

  return (
    <form action={action} className="max-w-3xl space-y-5 rounded-(--radius-card) border border-slate-200/80 bg-white p-6 shadow-(--shadow-card)">
      <FormError error={state?.error} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Field label="Yetkazuvchi *">
          <Select name="supplierId" defaultValue="" required>
            <option value="" disabled>Tanlang…</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
        </Field>
        <Field label="Sklad *"><Select name="warehouseId" defaultValue={warehouses[0]?.id}>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</Select></Field>
        <Field label="Sana *"><Input name="date" type="date" defaultValue={isoDate()} required /></Field>
      </div>

      {/* Hisob faqat direktorga beriladi. Boshqalarda to'lovni moliya Kirim-Chiqimdan tasdiqlaydi */}
      {accounts.length > 0 ? (
        <Field label="Qaysi hisobdan to'landi" hint="Tanlansa — shu zahoti chiqim bo'lib yoziladi. «Moliya to'laydi» — Kirim-Chiqimdagi to'lanmagan kirimlarga tushadi">
          <Select name="cashAccountId" defaultValue="">
            <option value="">Moliya to&apos;laydi</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}{a.type === "CASH" ? " (naqd)" : " (o'tkazma)"}</option>)}
          </Select>
        </Field>
      ) : (
        <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">To&apos;lov moliya bo&apos;limi tomonidan qilinadi — kirim saqlangach Kirim-Chiqimdagi «To&apos;lanmagan kirimlar» ro&apos;yxatiga tushadi.</p>
      )}

      <div>
        <div className="mb-2 text-sm font-medium text-slate-700">Xomashyo *</div>
        <div className="space-y-2">
          {rows.map((r) => {
            const unit = materials.find((m) => m.id === r.materialId)?.unit ?? "";
            return (
              <div key={r.key} className="space-y-2 rounded-lg border border-slate-100 p-2 sm:grid sm:grid-cols-[1fr_140px_50px_160px_40px] sm:items-center sm:gap-2 sm:space-y-0 sm:border-0 sm:p-0">
                {/* Nomi katagi: harflar bo'yicha qidiradi, "…" butun spravochnikni ochadi */}
                <div>
                  <input type="hidden" name="materialId[]" value={r.materialId} />
                  <MaterialField
                    materials={materials}
                    groups={groups}
                    canCreate={canCreate}
                    value={r.materialId}
                    onPick={(m) => update(r.key, { materialId: m.id, price: r.price || (m.price ? String(Math.round(m.price)) : "") })}
                  />
                </div>
                <div className="grid grid-cols-[1fr_auto] items-center gap-2 sm:contents">
                  <Input name="qty[]" type="number" step="0.001" min="0" placeholder="Miqdor" value={r.qty} onChange={(e) => update(r.key, { qty: e.target.value })} required />
                  <span className="text-sm text-slate-500">{unit}</span>
                </div>
                <div className="grid grid-cols-[1fr_auto] items-center gap-2 sm:contents">
                  <MoneyInput name="price[]" value={r.price} onChange={(v) => update(r.key, { price: v })} placeholder={`Narx / ${unit}`} suffix={null} required />
                  <button type="button" onClick={() => setRows((rs) => rs.length > 1 ? rs.filter((x) => x.key !== r.key) : rs)} className="flex h-10 w-10 items-center justify-center text-slate-400 hover:text-red-600 sm:h-auto sm:w-auto"><X size={16} /></button>
                </div>
              </div>
            );
          })}
        </div>
        <button type="button" onClick={() => setRows((rs) => [...rs, { key: Date.now(), materialId: "", qty: "", price: "" }])} className="mt-2 text-sm font-medium hover:underline"><span className="inline-flex items-center gap-1"><Plus size={14} /> Qator qo'shish</span></button>
        <div className="mt-3 text-right text-base font-semibold">Jami: {fmtNum(total)} so'm</div>
      </div>

      {/* Nakladnoy va tarozi — kirim izohiga tuzilgan holda yoziladi (netto = brutto − tara) */}
      <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-4">
        <div className="mb-3 text-[13px] font-semibold text-slate-700">Nakladnoy va tarozi</div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Field label="Nakladnoy №"><Input name="waybillNo" placeholder="1234" autoComplete="off" /></Field>
          <Field label="Mashina raqami"><Input name="vehicle" placeholder="01 A 123 BC" autoComplete="off" /></Field>
          <Field label="Brutto, kg"><Input name="gross" value={scale.gross} onChange={(e) => setScale((x) => ({ ...x, gross: e.target.value }))} inputMode="decimal" placeholder="32500" /></Field>
          <Field label="Tara, kg"><Input name="tare" value={scale.tare} onChange={(e) => setScale((x) => ({ ...x, tare: e.target.value }))} inputMode="decimal" placeholder="12300" /></Field>
          <Field label="Netto, kg">
            <div className={`flex h-10 items-center rounded-lg border px-3 text-sm tabular ${netto != null && netto <= 0 ? "border-red-300 text-red-700" : "border-slate-200 bg-white text-slate-900"}`}>
              {netto == null ? "—" : fmtNum(netto, 3)}
            </div>
          </Field>
        </div>
      </div>

      <Field label="Izoh"><Textarea name="note" placeholder="Holati, qo'shimcha ma'lumot…" /></Field>
      <FormActions>
        <Button disabled={pending}>{pending ? "Yozilmoqda…" : "Kirimni qayd etish"}</Button>
        <LinkButton href="/receipts" variant="secondary">Bekor</LinkButton>
      </FormActions>
    </form>
  );
}
