"use client";

import { useEffect } from "react";
import { memoryFieldAllowed, memoryKey, memoryValue } from "@/lib/input-memory";

/**
 * Maydon xotirasi — Google Sheets'dagi avto-to'ldirish kabi.
 *
 * Forma saqlanganda matn maydonlariga qo'lda yozilgan qiymatlar korxona bazasiga yoziladi.
 * Keyingi safar shu sahifadagi shu maydonga kirilganda ular ro'yxat bo'lib chiqadi, yozgan sari
 * filtrlanadi, tanlansa maydon to'ladi. Har formani alohida o'zgartirish shart emas — komponent
 * layout'da bir marta turadi va hujjat darajasidagi hodisalarni tinglaydi.
 *
 * Ro'yxat — brauzerning o'z `<datalist>` i: klaviatura, sensorli ekran va React'ning boshqariladigan
 * maydonlari bilan (tanlash `input` hodisasini chiqaradi) qo'shimcha kodsiz ishlaydi.
 *
 * O'chirish: maydonga yoki uning o'rab turgan blokiga `data-no-memory` atributi.
 * O'z ro'yxati bor maydonlar (`list`, `role="combobox"`), parol/kod, nomsiz maydonlar o'tkazib yuboriladi.
 */

const TYPES = new Set(["text", "tel", "email", "url"]);
const SKIP_AUTOCOMPLETE = new Set(["current-password", "new-password", "one-time-code", "username"]);
const ENDPOINT = "/api/input-memory";

/** Kalit → takliflar. Sahifalar orasida o'tganda ham saqlanadi (SPA navigatsiya). */
const cache = new Map<string, string[]>();
const pending = new Set<string>();

function eligible(el: unknown): el is HTMLInputElement {
  if (!(el instanceof HTMLInputElement)) return false;
  if (!TYPES.has(el.type) || el.readOnly || el.disabled || !el.name) return false;
  if (el.closest("[data-no-memory]")) return false;
  if (el.hasAttribute("list") && el.dataset.memory === undefined) return false; // o'z ro'yxati bor
  if (el.getAttribute("role") === "combobox" || el.hasAttribute("aria-autocomplete")) return false;
  if (SKIP_AUTOCOMPLETE.has(el.autocomplete)) return false;
  return memoryFieldAllowed(el.name);
}

const listId = (key: string) => `im:${key.replace(/\s/g, "_")}`;

function render(key: string) {
  const dl = document.getElementById(listId(key));
  if (!dl) return;
  dl.replaceChildren(...(cache.get(key) ?? []).map((v) => { const o = document.createElement("option"); o.value = v; return o; }));
}

/** Formadagi hali yuklanmagan maydonlarni bitta so'rov bilan oladi. */
async function load(keys: string[]) {
  const need = keys.filter((k) => !cache.has(k) && !pending.has(k));
  if (!need.length) return;
  need.forEach((k) => pending.add(k));
  try {
    const qs = need.map((k) => `key=${encodeURIComponent(k)}`).join("&");
    const res = await fetch(`${ENDPOINT}?${qs}`, { cache: "no-store" });
    if (!res.ok) return;
    const data = (await res.json()) as Record<string, string[]>;
    for (const k of need) { cache.set(k, data[k] ?? []); render(k); }
  } catch {
    // Taklif — qulaylik, xato bo'lsa maydon oddiy holicha ishlayveradi
  } finally {
    need.forEach((k) => pending.delete(k));
  }
}

function attach(el: HTMLInputElement): string {
  const key = memoryKey(location.pathname, el.name);
  const id = listId(key);
  if (!document.getElementById(id)) {
    const dl = document.createElement("datalist");
    dl.id = id;
    document.body.appendChild(dl);
    render(key);
  }
  if (el.getAttribute("list") !== id) { el.setAttribute("list", id); el.dataset.memory = key; }
  return key;
}

export function InputMemory() {
  useEffect(() => {
    const onFocus = (e: FocusEvent) => {
      if (!eligible(e.target)) return;
      const inputs = e.target.form ? Array.from(e.target.form.elements).filter(eligible) : [e.target];
      void load(inputs.map(attach));
    };

    // Brauzer tekshiruvidan (required, pattern) o'tgan forma — `submit` faqat shunda chiqadi
    const onSubmit = (e: SubmitEvent) => {
      if (!(e.target instanceof HTMLFormElement)) return;
      const items: { key: string; value: string }[] = [];
      for (const el of Array.from(e.target.elements)) {
        if (!eligible(el)) continue;
        const value = memoryValue(el.value);
        if (!value) continue;
        const key = memoryKey(location.pathname, el.name);
        items.push({ key, value });
        // Darhol ro'yxat boshiga — keyingi forma (sahifa qayta yuklanmasa ham) yangi qiymatni ko'rsin
        if (cache.has(key)) { cache.set(key, [value, ...cache.get(key)!.filter((v) => v !== value)]); render(key); }
      }
      if (!items.length) return;
      fetch(ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ items }), keepalive: true }).catch(() => {});
    };

    document.addEventListener("focusin", onFocus);
    document.addEventListener("submit", onSubmit, true);
    return () => {
      document.removeEventListener("focusin", onFocus);
      document.removeEventListener("submit", onSubmit, true);
    };
  }, []);
  return null;
}
