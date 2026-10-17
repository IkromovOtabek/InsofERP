"use client";

import { useEffect, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { Plus, X } from "lucide-react";
import { Button, Checkbox, Field, FormError, Input } from "@/components/ui";
import { quickAddRecipient, quickAddSupplier, type QuickAddResult } from "@/lib/quick-add-actions";

export type QuickAdded = { id: string; name: string; vatPayer?: boolean };

/**
 * Tanlash (yoki yozib tanlash — `NameCombo`) maydoni + uning o'ng tomoniga yopishgan «+» tugmasi (MaterialField'dagi «…» kabi).
 * `add` berilmasa (ruxsat yo'q) — oddiy maydon.
 */
export function WithAdd({ add, children }: { add?: React.ReactNode; children: React.ReactNode }) {
  if (!add) return <>{children}</>;
  return <div className="flex [&>input:not([type=hidden])]:min-w-0 [&>input:not([type=hidden])]:flex-1 [&>input:not([type=hidden])]:rounded-r-none [&>select]:min-w-0 [&>select]:flex-1 [&>select]:rounded-r-none">{children}{add}</div>;
}

function AddButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} title={label} aria-label={label}
      className="-ml-px flex h-10 w-10 shrink-0 items-center justify-center rounded-r-lg border border-slate-300 bg-slate-50 text-slate-600 hover:bg-slate-100 hover:text-slate-900 pointer-coarse:h-11 pointer-coarse:w-11">
      <Plus size={17} />
    </button>
  );
}

/**
 * Kichik oyna: maydonlar + «Qo'shish». Portal orqali chiziladi, lekin React hodisalari baribir tashqi formaga
 * ko'tariladi — shuning uchun `submit` shu yerda to'xtatiladi (aks holda asosiy hujjat ham yuborilib ketardi).
 */
function QuickAddDialog({ title, open, onClose, save, onCreated, children }: {
  title: string; open: boolean; onClose: () => void;
  save: (fd: FormData) => Promise<QuickAddResult>; onCreated: (x: QuickAdded) => void; children: React.ReactNode;
}) {
  const [err, setErr] = useState("");
  const [pending, start] = useTransition();
  useEffect(() => { if (open) setErr(""); }, [open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;

  return createPortal((
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" onMouseDown={onClose}>
      <form
        role="dialog" aria-label={title}
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (pending) return;
          const fd = new FormData(e.currentTarget);
          start(async () => {
            const res = await save(fd);
            if ("error" in res) { setErr(res.error); return; }
            onCreated(res);
            onClose();
          });
        }}
        className="w-full max-w-md space-y-4 rounded-(--radius-card) border border-slate-200 bg-white p-5 shadow-(--shadow-pop)"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold tracking-tight">{title}</h2>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-900" aria-label="Yopish"><X size={18} /></button>
        </div>
        {children}
        <FormError error={err} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>Bekor qilish</Button>
          <Button disabled={pending}><Plus size={16} /> {pending ? "Saqlanmoqda…" : "Qo'shish"}</Button>
        </div>
      </form>
    </div>
  ), document.body);
}

/** «Kimdan» ichidagi «+»: yangi yetkazuvchi (Yetkazuvchilar spravochnigiga yoziladi). */
export function SupplierAdd({ onCreated }: { onCreated: (x: QuickAdded) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <AddButton label="Yangi yetkazuvchi qo'shish" onClick={() => setOpen(true)} />
      <QuickAddDialog title="Yangi yetkazuvchi" open={open} onClose={() => setOpen(false)} save={quickAddSupplier} onCreated={onCreated}>
        <Field label="Nomi *"><Input name="name" required maxLength={200} autoFocus autoComplete="off" placeholder="Masalan: «Qizilqum sement» AJ" /></Field>
        <Field label="INN (STIR)" hint="9 yoki 14 raqam, ixtiyoriy"><Input name="inn" inputMode="numeric" maxLength={20} autoComplete="off" /></Field>
        <VatPayerBox />
        <p className="text-xs text-slate-500">Telefon, manzil va boshqa rekvizitlar — keyin Yetkazuvchilar bo&apos;limida.</p>
      </QuickAddDialog>
    </>
  );
}

/** Belgi olib tashlansa ham `vatPayer=0` yuborilsin (checkbox o'chiq bo'lsa FormData'ga tushmaydi). */
function VatPayerBox() {
  const [on, setOn] = useState(true);
  return (
    <>
      <input type="hidden" name="vatPayer" value={on ? "1" : "0"} />
      <Checkbox label="QQS to'lovchisi (kirimga QQS hisoblanadi)" checked={on} onChange={(e) => setOn(e.target.checked)} />
    </>
  );
}

/**
 * Yangi oluvchi oynasi (boshqariladigan): chiqimdagi «Kimga» ro'yxatining eng pastki «Qo'lda kiritish…» bandi ochadi.
 * Tizimda yo'q nom (shofyorlar, Traktor, Mexanik…) — Oluvchilar ro'yxatiga yoziladi va darhol tanlanadi.
 */
export function RecipientAddDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (x: QuickAdded) => void }) {
  return (
    <QuickAddDialog title="Yangi oluvchi — qo'lda kiritish" open={open} onClose={onClose} save={quickAddRecipient} onCreated={onCreated}>
      <Field label="Oluvchi nomi *" hint="Xodim yoki brigada bo'lsa — ro'yxatdan tanlang; bu yerga tizimda yo'q nom yoziladi">
        <Input name="name" required maxLength={80} autoFocus autoComplete="off" placeholder="Masalan: Shofyorlar, Traktor, Mexanik / ustaxona" />
      </Field>
      <Field label="Izoh"><Input name="note" maxLength={200} autoComplete="off" placeholder="ixtiyoriy" /></Field>
    </QuickAddDialog>
  );
}

/** «Kimga» ichidagi «+»: yangi oluvchi (kirim va chiqimdagi umumiy «Kimga» ro'yxati). */
export function RecipientAdd({ onCreated }: { onCreated: (x: QuickAdded) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <AddButton label="Yangi oluvchi qo'shish" onClick={() => setOpen(true)} />
      <RecipientAddDialog open={open} onClose={() => setOpen(false)} onCreated={onCreated} />
    </>
  );
}
