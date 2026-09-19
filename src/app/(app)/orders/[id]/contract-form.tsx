"use client";

import { useActionState } from "react";
import { FileText, Upload } from "lucide-react";
import { setContract } from "../actions";
import { Button, FormError, Input } from "@/components/ui";

/**
 * Zayavka sahifasidagi shartnoma formasi:
 *  - shartnoma yo'q → summa kiritiladi (+ ixtiyoriy fayl) va "Shartnoma qilish";
 *  - shartnoma bor → Didox'da imzolangan faylni yuklash / almashtirish (summa ham o'zgartirilishi mumkin).
 */
export function ContractForm({ orderId, current, hasFile, accept }: { orderId: string; current?: number | null; hasFile?: boolean; accept: string }) {
  const [state, action, pending] = useActionState(setContract.bind(null, orderId), undefined);
  const exists = current != null;
  return (
    <form action={action} className="space-y-3">
      <FormError error={state?.error} />
      {state?.ok && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">Saqlandi</div>}
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="mb-1 block text-xs text-slate-500">Shartnoma summasi (so&apos;m) *</span>
          <Input name="contractAmount" type="number" step="1" min="1" defaultValue={current ?? ""} placeholder="0" required className="w-52" />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs text-slate-500">{hasFile ? "Faylni almashtirish (Didox'dan)" : "Imzolangan shartnoma fayli (Didox'dan)"}{exists && !hasFile ? " *" : ""}</span>
          <input name="contractFile" type="file" accept={accept} required={exists && !hasFile}
            className="block w-72 text-sm text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-slate-900 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-white hover:file:bg-slate-700" />
        </label>
        <Button disabled={pending} variant={exists ? "secondary" : "primary"}>
          {exists ? <Upload size={15} /> : <FileText size={15} />} {pending ? "Saqlanmoqda…" : exists ? (hasFile ? "Yangilash" : "Faylni yuklash") : "Shartnoma qilish"}
        </Button>
      </div>
      <p className="text-xs text-slate-500">PDF yoki rasm (JPG, PNG), 15 MB gacha. Fayl isbot sifatida tizimda saqlanadi.</p>
    </form>
  );
}
