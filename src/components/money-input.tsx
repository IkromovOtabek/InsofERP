"use client";

import { useId, useState } from "react";
import { fmtNum } from "@/lib/format";
import { inputCls } from "@/components/ui";
import { cn } from "@/lib/utils";

const digits = (v: string) => v.replace(/\D/g, "").replace(/^0+(?=\d)/, "");

/**
 * Pul maydoni: ekranda bo'sh bilan ajratilgan ko'rinishda (1 000 000 000),
 * formaga esa toza raqam yuboriladi (yashirin input).
 * `value`/`onChange` berilsa boshqariladigan, bo'lmasa o'z holatini yuritadi.
 */
export function MoneyInput({ name, value, onChange, defaultValue, className, placeholder, required, disabled, suffix = "so'm" }: {
  name: string;
  value?: string;
  onChange?: (raw: string) => void;
  defaultValue?: string;
  className?: string;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  suffix?: string | null;
}) {
  const [inner, setInner] = useState(digits(defaultValue ?? ""));
  const raw = value !== undefined ? digits(value) : inner;
  const set = (v: string) => {
    const d = digits(v);
    if (onChange) onChange(d);
    else setInner(d);
  };
  const id = useId();

  return (
    <span className="relative block">
      <input type="hidden" name={name} value={raw} />
      <input
        id={id}
        inputMode="numeric"
        autoComplete="off"
        value={raw ? fmtNum(Number(raw)) : ""}
        onChange={(e) => set(e.target.value)}
        placeholder={placeholder ?? "0"}
        required={required}
        disabled={disabled}
        className={cn(inputCls, "tabular", suffix && "pr-12", className)}
      />
      {suffix && <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs text-slate-400">{suffix}</span>}
    </span>
  );
}
