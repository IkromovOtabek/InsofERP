"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Plus, Send, Trash2 } from "lucide-react";
import { createAgentOrder } from "./actions";
import { Button, Field, FormError, FormSuccess, Input, Select } from "@/components/ui";

type Customer = { id: string; name: string };
type Product = { id: string; name: string; unit: string; price: number };

const todayPlus = (n: number) => {
  const d = new Date(); d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/**
 * Sotuv agenti uchun "Yangi zayavka" — telefonda qulay katta maydonlar.
 * Faqat o'z mijozlari ro'yxatdan tanlanadi; mahsulot tanlanganda narx avtomatik to'ladi (o'zgartirsa bo'ladi).
 */
export function AgentOrderForm({ customers, products }: { customers: Customer[]; products: Product[] }) {
  const [state, action, pending] = useActionState(createAgentOrder, undefined);
  const [rows, setRows] = useState<{ productId: string; qty: string; price: string }[]>([{ productId: "", qty: "", price: "" }]);
  const ref = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.ok) { ref.current?.reset(); setRows([{ productId: "", qty: "", price: "" }]); }
  }, [state]);

  const setRow = (i: number, patch: Partial<{ productId: string; qty: string; price: string }>) =>
    setRows((rs) => rs.map((r, n) => (n === i ? { ...r, ...patch } : r)));
  const pickProduct = (i: number, productId: string) => {
    const p = products.find((x) => x.id === productId);
    setRow(i, { productId, price: p ? String(Math.round(p.price)) : "" });
  };

  if (customers.length === 0) {
    return <p className="text-sm text-slate-500">Sizga hali mijoz biriktirilmagan — zayavka ochish uchun direktor/sotuv bo&apos;limi sizga mijoz biriktirishi kerak.</p>;
  }

  return (
    <form ref={ref} action={action} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Mijoz *">
          <Select name="customerId" required defaultValue="">
            <option value="" disabled>Tanlang</option>
            {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
        <Field label="Yetkazish sanasi *">
          <Input type="date" name="deliveryDate" required defaultValue={todayPlus(1)} min={todayPlus(0)} />
        </Field>
      </div>
      <Field label="Obyekt manzili *">
        <Input name="deliveryAddress" required placeholder="Tuman, ko'cha, mo'ljal" />
      </Field>

      <div className="space-y-2">
        <div className="text-sm font-medium text-slate-700">Mahsulotlar</div>
        {rows.map((r, i) => (
          <div key={i} className="grid grid-cols-1 gap-2 rounded-lg border border-slate-200 p-2 sm:grid-cols-[1fr_110px_140px_auto]">
            <Select name="productId[]" required value={r.productId} onChange={(e) => pickProduct(i, e.target.value)} aria-label="Mahsulot">
              <option value="" disabled>Mahsulot</option>
              {products.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.unit}</option>)}
            </Select>
            <Input name="qtyM3[]" type="number" step="0.01" min="0" required placeholder="Hajm" value={r.qty} onChange={(e) => setRow(i, { qty: e.target.value })} aria-label="Hajm" />
            <Input name="price[]" type="number" step="1" min="0" required placeholder="Narx" value={r.price} onChange={(e) => setRow(i, { price: e.target.value })} aria-label="Narx (1 birlik)" />
            {rows.length > 1
              ? <Button type="button" variant="secondary" className="px-2" onClick={() => setRows((rs) => rs.filter((_, n) => n !== i))} aria-label="Qatorni o'chirish"><Trash2 size={16} /></Button>
              : <span />}
          </div>
        ))}
        <Button type="button" variant="secondary" className="text-sm" onClick={() => setRows((rs) => [...rs, { productId: "", qty: "", price: "" }])}><Plus size={16} /> Qator qo&apos;shish</Button>
      </div>

      <div className="flex flex-wrap gap-4">
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="needsPump" className="h-4 w-4" /> Nasos kerak</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="isUrgent" className="h-4 w-4" /> Shoshilinch</label>
      </div>
      <Field label="Izoh"><Input name="note" placeholder="Qo'shimcha ma'lumot" /></Field>

      <div className="flex items-center gap-3">
        <Button size="lg" disabled={pending}><Send size={18} /> Zayavkani ochish</Button>
        <FormSuccess text={state?.note} />
        <FormError error={state?.error} />
      </div>
    </form>
  );
}
