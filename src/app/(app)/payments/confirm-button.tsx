"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ActionState } from "@/lib/action";
import { cn } from "@/lib/utils";

/**
 * Qaytarib bo'lmaydigan amal tugmasi (bekor qilish, storno, o'chirish, partiyani qaytarish):
 * birinchi bosishda savol chiqadi (kerak bo'lsa sabab so'raladi), ikkinchisida serverga ketadi.
 * `DeleteButton` uslubida — bitta tasodifiy bosish hujjatni yo'q qilib yubormasin.
 *
 * Moliya va sotuv sahifalari (zayavka, schyot, kassa, to'lov) shu bitta komponentni ishlatadi.
 */
export function ConfirmButton({ action, label, question, reason, okText = "Bajarildi", className, icon, title }: {
  /** `reason` — foydalanuvchi yozgan sabab (so'ralmasa bo'sh satr). */
  action: (reason: string) => Promise<ActionState | void>;
  label: React.ReactNode;
  question: string;
  /** "required" — sababsiz yuborilmaydi; "optional" — sabab so'raladi, lekin majburiy emas. */
  reason?: "required" | "optional";
  okText?: string;
  className?: string;
  icon?: React.ReactNode;
  /** Faqat ikonkali tugma uchun — sichqoncha ustida va ekran o'qigichda ko'rinadigan nom. */
  title?: string;
}) {
  const router = useRouter();
  const [armed, setArmed] = useState(false);
  const [why, setWhy] = useState("");
  const [state, setState] = useState<ActionState>(undefined);
  const [pending, start] = useTransition();

  const run = () => start(async () => {
    try {
      const res = await action(why.trim());
      if (res?.error) { setState(res); return; }
      setState({ ok: true, note: res?.note });
      setArmed(false); setWhy("");
      router.refresh();
    } catch (e) {
      // Server action'dagi `throw` (prod'da matn yashiriladi) — umumiy gap
      setState({ error: (e as Error)?.message && !/server components render/i.test((e as Error).message) ? (e as Error).message : "Amal bajarilmadi — sahifani yangilab qayta urining" });
    }
  });

  if (state?.error) {
    return (
      <span className="inline-flex flex-wrap items-center gap-1.5 text-xs text-red-600">
        {state.error}
        <button type="button" onClick={() => setState(undefined)} className="font-medium underline">yopish</button>
      </span>
    );
  }
  if (state?.ok && !armed) {
    return <span className="text-xs text-emerald-700">{state.note ?? okText}</span>;
  }
  if (armed) {
    const blocked = reason === "required" && why.trim().length < 3;
    return (
      <span className="inline-flex flex-wrap items-center gap-1.5 text-xs">
        <span className="text-slate-600">{question}</span>
        {reason && (
          <input
            value={why}
            onChange={(e) => setWhy(e.target.value)}
            placeholder={reason === "required" ? "Sabab (majburiy)" : "Sabab (ixtiyoriy)"}
            className="h-7 w-44 rounded-md border border-slate-300 bg-white px-2 text-xs"
            autoFocus
            maxLength={300}
          />
        )}
        <button type="button" onClick={run} disabled={pending || blocked} className="font-semibold text-red-600 hover:underline disabled:opacity-40">
          {pending ? "bajarilmoqda…" : "ha"}
        </button>
        <button type="button" onClick={() => { setArmed(false); setWhy(""); }} disabled={pending} className="text-slate-500 hover:underline">yo&apos;q</button>
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={() => { setState(undefined); setArmed(true); }}
      title={title}
      aria-label={title}
      className={cn("inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm font-medium text-red-600 transition hover:bg-red-50", className)}
    >
      {icon}{label}
    </button>
  );
}
