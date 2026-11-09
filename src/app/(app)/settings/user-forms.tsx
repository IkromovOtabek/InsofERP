"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Check, Copy, KeyRound, RotateCcw, Save, ShieldCheck, UserPlus } from "lucide-react";
import { createUser, resetPassword, saveSupplyDirectorLimit, savePayablesSince, saveVatPayer, saveProductionChannel, saveUserPerms, copyUserPerms, toggleUser, updateUser, applyPermTemplate, bulkSaveUserPerms } from "./actions";
import { MoneyInput } from "@/components/money-input";
import { Button, Field, FormError, FormSuccess, Input, PasswordInput, Select } from "@/components/ui";
import { BULK_FORM_ID, type PermModule } from "@/lib/perm-modules";
import { PermsTree } from "./perms-tree";

export function UserForm({ roles }: { roles: [string, string][] }) {
  const [state, action, pending] = useActionState(createUser, undefined);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => { if (state?.ok) ref.current?.reset(); }, [state]);
  return (
    <form ref={ref} action={action} className="grid grid-cols-1 items-end gap-3 sm:grid-cols-[1fr_1fr_160px_180px_auto]">
      <Field label="F.I.O. *"><Input name="fullName" required /></Field>
      <Field label="Login *"><Input name="login" autoComplete="off" required /></Field>
      <Field label="Parol *"><PasswordInput name="password" autoComplete="new-password" required /></Field>
      <Field label="Rol *"><Select name="role" defaultValue="SALES">{roles.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
      <Button disabled={pending}><UserPlus size={16} /> Qo'shish</Button>
      <div className="sm:col-span-5"><FormError error={state?.error} /></div>
    </form>
  );
}

export function ResetPasswordForm({ userId }: { userId: string }) {
  const [state, action, pending] = useActionState(resetPassword.bind(null, userId), undefined);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => { if (state?.ok) ref.current?.reset(); }, [state]);
  return (
    <form ref={ref} action={action} className="flex items-center gap-1">
      <PasswordInput name="password" aria-label="Yangi parol" placeholder="Yangi parol" className="w-36 px-2 py-1 text-xs" autoComplete="new-password" />
      <Button variant="secondary" className="px-2 py-1 text-xs" disabled={pending} aria-label="Parolni almashtirish" title="Parolni almashtirish">{state?.ok ? <Check size={14} /> : <KeyRound size={14} />}</Button>
      {state?.error && <span className="text-xs text-red-600">{state.error}</span>}
    </form>
  );
}

/** Mavjud foydalanuvchi: ism va rol (audit bilan). DIRECTOR rolini faqat direktor beradi — sahifa faqat unga ochiq. */
export function UserEditForm({ userId, fullName, role, roles, self }: { userId: string; fullName: string; role: string; roles: [string, string][]; self: boolean }) {
  const [state, action, pending] = useActionState(updateUser.bind(null, userId), undefined);
  return (
    <form action={action} className="flex min-w-[260px] flex-wrap items-center gap-1">
      <Input name="fullName" defaultValue={fullName} className="w-40 px-2 py-1 text-xs" aria-label="F.I.O." required />
      <Select name="role" defaultValue={role} className="w-36 px-2 py-1 text-xs" aria-label="Rol" disabled={self}>
        {/* Ilgari berilgan, hozir formada yo'q rol (haydovchi, brigadir) ham ko'rinib tursin */}
        {!roles.some(([k]) => k === role) && <option value={role}>{role}</option>}
        {roles.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
      </Select>
      {self && <input type="hidden" name="role" value={role} />}
      <Button variant="secondary" className="px-2 py-1 text-xs" disabled={pending} title="Saqlash">{state?.ok ? <Check size={14} /> : <Save size={14} />}</Button>
      {state?.error && <span className="basis-full text-xs text-red-600">{state.error}</span>}
    </form>
  );
}

/** Bloklash / yoqish — bloklashda tasdiq so'raladi (ochiq sessiyalar darhol tugaydi). */
export function ToggleUserButton({ userId, name, active }: { userId: string; name: string; active: boolean }) {
  return (
    <form
      action={toggleUser.bind(null, userId)}
      onSubmit={(e) => { if (active && !confirm(`${name} bloklansinmi? U tizimdan darhol chiqariladi (veb va mobil ilova).`)) e.preventDefault(); }}
    >
      <Button variant="secondary" className="px-2 py-1 text-xs">{active ? "Bloklash" : "Yoqish"}</Button>
    </form>
  );
}

/** "Katta xarid" chegarasi (`supplyDirectorLimit`) — Sozlamalar → Limitlar. */
export function SupplyLimitForm({ value }: { value: number }) {
  const [state, action, pending] = useActionState(saveSupplyDirectorLimit, undefined);
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <Field label="Katta xarid chegarasi, so'm"><MoneyInput name="supplyDirectorLimit" defaultValue={String(value)} suffix={null} className="w-48 py-2 text-sm" /></Field>
      <Button disabled={pending}>{state?.ok ? <Check size={16} /> : <Save size={16} />} Saqlash</Button>
      <FormError error={state?.error} />
    </form>
  );
}

