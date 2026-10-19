"use client";

import { useMemo, useState } from "react";
import { ExcelImport } from "@/components/excel-import";
import { Checkbox, Field, Select } from "@/components/ui";
import { guessRentMonth, isEmptySpot, isTotalRow, pickRentSheet } from "@/lib/rent-sheet";
import type { ImportField } from "@/lib/excel";
import { importRentFromExcel } from "../actions";

/**
 * Arenda oy varag'i importi. Varaq tanlanganda oy o'zi aniqlanadi («2026 йил октябрь» sarlavhasi yoki «Октябрь»
 * varaq nomidan); bozor nomi alohida qatorda turadi — u keyingi do'konlarning joyi bo'ladi.
 */
export function RentImport({ months, defaultMonth, locations, canPay }: {
  months: { key: string; label: string }[]; defaultMonth: string; locations: string[]; canPay: boolean;
}) {
  const [month, setMonth] = useState(defaultMonth);
  // undefined — fayl hali tanlanmagan; null — varaqdan oy topilmadi
  const [guessed, setGuessed] = useState<string | null | undefined>(undefined);
  const fields = useMemo<ImportField[]>(() => [
    { key: "name", label: "Do'kon nomi", required: true, synonyms: ["дукон", "дўкон", "dukon", "do'kon", "dokon", "магазин", "ижарачи", "ijarachi", "номи", "nomi", "название"] },
    {
      key: "location", label: "Bozor (joy)", hint: "alohida ustun bo'lmasa jadvaldagi sarlavhadan olinadi", synonyms: ["бозор", "bozor", "рынок", "жой", "joy", "место", "локация"],
      valueMap: {
        options: locations.map((l) => ({ value: l, label: l })),
        newLabel: "Yangi joy bo'lib qo'shiladi",
        note: "Ro'yxatda — tizimdagi bozorlar. Fayldagi nom (kirillda) mavjud bozorga moslanadi, moslanmagani yangi joy bo'ladi. «sarlavha» — jadvaldagi bozor qatoridan («Техно сити бозор») olingan nom.",
        groupRows: { nameKey: "name", toggle: "groupRows", skip: (n) => isTotalRow(n) || isEmptySpot(n) },
      },
    },
    { key: "bankDue", label: "Perechisleniye summasi", hint: "oylik, bank orqali", synonyms: ["перечисления суммаси", "перечисление суммаси", "перечисления сумма", "перечисл", "perechisl"] },
    { key: "cashDue", label: "Naqd to'lovi", hint: "oylik, naqd", synonyms: ["накд тулови", "нақд тўлови", "накд тўлови", "naqd to'lovi", "наличн", "накд", "naqd"] },
    { key: "electricity", label: "Svet", hint: "ma'lumot uchun", synonyms: ["свет", "svet", "электр", "elektr"] },
    { key: "tax", label: "Biz to'laydigan soliq", hint: "ma'lumot uchun", synonyms: ["биз тулидиган налог", "налог", "солиқ", "soliq", "tax"] },
    { key: "bankPaid", label: "Perechisleniye o'tgan summa", hint: "shu oy uchun tushgan", synonyms: ["перечисления утган", "перечисления ўтган", "утган сумма", "ўтган сумма", "o'tgan summa", "otgan"] },
    { key: "cashPaid", label: "Naqd bergan summasi", hint: "shu oy uchun tushgan", synonyms: ["накд берган", "нақд берган", "берган суммаси", "bergan"] },
    { key: "note", label: "Izoh", synonyms: ["изох", "изоҳ", "izoh", "примечан", "комментар", "eslatma"] },
  ], [locations]);

  const onSheet = (name: string, aoa: unknown[][]) => {
    const m = guessRentMonth(name, aoa);
    setGuessed(m);
    if (m) setMonth(m);
  };
  const options = months.some((m) => m.key === month) ? months : [...months, { key: month, label: month }];

  return (
    <ExcelImport
      action={importRentFromExcel}
      submitLabel="Oy varag'ini import qilish"
      templateName="arenda-namuna"
      example={{ name: "VAXABJANOVA NIGORA QUYSINALIYEVNA", location: "Texno siti bozor", bankDue: 26420455, cashDue: 0, electricity: 750000, tax: 3170455, bankPaid: 26420455, cashPaid: 0, note: "" }}
      fields={fields}
      pickSheet={(names) => pickRentSheet(names)}
      onSheet={onSheet}
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Qaysi oy hisobi" hint={guessed === undefined ? "Fayl tanlanganda varaq nomi yoki sarlavhasidan o'zi aniqlanadi" : guessed ? "Varaqdan aniqlandi — kerak bo'lsa o'zgartiring" : "Varaqdan aniqlanmadi — oyni tanlang"}>
          <Select name="month" value={month} onChange={(e) => setMonth(e.target.value)}>
            {options.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
          </Select>
        </Field>
      </div>
      <div className="space-y-2">
        <Checkbox name="groupRows" defaultChecked label="Faqat nomi yozilgan qator — bozor sarlavhasi («Техно сити бозор»): do'kon emas, undan keyingi do'konlarga joy bo'lib biriktiriladi" />
        <Checkbox
          name="withPayments"
          defaultChecked={canPay}
          disabled={!canPay}
          label="To'langan summalarni («… o'tgan / bergan summa») arenda kassasiga shu oy uchun kirim qilish — qayta import qilinsa ikki marta yozilmaydi"
        />
      </div>
      <p className="text-xs text-slate-500">
        «Общий», «Буш» va summasi yo&apos;q qatorlar (izohlar) o&apos;tkazib yuboriladi. «Жами» va «Колдик» ustunlari kerak emas — tizim o&apos;zi hisoblaydi.
        Bazada yo&apos;q do&apos;kon qo&apos;shiladi, bor do&apos;konning shu oy hisobi fayldagi summalar bilan yangilanadi.
        Diqqat: o&apos;tgan oylar to&apos;lovlari kirim qilinsa, arenda kassasi umumiy summasi oshadi — zavod kassasiga topshirilgan pulni «Kassaga topshirildi» chiqimi bilan yozing.
      </p>
    </ExcelImport>
  );
}
