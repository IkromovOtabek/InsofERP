/** Inventarizatsiya / hisobdan chiqarish: shu summadan katta farq yoziladi, lekin direktorga xabar ketadi (so'm). */
export const DIRECTOR_NOTIFY_SUM = 5_000_000;

/** Hisobdan chiqarish (spisanie) sabablari — forma va server bir ro'yxatdan oladi. */
export const WRITE_OFF_REASONS = ["Brak (sifatsiz)", "Yo'qotish / tabiiy kamayish", "Muddati o'tgan", "Shikastlangan (tashishda, saqlashda)", "Boshqa"] as const;
