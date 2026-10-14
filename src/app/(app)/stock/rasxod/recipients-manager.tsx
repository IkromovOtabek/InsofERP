"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { Check, Eye, EyeOff, Pencil, Plus, X } from "lucide-react";
import { saveRecipient, toggleRecipient } from "./actions";
import { Badge, Button, FormError, FormSuccess, Input, Table, Td, Th, Tr } from "@/components/ui";
import { fmtNum } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { RecipientRow } from "@/lib/stock-recipients";

/**
 * «Kimga» ro'yxatini boshqarish (Sklad → Chiqim, pastda): qo'shish, qayta nomlash, faol/nofaol.
 * O'chirish yo'q — eski chiqim qatorlarida nomi qolishi kerak. Faqat `stock` → `issue` huquqi borlarga ko'rinadi.
 */
export function RecipientsManager({ list }: { list: RecipientRow[] }) {
  const [state, action, pending] = useActionState(saveRecipient, undefined);
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => { if (state?.ok) formRef.current?.reset(); }, [state]);

  return (
    <div className="space-y-4">
      <form ref={formRef} action={action} className="flex flex-wrap items-end gap-2">
        <label className="min-w-56 flex-1 text-xs font-medium text-slate-600">Yangi oluvchi
          <Input name="name" required maxLength={80} placeholder="Masalan: Shofyorlar, Svarshchiklar, 1-brigada" autoComplete="off" className="mt-1" />
        </label>
        <label className="min-w-56 flex-1 text-xs font-medium text-slate-600">Izoh
          <Input name="note" maxLength={200} placeholder="ixtiyoriy" autoComplete="off" className="mt-1" />
        </label>
        <Button disabled={pending}><Plus size={16} /> {pending ? "Saqlanmoqda…" : "Qo'shish"}</Button>
      </form>
      <FormError error={state?.error} />
      {state?.ok && <FormSuccess text={state.note} />}

      <Table>
        <thead><tr><Th>Oluvchi nomi</Th><Th>Izoh</Th><Th right>Chiqim qatorlari</Th><Th>Holat</Th><Th right>Amallar</Th></tr></thead>
        <tbody>
          {list.length === 0 && <tr><td colSpan={5} className="px-4 py-6 text-center text-sm text-slate-500">Ro'yxat bo'sh — birinchi oluvchini qo'shing</td></tr>}
          {list.map((r) => <RecipientItem key={r.id} r={r} />)}
        </tbody>
      </Table>
    </div>
  );
}

function RecipientItem({ r }: { r: RecipientRow }) {
  const [edit, setEdit] = useState(false);
  const [state, action, pending] = useActionState(saveRecipient, undefined);
  const [busy, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (state?.ok) setEdit(false); }, [state]);

  const toggle = () => start(async () => {
    setErr(null);
    const res = await toggleRecipient(r.id, !r.isActive);
    if (res?.error) setErr(res.error);
  });

  if (edit) {
    return (
      <Tr>
        <Td colSpan={5}>
          <form action={action} className="flex flex-wrap items-center gap-2">
            <input type="hidden" name="id" value={r.id} />
            <Input name="name" defaultValue={r.name} required maxLength={80} aria-label="Oluvchining ismi" autoComplete="off" className="h-9 min-w-48 flex-1" />
            <Input name="note" defaultValue={r.note ?? ""} maxLength={200} aria-label="Izoh" placeholder="Izoh" autoComplete="off" className="h-9 min-w-48 flex-1" />
            <Button size="sm" disabled={pending}><Check size={15} /> {pending ? "…" : "Saqlash"}</Button>
            <Button size="sm" type="button" variant="ghost" onClick={() => setEdit(false)}><X size={15} /> Bekor qilish</Button>
          </form>
          <FormError error={state?.error} />
        </Td>
      </Tr>
    );
  }
  return (
    <Tr className={cn(!r.isActive && "opacity-60")}>
      <Td className="font-medium">{r.name}</Td>
      <Td className="text-slate-600">{r.note ?? <span className="text-slate-400">—</span>}</Td>
      <Td right className="tabular text-slate-600">{r.moves ? fmtNum(r.moves) : "—"}</Td>
      <Td>{r.isActive ? <Badge color="green">Faol</Badge> : <Badge color="slate">Yashirilgan</Badge>}</Td>
      <Td right>
        <div className="flex flex-wrap justify-end gap-1">
          <Button size="sm" type="button" variant="ghost" onClick={() => setEdit(true)}><Pencil size={14} /> Qayta nomlash</Button>
          <Button size="sm" type="button" variant="ghost" onClick={toggle} disabled={busy}>
            {r.isActive ? <><EyeOff size={14} /> Yashirish</> : <><Eye size={14} /> Yoqish</>}
          </Button>
        </div>
        {err && <div className="mt-1 text-xs text-red-600">{err}</div>}
      </Td>
    </Tr>
  );
}
