"use client";

import { useActionState, useMemo, useState } from "react";
import { Plus, Trash2, Truck, Construction, Search, X } from "lucide-react";
import { Button, Checkbox, Field, FormActions, FormError, Input, Select, Textarea, inputCls } from "@/components/ui";
import { MoneyInput } from "@/components/money-input";
import { ProductSelect } from "@/components/product-select";
import type { CatalogGroup, CatalogProduct } from "@/components/product-picker";
import { Fold } from "@/components/fold";
import { fmtNum, money } from "@/lib/format";
import { OFFER_UNITS, offerTotals } from "@/lib/offer-calc";
import { createOfferAction } from "./actions";

export type OfferCustomerOpt = { id: string; name: string; phone: string | null; inn: string | null; address: string | null };
export type OfferProduct = CatalogProduct & { rawUnit: string };
export type OfferRowPrefill = { productId?: string | null; name: string; unit: string; qty: number; price: number };
export type OfferPrefill = {
  customerId?: string | null; clientName?: string | null; clientPhone?: string | null; clientInn?: string | null;
  objectName?: string | null; note?: string | null; orderId?: string | null; leadId?: string | null; items?: OfferRowPrefill[];
};
export type OfferDefaults = { intro: string; terms: string; validDays: number; withVat: boolean };

type Row = { key: number; productId: string; name: string; unit: string; qty: string; price: string };

const SERVICES: { label: string; name: string; unit: string; icon: typeof Truck }[] = [
  { label: "Yetkazib berish", name: "Yetkazib berish (dostavka)", unit: "reys", icon: Truck },
  { label: "Avtokran", name: "Avtokran xizmati", unit: "mash_soat", icon: Construction },
];

const plusDays = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

