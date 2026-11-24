"use client";

import { useActionState } from "react";
import { RefreshCw } from "lucide-react";
import { Button, FormError, FormSuccess } from "@/components/ui";
import { runDataHealthNow } from "./actions";

export function RunButton() {
  const [state, action, pending] = useActionState(runDataHealthNow, undefined);
  return (
    <form action={action} className="flex flex-wrap items-center gap-3">
      <Button size="sm" disabled={pending}><RefreshCw size={15} className={pending ? "animate-spin" : undefined} /> {pending ? "Tekshirilmoqda…" : "Hozir tekshirish"}</Button>
      <FormError error={state?.error} />
      <FormSuccess text={state?.ok ? state.note : undefined} />
    </form>
  );
}
