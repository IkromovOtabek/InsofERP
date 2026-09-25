"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { ArrowRight, Check } from "lucide-react";
import { submitLead } from "./actions";
import { onPickProduct, onPickQty } from "./lead-bus";
import { unitLabel } from "@/lib/unit";

export type LeadProduct = { id: string; name: string; unit: string };

const field =
  "h-12 w-full rounded-xl bg-beton-50 px-4 text-[15px] text-beton-900 ring-1 ring-beton-200 transition-shadow placeholder:text-beton-400 focus:ring-2 focus:ring-insof-500 focus:outline-none";
const label = "mb-1.5 block font-mono text-[10px] tracking-[0.16em] text-beton-500 uppercase";

/** Saytdagi ariza formasi. Javob darhol shu yerda ko'rsatiladi — sahifa yangilanmaydi. */
export function LeadForm({ products }: { products: LeadProduct[] }) {
  const [state, action, pending] = useActionState(submitLead, undefined);
  const [productId, setProductId] = useState("");
  const [qty, setQty] = useState("");
  const nameRef = useRef<HTMLInputElement>(null);

  // Katalogdagi "So'rash" bosilsa mahsulot shu yerda tanlangan bo'ladi
  useEffect(() => onPickProduct((id) => {
    setProductId(id);
    // Sahifa formaga sirg'alib yetgach fokus beriladi — aks holda sakrab qoladi
    window.setTimeout(() => nameRef.current?.focus({ preventScroll: true }), 600);
  }), []);

  // Kalkulyator hisoblagan hajm shu maydonga tushadi
  useEffect(() => onPickQty((q) => {
    setQty(q);
    window.setTimeout(() => nameRef.current?.focus({ preventScroll: true }), 600);
  }), []);

  const picked = products.find((p) => p.id === productId);

  if (state?.ok) {
    return (
      <div className="flex min-h-80 flex-col justify-center rounded-2xl bg-beton-50 p-8 ring-1 ring-beton-200">
        <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-signal text-white">
          <Check size={22} strokeWidth={2.5} />
        </span>
        <h3 className="mt-6 font-display text-xl font-semibold text-beton-900 sm:text-2xl">
          Ariza qabul qilindi
        </h3>
        <p className="mt-2 max-w-sm text-[15px] leading-relaxed text-beton-600">
          {state.note ?? "Sotuv bo'limi ish vaqtida siz bilan bog'lanadi va hisob-kitobni aytadi."}
        </p>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-6">
      {/* Honeypot — ekranda ko'rinmaydi, faqat botlar to'ldiradi */}
      <input type="text" name="website" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden />

      <div className="grid gap-6 sm:grid-cols-2">
        <div>
          <label className={label} htmlFor="lead-name">Ismingiz *</label>
          <input ref={nameRef} id="lead-name" name="name" required minLength={2} placeholder="Ism familiya" className={field} />
        </div>
        <div>
          <label className={label} htmlFor="lead-phone">Telefon *</label>
          <input id="lead-phone" name="phone" required type="tel" inputMode="tel" placeholder="90 123 45 67" className={`${field} font-mono tabular-nums`} />
        </div>
      </div>

      <div className="grid gap-6 sm:grid-cols-2">
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
            value={qty}
            onChange={(e) => setQty(e.target.value)}
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
        <textarea id="lead-message" name="message" rows={2} placeholder="Kerakli marka, muddat, qo'shimcha savollar" className={`${field} h-auto resize-none py-3`} />
      </div>

      {state?.error && (
        <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-red-200">{state.error}</p>
      )}

      <div className="flex flex-col gap-4 pt-1 sm:flex-row sm:items-center">
        <button
          type="submit"
          disabled={pending}
          className="group inline-flex h-13 items-center justify-center gap-3 rounded-full bg-signal pr-2 pl-7 text-base font-semibold text-white transition-colors hover:bg-signal-600 disabled:opacity-60"
        >
          {pending ? "Yuborilmoqda…" : "Arizani yuborish"}
          {!pending && (
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-white/20 transition-transform group-hover:translate-x-0.5">
              <ArrowRight size={16} />
            </span>
          )}
        </button>
        <p className="text-xs leading-relaxed text-beton-500">
          Raqamingiz faqat shu ariza bo&apos;yicha bog&apos;lanish uchun ishlatiladi.
        </p>
      </div>
    </form>
  );
}
