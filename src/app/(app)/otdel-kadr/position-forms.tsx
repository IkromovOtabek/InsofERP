"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { Check, KeyRound, Plus, Trash2, Wand2 } from "lucide-react";
import { deleteWorkPosition, savePositionTemplate, saveWorkPosition, syncEmployeePositions, toggleWorkPosition } from "./actions";
import { PermsMatrix } from "../settings/user-forms";
import { permModules } from "@/lib/perm-modules";
import type { Role } from "@/generated/prisma";
import { Button, Checkbox, Field, FormError, FormSuccess, Input, Select } from "@/components/ui";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ActionState } from "@/lib/action";
import { ASSIGNABLE_DEPTS, deptByRole, guessDepartment } from "@/lib/orgchart";

type Pos = {
  id: string; name: string; note: string | null; department: string | null; isDriver: boolean; sortOrder: number; isActive: boolean;
  /** Login shabloni: asosiy bo'lim (null — tizimga kirmaydi) va modul ruxsatlari. */
  loginRole: string | null; perms: Record<string, string | string[]>;
};
export type RoleOpt = { value: string; label: string };

/**
 * Bo'lim tanlovi — tuzilma diagrammasida lavozim shu bo'lim tagiga osiladi.
 * Tanlanmagan bo'lsa kod nomga qarab taxmin qiladi; taxmin nomi bo'sh tanlovda ko'rinadi.
 */
function DeptSelect({ value, posName, className }: { value?: string | null; posName?: string; className?: string }) {
  const guessed = posName ? guessDepartment(posName) : null;
  const guess = guessed ? deptByRole(guessed) : null;
  return (
    <Select name="department" aria-label="Bo'lim" defaultValue={value ?? ""} className={className}>
      <option value="">{guess ? `Avtomatik · ${guess.label}` : "Bo'lim tanlanmagan"}</option>
      {ASSIGNABLE_DEPTS.map((d) => <option key={d.role} value={d.role}>{d.label}</option>)}
    </Select>
  );
}


/**
 * «Lavozimlarni tartibga solish» — Excel importdan keyin xodimlarda qolgan yozuvlarni
 * ro'yxat bilan moslaydi: bir xil ishning turli yozilishi bitta nomga keltiriladi,
 * ro'yxatda yo'q lavozim ro'yxatga olinadi. Shundan keyin lavozim hamma joyda bir xil ko'rinadi.
 */
export function SyncPositionsButton({ strays }: { strays: string[] }) {
  const router = useRouter();
  const [state, setState] = useState<ActionState>(undefined);
  const [pending, start] = useTransition();
  const run = () => start(async () => {
    const res = await syncEmployeePositions();
    setState(res);
    if (res?.ok) router.refresh();
  });
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="secondary" onClick={run} disabled={pending}>
          <Wand2 size={15} /> {pending ? "Tartibga solinmoqda…" : "Lavozimlarni tartibga solish"}
        </Button>
        {strays.length > 0 && (
          <span className="text-xs text-amber-700">
            Ro&apos;yxatda yo&apos;q {strays.length} ta lavozim xodimlarda yozilgan: {strays.slice(0, 5).join(", ")}{strays.length > 5 ? "…" : ""}
          </span>
        )}
      </div>
      <FormError error={state?.error} />
      <FormSuccess text={state?.ok ? state.note : undefined} />
    </div>
  );
}

/** Yangi ishchi lavozim qo'shish. */
export function NewPositionForm({ nextOrder }: { nextOrder: number }) {
  const [state, action, pending] = useActionState(saveWorkPosition.bind(null, null), undefined);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => { if (state?.ok) ref.current?.reset(); }, [state]);
  return (
    <form ref={ref} action={action} className="space-y-3">
      <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-2 xl:grid-cols-[1fr_1.2fr_170px_100px_150px_auto]">
        <Field label="Lavozim nomi *"><Input name="name" required autoComplete="off" placeholder="Masalan: Payvandchi" /></Field>
        <Field label="Izoh"><Input name="note" autoComplete="off" placeholder="Vazifasi yoki talab" /></Field>
        <Field label="Bo'lim" hint="Tuzilmadagi o'rni"><DeptSelect /></Field>
        <Field label="Tartib"><Input name="sortOrder" type="number" defaultValue={nextOrder} /></Field>
        <div className="pb-2"><Checkbox name="isDriver" label="Haydovchi ilovasiga chiqsin" /></div>
        <Button disabled={pending}><Plus size={16} /> Qo&apos;shish</Button>
      </div>
      <FormError error={state?.error} />
    </form>
  );
}

