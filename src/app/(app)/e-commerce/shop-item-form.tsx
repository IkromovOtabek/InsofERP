"use client";

import Link from "next/link";
import { useActionState, useState, useTransition } from "react";
import { Check, Eye, EyeOff, History, ImageIcon, Sparkles, Trash2 } from "lucide-react";
import { Badge, Button, Checkbox, Field, FormError, FormSuccess, Input, Textarea } from "@/components/ui";
import { SHOP_PHOTO_ACCEPT } from "@/lib/shop-upload";
import { SHOP_TEMPLATES, shopTemplateUrl, suggestShopTemplate } from "@/lib/shop-templates";
import { cn } from "@/lib/utils";
import { deleteShopPhoto, saveShopItem, toggleShopItem } from "./actions";

export type ShopRowProduct = {
  id: string;
  code: string;
  name: string;
  unit: string;
  strengthClass: string | null;
  price: number;
  group: string | null;
  /** Oxirgi tahrir (tarixdan) — kim va qachon; havola shu mahsulot tarixiga olib boradi. */
  lastChange: { itemId: string; user: string; at: string } | null;
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
  // Tavsiya etilgan shablon — surati yo'q mahsulotda oldindan tanlangan (Saqlash bosilsa qo'yiladi)
  const suggested = suggestShopTemplate(p);
  const [template, setTemplate] = useState<string | null>(it?.photo ? null : suggested);
  const [file, setFile] = useState(false);
  const templates = suggested ? [...SHOP_TEMPLATES].sort((a, b) => Number(b.key === suggested) - Number(a.key === suggested)) : SHOP_TEMPLATES;

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
          {p.lastChange && (
            <Link href={`/e-commerce?tab=tarix&p=${p.lastChange.itemId}`} className="mt-1 inline-flex items-center gap-1 text-xs text-slate-400 hover:text-slate-700 hover:underline">
              <History size={12} /> {p.lastChange.user}, {p.lastChange.at} · tarix
            </Link>
          )}
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
          <div className="sm:col-span-6">
            <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
              <span className="text-[13px] font-medium text-slate-700">Tayyor shablon surat</span>
              <span className="text-xs text-slate-500">
                {file ? "O'zingiz tanlagan fayl ishlatiladi" : template ? `Tanlandi: ${SHOP_TEMPLATES.find((t) => t.key === template)?.label}` : it?.photo ? "Joriy surat qoladi" : "Shablon yoki o'z suratingizni tanlang"}
              </span>
            </div>
            <input type="hidden" name="template" value={file ? "" : template ?? ""} />
            <div role="radiogroup" aria-label="Tayyor shablon surat" className="grid grid-cols-4 gap-2 sm:grid-cols-6 lg:grid-cols-9">
              {templates.map((t) => {
                const on = !file && template === t.key;
                return (
                  <button
                    key={t.key} type="button" role="radio" aria-checked={on} title={t.label} disabled={file}
                    onClick={() => setTemplate(on ? null : t.key)}
                    className={cn("group relative overflow-hidden rounded-lg border bg-white text-left transition disabled:opacity-40",
                      on ? "border-brand-500 ring-2 ring-brand-500/40" : "border-slate-200 hover:border-slate-400")}
                  >
                    <img src={shopTemplateUrl(t.key)} alt="" loading="lazy" className="aspect-square w-full object-cover" />
                    <span className="block truncate px-1.5 py-1 text-[11px] text-slate-600">{t.label}</span>
                    {t.key === suggested && <span className="absolute top-1 left-1 inline-flex items-center gap-0.5 rounded bg-amber-400 px-1 py-0.5 text-[10px] font-semibold text-slate-950"><Sparkles size={10} /> Mos</span>}
                    {on && <span className="absolute top-1 right-1 flex h-5 w-5 items-center justify-center rounded-full bg-brand-500 text-slate-950"><Check size={12} /></span>}
                  </button>
                );
              })}
            </div>
          </div>
          <Field label="Yoki o'z suratingiz" className="sm:col-span-4" hint="JPG/PNG/WEBP, 5 MB gacha; kvadrat surat yaxshi ko'rinadi. Fayl tanlansa shablon o'rniga u qo'yiladi">
            <div className="flex items-center gap-2">
              <input name="photo" type="file" accept={SHOP_PHOTO_ACCEPT} onChange={(e) => setFile(!!e.currentTarget.files?.length)} className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-slate-900 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-white hover:file:bg-slate-800" />
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
