"use client";

import { useActionState, useState } from "react";
import { PackageCheck, Save, Send, Trash2, Truck } from "lucide-react";
import { checkIn, editItems, setPrices } from "@/lib/supply-actions";
import { Button, Field, FormError, FormSuccess, Input, Select, Table, Td, Th, Tr } from "@/components/ui";
import { money, fmtNum } from "@/lib/format";
import { unitLabel } from "@/lib/unit";
import { DELIVERY_KINDS, DELIVERY_OWN } from "@/lib/supply-const";
import { cn } from "@/lib/utils";

export type PanelItem = {
  id: string; name: string; unit: string; qty: number; price: number;
  factQty: number | null; factPrice: number | null; note: string | null; inCatalog: boolean;
};
type Opt = { id: string; name: string };

const n = (v: string) => Number(String(v).replace(",", ".")) || 0;

/* ═══════════ Sklad: hali narx qo'yilmagan jadvalni tuzatish ═══════════ */

export function EditItemsPanel({ id, items }: { id: string; items: PanelItem[] }) {
  const [state, action, pending] = useActionState(editItems.bind(null, id), undefined);
  const [rows, setRows] = useState(items.map((i) => ({ ...i, qtyStr: String(i.qty), noteStr: i.note ?? "" })));

  return (
    <form action={action} className="space-y-3">
      <Table>
        <thead><tr><Th>Nomi</Th><Th>Birlik</Th><Th right>Kerak miqdor</Th><Th>Izoh</Th><Th></Th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <Tr key={r.id}>
              <Td className="font-medium">{r.name}{!r.inCatalog && <span className="ml-2 text-xs text-blue-600">yangi</span>}</Td>
              <Td className="text-slate-500">{unitLabel(r.unit)}</Td>
              <Td right className="w-36">
                <Input name={`qty_${r.id}`} value={r.qtyStr} type="number" step="0.001" min="0" className="h-9 text-right"
                  onChange={(e) => setRows((xs) => xs.map((x) => (x.id === r.id ? { ...x, qtyStr: e.target.value } : x)))} />
              </Td>
              <Td className="w-64"><Input name={`note_${r.id}`} value={r.noteStr} className="h-9"
                onChange={(e) => setRows((xs) => xs.map((x) => (x.id === r.id ? { ...x, noteStr: e.target.value } : x)))} /></Td>
              <Td>
                <Button type="button" variant="ghost" className="h-8 px-2 text-red-600 hover:bg-red-50" title="Qatorni chiqarib tashlash"
                  onClick={() => setRows((xs) => xs.map((x) => (x.id === r.id ? { ...x, qtyStr: "0" } : x)))}><Trash2 size={14} /></Button>
              </Td>
            </Tr>
          ))}
        </tbody>
      </Table>
      <p className="text-xs text-slate-500">Miqdorni 0 qilsangiz — qator jadvaldan chiqadi.</p>
      <FormError error={state?.error} />
      {state?.ok && <FormSuccess text={state.note ?? "Saqlandi"} />}
      <div className="flex justify-end"><Button disabled={pending} variant="secondary"><Save size={16} /> {pending ? "Saqlanmoqda…" : "Jadvalni saqlash"}</Button></div>
    </form>
  );
}

/* ═══════════ Snabjeniye: narx qo'yish va jami summa ═══════════ */

