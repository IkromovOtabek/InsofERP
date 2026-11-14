"use client";

import { useMemo } from "react";
import { ExcelImport } from "@/components/excel-import";
import { FIELD_SYNONYMS, matchKey, type ImportField } from "@/lib/excel";
import type { PayGroupKey } from "@/lib/order-day-sheet";
import { importRealizationAction } from "../actions";

/** To'lov turi taxmini oldindan ko'rishda; server (`payGroupOf`) moslanmaganini so'z boshidan ham aniqlaydi. */
const PAY_ALIASES: Record<PayGroupKey, string[]> = {
  BANK: ["Перечисление", "Перечисления", "Perechislenie", "Perechisleniye", "Безнал", "Безналичный", "Bank", "Hisob raqam", "п-р", "п/п", "б/н"],
  CASH: ["Наличные", "Нал", "Нақд", "Накд", "Naqd", "Nal", "Naqt", "Cash", "н-к"],
  DEBT: ["Долг", "Қарз", "Карз", "Qarz", "Qarz (tekin)", "Насия", "Nasiya", "Tekin"],
};

/**
 * Realizatsiya importi. Ustunlar reestr Excel'idagi nomlar bilan topiladi (lotin va kirill); «Summa», «QQS», «Jami»
 * olinmaydi — tizim miqdor × narx dan hisoblaydi (QQS 12% faqat perechisleniyeda).
 */
export function RealizationImport({ pays }: { pays: { key: PayGroupKey; label: string }[] }) {
  const fields = useMemo<ImportField[]>(() => [
    { key: "date", label: "Sana", required: true, synonyms: ["sana", "дата", "сана", "date"] },
    {
      key: "payGroup", label: "To'lov turi", required: true, synonyms: ["to'lov", "tolov", "to‘lov", "тўлов", "тулов", "оплат", "payment"],
      valueMap: {
        options: pays.map((p) => ({ value: p.key, label: p.label, aliases: [p.label, ...PAY_ALIASES[p.key]].map(matchKey) })),
        newLabel: "So'zidan aniqlanadi",
        note: "Fayldagi to'lov turi tizimdagiga moslanadi. Perechisleniyeda QQS 12% hisoblanadi; aniqlanmagan qiymatli qator qo'shilmaydi va ko'rsatiladi, qolganlari qo'shiladi.",
      },
    },
    { key: "seller", label: "Sotuvchi", synonyms: ["sotuvchi", "сотувчи", "продав", "менеджер", "manager"] },
    { key: "customerName", label: "Xaridor", required: true, hint: "nomi yoki aliasi ro'yxatda bo'lsa bog'lanadi, bo'lmasa mijozlarga yangi xaridor bo'lib qo'shiladi", synonyms: ["xaridor", "харидор", "mijoz", "мижоз", "покупател", "клиент", "заказчик", "контрагент", "customer"] },
    { key: "productName", label: "Mahsulot", required: true, hint: "ro'yxatda bo'lsa birlik va guruh undan, bo'lmasa katalogga yangi mahsulot bo'lib qo'shiladi", synonyms: [...FIELD_SYNONYMS.product, "маҳсулот", "махсулот"] },
    { key: "ttn", label: "TTN №", synonyms: ["ttn", "ттн", "накладн", "nakladnoy"] },
    { key: "vehicle", label: "Mashina", synonyms: ["mashina", "машина", "avto", "авто", "гос", "transport", "транспорт"] },
    { key: "unit", label: "O'lchov", hint: "mahsulot ro'yxatda bo'lmasa olinadi; tanilmasa nomidan (m³ yoki dona)", synonyms: FIELD_SYNONYMS.unit },
    { key: "qty", label: "Miqdor", required: true, synonyms: FIELD_SYNONYMS.qty },
    { key: "price", label: "Narx (QQSsiz)", synonyms: ["narx", "нарх", "цена", "price"] },
    { key: "delivery", label: "Dostavka", hint: "so'm", synonyms: ["dostavka", "доставк", "yetkaz", "етказ", "delivery"] },
    { key: "groupName", label: "Guruh", hint: "bo'sh bo'lsa mahsulot papkasidan", synonyms: ["guruh", "гурух", "группа", "group", "kategoriya", "категор"] },
    { key: "loadPlace", label: "Ortilgan joy", synonyms: ["ortilgan", "отгруз", "погруз", "bsu", "бсу", "bru", "бру", "yuklan", "юклан"] },
    { key: "destination", label: "Boradigan manzil", synonyms: ["boradigan", "манзил", "manzil", "адрес", "address", "obyekt", "объект"] },
    { key: "note", label: "Izoh", synonyms: ["izoh", "изох", "изоҳ", "примеч", "коммент", "eslatma"] },
    { key: "refName", label: "Xaridor (spravka nomi)", hint: "bo'sh bo'lsa xaridor nomi", synonyms: ["spravka", "справк"] },
  ], [pays]);

  return (
    <ExcelImport
      action={importRealizationAction}
      submitLabel="Reestrga qo'shish"
      templateName="realizatsiya-namuna"
      example={{
        date: "05.11.2026", payGroup: "Perechisleniye", seller: "", customerName: "Namuna Qurilish MChJ", productName: "B25", ttn: "161", vehicle: "01A123BC",
        unit: "m³", qty: 8, price: 650000, delivery: 0, groupName: "", loadPlace: "BSU-1", destination: "Toshkent, Chilonzor", note: "", refName: "",
      }}
      fields={fields}
    />
  );
}
