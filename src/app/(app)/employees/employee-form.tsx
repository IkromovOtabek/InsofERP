"use client";

import { Plus, Truck } from "lucide-react";

import { useActionState, useEffect, useRef, useState } from "react";
import { createEmployee, grantLogin, updateEmployee } from "./actions";
import { Button, Field, FormError, FormSuccess, Input, PasswordInput, Select, Textarea } from "@/components/ui";
import { EDUCATION, LICENSE_CATEGORIES, MARITAL, VEHICLE_TYPES } from "@/lib/kadr";

export type Pos = { label: string; role: string | null };

/** Bo'limlar (login beradi) + otdel kadr yuritadigan ishchi lavozimlar (`work` bo'sh bo'lsa faqat bo'limlar). */
export function PositionSelect({ departments, work, workLabel = "Ishchi lavozimlar", value, onChange }: {
  departments: Pos[]; work: string[]; workLabel?: string | null; value: string; onChange: (v: string) => void;
}) {
  const opt = (v: string) => <option key={v} value={v}>{v}</option>;
  const workOptions = work.map((w) => opt(w));
  return (
    <Select name="position" value={value} onChange={(e) => onChange(e.target.value)} required>
      {/* workLabel null — hamma lavozim bitta ro'yxatda, bir xil qatorda turadi */}
      {workLabel === null
        ? [...departments.map((p) => opt(p.label)), ...workOptions]
        : <>
            <optgroup label="Bo'limlar (tizimga kiradi)">{departments.map((p) => opt(p.label))}</optgroup>
            {work.length > 0 && <optgroup label={workLabel}>{workOptions}</optgroup>}
          </>}
    </Select>
  );
}

/** Texnika ro'yxati — raqam yozilganda turi va sig'imi o'zi to'ladi. */
export type VehicleOpt = { plate: string; type: string; capacityM3: string | null };

/**
 * Haydovchi tanlanganda ochiladigan qo'shimcha maydonlar: texnikasi va guvohnomasi.
 * Davlat raqami bazadagi texnika bilan moslanadi — yangi raqam yozilsa texnika ham ochiladi.
 */
