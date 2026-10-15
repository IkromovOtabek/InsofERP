"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw, X } from "lucide-react";
import type { SmmVideoStatus } from "@/generated/prisma";
import { Button } from "@/components/ui";
import { cancelVideo, retryVideo } from "./actions";

/** Qayta urinish / bekor qilish; montaj ketayotganda sahifa har 5 soniyada yangilanadi */
export function JobButtons({ id, status }: { id: string; status: SmmVideoStatus }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const live = status === "QUEUED" || status === "GENERATING" || status === "RENDERING";
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(t);
  }, [live, router]);
  const act = (fn: () => Promise<{ error?: string }>) => start(async () => { setErr(null); const r = await fn(); if (r.error) setErr(r.error); });
  return (
    <div className="flex flex-wrap items-center gap-2">
      {(status === "FAILED" || status === "CANCELLED") && <Button size="sm" variant="secondary" disabled={pending} onClick={() => act(() => retryVideo(id))}><RotateCcw size={14} /> Qayta urinish</Button>}
      {status === "QUEUED" && <Button size="sm" variant="ghost" disabled={pending} onClick={() => act(() => cancelVideo(id))}><X size={14} /> Bekor qilish</Button>}
      {err && <span role="alert" className="text-xs text-red-600">{err}</span>}
    </div>
  );
}
