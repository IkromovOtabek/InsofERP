"use client";

import { useActionState } from "react";
import { Send, RefreshCw } from "lucide-react";
import { Button, FormError, FormSuccess } from "@/components/ui";
import { syncTripWithEco } from "../actions";

/** Reys sahifasi: ECO'ga qo'lda yuborish / ECO'dan holatni olib kelish. */
export function EcoSyncButtons({ tripId, hasEco }: { tripId: string; hasEco: boolean }) {
  const [push, runPush, p1] = useActionState(() => syncTripWithEco(tripId, "push"), undefined);
  const [pull, runPull, p2] = useActionState(() => syncTripWithEco(tripId, "pull"), undefined);
  return (
    <div className="flex flex-wrap items-start gap-2">
      <form action={runPush}><Button variant="secondary" size="sm" disabled={p1}><Send size={14} /> {p1 ? "…" : hasEco ? "ECO'ga qayta yuborish" : "ECO'ga yuborish"}</Button></form>
      {hasEco && <form action={runPull}><Button variant="ghost" size="sm" disabled={p2}><RefreshCw size={14} /> {p2 ? "…" : "ECO'dan yangilash"}</Button></form>}
      <div className="w-full"><FormError error={push?.error ?? pull?.error} />{(push?.ok || pull?.ok) && <FormSuccess text="Sinxronlandi" />}</div>
    </div>
  );
}