export function DriverFields({ vehicles, defaults }: {
  vehicles: VehicleOpt[];
  defaults?: { plate: string; vehicleType: string; capacityM3: string; licenseNo: string; licenseCategory: string; licenseExpiry: string };
}) {
  const [plate, setPlate] = useState(defaults?.plate ?? "");
  const [type, setType] = useState(defaults?.vehicleType ?? "MIXER");
  const [cap, setCap] = useState(defaults?.capacityM3 ?? "");
  const known = vehicles.find((v) => v.plate.toUpperCase().replace(/\s+/g, "") === plate.toUpperCase().replace(/\s+/g, ""));

  // Bazadagi texnika tanlansa — turi va sig'imi o'zi to'ladi, qo'lda tuzatish kerak bo'lmaydi
  const onPlate = (v: string) => {
    setPlate(v);
    const m = vehicles.find((x) => x.plate.toUpperCase().replace(/\s+/g, "") === v.toUpperCase().replace(/\s+/g, ""));
    if (m) { setType(m.type); setCap(m.capacityM3 ?? ""); }
  };

  return (
    <div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50/60 p-3">
      <div className="flex items-center gap-2 text-[13px] font-medium text-amber-900"><Truck size={15} /> Haydovchi ma&apos;lumotlari</div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Davlat raqami" hint={known ? "Bazadagi texnika biriktiriladi" : plate ? "Yangi texnika ochiladi" : "Mikser/nasos raqami"}>
          <Input name="plate" value={plate} onChange={(e) => onPlate(e.target.value)} list="driver-plates" placeholder="01 A 123 BC" autoComplete="off" />
          <datalist id="driver-plates">{vehicles.map((v) => <option key={v.plate} value={v.plate} />)}</datalist>
        </Field>
        <Field label="Turi">
          <Select name="vehicleType" value={type} onChange={(e) => setType(e.target.value)}>
            {VEHICLE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </Select>
        </Field>
        <Field label="Sig'imi, m³" hint="Reysda shu hajmdan oshirib bo'lmaydi">
          <Input name="capacityM3" type="number" step="0.5" min="0" value={cap} onChange={(e) => setCap(e.target.value)} placeholder="7" />
        </Field>
        <Field label="Guvohnoma raqami"><Input name="licenseNo" defaultValue={defaults?.licenseNo ?? ""} placeholder="AB 1234567" autoComplete="off" /></Field>
        <Field label="Toifasi">
          <Input name="licenseCategory" defaultValue={defaults?.licenseCategory ?? ""} list="license-cats" placeholder="B, C" autoComplete="off" />
          <datalist id="license-cats">{LICENSE_CATEGORIES.map((c) => <option key={c} value={c} />)}</datalist>
        </Field>
        <Field label="Guvohnoma muddati" hint="Muddati bitganda ro'yxatda ogohlantiriladi">
          <Input name="licenseExpiry" type="date" defaultValue={defaults?.licenseExpiry ?? ""} />
        </Field>
      </div>
    </div>
  );
}

/** Tezkor forma: bo'lim xodimi + login yoki haydovchi (texnikasi bilan). */
export function EmployeeForm({ departments, drivers, vehicles, canGrant }: {
  departments: Pos[]; drivers: string[]; vehicles: VehicleOpt[]; canGrant: boolean;
}) {
  const [state, action, pending] = useActionState(createEmployee, undefined);
  const ref = useRef<HTMLFormElement>(null);
  const [position, setPosition] = useState(departments[0]?.label ?? "");
  const needsLogin = !!departments.find((p) => p.label === position)?.role;
  const isDriver = drivers.includes(position);
  // Haydovchiga login ixtiyoriy: ECO ilovasiga telefon bilan kiradi, ERP ilovasiga esa login/parol bilan
  const showLogin = needsLogin || isDriver;
  useEffect(() => { if (state?.ok) { ref.current?.reset(); setPosition(departments[0]?.label ?? ""); } }, [state, departments]);

  return (
    <form ref={ref} action={action} className="space-y-3">
      <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-[1.4fr_200px_170px_160px_auto]">
        <Field label="F.I.O. *"><Input name="fullName" required /></Field>
        <Field label="Bo'lim lavozimi *"><PositionSelect departments={departments} work={drivers} workLabel={null} value={position} onChange={setPosition} /></Field>
        <Field label="Telefon" hint={isDriver ? "Ilovaga kirish kaliti" : undefined}><Input name="phone" placeholder="+998 90 123 45 67" /></Field>
        <Field label="Ishga kirgan sana"><Input name="hiredAt" type="date" /></Field>
        <Button disabled={pending || (needsLogin && !canGrant)}><Plus size={16} /> Qo&apos;shish</Button>
      </div>
      {isDriver && <DriverFields vehicles={vehicles} />}
      {showLogin && (
        <div className="grid grid-cols-1 gap-3 rounded-lg border border-blue-200 bg-blue-50 p-3 sm:grid-cols-[1fr_1fr_2fr]">
          <Field label={needsLogin ? "Login *" : "Login"}><Input name="login" autoComplete="off" required={needsLogin} /></Field>
          <Field label={needsLogin ? "Parol *" : "Parol"}><PasswordInput name="password" autoComplete="new-password" required={needsLogin} /></Field>
          <p className="self-end text-xs text-blue-800">
            {needsLogin
              ? "Bu lavozim egasi tizimga kirib, faqat o'z bo'limi sahifalarini ko'radi."
              : "Ixtiyoriy: haydovchi ERP ilovasiga shu login/parol bilan kiradi va faqat o'z reyslarini ko'radi. Bo'sh qoldirsangiz — ECO ilovasiga telefon raqami bilan kiraveradi."}
            {!canGrant && " Login berish uchun Otdel kadr yoki direktor kerak."}
          </p>
        </div>
      )}
      <FormError error={state?.error} />
      <FormSuccess text={state?.ok ? "Xodim qo'shildi" : undefined} />
    </form>
  );
}

export type EmployeeCard = {
  id: string; fullName: string; position: string; phone: string | null;
  tabelNo: string | null; subdivision: string | null; tariffRate: string | null;
  hiredAt: string | null; firedAt: string | null; birthDate: string | null; note: string | null;
  passportSeries: string | null; pinfl: string | null; passportIssuedBy: string | null; passportIssuedAt: string | null;
  address: string | null; education: string | null; maritalStatus: string | null;
  plate: string | null; vehicleType: string | null; capacityM3: string | null;
  licenseNo: string | null; licenseCategory: string | null; licenseExpiry: string | null;
};

/** Xodim kartasi — otdel kadr tahrirlaydi. */
export function EmployeeCardForm({ employee, departments, work, drivers, vehicles, hasLogin }: {
  employee: EmployeeCard;
  departments: Pos[];
  work: string[];
  drivers: string[];
  vehicles: VehicleOpt[];
  hasLogin: boolean;
}) {
  const [state, action, pending] = useActionState(updateEmployee.bind(null, employee.id), undefined);
  const [position, setPosition] = useState(employee.position);
  // Ro'yxatdan chiqarilgan eski lavozim ham tanlov sifatida qolsin, aks holda saqlashda almashib ketadi
  const workList = work.includes(employee.position) || departments.some((d) => d.label === employee.position) ? work : [employee.position, ...work];

  return (
    <form action={action} className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="F.I.O. *"><Input name="fullName" defaultValue={employee.fullName} required /></Field>
        <Field label="Lavozim *" hint={hasLogin ? "Login berilgan xodimning bo'limi o'zgarmaydi" : undefined}>
          <PositionSelect departments={departments} work={workList} value={position} onChange={setPosition} />
        </Field>
        <Field label="Telefon" hint="Haydovchi uchun ilovaga kirish kaliti"><Input name="phone" defaultValue={employee.phone ?? ""} /></Field>
        <Field label="Ishga kirgan sana"><Input name="hiredAt" type="date" defaultValue={employee.hiredAt ?? ""} /></Field>
        <Field label="Tug'ilgan sana"><Input name="birthDate" type="date" defaultValue={employee.birthDate ?? ""} /></Field>
        <Field label="Tabel №" hint="Buxgalteriya tabelidagi raqam"><Input name="tabelNo" defaultValue={employee.tabelNo ?? ""} placeholder="00401" autoComplete="off" /></Field>
        <Field label="Bo'lim / brigada"><Input name="subdivision" defaultValue={employee.subdivision ?? ""} placeholder="Brigada 1" autoComplete="off" /></Field>
        <Field label="Tarif stavka, so'm"><Input name="tariffRate" defaultValue={employee.tariffRate ?? ""} inputMode="numeric" placeholder="2500000" autoComplete="off" /></Field>
        <Field label="Ishdan bo'shagan sana" hint="To'ldirilsa xodim nofaol bo'ladi"><Input name="firedAt" type="date" defaultValue={employee.firedAt ?? ""} /></Field>
        <Field label="Ma'lumoti">
          <Select name="education" defaultValue={employee.education ?? ""}><option value="">—</option>{EDUCATION.map((e) => <option key={e} value={e}>{e}</option>)}</Select>
        </Field>
        <Field label="Oilaviy holati">
          <Select name="maritalStatus" defaultValue={employee.maritalStatus ?? ""}><option value="">—</option>{MARITAL.map((m) => <option key={m} value={m}>{m}</option>)}</Select>
        </Field>
        <Field label="Yashash manzili" className="sm:col-span-2"><Input name="address" defaultValue={employee.address ?? ""} /></Field>
        <Field label="Passport seriya va raqam"><Input name="passportSeries" defaultValue={employee.passportSeries ?? ""} placeholder="AA 1234567" autoComplete="off" /></Field>
        <Field label="JSHSHIR (PINFL)"><Input name="pinfl" defaultValue={employee.pinfl ?? ""} inputMode="numeric" autoComplete="off" /></Field>
        <Field label="Passportni kim bergan"><Input name="passportIssuedBy" defaultValue={employee.passportIssuedBy ?? ""} /></Field>
        <Field label="Berilgan sana"><Input name="passportIssuedAt" type="date" defaultValue={employee.passportIssuedAt ?? ""} /></Field>
        <Field label="Izoh" className="sm:col-span-3"><Textarea name="note" defaultValue={employee.note ?? ""} rows={2} placeholder="Smena, manzil, hujjat holati..." /></Field>
      </div>
      {drivers.includes(position) && (
        <DriverFields
          vehicles={vehicles}
          defaults={{
            plate: employee.plate ?? "", vehicleType: employee.vehicleType ?? "MIXER", capacityM3: employee.capacityM3 ?? "",
            licenseNo: employee.licenseNo ?? "", licenseCategory: employee.licenseCategory ?? "", licenseExpiry: employee.licenseExpiry ?? "",
          }}
        />
      )}
      <div className="flex items-center gap-3">
        <Button disabled={pending}>Saqlash</Button>
        {state?.ok && <span className="text-sm text-emerald-700">Saqlandi</span>}
      </div>
      {state?.note && <p className="text-xs text-slate-600">{state.note}</p>}
      <FormError error={state?.error} />
    </form>
  );
}

export function GrantLoginForm({ employeeId }: { employeeId: string }) {
  const [state, action, pending] = useActionState(grantLogin.bind(null, employeeId), undefined);
  return (
    <form action={action} className="flex flex-wrap items-center gap-1">
      <Input name="login" placeholder="login" className="w-28 px-2 py-1 text-xs" autoComplete="off" required />
      <PasswordInput name="password" placeholder="parol" className="w-28 px-2 py-1 text-xs" autoComplete="new-password" required />
      <Button variant="secondary" className="px-2 py-1 text-xs" disabled={pending}>Login berish</Button>
      {state?.error && <span className="w-full text-xs text-red-600">{state.error}</span>}
      {state?.note && <span className="w-full text-xs text-slate-600">{state.note}</span>}
    </form>
  );
}
