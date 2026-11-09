"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { ArrowRightLeft } from "lucide-react";
import { transferOwner } from "../actions";
import { Button, Field, FormError, FormSuccess, Input, Select } from "@/components/ui";
import { fmtNum } from "@/lib/format";

/** Ombor kaliti: brigada id yoki «umumiy» — umumiy hovli (server `null` qiladi) */
type Balance = { warehouseId: string; owner: string; qty: number };
const COMMON = "umumiy";

/**
 * Tayyor mahsulotni brigada omborlari orasida ko'chirish: umumiy hovli → brigada (eski qoldiqni taqsimlash),
 * brigada → brigada yoki brigada → umumiy hovli. Sklad jami o'zgarmaydi (`lib/brigade-products.ts`).
 */
export function OwnerTransferForm({ productId, unit, balances, warehouses, brigades }: {
  productId: string;
  unit: string;
  balances: Balance[];
  warehouses: { id: string; name: string }[];
  /** Faol brigadalar — qabul qiluvchi; nofaol brigada omboridan ham olib chiqish mumkin (nomi `names` da) */
  brigades: { id: string; name: string }[];
}) {
  const [state, action, pending] = useActionState(transferOwner, undefined);
  const [token, setToken] = useState("");
  // Bir martalik kalit: sahifa ochilganda va har muvaffaqiyatli ko'chirishdan keyin yangisi (ikki marta bosish ikki yozuv bermasin)
  useEffect(() => { setToken(crypto.randomUUID()); }, [state]);
  const names = useMemo(() => new Map([[COMMON, "Umumiy hovli"], ...brigades.map((b) => [b.id, b.name] as [string, string])]), [brigades]);
  const stocked = warehouses.filter((w) => balances.some((b) => b.warehouseId === w.id && b.qty > 0));
  const [wh, setWh] = useState(stocked[0]?.id ?? warehouses[0]?.id ?? "");
  const sources = balances.filter((b) => b.warehouseId === wh && b.qty > 0);
  const [from, setFrom] = useState(sources[0]?.owner ?? COMMON);
  const [to, setTo] = useState("");
  const have = sources.find((s) => s.owner === from)?.qty ?? 0;
  const targets = [...brigades.map((b) => ({ key: b.id, name: b.name })), { key: COMMON, name: "Umumiy hovli (brigadasiz)" }].filter((t) => t.key !== from);

  if (!sources.length) return <p className="text-sm text-slate-500">Ko&apos;chirish uchun qoldiq yo&apos;q.</p>;
  return (
    <form action={action} className="space-y-3">
      <FormError error={state?.error} />
      {state?.ok && <FormSuccess text={state.note ?? "Ko'chirildi"} />}
      <input type="hidden" name="productId" value={productId} />
      <input type="hidden" name="clientToken" value={token} />
      {stocked.length > 1 ? (
        <Field label="Sklad"><Select name="warehouseId" value={wh} onChange={(e) => { setWh(e.target.value); setFrom(balances.find((b) => b.warehouseId === e.target.value && b.qty > 0)?.owner ?? COMMON); }}>{stocked.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</Select></Field>
      ) : <input type="hidden" name="warehouseId" value={wh} />}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto_1fr] sm:items-end">
        <Field label="Qayerdan">
          <Select name="from" value={from} onChange={(e) => setFrom(e.target.value)}>
            {sources.map((s) => <option key={s.owner} value={s.owner}>{names.get(s.owner) ?? "Brigada"} — {fmtNum(s.qty)} {unit}</option>)}
          </Select>
        </Field>
        <ArrowRightLeft size={18} className="mx-auto mb-2.5 hidden text-slate-400 sm:block" />
        <Field label="Qayerga">
          <Select name="to" value={targets.some((t) => t.key === to) ? to : ""} onChange={(e) => setTo(e.target.value)} required>
            <option value="" disabled>Tanlang</option>
            {targets.map((t) => <option key={t.key} value={t.key}>{t.name}</option>)}
          </Select>
        </Field>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[180px_1fr]">
        <Field label="Miqdor" hint={`ko'pi bilan ${fmtNum(have)} ${unit}`}>
          <Input name="qty" type="number" min="1" step={unit === "dona" ? "1" : "0.001"} max={have} required placeholder="0" />
        </Field>
        <Field label="Izoh"><Input name="note" placeholder="Masalan: hovli sanog'i, 2-brigadaga topshirildi" /></Field>
      </div>
      <Button type="submit" disabled={pending || !token}><ArrowRightLeft size={16} /> {pending ? "Ko'chirilmoqda…" : "Ko'chirish"}</Button>
    </form>
  );
}