/** Mijoz tanlash — bazadagi karta (nomi, telefoni, INN qidiruv bilan) yoki erkin kiritish. */
function CustomerPick({ customers, value, onChange }: { customers: OfferCustomerOpt[]; value: OfferCustomerOpt | null; onChange: (c: OfferCustomerOpt | null) => void }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (t ? customers.filter((c) => [c.name, c.phone ?? "", c.inn ?? ""].some((x) => x.toLowerCase().includes(t))) : customers).slice(0, 30);
  }, [customers, q]);
  return (
    <div className="relative">
      <input type="hidden" name="customerId" value={value?.id ?? ""} />
      {value ? (
        <div className="flex h-10 items-center justify-between gap-2 rounded-lg border border-slate-300 bg-slate-50 px-3 text-sm">
          <span className="truncate font-medium">{value.name}</span>
          <button type="button" onClick={() => onChange(null)} className="text-slate-500 hover:text-slate-900" aria-label="Mijozni olib tashlash"><X size={14} /></button>
        </div>
      ) : (
        <div className="relative">
          <Search size={15} className="pointer-events-none absolute top-3 left-3 text-slate-400" />
          <input value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)} placeholder="Bazadagi mijozni qidirish (ixtiyoriy)" className={`${inputCls} pl-9`} />
        </div>
      )}
      {open && !value && list.length > 0 && (
        <ul className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-slate-200 bg-white py-1 text-sm shadow-lg">
          {list.map((c) => (
            <li key={c.id}>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => { onChange(c); setOpen(false); setQ(""); }} className="flex w-full flex-col items-start px-3 py-1.5 text-left hover:bg-slate-50">
                <span className="font-medium">{c.name}</span>
                <span className="text-xs text-slate-500">{[c.inn && `INN ${c.inn}`, c.phone].filter(Boolean).join(" · ") || "—"}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Tijorat taklifi formasi. Mijoz bazadan tanlanishi shart emas — nom/telefon erkin kiritiladi
 * (hali zayavka ham, mijoz kartasi ham yo'q xaridor uchun). Qatorlar: katalog mahsuloti
 * (narx va birlik katalogdan keladi, tahrirlanadi) yoki xizmat (dostavka, avtokran).
 * Narxlar QQS'siz kiritiladi; «QQS 12%» belgilansa jadvalda soliq alohida ko'rinadi.
 */
export function OfferForm({ customers, products, groups, defaults, prefill, canCreateProduct }: {
  customers: OfferCustomerOpt[]; products: OfferProduct[]; groups: CatalogGroup[]; defaults: OfferDefaults; prefill?: OfferPrefill; canCreateProduct: boolean;
}) {
  const [state, action, pending] = useActionState(createOfferAction, undefined);
  const [customer, setCustomer] = useState<OfferCustomerOpt | null>(customers.find((c) => c.id === prefill?.customerId) ?? null);
  const [clientName, setClientName] = useState(prefill?.clientName ?? customer?.name ?? "");
  const [clientPhone, setClientPhone] = useState(prefill?.clientPhone ?? customer?.phone ?? "");
  const [clientInn, setClientInn] = useState(prefill?.clientInn ?? customer?.inn ?? "");
  const [withVat, setWithVat] = useState(defaults.withVat);
  const [advance, setAdvance] = useState("");
  const [rows, setRows] = useState<Row[]>(() => {
    const init = prefill?.items?.length ? prefill.items : [{ productId: products[0]?.id ?? null, name: products[0]?.name ?? "", unit: products[0]?.rawUnit ?? "dona", qty: 0, price: Number(products[0]?.price ?? 0) }];
    return init.map((r, i) => ({ key: i + 1, productId: r.productId ?? "", name: r.name, unit: r.unit, qty: r.qty ? String(r.qty) : "", price: String(r.price) }));
  });
  const [seq, setSeq] = useState(rows.length + 1);

  const pickCustomer = (c: OfferCustomerOpt | null) => {
    setCustomer(c);
    if (c) { setClientName(c.name); setClientPhone(c.phone ?? ""); setClientInn(c.inn ?? ""); }
  };
  const update = (key: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const addRow = (r: Partial<Row> = {}) => { setRows((rs) => [...rs, { key: seq, productId: "", name: "", unit: "dona", qty: "", price: "", ...r }]); setSeq((n) => n + 1); };
  const pickProduct = (key: number, productId: string) => {
    const p = products.find((x) => x.id === productId);
    if (p) update(key, { productId, name: p.name, unit: p.rawUnit, price: p.price });
  };

  const totals = offerTotals(rows.map((r) => ({ name: r.name, unit: r.unit, qty: Number(r.qty) || 0, price: Number(r.price) || 0 })), withVat, Number(advance) || 0);

  return (
    <form action={action} className="space-y-6">
      {prefill?.orderId && <input type="hidden" name="orderId" value={prefill.orderId} />}
      {prefill?.leadId && <input type="hidden" name="leadId" value={prefill.leadId} />}

      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Mijoz (bazadan)" hint="Tanlansa nom, telefon va INN o'zi to'ladi; bo'lmasa pastga qo'lda yozing" className="md:col-span-2">
          <CustomerPick customers={customers} value={customer} onChange={pickCustomer} />
        </Field>
        <Field label="Mijoz / tashkilot nomi">
          <Input name="clientName" value={clientName} onChange={(e) => setClientName(e.target.value)} required placeholder="Masalan: «Qurilish Invest» MChJ yoki Alisher aka" />
        </Field>
        <Field label="Telefon">
          <Input name="clientPhone" value={clientPhone} onChange={(e) => setClientPhone(e.target.value)} placeholder="+998 90 123 45 67" inputMode="tel" />
        </Field>
        <Field label="INN (ixtiyoriy)">
          <Input name="clientInn" value={clientInn} onChange={(e) => setClientInn(e.target.value)} placeholder="200 588 569" inputMode="numeric" />
        </Field>
        <Field label="Obyekt">
          <Input name="objectName" defaultValue={prefill?.objectName ?? customer?.address ?? ""} placeholder="Qurilish joyi, masalan: Yangiyo'l, 12-uy" />
        </Field>
        <Field label="Yetkazish muddati" hint="Erkin matn — hujjatda «Muddat» qatorida">
          <Input name="deadline" placeholder="Masalan: tasdiqlangandan keyin 10 kun ichida" />
        </Field>
        <Field label="Taklif amal qiladi (sanagacha)" hint={`Sozlamadagi standart: ${defaults.validDays} kun`}>
          <Input name="validUntil" type="date" defaultValue={plusDays(defaults.validDays)} min={plusDays(0)} required />
        </Field>
        <Field label="Hujjat tili">
          <Select name="lang" defaultValue="uz"><option value="uz">O'zbekcha</option><option value="ru">Ruscha (Русский)</option></Select>
        </Field>
        <div className="flex items-end pb-2"><Checkbox name="withVat" label="Narxlarga QQS 12% qo'shiladi (jadvalda alohida ustun)" checked={withVat} onChange={(e) => setWithVat(e.target.checked)} /></div>
      </div>

      {/* ── Qatorlar ── */}
      <div className="overflow-x-auto rounded-xl border border-slate-200">
        <table className="w-full min-w-[920px] text-sm">
          <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2 w-8">№</th>
              <th className="px-3 py-2">Mahsulot / xizmat</th>
              <th className="px-3 py-2 w-28">Birlik</th>
              <th className="px-3 py-2 w-28">Soni</th>
              <th className="px-3 py-2 w-40">Narxi{withVat ? " (QQS'siz)" : ""}</th>
              {withVat && <th className="px-3 py-2 text-right w-32">QQS bilan</th>}
              <th className="px-3 py-2 text-right w-36">Summa</th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r, i) => {
              const line = totals.lines[i]!;
              return (
                <tr key={r.key} className="align-top">
                  <td className="px-3 py-2 pt-4 text-slate-500">{i + 1}</td>
                  <td className="px-3 py-2">
                    <div className="space-y-1.5">
                      <ProductSelect products={products} groups={groups} canCreate={canCreateProduct} value={r.productId} onChange={(id) => pickProduct(r.key, id)} />
                      <input type="hidden" name="productId[]" value={r.productId} />
                      <Input name="name[]" value={r.name} onChange={(e) => update(r.key, { name: e.target.value })} placeholder="Hujjatdagi nomi (masalan: 2PK 39-10-8 A400)" required aria-label="Qator nomi" />
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    {OFFER_UNITS.some(([k]) => k === r.unit) ? (
                      <Select name="unit[]" value={r.unit} onChange={(e) => update(r.key, { unit: e.target.value })} aria-label="Birlik">{OFFER_UNITS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>
                    ) : (
                      <Input name="unit[]" value={r.unit} onChange={(e) => update(r.key, { unit: e.target.value })} aria-label="Birlik" />
                    )}
                  </td>
                  <td className="px-3 py-2"><Input name="qty[]" type="number" step="any" min="0.001" value={r.qty} onChange={(e) => update(r.key, { qty: e.target.value })} placeholder="0" required aria-label="Soni" /></td>
                  <td className="px-3 py-2"><MoneyInput name="price[]" value={r.price} onChange={(v) => update(r.key, { price: v })} placeholder="0" suffix={null} required ariaLabel="Narxi" /></td>
                  {withVat && <td className="px-3 py-2 pt-4 text-right tabular-nums text-slate-600">{fmtNum(line.grossUnit)}</td>}
                  <td className="px-3 py-2 pt-4 text-right font-medium tabular-nums">{fmtNum(line.gross)}</td>
                  <td className="px-2 py-2 pt-3"><button type="button" onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))} disabled={rows.length === 1} className="rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-30" aria-label="Qatorni o'chirish"><Trash2 size={15} /></button></td>
                </tr>
              );
            })}
          </tbody>
          <tfoot className="bg-slate-50 text-sm">
            <tr>
              <td colSpan={3} className="px-3 py-2">
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="secondary" size="sm" onClick={() => addRow()}><Plus size={14} /> Mahsulot qatori</Button>
                  {SERVICES.map((s) => <Button key={s.name} type="button" variant="ghost" size="sm" onClick={() => addRow({ name: s.name, unit: s.unit })}><s.icon size={14} /> {s.label}</Button>)}
                </div>
              </td>
              <td className="px-3 py-2 text-right font-medium tabular-nums">{fmtNum(totals.qty, 3)}</td>
              <td colSpan={withVat ? 3 : 2} className="px-3 py-2 text-right">
                {withVat && <div className="text-xs text-slate-500">QQS'siz {money(totals.net)} · QQS {money(totals.vat)}</div>}
                <div className="text-base font-semibold">Jami: {money(totals.gross)}</div>
              </td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Field label="Avans (kutilayotgan bosh to'lov)" hint={`Qoldiq: ${money(totals.rest)}`}>
          <MoneyInput name="advance" value={advance} onChange={setAdvance} placeholder="0" />
        </Field>
        <Field label="Ichki izoh" hint="Mijoz ko'rmaydi" className="md:col-span-2">
          <Input name="note" defaultValue={prefill?.note ?? ""} placeholder="Kelishuv tafsilotlari, kimdan kelgan…" />
        </Field>
      </div>

      <Fold title="Hujjat matnlari" hint="Kirish so'zi va shartlar — sozlamadagi standart; shu taklif uchun o'zgartirish mumkin">
        <div className="grid gap-4 pt-2">
          <Field label="Kirish matni (jadvaldan oldin)"><Textarea name="intro" rows={4} defaultValue={defaults.intro} /></Field>
          <Field label="Shartlar (jadvaldan keyin, har qatori alohida band)"><Textarea name="terms" rows={6} defaultValue={defaults.terms} /></Field>
        </div>
      </Fold>

      <FormError error={state?.error} />
      <FormActions>
        <Button disabled={pending}>{pending ? "Saqlanmoqda…" : "Taklifni saqlash"}</Button>
        <span className="text-xs text-slate-500">Saqlangach hujjat kartasi ochiladi — u yerdan chop etiladi va QR havolasi olinadi</span>
      </FormActions>
    </form>
  );
}
