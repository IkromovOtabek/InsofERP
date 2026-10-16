"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button, FormError, FormSuccess } from "@/components/ui";
import { saveMyChecklistAction } from "./hr-actions";

/** Bugungi cheklist — bandlarni belgilab saqlash (belgilangan vaqt serverda yoziladi). */
export function CheckForm({ templateId, items }: { templateId: string; items: { key: string; label: string; done: string | null }[] }) {
  const [state, act, pending] = useActionState(saveMyChecklistAction.bind(null, templateId), undefined);
  const router = useRouter();
  useEffect(() => { if (state?.ok) router.refresh(); }, [state, router]);
  return (
    <form action={act} className="space-y-2">
      {items.map((i) => (
        <label key={i.key} className="flex items-center gap-2 rounded-md px-1 py-1 text-sm hover:bg-slate-50">
          <input type="checkbox" name="item" value={i.key} defaultChecked={!!i.done} className="h-4 w-4 rounded border-slate-300" />
          <span className={i.done ? "text-slate-500 line-through" : ""}>{i.label}</span>
          {i.done && <span className="ml-auto text-xs text-slate-400">{i.done}</span>}
        </label>
      ))}
      <FormError error={state?.error} /><FormSuccess text={state?.ok ? state.note : undefined} />
      <Button size="sm" disabled={pending}>Saqlash</Button>
    </form>
  );
}
