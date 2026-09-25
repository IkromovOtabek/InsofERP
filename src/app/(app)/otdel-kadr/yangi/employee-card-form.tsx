"use client";

import { useActionState } from "react";
import { FileText, IdCard, Save, User } from "lucide-react";
import { createEmployeeCard } from "../actions";
import { DOC_KINDS, docField, EDUCATION, MARITAL, OTHER_DOC_KIND } from "@/lib/kadr";
import { Button, Card, CardHeader, Field, FormError, Input, Select, Textarea } from "@/components/ui";
import { PhotoPicker } from "@/components/photo-picker";

const fileCls =
  "block w-full text-sm text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-slate-900 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-white hover:file:bg-slate-700";

/**
 * Otdel kadr: yangi xodim kartasi. Shaxsiy ma'lumotlar + 3x4 surat + hujjat nusxalari;
 * "Saqlash" bosilgach shaxsiy varaqa chop etish oynasi bilan ochiladi.
 */
export function EmployeeCardForm({ positions, docAccept, photoAccept, maxMb }: {
  positions: string[];
  docAccept: string;
  photoAccept: string;
  maxMb: number;
}) {
  const [state, action, pending] = useActionState(createEmployeeCard, undefined);

  return (
    <form action={action} className="space-y-4">
      <Card>
        <CardHeader title="Shaxsiy ma'lumotlar" description="Yulduzchali maydonlar shart" icon={User} />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-[150px_1fr]">
          <div>
            <span className="mb-1 block text-xs font-medium text-slate-600">3x4 surat</span>
            <PhotoPicker accept={photoAccept} hint="Kamerada olsangiz ham, fayldan tanlasangiz ham bo'ladi" />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="F.I.O. *" className="sm:col-span-2"><Input name="fullName" required autoComplete="off" placeholder="Karimov Bobur Akmalovich" /></Field>
            <Field label="Lavozim *">
              <Select name="position" required defaultValue={positions[0] ?? ""}>
                {positions.map((p) => <option key={p} value={p}>{p}</option>)}
              </Select>
            </Field>
            <Field label="Telefon" hint="Haydovchi uchun ilovaga kirish kaliti"><Input name="phone" placeholder="+998 90 123 45 67" /></Field>
            <Field label="Tug'ilgan sana"><Input name="birthDate" type="date" /></Field>
            <Field label="Ishga kirgan sana"><Input name="hiredAt" type="date" /></Field>
            <Field label="Ma'lumoti">
              <Select name="education" defaultValue=""><option value="">—</option>{EDUCATION.map((e) => <option key={e} value={e}>{e}</option>)}</Select>
            </Field>
            <Field label="Oilaviy holati">
              <Select name="maritalStatus" defaultValue=""><option value="">—</option>{MARITAL.map((m) => <option key={m} value={m}>{m}</option>)}</Select>
            </Field>
            <Field label="Yashash manzili" className="lg:col-span-3"><Input name="address" placeholder="Toshkent sh., Chilonzor t., ..." /></Field>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader title="Passport ma'lumotlari" icon={IdCard} />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Seriya va raqam"><Input name="passportSeries" placeholder="AA 1234567" autoComplete="off" /></Field>
          <Field label="JSHSHIR (PINFL)"><Input name="pinfl" placeholder="14 raqam" inputMode="numeric" autoComplete="off" /></Field>
          <Field label="Kim bergan"><Input name="passportIssuedBy" placeholder="Chilonzor IIB" /></Field>
          <Field label="Berilgan sana"><Input name="passportIssuedAt" type="date" /></Field>
        </div>
      </Card>

      <Card>
        <CardHeader title="Hujjat nusxalari" description={`Rasm yoki PDF, har biri ${maxMb} MB gacha. Fayllar tizimda saqlanadi, tashqariga chiqmaydi.`} icon={FileText} />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {DOC_KINDS.map((k) => (
            <label key={k} className="block">
              <span className="mb-1 block text-xs font-medium text-slate-600">{k}</span>
              <input name={docField(k)} type="file" accept={docAccept} className={fileCls} />
            </label>
          ))}
          <label className="block sm:col-span-2">
            <span className="mb-1 block text-xs font-medium text-slate-600">{OTHER_DOC_KIND} (bir nechta tanlash mumkin)</span>
            <input name={docField(OTHER_DOC_KIND)} type="file" accept={docAccept} multiple className={fileCls} />
          </label>
        </div>
        <div className="mt-4">
          <Field label="Izoh"><Textarea name="note" rows={2} placeholder="Smena, mas'ul shaxs, sinov muddati..." /></Field>
        </div>
      </Card>

      <FormError error={state?.error} />
      <div className="flex flex-wrap items-center gap-3">
        <Button disabled={pending}><Save size={16} /> {pending ? "Saqlanmoqda…" : "Saqlash va varaqani chop etish"}</Button>
        <span className="text-xs text-slate-500">Saqlangach shaxsiy varaqa ochiladi va chop etish oynasi o&apos;zi chiqadi (PDF sifatida ham saqlash mumkin).</span>
      </div>
    </form>
  );
}
