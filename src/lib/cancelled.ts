import { db } from "@/lib/db";
import { dateTime } from "@/lib/format";

/**
 * Bekor qilingan yozuvlar (FuelLog, TransportExpense, VehicleService, CashTransaction) uchun umumiy ko'rinish:
 * ular o'chirilmaydi, tarix ro'yxatida «Bekor qilingan» belgisi bilan qoladi, lekin jami va hisob-kitoblarga kirmaydi.
 * Bu modellarda `cancelledBy` relyatsiyasi yo'q — kim bekor qilgani `cancelledById` bo'yicha alohida o'qiladi.
 */
export type CancelInfo = { cancelledAt: Date | null; cancelledById: string | null; cancelReason: string | null };

export const CANCELLED_LABEL = "Bekor qilingan";

/** Ro'yxatdagi bekor qilganlar ismi (bitta so'rov). */
export async function cancellerNames(rows: CancelInfo[]): Promise<Map<string, string>> {
  const ids = [...new Set(rows.filter((r) => r.cancelledAt && r.cancelledById).map((r) => r.cancelledById!))];
  if (!ids.length) return new Map();
  const users = await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true } });
  return new Map(users.map((u) => [u.id, u.fullName]));
}

/** "sabab · F.I.Sh · kk/oo/yyyy ss:dd" — bekor qilinmagan bo'lsa null. */
export function cancelNote(r: CancelInfo, names: Map<string, string>): string | null {
  if (!r.cancelledAt) return null;
  return [r.cancelReason, r.cancelledById ? names.get(r.cancelledById) : null, dateTime(r.cancelledAt)].filter(Boolean).join(" · ");
}
