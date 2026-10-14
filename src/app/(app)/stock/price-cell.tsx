"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Check, Pencil, Wand2, X } from "lucide-react";
import type { ActionState } from "@/lib/action";
import { fmtNum } from "@/lib/format";
import { Button, FormError, FormSuccess, IconButton } from "@/components/ui";
import { MoneyInput } from "@/components/money-input";
import { uiText } from "@/components/script-provider";
import { fillPricesFromAvg, saveMaterialPrice } from "./price-actions";

/**
 * «Dona narxi» katagi (Sklad → Qoldiqlar). Narx bo'lsa — qiymat; yo'q bo'lsa «—» va ostida o'rtacha tannarx (chiqim shu
 * bilan baholanadi). `canEdit` (stock → "price") bo'lsa qalamcha → katak ichida kichik forma (Enter — saqlash, Esc — bekor).
 */
export function PriceCell({ materialId, name, price, avg, canEdit }: {
  materialId: string; name: string; price: number | null; avg: number | null; canEdit: boolean;
}) {
  const [edit, setEdit] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const [state, action, pending] = useActionState(async (prev: ActionState, fd: FormData) => {
    const r = await saveMaterialPrice(materialId, prev, fd);
    if (r?.ok) setEdit(false);
    return r;
  }, undefined);

  // Qalamcha bosilganda — maydonga fokus (MoneyInput ref bermaydi, ko'rinadigan inputni topamiz)
  useEffect(() => {
    if (edit) box.current?.querySelector<HTMLInputElement>("input:not([type=hidden])")?.select();
  }, [edit]);

  if (edit) {
    return (
      <div ref={box}>
        <form action={action} className="flex items-center justify-end gap-0.5" onKeyDown={(e) => { if (e.key === "Escape") setEdit(false); }}>
          <div className="w-32">
            <MoneyInput name="price" decimals={2} suffix={null} defaultValue={price == null ? "" : String(price)} placeholder={avg != null ? fmtNum(avg, 2) : "0"}
              ariaLabel={`Birlik narxi: ${name}`} className="h-8 px-2 text-right text-[13px]" />
          </div>
          <IconButton icon={Check} label="Saqlash" type="submit" disabled={pending} className="text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800" />
          <IconButton icon={X} label="Bekor qilish" type="button" onClick={() => setEdit(false)} />
        </form>
        {state?.error && <p role="alert" className="mt-0.5 text-right text-[11px] leading-tight text-red-600">{state.error}</p>}
        <p className="mt-0.5 text-right text-[11px] leading-tight text-slate-400">bo&apos;sh — o&apos;rtacha tannarx bo&apos;yicha</p>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-end gap-1">
      <div className="text-right">
        {price != null ? (
          <span className="font-medium text-slate-900">{fmtNum(price, 2)}</span>
        ) : (
          <span className="text-slate-400" title={avg != null ? "Narx belgilanmagan — chiqim o'rtacha tannarx bo'yicha baholanadi" : "Narx belgilanmagan, narxli kirim bo'lmagan"}>—</span>
        )}
        {price == null && avg != null && <span className="block text-[11px] leading-tight text-slate-400">{`o'rt. ${fmtNum(avg, 2)}`}</span>}
      </div>
      {canEdit && <IconButton icon={Pencil} label={`Narxni o'zgartirish: ${name}`} type="button" onClick={() => setEdit(true)} className="h-7 w-7 shrink-0 text-slate-400" />}
    </div>
  );
}

/**
 * «Narxsizlarga o'rtacha tannarx»: narxi belgilanmagan faol xomashyolarga o'rtacha tannarxni qo'yadi (tasdiq bilan).
 * `count` — sahifada hisoblangan: narxi yo'q, o'rtacha tannarxi bor faol xomashyolar.
 */
export function FillPricesButton({ count }: { count: number }) {
  const [state, action, pending] = useActionState(fillPricesFromAvg, undefined);
  if (count === 0 && !state) return null;
  return (
    <form action={action} className="flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        // confirm() — DOM emas: matn ekrandagi tilga `uiText` bilan o'giriladi
        const msg = `${uiText(`Narxi yo'q ${count} ta xomashyoga «Dona narxi» = o'rtacha tannarx qo'yilsinmi?`)}\n\n${uiText("Mavjud narxlar o'zgarmaydi. Har bir o'zgarish jurnalga yoziladi.")}`;
        if (!confirm(msg)) e.preventDefault();
      }}>
      {count > 0 && (
        <Button variant="secondary" disabled={pending}>
          <Wand2 size={16} /> {pending ? "To'ldirilmoqda…" : `Tannarx bo'yicha narxlar (${count})`}
        </Button>
      )}
      <FormSuccess text={state?.note} />
      <FormError error={state?.error} />
    </form>
  );
}