export function PricePanel({ id, items, suppliers, supplierId, delivery: deliveryInit, drivers }: {
  id: string; items: PanelItem[]; suppliers: Opt[]; supplierId: string | null;
  delivery: { kind: string; provider: string; cost: number; note: string };
  /** O'z haydovchilarimiz (mashinasi bilan) — "O'zimiz" tanlansa shulardan biri tanlanadi. */
  drivers: { id: string; label: string }[];
}) {
  const [state, action, pending] = useActionState(setPrices.bind(null, id), undefined);
  const [rows, setRows] = useState(items.map((i) => ({ id: i.id, name: i.name, unit: i.unit, inCatalog: i.inCatalog, qty: String(i.qty), price: i.price ? String(i.price) : "" })));
  const [delivery, setDelivery] = useState({ kind: deliveryInit.kind, cost: deliveryInit.cost ? String(deliveryInit.cost) : "" });
  const goods = rows.reduce((s, r) => s + n(r.qty) * n(r.price), 0);
  const total = goods + n(delivery.cost);

  return (
    <form action={action} className="space-y-4">
      <Table>
        <thead><tr><Th>Nomi</Th><Th>Birlik</Th><Th right>Miqdor</Th><Th right>Narx (birlik)</Th><Th right>Summa</Th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <Tr key={r.id}>
              <Td className="font-medium">{r.name}{!r.inCatalog && <span className="ml-2 text-xs text-blue-600">spravochnikda yo&apos;q</span>}</Td>
              <Td className="text-slate-500">{unitLabel(r.unit)}</Td>
              <Td right className="w-32"><Input name={`qty_${r.id}`} value={r.qty} type="number" step="0.001" min="0" className="h-9 text-right"
                onChange={(e) => setRows((xs) => xs.map((x) => (x.id === r.id ? { ...x, qty: e.target.value } : x)))} /></Td>
              <Td right className="w-40"><Input name={`price_${r.id}`} value={r.price} type="number" step="0.01" min="0" placeholder="0" className="h-9 text-right"
                onChange={(e) => setRows((xs) => xs.map((x) => (x.id === r.id ? { ...x, price: e.target.value } : x)))} /></Td>
              <Td right className="w-40 font-medium tabular">{money(n(r.qty) * n(r.price))}</Td>
            </Tr>
          ))}
          {n(delivery.cost) > 0 && (
            <Tr>
              <Td colSpan={4} className="text-slate-700"><span className="inline-flex items-center gap-1.5"><Truck size={13} className="text-slate-400" /> Dostavka xizmati{delivery.kind ? ` · ${delivery.kind}` : ""}</span></Td>
              <Td right className="font-medium tabular">{money(n(delivery.cost))}</Td>
            </Tr>
          )}
          <tr className="bg-slate-50/80">
            <Td colSpan={4} className="font-semibold">Jami summa{n(delivery.cost) > 0 ? ` (mahsulot ${money(goods)} + dostavka)` : ""}</Td>
            <Td right className="text-lg font-semibold tabular">{money(total)}</Td>
          </tr>
        </tbody>
      </Table>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Yetkazuvchi" hint="Kirim hujjati shu yetkazuvchiga yoziladi">
          <Select name="supplierId" defaultValue={supplierId ?? ""}>
            <option value="">Tanlanmagan</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
        </Field>
        <Field label="Izoh"><Input name="note" placeholder="Narx qayerdan olindi, yetkazish sharti…" autoComplete="off" /></Field>
      </div>

      {/* Dostavka xizmati — jami summaga qo'shiladi va tasdiqlovchiga alohida qator bo'lib ko'rinadi */}
      <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-4">
        <h3 className="mb-3 inline-flex items-center gap-2 text-[13px] font-semibold text-slate-700"><Truck size={15} className="text-slate-400" /> Dostavka xizmati</h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          <Field label="Kim yetkazadi">
            <Select name="deliveryKind" value={delivery.kind} onChange={(e) => setDelivery((d) => ({ ...d, kind: e.target.value }))}>
              <option value="">Kerak emas</option>
              {DELIVERY_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
            </Select>
          </Field>
          <Field label={delivery.kind === DELIVERY_OWN ? "Haydovchimiz" : "Transport"}>
            {delivery.kind === DELIVERY_OWN ? (
              <Select name="deliveryProvider" defaultValue={deliveryInit.provider}>
                <option value="">Tanlang…</option>
                {drivers.map((d) => <option key={d.id} value={d.label}>{d.label}</option>)}
              </Select>
            ) : (
              <Input name="deliveryProvider" defaultValue={deliveryInit.provider} placeholder="Mashina yoki haydovchi" autoComplete="off" />
            )}
          </Field>
          <Field label="Dostavka narxi">
            <Input name="deliveryCost" value={delivery.cost} onChange={(e) => setDelivery((d) => ({ ...d, cost: e.target.value }))} type="number" step="0.01" min="0" placeholder="0" className="text-right" />
          </Field>
          <Field label="Izoh"><Input name="deliveryNote" defaultValue={deliveryInit.note} placeholder="Muddat, shart…" autoComplete="off" /></Field>
        </div>
      </div>
      <FormError error={state?.error} />
      {state?.ok && <FormSuccess text={state.note ?? "Yuborildi"} />}
      <div className="flex flex-wrap items-center justify-end gap-3">
        <span className="text-xs text-slate-500">Tasdiqlashga yuborilgach ma&apos;sul xodim ko&apos;radi</span>
        <Button disabled={pending || total <= 0}><Send size={16} /> {pending ? "Yuborilmoqda…" : "Narxlarni saqlab, tasdiqlashga yuborish"}</Button>
      </div>
    </form>
  );
}

