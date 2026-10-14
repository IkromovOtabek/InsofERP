"use client";

import { useActionState, useState, useTransition } from "react";
import { Plus, X } from "lucide-react";
import { fmtNum } from "@/lib/format";
import { unitShort } from "@/lib/unit";
import { cn } from "@/lib/utils";
import { Button, Card, Field, FormActions, FormError, Input, LinkButton, Select } from "@/components/ui";
import { MaterialField, type MaterialGroup, type MaterialRow } from "@/components/material-picker";
import { MoneyInput } from "@/components/money-input";
import { RecipientAdd, SupplierAdd, WithAdd } from "@/components/quick-add";
import { createPrixod } from "./actions";

type Opt = { id: string; name: string };
type SupplierOpt = Opt & { vatPayer: boolean };
type Account = Opt & { type: "CASH" | "BANK" };
type Payment = "BANK" | "CASH";
/** `vat` — qator QQS stavkasi; naqd pul yoki QQS to'lovchisi bo'lmagan yetkazuvchida doim 0. */
type Vat = "12" | "6" | "0";
type Row = { key: number; materialId: string; qty: string; price: string; delivery: string; vat: Vat };
const VATS: Vat[] = ["12", "6", "0"];

const r2 = (n: number) => Math.round(n * 100) / 100;
const num = (v: string) => { const n = Number(v.replace(/\s+/g, "").replace(",", ".")); return Number.isFinite(n) ? n : 0; };
const money = (v: number) => fmtNum(v, 2);
const newRow = (key: number): Row => ({ key, materialId: "", qty: "", price: "", delivery: "", vat: "12" });

/**
 * Jadval-forma ustunlari (keng ekranda): № | Nomi | Birlik | Miqdor | Narx | Yetkazib berish | QQS | Jami summa | ×.
 * Eng kami 796 + 8 × 8 (gap) = 860px: 1280px ekranda karta ichi ≈ 900px (yon menyu 256, main px-8, Card p-5) — sig'adi.
 */
const GRID = "xl:grid-cols-[28px_minmax(160px,1fr)_48px_96px_112px_104px_80px_136px_32px]";
const HEAD = "px-2 py-2 text-[12.5px] font-semibold leading-tight text-slate-900";

/** Telefonda maydon nomi (keng ekranda ustun sarlavhasi bor). */
const Lbl = ({ children }: { children: React.ReactNode }) => <span className="mb-1 block text-xs font-medium text-slate-500 xl:hidden">{children}</span>;

/**
 * «Kirim» formasi (avval «Приход») — foydalanuvchi Excel jurnalidagi ustunlar bilan. Matn o'zbekcha, «Рус» rejimida lug'atdan.
 * Narx QQS'siz; QQS (12% yoki 6%, qatorda tanlanadi) faqat tovarga (naqd pul — 0), «Yetkazib berish» QQS'siz Umumiy/Jami summaga va tannarxga qo'shiladi.
 * `clientToken` — ikki marta bosilgan «Kirimni saqlash» ikkinchi kirim ochmaydi.
 * «Ta'minotchi» (xaridni qilgan snabjenets) alohida maydon emas — «Kimdan» bilan adashtirilardi; Snabjeniye o'zi
 * kiritganda u avtomatik yoziladi (`defaultBuyerId`). «Kimdan» va «Kimga» ichidagi «+» — ro'yxatda yo'qini shu yerda qo'shish.
 */