/** "To'lanmagan kirimlar" boshlanish sanasi — undan oldingi kirimlar to'lov kutmaydi. */
export function PayablesSinceForm({ value }: { value: string }) {
  const [state, action, pending] = useActionState(savePayablesSince, undefined);
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <Field label="Shu sanadan boshlab"><Input name="payablesSince" type="date" defaultValue={value} required className="w-44" /></Field>
      <Button disabled={pending}>{state?.ok ? <Check size={16} /> : <Save size={16} />} Saqlash</Button>
      <FormError error={state?.error} />
    </form>
  );
}

/** Korxona QQS to'lovchisimi — yangi kirimlarning sklad tannarxi QQS'siz (to'lovchi) yoki QQS bilan. */
export function VatPayerForm({ value }: { value: boolean }) {
  const [state, action, pending] = useActionState(saveVatPayer, undefined);
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <Field label="Korxona">
        <Select name="vatPayer" defaultValue={value ? "1" : "0"} className="w-72">
          <option value="1">QQS to&apos;lovchisi (kirim QQS&apos;i qaytariladi)</option>
          <option value="0">QQS to&apos;lovchisi emas (QQS tannarxga kiradi)</option>
        </Select>
      </Field>
      <Button disabled={pending}>{state?.ok ? <Check size={16} /> : <Save size={16} />} Saqlash</Button>
      <FormError error={state?.error} />
    </form>
  );
}

/**
 * Ishlab chiqarish Telegram kanali. Maydon boshqariladigan: server action tugagach forma tozalanganda kiritilgan
 * manzil o'chib ketmasin. Ikki tugma bitta action'ga `intent` bilan boradi — «Tekshirish» saqlamaydi.
 */
export function ProductionChannelForm({ value }: { value: string | null }) {
  const [state, action, pending] = useActionState(saveProductionChannel, undefined);
  const [chat, setChat] = useState(value ?? "");
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <Field label="Kanal manzili" hint="@kanal_nomi yoki -100… raqami; bo'sh — o'chiq">
        <Input name="productionTgChat" value={chat} onChange={(e) => setChat(e.target.value)} placeholder="@insof_ishlab_chiqarish" autoComplete="off" className="w-72" />
      </Field>
      <div className="flex flex-wrap items-center gap-2 pb-5">
        <Button type="submit" name="intent" value="check" variant="secondary" disabled={pending || !chat.trim()}><ShieldCheck size={16} /> Tekshirish</Button>
        <Button type="submit" name="intent" value="save" disabled={pending}>{state?.ok ? <Check size={16} /> : <Save size={16} />} Saqlash</Button>
        {state?.note && <FormSuccess text={state.note} />}
      </div>
      <div className="basis-full"><FormError error={state?.error} /></div>
    </form>
  );
}

export type { PermModule };

/**
 * Bo'lim → tugma → amal bo'yicha ruxsat — faqat direktor (`PermsTree`): masalan Ishlab chiqarish xodimiga
 * Sklad → «Kirim» oynasini va undagi «Kirim qabul qilish»ni berish, «Chiqim» oynasini esa yopiq qoldirish.
 */
