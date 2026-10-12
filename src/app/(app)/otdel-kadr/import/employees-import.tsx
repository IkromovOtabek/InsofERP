"use client";

import { useMemo, useState, useTransition } from "react";
import { Check, X } from "lucide-react";
import { Button, Checkbox, Field, FormError, Input, Select } from "@/components/ui";
import { ExcelImport } from "@/components/excel-import";
import type { ImportField } from "@/lib/excel";
import { createPositionInline, importEmployeesFromExcel } from "../actions";

export type PositionOpt = { value: string; label: string; group: string; aliases?: string[] };
type RoleOpt = { value: string; label: string };

const LOGIN_GROUP = "Tizimga kiradigan lavozimlar";
const WORK_GROUP = "Ishchi lavozimlar";

/**
 * «+ Yangi lavozim…» — moslash jadvali qatorining ichida ochiladigan mini-forma (sahifadan chiqmaydi).
 * Lavozim darhol ochiladi va hamma qatorlar tanlovida paydo bo'ladi. «Tizimga kiradi» — faqat direktorga.
 * Bu ExcelImport formasining ichida turadi: maydonlarda `name` yo'q, tugmalar `type="button"`, Enter tutiladi.
 */
function NewPositionInline({ initial, canLogin, roles, onCreated, onCancel }: {
  initial: string; canLogin: boolean; roles: RoleOpt[];
  onCreated: (opt: PositionOpt) => void; onCancel: () => void;
}) {
  const [name, setName] = useState(initial);
  const [login, setLogin] = useState(false);
  const [role, setRole] = useState("");
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const save = () => start(async () => {
    setError(undefined);
    if (login && !role) { setError("Asosiy bo'limni tanlang"); return; }
    const r = await createPositionInline({ name, loginRole: login ? role : null });
    if (!r?.ok || !r.name) { setError(r?.error ?? "Saqlanmadi"); return; }
    const roleLabel = r.loginRole ? roles.find((x) => x.value === r.loginRole)?.label : null;
    onCreated({ value: r.name, label: roleLabel ? `${r.name} · ${roleLabel}` : r.name, group: r.loginRole ? LOGIN_GROUP : WORK_GROUP });
  });
  return (
    <div className="space-y-2 rounded-lg border border-sky-200 bg-sky-50/60 p-2.5">
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Yangi lavozim nomi" className="min-w-48 flex-1">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); save(); } }}
            autoFocus
            autoComplete="off"
            className="h-8 text-xs"
          />
        </Field>
        {canLogin && (
          <div className="pb-1.5"><Checkbox checked={login} onChange={(e) => setLogin(e.target.checked)} label="Tizimga kiradi (ERP va ECO login)" className="text-xs" /></div>
        )}
        {canLogin && login && (
          <Field label="Asosiy bo'lim">
            <Select value={role} onChange={(e) => setRole(e.target.value)} className="h-8 w-48 text-xs">
              <option value="" disabled>Tanlang…</option>
              {roles.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </Select>
          </Field>
        )}
        <Button type="button" size="sm" onClick={save} disabled={pending || !name.trim()}><Check size={14} /> {pending ? "Saqlanmoqda…" : "Saqlash"}</Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel} disabled={pending}><X size={14} /> Bekor</Button>
      </div>
      {!canLogin && <p className="text-[11px] text-slate-500">Ishchi lavozim bo&apos;lib ochiladi. Uni tizimga kiradigan qilishni (login shabloni) direktor Ishchi lavozimlar ro&apos;yxatida belgilaydi.</p>}
      {canLogin && login && <p className="text-[11px] text-slate-500">Login bu yerda ochilmaydi: keyin Xodimlar sahifasida login berilganda shu bo&apos;lim bilan ochiladi. Ruxsatlarni Ishchi lavozimlar → «Login shabloni» da sozlaysiz.</p>}
      <FormError error={error} />
    </div>
  );
}

/**
 * Otdel kadr → Excel orqali xodim qo'shish (klient qismi): lavozimni moslash ro'yxati — barcha mavjud lavozimlar
 * (tizimga kiradiganlari alohida guruhda) va oxirida «+ Yangi lavozim…». Yangi ochilgan lavozim hamma qatorga qo'shiladi.
 */
