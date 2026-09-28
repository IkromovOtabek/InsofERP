"use client";

import { useActionState, useState, useTransition } from "react";
import { Check, Eye, EyeOff, ImageIcon, Trash2 } from "lucide-react";
import { Badge, Button, Checkbox, Field, FormError, FormSuccess, Input, Textarea } from "@/components/ui";
import { SHOP_PHOTO_ACCEPT } from "@/lib/uploads";
import { deleteShopPhoto, saveShopItem, toggleShopItem } from "./actions";

export type ShopRowProduct = {
  id: string;
  code: string;
  name: string;
  unit: string;
  strengthClass: string | null;
  price: number;
  group: string | null;
  item: {
    isPublished: boolean;
    title: string | null;
    description: string | null;
    photo: string | null;
    price: number | null;
    minQty: number | null;
    badge: string | null;
    sortOrder: number;
  } | null;
};

/**
 * Vitrina qatori: chap tomonda surat va tez "chiqarish" tugmasi, o'ngda ilovada
 * ko'rinadigan maydonlar. Bo'sh qoldirilgan nom/narx — mahsulotniki olinadi
 * (Sozlamalar → Beton markalari o'zgarsa do'kon ham o'zgaradi).
 */
export function ShopItemForm({ p }: { p: ShopRowProduct }) {
  const [state, action, pending] = useActionState(saveShopItem.bind(null, p.id), undefined);
  const [open, setOpen] = useState(false);
  const [toggling, startToggle] = useTransition();
  const it = p.item;
  const published = it?.isPublished ?? false;

  return (
    <div className={published ? "py-4" : "py-4 opacity-80"}>
      <div className="flex flex-wrap items-start gap-4">
        <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
          {it?.photo
            ? <img src={`/api/public/shop/photo/${it.photo}`} alt="" className="h-full w-full object-cover" />
            : <div className="flex h-full w-full items-center justify-center text-slate-300"><ImageIcon size={26} /></div>}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs text-slate-500">{p.code}</span>
            <span className="font-medium text-slate-900">{it?.title?.trim() || p.name}</span>
            {p.strengthClass && <Badge color="slate" dot={false}>{p.strengthClass}</Badge>}
            {it?.badge && <Badge color="amber" dot={false}>{it.badge}</Badge>}
            {published ? <Badge color="green">Do'konda</Badge> : <Badge color="slate">Yashirin</Badge>}
          </div>
          <div className="mt-1 text-sm text-slate-600">
            {(it?.price ?? p.price).toLocaleString("ru-RU")} so'm / {p.unit === "m3" ? "m³" : p.unit}
            {it?.price != null && it.price !== p.price && <span className="ml-2 text-xs text-slate-400">(bazaviy {p.price.toLocaleString("ru-RU")})</span>}
            {p.group && <span className="ml-2 text-xs text-slate-400">· {p.group}</span>}
          </div>
          {it?.description && <p className="mt-1 line-clamp-2 text-xs text-slate-500">{it.description}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            type="button" variant={published ? "secondary" : "success"} size="sm" disabled={toggling}
            onClick={() => startToggle(() => { void toggleShopItem(p.id, !published); })}
          >
            {published ? <><EyeOff size={14} /> Yashirish</> : <><Eye size={14} /> Chiqarish</>}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setOpen((v) => !v)}>{open ? "Yopish" : "Tahrirlash"}</Button>
        </div>
      </div>

      {open && (
        <form action={action} className="mt-4 grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4 sm:grid-cols-6">
          <Field label="Ilovadagi nomi" className="sm:col-span-3" hint={`bo'sh bo'lsa: ${p.name}`}>
            <Input name="title" defaultValue={it?.title ?? ""} placeholder={p.name} />
          </Field>
          <Field label="Do'kon narxi, so'm" hint={`bo'sh bo'lsa: ${p.price.toLocaleString("ru-RU")}`}>
            <Input name="price" inputMode="decimal" defaultValue={it?.price ?? ""} placeholder={String(p.price)} />
          </Field>
          <Field label="Eng kam buyurtma">
            <Input name="minQty" inputMode="decimal" defaultValue={it?.minQty ?? ""} placeholder={p.unit === "m3" ? "masalan 3" : "masalan 10"} />
          </Field>
          <Field label="Tartib" hint="kichigi yuqorida">
            <Input name="sortOrder" type="number" min={0} defaultValue={it?.sortOrder ?? 0} />
          </Field>
          <Field label="Yorliq" className="sm:col-span-2" hint="Yangi, Top, Chegirma…">
            <Input name="badge" defaultValue={it?.badge ?? ""} maxLength={20} />
          </Field>
          <Field label="Surat" className="sm:col-span-4" hint="JPG/PNG/WEBP, 5 MB gacha; kvadrat surat yaxshi ko'rinadi">
            <div className="flex items-center gap-2">
              <input name="photo" type="file" accept={SHOP_PHOTO_ACCEPT} className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-slate-900 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-white hover:file:bg-slate-800" />
              {it?.photo && (
                <Button type="button" variant="ghost" size="sm" onClick={() => { if (confirm("Surat olib tashlansinmi?")) void deleteShopPhoto(p.id); }}>
                  <Trash2 size={14} /> Olib tashlash
                </Button>
              )}
            </div>
          </Field>
          <Field label="Tavsif" className="sm:col-span-6" hint="Ilovada mahsulot kartochkasida ko'rinadi: nimaga ishlatiladi, muddati, yetkazish sharti">
            <Textarea name="description" rows={3} defaultValue={it?.description ?? ""} />
          </Field>
          <div className="flex flex-wrap items-center gap-3 sm:col-span-6">
            <Checkbox name="isPublished" label="Do'konda ko'rsatilsin" defaultChecked={published} />
            <Button size="sm" disabled={pending}><Check size={14} /> Saqlash</Button>
            <FormError error={state?.error} />
            {state?.ok && <FormSuccess text="Saqlandi" />}
          </div>
        </form>
      )}
    </div>
  );
}
