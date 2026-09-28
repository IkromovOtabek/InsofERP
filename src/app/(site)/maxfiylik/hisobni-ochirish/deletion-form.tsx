"use client";

import { useActionState } from "react";
import { Check, Trash2 } from "lucide-react";
import { submitDeletionRequest } from "../../actions";

const field =
  "h-12 w-full rounded-xl bg-beton-50 px-4 text-[15px] text-beton-900 ring-1 ring-beton-200 transition-shadow placeholder:text-beton-400 focus:ring-2 focus:ring-insof-500 focus:outline-none";
const label = "mb-1.5 block font-mono text-[10px] tracking-[0.16em] text-beton-500 uppercase";

/** Ilovasiz hisobni o'chirish so'rovi — Google Play "veb orqali so'rov" talabi. */
export function DeletionForm() {
  const [state, action, pending] = useActionState(submitDeletionRequest, undefined);

  if (state?.ok) {
    return (
      <div className="rounded-2xl bg-beton-50 p-8 ring-1 ring-beton-200">
        <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-signal text-white">
          <Check size={22} strokeWidth={2.5} />
        </span>
        <h3 className="mt-6 font-[family-name:var(--font-unbounded)] text-xl font-semibold text-beton-900">So'rov qabul qilindi</h3>
        <p className="mt-2 max-w-md text-[15px] leading-relaxed text-beton-600">
          {state.note ?? "Shaxsingizni tasdiqlash uchun ko'rsatilgan raqamga qo'ng'iroq qilamiz. Hisob 30 kun ichida o'chiriladi."}
        </p>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-5">
      <input type="text" name="website" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden />
      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label className={label} htmlFor="del-name">Ism-familiya *</label>
          <input id="del-name" name="name" className={field} required minLength={2} maxLength={80} autoComplete="name" />
        </div>
        <div>
          <label className={label} htmlFor="del-phone">Ilovadagi telefon raqam *</label>
          <input id="del-phone" name="phone" className={field} required inputMode="tel" placeholder="90 123 45 67" autoComplete="tel" />
        </div>
      </div>
      <div>
        <label className={label} htmlFor="del-note">Izoh</label>
        <textarea id="del-note" name="note" rows={3} maxLength={500} className={`${field} h-auto py-3`} placeholder="Ixtiyoriy" />
      </div>
      {state?.error && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-red-200">{state.error}</p>}
      <button
        type="submit"
        disabled={pending}
        className="inline-flex h-12 items-center gap-2 rounded-xl bg-beton-900 px-6 text-[15px] font-medium text-white transition hover:bg-beton-800 disabled:opacity-60"
      >
        <Trash2 size={18} /> {pending ? "Yuborilmoqda…" : "So'rov yuborish"}
      </button>
    </form>
  );
}
