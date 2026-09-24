"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import type { ActionState } from "@/lib/action";
import { cn } from "@/lib/utils";

/**
 * Ro'yxat qatoridagi «o'chirish» tugmasi: birinchi bosishda "O'chirilsinmi?" deb so'raydi,
 * ikkinchi bosishda serverga yuboradi. Forma ichida ham ishlatiladi (forma ichida forma
 * bo'lmasin uchun oddiy tugma + server action chaqiruvi).
 *
 * Server javobidagi izoh (`note`) qatorning yonida ko'rinadi — masalan hujjatlarda
 * ishlatilgani uchun butunlay o'chirilmay arxivga olingani.
 */
export function DeleteButton({ action, id, name, title = "O'chirish", className }: {
  action: (id: string) => Promise<ActionState>;
  id: string;
  name: string;
  title?: string;
  className?: string;
}) {
  const router = useRouter();
  const [armed, setArmed] = useState(false);
  const [state, setState] = useState<ActionState>(undefined);
  const [pending, start] = useTransition();

  const run = () => start(async () => {
    const res = await action(id);
    setState(res);
    setArmed(false);
    if (res?.ok) router.refresh();
  });

  if (state?.error) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-red-600">
        {state.error}
        <button type="button" onClick={() => setState(undefined)} className="font-medium underline">yopish</button>
      </span>
    );
  }
  if (state?.ok) {
    return <span className="text-xs text-emerald-700">{state.note ?? "O'chirildi"}</span>;
  }
  if (armed) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs whitespace-nowrap">
        <span className="text-slate-600">«{name}» o&apos;chirilsinmi?</span>
        <button type="button" onClick={run} disabled={pending} className="font-semibold text-red-600 hover:underline disabled:opacity-50">
          {pending ? "o'chirilmoqda…" : "ha"}
        </button>
        <button type="button" onClick={() => setArmed(false)} className="text-slate-500 hover:underline">yo&apos;q</button>
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={() => setArmed(true)}
      title={title}
      aria-label={`${name} — ${title}`}
      className={cn("inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-400 transition hover:bg-red-50 hover:text-red-600", className)}
    >
      <Trash2 size={15} />
    </button>
  );
}
