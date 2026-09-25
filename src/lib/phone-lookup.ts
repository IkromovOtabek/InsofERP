import { db } from "@/lib/db";
import { normalizePhone } from "@/lib/sms/phone";
import type { Role } from "@/generated/prisma";

/**
 * Telefon raqami bo'yicha tizimga kiradigan xodimni topish — BITTA joyda.
 *
 * Ikki joyda kerak: parolni tiklash (`lib/password-reset.ts`) va Telegram botiga
 * raqam yuborib hisobni ulash (`lib/telegram/bot.ts`). Qoida ikkiga bo'linsa,
 * birida "topildi", ikkinchisida "yo'q" bo'lib qolishi aniq.
 *
 * Nega telefon `Employee` dan olinadi: `User` da telefon maydoni yo'q va qo'shilsa ham
 * ikki joyda ikki xil raqam bo'lib qolardi. Otdel kadr kartadagi raqamni yangilasa —
 * ikkala oqim ham o'sha zahoti yangi raqam bilan ishlaydi.
 *
 * Raqamlar bazada qo'lda kiritilgan ("90 123 45 67", "+998901234567"…) — SQL'da
 * solishtirib bo'lmaydi, shuning uchun ro'yxat olinib JS'da normallashtiriladi.
 * Zavod xodimlari soni kichik, bu arzon.
 */
export type StaffByPhone =
  | { kind: "found"; employeeId: string; fullName: string; user: { id: string; login: string; role: Role } }
  | { kind: "none" }
  /** Bitta raqam bir nechta faol loginga tegishli — kimning hisobi ekanini bilib bo'lmaydi. */
  | { kind: "ambiguous" };

export const AMBIGUOUS_PHONE_ERROR =
  "Bu raqam bir nechta xodim kartasida yozilgan — Otdel kadrga murojaat qiling.";

/**
 * `Employee.phone` noyob emas: amalda bitta raqam ikki kartaga yozilib qolishi mumkin.
 * Bunday holda tasodifan birovning hisobiga kirib qolish mumkin emas — to'xtaymiz.
 */
export async function staffByPhone(rawPhone: string | null | undefined): Promise<StaffByPhone> {
  const phone = normalizePhone(rawPhone);
  if (!phone) return { kind: "none" };
  const rows = await db.employee.findMany({
    where: { isActive: true, userId: { not: null }, phone: { not: null } },
    select: { id: true, phone: true, fullName: true, user: { select: { id: true, login: true, role: true, isActive: true } } },
  });
  const hits = rows.filter((e) => normalizePhone(e.phone) === phone && e.user?.isActive);
  if (hits.length === 0) return { kind: "none" };
  if (hits.length > 1) return { kind: "ambiguous" };
  const hit = hits[0];
  return {
    kind: "found",
    employeeId: hit.id,
    fullName: hit.fullName,
    user: { id: hit.user!.id, login: hit.user!.login, role: hit.user!.role },
  };
}
