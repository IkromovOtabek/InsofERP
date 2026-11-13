"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ListTree, X } from "lucide-react";
import { Badge, Button, Field, FormSuccess, Input } from "@/components/ui";
import { QuickDelete, QuickEdit, ToolButton, type QuickAdded } from "@/components/quick-add";
import { quickRemoveCashCategory, quickRenameCashCategory } from "@/lib/quick-add-actions";

export type ManagedCat = { name: string; subs: string[] };
type Done = (old: string, x: QuickAdded, top: boolean) => void;

/**
 * O'chirish oynasidagi izoh — formadagi savatcha va «Ro'yxatni tahrirlash» uchun bitta matn.
 * Tizim kategoriyasi butunlay o'chmaydi, faqat ro'yxatdan olinadi (`lib/fin-report/category-edit.ts` → `removeCashCategory`).
 */
export function RemoveText({ name, parent, subCount = 0, system }: { name: string; parent?: string | null; subCount?: number; system?: boolean }) {
  const what = parent ? <>«{parent}» ichidagi «{name}»</> : <>«{name}» manbasi{subCount ? ` va uning ${subCount} ta sub manbasi` : ""}</>;
  return system ? (
    <p className="text-sm text-slate-600">
      {what} ro&apos;yxatdan olinadi — formalarda endi ko&apos;rinmaydi. Bu tizim {parent ? "sub manbasi" : "manbasi"}: dastur ba&apos;zi yozuvlarni
      (ish haqi, bank komissiyasi, xomashyo to&apos;lovi…) avtomatik unga yozadi, shuning uchun butunlay o&apos;chirilmaydi — eski va yangi yozuvlar
      hisobotda joyida qoladi. Qaytarish — Moliya → Kategoriyalar.
    </p>
  ) : (
    <p className="text-sm text-slate-600">
      {what} ro&apos;yxatdan o&apos;chiriladi. Kirim / chiqim yozuvlarida ishlatilgan bo&apos;lsa butunlay o&apos;chirilmaydi — faqat tanlovdan olinadi,
      eski yozuvlar hisobotda joyida qoladi.
    </p>
  );
}

/**
 * Kirim-Chiqim formasidagi «Ro'yxatni tahrirlash»: tanlangan turdagi (kirim / chiqim) barcha manba va sub manbalar bitta oynada,
 * har birining yonida «Tahrirlash» va «O'chirish» — formadagi tanlovda bittalab tanlab o'tirmasdan.
 * Qoida formadagi qalam / savatcha bilan bitta (`quickRenameCashCategory`, `quickRemoveCashCategory`): ishlatilgan kategoriya
 * butunlay o'chmaydi — nofaol bo'ladi. `locked` — tizim kategoriyalari (kod nomiga tayanadi): nomi o'zgarmaydi, faqat ro'yxatdan
 * olinadi (nofaol); ichidagi oddiy sub manbalari to'liq tahrirlanadi.
 */
