import { db } from "./db";

/**
 * Ko'rinadigan ma'lumot o'zgarganini bildiruvchi «versiya» — `LiveRefresh` sahifani faqat shu o'zgarganda
 * qayta so'raydi (ilgari har 30 soniyada, hech narsa o'zgarmasa ham, butun sahifa qayta hisoblanardi).
 *
 * Manba — Postgres statistikasi (`pg_stat_user_tables`): jadvallardagi qo'shish/o'zgartirish/o'chirishlar soni.
 * Ilova, bot, ECO sinxroni — kim yozganidan qat'i nazar hisobga olinadi, kodga ilgak qo'yish shart emas.
 * Statistika yozuvdan bir necha soniya (ko'pi bilan ~10 s) keyin yangilanadi — jonli yangilanish uchun yetarli.
 * Har korxona — alohida baza, versiya ham o'ziniki.
 *
 * Hisobga olinmaydi: sahifa ko'rsatmaydigan yoki o'z yangilanishi bor jadvallar (tashriflar jurnali, bildirishnomalar,
 * GPS nuqtalari, GPS kuzatuvining har daqiqalik belgisi `CompanySettings.gpsWatchAt`...). `Trip` ning o'zgarishlari ham:
 * haydovchi ilovasi oxirgi joyni (lastLat…) har necha soniyada yozadi; reys holati esa `lib/trips.ts` da AuditLog bilan
 * birga o'zgaradi — o'shandan bilinadi.
 */
const NOISE = [
  "VisitLog", "InputMemory", "Notification", "TripPosition", "MobileDevice", "TelegramLinkCode",
  "PasswordResetCode", "SmsLog", "SmmVideoJob", "CompanySettings", "_prisma_migrations",
];

export async function dataVersion(): Promise<string> {
  const [r] = await db.$queryRaw<{ v: bigint | null }[]>`
    SELECT SUM(n_tup_ins + n_tup_del + CASE WHEN relname = 'Trip' THEN 0 ELSE n_tup_upd END) AS v
    FROM pg_stat_user_tables
    WHERE schemaname = current_schema() AND relname::text <> ALL(${NOISE}::text[])`;
  return String(r?.v ?? 0);
}