/* ═══════════ Snabjeniye: kelgan molni tekshirib qabul qilish ═══════════ */

export function ReceivePanel({ id, items, suppliers, supplierId, delivery: deliveryInit }: {
  id: string; items: PanelItem[]; suppliers: Opt[]; supplierId: string | null;
  delivery: { kind: string; cost: number; fact: number };
}) {
  const [state, action, pending] = useActionState(checkIn.bind(null, id), undefined);
  const [rows, setRows] = useState(items.map((i) => ({
    id: i.id, name: i.name, unit: i.unit, qty: i.qty, price: i.price,
    fq: String(i.factQty ?? i.qty), fp: String(i.factPrice ?? i.price),
  })));
  const [deliveryFact, setDeliveryFact] = useState(String(deliveryInit.fact || deliveryInit.cost || 0));
  const plan = rows.reduce((s, r) => s + r.qty * r.price, 0) + deliveryInit.cost;
  const fact = rows.reduce((s, r) => s + n(r.fq) * n(r.fp), 0) + n(deliveryFact);
  const diff = fact - plan;
  const missing = rows.filter((r) => n(r.fq) < r.qty - 0.0005);
  // Narx o'zgarsa qabul qilinmaydi — Sotuv va Moliya qayta tasdiqlaydi
  const repriced = rows.filter((r) => Math.abs(n(r.fp) - r.price) > 0.5 && n(r.fq) > 0);
  const deliveryMoved = Math.abs(n(deliveryFact) - deliveryInit.cost) > 0.5;
  const needsRecheck = repriced.length > 0 || deliveryMoved;

  return (
    <form action={action} className="space-y-4">
      <p className="text-sm text-slate-600">Kelgan molni tekshiring: <b>nima kam keldi</b> va <b>necha pulga keldi</b>. Qator noto&apos;g&apos;ri bo&apos;lsa shu yerda tuzating — «Qabul qildim» bosilganda sklad kirimi shu fakt bo&apos;yicha yoziladi.</p>
      <Table>
        <thead>
          <tr>
            <Th>Nomi</Th><Th right>Buyurtma</Th><Th right>Kelgan miqdor</Th><Th right>Reja narx</Th><Th right>Kelgan narx</Th><Th right>Summa</Th><Th>Farq</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const dq = n(r.fq) - r.qty, dp = n(r.fp) - r.price;
            return (
              <Tr key={r.id}>
                <Td className="font-medium">{r.name}</Td>
                <Td right className="text-slate-500">{fmtNum(r.qty, 3)} {unitLabel(r.unit)}</Td>
                <Td right className="w-32"><Input name={`factQty_${r.id}`} value={r.fq} type="number" step="0.001" min="0" className={cn("h-9 text-right", dq < -0.0005 && "border-red-300 text-red-700")}
                  onChange={(e) => setRows((xs) => xs.map((x) => (x.id === r.id ? { ...x, fq: e.target.value } : x)))} /></Td>
                <Td right className="text-slate-500">{money(r.price)}</Td>
                <Td right className="w-36"><Input name={`factPrice_${r.id}`} value={r.fp} type="number" step="0.01" min="0" className={cn("h-9 text-right", dp > 0.0005 && "border-amber-300 text-amber-700")}
                  onChange={(e) => setRows((xs) => xs.map((x) => (x.id === r.id ? { ...x, fp: e.target.value } : x)))} /></Td>
                <Td right className="font-medium tabular">{money(n(r.fq) * n(r.fp))}</Td>
                <Td className="text-xs">
                  {Math.abs(dq) > 0.0005 && <div className={dq < 0 ? "text-red-600" : "text-emerald-700"}>{dq < 0 ? `${fmtNum(-dq, 3)} kam keldi` : `${fmtNum(dq, 3)} ortiq`}</div>}
                  {Math.abs(dp) > 0.0005 && <div className={dp > 0 ? "text-amber-700" : "text-emerald-700"}>narx {dp > 0 ? "+" : ""}{fmtNum(dp)} so&apos;m</div>}
                  {Math.abs(dq) <= 0.0005 && Math.abs(dp) <= 0.0005 && <span className="text-slate-400">to&apos;g&apos;ri</span>}
                </Td>
              </Tr>
            );
          })}
          <Tr>
            <Td colSpan={4} className="text-slate-700"><span className="inline-flex items-center gap-1.5"><Truck size={13} className="text-slate-400" /> Dostavka xizmati{deliveryInit.kind ? ` · ${deliveryInit.kind}` : ""} · reja {money(deliveryInit.cost)}</span></Td>
            <Td right className="w-36">
              <Input name="deliveryFactCost" value={deliveryFact} onChange={(e) => setDeliveryFact(e.target.value)} type="number" step="0.01" min="0"
                className={cn("h-9 text-right", deliveryMoved && "border-amber-300 text-amber-700")} />
            </Td>
            <Td right className="font-medium tabular">{money(n(deliveryFact))}</Td>
            <Td className="text-xs">{deliveryMoved ? <span className="text-amber-700">o&apos;zgardi</span> : <span className="text-slate-400">to&apos;g&apos;ri</span>}</Td>
          </Tr>
          <tr className="bg-slate-50/80">
            <Td colSpan={5} className="font-semibold">Jami · reja {money(plan)}</Td>
            <Td right className="text-lg font-semibold tabular">{money(fact)}</Td>
            <Td className={cn("text-xs font-medium", diff > 0 ? "text-red-600" : diff < 0 ? "text-emerald-700" : "text-slate-500")}>
              {Math.abs(diff) < 0.5 ? "rejadek" : `${diff > 0 ? "+" : ""}${money(diff)}`}
            </Td>
          </tr>
        </tbody>
      </Table>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Yetkazuvchi *" hint="Kirim hujjati shu yetkazuvchi nomiga yoziladi">
          <Select name="supplierId" defaultValue={supplierId ?? ""}>
            <option value="">Tanlang…</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
        </Field>
        <Field label="Izoh"><Input name="note" placeholder="Nakladnoy raqami, holat…" autoComplete="off" /></Field>
      </div>

      {missing.length > 0 && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
          Kam kelgan qator: <b>{missing.length} ta</b> — {missing.map((m) => m.name).join(", ")}. Qabul qilsangiz skladga faqat kelgan miqdor kiradi.
        </p>
      )}
      {needsRecheck && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-800">
          <b>Narx o&apos;zgardi</b>{repriced.length > 0 && `: ${repriced.map((r) => `${r.name} ${fmtNum(r.price)} → ${fmtNum(n(r.fp))}`).join("; ")}`}{deliveryMoved && `${repriced.length ? "; " : ": "}dostavka ${fmtNum(deliveryInit.cost)} → ${fmtNum(n(deliveryFact))}`}.
          «Qabul qildim» bosilsa mol skladga kirmaydi — zayavka avval <b>Sotuv</b> va <b>Moliya</b> bo&apos;limiga qayta tasdiqqa qaytadi (yangi jami {money(fact)}).
        </p>
      )}
      <FormError error={state?.error} />
      {state?.ok && <FormSuccess text={state.note ?? "Bajarildi"} />}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button name="mode" value="save" type="submit" variant="secondary" disabled={pending}><Save size={16} /> Tahrirlashni saqlash</Button>
        <Button name="mode" value="receive" type="submit" variant={needsRecheck ? "primary" : "success"} disabled={pending || fact <= 0}>
          <PackageCheck size={16} /> {pending ? "Yozilmoqda…" : needsRecheck ? "Qayta tasdiqqa yuborish" : "Qabul qildim — skladga kirim"}
        </Button>
      </div>
    </form>
  );
}