export function CategoryManager({ type, cats, locked, canEdit, canDelete, onRenamed, onRemoved }: {
  type: "INCOME" | "EXPENSE"; cats: ManagedCat[]; locked: string[]; canEdit: boolean; canDelete: boolean; onRenamed: Done; onRemoved: Done;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [note, setNote] = useState("");
  const close = () => { setOpen(false); setQ(""); setNote(""); };
  useEffect(() => {
    if (!open) return;
    // Ichki «Tahrirlash» / «O'chirish» oynasi ochiq bo'lsa, Esc faqat o'shani yopadi
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && document.querySelectorAll("[role=dialog]").length < 2) { setOpen(false); setQ(""); setNote(""); } };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const k = q.trim().toLowerCase();
  const has = (s: string) => s.toLowerCase().includes(k);
  // Qidiruv: manba nomi mos kelsa — butun sub manbalari bilan, aks holda faqat mos sub manbalari
  const shown = k ? cats.flatMap((c) => has(c.name) ? [c] : c.subs.some(has) ? [{ ...c, subs: c.subs.filter(has) }] : []) : cats;
  const what = type === "INCOME" ? "Kirim" : "Chiqim";
  const done = (fn: Done): Done => (old, x, top) => { setNote(x.note ?? ""); fn(old, x, top); };

  const row = (name: string, parent: string | null, subCount = 0) => {
    const top = !parent;
    const isLocked = locked.includes(name);
    return (
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <span className={top ? "font-medium text-slate-800" : "text-sm text-slate-700"}>
          {name}{isLocked && <> <Badge color="slate" dot={false}>tizim</Badge></>}
        </span>
        {(canEdit && !isLocked) || canDelete ? (
          <span className="flex gap-1">
            {canEdit && !isLocked && (
              <QuickEdit label={`«${name}» nomini tahrirlash`} title={`«${name}» ${top ? "manbasini" : "sub manbasini"} tahrirlash`} save={quickRenameCashCategory} onSaved={(x) => done(onRenamed)(name, x, top)}>
                {parent && <input type="hidden" name="parent" value={parent} />}
                <input type="hidden" name="name" value={name} />
                <Field label="Nomi *" hint={`Shu ${top ? "manba" : "sub manba"}dagi eski yozuvlar ham yangi nomga o'tadi`}>
                  <Input name="newName" required maxLength={80} defaultValue={name} autoFocus autoComplete="off" />
                </Field>
              </QuickEdit>
            )}
            {canDelete && (
              <QuickDelete label={`«${name}» ni o'chirish`} title={`«${name}» ${top ? "manbasini" : "sub manbasini"} o'chirish`} save={quickRemoveCashCategory} onDone={(x) => done(onRemoved)(name, x, top)}>
                {parent && <input type="hidden" name="parent" value={parent} />}
                <input type="hidden" name="name" value={name} />
                <RemoveText name={name} parent={parent} subCount={subCount} system={isLocked} />
              </QuickDelete>
            )}
          </span>
        ) : null}
      </div>
    );
  };

  return (
    <>
      <ToolButton label="Barcha manba va sub manbalar — tahrirlash / o'chirish" text="Ro'yxatni tahrirlash" icon={ListTree} onClick={() => setOpen(true)} />
      {open && createPortal((
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4 sm:items-center" onMouseDown={close}>
          <div role="dialog" aria-label={`${what} manbalari`} onMouseDown={(e) => e.stopPropagation()}
            className="w-full max-w-2xl space-y-3 rounded-(--radius-card) border border-slate-200 bg-white p-5 shadow-(--shadow-pop)">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold tracking-tight">{what} manbalari va sub manbalari</h2>
              <button type="button" onClick={close} className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-900" aria-label="Yopish"><X size={18} /></button>
            </div>
            <p className="text-[13px] text-slate-500">
              Nomini o&apos;zgartirsangiz, eski yozuvlar ham yangi nomga o&apos;tadi. «tizim» belgili manbalarga dastur avtomatik yozadi — ularni
              ro&apos;yxatdan olish mumkin (formada ko&apos;rinmaydi, hisobot buzilmaydi), nomi esa o&apos;zgarmaydi. Yangisi — formadagi «+» bilan.
            </p>
            {note && <FormSuccess text={note} />}
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Qidirish: manba yoki sub manba nomi" aria-label="Qidirish" autoComplete="off" />
            <div className="max-h-[60vh] divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
              {shown.length === 0 && <p className="px-3 py-4 text-sm text-slate-500">Hech narsa topilmadi</p>}
              {shown.map((c) => (
                <div key={c.name} className="px-3 py-2">
                  {row(c.name, null, cats.find((x) => x.name === c.name)?.subs.length ?? c.subs.length)}
                  {c.subs.length > 0 && (
                    <ul className="mt-1 ml-2 space-y-0.5 border-l border-slate-200 pl-3">
                      {c.subs.map((s) => <li key={s}>{row(s, c.name)}</li>)}
                    </ul>
                  )}
                </div>
              ))}
            </div>
            <div className="flex justify-end">
              <Button type="button" variant="secondary" onClick={close}>Yopish</Button>
            </div>
          </div>
        </div>
      ), document.body)}
    </>
  );
}
