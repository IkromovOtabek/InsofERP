"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Send, X } from "lucide-react";
import { Button, Field, FormError, FormSuccess, Input, Select, Textarea } from "@/components/ui";
import { REQUEST_KIND, REQUEST_KINDS } from "@/lib/hr/labels";
import type { ActionState } from "@/lib/action";
import type { HrRequestKind } from "@/generated/prisma";

type Act = (prev: ActionState, fd: FormData) => Promise<ActionState>;

/**
 * Ariza formasi — xodimning o'zi ("Mening hisobim") yoki otdel kadr xodim nomidan (`employees` berilsa — tanlov chiqadi).
 * Maydonlar tur bo'yicha: sana oralig'i yoki avans summasi.
 */
export function RequestForm({ action, employees, defaultKind = "VACATION" }: { action: Act; employees?: { id: string; fullName: string; position: string }[]; defaultKind?: HrRequestKind }) {
  const [state, act, pending] = useActionState(action, undefined);
  const [kind, setKind] = useState<HrRequestKind>(defaultKind);
  const ref = useRef<HTMLFormElement>(null);
  const router = useRouter();
  const [token, setToken] = useState(() => crypto.randomUUID());
  useEffect(() => { if (state?.ok) { ref.current?.reset(); setKind(defaultKind); setToken(crypto.randomUUID()); router.refresh(); } }, [state, router, defaultKind]);
  const meta = REQUEST_KIND[kind];
  const today = new Date().toLocaleDateString("sv-SE");
  return (
    <form ref={ref} action={act} className="space-y-3">
      <input type="hidden" name="clientToken" value={token} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {employees && (
          <Field label="Xodim *">
            <Select name="employeeId" required defaultValue="">
              <option value="" disabled>Tanlang</option>
              {employees.map((e) => <option key={e.id} value={e.id}>{e.fullName} · {e.position}</option>)}
            </Select>
          </Field>
        )}
        <Field label="Ariza turi *" hint={meta.hint}>
          <Select name="kind" value={kind} onChange={(e) => setKind(e.target.value as HrRequestKind)}>
            {REQUEST_KINDS.map((k) => <option key={k} value={k}>{REQUEST_KIND[k].label}</option>)}
          </Select>
        </Field>
      </div>
      {meta.dates && (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Boshlanishi *"><Input type="date" name="dateFrom" required defaultValue={today} /></Field>
          <Field label="Tugashi" hint="Bir kun bo'lsa — bo'sh qoldiring"><Input type="date" name="dateTo" /></Field>
        </div>
      )}
      {meta.amount && <Field label="Summa, so'm *"><Input type="number" name="amount" min={1000} step={1000} required inputMode="numeric" /></Field>}
      <Field label={kind === "VACATION" || kind === "ADVANCE" ? "Izoh" : "Sababi *"}>
        <Textarea name="reason" rows={2} required={kind !== "VACATION" && kind !== "ADVANCE"} maxLength={1000} placeholder={kind === "SICK" ? "Kasallik varaqasi raqami, shifoxona" : kind === "LATE_REASON" ? "Nega kechikdingiz" : ""} />
      </Field>
      <FormError error={state?.error} />
      <FormSuccess text={state?.ok ? state.note : undefined} />
      <Button disabled={pending}><Send size={14} /> {pending ? "Yuborilmoqda…" : employees ? "Kiritish" : "Yuborish"}</Button>
    </form>
  );
}

/** Tasdiqlash / rad etish (rad — sabab bilan). */
export function DecideButtons({ approve, reject }: { approve: Act; reject: Act }) {
  const [a, actA, pendA] = useActionState(approve, undefined);
  const [r, actR, pendR] = useActionState(reject, undefined);
  const [rejecting, setRejecting] = useState(false);
  const router = useRouter();
  useEffect(() => { if (a?.ok || r?.ok) router.refresh(); }, [a, r, router]);
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap justify-end gap-1">
        <form action={actA}><Button size="sm" disabled={pendA}><Check size={14} /> Tasdiqlash</Button></form>
        <Button size="sm" variant="ghost" onClick={() => setRejecting((v) => !v)}><X size={14} /> Rad etish</Button>
      </div>
      {rejecting && (
        <form action={actR} className="flex gap-1">
          <Input name="note" required placeholder="Rad etish sababi" className="h-8 text-xs" />
          <Button size="sm" variant="danger" disabled={pendR}>Rad etish</Button>
        </form>
      )}
      <FormError error={a?.error ?? r?.error} />
      {a?.ok && <FormSuccess text={a.note} />}
    </div>
  );
}

/** Xodim o'z kutilayotgan arizasini qaytarib oladi. */
export function CancelOwnButton({ action }: { action: () => Promise<ActionState> }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [err, setErr] = useState<string | undefined>();
  return (
    <span className="inline-flex flex-col items-end gap-1">
      <Button size="sm" variant="ghost" disabled={pending} onClick={async () => { setPending(true); const res = await action(); setPending(false); setErr(res?.error); if (res?.ok) router.refresh(); }}>
        Qaytarib olish
      </Button>
      <FormError error={err} />
    </span>
  );
}
