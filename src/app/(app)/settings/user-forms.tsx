"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Check, Copy, KeyRound, RotateCcw, Save, UserPlus } from "lucide-react";
import { createUser, resetPassword, saveSupplyDirectorLimit, saveDailyOrderLimits, savePayablesSince, saveVatPayer, saveUserPerms, copyUserPerms, toggleUser, updateUser } from "./actions";
import { MoneyInput } from "@/components/money-input";
import { Button, Field, FormError, Input, PasswordInput, Select } from "@/components/ui";

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

/** "Katta xarid" chegarasi — Byudjet sahifasidagi chegaralar bilan bitta maydon (`supplyDirectorLimit`). */
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

/** Kunlik zayavka limiti —bir yetkazish kuniga qabul qilinadigan hajm (m³) va soni. 0/bo'sh — cheklov yo'q. */
export function DailyOrderLimitForm({ m3, count }: { m3: number; count: number }) {
  const [state, action, pending] = useActionState(saveDailyOrderLimits, undefined);
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <Field label="Kunlik hajm chegarasi, m³"><Input name="dailyOrderMaxM3" type="number" min={0} step="1" defaultValue={m3 || ""} placeholder="cheklov yo'q" className="w-44" /></Field>
      <Field label="Kunlik zayavka soni"><Input name="dailyOrderMaxCount" type="number" min={0} step="1" defaultValue={count || ""} placeholder="cheklov yo'q" className="w-44" /></Field>
      <Button disabled={pending}>{state?.ok ? <Check size={16} /> : <Save size={16} />} Saqlash</Button>
      <FormError error={state?.error} />
    </form>
  );
}

export type PermModule = {
  key: string;
  label: string;
  group: string;
  actions: { key: string; label: string; hint?: string }[];
  /** Rol bo'yicha (direktor bermagan holatda): ko'radimi va qaysi amallarni bajaradi */
  role: { view: boolean; actions: string[] };
};

type Level = "" | "none" | "view" | "custom" | "write";

const LEVELS: { v: Level; label: string; tone: string }[] = [
  { v: "", label: "Rol bo'yicha", tone: "border-slate-200 bg-white text-slate-600" },
  { v: "none", label: "Yopiq", tone: "border-red-300 bg-red-50 text-red-700" },
  { v: "view", label: "Ko'rish", tone: "border-sky-300 bg-sky-50 text-sky-700" },
  { v: "custom", label: "Tanlangan amallar", tone: "border-amber-300 bg-amber-50 text-amber-800" },
  { v: "write", label: "To'liq", tone: "border-emerald-300 bg-emerald-50 text-emerald-700" },
];

function initialLevel(v: string | string[] | undefined): Level {
  if (Array.isArray(v)) return "custom";
  return v === "none" || v === "view" || v === "write" ? v : "";
}

/**
 * Modul va amal bo'yicha ruxsat — faqat direktor. Har bir bo'lim uchun daraja:
 * Rol bo'yicha / Yopiq / Ko'rish / Tanlangan amallar / To'liq. "Tanlangan amallar"da
 * aniq amallar belgilanadi (masalan Ishlab chiqarish xodimiga Zayavkalardan faqat "ochish").
 */
