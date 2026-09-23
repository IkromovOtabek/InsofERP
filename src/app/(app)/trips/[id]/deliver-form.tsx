"use client";

import { useActionState, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { PackageCheck, X } from "lucide-react";
import { markDelivered } from "../actions";
import { Button, FormError, Input } from "@/components/ui";

/**
 * "Yetkazildi" — sarlavhadagi tugma va uning oynasi.
 *
 * Nega oyna: reys "Yo'lda" turganda sahifada doim ochiq turgan yashil forma logistni
 * chalg'itardi — nakladnoy yopilishi bitta, qaytarib bo'lmaydigan qadam. Endi qadam
 * ataylab bosiladi va obyektda qabul qilgan shaxs F.I.O. o'sha yerda so'raladi.
 */
export function DeliverButton({ tripId }: { tripId: string }) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [state, action, pending] = useActionState(markDelivered.bind(null, tripId), undefined);

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  // Server amal muvaffaqiyatli tugadi — oyna yopiladi, sahifa yangilangan holatni ko'rsatadi
  useEffect(() => { if (state?.ok) setOpen(false); }, [state?.ok]);

  return (
    <>
      <Button type="button" variant="success" onClick={() => setOpen(true)}><PackageCheck size={16} /> Yetkazildi</Button>
      {open && mounted && createPortal((
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" onMouseDown={() => setOpen(false)}>
          <div className="w-full max-w-md overflow-hidden rounded-(--radius-card) border border-slate-200 bg-white shadow-(--shadow-pop)"
            onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="Yetkazildi">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
              <div>
                <h2 className="text-base font-semibold tracking-tight">Yetkazildi</h2>
                <p className="text-xs text-slate-500">Obyektda qabul qilgan shaxsni yozing — nakladnoy yopiladi</p>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-900" aria-label="Yopish"><X size={18} /></button>
            </div>
            <form action={action} className="space-y-3 p-5">
              <div>
                <label className="mb-1 block text-xs text-slate-500">Obyektda qabul qildi (F.I.O.)</label>
                <Input name="receiverName" autoFocus required />
              </div>
              <FormError error={state?.error} />
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Bekor</Button>
                <Button variant="success" disabled={pending}><PackageCheck size={16} /> Tasdiqlash</Button>
              </div>
            </form>
          </div>
        </div>
      ), document.body)}
    </>
  );
}
