"use client";

import { useEffect, useId, useLayoutEffect, useReducer, useRef, useState } from "react";
import { fmtNum, numText } from "@/lib/format";
import { inputCls } from "@/components/ui";
import { cn } from "@/lib/utils";

type NumOpts = { decimals: number; negative: boolean };

/**
 * Terilgan matn → toza raqam satri: faqat raqamlar, bitta «.» kasr ajratkichi va (ruxsat bo'lsa)
 * boshidagi «-». Vergul ham kasr ajratkichi — «1,4» → «1.4»; bo'shliq va boshqa belgilar tashlanadi.
 * Terilganda birinchi ajratkich kasr bo'ladi, keyingisi e'tiborsiz (shunda «1.5» ga yana nuqta
 * bosilsa «15» bo'lib ketmaydi). `paste` da butun matn `numText` bilan o'qiladi — «1 000 000,50»,
 * «1,000,000.50», «1.000.000» to'g'ri tushadi. Kasr `decimals` xonadan oshmaydi.
 */
function cleanNum(v: string, { decimals, negative }: NumOpts, paste = false): string {
  let out = "", sep = false, frac = 0;
  for (const ch of paste ? numText(v) : v) {
    if (ch >= "0" && ch <= "9") {
      if (sep && frac++ >= decimals) continue;
      out += ch;
    } else if ((ch === "." || ch === ",") && !sep && decimals > 0) {
      sep = true;
      out += out === "" || out === "-" ? "0." : ".";
    } else if (ch === "-" && negative && out === "") out += "-";
  }
  return out.replace(/^(-?)0+(?=\d)/, "$1");
}

/** Ekranga: butun qismi bo'sh bilan ajratiladi (1 000 000), kasri terilganicha qoladi. */
const groupNum = (c: string, group: boolean) => (group ? c.replace(/^(-?)(\d+)/, (_, s: string, i: string) => s + i.replace(/\B(?=(\d{3})+(?!\d))/g, " ")) : c);

/** Dasturdan kelgan qiymat (bazadagi `1.125`, `defaultValue`) — kasri kesilmaydi: tegilmagan maydon saqlashda o'zgarmasin. */
const fromValue = (v: unknown, negative: boolean) => cleanNum(v == null ? "" : String(v), { decimals: 20, negative }, true);

const sameNum = (a: string, b: string) => a === b || (a !== "" && b !== "" && Number(a) === Number(b) && Number.isFinite(Number(a)));

/** Matndagi `n`-ta ma'noli belgidan (bo'shliqdan tashqari) keyingi o'rin — guruhlangandan keyin kursor joyida qolsin. */
function caretAfter(text: string, n: number): number {
  if (n <= 0) return 0;
  for (let i = 0, k = 0; i < text.length; i++) if (text[i] !== " " && ++k === n) return i + 1;
  return text.length;
}

type FieldProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "defaultValue" | "onChange"> & {
  value?: unknown;
  defaultValue?: unknown;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  ref?: React.Ref<HTMLInputElement>;
  decimals: number;
  negative: boolean;
  group: boolean;
  /** Forma tozalanganda (`form.reset()`) — boshqariladigan maydon egasi ham qiymatni qaytarsin (MoneyInput) */
  onFormReset?: (clean: string) => void;
};

/**
 * Raqam maydonining o'zi: ekranda guruhlangan matn (1 000 000.50), formaga esa yashirin `input`
 * orqali toza raqam (1000000.50) ketadi. `onChange` ga ham shu yashirin maydon `target` bo'lib beriladi —
 * `e.target.value` hamma joyda toza raqam, `Number()` bilan o'qiladi.
 *
 * Forma tozalanganda (React 19 server action muvaffaqiyatli tugagach ham) boshqarilmaydigan maydon
 * `defaultValue` ga qaytadi — aks holda eski qiymat ekranda va yashirin maydonda qolib ketardi.
 */
