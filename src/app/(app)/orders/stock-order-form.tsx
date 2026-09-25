"use client";

import { X, Plus, Boxes, Zap, TriangleAlert, Sparkles, Factory } from "lucide-react";
import { useActionState, useMemo, useState } from "react";
import { fmtNum, isoDate } from "@/lib/format";
import { createStockOrder } from "./actions";
import { Badge, Button, Callout, Field, FormError, Input, LinkButton, Textarea, FormActions, Checkbox } from "@/components/ui";
import { ProductPicker, type CatalogGroup, type CatalogProduct } from "@/components/product-picker";
import { ProductField } from "@/components/product-field";
import type { ProductStock } from "./order-form";
import { cn } from "@/lib/utils";

type Row = { key: number; productId: string; qty: string };

/**
 * Sklad zayavkasi — zaxiraga ishlab chiqarish. Mijoz ham, narx ham, manzil ham yo'q:
 * "shu mahsulotdan shuncha ishlab chiqarilib, hovliga qo'yib qo'yilsin".
 *
 * Faqat dona mahsulot: beton zakaz olingandan keyin tayyorlanadi, zaxira qilib
 * qo'yib bo'lmaydi — shuning uchun ro'yxat `pieceOnly` bilan yuklanadi.
 */
export function StockOrderForm({ products, groups, canCreateProduct, stock }: {
  products: CatalogProduct[];
  groups: CatalogGroup[];
  canCreateProduct: boolean;
  stock: ProductStock;
}) {
  const [state, action, pending] = useActionState(createStockOrder, undefined);
  const [rows, setRows] = useState<Row[]>([{ key: 1, productId: "", qty: "" }]);
  const [pickFor, setPickFor] = useState<number | null>(null);

  const update = (key: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const addRow = (productId = "", qty = "") => setRows((rs) => [...rs, { key: Date.now() + rs.length, productId, qty }]);
  /** Bir mahsulot ikki marta yozilmasin — bo'lsa o'sha qatorga olib boriladi. */
  const pickProduct = (key: number, productId: string) => {
    if (rows.some((r) => r.key !== key && r.productId === productId)) return;
    update(key, { productId });
  };

  // Mahsulot yonidagi izoh: hovlida erkin nechta bor va xomashyodan yana qancha chiqadi
  const stockHint = (p: CatalogProduct) => {
    const st = stock[p.id];
    if (!st) return null;
    return `erkin ${fmtNum(st.free)}${st.canMake != null ? `, yana ${fmtNum(st.canMake)}` : ""} ${p.unit}`;
  };

  /**
   * "Zaxira kerak" tavsiyasi: hovlida erkin qoldig'i tugagan yoki band qilingandan
   * kam qolgan mahsulotlar. Bosilsa qatorga qo'shiladi — miqdori band qismiga tenglanadi.
   */
  const suggestions = useMemo(() => {
    return products
      .map((p) => ({ p, st: stock[p.id] }))
      .filter((x): x is { p: CatalogProduct; st: NonNullable<ProductStock[string]> } => !!x.st && x.st.kind === "piece")
      .filter(({ st }) => st.free <= 0 || st.free < st.owned)
      .sort((a, b) => a.st.free - b.st.free || b.st.owned - a.st.owned)
      .slice(0, 6);
  }, [products, stock]);

  const used = new Set(rows.map((r) => r.productId).filter(Boolean));
  const filled = rows.filter((r) => r.productId && Number(r.qty) > 0);
  // Zaxiraga nima qo'shilishi — birligi bo'yicha alohida (dona va m² qo'shilmaydi)
  const totals = useMemo(() => {
    const by = new Map<string, number>();
    for (const r of filled) {
      const u = products.find((p) => p.id === r.productId)?.unit ?? "dona";
      by.set(u, (by.get(u) ?? 0) + Number(r.qty));
    }
    return [...by].map(([u, n]) => `${fmtNum(n)} ${u}`).join(" · ");
  }, [filled, products]);

  // Xomashyosi yetmaydigan qatorlar — saqlashga to'sqinlik qilmaydi, ogohlantiradi
  const short = filled.filter((r) => {
    const st = stock[r.productId];
    return st?.canMake != null && st.canMake < Number(r.qty);
  });
  const noRecipe = filled.filter((r) => stock[r.productId]?.canMake == null);
  const tomorrow = isoDate(new Date(Date.now() + 86400000));

  return (
    <form action={action} className="space-y-5 rounded-(--radius-card) border border-slate-200/80 bg-white p-6 shadow-(--shadow-card)">
      <FormError error={state?.error} />

      <Callout tone="info" title="Sklad zayavkasi — zaxiraga">
        Mijoz uchun emas, o&apos;zimiz uchun: ishlab chiqarilgan mahsulot hovlida <b>erkin qoldiq</b> bo&apos;lib turadi va keyin kelgan
        har qanday mijozga darhol beriladi. Narx, dastavka va shartnoma so&apos;ralmaydi. Zayavka qabul qilingach Ishlab chiqarish
        bo&apos;limida brigadaga tayinlanadi.
      </Callout>

      {/* ── Tavsiya: nimaga zaxira kerak ── */}
      {suggestions.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-3">
          <div className="mb-2 inline-flex items-center gap-1.5 text-[13px] font-medium text-amber-900">
            <Sparkles size={14} /> Zaxira kerak bo&apos;lishi mumkin
          </div>
          <div className="flex flex-wrap gap-1.5">
            {suggestions.map(({ p, st }) => {
              const need = Math.max(0, st.owned - st.free); // band qilingandan yetishmaydigan qism
              return (
                <button
                  key={p.id}
                  type="button"
                  disabled={used.has(p.id)}
                  onClick={() => {
                    const empty = rows.find((r) => !r.productId);
                    if (empty) update(empty.key, { productId: p.id, qty: need > 0 ? String(need) : "" });
                    else addRow(p.id, need > 0 ? String(need) : "");
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-amber-100 disabled:opacity-40"
                >
                  <Plus size={12} /> {p.name}
                  <span className="font-normal text-slate-500">erkin {fmtNum(st.free)}{st.owned > 0 && ` · band ${fmtNum(st.owned)}`}</span>
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-xs text-amber-800">Hovlida erkin qoldig&apos;i tugagan yoki band qilingandan kam qolgan mahsulotlar.</p>
        </div>
      )}

      {/* ── Mahsulotlar ── */}
      <div>
        <div className="mb-2 text-sm font-medium text-slate-700">Nima ishlab chiqariladi *</div>
        <div className="space-y-2">
          {rows.map((r) => {
            const p = products.find((x) => x.id === r.productId);
            const st = stock[r.productId];
            const unit = p?.unit ?? "dona";
            const need = Number(r.qty) || 0;
            const canMake = st?.canMake ?? null;
            const enough = canMake == null ? null : canMake >= need;
            return (
              <div key={r.key} className="space-y-1.5 rounded-lg border border-slate-100 p-2 sm:border-0 sm:p-0">
                <div className="space-y-2 sm:grid sm:grid-cols-[1fr_140px_40px] sm:items-center sm:gap-2 sm:space-y-0">
                  <div>
                    <input type="hidden" name="productId[]" value={r.productId} />
                    <ProductField
                      products={products}
                      value={r.productId}
                      onPick={(id) => pickProduct(r.key, id)}
                      onOpenPicker={() => setPickFor(r.key)}
                      hint={stockHint}
                    />
                  </div>
                  <span className="relative block">
                    <Input name="qty[]" type="number" step="1" min="1" placeholder="Miqdori" value={r.qty}
                      onChange={(e) => update(r.key, { qty: e.target.value })} required
                      className="pr-14 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" />
                    <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs text-slate-400">{unit}</span>
                  </span>
                  <button type="button" onClick={() => setRows((rs) => (rs.length > 1 ? rs.filter((x) => x.key !== r.key) : rs))}
                    className="flex h-10 w-10 items-center justify-center text-slate-400 hover:text-red-600" aria-label="O'chirish"><X size={16} /></button>
                </div>

                {st && (
                  <div className={cn("text-xs", enough === false ? "text-red-600" : "text-slate-500")}>
                    <>Hovlida erkin: <b>{fmtNum(st.free)} {unit}</b> (jami {fmtNum(st.total)}, band {fmtNum(st.owned)})</>
                    {canMake == null
                      ? <span className="text-amber-700"> · retsept kiritilmagan — zames qilib bo&apos;lmaydi</span>
                      : <span> · xomashyodan <b>{fmtNum(canMake)} {unit}</b> chiqadi
                          {need > 0 && (enough
                            ? <span className="text-emerald-700"> — {fmtNum(need)} {unit} ga yetadi, zaxira {fmtNum(st.free + need)} {unit} bo&apos;ladi</span>
                            : <span> — yetmaydi: yana {fmtNum(need - canMake)} {unit} lik xomashyo kerak</span>)}
                        </span>}
                    {st.by && <span className="text-slate-400"> · kiritgan: {st.by}</span>}
                  </div>
                )}
                {r.productId && !st && <div className="text-xs text-slate-400">Bu mahsulot bo&apos;yicha sklad ma&apos;lumoti yo&apos;q.</div>}
              </div>
            );
          })}
        </div>
        <button type="button" onClick={() => addRow()} className="mt-2 text-sm font-medium text-slate-700 hover:underline">
          <span className="inline-flex items-center gap-1"><Plus size={14} /> Qator qo&apos;shish</span>
        </button>

        {totals && (
          <div className="mt-3 flex items-center justify-end gap-2 text-base font-semibold">
            <Boxes size={16} className="text-slate-400" /> Zaxiraga qo&apos;shiladi: {totals}
          </div>
        )}

        <ProductPicker
          open={pickFor !== null}
          products={products}
          groups={groups}
          canCreate={canCreateProduct}
          onClose={() => setPickFor(null)}
          onPick={(id) => { if (pickFor !== null) pickProduct(pickFor, id); }}
          hint={stockHint}
        />
      </div>

      {short.length > 0 && (
        <Callout tone="warning" title="Xomashyo yetmaydi">
          {short.map((r) => products.find((p) => p.id === r.productId)?.name).filter(Boolean).join(", ")} — hozirgi xomashyo qoldig&apos;i bilan
          so&apos;ralgan miqdor chiqmaydi. Zayavkani baribir ochish mumkin: xomashyo kelgach ishlab chiqariladi.
        </Callout>
      )}
      {noRecipe.length > 0 && (
        <Callout tone="warning" title="Retsept yo'q">
          {noRecipe.map((r) => products.find((p) => p.id === r.productId)?.name).filter(Boolean).join(", ")} uchun faol retsept kiritilmagan —
          zames qilib bo&apos;lmaydi. <b>Retseptlar</b> bo&apos;limidan kiriting.
        </Callout>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Tayyor bo'lish muddati *" hint="Shu sanaga zaxira hovlida turishi kerak">
          <Input name="dueDate" type="date" defaultValue={tomorrow} required />
        </Field>
        <div className="flex flex-col justify-end gap-2 pb-1">
          <Checkbox name="isUrgent" label="Zarur (shoshilinch)" />
          <span className="-mt-1 text-xs text-slate-500">Brigada topshiriqlarida birinchi turadi</span>
        </div>
      </div>

      <Field label="Izoh" hint="Nega zaxira kerak: kutilayotgan buyurtma, mavsum, obyekt nomi">
        <Textarea name="note" />
      </Field>

      <div className="flex flex-wrap gap-2 text-xs text-slate-500">
        <span className="inline-flex items-center gap-1"><Factory size={13} /> Qabul qilingach brigadaga tayinlanadi</span>
        <span className="inline-flex items-center gap-1"><Boxes size={13} /> Tayyor mahsulot hech kimga band qilinmaydi</span>
        <span className="inline-flex items-center gap-1"><Zap size={13} /> Zarur — brigadalar uchun ustuvorlik</span>
      </div>

      <FormActions>
        <Button disabled={pending || filled.length === 0}>{pending ? "Saqlanmoqda…" : "Saqlash (qoralama)"}</Button>
        <LinkButton href="/orders" variant="secondary">Bekor</LinkButton>
        {filled.length === 0 && <span className="inline-flex items-center gap-1 text-xs text-slate-500"><TriangleAlert size={14} /> Mahsulot va miqdorini kiriting</span>}
        {products.length === 0 && <Badge color="red">Dona mahsulot yo&apos;q — avval spravochnikka qo&apos;shing</Badge>}
      </FormActions>
    </form>
  );
}