export function UserPermsForm({
  userId, modules, current,
}: { userId: string; modules: PermModule[]; current: Record<string, string | string[]> }) {
  const [state, action, pending] = useActionState(saveUserPerms.bind(null, userId), undefined);
  const [dirty, setDirty] = useState(false);
  useEffect(() => { if (state?.ok) setDirty(false); }, [state]);

  return (
    <form action={action}>
      <PermsTree
        modules={modules}
        current={current}
        onChange={() => setDirty(true)}
        footer={(reset) => (
          <div className="sticky bottom-0 flex flex-wrap items-center gap-2 border-t border-slate-100 bg-white/95 py-2 backdrop-blur">
            <Button className="px-3 py-1.5 text-sm" disabled={pending}>{state?.ok && !dirty ? <Check size={14} /> : <Save size={14} />} Saqlash</Button>
            <Button type="button" variant="secondary" className="px-3 py-1.5 text-sm" onClick={reset}>
              <RotateCcw size={14} /> Hammasini rol bo&apos;yicha
            </Button>
            {dirty && <span className="text-xs text-amber-600">Saqlanmagan o&apos;zgarish bor</span>}
            {state?.ok && !dirty && <span className="text-xs text-emerald-600">Saqlandi — xodim keyingi sahifa ochishida kuchga kiradi</span>}
            {state?.error && <span className="text-xs text-red-600">{state.error}</span>}
          </div>
        )}
      />
    </form>
  );
}

