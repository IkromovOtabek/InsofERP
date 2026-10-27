/**
 * Hisobot qatorlari nomlari — «Insof 2026» jadvalidagi (PNL, Cash Flow, BSH) atamalar bilan bir xil.
 * Kassa kategoriyasi (Manba / Sub manba) jadvaldagi qatorga shu xarita orqali tushadi; xaritada yo'q yangi kategoriya
 * o'z nomi bilan qo'shimcha qator bo'lib chiqadi. Kod nomlari (EXPENSE_CATEGORIES) o'zgarmaydi — faqat hisobotdagi ko'rinish.
 */
export const SHEET_LINE: Record<string, string> = {
  // Chiqim manbalari
  "Xomashyo": "Tannarx( Tavarga to'lov)",
  "Ish haqi": "Xodimlar maoshlari",
  "Pitaniya": "Oziq-ovqat xarajatlari",
  "Transport": "Avtotransport",
  "Ta'mirlash / ehtiyot qism": "Zavod xarajatlari",
  "Ijara": "Zavod xarajatlari",
  "Kommunal (elektr, suv, gaz)": "Komunal to'lovlari (Suv, Svet, Gaz)",
  "Soliq va to'lovlar": "Soliqlar",
  "Marketing": "Marketing xarajatlari",
  "Ofis / xo'jalik": "Ofis xarajatlari",
  "Bank xizmati": "Bank xizmati",
  "Boshqa chiqim": "Boshqa nakladnoy xarajatlar",
  "Divident": "Divident",
  "Asosiy vosita xaridi": "Asosiy vosita sotib olish",
  // Sub manbalar, jadvalda alohida qator bo'lganlari
  "HR (ishga olish, o'qitish)": "HR xarajati",
  "Xayriya va sovg'alar": "Xayriya",
  // Kirim manbalari
  "Boshqa tushum": "Boshqa tushumlar",
  "Xizmat (nasos, transport)": "Boshqa tushumlar",
  "Chiqindi / brak sotuvi": "Boshqa tushumlar",
  "Qaytarilgan avans": "Boshqa tushumlar",
};

/** Kategoriya (manba, sub manba) → jadval qatori: avval sub manba (alohida qator bo'lsa), keyin manba, bo'lmasa o'z nomi. */
export const sheetLine = (top: string, sub?: string | null) => (sub && SHEET_LINE[sub]) || SHEET_LINE[top] || top;

/** PNL'dagi qat'iy qatorlar — jadval tartibida, nol bo'lsa ham ko'rinadi. */
export const PNL_FIXED = {
  production: ["Xodimlar maoshlari", "Zavod xarajatlari", "Oziq-ovqat xarajatlari", "Komunal to'lovlari (Suv, Svet, Gaz)", "Avtotransport", "Amortizatsiya (bino, uskuna, mashinalar eskirishi)", "Boshqa nakladnoy xarajatlar"],
  admin: ["Ofis xarajatlari", "HR xarajati", "Bank xizmati", "Kurs farqi"],
  commercial: ["Marketing xarajatlari", "Xayriya"],
} as const;

export const DEPRECIATION_LINE = "Amortizatsiya (bino, uskuna, mashinalar eskirishi)";

/** DDS (Cash Flow) qatorlari — jadval tartibida. */
export const DDS_FIXED = {
  operatingIn: ["Savdo tushumi", "Boshqa tushumlar"],
  operatingOut: ["Tannarx( Tavarga to'lov)", "Xodimlar maoshlari", "Avtotransport", "Zavod xarajatlari", "Oziq-ovqat xarajatlari", "Komunal to'lovlari (Suv, Svet, Gaz)", "Ofis xarajatlari", "HR xarajati", "Bank xizmati", "Kurs farqi", "Soliqlar", "Marketing xarajatlari", "Boshqa nakladnoy xarajatlar", "Xayriya"],
  financing: ["Qarz olindi", "Qarz qaytarildi", "Qarz berildi", "Qarz qaytdi", "Kridit va kridit foizi", "Divident"],
  investing: ["Asosiy vosita sotib olish", "Reinvistitsiya"],
  transfers: ["99999-Xisob raqam almashinuvi", "Pul yechib berish", "Tranzit (pul almashinuvi)", "Manbasi yozilmagan"],
} as const;
