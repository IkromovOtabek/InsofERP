"use client";

import { startTransition, useActionState } from "react";
import { Button, FormError, Input } from "@/components/ui";
import type { ActionState } from "@/lib/action";
import { T } from "@/lib/crm/labels";
import { cancelContactAction } from "../../actions";

/** Menejer: aloqani bekor qilish (sababi majburiy). Aloqa o'chmaydi — tarixda qoladi. */
export function CancelContact({ id }: { id: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(cancelContactAction.bind(null, id), undefined);
  if (state?.ok) return null;
  return (
    <details className="mt-1 text-xs">
      <summary className="cursor-pointer select-none text-slate-400 hover:text-red-600">{T.contact.cancel}</summary>
      <form onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); startTransition(() => action(fd)); }} className="mt-2 grid gap-2 sm:flex">
        <Input name="reason" placeholder={T.contact.cancelReason} aria-label={T.contact.cancelReason} required minLength={3} />
        <Button type="submit" variant="danger" size="sm" disabled={pending}>{T.contact.cancelDo}</Button>
      </form>
      <FormError error={state?.error} />
    </details>
  );
}
