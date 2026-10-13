"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Check, Pencil, Wand2, X } from "lucide-react";
import type { ActionState } from "@/lib/action";
import { fmtNum } from "@/lib/format";
import { Button, FormError, FormSuccess, IconButton } from "@/components/ui";
import { MoneyInput } from "@/components/money-input";
import { fillPricesFromAvg, saveMaterialPrice } from "./price-actions";

/**
 * «Дона сўм» katagi (Sklad → Остатки). Narx bo'lsa — qiymat; yo'q bo'lsa «—» va ostida o'rtacha tannarx (chiqim shu
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
              ariaLabel={`Цена за единицу: ${name}`} className="h-8 px-2 text-right text-[13px]" />
          </div>
          <IconButton icon={Check} label="Сохранить" type="submit" disabled={pending} className="text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800" />
          <IconButton icon={X} label="Отмена" type="button" onClick={() => setEdit(false)} />
        </form>
        {state?.error && <p role="alert" className="mt-0.5 text-right text-[11px] leading-tight text-red-600">{state.error}</p>}
        <p className="mt-0.5 text-right text-[11px] leading-tight text-slate-400">пусто — по средней себестоимости</p>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-end gap-1">
      <div className="text-right">
        {price != null ? (
          <span className="font-medium text-slate-900">{fmtNum(price, 2)}</span>
        ) : (
          <span className="text-slate-400" title={avg != null ? "Цена не установлена — расход оценивается по средней себестоимости" : "Цена не установлена, прихода с ценой не было"}>—</span>
        )}
        {price == null && avg != null && <span className="block text-[11px] leading-tight text-slate-400">ср. {fmtNum(avg, 2)}</span>}
      </div>
      {canEdit && <IconButton icon={Pencil} label={`Изменить цену: ${name}`} type="button" onClick={() => setEdit(true)} className="h-7 w-7 shrink-0 text-slate-400" />}
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
        if (!confirm(`Установить «Дона сўм» = средняя себестоимость для ${count} поз. без цены?\n\nЦены, которые уже стоят, не меняются. Каждое изменение записывается в журнал.`)) e.preventDefault();
      }}>
      {count > 0 && (
        <Button variant="secondary" disabled={pending}>
          <Wand2 size={16} /> {pending ? "Заполняется…" : `Цены по себестоимости (${count})`}
        </Button>
      )}
      <FormSuccess text={state?.note} />
      <FormError error={state?.error} />
    </form>
  );
}
