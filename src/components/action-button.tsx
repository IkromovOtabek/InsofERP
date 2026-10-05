"use client";

import { useActionState } from "react";
import type { ActionState } from "@/lib/action";
import { isAccessDenied } from "@/lib/access-denied";
import { Button } from "@/components/ui";

/**
 * Bir bosishli amal tugmasi (zayavkani qabul qilish, blokdan chiqarish...): server action `{ error }` qaytarsa
 * xato tugma yonida o'zbekcha ko'rinadi. Ilgari bunday action'lar `throw` qilardi — production'da matn yashirinib,
 * foydalanuvchi "kunlik limit to'lgan" kabi sabab o'rniga umumiy xato sahifasini ko'rardi.
 */
export function ActionButton({ action, children, variant, className }: {
  action: () => Promise<ActionState | void>;
  children: React.ReactNode;
  variant?: React.ComponentProps<typeof Button>["variant"];
  className?: string;
}) {
  const [state, run, pending] = useActionState<ActionState>(async () => {
    try {
      return (await action()) ?? { ok: true };
    } catch (e) {
      if (isAccessDenied(e)) return { error: "Bu amal uchun ruxsatingiz yo'q — direktordan ruxsat so'rang" };
      throw e;
    }
  }, undefined);
  return (
    <form action={run} className="inline-flex flex-col items-start gap-1">
      <Button variant={variant} className={className} disabled={pending}>{children}</Button>
      {state?.error && <span role="alert" className="max-w-sm text-xs text-red-600">{state.error}</span>}
    </form>
  );
}
