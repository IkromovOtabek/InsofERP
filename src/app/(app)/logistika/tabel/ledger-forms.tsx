"use client";

import { createContext, startTransition, useActionState, useCallback, useContext, useEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Pencil, Plus, X } from "lucide-react";
import { createLedgerRowAction, fixTripKmAction, ledgerRowAction, updateLedgerRowAction } from "../actions";
import type { LedgerKind } from "@/lib/driver-ledger";
import type { LedgerEditData } from "@/lib/ledger-edit";
import { today } from "@/lib/davomat";
import { fmtNum } from "@/lib/format";
import { LEDGER_REVENUE_LABEL, LEDGER_REVENUE_TYPES } from "@/lib/ledger-revenue";
import { Button, Field, FormError, FormSuccess, IconButton, InfoButton, Input, Select } from "@/components/ui";
import { cn } from "@/lib/utils";

/**
 * Yuborish — `onSubmit` + `startTransition`: `<form action>` bo'lsa React 19 xato bilan qaytgan amaldan keyin ham formani
 * tozalaydi va yozilgan qiymatlar yo'qoladi (`realizatsiya/forms.tsx` dagi kabi).
 */
const submitWith = (action: (fd: FormData) => void) => (e: React.FormEvent<HTMLFormElement>) => {
  e.preventDefault();
  const fd = new FormData(e.currentTarget);
  startTransition(() => action(fd));
};

/** Kirim turi: dostavka / usluga (perech. yoki naqd) va «Obyekt» — zavodning o'zi uchun ish. */
const REVENUE_OPTIONS = <><option value="">—</option>{LEDGER_REVENUE_TYPES.map((t) => <option key={t} value={t}>{LEDGER_REVENUE_LABEL[t]}</option>)}</>;

export type LedgerVehicle = {
  id: string; plate: string; driverId: string | null; unit: string;
  /** Kuzatiladigan yoqilg'i normasi: 100 km ga va baraban soatiga (metan m³ yoki dizel l) */
  per100: number; perHour: number; lastPrice: number | null;
};
export type LedgerOptions = {
  vehicles: LedgerVehicle[]; drivers: { id: string; name: string }[];
  pickups: string[]; dropoffs: string[]; cargos: string[];
};

const num = (v: string) => Number(v.replace(",", ".")) || 0;

/** Varaq ro'yxatlari (transport, haydovchi, joy/yuk nomlari) — qator qo'shish va tahrir oynasi uchun bir marta beriladi. */
const LedgerCtx = createContext<{ options: LedgerOptions; canPay: boolean } | null>(null);
export function LedgerFormsProvider({ options, canPay, children }: { options: LedgerOptions; canPay: boolean; children: React.ReactNode }) {
  return <LedgerCtx.Provider value={{ options, canPay }}>{children}</LedgerCtx.Provider>;
}
const EMPTY: LedgerOptions = { vehicles: [], drivers: [], pickups: [], dropoffs: [], cargos: [] };

/**
 * Hisob varag'iga qo'lda qator — ECO'ga tushmagan reys (Excel'dagi ustunlar tartibida). Transport — ochiq varaqniki,
 * haydovchi — transportning asosiy haydovchisi (o'zgartirish mumkin). Zapravka va xarajatlar shu qator bilan birga
 * yoziladi; haq ish boshqaruvchi tasdig'iga boradi. Saqlangach forma ochiq qoladi — keyingi qatorni darhol yozish uchun.
 */
export function LedgerRowForm({ vehicleId, clientToken }: { vehicleId: string | null; clientToken: string }) {
  const [open, setOpen] = useState(false);
  const options = useContext(LedgerCtx)?.options ?? EMPTY;
  if (!open) return <Button onClick={() => setOpen(true)}><Plus size={16} /> Qator qo&apos;shish</Button>;
  return <RowForm options={options} vehicleId={vehicleId} clientToken={clientToken} onClose={() => setOpen(false)} />;
}

function RowForm({ options, vehicleId, clientToken, onClose }: { options: LedgerOptions; vehicleId: string | null; clientToken: string; onClose: () => void }) {
  const [state, action, pending] = useActionState(createLedgerRowAction, undefined);
  const router = useRouter();
  // Saqlangach forma qayta chiziladi (bo'sh holatga, transport va sana qoladi) va yangi bir martalik kalit olinadi
  const [round, setRound] = useState(0);
  const [token, setToken] = useState(clientToken);
  const [vid, setVid] = useState(vehicleId ?? "");
  const [date, setDate] = useState(today());
  useEffect(() => { if (state?.ok) { setRound((n) => n + 1); setToken(crypto.randomUUID()); router.refresh(); } }, [state, router]);
  const v = options.vehicles.find((x) => x.id === vid) ?? null;
  return (
    <div className="space-y-3 rounded-(--radius-card) border border-slate-200 bg-white p-4 shadow-(--shadow-card)">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">Qo&apos;lda qator{v ? ` — ${v.plate}` : ""}
            <InfoButton title="Qo'lda qator" className="ml-1">ECO&apos;ga tushmagan reys. Zapravka va xarajat shu mashinaga yoziladi, haq ish boshqaruvchi tasdig&apos;iga boradi.</InfoButton>
          </h3>
        </div>
        <button type="button" onClick={onClose} className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-900" aria-label="Yopish"><X size={18} /></button>
      </div>
      {state?.ok && <FormSuccess text={state.note ?? "Qo'shildi"} />}
      <FormError error={state?.error} />
      <RowFields key={round} options={options} v={v} vid={vid} setVid={setVid} date={date} setDate={setDate} token={token} action={action} pending={pending} />
      <datalist id="ledger-pickups">{options.pickups.map((x) => <option key={x} value={x} />)}</datalist>
      <datalist id="ledger-dropoffs">{options.dropoffs.map((x) => <option key={x} value={x} />)}</datalist>
      <datalist id="ledger-cargos">{options.cargos.map((x) => <option key={x} value={x} />)}</datalist>
    </div>
  );
}

