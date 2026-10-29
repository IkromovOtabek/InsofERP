"use client";

import { useActionState, useState } from "react";
import { Send, Undo2 } from "lucide-react";
import { cancelShipmentAction, sendShipmentAction } from "../actions";
import { Button, Card, FormError, FormSuccess, Input } from "@/components/ui";

/** Snabjenets amallari: qoralamani skladga jo'natish va (sklad qabul qilmagan bo'lsa) qaytarib olish. */
export function ShipmentButtons({ id, canSend, canCancel }: { id: string; canSend: boolean; canCancel: boolean }) {
  const [sent, send, sending] = useActionState(sendShipmentAction, undefined);
  const [cancelled, cancel, cancelling] = useActionState(cancelShipmentAction, undefined);
  const [ask, setAsk] = useState(false);
  return (
    <Card>
      <form className="space-y-3">
        <input type="hidden" name="id" value={id} />
        <FormError error={sent?.error ?? cancelled?.error} />
        <FormSuccess text={sent?.ok ? sent.note : cancelled?.ok ? cancelled.note : undefined} />
        {canSend && <Button formAction={send} disabled={sending} className="w-full"><Send size={16} /> {sending ? "Yuborilmoqda…" : "Skladga jo'natish"}</Button>}
        {canCancel && (ask ? (
          <div className="space-y-2">
            <Input name="reason" placeholder="Sabab (ixtiyoriy)" />
            <div className="flex gap-2">
              <Button variant="danger" formAction={cancel} disabled={cancelling} className="flex-1">{cancelling ? "…" : "Ha, qaytarib olish"}</Button>
              <Button type="button" variant="ghost" onClick={() => setAsk(false)}>Yo&apos;q</Button>
            </div>
          </div>
        ) : (
          <Button type="button" variant="secondary" onClick={() => setAsk(true)} className="w-full"><Undo2 size={16} /> Qaytarib olish</Button>
        ))}
      </form>
    </Card>
  );
}
