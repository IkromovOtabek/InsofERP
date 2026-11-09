"use client";

import { useEffect, useRef, useState } from "react";
import { Languages } from "lucide-react";

/**
 * Faqat lotin yozuvi: ERP maydonlariga kirill va boshqa yozuvdagi harflar yozilmaydi — terilganda ham,
 * joylashtirilganda, sudrab tashlanganda va avto-to'ldirishda ham. Raqam, tinish belgilari, o' g' ʻ ʼ, №, « »
 * qoladi. Qo'shimcha yozuvni direktor Ruxsatlar → «Yozish tili» da beradi (`writeScripts`, `perms.til`).
 *
 * Maydondagi mavjud matnga tegilmaydi — faqat yangi kiritilayotgani tekshiriladi: bazadagi kirill nomni tahrirlash
 * uni buzmaydi. Har formani alohida o'zgartirish shart emas — komponent layout'da bir marta turadi va hujjat
 * darajasidagi hodisalarni tinglaydi (`InputMemory` kabi).
 *
 * O'chirish: maydonga yoki uning blokiga `data-any-script`. Parol maydonlari tekshirilmaydi.
 * Bu brauzer darajasidagi cheklov: Excel importi va mobil ilova bundan tashqarida.
 */

const BASE = /[\p{Script=Latin}\p{Script=Common}\p{Script=Inherited}]/u;
const CYRILLIC = /\p{Script=Cyrillic}/u;
const TYPES = new Set(["text", "search", "email", "url", "tel"]);

/** Ruxsatsiz yozuv harflarini olib tashlaydigan funksiya (`allow` — `writeScripts`). O'z joylashtirishini o'zi qiladigan
 *  maydonlar (Excel ko'rinishdagi ko'p katakli paste) ham shu qoida bilan tozalaydi. */
export function scriptCleaner(allow: string[]): (s: string) => string {
  const kirill = allow.includes("kirill"), boshqa = allow.includes("boshqa");
  const bad = (ch: string) => !BASE.test(ch) && (CYRILLIC.test(ch) ? !kirill : !boshqa);
  return (s) => (kirill && boshqa ? s : [...s].filter((ch) => !bad(ch)).join(""));
}

function eligible(el: EventTarget | null): el is HTMLInputElement | HTMLTextAreaElement {
  if (el instanceof HTMLTextAreaElement) return !el.readOnly && !el.closest("[data-any-script]");
  return el instanceof HTMLInputElement && TYPES.has(el.type) && !el.readOnly && !el.closest("[data-any-script]");
}

/** Matnni maydonga kursor o'rniga qo'yadi — `input` hodisasi bilan (React'ning `onChange` i ham ishlaydi). */
function insert(el: HTMLInputElement | HTMLTextAreaElement, text: string) {
  if (!text) return;
  el.focus();
  if (document.execCommand("insertText", false, text)) return;
  el.setRangeText(text, el.selectionStart ?? el.value.length, el.selectionEnd ?? el.value.length, "end");
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

export function ScriptGuard({ allow }: { allow: string[] }) {
  const [shown, setShown] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const kirill = allow.includes("kirill"), boshqa = allow.includes("boshqa");

  useEffect(() => {
    if (kirill && boshqa) return; // hamma yozuvga ruxsat (direktor)
    const clean = scriptCleaner([...(kirill ? ["kirill"] : []), ...(boshqa ? ["boshqa"] : [])]);
    const warn = () => {
      setShown(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setShown(false), 3500);
    };

    // Terish va datalist/avto-to'ldirishdan tanlash: ruxsatsiz harf maydonga tushmaydi
    const onBeforeInput = (e: InputEvent) => {
      if (!eligible(e.target) || !e.cancelable || !e.data) return;
      if (e.inputType !== "insertText" && e.inputType !== "insertReplacementText") return;
      const ok = clean(e.data);
      if (ok === e.data) return;
      e.preventDefault();
      // Datalist tanlovi butun qiymatni almashtiradi — uni qisman qo'ymaymiz, faqat to'xtatamiz
      if (e.inputType === "insertText") insert(e.target, ok);
      warn();
    };
    // Joylashtirish va sudrab tashlash: ruxsatsiz harflar olib tashlanib qolgani qo'yiladi
    const onTransfer = (e: ClipboardEvent | DragEvent) => {
      const dt = "clipboardData" in e ? e.clipboardData : e.dataTransfer;
      const text = dt?.getData("text/plain") ?? "";
      if (!eligible(e.target) || !text) return;
      const ok = clean(text);
      if (ok === text) return;
      e.preventDefault();
      insert(e.target, ok);
      warn();
    };
    // Mobil klaviatura va IME (kompozitsiyani bekor qilib bo'lmaydi): yakunlangan so'zdan ruxsatsiz harflar olinadi
    const onCompositionEnd = (e: CompositionEvent) => {
      const el = e.target;
      if (!eligible(el) || !e.data) return;
      const ok = clean(e.data);
      const end = el.selectionStart ?? el.value.length, start = end - e.data.length;
      if (ok === e.data || start < 0 || el.value.slice(start, end) !== e.data) return;
      const set = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value")?.set;
      set?.call(el, el.value.slice(0, start) + ok + el.value.slice(end));
      el.setSelectionRange(start + ok.length, start + ok.length);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      warn();
    };

    document.addEventListener("beforeinput", onBeforeInput, true);
    document.addEventListener("paste", onTransfer, true);
    document.addEventListener("drop", onTransfer, true);
    document.addEventListener("compositionend", onCompositionEnd, true);
    return () => {
      document.removeEventListener("beforeinput", onBeforeInput, true);
      document.removeEventListener("paste", onTransfer, true);
      document.removeEventListener("drop", onTransfer, true);
      document.removeEventListener("compositionend", onCompositionEnd, true);
      clearTimeout(timer.current);
    };
  }, [kirill, boshqa]);

  if (!shown) return null;
  return (
    <div role="status" className="pointer-events-none fixed inset-x-4 bottom-6 z-[100] flex justify-center">
      <div className="flex max-w-md items-start gap-2.5 rounded-xl bg-slate-900 px-4 py-3 text-sm text-white shadow-lg">
        <Languages size={18} className="mt-0.5 shrink-0 text-amber-300" aria-hidden />
        <span>
          <span className="block font-medium">Faqat lotin yozuvida yozing</span>
          <span className="block text-xs text-slate-300">Klaviaturani lotinga almashtiring. Boshqa yozuv kerak bo&apos;lsa — direktordan ruxsat so&apos;rang</span>
        </span>
      </div>
    </div>
  );
}
