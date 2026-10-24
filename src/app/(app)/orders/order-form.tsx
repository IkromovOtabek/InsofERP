"use client";

import { X, Plus, Search, UserPlus, Users, ShieldAlert, ChevronDown, FileSignature, Truck, Star, Wallet, FileText, Upload, Check, Smartphone } from "lucide-react";
import { AddressPicker } from "@/components/address-picker";
import { fmtNum, isoDate, moneyShort, date as fmtDate } from "@/lib/format";
import { useActionState, useMemo, useState, type ReactNode } from "react";
import { createOrder } from "./actions";
import { lookupAppByPhone } from "../customers/app-actions";
import { Badge, Button, Callout, Field, FormError, Input, LinkButton, Textarea, FormActions } from "@/components/ui";
import { ProductPicker, type CatalogGroup, type CatalogProduct } from "@/components/product-picker";
import { ProductField } from "@/components/product-field";
import { MoneyInput } from "@/components/money-input";
import { ndsOf } from "@/lib/nds";
import { cn } from "@/lib/utils";

type Product = CatalogProduct;
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
 * kind="piece" — hovlidagi dona mahsulot (Sklad → Ishlab chiqarish imkoni; erkin/band), kind="concrete" — beton (zakaz olingach tayyorlanadi,
 * shuning uchun tayyor qoldiq emas, xomashyo yetishi hisobga olinadi).
 * canMake — hozirgi xomashyo qoldig'i bilan retsept bo'yicha yana qancha ishlab chiqarish mumkin.
 */
export type ProductStock = Record<string, { free: number; total: number; owned: number; canMake: number | null; by: string | null; kind: "piece" | "concrete" }>;
/** `price` — kelishilgan narx (NDS'siz); `nds` — shu narxga NDS 12% qo'shilsinmi. */
type Row = { key: number; productId: string; qtyM3: string; price: string; nds: boolean };
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

/** Sayt arizasidan (`/leads` → "Zayavka ochish") kelgan boshlang'ich ma'lumot. */
export type OrderPrefill = { productId?: string | null; qty?: number | null; address?: string | null; note?: string | null; /** amoCRM kelishuvi (`?amo=`) — zayavka unga bog'lanadi */ amoDealId?: string | null };

/** Kichik tanlov tugmalari (blanka ichida): «Kerak | Yo'q», «Naqd | Perechisleniye | Qarzga»… */
type SegOpt<T> = { v: T; l: string; danger?: boolean; disabled?: boolean };
function Seg<T extends string | boolean>({ value, options, onChange, label }: { value: T | null; options: SegOpt<T>[]; onChange: (v: T) => void; label: string }) {
  return (
    <span role="group" aria-label={label} className="inline-flex divide-x divide-slate-300 overflow-hidden rounded-md border border-slate-300 bg-white align-middle text-xs font-semibold not-italic">
      {options.map((o) => (
        <button key={String(o.v)} type="button" aria-pressed={value === o.v} disabled={o.disabled} onClick={() => onChange(o.v)}
          className={cn("px-2.5 py-1 transition disabled:cursor-not-allowed disabled:opacity-40",
            value === o.v ? (o.danger ? "bg-red-600 text-white" : "bg-[#25236b] text-white") : "text-slate-600 hover:bg-slate-100")}>
          {o.l}
        </button>
      ))}
    </span>
  );
}

/** Mahsulot qatori ostidagi qisqa qoldiq izohi: beton — xomashyodan qancha chiqadi, dona — hovlidagi erkin qoldiq. */
function StockNote({ st, need, unit }: { st?: ProductStock[string]; need: number; unit: string }) {
  if (!st) return <div className="text-[11px] text-slate-400">Sklad ma&apos;lumoti yo&apos;q</div>;
  if (st.kind === "concrete") {
    if (st.canMake == null) return <div className="text-[11px] text-slate-400">Retsept kiritilmagan — xomashyo yetishi hisoblanmaydi</div>;
    const short = need > 0 && st.canMake < need;
    return <div className={cn("text-[11px]", short ? "text-red-600" : "text-slate-500")}>Xomashyodan {fmtNum(st.canMake)} {unit} chiqadi{short ? ` — yana ${fmtNum(need - st.canMake)} ${unit} lik xomashyo kerak` : ""}</div>;
  }
  const short = Math.max(0, need - st.free);
  const canMake = st.canMake ?? 0;
  const enough = short === 0 || (st.canMake != null && canMake >= short);
  return (
    <div className={cn("text-[11px]", short > 0 && !enough ? "text-red-600" : short > 0 ? "text-amber-700" : "text-slate-500")}>
      Hovlida erkin {fmtNum(st.free)} {unit}{st.canMake != null ? `, xomashyodan yana ${fmtNum(canMake)}` : ""}
      {short > 0 && (enough ? ` — ${fmtNum(short)} ${unit} ishlab chiqariladi` : st.canMake == null ? ` — ${fmtNum(short)} ${unit} yetishmaydi` : ` — xomashyo yetmaydi`)}
    </div>
  );
}

