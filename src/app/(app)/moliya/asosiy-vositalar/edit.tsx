"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { Pencil, X } from "lucide-react";
import { Button, Callout, Field, FormActions, FormError, IconButton, Input, Select } from "@/components/ui";
import { MoneyInput } from "@/components/money-input";
import { ASSET_GROUPS } from "./forms";
import { updateAssetAction } from "./actions";

/** Tahrirlash oynasiga: sana — "yyyy-mm-dd". `valueLock` / `costLock` — maydon nega qulflangani (`lib/fin-report/assets.ts`). */
export type AssetEditData = { id: string; name: string; group: string; note: string | null; acquiredAt: string; cost: number; lifeYears: number };

/**
 * Asosiy vosita qatoridagi qalam → oyna. Nomi, guruh, izoh — doim; qiymat, sana, muddat — amortizatsiya boshlanmagan
 * bo'lsa (qiymat — kassa chiqimiga bog'lanmagan bo'lsa ham). Qulflangan maydon `disabled` — serverga yuborilmaydi.
 */
export function AssetEditButton({ asset, valueLock, costLock }: { asset: AssetEditData; valueLock: string | null; costLock: string | null }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  return (
    <>
      <IconButton icon={Pencil} type="button" label={`${asset.name} — tahrirlash`} onClick={() => setOpen(true)} className="h-7 w-7 text-slate-400" />
      {open && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" onMouseDown={() => setOpen(false)}>
          <div role="dialog" aria-label={`${asset.name} — tahrirlash`} onMouseDown={(e) => e.stopPropagation()}
            className="max-h-[90vh] w-full max-w-xl overflow-auto rounded-(--radius-card) border border-slate-200 bg-white text-left shadow-(--shadow-pop)">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2.5">
              <h2 className="text-base font-semibold tracking-tight">Asosiy vositani tahrirlash</h2>
              <IconButton icon={X} type="button" label="Yopish" onClick={() => setOpen(false)} />
            </div>
            <div className="p-4"><EditForm asset={asset} valueLock={valueLock} costLock={costLock} onDone={() => setOpen(false)} /></div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

function EditForm({ asset, valueLock, costLock, onDone }: { asset: AssetEditData; valueLock: string | null; costLock: string | null; onDone: () => void }) {
  const [state, action, pending] = useActionState(updateAssetAction, undefined);
  const [, start] = useTransition();
  useEffect(() => { if (state?.ok) onDone(); }, [state, onDone]);
  const groups = ASSET_GROUPS.includes(asset.group) ? ASSET_GROUPS : [asset.group, ...ASSET_GROUPS];
  const err = (f: string) => (state?.field === f ? state.error : undefined);
  // `<form action>` emas: xato bo'lsa terilgan qiymatlar tozalanib ketmasin
  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    start(() => action(fd));
  };
  return (
    <form onSubmit={submit} className="space-y-4">
      <FormError error={state?.error && !state.field ? state.error : undefined} />
      {valueLock && <Callout tone="warning" title="Qiymat, sana va muddat qulflangan">{valueLock}</Callout>}
      <input type="hidden" name="id" value={asset.id} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Nomi *" className="sm:col-span-2" error={err("name")}><Input name="name" required maxLength={160} defaultValue={asset.name} /></Field>
        <Field label="Guruh *" error={err("group")}>
          <Select name="group" required defaultValue={asset.group}>{groups.map((g) => <option key={g}>{g}</option>)}</Select>
        </Field>
        <Field label="Olingan / hisobga olingan sana *" error={err("acquiredAt")}><Input name="acquiredAt" type="date" required defaultValue={asset.acquiredAt} disabled={!!valueLock} /></Field>
        <Field label="Qiymati *" hint={!valueLock && costLock ? costLock : undefined} error={err("cost")}>
          <MoneyInput name="cost" required defaultValue={String(asset.cost)} disabled={!!valueLock || !!costLock} />
        </Field>
        <Field label="Xizmat muddati, yil *" hint="amortizatsiya shu muddatga bo'linadi" error={err("lifeYears")}>
          <Input name="lifeYears" type="number" step="0.25" min="0.25" required defaultValue={String(asset.lifeYears)} disabled={!!valueLock} />
        </Field>
        <Field label="Izoh" className="sm:col-span-2" error={err("note")}><Input name="note" maxLength={300} defaultValue={asset.note ?? ""} /></Field>
      </div>
      <FormActions>
        <Button disabled={pending}>{pending ? "Saqlanmoqda…" : "Saqlash"}</Button>
        <Button type="button" variant="secondary" onClick={onDone}>Bekor</Button>
      </FormActions>
    </form>
  );
}
