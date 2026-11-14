"use client";

import { useActionState, useState } from "react";
import { Plus, X, HardHat, Truck, Wallet, ShieldAlert } from "lucide-react";
import type { OrderStatus, PayMethod } from "@/generated/prisma";
import { Button, Callout, Card, CardHeader, Checkbox, Field, FormActions, FormError, Input, LinkButton, Select, Textarea } from "@/components/ui";
import { AddressPicker } from "@/components/address-picker";
import { BlockField } from "@/components/site-blocks";
import { ProductField } from "@/components/product-field";
import { ProductPicker, type CatalogGroup, type CatalogProduct } from "@/components/product-picker";
import { MoneyInput } from "@/components/money-input";
import type { ProductCreate } from "@/lib/catalog";
import { fmtNum, isoDate } from "@/lib/format";
import { withNds } from "@/lib/nds";
import { cn } from "@/lib/utils";
import { editOrder } from "../../actions";
import type { BrigadeStockMap } from "@/lib/brigade-stock-source";
import { BrigadeSourceCell, BrigadeSourceToggle } from "../../brigade-source";
import { blockEnterSubmit, siteByAddress, submitKeepingState, type SitePlace } from "../../order-form";

export type OrderEditData = {
  id: string; kind: "SALE" | "STOCK"; status: OrderStatus; customerName: string;
  /** `price` — NDS'siz; `locked` — brigadaga berilgan qator, `min` — undan kam qilib bo'lmaydigan miqdor */
  items: { id: string; productId: string; qty: number; price: number; nds: boolean; locked: boolean; min: number; /** obyekt bloki nomi, "" — yo'q */ block: string; /** «Brigadadan olish» brigadasi, "" — yo'q */ stockBrigadeId: string }[];
  deliveryDate: string; dateUnknown: boolean;
  deliveryAddress: string; lat: number | null; lng: number | null;
  needsPump: boolean; needsDelivery: boolean; deliveryFee: number; isUrgent: boolean; note: string;
  onCredit: boolean; prepayAmount: number; payMethod: PayMethod | null;
  /** Zayavkaga tushgan bosh to'lov — undan kam qilib bo'lmaydi, usuli o'zgarmaydi */
  advance: number;
  invoices: string[];
};

type Row = { key: string; id: string | null; productId: string; qty: string; price: string; nds: boolean; locked: boolean; min: number; block: string; src: boolean; srcId: string };
const num = (v: number) => (Number.isInteger(v) ? String(v) : String(Math.round(v * 1000) / 1000));

/**
 * Zayavkani tahrirlash formasi. Saqlash faqat tugma bilan (Enter yubormaydi); xato qaytsa kiritilgani o'chmaydi. Server qoidalari (`orderEdit`):
 * brigadaga berilgan qator qulflanadi, tasdiqlangan zayavkada summa oshsa limit qayta tekshiriladi.
 */