function RowFields({ options, v, vid, setVid, date, setDate, token, action, pending }: {
  options: LedgerOptions; v: LedgerVehicle | null; vid: string; setVid: (id: string) => void; date: string; setDate: (d: string) => void;
  token: string; action: (fd: FormData) => void; pending: boolean;
}) {
  const [driver, setDriver] = useState(v?.driverId ?? "");
  const [km, setKm] = useState("");
  const [hours, setHours] = useState("");
  const [pay, setPay] = useState("");
  const [revenue, setRevenue] = useState("");
  // Norma bo'yicha sarf — jadvaldagidek: km × 100 km normasi + baraban soati × soat normasi
  const use = v && (v.per100 || v.perHour) ? (num(km) * v.per100) / 100 + num(hours) * v.perHour : null;
  return (
    <form onSubmit={submitWith(action)} className="space-y-3">
      <input type="hidden" name="clientToken" value={token} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6 [&>*]:min-w-0">
        <Field label="Sana *"><Input name="date" type="date" value={date} onChange={(e) => setDate(e.target.value)} max={today()} required /></Field>
        <Field label="Transport *">
          <Select name="vehicleId" value={vid} required onChange={(e) => { setVid(e.target.value); const d = options.vehicles.find((x) => x.id === e.target.value)?.driverId; if (d) setDriver(d); }}>
            <option value="" disabled>Tanlang</option>
            {options.vehicles.map((x) => <option key={x.id} value={x.id}>{x.plate}</option>)}
          </Select>
        </Field>
        <Field label="Haydovchi" className="col-span-2">
          <Select name="driverId" value={driver} onChange={(e) => setDriver(e.target.value)}>
            <option value="">—</option>{options.drivers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </Select>
        </Field>
        <Field label="Yuklash joyi"><Input name="pickup" list="ledger-pickups" placeholder="Zavod" maxLength={120} /></Field>
        <Field label="Reys soni"><Input name="trips" type="number" min="0" max="1000" step="1" defaultValue="1" className="text-right tabular" /></Field>

        <Field label="Tushirish joyi *" className="col-span-2"><Input name="dropoff" list="ledger-dropoffs" placeholder="Obyekt yoki mijoz" required minLength={3} maxLength={160} /></Field>
        <Field label="Yuk" className="col-span-2"><Input name="cargo" list="ledger-cargos" placeholder="M-250 10 m³" maxLength={120} /></Field>
        <Field label="Probeg, km"><Input name="km" type="number" min="0" step="0.1" value={km} onChange={(e) => setKm(e.target.value)} className="text-right tabular" /></Field>
        <Field label="Baraban, soat"><Input name="drumHours" type="number" min="0" max="24" step="0.1" value={hours} onChange={(e) => setHours(e.target.value)} className="text-right tabular" /></Field>

        <Field label={`Zapravka, ${v?.unit ?? "m³ / l"}`}><Input name="refuel" type="number" min="0" max="1000" step="0.1" className="text-right tabular" /></Field>
        <Field label="Zapravka narxi" hint={v?.lastPrice ? `bo'sh — ${fmtNum(v.lastPrice, 0)}` : undefined}><Input name="fuelPrice" type="number" min="0" step="0.01" placeholder={v?.lastPrice ? String(v.lastPrice) : ""} className="text-right tabular" /></Field>
        <Field label="Ta'mir (usta)"><Input name="repair" type="number" min="0" step="1000" className="text-right tabular" /></Field>
        <Field label="Zapchast"><Input name="parts" type="number" min="0" step="1000" className="text-right tabular" /></Field>
        <Field label="Vulkanizator"><Input name="vulc" type="number" min="0" step="1000" className="text-right tabular" /></Field>
        <Field label="Boshqa xarajat"><Input name="other" type="number" min="0" step="1000" className="text-right tabular" /></Field>

        <Field label="Haydovchi haqi"><Input name="payAmount" type="number" min="0" step="1000" value={pay} onChange={(e) => setPay(e.target.value)} className="text-right tabular" /></Field>
        <Field label={`To'lov turi${num(pay) > 0 ? " *" : ""}`}>
          <Select name="payType" defaultValue="" required={num(pay) > 0}><option value="">—</option><option value="PAYROLL">Oylik</option><option value="CASH">Naqd</option></Select>
        </Field>
        <Field label="Kirim (bajarilgan)"><Input name="revenue" type="number" min="0" step="1000" value={revenue} onChange={(e) => setRevenue(e.target.value)} className="text-right tabular" /></Field>
        <Field label={`Kirim turi${num(revenue) > 0 ? " *" : ""}`}>
          <Select name="revenueType" defaultValue="" required={num(revenue) > 0}>{REVENUE_OPTIONS}</Select>
        </Field>
        <Field label="Izoh" className="col-span-2"><Input name="note" placeholder="Tun 22:30, 3 soat kutdi…" maxLength={300} /></Field>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button disabled={pending}><Plus size={15} /> {pending ? "Saqlanmoqda…" : "Qatorni qo'shish"}</Button>
        {use != null && <span className="text-xs text-slate-500">Sarf (norma): <b className="tabular text-slate-800">{fmtNum(use, 1)} {v?.unit}</b></span>}
      </div>
    </form>
  );
}

/**
 * Reys qatorida km va baraban soati: ECO bermagan (0 / bo'sh) bo'lsa sariq, qalam bilan qo'lda yoziladi.
 * Narxi qo'yilmagan reysda taklif ham yangi km bilan qayta hisoblanadi.
 */
export function KmFix({ tripId, km, hours, children }: { tripId: string; km: number; hours: number | null; children: React.ReactNode }) {
  const [edit, setEdit] = useState(false);
  const [state, action, pending] = useActionState(fixTripKmAction.bind(null, tripId), undefined);
  const router = useRouter();
  useEffect(() => { if (state?.ok) { setEdit(false); router.refresh(); } }, [state, router]);
  if (!edit) {
    return (
      <button type="button" onClick={() => setEdit(true)} title="Km va baraban soatini qo'lda yozish" className="group inline-flex items-center gap-1 hover:underline">
        {children}<Pencil size={11} className="text-slate-300 group-hover:text-slate-600" />
      </button>
    );
  }
  return (
    <form onSubmit={submitWith(action)} className="flex items-center justify-end gap-1">
      <Input name="km" type="number" min="0" step="0.1" defaultValue={km || ""} placeholder="km" className="h-7 w-16 px-1.5 text-right text-xs tabular" aria-label="Km" autoFocus />
      <Input name="hours" type="number" min="0" max="24" step="0.1" defaultValue={hours ?? ""} placeholder="soat" className="h-7 w-14 px-1.5 text-right text-xs tabular" aria-label="Baraban soati" />
      <Button size="sm" variant="success" disabled={pending} className="h-7 px-1.5" title="Saqlash"><Check size={13} /></Button>
      <button type="button" onClick={() => setEdit(false)} className="p-1 text-slate-400 hover:text-slate-900" aria-label="Bekor"><X size={13} /></button>
      {state?.error && <span className="basis-full text-right text-[11px] text-red-700">{state.error}</span>}
    </form>
  );
}

const KIND_LABEL: Record<LedgerKind, string> = { trip: "ECO reys", entry: "Qo'lda qator", cost: "Reyssiz kun" };

/** Bo'sh / nol — bo'sh maydon (tahrir oynasidagi `defaultValue`). */
const val = (n: number | null) => (n ? String(n) : "");

/** Reys haqi — dispetcher (`logistika.pay`), qotgan haq (kassaga o'tgan naqd / yopilgan oy) o'zgarmaydi; qo'lda qatorda — doim. */
const payEditableOf = (x: LedgerEditData, canPay: boolean) => x.kind === "entry" || (x.kind === "trip" && canPay && !x.payLock);

/**
 * Tahrir oynasi «Saqlash» da yuboradigan qiymatlar — o'zgartirilmagan holda (`LedgerEditForm` dagi `name` + `defaultValue`).
 * Katak tahriri shularning ustiga faqat o'z ustunini yozadi — server qolganini «o'zgarmadi» deb ko'radi.
 */
function editDefaults(x: LedgerEditData, payEditable: boolean): Record<string, string> {
  const d: Record<string, string> = {
    refuel: val(x.refuel), fuelPrice: x.fuelPrice != null ? String(x.fuelPrice) : "",
    repair: val(x.repair), parts: val(x.parts), vulc: val(x.vulc), other: val(x.other),
  };
  if (x.kind === "cost") return d;
  Object.assign(d, { pickup: x.pickup, km: val(x.km), drumHours: x.hours != null ? String(x.hours) : "", payAmount: x.pay != null ? String(x.pay) : "", note: x.note });
  // Tanlov o'chirilgan (haq qotgan / dispetcher emas) bo'lsa oynada ham yuborilmaydi
  if (payEditable) d.payType = x.payType ?? "";
  if (x.kind === "entry") {
    Object.assign(d, {
      date: x.date, vehicleId: x.vehicleId, driverId: x.driverId ?? "", trips: String(x.trips), dropoff: x.dropoff, cargo: x.cargo,
      revenue: val(x.revenue), revenueType: x.revenueType ?? "",
    });
  }
  return d;
}

/** Katakdagi qalam qaysi ustun(lar)ni ochadi. «fuel» — zapravka va narxi, «pay» — haq va turi, «revenue» — kirim va turi. */
export type LedgerField = "date" | "driver" | "pickup" | "dropoff" | "trips" | "cargo" | "km" | "hours" | "fuel" | "pay" | "repair" | "parts" | "vulc" | "other" | "revenue" | "note";

/**
 * Varaq katagidagi qalam (Realizatsiya'dagi kabi): bosilsa katak ostida kichik oyna — faqat shu ustun. Qatorning hozirgi
 * qiymatlari oyna ochilganda serverdan olinadi, saqlash — butun qator tahriri bilan bir xil (`updateLedgerRowAction`):
 * hamma tekshiruv, haq qoidalari, zapravka/xarajat yozuvlari va AuditLog o'sha yerda.
 */
export function LedgerCell({ kind, id, field, label, right, children }: {
  kind: LedgerKind; id: string; field: LedgerField; label: string; right?: boolean; children: React.ReactNode;
}) {
  const [at, setAt] = useState<DOMRect | null>(null);
  const close = useCallback(() => setAt(null), []);
  return (
    <span className={cn("group/cell flex items-start gap-1", right && "flex-row-reverse")}>
      <span className="min-w-0 flex-1">{children}</span>
      <button type="button" onClick={(e) => setAt(e.currentTarget.getBoundingClientRect())} aria-label={`${label}: tahrirlash`} title={`${label} — tahrirlash`}
        className={cn("mt-px shrink-0 rounded p-0.5 transition hover:bg-slate-200 hover:!text-slate-900 print:hidden", at ? "bg-slate-200 text-slate-900" : "text-slate-300 group-hover/cell:text-slate-500")}>
        <Pencil size={11} />
      </button>
      {at && <CellPopover kind={kind} id={id} field={field} label={label} at={at} onClose={close} />}
    </span>
  );
}

const POP_W = 300;

function CellPopover({ kind, id, field, label, at, onClose }: { kind: LedgerKind; id: string; field: LedgerField; label: string; at: DOMRect; onClose: () => void }) {
  const ctx = useContext(LedgerCtx);
  const o = ctx?.options ?? EMPTY;
  const [data, setData] = useState<LedgerEditData | null>(null);
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const router = useRouter();
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    ledgerRowAction(kind, id)
      .then((r) => { if (live) { if (r.row) setData(r.row); else setError(r.error ?? "Qatorni ochib bo'lmadi"); } })
      .catch(() => { if (live) setError("Qatorni ochib bo'lmadi — sahifani yangilang"); });
    return () => { live = false; };
  }, [kind, id]);
  // Esc — yopish; varaq yoki sahifa aylantirilsa oyna katakdan ajralib qolmasin — yopiladi
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    const onScroll = (e: Event) => { if (!box.current?.contains(e.target as Node)) onClose(); };
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onClose);
    return () => { document.removeEventListener("keydown", onKey); window.removeEventListener("scroll", onScroll, true); window.removeEventListener("resize", onClose); };
  }, [onClose]);
  // Yuklangach birinchi maydonga fokus
  useEffect(() => {
    const el = box.current?.querySelector<HTMLInputElement | HTMLSelectElement>("input:not([type=hidden]):not([disabled]),select:not([disabled])");
    el?.focus();
    if (el instanceof HTMLInputElement && el.type === "text") el.select();
  }, [data]);

  const payEditable = data ? payEditableOf(data, !!ctx?.canPay) : false;
  const save = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!data || pending) return;
    const fd = new FormData();
    for (const [k, v] of Object.entries(editDefaults(data, payEditable))) fd.set(k, v);
    for (const [k, v] of new FormData(e.currentTarget)) fd.set(k, v);
    setError(undefined);
    start(async () => {
      const r = await updateLedgerRowAction(kind, id, undefined, fd);
      if (r?.error) setError(r.error);
      else { router.refresh(); onClose(); }
    });
  };

  // Katak ostida; pastda joy bo'lmasa — ustida. Ekran chetidan chiqmaydi.
  const left = Math.max(8, Math.min(at.left - 8, window.innerWidth - POP_W - 8));
  const below = window.innerHeight - at.bottom > 280;
  const pos: React.CSSProperties = below ? { top: at.bottom + 4, left, width: POP_W } : { bottom: window.innerHeight - at.top + 4, left, width: POP_W };

  return createPortal((
    <div className="fixed inset-0 z-50" onMouseDown={onClose}>
      <div ref={box} role="dialog" aria-label={`${label}: tahrirlash`} style={pos} onMouseDown={(e) => e.stopPropagation()}
        className="fixed space-y-2.5 rounded-lg border border-slate-200 bg-white p-3 text-left text-sm font-normal whitespace-normal text-slate-900 normal-case not-italic shadow-(--shadow-pop)">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-[13px] font-semibold">{label}</div>
            {data && <div className="truncate text-[11px] text-slate-500">{data.no || KIND_LABEL[kind]} · {data.dateText} · {data.plate}</div>}
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-900" aria-label="Yopish"><X size={15} /></button>
        </div>
        {data ? (
          <form onSubmit={save} className="space-y-2.5">
            <CellFields x={data} field={field} o={o} payEditable={payEditable} canPay={!!ctx?.canPay} />
            <FormError error={error} />
            <div className="flex items-center justify-end gap-2">
              <Button type="button" size="sm" variant="secondary" onClick={onClose}>Bekor</Button>
              <Button size="sm" disabled={pending || (field === "pay" && !payEditable)}><Check size={14} /> {pending ? "Saqlanmoqda…" : "Saqlash"}</Button>
            </div>
          </form>
        ) : error ? <FormError error={error} /> : <p className="py-4 text-center text-xs text-slate-500">Yuklanmoqda…</p>}
      </div>
    </div>
  ), document.body);
}

