import type { ImportField } from "./excel";

/** Mijoz / yetkazuvchi importining umumiy ustunlari (sarlavha sinonimlari o'zbek/rus/ingliz). */
export const PARTY_FIELDS: ImportField[] = [
  { key: "name", label: "Nomi", required: true, synonyms: ["nomi", "наимен", "название", "контрагент", "mijoz", "yetkazuvchi", "поставщик", "клиент", "покупател", "korxona", "name", "company"] },
  { key: "inn", label: "INN (СТИР)", hint: "9 xonali; shu bo'yicha takror tekshiriladi", synonyms: ["инн", "inn", "стир", "stir", "tin"] },
  { key: "phone", label: "Telefon", synonyms: ["телефон", "tel", "phone", "моб", "raqam"] },
  { key: "address", label: "Manzil", synonyms: ["адрес", "manzil", "address", "юр. адрес"] },
  { key: "contactPerson", label: "Mas'ul shaxs", synonyms: ["контакт", "mas'ul", "masul", "ответствен", "директор", "contact", "fio", "ф.и.о"] },
];
