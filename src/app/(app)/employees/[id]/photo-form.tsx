"use client";

import { useActionState, useState } from "react";
import { Trash2, Upload } from "lucide-react";
import { deleteEmployeePhoto, updateEmployeePhoto } from "../../otdel-kadr/actions";
import { PhotoPicker } from "@/components/photo-picker";
import { Button, FormError } from "@/components/ui";
import { oversizeFiles } from "@/lib/kadr";

/**
 * Kartadagi 3x4 surat: mavjud xodimga ham istalgan payt yuklanadi — fayldan,
 * sudrab tashlab yoki shu yerning o'zida kamerada olib. Surat tanlanmaguncha
 * "Saqlash" tugmasi chiqmaydi, ortiqcha bosish bo'lmaydi.
 */
export function EmployeePhotoForm({ employeeId, accept, hasPhoto, src }: {
  employeeId: string;
  accept: string;
  hasPhoto: boolean;
  src: string;
}) {
  const [state, action, pending] = useActionState(updateEmployeePhoto.bind(null, employeeId), undefined);
  const [picked, setPicked] = useState(false);
  const [tooBig, setTooBig] = useState<string | null>(null); // 10 MB dan katta fayl — yuborilmaydi

  return (
    <div className="w-[120px]">
      <form action={action} onSubmit={(e) => { const p = oversizeFiles(e.currentTarget); setTooBig(p); if (p) e.preventDefault(); }}>
        <PhotoPicker
          accept={accept}
          currentSrc={hasPhoto ? src : null}
          onPick={setPicked}
          hint={picked ? undefined : hasPhoto ? "3x4 surat — almashtirish uchun tanlang" : "Surat yuklanmagan"}
        />
        {picked && (
          <Button size="sm" className="mt-2 w-full justify-center" disabled={pending}>
            <Upload size={14} /> {pending ? "Saqlanmoqda…" : "Saqlash"}
          </Button>
        )}
        <FormError error={tooBig ?? state?.error} />
      </form>
      {hasPhoto && !picked && (
        <form action={deleteEmployeePhoto.bind(null, employeeId)} className="mt-1">
          <button className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-500 transition hover:text-red-600">
            <Trash2 size={12} /> Suratni o&apos;chirish
          </button>
        </form>
      )}
    </div>
  );
}
