"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Trash2, Upload } from "lucide-react";
import { addEmployeeDocument, deleteEmployeeDocument } from "../../otdel-kadr/actions";
import { DOC_KINDS, OTHER_DOC_KIND, oversizeFiles } from "@/lib/kadr";
import { Button, FormError, Input, Select } from "@/components/ui";

const fileCls =
  "block w-full text-sm text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-slate-900 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-white hover:file:bg-slate-700";

/** Kartaga hujjat nusxasi qo'shish (bir nechta fayl tanlash mumkin). */
export function DocumentForms({ employeeId, accept }: { employeeId: string; accept: string }) {
  const [state, action, pending] = useActionState(addEmployeeDocument.bind(null, employeeId), undefined);
  const [tooBig, setTooBig] = useState<string | null>(null); // 10 MB dan katta fayl — yuborilmaydi
  const [kind, setKind] = useState<string>(DOC_KINDS[0]);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => { if (state?.ok) { ref.current?.reset(); setKind(DOC_KINDS[0]); } }, [state]);

  return (
    <form ref={ref} action={action} onSubmit={(e) => { const p = oversizeFiles(e.currentTarget); setTooBig(p); if (p) e.preventDefault(); }} className="space-y-2">
      <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-2 2xl:grid-cols-[200px_1fr_1fr_auto]">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600">Hujjat turi</span>
          <Select name="kind" value={kind} onChange={(e) => setKind(e.target.value)}>
            {[...DOC_KINDS, OTHER_DOC_KIND].map((k) => <option key={k} value={k}>{k}</option>)}
          </Select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600">
            Hujjat nomi {kind === OTHER_DOC_KIND ? "*" : <span className="font-normal text-slate-400">(ixtiyoriy)</span>}
          </span>
          <Input name="name" maxLength={150} required={kind === OTHER_DOC_KIND} placeholder="Masalan: Bo'shatish buyrug'i №230" />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600">Fayl(lar)</span>
          <input name="file" type="file" accept={accept} multiple required className={fileCls} />
        </label>
        <Button variant="secondary" disabled={pending}><Upload size={15} /> {pending ? "Yuklanmoqda…" : "Yuklash"}</Button>
      </div>
      <FormError error={tooBig ?? state?.error} />
      {state?.ok && !tooBig && <div className="text-sm text-emerald-700">Hujjat qo&apos;shildi</div>}
    </form>
  );
}

/** Hujjat nusxasini o'chirish tugmasi. */
export function DeleteDocument({ docId }: { docId: string }) {
  return (
    <form action={deleteEmployeeDocument.bind(null, docId)}>
      <Button variant="ghost" size="sm" className="text-red-600" title="O'chirish"><Trash2 size={14} /></Button>
    </form>
  );
}
