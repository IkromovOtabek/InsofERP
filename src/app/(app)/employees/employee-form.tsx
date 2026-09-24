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
  // Tanlangan lavozim ro'yxatda bo'lmasa ham tanlov sifatida qoladi (saqlashda almashib ketmasin)
  const list = value && !work.includes(value) && !departments.some((d) => d.label === value) ? [value, ...work] : work;
  const workOptions = list.map((w) => opt(w));
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

/** Ro'yxatda turgan faol xodim — lavozim tanlanganda F.I.O. maydonida taklif bo'lib chiqadi. */
export type StaffOpt = { id: string; fullName: string; position: string; phone: string | null; hasLogin: boolean; isActive: boolean };

/**
 * F.I.O. maydoni: tanlangan lavozimdagi **faol** xodimlar ro'yxat bo'lib chiqadi
 * (Otdel kadrda ochilgan yoki Excel'dan kelgan xodimlar shu yerda ko'rinadi).
 * Ro'yxatdan tanlansa yangi karta ochilmaydi — o'sha xodimga login beriladi;
 * yozib kiritilsa yangi xodim bo'lib qo'shiladi.
 */
function FioField({ staff, position, value, onChange, picked, onPick }: {
  staff: StaffOpt[];
  position: string;
  value: string;
  onChange: (v: string) => void;
  picked: StaffOpt | null;
  onPick: (s: StaffOpt | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!boxRef.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  });

  const term = value.trim().toLowerCase();
  // Avval shu lavozimdagilar, keyin qolganlari; logini bor xodim taklif qilinmaydi
  const free = staff.filter((x) => !x.hasLogin);
  const samePos = free.filter((x) => x.position.trim().toLowerCase() === position.trim().toLowerCase());
  const others = free.filter((x) => !samePos.includes(x));
  const match = (l: StaffOpt[]) => (term ? l.filter((x) => x.fullName.toLowerCase().includes(term)) : l);
  const list = [...match(samePos), ...match(others)].slice(0, 30);

  return (
    <div ref={boxRef} className="relative">
      <Input
        name="fullName"
        value={value}
        onChange={(e) => { onChange(e.target.value); onPick(null); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder="Familiya Ism Otasining ismi"
        autoComplete="off"
        required
        className={picked ? "border-emerald-400 bg-emerald-50/50" : undefined}
      />
      {open && list.length > 0 && (
        <div className="absolute top-full right-0 left-0 z-30 mt-1 max-h-64 min-w-[280px] overflow-auto rounded-lg border border-slate-200 bg-white py-1 shadow-(--shadow-pop)">
          <div className="px-3 py-1 text-[11px] text-slate-400">
            {samePos.length > 0 ? `«${position}» lavozimidagi xodimlar — tanlasangiz yangi karta ochilmaydi` : "Ro'yxatdagi xodimlar (logini yo'q)"}
          </div>
          {list.map((x) => (
            <button key={x.id} type="button" onClick={() => { onPick(x); onChange(x.fullName); setOpen(false); }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-slate-50">
              <span className="min-w-0 flex-1 truncate">{x.fullName}</span>
              {/* Nofaol xodim ham chiqadi: tanlansa ro'yxatga qaytariladi */}
              {!x.isActive && <span className="shrink-0 rounded bg-amber-100 px-1.5 text-[11px] text-amber-800">nofaol</span>}
              <span className="shrink-0 text-xs text-slate-500">{x.position}</span>
              {x.phone && <span className="shrink-0 text-xs text-slate-400">{x.phone}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
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

/**
 * Tezkor forma: lavozim tanlanadi → F.I.O. maydonida o'sha lavozimdagi faol xodimlar chiqadi.
 * Ro'yxatdan tanlansa mavjud xodimga login beriladi (dublikat karta ochilmaydi),
 * yangi ism yozilsa yangi xodim qo'shiladi. Lavozimlar ro'yxati Otdel kadrdagi bilan bir xil.
 */
export function EmployeeForm({ departments, work, drivers, staff, vehicles, canGrant }: {
  departments: Pos[]; work: string[]; drivers: string[]; staff: StaffOpt[]; vehicles: VehicleOpt[]; canGrant: boolean;
}) {
  const [state, action, pending] = useActionState(createEmployee, undefined);
  const ref = useRef<HTMLFormElement>(null);
  const [position, setPosition] = useState(departments[0]?.label ?? "");
  const [fullName, setFullName] = useState("");
  const [picked, setPicked] = useState<StaffOpt | null>(null);
  // Ishchi lavozimda (Laborant, Skladchi...) login qaysi bo'lim uchun ochilishi — kadr tanlaydi
  const [loginRole, setLoginRole] = useState("");
  const needsLogin = !!departments.find((p) => p.label === position)?.role;
  const isDriver = drivers.includes(position);
  // Haydovchiga login ixtiyoriy: ECO ilovasiga telefon bilan kiradi, ERP ilovasiga esa login/parol bilan
  const showLogin = needsLogin || isDriver || !!loginRole;
  const reset = () => { ref.current?.reset(); setPosition(departments[0]?.label ?? ""); setFullName(""); setPicked(null); setLoginRole(""); };
  useEffect(() => { if (state?.ok) reset(); }, [state]); // eslint-disable-line react-hooks/exhaustive-deps

  // Xodim tanlanganda tanlangan lavozim o'zgarmaydi: aynan shu lavozim beriladi
  // (aks holda login beradigan bo'lim ishchi lavozimga almashib, login katagi yopilib qolardi).
  // Xodimning eski lavozimi faqat izohda ko'rsatiladi.
  const pick = (x: StaffOpt | null) => setPicked(x);

  /** Lavozim almashganda "login uchun bo'lim" tanlovi eskirmasin. */
  const changePosition = (v: string) => { setPosition(v); setLoginRole(""); };

  return (
    <form ref={ref} action={action} className="space-y-3">
      {/* Ro'yxatdan tanlangan xodim — yangi karta emas, shu kartaga login beriladi */}
      <input type="hidden" name="employeeId" value={picked?.id ?? ""} />
      <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-[1.4fr_200px_170px_160px_auto]">
        <Field label="F.I.O. *" hint={picked ? undefined : "Lavozimni tanlasangiz mavjud xodimlar chiqadi"}>
          <FioField staff={staff} position={position} value={fullName} onChange={setFullName} picked={picked} onPick={pick} />
        </Field>
        <Field label="Lavozim *"><PositionSelect departments={departments} work={[...new Set([...work, ...drivers])]} value={position} onChange={changePosition} /></Field>
        <Field label="Telefon" hint={isDriver ? "Ilovaga kirish kaliti" : undefined}><Input name="phone" placeholder="+998 90 123 45 67" defaultValue={picked?.phone ?? ""} key={picked?.id ?? "new"} /></Field>
        <Field label="Ishga kirgan sana"><Input name="hiredAt" type="date" /></Field>
        <Button disabled={pending || (needsLogin && !canGrant)}>
          <Plus size={16} /> {picked ? (showLogin ? "Login berish" : "Lavozimni belgilash") : "Qo'shish"}
        </Button>
      </div>
      {picked && (
        <p className="flex flex-wrap items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
          <b>{picked.fullName}</b> ro&apos;yxatda bor — yangi karta ochilmaydi.
          {picked.position.trim().toLowerCase() !== position.trim().toLowerCase()
            ? <> Lavozimi: «{picked.position}» → <b>«{position}»</b>.</>
            : <> Lavozimi: <b>«{position}»</b>.</>}
          {!picked.isActive && " Xodim nofaol edi — ro'yxatga qaytariladi."}
          {showLogin ? " Pastdagi login va parol shu xodimga beriladi." : " Login kerak bo'lsa pastdan bo'limni tanlang."}
          <button type="button" onClick={() => { setPicked(null); setFullName(""); }} className="font-medium underline">bekor qilish</button>
        </p>
      )}
      {/* Ishchi lavozim (Laborant, Skladchi...) — o'zi tizimga kirmaydi, lekin kerak bo'lsa
          qaysi bo'lim huquqi bilan kirishini shu yerda tanlanadi; kadr lavozimi o'zgarmaydi */}
      {!needsLogin && !isDriver && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
          <span>«{position}» o&apos;zi tizimga kirmaydi. Tizimga kirsin desangiz — qaysi bo&apos;lim huquqi bilan:</span>
          <Select value={loginRole} onChange={(e) => setLoginRole(e.target.value)} className="w-40 px-2 py-1 text-xs">
            <option value="">— login kerak emas —</option>
            {departments.filter((p) => p.role).map((p) => <option key={p.label} value={p.role!}>{p.label}</option>)}
            <option value="DRIVER">Haydovchi (ilova)</option>
          </Select>
          <span className="text-slate-500">Kadr lavozimi «{position}» bo&apos;lib qoladi.</span>
        </div>
      )}
      {/* Tanlangan bo'lim serverga shu maydon bilan ketadi */}
      {!!loginRole && <input type="hidden" name="role" value={loginRole} />}
      {isDriver && <DriverFields vehicles={vehicles} />}
      {showLogin && (
        <div className="grid grid-cols-1 gap-3 rounded-lg border border-blue-200 bg-blue-50 p-3 sm:grid-cols-[1fr_1fr_2fr]">
          <Field label={needsLogin ? "Login *" : "Login"}><Input name="login" autoComplete="off" required={needsLogin} /></Field>
          <Field label={needsLogin ? "Parol *" : "Parol"}><PasswordInput name="password" autoComplete="new-password" required={needsLogin} /></Field>
          <p className="self-end text-xs text-blue-800">
            {needsLogin
              ? "Bu lavozim egasi tizimga kirib, faqat o'z bo'limi sahifalarini ko'radi."
              : loginRole
                ? `Login «${departments.find((p) => p.role === loginRole)?.label ?? "Haydovchi (ilova)"}» huquqi bilan ochiladi — xodim faqat shu bo'lim sahifalarini ko'radi.`
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

/**
 * Ro'yxat qatoridan login berish. `roles` — qaysi bo'lim uchun login ochilishi
 * (ishchi lavozimdagi xodim ham kerakli bo'lim bilan tizimga kira oladi; kadr lavozimi o'zgarmaydi).
 * `defaultRole` — lavozimdan kelib chiqqan taxmin; bo'lmasa kadr o'zi tanlaydi.
 */
export function GrantLoginForm({ employeeId, roles, defaultRole }: {
  employeeId: string;
  roles: { value: string; label: string }[];
  defaultRole?: string | null;
}) {
  const [state, action, pending] = useActionState(grantLogin.bind(null, employeeId), undefined);
  return (
    <form action={action} className="flex flex-wrap items-center gap-1">
      <Select name="role" defaultValue={defaultRole ?? ""} className="w-32 px-2 py-1 text-xs" required>
        <option value="">Bo&apos;lim…</option>
        {roles.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
      </Select>
      <Input name="login" placeholder="login" className="w-28 px-2 py-1 text-xs" autoComplete="off" required />
      <PasswordInput name="password" placeholder="parol" className="w-28 px-2 py-1 text-xs" autoComplete="new-password" required />
      <Button variant="secondary" className="px-2 py-1 text-xs" disabled={pending}>Login berish</Button>
      {state?.error && <span className="w-full text-xs text-red-600">{state.error}</span>}
      {state?.note && <span className="w-full text-xs text-slate-600">{state.note}</span>}
    </form>
  );
}