function NumField({ name, value, defaultValue, onChange, onFormReset, ref, form, disabled, min, max, decimals, negative, group, className, inputMode, autoComplete, ...rest }: FieldProps) {
  const opts = { decimals, negative };
  const controlled = value !== undefined;
  const [text, setText] = useState(() => groupNum(fromValue(controlled ? value : defaultValue, negative), group));
  const [, tick] = useReducer((x: number) => x + 1, 0);
  const clean = text.replace(/ /g, "");
  // Boshqariladigan maydon tashqaridan o'zgarsa (taklif qilingan hajm, qatorni tozalash) — ekran ham
  if (controlled) {
    const want = fromValue(value, negative);
    if (!sameNum(clean, want)) setText(groupNum(want, group));
  }

  const inputRef = useRef<HTMLInputElement | null>(null);
  const hiddenRef = useRef<HTMLInputElement>(null);
  const caret = useRef<number | null>(null);
  const setRef = (el: HTMLInputElement | null) => {
    inputRef.current = el;
    if (typeof ref === "function") ref(el);
    else if (ref) (ref as React.RefObject<HTMLInputElement | null>).current = el;
  };

  const handle = (e: React.ChangeEvent<HTMLInputElement>) => {
    const type = (e.nativeEvent as InputEvent).inputType ?? "";
    // Joylashtirish, sudrab tashlash, avtoto'ldirish — butun matn bir yo'la o'qiladi
    const paste = type === "" || type.startsWith("insertFrom") || type === "insertReplacementText";
    let raw = e.target.value, pos = e.target.selectionStart ?? raw.length;
    let next = cleanNum(raw, opts, paste);
    // Faqat bo'shliq o'chgan bo'lsa (Backspace/Delete guruh orasida) — uning yonidagi raqam o'chadi
    if (next === clean && (type === "deleteContentBackward" || type === "deleteContentForward")) {
      if (type === "deleteContentBackward" && pos > 0) { raw = raw.slice(0, pos - 1) + raw.slice(pos); pos -= 1; }
      else if (type === "deleteContentForward") raw = raw.slice(0, pos) + raw.slice(pos + 1);
      next = cleanNum(raw, opts);
    }
    const shown = groupNum(next, group);
    caret.current = paste ? shown.length : caretAfter(shown, cleanNum(raw.slice(0, pos), opts).length);
    setText(shown);
    tick();
    if (onChange && hiddenRef.current) {
      hiddenRef.current.value = next;
      onChange(Object.create(e, { target: { value: hiddenRef.current }, currentTarget: { value: hiddenRef.current } }));
    }
  };

  useLayoutEffect(() => {
    const el = inputRef.current, c = caret.current;
    caret.current = null;
    if (el && c != null && document.activeElement === el) el.setSelectionRange(c, c);
  });

  // min/max — brauzerning o'z tekshiruvi (forma yuborilmaydi), xabar o'zbekcha
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    const n = Number(clean);
    const lo = min === undefined || min === "" ? null : Number(min);
    const hi = max === undefined || max === "" ? null : Number(max);
    el.setCustomValidity(clean === "" ? ""
      : !Number.isFinite(n) || clean === "-" ? "Raqam kiriting"
      : lo != null && n < lo ? `Kamida ${fmtNum(lo, 6)}`
      : hi != null && n > hi ? `Ko'pi bilan ${fmtNum(hi, 6)}` : "");
  }, [clean, min, max]);

  const latest = useRef({ defaultValue, controlled, negative, group, onFormReset });
  latest.current = { defaultValue, controlled, negative, group, onFormReset };
  useEffect(() => {
    const f = inputRef.current?.form;
    if (!f) return;
    const reset = () => {
      const l = latest.current;
      const d = fromValue(l.defaultValue, l.negative);
      if (!l.controlled) setText(groupNum(d, l.group));
      l.onFormReset?.(d);
    };
    f.addEventListener("reset", reset);
    return () => f.removeEventListener("reset", reset);
  }, []);

  return (
    <>
      <input type="hidden" ref={hiddenRef} name={name} value={clean} form={form} disabled={disabled} />
      <input
        {...rest}
        ref={setRef}
        type="text"
        inputMode={inputMode ?? (decimals > 0 ? "decimal" : "numeric")}
        autoComplete={autoComplete ?? "off"}
        value={text}
        onChange={handle}
        form={form}
        disabled={disabled}
        className={cn(inputCls, "tabular", className)}
      />
    </>
  );
}

