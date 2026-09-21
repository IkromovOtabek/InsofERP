"use client";

import { X, Plus, Search, UserPlus, Users, ShieldAlert, ChevronDown, FileSignature, Truck, Zap, Star, Wallet, FileText, Upload } from "lucide-react";
import { fmtNum, isoDate, moneyShort, date as fmtDate } from "@/lib/format";
import { useActionState, useMemo, useState } from "react";
import { createOrder } from "./actions";
import { Badge, Button, Callout, Field, FormError, Input, LinkButton, Select, Textarea, FormActions, Checkbox } from "@/components/ui";
import { cn } from "@/lib/utils";

type Product = { id: string; code: string; name: string; price: string; unit: string };
export type CustomerOpt = {
  id: string; name: string; phone: string | null; inn: string | null; address: string | null;
  since: number; // mijoz ro'yxatga olingan vaqt (ms)
  limit: number; used: number; free: number; debt: number; blacklisted: boolean;
  contracted: boolean; // mijoz bilan shartnoma tuzilgan (bekor qilinmagan shartnomali zayavkasi bor)
  bought: number; // bizdan olgan mahsulot summasi (qabul qilingan zayavkalar)
  orders: number; // qabul qilingan zayavkalar soni
  paid: number; // hozirgacha to'lagan summa
  lastOrderAt: number | null; // so'nggi zayavka sanasi (ms)
  stars: 0 | 1 | 2 | 3 | 4 | 5; // ishonch reytingi, 0 — yangi mijoz
  label: string;
};
/**
 * Har bir mahsulot bo'yicha joriy qoldiq (sklad xodimi ma'lumoti):
 * kind="piece" — Astatkadagi dona mahsulot (erkin/band), kind="concrete" — tayyor beton.
 * canMake — hozirgi xomashyo qoldig'i bilan retsept bo'yicha yana qancha ishlab chiqarish mumkin.
 */
export type ProductStock = Record<string, { free: number; total: number; owned: number; canMake: number | null; by: string | null; kind: "piece" | "concrete" }>;
type Row = { key: number; productId: string; qtyM3: string; price: string };
export type CashAccountOpt = { id: string; name: string; type: "CASH" | "BANK" };

const money = (n: number) => `${fmtNum(n)} so'm`;

/** Ishonch reytingi: 5 yulduz, to'ldirilgani — reyting. 0 yulduz — hali xarid qilmagan yangi mijoz. */
export function Stars({ n, size = 13 }: { n: number; size?: number }) {
  return (
    <span className="inline-flex items-center gap-px" title={`${n} / 5`} aria-label={`${n} yulduz`}>
      {[1, 2, 3, 4, 5].map((i) => <Star key={i} size={size} className={i <= n ? "fill-amber-400 text-amber-400" : "text-slate-300"} />)}
    </span>
  );
}

const daysAgo = (ms: number | null) => (ms == null ? null : Math.max(0, Math.floor((Date.now() - ms) / 86400000)));
const agoText = (ms: number | null) => {
  const d = daysAgo(ms);
  if (d == null) return "—";
  if (d === 0) return "bugun";
  if (d === 1) return "kecha";
  if (d < 30) return `${d} kun oldin`;
  if (d < 365) return `${Math.floor(d / 30)} oy oldin`;
  return `${Math.floor(d / 365)} yil oldin`;
};

