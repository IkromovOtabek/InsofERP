"use client";

import { useActionState } from "react";
import { KeyRound } from "lucide-react";
import { Button, FormError } from "@/components/ui";
import { createLinkCode, type CodeState } from "./actions";

export function LinkCodeForm({ botUsername }: { botUsername?: string }) {
  const [state, action, pending] = useActionState<CodeState>(createLinkCode, undefined);
  return (
    <form action={action} className="space-y-3">
      <Button disabled={pending}><KeyRound size={16} /> {state?.code ? "Yangi kod olish" : "Ulash kodi olish"}</Button>
      {state?.code && (
        <div className="rounded-lg border border-brand-200 bg-brand-50 px-4 py-3">
          <div className="text-xs text-slate-600">Shu kodni botga yuboring — 15 daqiqa amal qiladi:</div>
          <div className="mt-1 font-mono text-3xl font-bold tracking-[0.3em] text-slate-900">{state.code}</div>
          {botUsername && (
            <a href={`https://t.me/${botUsername}?start=ulash`} target="_blank" rel="noreferrer"
               className="mt-2 inline-block text-sm font-medium text-blue-600 hover:underline">
              @{botUsername} — botni ochish
            </a>
          )}
        </div>
      )}
      <FormError error={state?.error} />
    </form>
  );
}
