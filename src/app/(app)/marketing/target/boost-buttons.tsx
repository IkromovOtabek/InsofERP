"use client";

import { useActionState, useState, useTransition } from "react";
import { Check, Pause, Play, X } from "lucide-react";
import type { SmmBoostStatus } from "@/generated/prisma";
import { Button, Field, FormError, FormSuccess, Input } from "@/components/ui";
import { approveBoostAction, rejectBoostAction, saveMarketingSettings, toggleBoostAction } from "./actions";

export function BoostButtons({ id, status, total, currency }: { id: string; status: SmmBoostStatus; total: string; currency: string }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ error?: string; note?: string } | null>(null);
  const run = (fn: () => Promise<{ error?: string; note?: string } | undefined>) => start(async () => {
    setMsg(null);
    try { const r = await fn(); setMsg(r?.error ? { error: r.error } : { note: r?.note ?? "Bajarildi" }); } catch { setMsg({ error: "Amal bajarilmadi" }); }
  });
  return (
    <div className="flex flex-wrap items-center gap-2">
      {status === "PENDING_APPROVAL" && (
        <>
          <Button size="sm" variant="success" disabled={pending} onClick={() => { if (confirm(`Reklamani ishga tushirasizmi? Jami ${total} ${currency} gacha sarflanadi.`)) run(() => approveBoostAction(id)); }}><Check size={14} /> Tasdiqlash va ishga tushirish</Button>
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => rejectBoostAction(id))}><X size={14} /> Rad etish</Button>
        </>
      )}
      {status === "ACTIVE" && <Button size="sm" variant="secondary" disabled={pending} onClick={() => run(() => toggleBoostAction(id, "PAUSED"))}><Pause size={14} /> To&apos;xtatish</Button>}
      {status === "PAUSED" && <Button size="sm" variant="secondary" disabled={pending} onClick={() => run(() => toggleBoostAction(id, "ACTIVE"))}><Play size={14} /> Davom ettirish</Button>}
      {msg?.error && <span role="alert" className="text-xs text-red-600">{msg.error}</span>}
      {msg?.note && <span className="text-xs text-emerald-700">{msg.note}</span>}
    </div>
  );
}

export function SettingsForm({ v }: { v: { adCurrency: string; boostDailyCap: string; boostMonthlyCap: string; defaultHashtags: string } }) {
  const [state, action, pending] = useActionState(saveMarketingSettings, undefined);
  return (
    <form action={action} className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        <Field label="Valyuta"><Input name="adCurrency" defaultValue={v.adCurrency} maxLength={3} /></Field>
        <Field label="Kunlik limit"><Input name="boostDailyCap" inputMode="decimal" defaultValue={v.boostDailyCap} /></Field>
        <Field label="Oylik limit"><Input name="boostMonthlyCap" inputMode="decimal" defaultValue={v.boostMonthlyCap} /></Field>
      </div>
      <Field label="Har postga qo'shiladigan heshteglar"><Input name="defaultHashtags" defaultValue={v.defaultHashtags} placeholder="#insof #beton" /></Field>
      <Button size="sm" disabled={pending}>Saqlash</Button>
      <FormError error={state?.error} />
      <FormSuccess text={state?.ok ? "Saqlandi" : undefined} />
    </form>
  );
}
