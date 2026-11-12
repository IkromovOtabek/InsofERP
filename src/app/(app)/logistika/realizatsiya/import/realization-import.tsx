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
    { key: "customerName", label: "Xaridor", required: true, hint: "ro'yxatda bo'lsa bog'lanadi, bo'lmasa nomi bilan qo'shiladi", synonyms: ["xaridor", "харидор", "mijoz", "мижоз", "покупател", "клиент", "заказчик", "контрагент", "customer"] },
    { key: "productName", label: "Mahsulot", required: true, hint: "ro'yxatda bo'lsa birlik va guruh undan, bo'lmasa nomi bilan qo'shiladi", synonyms: [...FIELD_SYNONYMS.product, "маҳсулот", "махсулот"] },
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
    >
      <p className="text-xs text-slate-500">
        Har qator «Qo&apos;lda» qator bo&apos;ladi: faqat reestr — mijoz qarzi, kassa va skladga ta&apos;sir qilmaydi, keyin tuzatish yoki sabab bilan bekor qilish mumkin.
        Reestrda bor jo&apos;natma qo&apos;shilmaydi: shu TTN reysdan yoki avval kiritilgan bo&apos;lsa (±1 kun), TTN&apos;siz qatorda — o&apos;sha kuni xaridor, mahsulot va miqdori bir xil qator bo&apos;lsa.
        Shuning uchun reestrning o&apos;zidan yuklab olingan faylni ham, bir faylni qayta ham yuklash mumkin — ikki marta yozilmaydi.
        «Summa», «QQS», «Jami», «Manba» ustunlari kerak emas. Xaridor yoki mahsulot ro&apos;yxatda bo&apos;lmasa ham qator nomi bilan qo&apos;shiladi.
        Sanasi, to&apos;lov turi yoki miqdori o&apos;qilmagan qator importni to&apos;xtatmaydi — u qo&apos;shilmaydi va sababi bilan ko&apos;rsatiladi, qolganlari qo&apos;shiladi.
      </p>
    </ExcelImport>
  );
}
