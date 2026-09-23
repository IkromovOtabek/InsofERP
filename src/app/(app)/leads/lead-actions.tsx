"use client";

import { useActionState, useState, useTransition } from "react";
import { Check, PhoneCall, UserPlus, X } from "lucide-react";
import { convertLead, saveLeadNote, setLeadStatus } from "./actions";
import { Button, Field, FormError, Input, Textarea } from "@/components/ui";

/** Holat tugmalari: "Bog'landim" va "Bekor". Sahifa server tomondan yangilanadi. */
export function LeadStatusButtons({ leadId, status }: { leadId: string; status: string }) {
  const [pending, start] = useTransition();
  const go = (s: "NEW" | "IN_PROGRESS" | "REJECTED") => start(() => { void setLeadStatus(leadId, s); });

  return (
    <div className="flex flex-wrap gap-2">
      {status !== "IN_PROGRESS" && (
        <Button variant="secondary" size="sm" disabled={pending} onClick={() => go("IN_PROGRESS")}>
          <PhoneCall size={14} /> Bog&apos;landim
        </Button>
      )}
      {status !== "REJECTED" && (
        <Button variant="ghost" size="sm" disabled={pending} onClick={() => go("REJECTED")}>
          <X size={14} /> Bekor
        </Button>
      )}
      {status === "REJECTED" && (
        <Button variant="ghost" size="sm" disabled={pending} onClick={() => go("NEW")}>Qaytarish</Button>
      )}
    </div>
  );
}

/** Mijozga aylantirish — nomi va INN so'raladi (telefon arizadan olinadi). */
export function ConvertLead({ leadId, defaultName }: { leadId: string; defaultName: string }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(convertLead.bind(null, leadId), undefined);

  if (!open) {
    return <Button variant="secondary" size="sm" onClick={() => setOpen(true)}><UserPlus size={14} /> Mijozga aylantirish</Button>;
  }
  return (
    <form action={action} className="w-full space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Mijoz nomi *" className="min-w-44 flex-1"><Input name="name" defaultValue={defaultName} required autoComplete="off" /></Field>
        <Field label="INN" className="w-36"><Input name="inn" autoComplete="off" placeholder="ixtiyoriy" /></Field>
        <Button size="sm" disabled={pending}><Check size={14} /> Saqlash</Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>Yopish</Button>
      </div>
      <FormError error={state?.error} />
      {state?.note && <p className="text-xs text-emerald-700">{state.note}</p>}
    </form>
  );
}

/** Sotuvchining ichki izohi — mijoz buni ko'rmaydi. */
export function LeadNote({ leadId, note }: { leadId: string; note: string | null }) {
  const [state, action, pending] = useActionState(saveLeadNote.bind(null, leadId), undefined);
  return (
    <form action={action} className="space-y-2">
      <Textarea name="note" defaultValue={note ?? ""} rows={2} placeholder="Ichki izoh: nima kelishildi, qachon qayta qo'ng'iroq qilish kerak" className="text-sm" />
      <div className="flex items-center gap-2">
        <Button variant="secondary" size="sm" disabled={pending}><Check size={14} /> Izohni saqlash</Button>
        {state?.ok && <span className="text-xs text-emerald-700">Saqlandi</span>}
      </div>
      <FormError error={state?.error} />
    </form>
  );
}