function CustomerPicker({ customers, value, onChange }: { customers: CustomerOpt[]; value: CustomerOpt | null; onChange: (c: CustomerOpt | null) => void }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    const all = t ? customers.filter((c) => [c.name, c.phone ?? "", c.inn ?? ""].some((x) => x.toLowerCase().includes(t))) : customers;
    // Ishonchli va ko'p xarid qilgan mijozlar yuqorida; qora ro'yxatdagilar pastda
    return [...all].sort((a, b) => Number(a.blacklisted) - Number(b.blacklisted) || b.stars - a.stars || b.bought - a.bought || a.name.localeCompare(b.name)).slice(0, 30);
  }, [customers, q]);

  return (
    <div className="relative">
      <input type="hidden" name="customerId" value={value?.id ?? ""} />
      {value ? (
        <div className={cn("flex items-center justify-between gap-3 rounded-lg border px-3 py-2", value.blacklisted ? "border-red-300 bg-red-50" : "border-slate-200 bg-slate-50")}>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="truncate text-sm font-medium text-slate-900">{value.name}</span>
              <Stars n={value.stars} />
              <span className="hidden text-xs text-slate-500 sm:inline">{value.label}</span>
              {value.blacklisted && <Badge color="red">Qora ro&apos;yxat</Badge>}
              {value.contracted && <Badge color="blue">Shartnoma</Badge>}
            </div>
            <div className="truncate text-xs text-slate-500">{[value.phone, value.inn && `INN ${value.inn}`].filter(Boolean).join(" · ") || "—"}</div>
          </div>
          <button type="button" onClick={() => { onChange(null); setQ(""); setOpen(true); }} className="shrink-0 text-xs font-medium text-slate-600 hover:underline">O'zgartirish</button>
        </div>
      ) : (
        <div className="relative">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
            placeholder="Mijozni qidiring: nomi, telefon, INN" className="pl-9 pr-9" autoComplete="off" />
          <ChevronDown size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
          {open && (
            <div className="absolute z-20 mt-1 max-h-80 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
              {list.length === 0 && <div className="px-3 py-2 text-sm text-slate-500">Topilmadi. Pastdagi &quot;Yangi mijoz&quot; orqali qo&apos;shing.</div>}
              {list.map((c) => (
                <button type="button" key={c.id} onMouseDown={(e) => e.preventDefault()} onClick={() => { onChange(c); setOpen(false); }}
                  className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-slate-50">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-slate-900">{c.name}</span>
                      {c.blacklisted ? <Badge color="red" dot={false}>Qora ro&apos;yxat</Badge> : c.orders === 0 ? <Badge color="blue" dot={false}>Yangi</Badge> : null}{c.contracted && <Badge color="blue" dot={false}>Shartnoma</Badge>}
                    </div>
                    <div className="truncate text-xs text-slate-500">{[c.phone, c.inn && `INN ${c.inn}`].filter(Boolean).join(" · ") || "—"}</div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="flex items-center justify-end gap-1.5"><Stars n={c.stars} /><span className="text-[11px] text-slate-500">{c.label}</span></div>
                    <div className="text-xs text-slate-500">
                      {c.orders > 0 ? <>xarid <span className="font-medium text-slate-900">{moneyShort(c.bought)}</span> · {c.orders} ta</> : <span className="text-slate-400">hali xarid yo&apos;q</span>}
                      {c.debt > 0 && <span className="text-amber-700"> · qarz {moneyShort(c.debt)}</span>}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function OrderForm({ customers, products, stock, cashAccounts, preselectCustomer, contractAccept }: { customers: CustomerOpt[]; products: Product[]; stock: ProductStock; cashAccounts: CashAccountOpt[]; preselectCustomer?: string; contractAccept: string }) {
  const [state, action, pending] = useActionState(createOrder, undefined);
  const [mode, setMode] = useState<"existing" | "new">("existing");
  const [customer, setCustomer] = useState<CustomerOpt | null>(customers.find((c) => c.id === preselectCustomer) ?? null);
  const [payment, setPayment] = useState<"prepay" | "credit">("prepay");
  const [prepay, setPrepay] = useState("");
  const [prepayAcc, setPrepayAcc] = useState(cashAccounts[0]?.id ?? "");
  const [contract, setContract] = useState(false); // "Shartnoma qilish" belgilanganmi
  const [contractAmount, setContractAmount] = useState("");
  const [rows, setRows] = useState<Row[]>([{ key: 1, productId: products[0]?.id ?? "", qtyM3: "", price: products[0]?.price ?? "0" }]);

  const update = (key: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const onProduct = (key: number, productId: string) =>
    update(key, { productId, price: products.find((p) => p.id === productId)?.price ?? "0" });

  const total = rows.reduce((s, r) => s + (Number(r.qtyM3) || 0) * (Number(r.price) || 0), 0);
  const tomorrow = isoDate(new Date(Date.now() + 86400000));
  const prepayN = Number(prepay) || 0;
  const remaining = Math.max(0, total - prepayN);
  const overLimit = mode === "existing" && customer ? customer.used + total > customer.limit : false;
  const blocked = mode === "existing" && !!customer?.blacklisted;
  const contractN = Number(contractAmount) || 0;
  const contractLeft = contractN - total; // shartnoma summasidan mahsulot summasi ayirilgan qoldiq

  return (
    <form action={action} className="space-y-5 rounded-(--radius-card) border border-slate-200/80 bg-white p-6 shadow-(--shadow-card)">
      <FormError error={state?.error} />
      <input type="hidden" name="customerMode" value={mode} />

      {/* ── Mijoz ── */}
      <div>
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="text-[13px] font-medium text-slate-700">Mijoz *</span>
          <div className="inline-flex rounded-lg border border-slate-200 p-0.5 text-xs">
            <button type="button" onClick={() => setMode("existing")} className={cn("inline-flex items-center gap-1 rounded-md px-2.5 py-1 font-medium transition", mode === "existing" ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100")}><Users size={13} /> Mavjud mijoz</button>
            <button type="button" onClick={() => setMode("new")} className={cn("inline-flex items-center gap-1 rounded-md px-2.5 py-1 font-medium transition", mode === "new" ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100")}><UserPlus size={13} /> Yangi mijoz</button>
          </div>
        </div>

        {mode === "existing" ? (
          <>
            <CustomerPicker customers={customers} value={customer} onChange={setCustomer} />
            {customer && (
              <div className={cn("mt-2 rounded-lg border p-3 text-xs", customer.blacklisted ? "border-red-200 bg-red-50/60" : "border-slate-100 bg-slate-50/60")}>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <div>
                    <div className="text-slate-500">Bizdan olgan mahsuloti</div>
                    <div className="font-semibold text-slate-900">{money(customer.bought)}</div>
                    <div className="text-slate-400">{customer.orders > 0 ? `${customer.orders} ta zayavka` : "hali xarid yo'q"}</div>
                  </div>
                  <div>
                    <div className="text-slate-500">To&apos;lagan</div>
                    <div className="font-semibold text-emerald-700">{money(customer.paid)}</div>
                    <div className="text-slate-400">{customer.bought > 0 ? `xaridning ${fmtNum(Math.min(100, (customer.paid / customer.bought) * 100), 0)}%` : "—"}</div>
                  </div>
                  <div>
                    <div className="text-slate-500">Qarz (qarz + ochiq)</div>
                    <div className={cn("font-semibold", customer.used > 0 ? "text-amber-700" : "text-slate-900")}>{money(customer.used)}</div>
                    <div className={cn(customer.free <= 0 ? "text-red-600" : "text-slate-400")}>bo&apos;sh limit {fmtNum(customer.free / 1e6, 1)} / {fmtNum(customer.limit / 1e6, 0)} mln</div>
                  </div>
                  <div>
                    <div className="text-slate-500">So&apos;nggi zayavka</div>
                    <div className="font-semibold text-slate-900">{customer.lastOrderAt ? fmtDate(new Date(customer.lastOrderAt)) : "—"}</div>
                    <div className="text-slate-400">{customer.lastOrderAt ? agoText(customer.lastOrderAt) : `mijoz ${fmtDate(new Date(customer.since))} dan`}</div>
                  </div>
                </div>
                {customer.address && <div className="mt-2 border-t border-slate-200/70 pt-2 text-slate-500">Manzil: <span className="text-slate-700">{customer.address}</span></div>}
                {customer.lastOrderAt && (daysAgo(customer.lastOrderAt) ?? 0) >= 90 && !customer.blacklisted && (
                  <div className="mt-2 text-amber-700">{agoText(customer.lastOrderAt)} xarid qilmagan — aloqani tiklash uchun yaxshi imkoniyat.</div>
                )}
              </div>
            )}
            {blocked && (
              <div className="mt-2"><Callout tone="danger" title="Mijoz qora ro'yxatda">Limit to&apos;liq ishlatilgan. Qarz to&apos;langach zayavka ochish mumkin. Direktor limitni oshirishi mumkin.</Callout></div>
            )}
            {!blocked && overLimit && customer && (
              <div className="mt-2"><Callout tone="warning" title="Limit yetmaydi">Bu zayavka bilan ishlatilgan summa {money(customer.used + total)} bo&apos;ladi, limit {money(customer.limit)}. Qabul qilinganda zayavka bloklanadi — direktor ochishi kerak.</Callout></div>
            )}
          </>
        ) : (
          <div className="space-y-3 rounded-lg border border-dashed border-slate-300 p-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Nomi *"><Input name="newName" placeholder="Firma yoki shaxs nomi" required={mode === "new"} /></Field>
              <Field label="Telefon"><Input name="newPhone" placeholder="+998 __ ___ __ __" /></Field>
              <Field label="INN"><Input name="newInn" /></Field>
              <Field label="Manzil"><Input name="newAddress" /></Field>
            </div>
            <p className="text-xs text-slate-500">Yangi mijozga avtomatik <b>100 000 000 so&apos;m</b> kredit limit ajratiladi. Mijoz zayavka bilan birga saqlanadi.</p>
          </div>
        )}
      </div>

      {/* ── Shartnoma: belgilansa shartnoma summasi kiritiladi, saqlangach PDF yuklanadi ── */}
      <div>
        <input type="hidden" name="hasContract" value={contract ? "on" : ""} />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-[13px] font-medium text-slate-700">Shartnoma</span>
          <button type="button" onClick={() => setContract((v) => !v)} aria-pressed={contract}
            className={cn("inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition", contract ? "border-blue-600 bg-blue-600 text-white hover:bg-blue-700" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50")}>
            <FileText size={15} /> {contract ? "Shartnoma qilinadi ✓" : "Shartnoma qilish"}
          </button>
        </div>
        {contract && (
          <div className="mt-2 rounded-lg border border-blue-200 bg-blue-50/50 p-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Shartnoma summasi (so'm) *" hint="Shartnomada ko'rsatilgan umumiy summa">
                <Input name="contractAmount" type="number" step="1" min="1" placeholder="0" value={contractAmount} onChange={(e) => setContractAmount(e.target.value)} required={contract} />
              </Field>
              <div className="flex flex-col justify-end gap-1 pb-1 text-xs">
                <div className="flex justify-between gap-3"><span className="text-slate-500">Shartnoma summasi</span><b className="text-slate-900">{money(contractN)}</b></div>
                <div className="flex justify-between gap-3"><span className="text-slate-500">− Mahsulot summasi</span><b className="text-slate-900">{money(total)}</b></div>
                <div className={cn("flex justify-between gap-3 border-t border-blue-200 pt-1", contractLeft < 0 ? "text-red-600" : "text-emerald-700")}>
                  <span>{contractLeft < 0 ? "Shartnomadan oshdi" : "Shartnoma qoldig'i"}</span><b>{money(Math.abs(contractLeft))}</b>
                </div>
              </div>
            </div>
            <div className="mt-3">
              <Field label="Imzolangan shartnoma fayli (Didox'dan)" hint="PDF yoki rasm, 15 MB gacha. Hozir bo'lmasa — zayavka sahifasida keyin yuklaysiz">
                <input name="contractFile" type="file" accept={contractAccept}
                  className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-slate-900 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-white hover:file:bg-slate-700" />
              </Field>
            </div>
            <p className="mt-2 inline-flex items-center gap-1.5 text-xs text-blue-800"><Upload size={14} /> Saqlangach shartnoma raqami beriladi. Didox'da imzolangan shartnoma tizimga isbot sifatida yuklanadi.</p>
            {contractN > 0 && contractLeft < 0 && <p className="mt-1 text-xs text-red-600">Mahsulot summasi shartnoma summasidan katta — summani tekshiring.</p>}
          </div>
        )}
      </div>

      {/* ── To'lov turi: oldindan yoki qarzga (kafolat xati) ── */}
      <div>
        <div className="mb-2 text-[13px] font-medium text-slate-700">To&apos;lov *</div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {([["prepay", "Oldindan to'lov", "Mahsulot to'lovdan keyin beriladi"], ["credit", "Qarzga (kredit limitdan)", "Kafolat xati chop etiladi — mijoz to'ldirib imzolaydi"]] as const).map(([v, l, h]) => (
            <label key={v} className={cn("flex cursor-pointer items-start gap-2.5 rounded-lg border p-3 text-sm transition", payment === v ? "border-slate-900 bg-slate-50" : "border-slate-200 hover:border-slate-300")}>
              <input type="radio" name="payment" value={v} checked={payment === v} onChange={() => setPayment(v)} className="mt-0.5 accent-slate-900" />
              <span><span className="font-medium text-slate-900">{l}</span><span className="block text-xs text-slate-500">{h}</span></span>
            </label>
          ))}
        </div>
        {payment === "credit" && (
          <p className="mt-2 inline-flex items-center gap-1.5 text-xs text-amber-700"><FileSignature size={14} /> Saqlangach “Kafolat xati” ochiladi: mijoz rekvizitlari, summa va muddat kataklarini mijoz to&apos;ldirib, imzo va muhr qo&apos;yadi.</p>
        )}
        {payment === "prepay" && (
          <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50/60 p-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr]">
              <Field label="Olingan summa (so'm)" hint="Mijozdan hozir necha pul olindi. 0 — hali olinmagan">
                <Input name="prepayAmount" type="number" step="1000" min="0" placeholder="0" value={prepay} onChange={(e) => setPrepay(e.target.value)} />
              </Field>
              <Field label="Qayerga tushdi" hint="Naqd — kassa, o'tkazma — bank">
                <Select name="prepayAccountId" value={prepayAcc} onChange={(e) => setPrepayAcc(e.target.value)} disabled={prepayN <= 0}>
                  {cashAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}{a.type === "CASH" ? " (naqd)" : " (o'tkazma)"}</option>)}
                </Select>
              </Field>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
              <span className="inline-flex items-center gap-1 text-slate-500"><Wallet size={13} /> Zayavka: <b className="text-slate-900">{money(total)}</b></span>
              {prepayN > 0 && (
                <>
                  <span className="text-emerald-700">Olindi: <b>{money(prepayN)}</b>{total > 0 && ` (${fmtNum(Math.min(100, (prepayN / total) * 100), 0)}%)`}</span>
                  <span className={cn(remaining > 0 ? "text-amber-700" : "text-emerald-700")}>{remaining > 0 ? <>Qoldiq: <b>{money(remaining)}</b></> : "To'liq to'langan"}</span>
                  {total > 0 && prepayN > total + 0.005 && <span className="text-red-600">Summa zayavkadan katta!</span>}
                </>
              )}
              {prepayN <= 0 && <span className="text-slate-400">Pul hali olinmagan — keyin Kassa bo&apos;limi to&apos;lovni kiritadi</span>}
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {[25, 50, 100].map((pc) => (
                <button key={pc} type="button" disabled={total <= 0} onClick={() => setPrepay(String(Math.round((total * pc) / 100)))}
                  className="rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-40">{pc}%</button>
              ))}
              {prepayN > 0 && <button type="button" onClick={() => setPrepay("")} className="px-2 py-0.5 text-[11px] text-slate-500 hover:underline">tozalash</button>}
            </div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Field label="Yetkazish sanasi *"><Input name="deliveryDate" type="date" defaultValue={tomorrow} required /></Field>
        <Field label="Soat *" hint="Obyektga necha da yetkazish"><Input name="deliveryTime" type="time" defaultValue="09:00" step="900" required /></Field>
        <Field label="Obyekt manzili *" className="col-span-2"><Input name="deliveryAddress" placeholder="Ko'cha, mo'ljal, obyekt nomi" required /></Field>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="flex flex-col justify-end gap-2 pb-1">
          <Checkbox name="needsDelivery" defaultChecked label="Dastavka kerak" />
          <span className="-mt-1 text-xs text-slate-500">Belgilanmasa — mijoz o&apos;zi olib ketadi</span>
        </div>
        <div className="flex flex-col justify-end gap-2 pb-1">
          <Checkbox name="isUrgent" label="Zarur (shoshilinch)" />
          <span className="-mt-1 text-xs text-slate-500">Topshiriqlar ro&apos;yxatida birinchi turadi</span>
        </div>
      </div>

      {/* ── Mahsulotlar ── */}
      <div>
        <div className="mb-2 text-sm font-medium text-slate-700">Mahsulotlar *</div>
        <div className="space-y-2">
          {rows.map((r) => {
            const p = products.find((x) => x.id === r.productId);
            const st = stock[r.productId];
            const need = Number(r.qtyM3) || 0;
            return (
              <div key={r.key} className="space-y-2 rounded-lg border border-slate-100 p-2 sm:border-0 sm:p-0">
                <div className="space-y-2 sm:grid sm:grid-cols-[1fr_120px_160px_40px] sm:items-center sm:gap-2 sm:space-y-0">
                  <Select name="productId[]" value={r.productId} onChange={(e) => onProduct(r.key, e.target.value)}>
                    {products.map((x) => {
                      const s = stock[x.id];
                      const have = s ? (s.kind === "piece" ? `erkin ${fmtNum(s.free)}` : `tayyor ${fmtNum(s.free)}`) : null;
                      const more = s && s.canMake != null ? `, yana ${fmtNum(s.canMake)}` : "";
                      return <option key={x.id} value={x.id}>{x.name}{have ? ` — ${have}${more} ${x.unit}` : ""}</option>;
                    })}
                  </Select>
                  <div className="grid grid-cols-[1fr_1fr_auto] items-center gap-2 sm:contents">
                    <Input name="qtyM3[]" type="number" step={p?.unit === "m³" ? "0.5" : "1"} min={p?.unit === "m³" ? "0.5" : "1"} placeholder={p?.unit ?? "m³"} value={r.qtyM3} onChange={(e) => update(r.key, { qtyM3: e.target.value })} required />
                    <Input name="price[]" type="number" step="1" min="0" placeholder={`Narx / ${p?.unit ?? "m³"}`} value={r.price} onChange={(e) => update(r.key, { price: e.target.value })} required />
                    <button type="button" onClick={() => setRows((rs) => rs.length > 1 ? rs.filter((x) => x.key !== r.key) : rs)} className="flex h-10 w-10 items-center justify-center text-slate-400 hover:text-red-600 sm:h-auto sm:w-auto" aria-label="O'chirish"><X size={16} /></button>
                  </div>
                </div>

                {st && (() => {
                  const short = Math.max(0, need - st.free); // tayyor qoldiqdan yetishmaydigan qism
                  const canMake = st.canMake ?? 0;
                  const enough = short === 0 || (st.canMake != null && canMake >= short);
                  return (
                    <div className={cn("text-xs", short > 0 && !enough ? "text-red-600" : short > 0 ? "text-amber-700" : "text-slate-500")}>
                      {st.kind === "piece"
                        ? <>Astatkada erkin: <b>{fmtNum(st.free)} {p?.unit}</b> (jami {fmtNum(st.total)}, band {fmtNum(st.owned)})</>
                        : <>Skladda tayyor: <b>{fmtNum(st.free)} {p?.unit}</b></>}
                      {st.canMake != null && <span> · xomashyodan yana <b>{fmtNum(canMake)} {p?.unit}</b> ishlab chiqarish mumkin</span>}
                      {st.by && <span className="text-slate-400"> · kiritgan: {st.by}</span>}
                      {short > 0 && (st.canMake == null
                        ? <span> — tayyoridan {fmtNum(short)} {p?.unit} yetishmaydi, ishlab chiqarish kerak (retsept kiritilmagan)</span>
                        : enough
                          ? <span> — {fmtNum(short)} {p?.unit} ishlab chiqariladi, xomashyo yetadi</span>
                          : <span> — xomashyo yetmaydi: {fmtNum(short - canMake)} {p?.unit} ga xomashyo kerak</span>)}
                    </div>
                  );
                })()}
                {!st && <div className="text-xs text-slate-400">Bu mahsulot bo&apos;yicha sklad ma&apos;lumoti yo&apos;q — o&apos;ng paneldagi qoldiqdan tekshiring.</div>}
              </div>
            );
          })}
        </div>
        <button type="button" onClick={() => setRows((rs) => [...rs, { key: Date.now(), productId: products[0]?.id ?? "", qtyM3: "", price: products[0]?.price ?? "0" }])} className="mt-2 text-sm font-medium text-slate-700 hover:underline">
          <span className="inline-flex items-center gap-1"><Plus size={14} /> Qator qo&apos;shish</span>
        </button>
        <div className="mt-3 text-right text-base font-semibold">Jami: {fmtNum(total)} so&apos;m</div>
      </div>

      <Checkbox name="needsPump" label="Nasos kerak" />
      <Field label="Izoh"><Textarea name="note" /></Field>
      <div className="flex flex-wrap gap-2 text-xs text-slate-500">
        <span className="inline-flex items-center gap-1"><Truck size={13} /> Dastavka va nasos — logistika uchun</span>
        <span className="inline-flex items-center gap-1"><Zap size={13} /> Zarur — brigadalar uchun ustuvorlik</span>
        <span>Brigadalar zayavka qabul qilingach Ishlab chiqarish bo&apos;limida tayinlanadi</span>
      </div>

      <FormActions>
        <Button disabled={pending || blocked || (mode === "existing" && !customer)}>{pending ? "Saqlanmoqda…" : "Saqlash (qoralama)"}</Button>
        <LinkButton href="/orders" variant="secondary">Bekor</LinkButton>
        {blocked && <span className="inline-flex items-center gap-1 text-xs text-red-600"><ShieldAlert size={14} /> Qora ro&apos;yxatdagi mijozga zayavka ochilmaydi</span>}
      </FormActions>
    </form>
  );
}
