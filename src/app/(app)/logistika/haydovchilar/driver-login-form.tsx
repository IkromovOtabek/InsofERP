"use client";

import { useActionState } from "react";
import { KeyRound } from "lucide-react";
import { giveDriverLogin } from "../actions";
import { Button, Callout, Field, FormActions, FormError, Input } from "@/components/ui";
import { dateTime } from "@/lib/format";

/**
 * Logistika yoki dispetcher haydovchiga kirish beradi (`logistika` → `driver_login`). Parolni tizim yaratadi va u faqat shu javobda
 * ko'rinadi; haydovchi birinchi kirishda o'z parolini qo'yadi (`lib/temp-password.ts`).
 * `loginHint` sahifadan keladi: `lib/self-account` server moduli, mijozga import qilinmaydi.
 */
export function DriverLoginForm({ id, login, suggested, loginHint }: { id: string; login: string | null; suggested: string; loginHint: string }) {
  const [state, action, pending] = useActionState(giveDriverLogin.bind(null, id), undefined);
  return (
    <div className="space-y-3">
      {state?.password && (
        <Callout tone="success" title={state.created ? "Login berildi" : "Yangi vaqtinchalik parol"}>
          <div className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            <span>Login</span><b className="font-mono">{state.login}</b>
            <span>Parol</span><b className="font-mono text-base tracking-wider">{state.password}</b>
          </div>
          <p className="mt-2 text-xs">
            Haydovchiga o&apos;zingiz ayting. Parol {state.until ? dateTime(new Date(state.until)) : ""} gacha amal qiladi. Haydovchi kirgach o&apos;z
            parolini o&apos;rnatadi — shundan keyin bu parol ishlamaydi. Sahifa yangilansa parol qayta ko&apos;rinmaydi.
          </p>
        </Callout>
      )}
      <FormError error={state?.error} />
      <form
        action={action}
        onSubmit={(e) => { if (login && !confirm("Haydovchining joriy paroli o'chadi va u tizimdan chiqariladi. Yangi vaqtinchalik parol berilsinmi?")) e.preventDefault(); }}
        className="space-y-3"
      >
        {!login && (
          <Field label="Login" hint={loginHint}>
            <Input name="login" defaultValue={suggested} autoCapitalize="none" autoCorrect="off" spellCheck={false} required />
          </Field>
        )}
        <FormActions>
          <Button variant={login ? "secondary" : undefined} disabled={pending}>
            <KeyRound size={16} /> {pending ? "Berilmoqda…" : login ? "Yangi vaqtinchalik parol" : "Login va parol berish"}
          </Button>
        </FormActions>
      </form>
    </div>
  );
}
