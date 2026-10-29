"use client";

import { useActionState, useMemo, useState } from "react";
import { CopyPlus, PackagePlus, Plus, Save, Send, X } from "lucide-react";
import { fmtNum } from "@/lib/format";
import { MATERIAL_UNITS, unitLabel } from "@/lib/unit";
import { MATERIAL_CATEGORY_LABEL, MATERIAL_CATEGORY_OPTIONS } from "@/lib/material-category";
import type { MaterialCategory } from "@/generated/prisma";
import { saveShipmentAction } from "./actions";
import { Badge, Button, Field, FormActions, FormError, Input, LinkButton, Select, Textarea } from "@/components/ui";
import { MaterialField, type MaterialGroup, type MaterialRow } from "@/components/material-picker";
import { MoneyInput } from "@/components/money-input";

type Opt = { id: string; name: string };
export type ShipmentMaterial = MaterialRow & { category: MaterialCategory };

/** Qator: spravochnikdan (`materialId`) yoki yangi mahsulot (`isNew` — nom, birlik). Kategoriya — ro'yxatni ham toraytiradi. */
export type ShipmentRow = { key: number; category: MaterialCategory; isNew: boolean; materialId: string; name: string; unit: string; qty: string; price: string };

export type ShipmentFormInitial = {
  id?: string; supplierId: string; warehouseId: string; date: string; waybillNo: string; payment: string; carrier: string; note: string; rows: ShipmentRow[];
};

const blank = (category: MaterialCategory = "XOMASHYO"): ShipmentRow => ({ key: Date.now() + Math.random(), category, isNew: false, materialId: "", name: "", unit: "dona", qty: "", price: "" });
const num = (v: string) => Number(v.replace(/\s+/g, "").replace(",", ".")) || 0;

/**
 * Snabjenets jo'natmasi: nakladnoy rekvizitlari + qatorlar (kategoriya → mahsulot → miqdor → narx).
 * Ikki tugma: «Qoralama» (skladga ko'rinmaydi) va «Skladga jo'natish» (skladga bildirishnoma ketadi).
 */
