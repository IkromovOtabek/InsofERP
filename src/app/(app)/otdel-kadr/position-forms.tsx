"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Check, Plus, Trash2 } from "lucide-react";
import { deleteWorkPosition, saveWorkPosition, toggleWorkPosition } from "./actions";
import { Button, Checkbox, Field, FormError, Input } from "@/components/ui";

type Pos = { id: string; name: string; note: string | null; isDriver: boolean; sortOrder: number; isActive: boolean };

/** Yangi ishchi lavozim qo'shish. */
export function NewPositionForm({ nextOrder }: { nextOrder: number }) {
  const [state, action, pending] = useActionState(saveWorkPosition.bind(null, null), undefined);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => { if (state?.ok) ref.current?.reset(); }, [state]);
  return (
    <form ref={ref} action={action} className="space-y-3">
      <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-[1fr_1.4fr_110px_150px_auto]">
        <Field label="Lavozim nomi *"><Input name="name" required autoComplete="off" placeholder="Masalan: Payvandchi" /></Field>
        <Field label="Izoh"><Input name="note" autoComplete="off" placeholder="Vazifasi yoki talab" /></Field>
        <Field label="Tartib"><Input name="sortOrder" type="number" defaultValue={nextOrder} /></Field>
        <div className="pb-2"><Checkbox name="isDriver" label="Haydovchi ilovasiga chiqsin" /></div>
        <Button disabled={pending}><Plus size={16} /> Qo&apos;shish</Button>
      </div>
      <FormError error={state?.error} />
    </form>
  );
}

/** Mavjud lavozim qatori — joyida tahrirlanadi. */
export function PositionRow({ p, used }: { p: Pos; used: number }) {
  const [state, action, pending] = useActionState(saveWorkPosition.bind(null, p.id), undefined);
  const [dirty, setDirty] = useState(false);
  useEffect(() => { if (state?.ok) setDirty(false); }, [state]);
  return (
    <form action={action} onChange={() => setDirty(true)} className="grid grid-cols-1 items-center gap-2 border-b border-slate-100 px-3 py-2 last:border-0 sm:grid-cols-[1fr_1.4fr_80px_160px_70px_auto]">
      <Input name="name" defaultValue={p.name} required className="py-2 text-sm" autoComplete="off" />
      <Input name="note" defaultValue={p.note ?? ""} className="py-2 text-sm" placeholder="izoh" autoComplete="off" />
      <Input name="sortOrder" type="number" defaultValue={p.sortOrder} className="py-2 text-sm" />
      <Checkbox name="isDriver" defaultChecked={p.isDriver} label="Haydovchi ilovasi" />
      <span className="text-xs text-slate-500 tabular">{used} xodim</span>
      <div className="flex items-center gap-1.5">
        {dirty && <Button size="sm" variant="secondary" disabled={pending}><Check size={14} /> Saqlash</Button>}
        <Button size="sm" variant="ghost" type="button" disabled={pending} onClick={() => toggleWorkPosition(p.id)}>{p.isActive ? "Yashirish" : "Qaytarish"}</Button>
        {used === 0 && (
          <Button size="sm" variant="ghost" type="button" className="text-red-600" disabled={pending} onClick={() => deleteWorkPosition(p.id)} title="O'chirish">
            <Trash2 size={14} />
          </Button>
        )}
      </div>
      {state?.error && <div className="sm:col-span-full"><FormError error={state.error} /></div>}
    </form>
  );
}
