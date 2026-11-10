"use client";

import { useCallback } from "react";
import { Field, Input, Select } from "@/components/ui";
import { MoneyInput } from "@/components/money-input";
import { updateRegisterLine } from "./actions";
import { EditModal, useCashEditOptions } from "./cash-edit";
import type { ActionState } from "@/lib/action";

/** Realizatsiya jurnali qatorining tahrir qiymatlari (`register-table.tsx` → `registerEditRow`). */
export type RegisterEditRow = {
  id: string; date: string; customerId: string; customerName: string; vehicleNo: string; ttn: string; productName: string; unit: string;
  qty: number; fromWho: string; payType: string; deliveryFee: number; price: number; sum: number; nds: number; total: number;
  address: string; contractNo: string; invoiceNo: string; monthNo: string; note: string;
  cashAccountId: string; hasPayment: boolean; sig: string;
};

const money = (name: string, label: string, v: number) => (
  <Field label={label}><MoneyInput name={name} defaultValue={String(v)} /></Field>
);

/**
 * Realizatsiya jurnali qatorining tahrir oynasi (qator tafsilotidagi «Tahrirlash»dan) — Excel'dagi barcha ustunlar.
 * Qatordan kassaga kirim yozilgan bo'lsa, o'sha kirim ham birga o'zgaradi (summa = Itogo, mijoz, hisob, sana).
 * Qoida — `lib/sales-register.ts` → `updateRegisterRow`.
 */
export function RegisterDialog({ row, onClose }: { row: RegisterEditRow; onClose: () => void }) {
  const o = useCashEditOptions();
  const action = useCallback((p: ActionState, fd: FormData) => updateRegisterLine(row.id, p, fd), [row.id]);
  const custs = o.customers ?? [];
  const list = custs.some((c) => c.id === row.customerId) ? custs : [{ id: row.customerId, name: row.customerName }, ...custs];
  const accs = o.accounts.some((a) => a.id === row.cashAccountId) || !row.cashAccountId ? o.accounts : [{ id: row.cashAccountId, name: "Yopilgan hisob", type: "CASH" as const }, ...o.accounts];
  return (
    <EditModal title="Realizatsiya qatorini tahrirlash" action={action} onClose={onClose} wide
      foot={row.hasPayment ? "Bu qatordan kassaga kirim yozilgan — Itogo, mijoz, hisob va sana kirimda ham o'zgaradi. Avvalgi qiymatlar AuditLog'da." : "Avvalgi qiymatlar AuditLog'da saqlanadi."}>
      <input type="hidden" name="sig" value={row.sig} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 [&>*]:min-w-0">
        <Field label="Sana *"><Input name="date" type="date" defaultValue={row.date} required /></Field>
        <Field label="Mashina №"><Input name="vehicleNo" defaultValue={row.vehicleNo} maxLength={40} autoComplete="off" /></Field>
        <Field label="Mahsulot *" className="col-span-2"><Input name="productName" defaultValue={row.productName} maxLength={200} required /></Field>
        <Field label="TTN"><Input name="ttn" defaultValue={row.ttn} maxLength={60} autoComplete="off" /></Field>
        <Field label="Birlik"><Input name="unit" defaultValue={row.unit} maxLength={20} /></Field>
        <Field label="Miqdor"><Input name="qty" type="number" step="0.001" min="0" defaultValue={String(row.qty)} /></Field>
        <Field label="Kimdan"><Input name="fromWho" defaultValue={row.fromWho} maxLength={120} /></Field>
        <Field label="Mijoz *" className="col-span-2">
          <Select name="customerId" defaultValue={row.customerId} required>
            {list.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
        <Field label="Deniga (naqd / o'tkazma)"><Input name="payType" defaultValue={row.payType} maxLength={40} list="reg-paytype" autoComplete="off" /></Field>
        <Field label={row.hasPayment ? "Kassa / hisob *" : "Kassa / hisob"}>
          <Select name="cashAccountId" defaultValue={row.cashAccountId} required={row.hasPayment}>
            {!row.hasPayment && <option value="">—</option>}
            {accs.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.type === "CASH" ? "naqd" : "bank"})</option>)}
          </Select>
        </Field>
        {money("deliveryFee", "Dostavka", row.deliveryFee)}
        {money("price", "Narx", row.price)}
        {money("sum", "Summa", row.sum)}
        {money("nds", "NDS", row.nds)}
        <Field label={row.hasPayment ? "Itogo * (kassaga tushgan)" : "Itogo"}><MoneyInput name="total" defaultValue={String(row.total)} required={row.hasPayment} /></Field>
        <Field label="Manzil" className="col-span-2"><Input name="address" defaultValue={row.address} maxLength={300} /></Field>
        <Field label="Shartnoma"><Input name="contractNo" defaultValue={row.contractNo} maxLength={80} /></Field>
        <Field label="Schyot"><Input name="invoiceNo" defaultValue={row.invoiceNo} maxLength={80} /></Field>
        <Field label="Oy"><Input name="monthNo" defaultValue={row.monthNo} maxLength={20} /></Field>
        <Field label="Izoh" className="col-span-2 sm:col-span-3"><Input name="note" defaultValue={row.note} maxLength={500} /></Field>
      </div>
      <datalist id="reg-paytype"><option value="naqd" /><option value="o'tkazma" /></datalist>
    </EditModal>
  );
}
