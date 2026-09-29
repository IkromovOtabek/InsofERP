"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { Eye, EyeOff, ImageIcon, Plus } from "lucide-react";
import { Badge, Button, Checkbox, Field, FormError, FormSuccess, Input, Select } from "@/components/ui";
import { DeleteButton } from "@/components/delete-button";
import { SHOP_PHOTO_ACCEPT } from "@/lib/shop-upload";
import { deleteBanner, saveBanner, toggleBanner } from "./actions";

export type BannerRow = {
  id: string; title: string; subtitle: string | null; image: string | null; productId: string | null; buttonText: string | null;
  isActive: boolean; sortOrder: number; startsAt: string; endsAt: string;
};
type Opt = { id: string; name: string };

const imgUrl = (stored: string) => `/api/public/shop/photo/${stored}`;

/** Reklama banneri — ilovadagi swiper'ning bitta slaydi. Surat 16:9 (masalan 1200×675) tavsiya etiladi. */
export function BannerForm({ b, products }: { b?: BannerRow; products: Opt[] }) {
  const [state, action, pending] = useActionState(saveBanner.bind(null, b?.id ?? null), undefined);
  const [open, setOpen] = useState(!b);
  const [toggling, start] = useTransition();
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => { if (state?.ok && !b) ref.current?.reset(); }, [state, b]);

  return (
    <div className="py-3">
      {b && (
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex h-16 w-28 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-amber-100">
            {b.image ? <img src={imgUrl(b.image)} alt="" className="h-full w-full object-cover" /> : <ImageIcon size={18} className="text-amber-700" />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-medium">{b.title}</div>
            <div className="truncate text-xs text-slate-500">{b.subtitle ?? ""}</div>
            <div className="mt-1 flex flex-wrap gap-1.5 text-xs">
              {b.isActive ? <Badge color="green">Ko'rinadi</Badge> : <Badge>O'chirilgan</Badge>}
              {(b.startsAt || b.endsAt) && <Badge color="blue">{b.startsAt || "…"} — {b.endsAt || "…"}</Badge>}
              <span className="text-slate-400">tartib {b.sortOrder}</span>
            </div>
          </div>
          <Button type="button" size="sm" variant="secondary" disabled={toggling} onClick={() => start(() => toggleBanner(b.id, !b.isActive))}>
            {b.isActive ? <><EyeOff size={14} /> Yashirish</> : <><Eye size={14} /> Ko'rsatish</>}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setOpen((v) => !v)}>{open ? "Yopish" : "Tahrirlash"}</Button>
          <DeleteButton action={deleteBanner} id={b.id} name={b.title} />
        </div>
      )}
      {open && (
        <form ref={ref} action={action} className="mt-3 grid gap-3 rounded-lg border border-slate-200 p-4 sm:grid-cols-2">
          <div className="sm:col-span-2"><FormError error={state?.error} />{state?.ok && <FormSuccess text="Saqlandi" />}</div>
          <Field label="Sarlavha *"><Input name="title" defaultValue={b?.title} placeholder="M200 beton — chegirma" required /></Field>
          <Field label="Qisqa matn"><Input name="subtitle" defaultValue={b?.subtitle ?? ""} placeholder="Shu oy 530 000 so'm / m³" /></Field>
          <Field label="Bosilganda ochiladigan mahsulot" hint="Bo'sh — katalog ochiladi">
            <Select name="productId" defaultValue={b?.productId ?? ""}>
              <option value="">— katalog —</option>
              {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          </Field>
          <Field label="Tugma yozuvi"><Input name="buttonText" defaultValue={b?.buttonText ?? ""} placeholder="Batafsil" /></Field>
          <Field label="Boshlanish"><Input name="startsAt" type="date" defaultValue={b?.startsAt ?? ""} /></Field>
          <Field label="Tugash"><Input name="endsAt" type="date" defaultValue={b?.endsAt ?? ""} /></Field>
          <Field label="Surat (16:9, JPG/PNG/WEBP)" hint={b?.image ? "Yangi surat eskisini almashtiradi" : "Bo'lmasa brend rangli fon"}><Input name="image" type="file" accept={SHOP_PHOTO_ACCEPT} /></Field>
          <Field label="Tartib"><Input name="sortOrder" type="number" min={0} defaultValue={b?.sortOrder ?? 0} /></Field>
          <div className="sm:col-span-2 flex items-center justify-between gap-3">
            <Checkbox name="isActive" label="Ilovada ko'rinsin" defaultChecked={b?.isActive ?? true} />
            <Button disabled={pending}>{b ? "Saqlash" : <><Plus size={15} /> Reklama qo'shish</>}</Button>
          </div>
        </form>
      )}
    </div>
  );
}
