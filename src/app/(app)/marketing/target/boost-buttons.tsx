"use client";

import { useState, useTransition } from "react";
import { Check, Pause, Play, X } from "lucide-react";
import type { SmmBoostStatus } from "@/generated/prisma";
import { Button } from "@/components/ui";
import { approveBoostAction, rejectBoostAction, toggleBoostAction } from "./actions";

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
