"use client";

import { useState, useTransition } from "react";
import { RefreshCw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui";
import { runInsightReport, syncNow } from "./actions";

export function StatsButtons({ canAi, canSync }: { canAi: boolean; canSync: boolean }) {
  const [pending, start] = useTransition();
  const [which, setWhich] = useState<"ai" | "sync" | null>(null);
  const [msg, setMsg] = useState<{ error?: string; note?: string } | null>(null);
  const act = (k: "ai" | "sync", fn: () => Promise<{ error?: string; note?: string }>) => start(async () => {
    setWhich(k); setMsg(null);
    try { const r = await fn(); setMsg(r.error ? { error: r.error } : { note: r.note ?? "Tayyor" }); } catch { setMsg({ error: "Amal bajarilmadi" }); }
    setWhich(null);
  });
  return (
    <div className="flex flex-wrap items-center gap-2">
      {canSync && <Button variant="secondary" disabled={pending} onClick={() => act("sync", syncNow)}><RefreshCw size={15} className={which === "sync" ? "animate-spin" : undefined} /> Yangilash</Button>}
      {canAi && <Button disabled={pending} onClick={() => act("ai", runInsightReport)}><Sparkles size={15} className={which === "ai" ? "animate-pulse" : undefined} /> {which === "ai" ? "AI tahlil qilmoqda…" : "AI tahlil va g'oyalar"}</Button>}
      {msg?.error && <span role="alert" className="text-xs text-red-600">{msg.error}</span>}
      {msg?.note && <span className="text-xs text-emerald-700">{msg.note}</span>}
    </div>
  );
}