export function OrderEditForm({ data, products, groups, canCreateProduct, sites, geoSearch, brigadeStock = {} }: {
  data: OrderEditData; products: CatalogProduct[]; groups: CatalogGroup[]; canCreateProduct: ProductCreate; sites: SitePlace[]; geoSearch: boolean;
  /** «Brigadadan olish»: mahsulot → brigada omborlari (shu zayavkaning o'z bandi hisobga olinmagan) */ brigadeStock?: BrigadeStockMap;
}) {
  const [state, action, pending] = useActionState(editOrder.bind(null, data.id), undefined);
  const isStock = data.kind === "STOCK";
  const [rows, setRows] = useState<Row[]>(() => data.items.map((i) => ({ key: i.id, id: i.id, productId: i.productId, qty: num(i.qty), price: String(i.price), nds: i.nds, locked: i.locked, min: i.min, block: i.block, src: !!i.stockBrigadeId, srcId: i.stockBrigadeId })));
  // Obyekt bloklari: «Obyekt» katagidagi manzil bo'yicha mijoz obyekti + qatorlarda yozilgani
  const [addr, setAddr] = useState(data.deliveryAddress);
  const blockOpts = [...new Set([...(siteByAddress(sites, addr)?.blocks ?? []), ...rows.map((r) => r.block.trim()).filter(Boolean)])];
  const [pickFor, setPickFor] = useState<string | null>(null);
  const [dateUnknown, setDateUnknown] = useState(data.dateUnknown);
  const [needsDelivery, setNeedsDelivery] = useState(data.needsDelivery);
  const [fee, setFee] = useState(data.deliveryFee ? String(data.deliveryFee) : "");
  // To'lov: naqd / perechisleniye — oldindan to'lov; qarzga — kredit limitidan (bosh to'lov ixtiyoriy)
  const [kind, setKind] = useState<"cash" | "bank" | "credit">(data.onCredit ? "credit" : data.payMethod === "BANK" ? "bank" : "cash");
  const [prepay, setPrepay] = useState(data.prepayAmount ? String(data.prepayAmount) : "");
  const [depMethod, setDepMethod] = useState<PayMethod>(data.payMethod ?? "CASH");

  const update = (key: string, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const productOf = (id: string) => products.find((p) => p.id === id);
  const onProduct = (key: string, productId: string) => update(key, { productId, price: productOf(productId)?.price ?? "0", src: false, srcId: "" });
  // «Brigadadan olish»: yoqilganda erkini ko'p brigada; boshqa qatorlar olgani katakda ayiriladi; yetmasa — qatorni bo'lish
  const toggleSource = (r: Row, on: boolean) => update(r.key, { src: on, srcId: on ? (brigadeStock[r.productId]?.[0]?.brigadeId ?? "") : "" });
  const takenFor = (r: Row) => {
    const t: Record<string, number> = {};
    for (const x of rows) if (x.key !== r.key && x.src && x.srcId && x.productId === r.productId) t[x.srcId] = (t[x.srcId] ?? 0) + (Number(x.qty) || 0);
    return t;
  };
  const splitSource = (key: string, brigadeId: string, qty: number) => setRows((rs) => {
    const i = rs.findIndex((x) => x.key === key);
    const cur = rs[i];
    if (!cur) return rs;
    const keep = Math.max(cur.locked ? cur.min : 0, Math.round(((Number(cur.qty) || 0) - qty) * 1000) / 1000);
    const add = Math.round(((Number(cur.qty) || 0) - keep) * 1000) / 1000;
    if (add <= 0) return rs;
    return [...rs.slice(0, i), { ...cur, qty: num(keep) }, { ...cur, key: `n${Date.now()}`, id: null, locked: false, min: 0, qty: num(add), srcId: brigadeId }, ...rs.slice(i + 1)];
  });
  const addRow = () => {
    const p = products[0];
    setRows((rs) => [...rs, { key: `n${Date.now()}`, id: null, productId: p?.id ?? "", qty: "", price: isStock ? "0" : p?.price ?? "0", nds: kind === "bank", locked: false, min: 0, block: "", src: false, srcId: "" }]);
  };

  const lineOf = (r: Row) => (Number(r.qty) || 0) * (r.nds ? withNds(Number(r.price) || 0) : Number(r.price) || 0);
  const itemsSum = rows.reduce((s, r) => s + lineOf(r), 0);
  const total = itemsSum + (needsDelivery ? Number(fee) || 0 : 0);
  const prepayN = Number(prepay) || 0;
  const payMethod: PayMethod | null = kind === "cash" ? "CASH" : kind === "bank" ? "BANK" : prepayN > 0 ? depMethod : null;
  const tooLow = rows.some((r) => r.locked && (Number(r.qty) || 0) < r.min - 0.0005);
  const methodLocked = data.advance > 0.005;
  const canUnknown = data.status === "DRAFT";

  return (
    <form onSubmit={submitKeepingState(action)} onKeyDown={blockEnterSubmit} className="space-y-5">
      <FormError error={state?.error} />
      {data.status === "CONFIRMED" && !isStock && (
        <Callout tone="info" title="Zayavka qabul qilingan">
          Summa oshsa kredit limiti qayta tekshiriladi — yetmasa zayavka bloklanadi va direktor ochadi. Sana yoki beton hajmi o&apos;zgarsa kunlik limit ham tekshiriladi.
          Saqlangach ishlab chiqarish va logistikaga xabar boradi.
        </Callout>
      )}
      {data.invoices.length > 0 && (
        <Callout tone="warning" title={`Schyot yozilgan: ${data.invoices.join(", ")}`}>Zayavka summasini o&apos;zgartirib bo&apos;lmaydi — narx va soni o&apos;zgarsa avval schyotni bekor qiling. Sana, manzil va izoh o&apos;zgaradi.</Callout>
      )}

      <Card>
        <CardHeader title="Mahsulotlar" description={rows.some((r) => r.locked) ? "Brigadaga berilgan qator o'chirilmaydi va mahsuloti almashmaydi; soni brigadaga berilganidan kam bo'lmaydi." : undefined} />
        <div className="space-y-3">
          {rows.map((r, idx) => {
            const p = productOf(r.productId);
            const unit = p?.unit ?? "";
            const short = r.locked && (Number(r.qty) || 0) < r.min - 0.0005;
            return (
              <div key={r.key} className="rounded-lg border border-slate-200 p-3">
                <input type="hidden" name="itemId[]" value={r.id ?? ""} />
                <input type="hidden" name="productId[]" value={r.productId} />
                {!isStock && <input type="hidden" name="nds[]" value={r.nds ? "1" : "0"} />}
                {!isStock && <input type="hidden" name="block[]" value={r.block} />}
                {!isStock && <input type="hidden" name="stockBrigade[]" value={r.src && p?.unit !== "m³" ? r.srcId : ""} />}
                <div className={cn("grid grid-cols-1 gap-3", isStock ? "sm:grid-cols-[minmax(0,1fr)_160px_40px]" : "sm:grid-cols-[minmax(0,1fr)_150px_130px_170px_40px]")}>
                  <div className="min-w-0">
                    <div className="mb-1.5 text-[13px] font-medium text-slate-700">{idx + 1}. Mahsulot</div>
                    {r.locked ? (
                      <div className="flex h-10 items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm text-slate-700">
                        <span className="truncate">{p?.name ?? "—"}</span>
                        <span className="ml-auto inline-flex shrink-0 items-center gap-1 text-xs text-amber-700"><HardHat size={13} /> brigadada</span>
                      </div>
                    ) : (
                      <ProductField products={products} value={r.productId} onPick={(id) => onProduct(r.key, id)} onOpenPicker={() => setPickFor(r.key)} />
                    )}
                  </div>
                  {!isStock && (
                    <div>
                      <div className="mb-1.5 text-[13px] font-medium text-slate-700">Blok</div>
                      <BlockField value={r.block} onChange={(v) => update(r.key, { block: v })} options={blockOpts} />
                    </div>
                  )}
                  <Field label={`Soni${unit ? `, ${unit}` : ""}`} error={short ? `kamida ${fmtNum(r.min, 3)}` : undefined}>
                    <Input name="qtyM3[]" type="number" step="any" min={r.locked && r.min > 0 ? String(r.min) : "0.001"} required value={r.qty}
                      onChange={(e) => update(r.key, { qty: e.target.value })} aria-invalid={short || undefined}
                      className="text-right [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" />
                  </Field>
                  {!isStock && (
                    <Field label="Narxi (QQS'siz)">
                      <MoneyInput name="price[]" value={r.price} onChange={(v) => update(r.key, { price: v })} decimals={2} suffix={null} required ariaLabel="Narxi" />
                    </Field>
                  )}
                  <div className="flex items-end justify-end">
                    {!r.locked && rows.length > 1 && (
                      <button type="button" onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))} aria-label="Qatorni o'chirish"
                        className="flex h-10 w-10 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600"><X size={16} /></button>
                    )}
                  </div>
                </div>
                {!isStock && (
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-sm">
                    <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
                      <Checkbox label="QQS 12% qo'shilsin" checked={r.nds} onChange={(e) => update(r.key, { nds: e.target.checked })} />
                      {/* Plita, ustun, blok… (beton emas): tayyorini brigada omboridan olish */}
                      {p && p.unit !== "m³" && <BrigadeSourceToggle checked={r.src} options={brigadeStock[r.productId]} onChange={(on) => toggleSource(r, on)} />}
                    </span>
                    <span className="text-slate-500">Summa: <b className="tabular text-slate-900">{fmtNum(lineOf(r))}</b> so&apos;m</span>
                  </div>
                )}
                {!isStock && r.src && p && p.unit !== "m³" && (
                  <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50/40 p-2">
                    <div className="mb-1 text-xs font-medium text-slate-600">Brigada omboridan — reys yuklanganda chiqim shu ombordan yoziladi</div>
                    <BrigadeSourceCell productId={r.productId} options={brigadeStock[r.productId]} unit={unit} need={Number(r.qty) || 0} value={r.srcId}
                      onChange={(id) => update(r.key, { srcId: id })} taken={takenFor(r)} onSplit={(b, q) => splitSource(r.key, b, q)} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <button type="button" onClick={addRow} className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-slate-700 hover:underline"><Plus size={14} /> Mahsulot qo&apos;shish</button>
        <ProductPicker open={pickFor !== null} products={products} groups={groups} canCreate={canCreateProduct}
          onClose={() => setPickFor(null)} onPick={(id) => { if (pickFor !== null) onProduct(pickFor, id); }} />
      </Card>

      <Card>
        <CardHeader icon={Truck} title={isStock ? "Muddat" : "Yetkazish"} />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={isStock ? "Tayyor bo'lish muddati" : "Yetkazish sanasi"}>
            {dateUnknown
              ? <><input type="hidden" name="dateUnknown" value="1" /><div className="flex h-10 items-center text-sm text-slate-500">Aniq emas — keyin belgilanadi</div></>
              : <Input name="deliveryDate" type="date" required defaultValue={data.dateUnknown ? "" : data.deliveryDate} min={!data.dateUnknown && data.deliveryDate < isoDate() ? undefined : isoDate()} />}
          </Field>
          <div className="flex flex-col justify-end gap-2 pb-1">
            {canUnknown && !isStock && <Checkbox label="Sana hali aniq emas" checked={dateUnknown} onChange={(e) => setDateUnknown(e.target.checked)} />}
            <Checkbox name="isUrgent" label="Zarur (shoshilinch)" defaultChecked={data.isUrgent} />
            {!isStock && <Checkbox name="needsPump" label="Nasos kerak" defaultChecked={data.needsPump} />}
          </div>
          {!isStock && (
            <div className="sm:col-span-2">
              <AddressPicker searchEnabled={geoSearch} required label="Obyekt" defaultAddress={data.deliveryAddress} defaultLat={data.lat} defaultLng={data.lng} saved={sites} onAddress={setAddr} />
            </div>
          )}
          {!isStock && (
            <div className="sm:col-span-2 grid grid-cols-1 gap-3 sm:grid-cols-2 sm:items-end">
              <Checkbox name="needsDelivery" label="Dastavka kerak (belgilanmasa — mijoz o'zi olib ketadi)" checked={needsDelivery} onChange={(e) => setNeedsDelivery(e.target.checked)} />
              {needsDelivery && (
                <Field label="Dastavka summasi (jami)">
                  <MoneyInput name="deliveryFee" value={fee} onChange={setFee} decimals={2} placeholder="0" />
                </Field>
              )}
            </div>
          )}
        </div>
      </Card>

      {!isStock && (
        <Card>
          <CardHeader icon={Wallet} title="To'lov" />
          <input type="hidden" name="payment" value={kind === "credit" ? "credit" : "prepay"} />
          {payMethod && <input type="hidden" name="payMethod" value={payMethod} />}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field label="To'lov turi">
              <Select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} disabled={methodLocked}>
                <option value="cash">Naqd</option>
                <option value="bank">Perechisleniye</option>
                <option value="credit">Qarzga</option>
              </Select>
            </Field>
            <Field label="Bosh to'lov (0 — yo'q)" hint={methodLocked ? `Tushgan: ${fmtNum(data.advance)} so'm — undan kam bo'lmaydi` : undefined}>
              <MoneyInput name="prepayAmount" value={prepay} onChange={setPrepay} decimals={2} placeholder="0" />
            </Field>
            {kind === "credit" && prepayN > 0 && (
              <Field label="Bosh to'lov qanday keladi">
                <Select value={depMethod} onChange={(e) => setDepMethod(e.target.value as PayMethod)} disabled={methodLocked}>
                  <option value="CASH">Naqd</option>
                  <option value="BANK">Perechisleniye</option>
                </Select>
              </Field>
            )}
          </div>
          {methodLocked && <p className="mt-2 text-xs text-slate-500">Bosh to&apos;lovning bir qismi tushgan — to&apos;lov usuli o&apos;zgarmaydi.</p>}
          {prepayN > total + 0.005 && <p className="mt-2 inline-flex items-center gap-1 text-xs text-red-600"><ShieldAlert size={13} /> Bosh to&apos;lov zayavka summasidan katta</p>}
        </Card>
      )}

      <Card>
        <Field label="Izoh"><Textarea name="note" defaultValue={data.note} rows={3} /></Field>
        {!isStock && (
          <div className="mt-4 flex flex-wrap items-center justify-end gap-x-6 gap-y-1 text-sm">
            <span className="text-slate-500">Mahsulotlar: <b className="tabular text-slate-900">{fmtNum(itemsSum)}</b></span>
            {needsDelivery && <span className="text-slate-500">Dastavka: <b className="tabular text-slate-900">{fmtNum(Number(fee) || 0)}</b></span>}
            <span className="text-base">Jami: <b className="tabular">{fmtNum(total)} so&apos;m</b></span>
          </div>
        )}
        <FormActions>
          <Button disabled={pending || tooLow}>{pending ? "Saqlanmoqda…" : "Saqlash"}</Button>
          <LinkButton href={`/orders/${data.id}`} variant="secondary">Bekor</LinkButton>
          {tooLow && <span className="text-xs text-red-600">Brigadaga berilgan miqdordan kam bo&apos;lmasin</span>}
        </FormActions>
      </Card>
    </form>
  );
}