export function ShipmentForm({ suppliers, warehouses, materials, groups, initial }: {
  suppliers: Opt[]; warehouses: Opt[]; materials: ShipmentMaterial[]; groups: MaterialGroup[]; initial: ShipmentFormInitial;
}) {
  const [state, action, pending] = useActionState(saveShipmentAction, undefined);
  const [rows, setRows] = useState<ShipmentRow[]>(initial.rows.length ? initial.rows : [blank()]);
  const update = (key: number, patch: Partial<ShipmentRow>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const byCategory = useMemo(() => {
    const m = new Map<MaterialCategory, ShipmentMaterial[]>();
    for (const x of materials) { const l = m.get(x.category); if (l) l.push(x); else m.set(x.category, [x]); }
    return m;
  }, [materials]);

  const sumOf = (r: ShipmentRow) => num(r.qty) * num(r.price);
  const total = rows.reduce((s, r) => s + sumOf(r), 0);
  const perCategory = MATERIAL_CATEGORY_OPTIONS
    .map(([c, label]) => ({ c, label, n: rows.filter((r) => r.category === c && (r.materialId || r.name.trim())).length, sum: rows.filter((r) => r.category === c).reduce((s, r) => s + sumOf(r), 0) }))
    .filter((x) => x.n > 0);
  // Bir mahsulot ikki qatorda — odatda xato (ikki marta kiritilgan)
  const dupIds = new Set(rows.map((r) => r.materialId).filter((id, i, a) => id && a.indexOf(id) !== i));

  const payload = JSON.stringify(rows
    .filter((r) => (r.isNew ? r.name.trim() : r.materialId))
    .map((r) => (r.isNew
      ? { name: r.name.trim(), unit: r.unit, category: r.category, qty: r.qty, price: r.price }
      : { materialId: r.materialId, qty: r.qty, price: r.price })));

  return (
    <form action={action} className="space-y-5 rounded-(--radius-card) border border-slate-200/80 bg-white p-6 shadow-(--shadow-card)">
      <FormError error={state?.error} />
      {initial.id && <input type="hidden" name="id" value={initial.id} />}
      <input type="hidden" name="items" value={payload} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Yetkazuvchi *">
          <Select name="supplierId" defaultValue={initial.supplierId} required>
            <option value="" disabled>Tanlang…</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
        </Field>
        <Field label="Qaysi skladga *">
          <Select name="warehouseId" defaultValue={initial.warehouseId}>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</Select>
        </Field>
        <Field label="Nakladnoy sanasi *"><Input name="date" type="date" defaultValue={initial.date} required /></Field>
        <Field label="Nakladnoy №"><Input name="waybillNo" defaultValue={initial.waybillNo} placeholder="1234" autoComplete="off" /></Field>
        <Field label="To'lov">
          <Select name="payment" defaultValue={initial.payment}>
            <option value="">Belgilanmagan</option>
            <option value="BANK">Perechisleniye (П-р)</option>
            <option value="CASH">Naqd (Н-к)</option>
          </Select>
        </Field>
        <Field label="Kim olib keldi" className="sm:col-span-1 lg:col-span-3"><Input name="carrier" defaultValue={initial.carrier} placeholder="Mashina raqami, haydovchi yoki «Yetkazuvchi o'zi»" autoComplete="off" /></Field>
      </div>

      <div>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div className="text-sm font-medium text-slate-700">Mahsulotlar * <span className="font-normal text-slate-500">— narx QQS&apos;siz, birlik uchun</span></div>
          <div className="flex flex-wrap gap-1.5">{perCategory.map((x) => <Badge key={x.c} color="blue">{x.label}: {x.n} ta · {fmtNum(x.sum)}</Badge>)}</div>
        </div>
        <div className="hidden gap-2 px-1 pb-1 text-xs font-medium text-slate-500 lg:grid lg:grid-cols-[160px_1fr_150px_160px_130px_72px]">
          <span>Kategoriya</span><span>Mahsulot</span><span>Miqdor</span><span>Narx</span><span className="text-right">Summa</span><span />
        </div>
        <div className="space-y-2">
          {rows.map((r, idx) => {
            const list = byCategory.get(r.category) ?? [];
            const picked = materials.find((m) => m.id === r.materialId);
            const unit = r.isNew ? r.unit : picked?.unit ?? "";
            return (
              <div key={r.key} className="space-y-2 rounded-lg border border-slate-100 p-2 lg:grid lg:grid-cols-[160px_1fr_150px_160px_130px_72px] lg:items-center lg:gap-2 lg:space-y-0 lg:border-0 lg:p-0">
                <Select aria-label="Kategoriya" value={r.category} onChange={(e) => {
                  const c = e.target.value as MaterialCategory;
                  // Boshqa kategoriyadagi tanlangan mahsulot tushib qoladi — ro'yxat shu kategoriyaga torayadi
                  update(r.key, { category: c, materialId: picked && picked.category !== c ? "" : r.materialId });
                }}>
                  {MATERIAL_CATEGORY_OPTIONS.map(([c, label]) => <option key={c} value={c}>{label}</option>)}
                </Select>
                <div className="flex gap-2">
                  <div className="min-w-0 flex-1">
                    {r.isNew ? (
                      <div className="flex gap-2">
                        <Input aria-label="Yangi mahsulot nomi" value={r.name} onChange={(e) => update(r.key, { name: e.target.value })} placeholder={`Yangi: ${MATERIAL_CATEGORY_LABEL[r.category].toLowerCase()} nomi`} />
                        <Select aria-label="Birlik" className="w-24" value={r.unit} onChange={(e) => update(r.key, { unit: e.target.value })}>
                          {MATERIAL_UNITS.map((u) => <option key={u} value={u}>{unitLabel(u)}</option>)}
                        </Select>
                      </div>
                    ) : (
                      <MaterialField materials={list} groups={groups} value={r.materialId} placeholder={`${MATERIAL_CATEGORY_LABEL[r.category]} — nomi yoki kodi`}
                        onPick={(m) => update(r.key, { materialId: m.id, price: r.price || (m.price ? String(Math.round(m.price)) : "") })} />
                    )}
                  </div>
                  <button type="button" onClick={() => update(r.key, { isNew: !r.isNew, materialId: "", name: r.isNew ? "" : r.name })}
                    title={r.isNew ? "Spravochnikdan tanlash" : "Spravochnikda yo'q — yangi mahsulot"}
                    className={`flex h-10 shrink-0 items-center gap-1 rounded-lg border px-2 text-xs font-medium ${r.isNew ? "border-brand-300 bg-brand-50 text-brand-700" : "border-slate-200 text-slate-500 hover:bg-slate-50"}`}>
                    <PackagePlus size={14} /> Yangi
                  </button>
                </div>
                <div className="grid grid-cols-[1fr_auto] items-center gap-2">
                  <Input aria-label="Miqdor" type="number" step="0.001" min="0" placeholder="Miqdor" value={r.qty} onChange={(e) => update(r.key, { qty: e.target.value })} />
                  <span className="w-8 text-sm text-slate-500">{unitLabel(unit)}</span>
                </div>
                <MoneyInput ariaLabel="Narx" value={r.price} onChange={(v) => update(r.key, { price: v })} placeholder="Narx" suffix={null} />
                <div className="text-right text-sm font-medium tabular text-slate-800">
                  {fmtNum(sumOf(r))}
                  {dupIds.has(r.materialId) && <div className="text-xs font-normal text-amber-600">Ikki marta kiritilgan</div>}
                </div>
                <div className="flex justify-end gap-1">
                  <button type="button" aria-label="Qatordan nusxa" title="Nusxa (shu kategoriya bilan yangi qator)" onClick={() => setRows((rs) => [...rs.slice(0, idx + 1), { ...blank(r.category), isNew: r.isNew, unit: r.unit }, ...rs.slice(idx + 1)])}
                    className="flex h-10 w-8 items-center justify-center text-slate-400 hover:text-slate-700"><CopyPlus size={16} /></button>
                  <button type="button" aria-label="Qatorni o'chirish" onClick={() => setRows((rs) => (rs.length > 1 ? rs.filter((x) => x.key !== r.key) : rs))}
                    className="flex h-10 w-8 items-center justify-center text-slate-400 hover:text-red-600"><X size={16} /></button>
                </div>
              </div>
            );
          })}
        </div>
        <button type="button" onClick={() => setRows((rs) => [...rs, blank(rs[rs.length - 1]?.category)])} className="mt-2 text-sm font-medium hover:underline">
          <span className="inline-flex items-center gap-1"><Plus size={14} /> Qator qo&apos;shish</span>
        </button>
        <div className="mt-3 text-right">
          <div className="text-xs text-slate-500">{rows.filter((r) => r.materialId || r.name.trim()).length} qator · QQS&apos;siz</div>
          <div className="text-lg font-semibold text-slate-900 tabular">Jami: {fmtNum(total)} so&apos;m</div>
        </div>
      </div>

      <Field label="Izoh skladga"><Textarea name="note" defaultValue={initial.note} placeholder="Masalan: 2 qop yirtilgan, sertifikat mashinada…" /></Field>

      <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
        «Skladga jo&apos;natish» bosilgach sklad xodimlariga bildirishnoma boradi. Sklad qabul qilgan qatorlar kirim bo&apos;lib qoldiqqa tushadi,
        to&apos;lov esa Kirim-Chiqimdagi «To&apos;lanmagan kirimlar»ga o&apos;tadi. Spravochnikda yo&apos;q mahsulot qabulda shu nom va kategoriya bilan ochiladi.
      </div>

      <FormActions>
        <Button name="intent" value="send" disabled={pending}><Send size={16} /> {pending ? "Yuborilmoqda…" : "Skladga jo'natish"}</Button>
        <Button name="intent" value="draft" variant="secondary" disabled={pending}><Save size={16} /> Qoralama saqlash</Button>
        <LinkButton href={initial.id ? `/jonatma/${initial.id}` : "/jonatma"} variant="ghost">Bekor</LinkButton>
      </FormActions>
    </form>
  );
}
