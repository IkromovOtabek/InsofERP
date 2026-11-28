"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { PhoneIncoming, PhoneOutgoing, UserPlus, X } from "lucide-react";
import { Badge } from "@/components/ui";
import { cn } from "@/lib/utils";
import { formatPhone } from "@/lib/phone";
import { STATUS_COLOR, STATUS_LABEL } from "@/lib/crm/labels";
import type { CrmClientStatus } from "@/generated/prisma";
import type { LiveCall as Call } from "@/lib/pbx/live";

const POLL_MS = 4_000;

/**
 * Kiruvchi / davom etayotgan qo'ng'iroq oynasi (onlinePBX webhook → `/api/pbx/live`). Sahifa ko'rinib turganda har 4 soniyada so'raydi.
 * Kim qo'ng'iroq qilyapti, oxirgi aloqa, karta yoki «Mijoz yaratish». Yopilgani shu qo'ng'iroq uchun qayta chiqmaydi.
 */
export function LiveCall() {
  const [calls, setCalls] = useState<Call[]>([]);
  const [hidden, setHidden] = useState<string[]>([]);

  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      try {
        const r = await fetch("/api/pbx/live", { cache: "no-store" });
        if (r.ok) { const j = (await r.json()) as { calls: Call[] }; if (!stop) setCalls(j.calls ?? []); }
      } catch { /* tarmoq uzilsa — keyingi safar */ }
    };
    // Yashirin tabda so'ramaydi; tabga qaytilganda — darhol
    const tick = async () => {
      if (document.visibilityState === "visible") await load();
      if (!stop) timer = setTimeout(tick, POLL_MS);
    };
    const onShow = () => { if (document.visibilityState === "visible") load(); };
    load().then(() => { if (!stop) timer = setTimeout(tick, POLL_MS); });
    document.addEventListener("visibilitychange", onShow);
    return () => { stop = true; if (timer) clearTimeout(timer); document.removeEventListener("visibilitychange", onShow); };
  }, []);

  const shown = calls.filter((c) => !hidden.includes(c.uuid));
  if (!shown.length) return null;
  return (
    <div className="fixed inset-x-3 bottom-20 z-40 grid gap-2 sm:inset-x-auto sm:right-4 sm:w-96 lg:bottom-4" role="status" aria-live="polite">
      {shown.map((c) => {
        const In = c.direction === "IN";
        const phone = c.phone ? formatPhone(c.phone) : "Raqam yashirin";
        return (
          <div key={c.uuid} className={cn("rounded-xl border bg-white p-3 shadow-lg ring-1", In ? "border-emerald-200 ring-emerald-100" : "border-blue-200 ring-blue-100")}>
            <div className="flex items-start gap-3">
              <span className={cn("mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white", In ? "bg-emerald-500" : "bg-blue-500", c.state === "RINGING" && "animate-pulse")}>
                {In ? <PhoneIncoming size={18} /> : <PhoneOutgoing size={18} />}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[12px] font-medium text-slate-500">
                  {In ? "Kiruvchi qo'ng'iroq" : "Chiquvchi qo'ng'iroq"} · {c.state === "TALKING" ? "gaplashilmoqda" : "jiringlayapti"}{c.ext ? ` · ${c.ext}` : ""}
                </div>
                <div className="truncate font-semibold text-slate-900">{c.customer?.name ?? phone}</div>
                {c.customer && <div className="truncate text-[13px] text-slate-500">{[phone, c.customer.owner].filter(Boolean).join(" · ")}</div>}
                {c.customer?.status && <div className="mt-1"><Badge color={STATUS_COLOR[c.customer.status as CrmClientStatus]}>{STATUS_LABEL[c.customer.status as CrmClientStatus]}</Badge></div>}
                {c.customer?.lastNote && <p className="mt-1 line-clamp-2 text-[13px] text-slate-600">Oxirgi aloqa: {c.customer.lastNote}</p>}
                {!c.customer && <p className="mt-0.5 text-[13px] text-slate-500">Bazada yo'q — yangi raqam</p>}
                <div className="mt-2 flex flex-wrap gap-2">
                  {c.customer ? (
                    <>
                      <Link href={`/crm/mijozlar/${c.customer.id}`} className="rounded-lg bg-slate-900 px-3 py-1.5 text-[13px] font-medium text-white">Kartani ochish</Link>
                      <Link href={`/crm/mijozlar/${c.customer.id}/aloqa`} className="rounded-lg border border-slate-200 px-3 py-1.5 text-[13px] font-medium text-slate-700">Aloqa yozish</Link>
                    </>
                  ) : c.phone ? (
                    <Link href={`/crm/mijozlar/new?phone=${encodeURIComponent(c.phone)}`} className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-[13px] font-medium text-white">
                      <UserPlus size={14} /> Mijoz yaratish
                    </Link>
                  ) : null}
                </div>
              </div>
              <button type="button" aria-label="Yopish" onClick={() => setHidden((h) => [...h, c.uuid])} className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
                <X size={16} />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
