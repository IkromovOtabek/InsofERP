"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { ArrowRight, Check } from "lucide-react";
import { submitLead } from "./actions";
import { onPickProduct } from "./lead-bus";
import { unitLabel } from "@/lib/unit";

export type LeadProduct = { id: string; name: string; unit: string };

const field =
  "h-11 w-full border-0 border-b border-beton-300 bg-transparent px-0 text-[15px] text-beton-900 transition-colors placeholder:text-beton-400 focus:border-signal-dim focus:outline-none";
const label = "mb-1 block font-mono text-[10px] tracking-[0.16em] text-beton-500 uppercase";

/** Saytdagi ariza formasi. Javob darhol shu yerda ko'rsatiladi — sahifa yangilanmaydi. */
export function LeadForm({ products }: { products: LeadProduct[] }) {
  const [state, action, pending] = useActionState(submitLead, undefined);
  const [productId, setProductId] = useState("");
  const nameRef = useRef<HTMLInputElement>(null);

  // Katalogdagi "So'rash" bosilsa mahsulot shu yerda tanlangan bo'ladi
  useEffect(() => onPickProduct((id) => {
    setProductId(id);
    // Sahifa formaga sirg'alib yetgach fokus beriladi — aks holda sakrab qoladi
    window.setTimeout(() => nameRef.current?.focus({ preventScroll: true }), 600);
  }), []);

  const picked = products.find((p) => p.id === productId);

  if (state?.ok) {
    return (
      <div className="flex min-h-80 flex-col justify-center rounded-lg border-l-4 border-signal bg-white p-8">
        <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-signal text-white">
          <Check size={22} strokeWidth={2.5} />
        </span>
        <h3 className="mt-6 font-display text-2xl font-bold text-beton-900">
          Ariza qabul qilindi
        </h3>
        <p className="mt-2 max-w-sm text-[15px] leading-relaxed text-beton-600">
          {state.note ?? "Sotuv bo'limi ish vaqtida siz bilan bog'lanadi va hisob-kitobni aytadi."}
        </p>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-7">
      {/* Honeypot — ekranda ko'rinmaydi, faqat botlar to'ldiradi */}
      <input type="text" name="website" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden />

      <div className="grid gap-7 sm:grid-cols-2">
        <div>
          <label className={label} htmlFor="lead-name">Ismingiz *</label>
          <input ref={nameRef} id="lead-name" name="name" required minLength={2} placeholder="Ism familiya" className={field} />
        </div>
        <div>
          <label className={label} htmlFor="lead-phone">Telefon *</label>
          <input id="lead-phone" name="phone" required type="tel" inputMode="tel" placeholder="90 123 45 67" className={`${field} font-mono tabular-nums`} />
        </div>
      </div>

      <div className="grid gap-7 sm:grid-cols-2">
        <div>
          <label className={label} htmlFor="lead-product">Mahsulot</label>
          <select
            id="lead-product"
            name="productId"
            value={productId}
            onChange={(e) => setProductId(e.target.value)}
            className={`${field} cursor-pointer`}
          >
            <option value="">Tanlang yoki bo&apos;sh qoldiring</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={label} htmlFor="lead-qty">Taxminiy hajm</label>
          <input
            id="lead-qty"
            name="qty"
            inputMode="decimal"
            placeholder={`masalan: 30 ${unitLabel(picked?.unit ?? products[0]?.unit ?? "m3")}`}
            className={`${field} font-mono tabular-nums`}
          />
        </div>
      </div>

      <div>
        <label className={label} htmlFor="lead-address">Obyekt manzili</label>
        <input id="lead-address" name="address" placeholder="Tuman, mahalla, mo'ljal" className={field} />
      </div>

      <div>
        <label className={label} htmlFor="lead-message">Izoh</label>
        <textarea id="lead-message" name="message" rows={2} placeholder="Kerakli marka, muddat, qo'shimcha savollar" className={`${field} h-auto resize-none py-2.5`} />
      </div>

      {state?.error && (
        <p className="rounded-md border-l-4 border-red-500 bg-red-50 px-4 py-3 text-sm text-red-700">{state.error}</p>
      )}

      <div className="flex flex-col gap-4 pt-1 sm:flex-row sm:items-center">
        <button
          type="submit"
          disabled={pending}
          className="inline-flex h-13 items-center justify-center gap-2 rounded-md bg-signal px-8 text-base font-semibold text-white transition-colors hover:bg-signal-600 disabled:opacity-60"
        >
          {pending ? "Yuborilmoqda…" : "Arizani yuborish"}
          {!pending && <ArrowRight size={15} />}
        </button>
        <p className="text-xs leading-relaxed text-beton-500">
          Raqamingiz faqat shu ariza bo&apos;yicha bog&apos;lanish uchun ishlatiladi.
        </p>
      </div>
    </form>
  );
}