export function UserPermsForm({
  userId, modules, current,
}: { userId: string; modules: PermModule[]; current: Record<string, string | string[]> }) {
  const [state, action, pending] = useActionState(saveUserPerms.bind(null, userId), undefined);
  const [levels, setLevels] = useState<Record<string, Level>>(() => Object.fromEntries(modules.map((m) => [m.key, initialLevel(current[m.key])])));
  // "Tanlangan amallar"ga o'tganda boshlang'ich belgilar: saqlangan ro'yxat, bo'lmasa rolning odatiy amallari
  const [acts, setActs] = useState<Record<string, string[]>>(() =>
    Object.fromEntries(modules.map((m) => [m.key, Array.isArray(current[m.key]) ? (current[m.key] as string[]) : m.role.actions])));
  const [dirty, setDirty] = useState(false);
  useEffect(() => { if (state?.ok) setDirty(false); }, [state]);

  const setLevel = (k: string, v: Level) => { setLevels((p) => ({ ...p, [k]: v })); setDirty(true); };
  const toggleAct = (k: string, a: string) => {
    setActs((p) => ({ ...p, [k]: p[k].includes(a) ? p[k].filter((x) => x !== a) : [...p[k], a] }));
    setDirty(true);
  };
  const groups = [...new Set(modules.map((m) => m.group))];

  return (
    <form action={action} className="space-y-4">
      {groups.map((g) => (
        <div key={g}>
          <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">{g}</div>
          <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
            {modules.filter((m) => m.group === g).map((m) => {
              const lvl = levels[m.key];
              return (
                <div key={m.key} className="px-3 py-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-sm font-medium">{m.label}</div>
                      <div className="text-xs text-slate-500">
                        Rol bo&apos;yicha: {!m.role.view ? "kirmaydi" : m.role.actions.length === 0 ? "faqat ko'radi" : m.role.actions.length === m.actions.length && m.actions.length > 0 ? "barcha amallar" : `${m.role.actions.length} ta amal`}
                      </div>
                    </div>
                    <input type="hidden" name={`perm.${m.key}`} value={lvl} />
                    <div role="radiogroup" aria-label={m.label} className="flex flex-wrap gap-1">
                      {LEVELS.filter((l) => l.v !== "custom" || m.actions.length > 0).map((l) => (
                        <button
                          key={l.v}
                          type="button"
                          role="radio"
                          aria-checked={lvl === l.v}
                          onClick={() => setLevel(m.key, l.v)}
                          className={`rounded-md border px-2 py-1 text-xs transition ${lvl === l.v ? l.tone + " font-semibold" : "border-slate-200 bg-white text-slate-500 hover:border-slate-300"}`}
                        >
                          {l.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  {lvl === "custom" && (
                    <div className="mt-2 grid gap-1.5 rounded-md bg-amber-50/60 p-2 sm:grid-cols-2">
                      <div className="text-xs text-slate-500 sm:col-span-2">Bo&apos;limni ko&apos;radi va faqat belgilangan amallarni bajaradi:</div>
                      {m.actions.map((a) => (
                        <label key={a.key} className="flex cursor-pointer items-start gap-2 text-sm">
                          <input type="checkbox" name={`act.${m.key}`} value={a.key} checked={acts[m.key].includes(a.key)} onChange={() => toggleAct(m.key, a.key)} className="mt-0.5 h-4 w-4 shrink-0 accent-slate-900" />
                          <span>
                            {a.label}
                            {m.role.actions.includes(a.key) && <span className="ml-1 text-xs text-slate-400">(rolda bor)</span>}
                            {a.hint && <span className="block text-xs text-slate-500">{a.hint}</span>}
                          </span>
                        </label>
                      ))}
                    </div>
                  )}
                  {lvl === "write" && m.actions.length > 0 && (
                    <div className="mt-1.5 text-xs text-emerald-700">Barcha amallar: {m.actions.map((a) => a.label).join(", ")}</div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
      <div className="sticky bottom-0 flex flex-wrap items-center gap-2 border-t border-slate-100 bg-white/95 py-2 backdrop-blur">
        <Button className="px-3 py-1.5 text-sm" disabled={pending}>{state?.ok && !dirty ? <Check size={14} /> : <Save size={14} />} Saqlash</Button>
        <Button
          type="button"
          variant="secondary"
          className="px-3 py-1.5 text-sm"
          onClick={() => { setLevels(Object.fromEntries(modules.map((m) => [m.key, "" as Level]))); setDirty(true); }}
        >
          <RotateCcw size={14} /> Hammasini rol bo&apos;yicha
        </Button>
        {dirty && <span className="text-xs text-amber-600">Saqlanmagan o&apos;zgarish bor</span>}
        {state?.ok && !dirty && <span className="text-xs text-emerald-600">Saqlandi — xodim keyingi sahifa ochishida kuchga kiradi</span>}
        {state?.error && <span className="text-xs text-red-600">{state.error}</span>}
      </div>
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
