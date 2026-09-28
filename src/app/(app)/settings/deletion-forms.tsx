"use client";

import { useActionState, useState, useTransition } from "react";
import { Check, UserX, X } from "lucide-react";
import { approveDeletion, rejectDeletion } from "./actions";
import { Button, Input } from "@/components/ui";
import type { ActionState } from "@/lib/action";

/**
 * Bitta so'rov qatoridagi amallar: "O'chirish" ikki bosishda (birinchisi tasdiq so'raydi),
 * "Rad etish" sabab maydoni bilan. Natija qator ichida ko'rinadi.
 */
export function DeletionRow({ id, name }: { id: string; name: string }) {
  const [armed, setArmed] = useState(false);
  const [state, setState] = useState<ActionState>(undefined);
  const [pending, start] = useTransition();
  const [rej, rejectAction, rejPending] = useActionState(rejectDeletion.bind(null, id), undefined);
  const [showReject, setShowReject] = useState(false);

  const approve = () => start(async () => setState(await approveDeletion(id)));

  if (state?.ok) return <span className="inline-flex items-center gap-1 text-xs text-emerald-700"><Check size={14} /> Hisob o'chirildi</span>;
  if (rej?.ok) return <span className="text-xs text-slate-500">Rad etildi</span>;

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-1">
        {armed ? (
          <>
            <Button variant="danger" className="px-2 py-1 text-xs" disabled={pending} onClick={approve}><UserX size={14} /> {pending ? "…" : `Ha, ${name} hisobini o'chirish`}</Button>
            <Button variant="secondary" className="px-2 py-1 text-xs" onClick={() => setArmed(false)}>Yo'q</Button>
          </>
        ) : (
          <>
            <Button variant="danger" className="px-2 py-1 text-xs" onClick={() => setArmed(true)}><UserX size={14} /> O'chirish</Button>
            <Button variant="secondary" className="px-2 py-1 text-xs" onClick={() => setShowReject((v) => !v)}><X size={14} /> Rad etish</Button>
          </>
        )}
      </div>
      {showReject && !armed && (
        <form action={rejectAction} className="flex items-center gap-1">
          <Input name="reason" placeholder="Sabab (ixtiyoriy)" className="h-8 w-48 text-xs" />
          <Button variant="secondary" className="px-2 py-1 text-xs" disabled={rejPending}>Tasdiqlash</Button>
        </form>
      )}
      {(state?.error || rej?.error) && <span className="text-xs text-red-600">{state?.error ?? rej?.error}</span>}
    </div>
  );
}