export function EmployeesImport({ initialOptions, subdivisions, canLogin, roles }: {
  initialOptions: PositionOpt[]; subdivisions: string[]; canLogin: boolean; roles: RoleOpt[];
}) {
  const [options, setOptions] = useState(initialOptions);

  const fields = useMemo<ImportField[]>(() => [
    { key: "fullName", label: "F.I.O. (Сотрудник)", required: true, synonyms: ["сотрудник", "ф.и.о", "фио", "работник", "xodim", "ходим", "familiya", "ism", "name"] },
    { key: "tabelNo", label: "Tabel № (Табельный номер)", hint: "shu raqam bo'yicha mavjud xodim topiladi", synonyms: ["табельный", "табел", "tabel", "личный номер", "таб."] },
    {
      key: "position", label: "Lavozim (Должность)", hint: "ro'yxatda bo'lmasa yangi ishchi lavozim ochiladi", synonyms: ["должност", "lavozim", "kasb", "position"],
      valueMap: {
        options,
        newLabel: "Yangi lavozim ochiladi",
        note: "Ro'yxatda — tizimdagi barcha lavozimlar: tizimga kiradiganlari (Kassa / bank, Brigadir…) va ishchi lavozimlar. Import login OCHMAYDI — tizimga kiradigan lavozimdagi xodimga login keyin Xodimlar sahifasida beriladi. «+ Yangi lavozim…» — lavozimni shu yerning o'zida ochadi. Moslanmagan lavozimlar Ishchi lavozimlar ro'yxatiga yangi bo'lib qo'shiladi (pastdagi «Ro'yxatda yo'q lavozimlarni … ochish» belgisi yoqilgan bo'lsin).",
        create: {
          label: "+ Yangi lavozim…",
          render: ({ value, done }) => (
            <NewPositionInline
              initial={value}
              canLogin={canLogin}
              roles={roles}
              onCancel={() => done()}
              onCreated={(opt) => {
                setOptions((l) => (l.some((o) => o.value === opt.value) ? l : [...l, opt]));
                done(opt.value);
              }}
            />
          ),
        },
      },
    },
    {
      key: "subdivision", label: "Bo'lim / brigada (Подразделение)", hint: "alohida ustun bo'lmasa jadvaldagi sarlavhadan olinadi", synonyms: ["подразделен", "бригада", "brigada", "цех", "участок", "bo'lim", "bolim", "бўлим"],
      valueMap: {
        options: subdivisions.map((n) => ({ value: n, label: n })),
        newLabel: "Yangi bo'lim qo'shiladi",
        note: "Ro'yxatda — xodim kartalaridagi bo'lim/brigada nomlari va faol brigadalar. Moslanmagan nom xodim kartasiga yangi bo'lim bo'lib yoziladi va keyingi safar shu ro'yxatda chiqadi. «sarlavha» — jadvaldagi guruh qatoridan («Бригада 1») olingan nom.",
        groupRows: { nameKey: "fullName", toggle: "groupRows" },
      },
    },
    { key: "tariffRate", label: "Tarif stavka (Тарифная ставка)", synonyms: ["тарифная", "тариф", "ставка", "оклад", "maosh", "ish haqi", "зарплат"] },
    { key: "hiredAt", label: "Ishga kirgan (Дата приема)", hint: "kun.oy.yil", synonyms: ["дата приема", "дата приёма", "приема", "приёма", "принят", "ishga kirgan", "qabul"] },
    { key: "firedAt", label: "Ishdan bo'shagan (Дата увольнения)", hint: "to'ldirilgan bo'lsa xodim nofaol bo'ladi", synonyms: ["увольнен", "уволен", "bo'shagan", "boshagan", "ishdan"] },
    { key: "phone", label: "Telefon (Телефон рабочий)", synonyms: ["телефон", "tel", "phone", "моб", "raqam"] },
    { key: "birthDate", label: "Tug'ilgan sana (Дата рождения)", hint: "«Дней до дня рождения» ustuni kerak emas", synonyms: ["дата рожд", "туғилган", "tug'ilgan", "tugilgan", "birth", "рожден"] },
  ], [options, subdivisions, canLogin, roles]);

  return (
    <ExcelImport
      action={importEmployeesFromExcel}
      submitLabel="Xodimlarni qo'shish"
      templateName="xodimlar-namuna"
      example={{
        fullName: "ABDUKARIMOV AZIMJON ORIFJONOVICH", tabelNo: "00401", position: "Formovshik",
        subdivision: "Brigada 1", tariffRate: 2500000, hiredAt: "10.09.2026", firedAt: "",
        phone: "+998 90 123 45 67", birthDate: "26.12.1989",
      }}
      fields={fields}
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Standart lavozim" hint="Должность ustuni bo'sh qolgan qatorlar uchun">
          <Select name="defaultPosition" defaultValue="">
            <option value="">— (bo&apos;sh bo&apos;lsa xato beriladi)</option>
            {[LOGIN_GROUP, WORK_GROUP].map((g) => {
              const list = options.filter((o) => o.group === g);
              return list.length ? <optgroup key={g} label={g}>{list.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</optgroup> : null;
            })}
          </Select>
        </Field>
      </div>
      <div className="space-y-2">
        <Checkbox
          name="groupRows"
          defaultChecked
          label="Faqat nomi yozilgan qator — bo'lim sarlavhasi («Бригада 1»): xodim sifatida qo'shilmaydi, undan keyingi xodimlarga bo'lim bo'lib biriktiriladi"
        />
        <Checkbox name="createPositions" defaultChecked label="Ro'yxatda yo'q lavozimlarni yangi ishchi lavozim sifatida ochish (Формовщик, Бригадир…)" />
        <Checkbox name="updateExisting" defaultChecked label="Bazada bor xodimlarning kartasini fayldagi ma'lumot bilan yangilash — bo'sh kataklar eski qiymatni o'chirmaydi" />
      </div>
      <p className="text-xs text-slate-500">
        Surat va hujjat nusxalari Excel&apos;dan kelmaydi — ularni keyin xodim kartasidan yuklaysiz.
        Tizimga kiradigan lavozimga (Kassa / bank, Brigadir…) moslangan xodimga login bu yerdan ochilmaydi — uni Xodimlar sahifasida «Login berish» bilan bering.
      </p>
    </ExcelImport>
  );
}
