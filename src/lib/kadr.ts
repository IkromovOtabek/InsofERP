/** Otdel kadr kartasi uchun umumiy ro'yxatlar — forma, karta va chop etiladigan varaqa shulardan foydalanadi. */

/** Xodim ishga kirganda yig'iladigan hujjat nusxalari. Oxirgisi — bir nechta fayl tanlash uchun. */
export const DOC_KINDS = [
  "Passport nusxasi",
  "Diplom / ma'lumot hujjati",
  "Tibbiy ma'lumotnoma",
  "Haydovchilik guvohnomasi",
  "Mehnat daftarchasi",
] as const;

export const OTHER_DOC_KIND = "Boshqa hujjat";

export const EDUCATION: string[] = ["Oliy", "Tugallanmagan oliy", "O'rta maxsus", "O'rta", "Boshlang'ich"];
export const MARITAL: string[] = ["Uylanmagan / turmushga chiqmagan", "Oilali", "Ajrashgan", "Beva"];

/** Forma maydoni nomi ↔ hujjat turi. */
export const docField = (kind: string) => `doc:${kind}`;
export const kindFromField = (name: string) => (name.startsWith("doc:") ? name.slice(4) : null);
