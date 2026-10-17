"use client";

import { useId } from "react";
import { Input } from "@/components/ui";

export type NameComboValue = { id: string; text: string };
type Opt = { id: string; name: string };

/** Yozilgan matnga nom bo'yicha (katta-kichik harf farqsiz) mos variant — `id`, topilmasa "". */
export const matchName = (options: Opt[], text: string): string => {
  const t = text.replace(/\s+/g, " ").trim().toLowerCase();
  return (t && options.find((o) => o.name.trim().toLowerCase() === t)?.id) || "";
};

/**
 * Yozib tanlanadigan maydon (brauzerning `<datalist>` i): ro'yxatdan tanlash yoki yangi nom yozish — bitta katak.
 * Formaga ikkita qiymat ketadi: `idName` (ro'yxatdagi mos yozuv, yo'q bo'lsa bo'sh) va `textName` (yozilgan nom —
 * server undan yangi yozuv yaratadi). Kirim formasidagi «Ta'minotchi», «Kimga», «Darhol kimga berildi» shu bilan:
 * sklad xodimi yangi ta'minotchini yozadi, saqlashda u spravochnikga tushadi va keyingi kirimda ro'yxatda chiqadi.
 * O'z ro'yxati bor — maydon xotirasi (`components/input-memory.tsx`) bunga tegmaydi (`list` atributi).
 */
export function NameCombo({ idName, textName, options, value, onChange, placeholder, required, ariaLabel, maxLength = 200, className }: {
  idName: string;
  textName: string;
  options: Opt[];
  value: NameComboValue;
  onChange: (v: NameComboValue) => void;
  placeholder?: string;
  required?: boolean;
  ariaLabel?: string;
  maxLength?: number;
  className?: string;
}) {
  const listId = useId();
  return (
    <>
      <Input
        list={listId}
        name={textName}
        value={value.text}
        onChange={(e) => onChange({ id: matchName(options, e.target.value), text: e.target.value })}
        placeholder={placeholder}
        required={required}
        aria-label={ariaLabel}
        autoComplete="off"
        maxLength={maxLength}
        className={className}
      />
      <input type="hidden" name={idName} value={value.id} />
      <datalist id={listId}>{options.map((o) => <option key={o.id} value={o.name} />)}</datalist>
    </>
  );
}
