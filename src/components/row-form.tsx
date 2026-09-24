"use client";

import { useActionState, useEffect, useRef } from "react";
import { Check, Plus } from "lucide-react";
import { Button, FormError, Input, Select, Textarea } from "@/components/ui";
import type { ActionState } from "@/lib/action";
import { cn } from "@/lib/utils";

export type RowField = {
  name: string;
  label: string;
  type?: "text" | "number" | "password" | "select" | "checkbox" | "textarea";
  defaultValue?: string | number | boolean | null;
  options?: [string, string][];
  step?: string;
  className?: string; // grid-column kengligi, masalan "sm:col-span-2"
  placeholder?: string;
  required?: boolean;
};

/**
 * Bitta qatorli/gridli forma: sozlamalar sahifasidagi spravochniklar uchun.
 * `mode="create"` bo'lsa muvaffaqiyatdan keyin tozalanadi.
 */
export function RowForm({ action, fields, submit, mode = "edit", cols = 6, extra }: {
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  fields: RowField[];
  submit?: string;
  mode?: "create" | "edit";
  cols?: number;
  /** Saqlash yonidagi qo'shimcha amal — masalan qatorni o'chirish tugmasi. */
  extra?: React.ReactNode;
}) {
  const [state, act, pending] = useActionState(action, undefined);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => { if (state?.ok && mode === "create") ref.current?.reset(); }, [state, mode]);
  const gridCols = { 2: "sm:grid-cols-2", 3: "sm:grid-cols-3", 4: "sm:grid-cols-4", 5: "sm:grid-cols-5", 6: "sm:grid-cols-6" }[cols] ?? "sm:grid-cols-6";

  return (
    <form ref={ref} action={act} className={cn("grid grid-cols-1 items-end gap-2", gridCols)}>
      {fields.map((f) => (
        <label key={f.name} className={cn("block", f.className)}>
          <span className="mb-1 block text-xs font-medium text-slate-600">{f.label}</span>
          {f.type === "select" ? (
            <Select name={f.name} defaultValue={String(f.defaultValue ?? "")} className="py-2 text-sm">
              {f.options?.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </Select>
          ) : f.type === "checkbox" ? (
            <div className="flex h-9 items-center"><input type="checkbox" name={f.name} defaultChecked={!!f.defaultValue} /></div>
          ) : f.type === "textarea" ? (
            <Textarea name={f.name} defaultValue={String(f.defaultValue ?? "")} className="text-sm" placeholder={f.placeholder} />
          ) : (
            <Input name={f.name} type={f.type ?? "text"} step={f.step} defaultValue={f.defaultValue == null ? "" : String(f.defaultValue)} className="py-2 text-sm" placeholder={f.placeholder} required={f.required} autoComplete="off" />
          )}
        </label>
      ))}
      <div className="flex items-center gap-2">
        <Button disabled={pending} variant={mode === "create" ? "primary" : "secondary"} className="py-2 text-sm">
          {mode === "create" ? <Plus size={16} /> : <Check size={16} />}
          {submit ?? (mode === "create" ? "Qo'shish" : "Saqlash")}
        </Button>
        {state?.ok && mode === "edit" && <span className="text-xs text-emerald-700">Saqlandi</span>}
        {extra}
      </div>
      {state?.error && <div className="sm:col-span-full"><FormError error={state.error} /></div>}
    </form>
  );
}