/** Mavjud lavozim qatori — joyida tahrirlanadi. Direktor ostida «Login shabloni» paneli ochiladi. */
export function PositionRow({ p, used, logins, roles, canTemplate }: { p: Pos; used: number; logins: number; roles: RoleOpt[]; canTemplate: boolean }) {
  const [state, action, pending] = useActionState(saveWorkPosition.bind(null, p.id), undefined);
  const [dirty, setDirty] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => { if (state?.ok) setDirty(false); }, [state]);
  const roleLabel = p.loginRole ? roles.find((r) => r.value === p.loginRole)?.label ?? p.loginRole : null;
  return (
    <div className="border-b border-slate-100 last:border-0">
      <form action={action} onChange={() => setDirty(true)} className="grid grid-cols-1 items-center gap-2 px-3 py-2 sm:grid-cols-2 xl:grid-cols-[1fr_1.1fr_160px_72px_150px_66px_auto]">
        <Input name="name" aria-label="Lavozim nomi" defaultValue={p.name} required className="py-2 text-sm" autoComplete="off" />
        <Input name="note" aria-label="Izoh" defaultValue={p.note ?? ""} className="py-2 text-sm" placeholder="izoh" autoComplete="off" />
        <DeptSelect value={p.department} posName={p.name} className="py-2 text-sm" />
        <Input name="sortOrder" aria-label="Tartib raqami" type="number" defaultValue={p.sortOrder} className="py-2 text-sm" />
        <Checkbox name="isDriver" defaultChecked={p.isDriver} label="Haydovchi ilovasi" />
        <span className="text-xs text-slate-500 tabular">{used} xodim</span>
        <div className="flex flex-wrap items-center gap-1.5">
          {dirty && <Button size="sm" variant="secondary" disabled={pending}><Check size={14} /> Saqlash</Button>}
          {canTemplate && (
            <Button size="sm" variant={open ? "secondary" : "ghost"} type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} title="Login shabloni: asosiy bo'lim va ruxsatlar">
              <KeyRound size={14} /> Login shabloni
            </Button>
          )}
          <Button size="sm" variant="ghost" type="button" disabled={pending} onClick={() => toggleWorkPosition(p.id)}>{p.isActive ? "Yashirish" : "Qaytarish"}</Button>
          {used === 0 && (
            <Button size="sm" variant="ghost" type="button" className="text-red-600" disabled={pending} onClick={() => deleteWorkPosition(p.id)} title="O'chirish">
              <Trash2 size={14} />
            </Button>
          )}
        </div>
        {roleLabel && (
          <div className="text-xs text-sky-800 sm:col-span-full">
            <KeyRound size={12} className="mr-1 inline" />
            Tizimga kiradi (ERP va ECO): asosiy bo&apos;lim «{roleLabel}»{Object.keys(p.perms).length ? `, ${Object.keys(p.perms).length} ta bo'lim bo'yicha qo'shimcha ruxsat` : ", ruxsatlar rol bo'yicha"} · {logins} ta login
          </div>
        )}
        {state?.error && <div className="sm:col-span-full"><FormError error={state.error} /></div>}
      </form>
      {canTemplate && open && <PositionTemplateForm p={p} roles={roles} logins={logins} />}
    </div>
  );
}

/**
 * Lavozim login shabloni (faqat direktor): «Tizimga kiradi» + asosiy bo'lim + ruxsatlar matritsasi.
 * Saqlanganda shu lavozimdagi login egalariga qo'llanadi (server natijani aytadi).
 */
function PositionTemplateForm({ p, roles, logins }: { p: Pos; roles: RoleOpt[]; logins: number }) {
  const [state, action, pending] = useActionState(savePositionTemplate.bind(null, p.id), undefined);
  const [enabled, setEnabled] = useState(!!p.loginRole);
  const [role, setRole] = useState(p.loginRole ?? "");
  const modules = useMemo(() => permModules((role || null) as Role | null), [role]);
  return (
    <form action={action} className="space-y-3 border-t border-dashed border-slate-200 bg-slate-50/60 px-3 py-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="pb-2"><Checkbox name="login" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} label="Tizimga kiradi (ERP va ECO login)" /></div>
        {enabled && (
          <Field label="Asosiy bo'lim" hint="Login shu bo'lim huquqi bilan ochiladi">
            <Select name="loginRole" value={role} onChange={(e) => setRole(e.target.value)} required className="w-56">
              <option value="" disabled>Tanlang…</option>
              {roles.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </Select>
          </Field>
        )}
      </div>
      {enabled ? (
        <PermsMatrix modules={modules} current={p.perms} />
      ) : (
        <p className="text-xs text-slate-500">Belgilanmasa — lavozim o&apos;zi tizimga kirmaydi (login kerak bo&apos;lsa kadr bo&apos;limni qo&apos;lda tanlaydi).</p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={pending}><Check size={14} /> {pending ? "Saqlanmoqda…" : "Shablonni saqlash"}</Button>
        <span className="text-xs text-slate-500">
          Saqlanganda shu lavozimdagi {logins} ta login egasiga qo&apos;llanadi; asosiy bo&apos;limi o&apos;zgarganlar tizimga qayta kiradi. Direktor hisobi o&apos;zgarmaydi.
        </span>
      </div>
      <FormError error={state?.error} />
      <FormSuccess text={state?.ok ? state.note : undefined} />
    </form>
  );
}