export function PrixodForm({ today, suppliers: initSuppliers, warehouses, materials, groups = [], canCreate = false, canAddSupplier = false, recipients: initRecipients, defaultBuyerId, accounts, clientToken, companyVatPayer = true }: {
  today: string;
  suppliers: SupplierOpt[];
  warehouses: Opt[];
  materials: MaterialRow[];
  groups?: MaterialGroup[];
  canCreate?: boolean;
  canAddSupplier?: boolean;
  recipients: Opt[];
  defaultBuyerId: string;
  accounts: Account[];
  clientToken: string;
  companyVatPayer?: boolean;
}) {
  const [state, action, pending] = useActionState(createPrixod, undefined);
  // <form action> o'rniga qo'lda yuboriladi: React 19 action tugagach formani reset qiladi — server xato qaytarganda
  // narx/dostavka (MoneyInput), sana, sklad va boshqa maydonlar bo'shab qolardi. Muvaffaqiyatda server redirect qiladi.
  const [, startTransition] = useTransition();
  const [suppliers, setSuppliers] = useState(initSuppliers);
  const [recipients, setRecipients] = useState(initRecipients);
  const [supplierId, setSupplierId] = useState("");
  const [recipientId, setRecipientId] = useState("");
  const [payment, setPayment] = useState<Payment>("BANK");
  const [accountId, setAccountId] = useState("");
  const [rows, setRows] = useState<Row[]>([newRow(1)]);

  const supVat = suppliers.find((x) => x.id === supplierId)?.vatPayer ?? true;
  const noVat = !supVat || payment === "CASH";
  const update = (key: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const remove = (key: number) => setRows((rs) => (rs.length > 1 ? rs.filter((r) => r.key !== key) : [newRow(Date.now())]));
  const choosePayment = (p: Payment) => {
    setPayment(p);
    if (accountId && accounts.find((a) => a.id === accountId)?.type !== p) setAccountId("");
  };

  const calc = (r: Row) => {
    const goods = num(r.qty) * num(r.price);
    const delivery = num(r.delivery);
    const rate = noVat ? 0 : Number(r.vat);
    const vat = r2((goods * rate) / 100);
    const sum = goods + delivery;
    return { rate, delivery, vat, sum, total: sum + vat };
  };
  // Jami — faqat Nomi (xomashyo) tanlangan qatorlardan (yuboriladiganlari ham shular)
  const totals = rows.filter((r) => r.materialId).reduce((t, r) => { const c = calc(r); return { sum: t.sum + c.sum, delivery: t.delivery + c.delivery, vat: t.vat + c.vat, total: t.total + c.total }; }, { sum: 0, delivery: 0, vat: 0, total: 0 });
  // Jamidagi QQS yorlig'i: qatorlarda ishlatilgan stavkalar ("12%", "6%" yoki "12% / 6%")
  const usedRates = [...new Set(rows.filter((r) => r.materialId).map((r) => calc(r).rate).filter((x) => x > 0))].sort((a, b) => b - a);
  const totalsRates = usedRates.map((x) => `${x}%`).join(" / ");
  // Raqam kiritilgan-u, xomashyo tanlanmagan qator yuborilmaydi — jimgina tushib qolmasin: saqlash yopiladi
  const orphans = rows.flatMap((r, idx) => (!r.materialId && (r.qty.trim() || r.price.trim() || r.delivery.trim()) ? [idx + 1] : []));
  const payAccounts = accounts.filter((a) => a.type === payment);

  return (
    <form onSubmit={(e) => {
      e.preventDefault();
      if (pending || orphans.length) return;
      const fd = new FormData(e.currentTarget);
      startTransition(() => action(fd));
    }}>
      <Card className="space-y-5">
        <FormError error={state?.error} />
        <input type="hidden" name="clientToken" value={clientToken} />
        {warehouses.length === 1 && <input type="hidden" name="warehouseId" value={warehouses[0].id} />}
        {defaultBuyerId && <input type="hidden" name="buyerId" value={defaultBuyerId} />}

        {/* Hujjat rekvizitlari — Excel jurnali ustunlari */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Sana *"><Input name="date" type="date" defaultValue={today} max={today} required /></Field>
          <Field label="Kimdan (yetkazuvchi) *" hint={supplierId && !supVat ? "Yetkazuvchi QQS to'lovchisi emas — QQS 0" : undefined}>
            <WithAdd add={canAddSupplier && <SupplierAdd onCreated={(x) => {
              setSuppliers((l) => [...l, { id: x.id, name: x.name, vatPayer: x.vatPayer ?? true }].sort((a, b) => a.name.localeCompare(b.name)));
              setSupplierId(x.id);
            }} />}>
              <Select name="supplierId" value={supplierId} onChange={(e) => setSupplierId(e.target.value)} required>
                <option value="" disabled>Yetkazuvchini tanlang…</option>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}{s.vatPayer ? "" : " (QQS'siz)"}</option>)}
              </Select>
            </WithAdd>
          </Field>
          {warehouses.length > 1 && (
            <Field label="Sklad *">
              <Select name="warehouseId" defaultValue={warehouses[0]?.id} required>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</Select>
            </Field>
          )}
          <Field label="To'lov turi *" hint={payment === "CASH" ? "Naqd pul — barcha qatorlarda QQS 0" : "Bank o'tkazma — QQS 12% yoki 6% (qatorlar bo'yicha)"}>
            <div role="radiogroup" aria-label="To'lov turi" className="grid h-10 grid-cols-2 gap-0.5 rounded-lg border border-slate-300 bg-slate-50 p-0.5 pointer-coarse:h-11">
              {(["BANK", "CASH"] as const).map((p) => (
                <label key={p} className={cn("flex cursor-pointer items-center justify-center rounded-md px-1 text-center text-sm leading-tight font-semibold transition select-none",
                  payment === p ? (p === "BANK" ? "bg-blue-600 text-white shadow-sm" : "bg-amber-500 text-white shadow-sm") : "text-slate-600 hover:bg-white hover:text-slate-900")}>
                  <input type="radio" name="payment" value={p} checked={payment === p} onChange={() => choosePayment(p)} className="sr-only" />
                  {p === "BANK" ? "Bank o'tkazma" : "Naqd pul"}
                </label>
              ))}
            </div>
          </Field>
          <Field label="TTN"><Input name="waybillNo" placeholder="Nakladnoy №" autoComplete="off" maxLength={60} /></Field>
          <Field label="Kimga">
            <WithAdd add={<RecipientAdd onCreated={(x) => { setRecipients((l) => [...l, { id: x.id, name: x.name }]); setRecipientId(x.id); }} />}>
              <Select name="recipientId" value={recipientId} onChange={(e) => setRecipientId(e.target.value)}>
                <option value="">— (sklad)</option>
                {recipients.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </Select>
            </WithAdd>
          </Field>
          <Field label="Manzil"><Input name="address" placeholder="Qayerdan / qayerga yetkazildi" autoComplete="off" maxLength={300} /></Field>
          <Field label="Maqsad" className="sm:col-span-2"><Input name="purpose" placeholder="Nima uchun sotib olindi" autoComplete="off" maxLength={300} /></Field>
          <Field label="Izoh" className="sm:col-span-2"><Input name="note" placeholder="Holati, qo'shimcha ma'lumot…" autoComplete="off" maxLength={1000} /></Field>
        </div>

        {/* Hisob faqat direktorga beriladi. Boshqalarda to'lovni moliya Kirim-Chiqimdan qiladi */}
        {accounts.length > 0 ? (
          <Field label="Qaysi hisobdan to'landi" hint="Tanlansa — shu zahoti chiqim bo'lib yoziladi. «Moliya to'laydi» — Kirim-Chiqimdagi to'lanmagan kirimlarga tushadi">
            <Select name="cashAccountId" value={accountId} onChange={(e) => setAccountId(e.target.value)} className="sm:max-w-sm">
              <option value="">Moliya to&apos;laydi</option>
              {payAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}{a.type === "CASH" ? " (naqd)" : " (o'tkazma)"}</option>)}
            </Select>
          </Field>
        ) : (
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">To'lovni moliya qiladi — saqlangandan keyin kirim Kirim-Chiqimdagi to'lanmagan kirimlar ro'yxatiga tushadi.</p>
        )}

        {/* Qatorlar — keng ekranda Excel'ga o'xshash jadval, telefonda har qator alohida blok */}
        <div>
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <div className="text-sm font-semibold text-slate-900">Xomashyo *</div>
            <div className="text-xs text-slate-500">Narx QQS'siz · QQS faqat tovarga hisoblanadi, yetkazib berishga emas</div>
          </div>
          <div className={cn("hidden overflow-hidden rounded-t-lg border border-b-0 border-slate-300/80 bg-emerald-50 xl:grid xl:items-center xl:gap-2", GRID)}>
            <div className={cn(HEAD, "text-center")}>№</div>
            <div className={HEAD}>Nomi</div>
            <div className={cn(HEAD, "text-center")}>Birlik</div>
            <div className={cn(HEAD, "text-right")}>Miqdor</div>
            <div className={cn(HEAD, "text-right")}>Narx</div>
            <div className={cn(HEAD, "text-right")}>Yetkazib berish</div>
            <div className={cn(HEAD, "text-center")}>QQS</div>
            <div className={cn(HEAD, "text-right")}>Jami summa</div>
            <div />
          </div>
          <div className="space-y-2 xl:space-y-0 xl:rounded-b-lg xl:border xl:border-slate-300/80">
            {rows.map((r, idx) => {
              const unit = materials.find((m) => m.id === r.materialId)?.unit;
              const u = unit ? unitShort(unit) : "";
              const c = calc(r);
              const on = !!r.materialId;
              const orphan = orphans.includes(idx + 1);
              return (
                <div key={r.key} className={cn("grid grid-cols-2 gap-2 rounded-lg border border-slate-200 p-3 sm:grid-cols-4", "xl:items-center xl:rounded-none xl:border-0 xl:border-b xl:border-slate-200 xl:px-0 xl:py-1.5 xl:last:border-b-0", GRID)}>
                  {on && <>
                    <input type="hidden" name="materialId[]" value={r.materialId} />
                    <input type="hidden" name="qty[]" value={r.qty} />
                    <input type="hidden" name="price[]" value={r.price} />
                    <input type="hidden" name="deliveryCost[]" value={r.delivery} />
                    <input type="hidden" name="vatRate[]" value={String(c.rate)} />
                  </>}
                  {/* Telefonda: qator raqami va o'chirish */}
                  <div className="col-span-2 flex items-center justify-between sm:col-span-4 xl:hidden">
                    <span className="text-xs font-semibold text-slate-500">{`Qator ${idx + 1}`}</span>
                    <button type="button" aria-label="Qatorni o'chirish" onClick={() => remove(r.key)} className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600"><X size={16} /></button>
                  </div>
                  <div className="hidden text-center text-xs text-slate-400 tabular xl:block">{idx + 1}</div>
                  <div className="col-span-2 sm:col-span-4 xl:col-span-1">
                    <Lbl>Nomi</Lbl>
                    <MaterialField materials={materials} groups={groups} canCreate={canCreate} value={r.materialId} placeholder="Nomi yoki kodi"
                      onPick={(m) => update(r.key, { materialId: m.id, price: r.price || (m.price ? String(r2(m.price)) : "") })} />
                    {orphan && <p className="mt-1 text-xs font-medium text-red-600">Xomashyoni tanlang</p>}
                  </div>
                  <div className="hidden text-center text-sm text-slate-600 xl:block">{u || "—"}</div>
                  <div>
                    <Lbl>{u ? `Miqdor (${u})` : "Miqdor"}</Lbl>
                    <Input type="number" inputMode="decimal" step="0.001" min="0" aria-label="Miqdor" placeholder="0" value={r.qty} onChange={(e) => update(r.key, { qty: e.target.value })} required={on} className="text-right tabular" />
                  </div>
                  <div>
                    <Lbl>{u ? `Narx / ${u}` : "Narx"}</Lbl>
                    <MoneyInput value={r.price} onChange={(v) => update(r.key, { price: v })} decimals={2} suffix={null} ariaLabel="Narx" placeholder="0" required={on} className="text-right" />
                  </div>
                  <div>
                    <Lbl>Yetkazib berish</Lbl>
                    <MoneyInput value={r.delivery} onChange={(v) => update(r.key, { delivery: v })} decimals={2} suffix={null} ariaLabel="Yetkazib berish" placeholder="0" className="text-right" />
                  </div>
                  <div>
                    <Lbl>QQS</Lbl>
                    <Select aria-label="QQS stavkasi" value={noVat ? "0" : r.vat} disabled={noVat} onChange={(e) => update(r.key, { vat: VATS.find((v) => v === e.target.value) ?? "12" })}>
                      {VATS.map((v) => <option key={v} value={v}>{v}%</option>)}
                    </Select>
                  </div>
                  {/* Jonli hisob: Umumiy (tovar + dostavka), QQS, Jami */}
                  {/* Xomashyo tanlanmagan qator hisoblanmaydi (yuborilmaydi ham) */}
                  <div className="col-span-2 rounded-md bg-slate-50 px-2 py-1.5 text-right text-xs text-slate-500 tabular sm:col-span-4 xl:col-span-1 xl:bg-transparent xl:px-2 xl:py-0">
                    <div className="text-sm font-semibold text-slate-900">{on ? money(c.total) : "—"}</div>
                    {/* Keng ekranda ustun tor — Umumiy va QQS ikki qatorda */}
                    {on && <div><span className="xl:block">{`Umumiy ${money(c.sum)}`}</span><span className="xl:hidden"> · </span><span className="xl:block">{`QQS ${money(c.vat)}`}</span></div>}
                  </div>
                  <div className="hidden justify-center xl:flex">
                    <button type="button" aria-label="Qatorni o'chirish" onClick={() => remove(r.key)} className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600"><X size={16} /></button>
                  </div>
                </div>
              );
            })}
          </div>
          <button type="button" onClick={() => setRows((rs) => [...rs, newRow(Date.now())])} className="mt-2 inline-flex h-9 items-center gap-1 rounded-lg px-2 text-sm font-medium text-slate-700 hover:bg-slate-100 hover:text-slate-900">
            <Plus size={15} /> Qator
          </button>

          <div className="mt-3 ml-auto max-w-sm space-y-1 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm tabular">
            <div className="flex justify-between gap-4 text-slate-600"><span>Umumiy summa</span><span>{money(totals.sum)}</span></div>
            {totals.delivery > 0 && <div className="flex justify-between gap-4 text-xs text-slate-500"><span>shu jumladan yetkazib berish</span><span>{money(totals.delivery)}</span></div>}
            <div className="flex justify-between gap-4 text-slate-600"><span>{totalsRates ? `QQS ${totalsRates}` : "QQS"}</span><span>{money(totals.vat)}</span></div>
            <div className="flex justify-between gap-4 border-t border-slate-200 pt-1.5 text-base font-semibold text-slate-900"><span>Jami summa</span><span>{money(totals.total)}</span></div>
            <div className="pt-1 text-xs text-slate-500">{companyVatPayer ? "Skladdagi tannarx: QQS'siz + yetkazib berish" : "Skladdagi tannarx: QQS bilan + yetkazib berish"}</div>
          </div>
        </div>

        {orphans.length > 0 && (
          <div className="space-y-0.5 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {orphans.map((n) => <div key={n}>{`${n}-qator: xomashyoni tanlang`}</div>)}
          </div>
        )}

        <FormActions>
          <Button disabled={pending || orphans.length > 0}>{pending ? "Saqlanmoqda…" : "Kirimni saqlash"}</Button>
          <LinkButton href="/stock/prixod" variant="secondary">Bekor qilish</LinkButton>
        </FormActions>
      </Card>
    </form>
  );
}