/**
 * Yangi zayavka — «Hujjat ko'rinishi»: mijozga beriladigan tijorat taklifi blankasi ko'rinishida to'ldiriladi
 * (rekvizitlar, mijoz bloki, QQS ustunli jadval, dastavka qatori, to'lov va bosh to'lov). Dizayn manbasi:
 * `docs/design/zayavka-shablonlar.html`; oldingi forma — `git tag zayavka-forma-eski`.
 */
export function OrderForm({ customers, products, groups, canCreateProduct, stock, preselectCustomer, contractAccept, geoSearch, prefill, newCustomerLimit = 0, docHeader, managerName }: { customers: CustomerOpt[]; products: Product[]; groups: CatalogGroup[]; canCreateProduct: boolean; stock: ProductStock; cashAccounts?: CashAccountOpt[]; preselectCustomer?: string; contractAccept: string; geoSearch: boolean; prefill?: OrderPrefill; /** Yangi mijozga standart kredit limiti (Sozlamalar → Limitlar) */ newCustomerLimit?: number; /** Blanka sarlavhasi: nom, rasm, rekvizitlar (serverda yig'iladi) */ docHeader?: ReactNode; /** Zayavkani ochayotgan xodim — «Menejer» */ managerName: string }) {
  const [state, action, pending] = useActionState(createOrder, undefined);
  const [mode, setMode] = useState<"existing" | "new">("existing");
  // "Yangi mijoz" telefoni ilovada ro'yxatdan o'tganmi — saqlanganda hisob o'zi ulanadi, sotuvchi buni oldindan ko'radi
  const [appHint, setAppHint] = useState<{ fullName: string | null; orgName: string; registered: boolean } | null>(null);
  const checkApp = (phone: string) => {
    setAppHint(null);
    if (phone.replace(/\D/g, "").length < 9) return;
    void lookupAppByPhone(phone).then((r) => setAppHint(r && r.registered ? r : null)).catch(() => setAppHint(null));
  };
  const [customer, setCustomer] = useState<CustomerOpt | null>(customers.find((c) => c.id === preselectCustomer) ?? null);
  // To'lov turi: naqd (kassa) / perechisleniye (bank) — oldindan to'lov (`payment=prepay`), qarzga — kredit limitdan
  const [kind, setKind] = useState<"cash" | "bank" | "credit">("cash");
  const payment: "prepay" | "credit" = kind === "credit" ? "credit" : "prepay";
  // Qarzga zayavkada QQS ixtiyoriy: «QQS 12%» tugmasi bosilsa QQS ustunlari chiqadi va hisoblanadi
  const [creditVat, setCreditVat] = useState(false);
  // Qarzga zayavkadagi bosh to'lov qanday keladi (sukut — naqd)
  const [depMethod, setDepMethod] = useState<"CASH" | "BANK">("CASH");
  const [prepay, setPrepay] = useState("");
  const [hasDeposit, setHasDeposit] = useState(false);
  const [dateKnown, setDateKnown] = useState(true); // «Aniq emas» — qoralamada keyin belgilanadi
  const [contract, setContract] = useState(false); // "Shartnoma qilish" belgilanganmi
  const [contractAmount, setContractAmount] = useState("");
  const [needsPump, setNeedsPump] = useState(false);
  const [isUrgent, setIsUrgent] = useState(false);
  // Dastavka — jadvaldagi alohida qator: reyslar soni × bitta reys narxi (+ QQS); serverga jami summa boradi
  const [needsDelivery, setNeedsDelivery] = useState(true);
  const [trips, setTrips] = useState("1");
  const [tripPrice, setTripPrice] = useState("");
  const [tripNds, setTripNds] = useState(false);
  // Arizadan kelgan mahsulot ro'yxatda bo'lsa — birinchi qator shu bilan to'ldiriladi
  const firstProduct = products.find((p) => p.id === prefill?.productId) ?? products[0];
  const [rows, setRows] = useState<Row[]>([{ key: 1, productId: firstProduct?.id ?? "", qtyM3: firstProduct && firstProduct.id === prefill?.productId && prefill?.qty ? String(prefill.qty) : "", price: firstProduct?.price ?? "0", nds: false }]);
  const [pickFor, setPickFor] = useState<number | null>(null); // qaysi qator uchun spravochnik ochiq

  // Mahsulot yonidagi qoldiq izohi: beton — xomashyodan qancha chiqadi, dona mahsulot — hovlidagi erkin qoldiq
  const stockHint = (x: Product) => {
    const st = stock[x.id];
    if (!st) return null;
    return st.kind === "piece"
      ? `erkin ${fmtNum(st.free)}${st.canMake != null ? `, yana ${fmtNum(st.canMake)}` : ""} ${x.unit}`
      : st.canMake != null ? `xomashyodan ${fmtNum(st.canMake)} ${x.unit}` : null;
  };

  const update = (key: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const setAllNds = (on: boolean) => { setRows((rs) => rs.map((r) => ({ ...r, nds: on }))); setTripNds(on); };

  /**
   * To'lov turi: perechisleniyeda barcha qatorlarga (dastavkaga ham) QQS 12% qo'shiladi; naqdda QQS hisoblanmaydi —
   * ustunlari ham ko'rinmaydi; qarzga — QQS'siz boshlanadi, «QQS 12%» tugmasi bilan yoqiladi.
   */
  const pickPayment = (v: "cash" | "bank" | "credit") => {
    setKind(v);
    setCreditVat(false);
    setAllNds(v === "bank");
  };
  const toggleCreditVat = () => { const on = !creditVat; setCreditVat(on); setAllNds(on); };
  const showVat = kind === "bank" || (kind === "credit" && creditVat);
  // Server uchun bosh to'lov usuli: naqd/perechisleniye — o'zi; qarzga — bosh to'lov bo'lsa tanlangani, bo'lmasa yuborilmaydi
  const payMethod = kind === "cash" ? "CASH" : kind === "bank" ? "BANK" : hasDeposit && Number(prepay) > 0 ? depMethod : null;
  // Izohlar uchun: bosh to'lov qaysi yo'l bilan keladi (summa hali kiritilmagan bo'lsa ham)
  const depBank = kind === "bank" || (kind === "credit" && depMethod === "BANK");
  const onProduct = (key: number, productId: string) =>
    update(key, { productId, price: products.find((p) => p.id === productId)?.price ?? "0" });

  // Narx katagida QQS'siz narx turadi; QQS belgilangan qatorda soliq ustiga qo'shiladi (server ham shunday saqlaydi)
  const lineOf = (qty: string, price: string, nds: boolean) => {
    const sum = (Number(qty) || 0) * (Number(price) || 0);
    const vat = showVat && nds ? (Number(qty) || 0) * ndsOf(Number(price) || 0) : 0;
    return { sum, vat, total: sum + vat };
  };
  const lines = rows.map((r) => lineOf(r.qtyM3, r.price, r.nds));
  const fee = needsDelivery ? lineOf(trips, tripPrice, tripNds) : { sum: 0, vat: 0, total: 0 };
  const sumNoNds = lines.reduce((s, l) => s + l.sum, 0) + fee.sum;
  const ndsSum = lines.reduce((s, l) => s + l.vat, 0) + fee.vat;
  const total = sumNoNds + ndsSum; // mijoz to'laydigan summa — limit, bosh to'lov va shartnoma shu bo'yicha
  const units = new Set(rows.map((r) => products.find((p) => p.id === r.productId)?.unit ?? "m³"));
  const totalQty = rows.reduce((s, r) => s + (Number(r.qtyM3) || 0), 0);
  const tomorrow = isoDate(new Date(Date.now() + 86400000));
  const minDate = isoDate(new Date(Date.now() - 86400000)); // server ham kechagidan oldingi sanani qabul qilmaydi
  const prepayN = hasDeposit ? Number(prepay) || 0 : 0;
  const remaining = Math.max(0, total - prepayN);
  const overLimit = mode === "existing" && customer ? customer.used + total > customer.limit : false;
  // Qora ro'yxat (kredit limiti yo'q/to'lgan): faqat kredit yopiq — to'liq oldindan to'lov bilan zayavka ochiladi
  const noCredit = mode === "existing" && !!customer?.blacklisted;
  const blocked = noCredit && (payment === "credit" || total <= 0 || prepayN < total - 0.005);
  const contractN = Number(contractAmount) || 0;
  const contractLeft = contractN - total; // shartnoma summasidan zayavka summasi ayirilgan qoldiq

  const cell = "border border-slate-300 px-2 py-1";
  const th = `${cell} bg-slate-100 text-center font-serif text-[13px] font-bold italic leading-tight text-[#2f6fc9]`;
  const num = `${cell} text-right font-serif italic tabular-nums whitespace-nowrap`;
  const cols = showVat ? 8 : 6;
  const lbl = "text-right font-serif text-[13px] font-bold italic text-slate-900";

  return (
    <form action={action} className="space-y-4">
      <FormError error={state?.error} />
      <input type="hidden" name="customerMode" value={mode} />
      <input type="hidden" name="payment" value={payment} />
      {payMethod && <input type="hidden" name="payMethod" value={payMethod} />}
      {needsPump && <input type="hidden" name="needsPump" value="on" />}
      {isUrgent && <input type="hidden" name="isUrgent" value="on" />}
      {needsDelivery && <input type="hidden" name="needsDelivery" value="on" />}
      <input type="hidden" name="deliveryFee" value={needsDelivery ? String(Math.round(fee.total * 100) / 100) : "0"} />

      {/* ═══ Blanka ═══ */}
      <div className="rounded-(--radius-card) border border-slate-200/80 bg-white p-4 shadow-(--shadow-card) sm:p-6">
        {docHeader}

        {/* ── Sarlavha va mijoz bloki ── */}
        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,460px)] lg:items-start">
          <div>
            <div className="font-serif text-base font-bold italic text-slate-900">Zayavka</div>
            <div className="font-serif text-[13px] font-bold italic text-slate-700">№ saqlanganda beriladi · {fmtDate(new Date())}</div>
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-slate-600">
              <span className="inline-flex items-center gap-1.5">Nasos <Seg label="Nasos" value={needsPump} onChange={setNeedsPump} options={[{ v: true, l: "Kerak" }, { v: false, l: "Yo'q" }]} /></span>
              <span className="inline-flex items-center gap-1.5">Ustuvorlik <Seg label="Ustuvorlik" value={isUrgent} onChange={setIsUrgent} options={[{ v: true, l: "Zarur", danger: true }, { v: false, l: "Oddiy" }]} /></span>
            </div>
          </div>

          <div className="grid w-full max-w-[460px] grid-cols-1 gap-x-3 gap-y-2 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-center lg:justify-self-end">
            <span className={lbl}>{kind === "cash" ? "Mijoz:" : "Firma:"}</span>
            <div className="min-w-0">
              <div className="mb-1 flex justify-end gap-3 text-[11px] font-medium">
                <button type="button" onClick={() => setMode("existing")} className={cn("inline-flex items-center gap-1", mode === "existing" ? "text-slate-900 underline" : "text-slate-500 hover:text-slate-800")}><Users size={12} /> Mavjud mijoz</button>
                <button type="button" onClick={() => setMode("new")} className={cn("inline-flex items-center gap-1", mode === "new" ? "text-slate-900 underline" : "text-slate-500 hover:text-slate-800")}><UserPlus size={12} /> Yangi mijoz</button>
              </div>
              {mode === "existing" ? (
                <CustomerPicker customers={customers} value={customer} onChange={(c) => {
                  setCustomer(c);
                  // Kredit limiti yo'q mijoz: to'lov turi darhol "naqd" va bosh to'lov ochiq — sotuvchi summani kiritadi
                  if (c?.blacklisted) { if (kind === "credit") pickPayment("cash"); setHasDeposit(true); }
                }} />
              ) : (
                <Input name="newName" placeholder={kind === "cash" ? "Mijoz nomi" : "Firma nomi"} required aria-label="Yangi mijoz nomi" />
              )}
            </div>

            {/* Naqd to'lovda — kim olib ketishi / to'laydigan odamning ismi; perechisleniye va qarzga — firma, ism shart emas */}
            {kind === "cash" && (<>
              <span className={lbl}>Ism:</span>
              <Input name="contactName" placeholder="Mijozning ismi" aria-label="Mijozning ismi" className="h-9" />
            </>)}

            <span className={lbl}>Telefon:</span>
            {mode === "existing"
              ? <span className="border-b border-slate-300 px-1 py-1 text-center font-serif italic text-slate-900">{customer?.phone || "—"}</span>
              : <Input name="newPhone" placeholder="+998 __ ___ __ __" onBlur={(e) => checkApp(e.target.value)} aria-label="Telefon" />}

            {mode === "new" && (<>
              <span className={lbl}>INN:</span>
              <Input name="newInn" placeholder="9 yoki 14 raqam" aria-label="INN" />
            </>)}

            <span className={lbl}>Yetkazish sanasi:</span>
            <div className="flex flex-wrap items-center gap-2">
              {dateKnown
                ? <Input name="deliveryDate" type="date" defaultValue={tomorrow} min={minDate} required aria-label="Yetkazish sanasi" className="w-auto min-w-0 flex-1" />
                : <><input type="hidden" name="dateUnknown" value="1" /><span className="flex-1 font-serif text-sm italic text-slate-500">kelishilmoqda — sanani keyin belgilaysiz</span></>}
              <Seg label="Sana aniqmi" value={dateKnown} onChange={setDateKnown} options={[{ v: true, l: "Aniq" }, { v: false, l: "Aniq emas" }]} />
            </div>

            <span className={lbl}>Menejer:</span>
            <span className="border-b border-slate-300 px-1 py-1 text-center font-serif italic text-slate-900">{managerName}</span>
          </div>
        </div>

        {/* ── Tanlangan mijoz: xarid tarixi, qarz va limit ── */}
        {mode === "existing" && customer && (
          <div className={cn("mt-4 rounded-lg border p-3 text-xs", customer.blacklisted ? "border-red-200 bg-red-50/60" : "border-slate-100 bg-slate-50/60")}>
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
        {noCredit && customer && (
          <div className="mt-3"><Callout tone="danger" title="Kredit limiti yo'q — faqat oldindan to'lov bilan">
            Limit {money(customer.limit)}, qarz va ochiq zayavkalar {money(customer.used)}. Qarzga zayavka ochilmaydi — bosh to&apos;lov zayavka summasiga teng bo&apos;lsin (pul kassaga tushmaguncha reys ochilmaydi). Qarzga berish kerak bo&apos;lsa direktor limitni oshiradi.
          </Callout></div>
        )}
        {!noCredit && overLimit && customer && (
          <div className="mt-3"><Callout tone="warning" title="Limit yetmaydi">Bu zayavka bilan ishlatilgan summa {money(customer.used + total)} bo&apos;ladi, limit {money(customer.limit)}. Qabul qilinganda zayavka bloklanadi — direktor ochishi kerak.</Callout></div>
        )}
        {mode === "new" && (
          <div className="mt-3 space-y-2 text-xs text-slate-500">
            <p>
              {newCustomerLimit > 0
                ? <>Yangi mijozga standart kredit limiti <b>{money(newCustomerLimit)}</b> beriladi — undan oshgan qarz zayavkasi qabul qilinganda bloklanadi (direktor ochadi yoki limitni oshiradi).</>
                : <>Yangi mijozning kredit limiti <b>0</b> — qarzga zayavka qabul qilinganda bloklanadi (direktor ochadi yoki limit beradi).</>}
              {" "}Mijoz zayavka bilan birga saqlanadi.
            </p>
            {appHint && (
              <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50/60 p-2.5 text-emerald-800">
                <Smartphone size={14} className="mt-0.5 shrink-0" />
                <span>Bu raqam ilovada ro&apos;yxatdan o&apos;tgan: <b>{appHint.fullName ?? appHint.orgName}</b>{appHint.fullName && appHint.orgName !== appHint.fullName ? ` (${appHint.orgName})` : ""}. Zayavka saqlangach mijoz o&apos;sha hisobga ulanadi va zayavkani ilovada kuzatadi.</span>
              </div>
            )}
          </div>
        )}

        {/* ── Obyekt: manzil, (izoh) va xarita ── */}
        <div className="mt-4 grid grid-cols-2 gap-2">
          <AddressPicker searchEnabled={geoSearch} required defaultAddress={prefill?.address ?? ""} label="Obyekt" />
          <div className="col-span-2 flex items-center gap-1 font-serif italic text-slate-600">
            (<Input name="addressNote" placeholder="izoh: mo'ljal, darvoza, qavat…" aria-label="Obyekt izohi" className="h-8 text-sm" />)
          </div>
        </div>

        {/* ── Jadval ── */}
        <div className="mt-4 overflow-x-auto">
          <table className={cn("w-full border-collapse text-[13px]", showVat ? "min-w-[860px]" : "min-w-[680px]")}>
            <thead>
              <tr>
                <th className={cn(th, "w-10")}>№</th>
                <th className={th}>Mahsulot nomi, turi</th>
                <th className={cn(th, "w-20")}>O&apos;lchov birligi</th>
                <th className={cn(th, "w-24")}>Soni</th>
                <th className={cn(th, "w-36")}>Narxi</th>
                <th className={cn(th, "w-32")}>Summa</th>
                {showVat && <th className={cn(th, "w-28")}>QQS 12%</th>}
                {showVat && <th className={cn(th, "w-36")}>Umumiy summa QQS bilan</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const p = products.find((x) => x.id === r.productId);
                const unit = p?.unit ?? "m³"; // mahsulotning o'z birligi: beton m³, ustun/blok dona
                const l = lines[i]!;
                return (
                  <tr key={r.key} className="align-top">
                    <td className={cn(cell, "text-center font-serif italic")}>
                      <div className="pt-2">{i + 1}</div>
                      {rows.length > 1 && <button type="button" onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))} className="mt-1 text-slate-400 hover:text-red-600" aria-label="Qatorni o'chirish"><X size={14} /></button>}
                    </td>
                    <td className={cn(cell, "min-w-[220px]")}>
                      <input type="hidden" name="productId[]" value={r.productId} />
                      <input type="hidden" name="nds[]" value={showVat && r.nds ? "1" : "0"} />
                      {/* Yozilgan harflar bo'yicha qidiradi; "…" tugmasi papkali spravochnikni ochadi */}
                      <ProductField products={products} value={r.productId} onPick={(id) => onProduct(r.key, id)} onOpenPicker={() => setPickFor(r.key)} hint={stockHint} />
                      <div className="mt-1"><StockNote st={stock[r.productId]} need={Number(r.qtyM3) || 0} unit={unit} /></div>
                    </td>
                    <td className={cn(cell, "pt-3 text-center font-serif italic")}>{unit}</td>
                    <td className={cell}>
                      <Input name="qtyM3[]" type="number" step={unit === "m³" ? "0.5" : "1"} min={unit === "m³" ? "0.5" : "1"} placeholder="0" aria-label="Soni"
                        value={r.qtyM3} onChange={(e) => update(r.key, { qtyM3: e.target.value })} required
                        className="h-9 text-right [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" />
                    </td>
                    <td className={cell}><MoneyInput name="price[]" value={r.price} onChange={(v) => update(r.key, { price: v })} placeholder="0" suffix={null} required ariaLabel={`Narxi / ${unit}`} className="h-9" /></td>
                    <td className={cn(num, "pt-3")}>{fmtNum(l.sum)}</td>
                    {showVat && (
                      <td className={cn(num, "pt-2")}>
                        {/* Qator QQS'i: bosilsa shu qatordan olib tashlanadi / qaytariladi */}
                        <button type="button" onClick={() => update(r.key, { nds: !r.nds })} aria-pressed={r.nds} title={r.nds ? "QQS 12% — olib tashlash" : "Shu qatorga QQS 12% qo'shish"}
                          className={cn("w-full rounded px-1 py-1 text-right hover:bg-slate-100", r.nds ? "text-slate-900" : "text-slate-400")}>{r.nds ? fmtNum(l.vat) : "QQSsiz"}</button>
                      </td>
                    )}
                    {showVat && <td className={cn(num, "pt-3 font-semibold")}>{fmtNum(l.total)}</td>}
                  </tr>
                );
              })}

              {/* Dastavka — alohida qator: reys soni × bitta reys narxi (+ QQS) */}
              {needsDelivery ? (
                <tr className="bg-amber-50/60 align-top">
                  <td className={cn(cell, "pt-3 text-center font-serif italic")}>{rows.length + 1}</td>
                  <td className={cell}>
                    <label className="flex cursor-pointer items-center gap-2 pt-1.5 font-serif font-bold italic text-slate-900">
                      <input type="checkbox" checked onChange={() => setNeedsDelivery(false)} className="h-[18px] w-[18px] accent-[#25236b]" /> Dastavka
                      <Truck size={14} className="text-slate-400" />
                    </label>
                  </td>
                  <td className={cn(cell, "pt-3 text-center font-serif italic")}>reys</td>
                  <td className={cell}>
                    <Input type="number" min="1" step="1" value={trips} onChange={(e) => setTrips(e.target.value)} aria-label="Reyslar soni"
                      className="h-9 text-right [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" />
                  </td>
                  <td className={cell}><MoneyInput value={tripPrice} onChange={setTripPrice} placeholder="0" suffix={null} ariaLabel="Bitta reys narxi" className="h-9" /></td>
                  <td className={cn(num, "pt-3")}>{fmtNum(fee.sum)}</td>
                  {showVat && (
                    <td className={cn(num, "pt-2")}>
                      <button type="button" onClick={() => setTripNds((v) => !v)} aria-pressed={tripNds} title={tripNds ? "QQS 12% — olib tashlash" : "Dastavkaga QQS 12% qo'shish"}
                        className={cn("w-full rounded px-1 py-1 text-right hover:bg-slate-100", tripNds ? "text-slate-900" : "text-slate-400")}>{tripNds ? fmtNum(fee.vat) : "QQSsiz"}</button>
                    </td>
                  )}
                  {showVat && <td className={cn(num, "pt-3 font-semibold")}>{fmtNum(fee.total)}</td>}
                </tr>
              ) : (
                <tr>
                  <td className={cn(cell, "text-center font-serif italic")}>{rows.length + 1}</td>
                  <td className={cell} colSpan={cols - 1}>
                    <label className="flex cursor-pointer items-center gap-2 py-1 font-serif font-bold italic text-slate-900">
                      <input type="checkbox" checked={false} onChange={() => setNeedsDelivery(true)} className="h-[18px] w-[18px] accent-[#25236b]" /> Dastavka kerak
                      <span className="font-normal text-slate-500">— belgilanmagan: mijoz o&apos;zi olib ketadi</span>
                    </label>
                  </td>
                </tr>
              )}

              <tr>
                <td className={cn(cell, "text-center font-serif italic")}>{rows.length + 2}</td>
                <td className={cell} colSpan={cols - 1}>
                  <button type="button" onClick={() => setRows((rs) => [...rs, { key: Date.now(), productId: products[0]?.id ?? "", qtyM3: "", price: products[0]?.price ?? "0", nds: showVat }])}
                    className="inline-flex items-center gap-1 py-1 font-serif text-sm italic text-[#2f6fc9] hover:underline"><Plus size={14} /> mahsulot qo&apos;shish</button>
                </td>
              </tr>

              <tr className="font-bold">
                <td className={cell} />
                <td className={cell} />
                <td className={cn(cell, "text-center font-serif italic")}>Jami</td>
                <td className={num}>{units.size === 1 ? fmtNum(totalQty) : ""}</td>
                <td className={cell} />
                <td className={num}>{fmtNum(sumNoNds)}</td>
                {showVat && <td className={num}>{fmtNum(ndsSum)}</td>}
                {showVat && <td className={num}>{fmtNum(total)}</td>}
              </tr>
            </tbody>
          </table>
        </div>

        <ProductPicker
          open={pickFor !== null}
          products={products}
          groups={groups}
          canCreate={canCreateProduct}
          onClose={() => setPickFor(null)}
          onPick={(id) => { if (pickFor !== null) onProduct(pickFor, id); }}
          hint={stockHint}
        />

        {/* ── To'lov va bosh to'lov ── */}
        <div className="mt-4 grid grid-cols-1 gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,320px)]">
          <div>
            <div className="mb-1.5 text-xs font-semibold text-slate-600">To&apos;lov</div>
            <div className="flex flex-wrap items-center gap-2">
              <Seg label="To'lov turi" value={kind} onChange={pickPayment} options={[
                { v: "cash", l: "Naqd" }, { v: "bank", l: "Perechisleniye" }, { v: "credit", l: "Qarzga", disabled: noCredit },
              ]} />
              {kind === "credit" && <Seg label="QQS" value={creditVat ? "on" : null} onChange={toggleCreditVat} options={[{ v: "on", l: "QQS 12%" }]} />}
            </div>
            <p className="mt-2 text-xs text-slate-500">
              {kind === "cash" && "Naqd to'lovda QQS hisoblanmaydi — QQS ustunlari olib tashlandi. Pulni Kassa xodimi qabul qiladi."}
              {kind === "bank" && "Perechisleniyeda barcha qatorlarga QQS 12% qo'shildi (qator QQS katagini bosib olib tashlash mumkin). Tushumni Buxgalter tasdiqlaydi."}
              {kind === "credit" && (creditVat ? "Qarzga, QQS 12% bilan." : "Qarzga, QQS'siz — kerak bo'lsa «QQS 12%» tugmasini bosing.")}
            </p>
            {kind === "credit" && (
              <p className="mt-1 inline-flex items-center gap-1.5 text-xs text-amber-700"><FileSignature size={14} /> Saqlangach “Kafolat xati” ochiladi — mijoz to&apos;ldirib, imzo va muhr qo&apos;yadi.</p>
            )}
          </div>

          <div className="space-y-2 font-serif text-sm italic">
            <div className="flex items-center justify-between gap-3">
              <span>Bosh to&apos;lov</span>
              <Seg label="Bosh to'lov bormi" value={hasDeposit} onChange={(v) => { setHasDeposit(v); if (!v) setPrepay(""); }} options={[{ v: false, l: "Yo'q" }, { v: true, l: "Bor" }]} />
            </div>
            {hasDeposit && (
              <>
                {kind === "credit" && (
                  <div className="flex items-center justify-between gap-3 not-italic">
                    <span className="text-xs text-slate-500">qanday keladi</span>
                    <Seg label="Bosh to'lov usuli" value={depMethod} onChange={setDepMethod} options={[{ v: "CASH", l: "Naqd" }, { v: "BANK", l: "Perechisleniye" }]} />
                  </div>
                )}
                <MoneyInput name="prepayAmount" value={prepay} onChange={setPrepay} placeholder="Bosh to'lov summasi" ariaLabel="Bosh to'lov summasi" />
                <div className="flex flex-wrap items-center justify-end gap-1.5 not-italic">
                  {[30, 50, 100].map((pc) => (
                    <button key={pc} type="button" disabled={total <= 0} onClick={() => setPrepay(String(Math.round((total * pc) / 100)))}
                      className="rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-40">{pc}%</button>
                  ))}
                </div>
                <p className="inline-flex items-center gap-1 text-xs not-italic text-slate-500"><Wallet size={13} /> {depBank ? "Buxgalterga «bankka tushum kutilmoqda» so'rovi boradi" : "Kassa xodimiga «pul keladi» so'rovi boradi"}</p>
                {total > 0 && prepayN > total + 0.005 && <p className="text-xs not-italic text-red-600">Bosh to&apos;lov zayavka summasidan katta!</p>}
              </>
            )}
            <div className="flex items-center justify-between gap-3"><span>Jami</span><b className="tabular-nums">{fmtNum(total)}</b></div>
            {prepayN > 0 && <div className="flex items-center justify-between gap-3"><span>Avans</span><b className="tabular-nums text-emerald-700">{fmtNum(prepayN)}</b></div>}
            <div className="flex items-center justify-between gap-3 border-t border-slate-800 pt-1.5 text-base">
              <b>{payment === "credit" ? "Qarzga qoladi" : "Qoldiq"}</b><b className="tabular-nums">{fmtNum(remaining)} so&apos;m</b>
            </div>
          </div>
        </div>
      </div>

      {/* ═══ Blankadan tashqari: shartnoma va izoh ═══ */}
      <div className="space-y-4 rounded-(--radius-card) border border-slate-200/80 bg-white p-4 shadow-(--shadow-card) sm:p-6">
        <div>
          <input type="hidden" name="hasContract" value={contract ? "on" : ""} />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[13px] font-medium text-slate-700">Shartnoma</span>
            <button type="button" onClick={() => setContract((v) => !v)} aria-pressed={contract}
              className={cn("inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition", contract ? "border-blue-600 bg-blue-600 text-white hover:bg-blue-700" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50")}>
              {contract ? <Check size={15} /> : <FileText size={15} />} {contract ? "Shartnoma qilinadi" : "Shartnoma qilish"}
            </button>
          </div>
          {contract && (
            <div className="mt-2 rounded-lg border border-blue-200 bg-blue-50/50 p-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Shartnoma summasi *" hint="Shartnomada ko'rsatilgan umumiy summa">
                  <MoneyInput name="contractAmount" value={contractAmount} onChange={setContractAmount} required={contract} />
                </Field>
                <div className="flex flex-col justify-end gap-1 pb-1 text-xs">
                  <div className="flex justify-between gap-3"><span className="text-slate-500">Shartnoma summasi</span><b className="text-slate-900">{money(contractN)}</b></div>
                  <div className="flex justify-between gap-3"><span className="text-slate-500">− Zayavka summasi</span><b className="text-slate-900">{money(total)}</b></div>
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
              <p className="mt-2 inline-flex items-center gap-1.5 text-xs text-blue-800"><Upload size={14} /> Saqlangach shartnoma raqami beriladi. Didox&apos;da imzolangan shartnoma tizimga isbot sifatida yuklanadi.</p>
              {contractN > 0 && contractLeft < 0 && <p className="mt-1 text-xs text-red-600">Zayavka summasi shartnoma summasidan katta — summani tekshiring.</p>}
            </div>
          )}
        </div>

        <Field label="Izoh"><Textarea name="note" defaultValue={prefill?.note ?? ""} /></Field>
        {prefill?.amoDealId ? <input type="hidden" name="amoDealId" value={prefill.amoDealId} /> : null}

        <FormActions>
          <Button disabled={pending || blocked || (mode === "existing" && !customer)}>{pending ? "Saqlanmoqda…" : "Saqlash (qoralama)"}</Button>
          <LinkButton href="/orders" variant="secondary">Bekor</LinkButton>
          {blocked && <span className="inline-flex items-center gap-1 text-xs text-red-600"><ShieldAlert size={14} /> Kredit limiti yo&apos;q — faqat oldindan to&apos;lov bilan: bosh to&apos;lov {money(total)} bo&apos;lsin</span>}
          {mode === "existing" && !customer && <span className="text-xs text-slate-500">Avval mijozni tanlang</span>}
        </FormActions>
      </div>
    </form>
  );
}
