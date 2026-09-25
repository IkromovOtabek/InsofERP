"use client";

import { useId, useState } from "react";
import { fmtNum } from "@/lib/format";
import { inputCls } from "@/components/ui";
import { cn } from "@/lib/utils";

/**
 * Terilgan matndan pul qiymatini ajratadi: bo'sh joy va boshqa belgilar tashlanadi,
 * nuqta/vergul kasr ajratkichi deb olinadi. `decimals = 0` bo'lsa kasr qismi olinmaydi —
 * shunda "1200.50" xato bilan "120050" bo'lib ketmaydi.
 */
const parse = (v: string, decimals: number) => {
  const cleaned = v.replace(/[^\d.,]/g, "").replace(/,/g, ".");
  const [head = "", ...rest] = cleaned.split(".");
  const int = head.replace(/^0+(?=\d)/, "");
  if (decimals <= 0) return int;
  if (!cleaned.includes(".")) return int;
  return `${int}.${rest.join("").slice(0, decimals)}`;
};

/** Ekranga chiqarish: butun qismi bo'sh bilan ajratiladi (100 000), kasri terilganicha qoladi. */
const show = (raw: string) => {
  if (!raw) return "";
  const [int, frac] = raw.split(".");
  const head = int ? fmtNum(Number(int)) : "0";
  return frac === undefined ? head : `${head}.${frac}`;
};

/**
 * Pul maydoni: ekranda bo'sh bilan ajratilgan ko'rinishda (100 000), formaga esa
 * toza raqam yuboriladi (yashirin input). Loyihadagi hamma summa/narx maydoni shu
 * komponentdan foydalanadi — kiritish ham, ko'rinish ham hamma joyda bir xil bo'lsin.
 *
 * `value`/`onChange` berilsa boshqariladigan, bo'lmasa o'z holatini yuritadi.
 * `name` berilmasa yashirin maydon chizilmaydi (qiymat `onChange` orqali olinadi).
 * `decimals` — tiyin kerak bo'lsa (masalan xomashyo birlik narxi) 2 qilib beriladi.
 */
export function MoneyInput({ name, value, onChange, defaultValue, className, placeholder, required, disabled, readOnly, decimals = 0, suffix = "so'm" }: {
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
}) {
  const [inner, setInner] = useState(parse(defaultValue ?? "", decimals));
  const raw = value !== undefined ? parse(value, decimals) : inner;
  const set = (v: string) => {
    const d = parse(v, decimals);
    if (onChange) onChange(d);
    else setInner(d);
  };
  const id = useId();

  return (
    <span className="relative block">
      {name && <input type="hidden" name={name} value={raw} />}
      <input
        id={id}
        inputMode={decimals > 0 ? "decimal" : "numeric"}
        autoComplete="off"
        value={show(raw)}
        onChange={(e) => set(e.target.value)}
        placeholder={placeholder ?? "0"}
        required={required}
        disabled={disabled}
        readOnly={readOnly}
        className={cn(inputCls, "tabular", suffix && "pr-12", className)}
      />
      {suffix && <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs text-slate-400">{suffix}</span>}
    </span>
  );
}