/** `step` → kasr xonalari: «0.001» → 3, «any» → 6; «100», «1000» (pul maydonlari) → 2 (tiyin); «1» va qadamsiz → butun son. */
function stepDecimals(step: number | string | undefined): number {
  if (step === "any") return 6;
  const n = Number(step ?? 1);
  if (!Number.isFinite(n) || n <= 0) return 0;
  if (Number.isInteger(n)) return n >= 10 ? 2 : 0;
  return Math.max(String(step).split(".")[1]?.length ?? 0, 2);
}

/**
 * `<Input type="number">` o'rnini bosadi (`components/ui` dagi `Input` shu yerga yuboradi):
 * nuqta ham, vergul ham kasr ajratkichi («1,4» = «1.4»), summa bo'sh bilan guruhlanadi
 * («1 000 000.50»), joylashtirilgan «1 000 000,50» ham to'g'ri o'qiladi. Brauzerning `type="number"`
 * maydoni vergulni, bo'shliqni va qadamga (`step="1000"`) mos kelmagan qiymatni qabul qilmasdi.
 *
 * `step` endi faqat kasr xonalarini belgilaydi (`stepDecimals`), `min` manfiy son terilishini va
 * `min`/`max` tekshiruvini. Butun son maydonlari (yil, soat, dona) guruhlanmaydi — «2026» shundayligicha.
 */
export function NumberInput({ step, ...p }: Omit<FieldProps, "decimals" | "negative" | "group">) {
  const decimals = stepDecimals(step);
  const negative = p.min === undefined || p.min === "" || Number(p.min) < 0;
  return <NumField {...p} decimals={decimals} negative={negative} group={decimals > 0} />;
}

/**
 * Pul maydoni: ekranda bo'sh bilan ajratilgan (100 000.50), formaga toza raqam (yashirin input).
 * Loyihadagi summa/narx maydonlari shu komponentdan — kiritish ham, ko'rinish ham hamma joyda bir xil.
 *
 * `value`/`onChange` berilsa boshqariladigan, bo'lmasa o'z holatini yuritadi.
 * `name` berilmasa qiymat faqat `onChange` orqali olinadi.
 * `decimals` — kasr xonalari (sukut 2, tiyin); butun so'm kerak bo'lsa 0.
 */
export function MoneyInput({ name, value, onChange, defaultValue, className, placeholder, required, disabled, readOnly, decimals = 2, suffix = "so'm", ariaLabel }: {
  name?: string;
  value?: string;
  onChange?: (raw: string) => void;
  defaultValue?: string;
  className?: string;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  readOnly?: boolean;
  decimals?: number;
  suffix?: string | null;
  /** Ekran o'quvchi uchun nom — maydon `Field` (label) ichida bo'lmasa (masalan jadval qatorida) */
  ariaLabel?: string;
}) {
  const id = useId();
  return (
    <span className="relative block">
      <NumField
        id={id}
        name={name}
        value={value}
        defaultValue={defaultValue}
        onChange={onChange && ((e) => onChange(e.target.value))}
        onFormReset={onChange}
        decimals={decimals}
        negative={false}
        group
        placeholder={placeholder ?? "0"}
        required={required}
        disabled={disabled}
        readOnly={readOnly}
        aria-label={ariaLabel}
        className={cn(suffix && "pr-12", className)}
      />
      {suffix && <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs text-slate-500">{suffix}</span>}
    </span>
  );
}
