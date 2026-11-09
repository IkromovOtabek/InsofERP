"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays, Pencil, Plus, Split, X } from "lucide-react";
import { addStock } from "../actions";
import { ProductSelect } from "@/components/product-select";
import { NewProductForm, RenameProductForm } from "@/components/catalog-tools";
import type { CatalogGroup, CatalogProduct } from "@/components/product-picker";
import { Button, Field, FormActions, FormError, Input, LinkButton, Select, Textarea } from "@/components/ui";
import { blockEnterSubmit, submitKeepingState } from "../../../orders/order-form";
import { fmtNum } from "@/lib/format";
import type { ProductCreate } from "@/lib/catalog";
import { cn } from "@/lib/utils";

type Opt = { id: string; name: string };
/** `brigadeId`: brigada id, «umumiy» — umumiy hovli (brigadasiz), bo'sh — hali tanlanmagan */
type Row = { key: number; productId: string; brigadeId: string; qty: string };
/** Umumiy hovli qiymati (server `null` qiladi) */
const COMMON = "umumiy";

/** Tugmalar formaga `form` atributi bilan bog'lanadi: spravochnik kartalari (o'z formasi bor) orada turadi, forma ichida forma bo'lmaydi */
const FORM_ID = "add-stock-form";

/**
 * Hovliga tayyor mahsulot kirimi — bir nechta qator, bitta sana va sklad bilan (hammasi bitta tranzaksiyada yoziladi).
 * Qatorlar ostida — zayavkadagi spravochnik kartasi bilan bir xil «Yangi mahsulot» va faol qator mahsulotining
 * «Nomini tahrirlash». Yangi mahsulot yozilgach darrov faol qatorga tanlanadi.
 */
