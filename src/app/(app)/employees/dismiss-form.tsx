"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { UserMinus, UserRoundCheck, X } from "lucide-react";
import { dismissEmployee, restoreEmployee } from "./actions";
import { Button, Field, FormError, Input, Select, Textarea } from "@/components/ui";
import { DISMISSAL_REASONS, today } from "@/lib/davomat";
import type { ActionState } from "@/lib/action";
import { cn } from "@/lib/utils";

const OTHER = "__boshqa__";

/**
 * "Ishdan bo'shatish" tugmasi: bosilganda kichik oyna ochiladi va sana bilan sababni so'raydi.
 * Tasdiqlangach xodim nofaol bo'ladi, logini bloklanadi, texnikasi bo'shaydi — kartasi o'chmaydi.
 */
export function DismissButton({ employeeId, fullName, compact }: { employeeId: string; fullName: string; compact?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState(DISMISSAL_REASONS[0]);
  const [state, act, pending] = useActionState(dismissEmployee.bind(null, employeeId), undefined);

  useEffect(() => { if (state?.ok) { setOpen(false); router.refresh(); } }, [state, router]);
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [open]);

  return (
    <>
      <button
        type="button" onClick={() => setOpen(true)} title="Ishdan bo'shatish"
        className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-slate-200 font-medium text-slate-600 transition hover:border-red-200 hover:bg-red-50 hover:text-red-600",
          compact ? "px-2 py-1 text-xs" : "h-10 px-3 text-sm")}
      >
        <UserMinus size={compact ? 13 : 16} /> Bo&apos;shatish
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-4 sm:items-center" onClick={() => setOpen(false)}>
          <div className="w-full max-w-md rounded-(--radius-card) bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">Ishdan bo&apos;shatish</h2>
                <p className="mt-0.5 text-xs text-slate-500">{fullName}</p>
              </div>
              <button type="button" onClick={() => setOpen(false)} aria-label="Yopish" className="text-slate-400 hover:text-slate-700"><X size={18} /></button>
            </div>

            <form action={act} className="space-y-3">
              <Field label="Bo'shatilgan sana *">
                <Input type="date" name="firedAt" defaultValue={today()} required />
              </Field>
              <Field label="Sabab *">
                <Select name="reason" value={reason} onChange={(e) => setReason(e.target.value)}>
                  {DISMISSAL_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
                  <option value={OTHER}>Boshqa sabab — o&apos;zim yozaman</option>
                </Select>
              </Field>
              {reason === OTHER && (
                <Field label="Sababni yozing *">
                  <Textarea name="reasonText" rows={2} required placeholder="Masalan: boshqa korxonaga o'tdi" />
                </Field>
              )}

              <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                Xodim nofaol bo&apos;ladi, logini bloklanadi va biriktirilgan texnikasi bo&apos;shaydi.
                Kartasi, hujjatlari va reyslar tarixi joyida qoladi — keraksa qaytarish mumkin.
              </p>

              <FormError error={state?.error} />
              <div className="flex items-center justify-end gap-2 pt-1">
                <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Bekor qilish</Button>
                <Button type="submit" disabled={pending}>{pending ? "Bo'shatilmoqda…" : "Ishdan bo'shatish"}</Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

/** Xato bosilgan bo'shatishni qaytarish — ikki bosqichli tasdiq bilan. */
export function RestoreButton({ employeeId, compact }: { employeeId: string; compact?: boolean }) {
  const router = useRouter();
  const [armed, setArmed] = useState(false);
  const [state, setState] = useState<ActionState>(undefined);
  const [pending, start] = useTransition();

  const run = () => start(async () => {
    const res = await restoreEmployee(employeeId);
    setState(res);
    setArmed(false);
    if (res?.ok) router.refresh();
  });

  if (state?.error) {
    return <span className="text-xs text-red-600">{state.error}</span>;
  }
  if (armed) {
    return (
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs">
        <span className="text-slate-600">Ishga qaytarilsinmi?</span>
        <button type="button" onClick={run} disabled={pending} className="font-semibold text-emerald-700 hover:underline disabled:opacity-50">{pending ? "…" : "ha"}</button>
        <button type="button" onClick={() => setArmed(false)} className="text-slate-500 hover:underline">yo&apos;q</button>
      </span>
    );
  }
  return (
    <button
      type="button" onClick={() => setArmed(true)} title="Ishga qaytarish"
      className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-slate-200 font-medium text-slate-600 transition hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700",
        compact ? "px-2 py-1 text-xs" : "h-10 px-3 text-sm")}
    >
      <UserRoundCheck size={compact ? 13 : 16} /> Qaytarish
    </button>
  );
}