/** Katak oynasidagi maydon(lar) — tahrir oynasidagi bilan bir xil nom va cheklovlar. */
function CellFields({ x, field, o, payEditable, canPay }: { x: LedgerEditData; field: LedgerField; o: LedgerOptions; payEditable: boolean; canPay: boolean }) {
  const cls = "h-9 text-right tabular";
  const num = (name: string, value: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) =>
    <Input name={name} type="number" min="0" step="any" defaultValue={value} className={cls} {...props} />;
  const list = (id: string, items: string[]) => <datalist id={id}>{items.map((v) => <option key={v} value={v} />)}</datalist>;
  switch (field) {
    case "date":
      return <Field label="Sana"><Input name="date" type="date" defaultValue={x.date} max={today()} required /></Field>;
    case "driver": {
      const drivers = x.driverId && !o.drivers.some((d) => d.id === x.driverId) ? [{ id: x.driverId, name: x.driver ?? "—" }, ...o.drivers] : o.drivers;
      return (
        <Field label="Haydovchi" hint={x.payLock ? `${x.payLock} — haydovchi o'zgarmaydi` : undefined}>
          <Select name="driverId" defaultValue={x.driverId ?? ""}><option value="">—</option>{drivers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select>
        </Field>
      );
    }
    case "pickup":
      return <Field label="Yuklash joyi"><Input name="pickup" list="ledger-cell-list" defaultValue={x.pickup} placeholder="Zavod" maxLength={120} />{list("ledger-cell-list", o.pickups)}</Field>;
    case "dropoff":
      return <Field label="Tushirish joyi"><Input name="dropoff" list="ledger-cell-list" defaultValue={x.dropoff} placeholder="Obyekt yoki mijoz" maxLength={160} />{list("ledger-cell-list", o.dropoffs)}</Field>;
    case "cargo":
      return <Field label="Yuk"><Input name="cargo" list="ledger-cell-list" defaultValue={x.cargo} placeholder="M-250 10 m³" maxLength={120} />{list("ledger-cell-list", o.cargos)}</Field>;
    case "trips":
      return <Field label="Reys soni">{num("trips", String(x.trips), { max: 1000, step: 1 })}</Field>;
    case "km":
      return <Field label="Probeg, km">{num("km", val(x.km))}</Field>;
    case "hours":
      return <Field label="Baraban, soat" hint="0 — 24">{num("drumHours", x.hours != null ? String(x.hours) : "", { max: 24 })}</Field>;
    case "fuel":
      return (
        <div className="grid grid-cols-2 gap-2">
          <Field label={`Zapravka, ${x.unit}`}>{num("refuel", val(x.refuel), { max: 1000 })}</Field>
          <Field label="Narxi" hint={!x.fuelPrice && x.lastPrice ? `bo'sh — ${fmtNum(x.lastPrice, 0)}` : undefined}>
            {num("fuelPrice", x.fuelPrice != null ? String(x.fuelPrice) : "", { placeholder: x.lastPrice ? String(x.lastPrice) : "" })}
          </Field>
          <p className="col-span-2 text-[11px] text-slate-500">0 — zapravka bekor qilinadi. Yoqilg&apos;i summasi va qoldiq o&apos;zi qayta hisoblanadi.</p>
        </div>
      );
    case "pay":
      if (!payEditable) {
        return <p className="rounded-md bg-amber-50 px-2 py-1.5 text-xs text-amber-800">{x.payLock ? `${x.payLock} — haq o'zgarmaydi.` : !canPay ? "Reys haqini dispetcher qo'yadi." : "Haq bu yerda o'zgarmaydi."}</p>;
      }
      return (
        <div className="grid grid-cols-2 gap-2">
          <Field label="Haydovchi haqi" hint={x.kind === "trip" && !x.priced && x.suggested ? `taklif — ${fmtNum(x.suggested, 0)}` : undefined}>
            {num("payAmount", x.pay != null ? String(x.pay) : "", { placeholder: x.kind === "trip" && !x.priced && x.suggested ? String(x.suggested) : "" })}
          </Field>
          <Field label="To'lov turi">
            <Select name="payType" defaultValue={x.payType ?? ""}><option value="">—</option><option value="PAYROLL">Oylik</option><option value="CASH">Naqd</option></Select>
          </Field>
          {x.kind === "trip" && x.priced && <Field label="O'zgarsa — sababi" className="col-span-2"><Input name="payReason" maxLength={300} placeholder="Nega o'zgartirildi" /></Field>}
          {x.kind === "entry" && x.approved && <p className="col-span-2 text-[11px] text-slate-500">Haq tasdiqlangan: summa yoki tur o&apos;zgarsa — ish boshqaruvchi qayta tasdiqlaydi.</p>}
        </div>
      );
    case "repair": return <Field label="Ta'mir (usta)">{num("repair", val(x.repair))}</Field>;
    case "parts": return <Field label="Zapchast">{num("parts", val(x.parts))}</Field>;
    case "vulc": return <Field label="Vulkanizator">{num("vulc", val(x.vulc))}</Field>;
    case "other": return <Field label="Boshqa xarajat">{num("other", val(x.other))}</Field>;
    case "revenue":
      return (
        <div className="grid grid-cols-2 gap-2">
          <Field label="Kirim (bajarilgan)">{num("revenue", val(x.revenue))}</Field>
          <Field label="Kirim turi">
            <Select name="revenueType" defaultValue={x.revenueType ?? ""}>{REVENUE_OPTIONS}</Select>
          </Field>
        </div>
      );
    case "note":
      return <Field label={x.kind === "trip" ? "Izoh (yetkazishdagi)" : "Izoh"}><Input name="note" defaultValue={x.note} maxLength={300} placeholder={x.kind === "entry" ? "bo'sh — yuklash → tushirish" : ""} /></Field>;
  }
}

/**
 * Varaq qatoridagi qalam: Excel'dagidek hamma ustun bitta oynada (`lib/ledger-edit.ts`). Qiymatlar oyna ochilganda
 * serverdan olinadi — jadvalda har qatorga yuborilmaydi va tahrir eng so'nggi holatdan boshlanadi.
 */
export function LedgerEditButton({ kind, id, autoOpen = false }: { kind: LedgerKind; id: string; autoOpen?: boolean }) {
  // `autoOpen` — reys kartasidan «Yetkazdim» (haydovchi o'rniga) dan keyin `?tahrir=<reys>` bilan kelindi: oyna o'zi ochiladi.
  // Faqat brauzerda (mount'dan keyin) — oyna `document.body` ga portal, server renderida u yo'q
  const [open, setOpen] = useState(false);
  useEffect(() => { if (autoOpen) setOpen(true); }, [autoOpen]);
  const close = useCallback(() => {
    setOpen(false);
    // Sahifa yangilanganda (saqlagach `router.refresh`) yoki qayta ochilganda oyna yana chiqmasin
    if (autoOpen) {
      const u = new URL(window.location.href);
      if (u.searchParams.has("tahrir")) { u.searchParams.delete("tahrir"); window.history.replaceState(null, "", u.pathname + u.search); }
    }
  }, [autoOpen]);
  return (
    <>
      <IconButton type="button" icon={Pencil} label="Qatorni tahrirlash" onClick={() => setOpen(true)} className="h-7 w-7" />
      {open && <LedgerEditDialog kind={kind} id={id} onClose={close} intro={autoOpen ? "Reys yetkazildi — hisob varag'iga km, baraban soati, zapravka, xarajat va haqni kiriting" : undefined} />}
    </>
  );
}

function LedgerEditDialog({ kind, id, onClose, intro }: { kind: LedgerKind; id: string; onClose: () => void; intro?: string }) {
  const [data, setData] = useState<LedgerEditData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    ledgerRowAction(kind, id)
      .then((r) => { if (live) { if (r.row) setData(r.row); else setLoadError(r.error ?? "Qatorni ochib bo'lmadi"); } })
      .catch(() => { if (live) setLoadError("Qatorni ochib bo'lmadi — sahifani yangilang"); });
    return () => { live = false; };
  }, [kind, id]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal((
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4 sm:items-center" onMouseDown={onClose}>
      <div role="dialog" aria-label="Hisob varag'i qatorini tahrirlash" onMouseDown={(e) => e.stopPropagation()}
        className="w-full max-w-4xl space-y-4 rounded-(--radius-card) border border-slate-200 bg-white p-5 shadow-(--shadow-pop)">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold tracking-tight">{data?.no || KIND_LABEL[kind]} — tahrirlash</h2>
            {data && <p className="text-xs text-slate-500">{KIND_LABEL[kind]} · {data.dateText} · {data.plate}</p>}
            {intro && <p className="mt-1 text-sm font-medium text-emerald-700">{intro}</p>}
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-900" aria-label="Yopish"><X size={18} /></button>
        </div>
        {data ? <LedgerEditForm x={data} onClose={onClose} />
          : loadError ? <FormError error={loadError} />
          : <p className="py-10 text-center text-sm text-slate-500">Yuklanmoqda…</p>}
      </div>
    </div>
  ), document.body);
}