export function AddForm({ products, groups, canCreateProduct, warehouses, brigades, clientToken, today, minDate }: {
  products: CatalogProduct[];
  groups: CatalogGroup[];
  /** true — to'liq spravochnik; "add" — tanlagichda faqat Yangi/Papka, pastdagi «Yangi mahsulot» va «Nomini tahrirlash» ikkalasida ham bor */
  canCreateProduct: ProductCreate;
  warehouses: Opt[];
  /** Faol brigadalar (brigadir bilan) — har qator qaysi brigada omboriga tushishi */
  brigades: Opt[];
  /** Sahifa ochilganda server bergan bir martalik kalit — ikki marta bosish ikkinchi kirim yozmaydi */
  clientToken?: string;
  /** Server sanasi (YYYY-MM-DD): bugun va eng eski ruxsat etilgan kun */
  today: string;
  minDate: string;
}) {
  const router = useRouter();
  const [state, action, pending] = useActionState(addStock, undefined);
  const nextKey = useRef(2);
  const [rows, setRows] = useState<Row[]>([{ key: 1, productId: products[0]?.id ?? "", brigadeId: "", qty: "" }]);
  // Faol qator — «Nomini tahrirlash» shu qator mahsulotiga, yangi mahsulot shu qatorga tushadi
  const [active, setActive] = useState(1);
  const [card, setCard] = useState<"new" | "rename" | null>(null);
  const [groupId, setGroupId] = useState("");
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const activeRow = rows.find((r) => r.key === active) ?? rows[rows.length - 1]!;
  const selected = byId.get(activeRow.productId) ?? null;

  const update = (key: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const addRow = () => {
    const key = nextKey.current++;
    // Yangi qator oldingi qatordagi mahsulot papkasidan boshlanmaydi — bo'sh tanlov xato bermasin, birinchi mahsulot turadi;
    // brigada — oxirgi qatordagidek (bir brigada chiqargan bir nechta mahsulot ketma-ket kiritiladi)
    setRows((rs) => [...rs, { key, productId: products[0]?.id ?? "", brigadeId: rs[rs.length - 1]?.brigadeId ?? "", qty: "" }]);
    setActive(key);
  };
  /** Shu mahsulotni yana bir brigadaga — qator ostida xuddi shu mahsulot bilan yangi qator (brigadasi keyingisi) */
  const splitRow = (key: number) => {
    const nk = nextKey.current++;
    setRows((rs) => {
      const i = rs.findIndex((r) => r.key === key);
      const src = rs[i]!;
      const used = new Set(rs.filter((r) => r.productId === src.productId).map((r) => r.brigadeId));
      const next = brigades.find((b) => !used.has(b.id))?.id ?? "";
      return [...rs.slice(0, i + 1), { key: nk, productId: src.productId, brigadeId: next, qty: "" }, ...rs.slice(i + 1)];
    });
    setActive(nk);
  };
  const removeRow = (key: number) => {
    setRows((rs) => rs.filter((r) => r.key !== key));
    if (active === key) setActive(rows.find((r) => r.key !== key)?.key ?? 1);
  };

  // Yangi mahsulot saqlangach sahifa yangilanadi — ro'yxatda paydo bo'lgan yagona yangi mahsulot faol qatorga tanlanadi
  const known = useRef(new Set(products.map((p) => p.id)));
  const awaitNew = useRef<number | null>(null);
  useEffect(() => {
    const fresh = products.filter((p) => !known.current.has(p.id));
    known.current = new Set(products.map((p) => p.id));
    if (awaitNew.current !== null && fresh.length === 1) { const key = awaitNew.current; setRows((rs) => rs.map((r) => (r.key === key ? { ...r, productId: fresh[0]!.id } : r))); }
    if (fresh.length) awaitNew.current = null;
  }, [products]);

  // Papka tanlovi: «Plita / PK» ko'rinishidagi to'liq yo'l bilan
  const folders = useMemo(() => {
    const g = new Map(groups.map((x) => [x.id, x]));
    const path = (x: CatalogGroup): string => { const p = x.parentId ? g.get(x.parentId) : undefined; return p ? `${path(p)} / ${x.name}` : x.name; };
    return groups.map((x) => ({ id: x.id, label: path(x) })).sort((a, b) => a.label.localeCompare(b.label));
  }, [groups]);
  const folderName = folders.find((f) => f.id === groupId)?.label ?? null;

  const toggleNew = () => { setGroupId(selected?.groupId ?? ""); setCard((c) => (c === "new" ? null : "new")); };
  const done = (created: boolean) => { awaitNew.current = created ? activeRow.key : null; setCard(null); router.refresh(); };

  // Jami — faqat bir xil birlikdagi qatorlar bo'lsa (dona va m² qo'shilmaydi)
  const units = new Set(rows.map((r) => byId.get(r.productId)?.unit ?? "dona"));
  const totalQty = rows.reduce((s, r) => s + (Number(r.qty) || 0), 0);
  const ready = rows.every((r) => r.productId && r.brigadeId);
  // Brigadalar bo'yicha jami (bir xil birlikda) — qaysi omborga qancha tushayotgani
  const brigadeName = new Map([...brigades.map((b) => [b.id, b.name] as const), [COMMON, "Umumiy hovli"] as const]);
  const byBrigade = new Map<string, number>();
  for (const r of rows) if (r.brigadeId && Number(r.qty) > 0) byBrigade.set(r.brigadeId, (byBrigade.get(r.brigadeId) ?? 0) + Number(r.qty));

  return (
    <div className="max-w-4xl space-y-5 rounded-(--radius-card) border border-slate-200/80 bg-white p-6 shadow-(--shadow-card)">
      <FormError error={state?.error} />
      {/* Xato qaytsa ham kiritilgani o'chmasin — yuborish onSubmit orqali (React 19 `<form action>` formani tozalaydi) */}
      <form id={FORM_ID} onSubmit={submitKeepingState(action)} onKeyDown={blockEnterSubmit} className="space-y-5">
        {clientToken && <input type="hidden" name="clientToken" value={clientToken} />}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Sana *" hint="Kirim shu kunga yoziladi: bugun yoki o'tgan 31 kun ichida">
            <div className="relative">
              <CalendarDays size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-slate-400" />
              <Input name="date" type="date" defaultValue={today} max={today} min={minDate} required className="pl-9" />
            </div>
          </Field>
          <Field label="Sklad *"><Select name="warehouseId" defaultValue={warehouses[0]?.id}>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</Select></Field>
        </div>

        <div>
          <div className="mb-1.5 flex items-baseline justify-between gap-3">
            <span className="text-[13px] font-medium text-slate-700">Mahsulotlar *</span>
            <span className="text-xs text-slate-500">Nomini yozing yoki «…» tugmasidan ro&apos;yxatdan tanlang</span>
          </div>
          <div className="overflow-hidden rounded-lg border border-slate-200">
            <div className="hidden grid-cols-[32px_minmax(0,1fr)_200px_120px_76px] gap-2 border-b border-slate-200 bg-slate-50 px-2 py-1.5 text-xs font-medium text-slate-500 sm:grid">
              <span className="text-center">№</span><span>Mahsulot</span><span>Qaysi brigadaga</span><span>Miqdor</span><span />
            </div>
            {rows.map((r, i) => {
              const unit = byId.get(r.productId)?.unit ?? "dona";
              return (
                <div key={r.key} onFocusCapture={() => setActive(r.key)}
                  className={cn("grid grid-cols-[32px_minmax(0,1fr)_76px] items-center gap-2 border-b border-slate-100 px-2 py-2 last:border-b-0 sm:grid-cols-[32px_minmax(0,1fr)_200px_120px_76px]", r.key === activeRow.key && rows.length > 1 && "bg-brand-50/40")}>
                  <span className="text-center text-sm text-slate-400 tabular">{i + 1}</span>
                  <div className="min-w-0">
                    <input type="hidden" name="productId[]" value={r.productId} />
                    <ProductSelect products={products} groups={groups} canCreate={canCreateProduct} value={r.productId}
                      onChange={(id) => { update(r.key, { productId: id }); setActive(r.key); if (card === "rename") setCard(null); }} />
                  </div>
                  <div className="col-start-2 sm:col-start-3">
                    <Select name="brigadeId[]" value={r.brigadeId} required aria-label={`${i + 1}-qator brigadasi`}
                      onChange={(e) => update(r.key, { brigadeId: e.target.value })} className={cn(!r.brigadeId && "text-slate-400")}>
                      <option value="" disabled>Brigadani tanlang</option>
                      {brigades.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                      <option value={COMMON}>Umumiy hovli (brigadasiz)</option>
                    </Select>
                  </div>
                  <div className="relative col-start-2 sm:col-start-4">
                    <Input name="qty[]" type="number" step="1" min="1" placeholder="0" required aria-label={`${i + 1}-qator miqdori`} value={r.qty} autoFocus={i === 0}
                      onChange={(e) => update(r.key, { qty: e.target.value })}
                      className="pr-14 text-right [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" />
                    <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs text-slate-400">{unit}</span>
                  </div>
                  <div className="col-start-3 row-start-1 flex justify-end sm:col-start-5 sm:row-start-auto">
                    <button type="button" onClick={() => splitRow(r.key)} aria-label={`${i + 1}-qatordagi mahsulotni yana bir brigadaga bo'lish`} title="Shu mahsulotni yana bir brigadaga bo'lish"
                      className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 hover:bg-brand-50 hover:text-brand-700"><Split size={16} /></button>
                    {rows.length > 1 && (
                      <button type="button" onClick={() => removeRow(r.key)} aria-label={`${i + 1}-qatorni o'chirish`}
                        className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600"><X size={16} /></button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <Button type="button" size="sm" variant="secondary" onClick={addRow}><Plus size={15} /> Qator qo&apos;shish</Button>
            <span className="text-sm text-slate-500">{rows.length} qator{units.size === 1 && totalQty > 0 && <> · jami <b className="tabular text-slate-900">{fmtNum(totalQty)}</b> {[...units][0]}</>}</span>
          </div>
          {byBrigade.size > 1 && units.size === 1 && (
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-600">
              {[...byBrigade.entries()].map(([id, q]) => <span key={id}>{brigadeName.get(id) ?? "Brigada"}: <b className="tabular text-slate-900">{fmtNum(q)}</b> {[...units][0]}</span>)}
            </div>
          )}
        </div>
      </form>

      {/* Spravochnik: o'z formasi bilan — shuning uchun asosiy formadan tashqarida */}
      {canCreateProduct && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" variant={card === "new" ? "primary" : "ghost"} onClick={toggleNew}><Plus size={15} /> Yangi mahsulot</Button>
            {selected && (
              <Button type="button" size="sm" variant="ghost" onClick={() => setCard((c) => (c === "rename" ? null : "rename"))}><Pencil size={14} /> Nomini tahrirlash{rows.length > 1 && <span className="font-normal text-slate-500">· {rows.findIndex((r) => r.key === activeRow.key) + 1}-qator</span>}</Button>
            )}
          </div>
          {card === "new" && (
            <div className="space-y-3 rounded-xl border border-blue-200 bg-blue-50/60 p-4">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <h3 className="text-sm font-semibold text-slate-900">Yangi mahsulot — spravochnikka qo&apos;shiladi{rows.length > 1 && ` va ${rows.findIndex((r) => r.key === activeRow.key) + 1}-qatorga tanlanadi`}</h3>
                <label className="flex items-center gap-2 text-xs text-slate-600">Papka
                  <Select value={groupId} onChange={(e) => setGroupId(e.target.value)} className="h-8 w-56">
                    <option value="">Ro&apos;yxat ildizi</option>
                    {folders.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
                  </Select>
                </label>
              </div>
              <NewProductForm ctx={{ groupId: groupId || null, groupName: folderName, query: "" }} onDone={() => done(true)} onCancel={() => setCard(null)} />
            </div>
          )}
          {card === "rename" && selected && (
            <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-4">
              <RenameProductForm key={selected.id} product={selected} onDone={() => done(false)} onCancel={() => setCard(null)} />
            </div>
          )}
        </div>
      )}

      <Field label="Izoh" hint="Masalan: 17.09 smena, qolipdan chiqarildi"><Textarea name="note" form={FORM_ID} /></Field>
      <FormActions>
        <Button type="submit" form={FORM_ID} disabled={pending || !ready}><Plus size={16} /> {pending ? "Yozilmoqda…" : rows.length > 1 ? `Qo'shish (${rows.length} qator)` : "Qo'shish"}</Button>
        <LinkButton href="/stock?tab=capacity" variant="secondary">Bekor</LinkButton>
      </FormActions>
    </div>
  );
}
