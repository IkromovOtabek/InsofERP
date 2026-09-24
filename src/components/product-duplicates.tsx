"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Merge, X } from "lucide-react";
import { mergeProducts } from "@/lib/catalog-actions";
import type { CatalogProduct } from "@/components/product-picker";
import { Button, FormError, FormSuccess } from "@/components/ui";
import { fmtNum } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Bir xil nomli mahsulotlar paneli: har guruhda qaysi yozuv qolishini foydalanuvchi belgilaydi.
 * Qolgan yozuvlardagi hujjatlar (zayavka, zames, sklad, retsept) tanlangan mahsulotga ko'chadi —
 * shuning uchun qaysi birini qoldirsa ham ma'lumot yo'qolmaydi, faqat ro'yxat tozalanadi.
 */
export function ProductDuplicates({ groups, onDone, onCancel }: {
  groups: CatalogProduct[][];
  onDone?: () => void;
  onCancel?: () => void;
}) {
  const router = useRouter();
  const [state, action, pending] = useActionState(mergeProducts, undefined);
  // Guruh kaliti — birinchi mahsulot id'si; qiymat — qoladigan mahsulot ("" — bu guruh tegilmaydi)
  const [keep, setKeep] = useState<Record<string, string>>(() =>
    Object.fromEntries(groups.map((g) => [g[0].id, g[0].id])));

  useEffect(() => { if (state?.ok) { router.refresh(); } }, [state, router]);

  const pairs = groups
    .map((g) => {
      const keepId = keep[g[0].id] ?? "";
      return { keepId, dropIds: g.filter((p) => p.id !== keepId).map((p) => p.id) };
    })
    .filter((p) => p.keepId && p.dropIds.length);
  const extra = pairs.reduce((s, p) => s + p.dropIds.length, 0);

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="pairs" value={JSON.stringify(pairs)} />

      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <p className="text-slate-600">
          <b className="text-slate-900">{groups.length} nom</b> bo&apos;yicha bir xil nomli mahsulot bor. Har qatorda <b>qoladigan</b> yozuvni belgilang —
          qolganlarining zayavka, zames, sklad va retsept yozuvlari shunga ko&apos;chiriladi, o&apos;zlari o&apos;chadi.
        </p>
        {onCancel && <Button size="sm" variant="ghost" type="button" onClick={onCancel}><X size={15} /> Yopish</Button>}
      </div>

      <div className="max-h-72 space-y-2 overflow-auto">
        {groups.map((g) => {
          const key = g[0].id;
          const chosen = keep[key] ?? "";
          return (
            <div key={key} className="rounded-lg border border-slate-200 bg-white p-2">
              <div className="mb-1 flex items-center justify-between gap-2 text-xs text-slate-500">
                <span>«{g[0].name}» — {g.length} ta yozuv</span>
                <button type="button" onClick={() => setKeep((s) => ({ ...s, [key]: chosen ? "" : g[0].id }))}
                  className="font-medium hover:underline">
                  {chosen ? "tegilmasin" : "birlashtirilsin"}
                </button>
              </div>
              <div className={cn("space-y-1", !chosen && "opacity-40")}>
                {g.map((p) => (
                  <label key={p.id} className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-sm hover:bg-slate-50">
                    <input type="radio" name={`keep-${key}`} checked={chosen === p.id} disabled={!chosen}
                      onChange={() => setKeep((s) => ({ ...s, [key]: p.id }))}
                      className="h-4 w-4 accent-slate-900" />
                    <span className="min-w-0 flex-1 truncate">{p.name}</span>
                    <span className="shrink-0 text-xs text-slate-500">{p.unit}</span>
                    <span className="shrink-0 text-xs text-slate-500">{Number(p.price) > 0 ? `${fmtNum(Number(p.price))} so'm` : "narx yo'q"}</span>
                    <span className="shrink-0 text-xs text-slate-400 tabular">{p.code}</span>
                  </label>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={pending || !pairs.length}>
          <Merge size={15} /> {pending ? "Birlashtirilmoqda…" : `Birlashtirish${extra ? ` (${extra} ta yozuv o'chadi)` : ""}`}
        </Button>
        {onCancel && <Button size="sm" variant="ghost" type="button" onClick={onCancel}>Bekor</Button>}
      </div>
      <FormError error={state?.error} />
      <FormSuccess text={state?.ok ? state.note : undefined} />
      {state?.ok && onDone && <Button size="sm" variant="secondary" type="button" onClick={onDone}>Yopish</Button>}
    </form>
  );
}