/** Reys / zayavkadan keladigan ustun — oynada ko'rinadi, lekin bu yerda o'zgarmaydi. */
function ReadOnly({ label, value, className, hint }: { label: string; value: string; className?: string; hint?: string }) {
  return <Field label={label} className={className} hint={hint}><Input value={value} readOnly disabled title={value} /></Field>;
}

function LedgerEditForm({ x, onClose }: { x: LedgerEditData; onClose: () => void }) {
  const ctx = useContext(LedgerCtx);
  const o = ctx?.options ?? EMPTY;
  const [state, action, pending] = useActionState(updateLedgerRowAction.bind(null, x.kind, x.id), undefined);
  const router = useRouter();
  useEffect(() => { if (state?.ok) { router.refresh(); onClose(); } }, [state, onClose, router]);
  const entry = x.kind === "entry", trip = x.kind === "trip", cost = x.kind === "cost";
  // Ro'yxatda yo'q (ko'chadan, faol emas) haydovchi va transport ham tanlovda tursin
  const drivers = x.driverId && !o.drivers.some((d) => d.id === x.driverId) ? [{ id: x.driverId, name: x.driver ?? "—" }, ...o.drivers] : o.drivers;
  const vehicles = [...(o.vehicles.some((v) => v.id === x.vehicleId) ? [] : [{ id: x.vehicleId, plate: x.plate }]), ...o.vehicles];
  const payEditable = payEditableOf(x, !!ctx?.canPay);
  // Summa maydoni: step="any" — oldingi qiymat 1000 ga karrali bo'lmasa ham brauzer rad etmasin
  const money = (name: string, n: number) => <Input name={name} type="number" min="0" step="any" defaultValue={val(n)} className="text-right tabular" />;
  const fromTrip = "reys / zayavkadan";
  const revText = [
    x.revBank ? `Dostavka perech. ${fmtNum(x.revBank, 0)}` : null, x.revCash ? `Dostavka naqd ${fmtNum(x.revCash, 0)}` : null, x.revDebt ? `Dostavka qarzga ${fmtNum(x.revDebt, 0)}` : null,
    x.svcBank ? `Usluga perech. ${fmtNum(x.svcBank, 0)}` : null, x.svcCash ? `Usluga naqd ${fmtNum(x.svcCash, 0)}` : null, x.revOther ? `Obyekt ${fmtNum(x.revOther, 0)}` : null,
  ].filter(Boolean).join(" · ") || "—";

  return (
    <form onSubmit={submitWith(action)} className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6 [&>*]:min-w-0">
        {entry ? <Field label="Sana *"><Input name="date" type="date" defaultValue={x.date} max={today()} required /></Field> : <ReadOnly label="Sana" value={x.dateText} />}
        {entry ? (
          <Field label="Transport *" hint={x.ownCosts ? "zapravka/xarajati bor" : undefined}>
            {/* Qatorning o'z zapravka/xarajati bor — transport o'zgarmaydi (qiymat baribir yuboriladi) */}
            {x.ownCosts && <input type="hidden" name="vehicleId" value={x.vehicleId} />}
            <Select name={x.ownCosts ? undefined : "vehicleId"} defaultValue={x.vehicleId} disabled={x.ownCosts} required>
              {vehicles.map((v) => <option key={v.id} value={v.id}>{v.plate}</option>)}
            </Select>
          </Field>
        ) : <ReadOnly label="Transport" value={x.plate} />}
        {!cost && (entry ? (
          <Field label="Haydovchi" className="col-span-2">
            <Select name="driverId" defaultValue={x.driverId ?? ""}><option value="">—</option>{drivers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select>
          </Field>
        ) : <ReadOnly label="Haydovchi" value={x.driver ?? "—"} className="col-span-2" hint={fromTrip} />)}
        {!cost && <>
          <Field label="Yuklash joyi"><Input name="pickup" list="ledger-edit-pickups" defaultValue={x.pickup} placeholder="Zavod" maxLength={120} /></Field>
          {entry ? <Field label="Reys soni"><Input name="trips" type="number" min="0" max="1000" step="1" defaultValue={x.trips} className="text-right tabular" /></Field> : <ReadOnly label="Reys" value="1" />}

          {entry ? <Field label="Tushirish joyi" className="col-span-2"><Input name="dropoff" list="ledger-edit-dropoffs" defaultValue={x.dropoff} placeholder="Obyekt yoki mijoz" maxLength={160} /></Field>
            : <ReadOnly label="Tushirish joyi" value={x.dropoff} className="col-span-2" hint={x.address ?? fromTrip} />}
          {entry ? <Field label="Yuk" className="col-span-2"><Input name="cargo" list="ledger-edit-cargos" defaultValue={x.cargo} placeholder="M-250 10 m³" maxLength={120} /></Field>
            : <ReadOnly label="Yuk" value={x.cargo} className="col-span-2" hint={fromTrip} />}
          <Field label="Probeg, km"><Input name="km" type="number" min="0" step="any" defaultValue={val(x.km)} className="text-right tabular" /></Field>
          <Field label="Baraban, soat"><Input name="drumHours" type="number" min="0" max="24" step="any" defaultValue={x.hours ?? ""} className="text-right tabular" /></Field>
        </>}

        <Field label={`Zapravka, ${x.unit}`}><Input name="refuel" type="number" min="0" max="1000" step="any" defaultValue={val(x.refuel)} className="text-right tabular" /></Field>
        <Field label="Zapravka narxi" hint={!x.fuelPrice && x.lastPrice ? `bo'sh — ${fmtNum(x.lastPrice, 0)}` : undefined}>
          <Input name="fuelPrice" type="number" min="0" step="any" defaultValue={x.fuelPrice ?? ""} placeholder={x.lastPrice ? String(x.lastPrice) : ""} className="text-right tabular" />
        </Field>
        <Field label="Ta'mir (usta)">{money("repair", x.repair)}</Field>
        <Field label="Zapchast">{money("parts", x.parts)}</Field>
        <Field label="Vulkanizator">{money("vulc", x.vulc)}</Field>
        <Field label="Boshqa xarajat">{money("other", x.other)}</Field>

        {!cost && <>
          <Field label="Haydovchi haqi" hint={trip && !x.priced && x.suggested ? `taklif — ${fmtNum(x.suggested, 0)}` : undefined}>
            <Input name="payAmount" type="number" min="0" step="any" defaultValue={x.pay ?? ""} readOnly={!payEditable}
              placeholder={trip && !x.priced && x.suggested ? String(x.suggested) : ""} className="text-right tabular" />
          </Field>
          <Field label="To'lov turi">
            <Select name="payType" defaultValue={x.payType ?? ""} disabled={!payEditable}><option value="">—</option><option value="PAYROLL">Oylik</option><option value="CASH">Naqd</option></Select>
          </Field>
          {entry ? <>
            <Field label="Kirim (bajarilgan)">{money("revenue", x.revenue)}</Field>
            <Field label="Kirim turi">
              <Select name="revenueType" defaultValue={x.revenueType ?? ""}>{REVENUE_OPTIONS}</Select>
            </Field>
          </> : <ReadOnly label="Kirim (bajarilgan)" value={revText} className="col-span-2" hint="zayavka dastavka haqidan" />}
          <Field label={trip ? "Izoh (yetkazishdagi)" : "Izoh"} className="col-span-2">
            <Input name="note" defaultValue={x.note} maxLength={300} placeholder={entry ? "bo'sh — yuklash → tushirish" : ""} />
          </Field>
          {trip && x.priced && payEditable && (
            <Field label="Haq o'zgarsa — sababi" className="col-span-2"><Input name="payReason" maxLength={300} placeholder="Nega o'zgartirildi" /></Field>
          )}
        </>}
      </div>

      <div className="space-y-1 text-xs text-slate-500">
        {x.payLock && <p className="font-medium text-amber-700">{x.payLock} — haq summasi, to&apos;lov turi{entry ? ", haydovchi va oy" : ""} o&apos;zgarmaydi; qolgan ustunlar tuzatiladi.</p>}
        {trip && !ctx?.canPay && <p>Reys haqini dispetcher qo&apos;yadi.</p>}
        {entry && x.approved && !x.payLock && <p>Haq tasdiqlangan: summa, to&apos;lov turi, haydovchi yoki oy o&apos;zgarsa — ish boshqaruvchi qayta tasdiqlaydi.</p>}
        {trip && <p>Sana, haydovchi, tushirish joyi, yuk va kirim — reys va zayavkadan keladi. <Link href={`/trips/${x.id}`} className="font-medium text-slate-700 hover:underline">Reys kartasi</Link></p>}
        <p>Baraban sarfi, sarf, qoldiq, yoqilg&apos;i summasi, jami xarajat va foyda saqlagach o&apos;zi qayta hisoblanadi. Avvalgi qiymatlar jurnalda (AuditLog) qoladi.</p>
      </div>
      <FormError error={state?.error} />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onClose}>Yopish</Button>
        <Button disabled={pending}><Pencil size={15} /> {pending ? "Saqlanmoqda…" : "Saqlash"}</Button>
      </div>
      <datalist id="ledger-edit-pickups">{o.pickups.map((v) => <option key={v} value={v} />)}</datalist>
      <datalist id="ledger-edit-dropoffs">{o.dropoffs.map((v) => <option key={v} value={v} />)}</datalist>
      <datalist id="ledger-edit-cargos">{o.cargos.map((v) => <option key={v} value={v} />)}</datalist>
    </form>
  );
}
