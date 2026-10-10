"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Check, Plus, X } from "lucide-react";
import { Button, Card, Checkbox, Field, FormError, FormSuccess, Input, Select, Textarea } from "@/components/ui";
import { SHOP_PHOTO_ACCEPT } from "@/lib/shop-upload";
import { suggestShopTemplate } from "@/lib/shop-templates";
import { PRODUCT_UNITS } from "@/lib/unit";
import { createShopProduct } from "./actions";
import { TemplatePicker } from "./template-picker";

/**
 * «Mahsulot qo'shish» — yangi mahsulot spravochnikka yoziladi va shu zahoti vitrinaga chiqadi (surat — shablon yoki fayl).
 * Shablon nom yozilayotganda avtomatik taklif qilinadi; foydalanuvchi o'zi tanlasa, taklif uni bosib ketmaydi.
 */
export function NewProductForm({ groups }: { groups: { id: string; name: string }[] }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(createShopProduct, undefined);
  const [name, setName] = useState("");
  const [unit, setUnit] = useState("dona");
  const [picked, setPicked] = useState<string | null | undefined>(undefined); // undefined — foydalanuvchi tanlamagan
  const [file, setFile] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const suggested = name.trim() ? suggestShopTemplate({ name, unit }) : null;
  const template = picked === undefined ? suggested : picked;

  // Muvaffaqiyatdan keyin forma tozalanadi — ketma-ket bir nechta mahsulot qo'shish qulay bo'lsin
  useEffect(() => {
    if (!state?.ok) return;
    formRef.current?.reset();
    setName(""); setPicked(undefined); setFile(false);
  }, [state]);

  if (!open) {
    return <Button type="button" onClick={() => setOpen(true)}><Plus size={16} /> Mahsulot qo&apos;shish</Button>;
  }
  return (
    <Card className="mb-4 w-full">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="font-semibold">Yangi mahsulot</h2>
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}><X size={14} /> Yopish</Button>
      </div>
      <form ref={formRef} action={action} className="grid gap-3 sm:grid-cols-6">
        <Field label="Nomi" className="sm:col-span-3">
          <Input name="name" required value={name} onChange={(e) => setName(e.target.value)} placeholder="masalan: Bordyur BR 100.30.15" />
        </Field>
        <Field label="Kod" hint="bo'sh bo'lsa o'zi beriladi">
          <Input name="code" placeholder="BR100" maxLength={32} />
        </Field>
        <Field label="Birlik">
          <Select name="unit" value={unit} onChange={(e) => setUnit(e.target.value)}>
            {PRODUCT_UNITS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </Select>
        </Field>
        <Field label="Narx, so'm">
          <Input name="price" inputMode="decimal" required placeholder="0" />
        </Field>
        <Field label="Papka" className="sm:col-span-2">
          <Select name="groupId" defaultValue="">
            <option value="">— papkasiz —</option>
            {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </Select>
        </Field>
        <Field label="Yorliq" className="sm:col-span-2" hint="Yangi, Top, Chegirma…">
          <Input name="badge" maxLength={20} />
        </Field>
        <div className="sm:col-span-6">
          <TemplatePicker value={template} onChange={(k) => setPicked(k)} suggested={suggested} disabled={file} />
        </div>
        <Field label="Yoki o'z suratingiz" className="sm:col-span-6" hint="JPG/PNG/WEBP, 5 MB gacha. Fayl tanlansa shablon o'rniga u qo'yiladi">
          <input name="photo" type="file" accept={SHOP_PHOTO_ACCEPT} onChange={(e) => setFile(!!e.currentTarget.files?.length)} className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-slate-900 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-white hover:file:bg-slate-800" />
        </Field>
        <Field label="Tavsif" className="sm:col-span-6" hint="Ilovada mahsulot kartochkasida ko'rinadi: nimaga ishlatiladi, yetkazish sharti">
          <Textarea name="description" rows={3} />
        </Field>
        <div className="flex flex-wrap items-center gap-3 sm:col-span-6">
          <Checkbox name="isPublished" label="Darhol do'konda ko'rsatilsin" defaultChecked />
          <Button disabled={pending}><Check size={14} /> Qo&apos;shish</Button>
          <FormError error={state?.error} />
          {state?.ok && <FormSuccess text={state.note ?? "Qo'shildi"} />}
        </div>
      </form>
    </Card>
  );
}
