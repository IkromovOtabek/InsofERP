/** Kirim-Chiqim kategoriyalari — veb forma va mobil kassa uchun yagona ro'yxat. */
export const EXPENSE_CATEGORIES = ["Xomashyo", "Ish haqi", "Pitaniya", "Transport", "Ta'mirlash / ehtiyot qism", "Kommunal (elektr, suv, gaz)", "Ijara", "Soliq va to'lovlar", "Marketing", "Ofis / xo'jalik", "Bank xizmati", "Boshqa chiqim"];
// "Bank xizmati" — o'tkazma komissiyasi ham shu toifaga yoziladi (lib/cash-tx.ts BANK_FEE_CATEGORY)
export const INCOME_CATEGORIES = ["Boshqa tushum", "Xizmat (nasos, transport)", "Chiqindi / brak sotuvi", "Qaytarilgan avans", "Ta'sischi kiritmasi", "Kredit / qarz olindi"];
/**
 * «Perekit» — Chiqim formasidagi maxsus tanlov: o'z hisoblarimiz orasida pul o'tkazish (kassa ⇄ bank, bank ⇄ bank).
 * Chiqim bo'lib yozilmaydi: `lib/cash-transfer.ts` dagi o'tkazma hujjati (OT-…) ochiladi — manba hisobda (−),
 * qabul qiluvchida (+), ikkala hisob ko'chirmasida ko'rinadi, P&L va kategoriya hisobotlariga kirmaydi.
 * Shuning uchun EXPENSE_CATEGORIES ro'yxatida emas (byudjet uni chiqim deb olmasin).
 */
export const PEREKIT_CATEGORY = "Perekit (o'z hisoblararo)";
/**
 * To'lov usuli — alohida maydon emas, hisob turidan (`CashAccount.type`): naqd kassa yoki bank hisobi.
 * Kirim-Chiqim formasidagi «Naqd / Bank» tanlovi va jurnal belgisi/filtri shu yorliqlarni oladi.
 */
export const CASH_METHOD_LABEL = { CASH: "Naqd", BANK: "Bank" } as const;
export type CashMethod = keyof typeof CASH_METHOD_LABEL;
