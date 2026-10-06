"use client";

import { useActionState } from "react";
import { Link2, Unlink } from "lucide-react";
import { Button, Field, FormError, Input, PasswordInput } from "@/components/ui";
import { linkOwnEcoAction, unlinkOwnEcoAction } from "./eco-actions";

/** O'z hisobiga Insof ECO ilovasini ulash / uzish (telefon bilan panelga kirish uchun). */
export function OwnEcoForm({ linkedPhone, enabled }: { linkedPhone: string | null; enabled: boolean }) {
  const [linkState, link, linking] = useActionState(linkOwnEcoAction, undefined);
  const [unlinkState, unlink, unlinking] = useActionState(unlinkOwnEcoAction, undefined);
  const done = (linkState?.ok && linkState.note) || (unlinkState?.ok && unlinkState.note);

  if (linkedPhone) {
    return (
      <form action={unlink} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <div className="text-sm">
          <div className="text-slate-500">Ulangan raqam</div>
          <div className="font-medium">{linkedPhone}</div>
          {!enabled && <div className="mt-1 text-xs text-amber-700">ECO serverda sozlanmagan — telefon bilan kirish hozir o&apos;chiq</div>}
        </div>
        <Field label="Joriy panel paroli"><PasswordInput name="current" required autoComplete="current-password" /></Field>
        <Button variant="secondary" disabled={unlinking}><Unlink size={16} /> Uzish</Button>
        <div className="sm:col-span-3">{done && <p className="text-sm text-emerald-700">{done}</p>}<FormError error={unlinkState?.error} /></div>
      </form>
    );
  }
  if (!enabled) {
    return (
      <div className="text-sm text-slate-500">
        {done && <p className="mb-1 text-emerald-700">{done}</p>}
        ECO serverda sozlanmagan (control.env: ECO_API_URL, ECO_API_KEY) — ulab bo&apos;lmaydi.
      </div>
    );
  }
  return (
    <form action={link} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_auto] lg:items-end">
      <Field label="ECO telefoni"><Input name="phone" type="tel" inputMode="tel" required placeholder="+998 90 123 45 67" autoComplete="off" /></Field>
      <Field label="ECO ilovasi paroli"><PasswordInput name="ecoPassword" required autoComplete="off" /></Field>
      <Field label="Joriy panel paroli"><PasswordInput name="current" required autoComplete="current-password" /></Field>
      <Button disabled={linking}><Link2 size={16} /> {linking ? "Tekshirilmoqda…" : "Ulash"}</Button>
      <div className="sm:col-span-2 lg:col-span-4">
        {done && <p className="text-sm text-emerald-700">{done}</p>}
        <FormError error={linkState?.error} />
        <p className="mt-1 text-xs text-slate-500">Ulangach login sahifasida «ECO ilovasi (telefon)» orqali ham kira olasiz. ECO paroli kuchli bo&apos;lsin — u endi panel kaliti ham. Har kirish jurnalga yoziladi.</p>
      </div>
    </form>
  );
}