/** Boshqa xodimning ruxsatlarini nusxalash. */
export function CopyPermsForm({ userId, others }: { userId: string; others: { id: string; label: string }[] }) {
  const [state, action, pending] = useActionState(copyUserPerms.bind(null, userId), undefined);
  if (others.length === 0) return null;
  return (
    <form action={action} className="flex flex-wrap items-center gap-1.5">
      <Select name="sourceId" defaultValue="" className="w-56 px-2 py-1 text-xs" aria-label="Kimdan nusxa">
        <option value="" disabled>Ruxsatni kimdan nusxalash…</option>
        {others.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
      </Select>
      <Button variant="secondary" className="px-2 py-1 text-xs" disabled={pending}><Copy size={14} /> Nusxalash</Button>
      {state?.ok && <span className="text-xs text-emerald-600">Ko&apos;chirildi</span>}
      {state?.error && <span className="text-xs text-red-600">{state.error}</span>}
    </form>
  );
}

/* ───────── Bir nechta xodimga birdan ───────── */

export type PermTemplateOpt = { id: string; name: string; roleLabel: string | null; summary: string };

const pickedBoxes = () => [...document.querySelectorAll<HTMLInputElement>(`input[form="${BULK_FORM_ID}"][name="ids"]`)];

/**
 * Belgilangan xodimlarga birdan: shablonni qo'llash (lavozim shabloni yoki «rol bo'yicha») yoki bitta ruxsatlar
 * matritsasini berish. Qo'llashdan oldin sahifaning o'zida tasdiq so'raladi. Direktor hisobiga tegilmaydi (server).
 */
export function BulkPermsBar({ templates, modules, total }: { templates: PermTemplateOpt[]; modules: PermModule[]; total: number }) {
  const [tplState, tplAction, tplPending] = useActionState(applyPermTemplate, undefined);
  const [permState, permAction, permPending] = useActionState(bulkSaveUserPerms, undefined);
  const [mode, setMode] = useState<"template" | "perms">("template");
  const [count, setCount] = useState(0);
  const [template, setTemplate] = useState("");
  const [withRole, setWithRole] = useState(false);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    const recount = () => setCount(pickedBoxes().filter((b) => b.checked).length);
    recount();
    document.addEventListener("change", recount);
    return () => document.removeEventListener("change", recount);
  }, []);
  useEffect(() => { if (tplState?.ok || permState?.ok) setConfirming(false); }, [tplState, permState]);

  const markAll = (on: boolean) => { for (const b of pickedBoxes()) b.checked = on; setCount(on ? pickedBoxes().length : 0); setConfirming(false); };
  const tpl = templates.find((t) => t.id === template);
  const state = mode === "template" ? tplState : permState;
  const pending = tplPending || permPending;
  const what = mode === "perms" ? "tanlangan ruxsatlar" : template === "role" ? "«rol bo'yicha» holat (qo'shimcha ruxsatlar olib tashlanadi)" : tpl ? `«${tpl.name}» shabloni` : "";
  const ready = count > 0 && (mode === "perms" || !!template);

  return (
    <form id={BULK_FORM_ID} action={mode === "template" ? tplAction : permAction} className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">Belgilangan: <span className="tabular">{count}</span> / {total}</span>
        <Button type="button" variant="secondary" size="sm" onClick={() => markAll(true)}>Hammasini belgilash</Button>
        {count > 0 && <Button type="button" variant="ghost" size="sm" onClick={() => markAll(false)}>Belgilarni olib tashlash</Button>}
        <div role="radiogroup" aria-label="Amal" className="ml-auto flex gap-1">
          {([["template", "Shablonni qo'llash"], ["perms", "Ruxsatlarni tahrirlash"]] as const).map(([k, l]) => (
            <button key={k} type="button" role="radio" aria-checked={mode === k} onClick={() => { setMode(k); setConfirming(false); }}
              className={`rounded-md border px-2.5 py-1 text-xs ${mode === k ? "border-slate-900 bg-slate-900 font-semibold text-white" : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"}`}>
              {l}
            </button>
          ))}
        </div>
      </div>

      {mode === "template" && (
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Shablon" className="min-w-64">
            <Select name="template" value={template} onChange={(e) => { setTemplate(e.target.value); setWithRole(false); setConfirming(false); }}>
              <option value="" disabled>Shablonni tanlang…</option>
              <option value="role">Rol bo&apos;yicha (qo&apos;shimcha ruxsatlarsiz)</option>
              {templates.map((t) => <option key={t.id} value={t.id}>{t.name}{t.roleLabel ? ` · ${t.roleLabel}` : ""}</option>)}
            </Select>
          </Field>
          {tpl?.roleLabel && (
            <label className="flex h-10 items-center gap-2 text-sm">
              <input type="checkbox" name="withRole" checked={withRole} onChange={(e) => { setWithRole(e.target.checked); setConfirming(false); }} className="h-4 w-4 accent-slate-900" />
              Asosiy bo&apos;limni ham «{tpl.roleLabel}» qilish
            </label>
          )}
          {tpl && <p className="basis-full text-xs text-slate-500">{tpl.summary}</p>}
          {templates.length === 0 && <p className="basis-full text-xs text-slate-500">Lavozim shablonlari hali yo&apos;q — ularni <Link href="/otdel-kadr?tab=lavozimlar" className="font-medium text-slate-700 underline-offset-2 hover:underline">Lavozimlar va login shablonlari</Link> sahifasida «Login shabloni» orqali yarating.</p>}
        </div>
      )}

      {mode === "perms" && (
        <div className="space-y-2">
          <p className="text-xs text-slate-500">Belgilangan har bir xodimning hozirgi qo&apos;shimcha ruxsatlari shu tanlov bilan almashtiriladi. «Rol bo&apos;yicha» — har kim o&apos;z roli bo&apos;yicha.</p>
          <PermsTree modules={modules} current={{}} onChange={() => setConfirming(false)}
            footer={(reset) => <Button type="button" variant="secondary" size="sm" onClick={reset}><RotateCcw size={14} /> Hammasini rol bo&apos;yicha</Button>} />
        </div>
      )}

      {!confirming ? (
        <Button type="button" disabled={!ready || pending} onClick={() => setConfirming(true)}>
          <Check size={15} /> {mode === "template" ? "Shablonni qo'llash" : "Ruxsatlarni qo'llash"}
        </Button>
      ) : (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <span>
            <b>{count} ta xodimga</b> {what} qo&apos;llanadi.
            {mode === "template" && withRole && tpl?.roleLabel && " Asosiy bo'limi o'zgargan xodimlar tizimdan chiqariladi va qayta kiradi."}
            {" "}Direktor hisobi o&apos;zgarmaydi.
          </span>
          <Button size="sm" disabled={pending}><Check size={14} /> {pending ? "Qo'llanmoqda…" : "Tasdiqlash"}</Button>
          <Button size="sm" type="button" variant="ghost" onClick={() => setConfirming(false)}>Bekor qilish</Button>
        </div>
      )}
      <FormError error={state?.error} />
      <FormSuccess text={state?.ok ? state.note : undefined} />
    </form>
  );
}
