import { db } from "@/lib/db";
import { notifyAfter, notifyUsers } from "@/lib/notify";
import { today } from "@/lib/davomat";
import { lateText } from "@/lib/attendance-time";

/**
 * Kechikish xabari — otdel kadr (HR) va direktorga: "Aziz Karimov 08:27 da keldi — 27 daq kechikdi".
 *
 * Har qanday yo'ldan chaqiriladi (sex boshlig'i / brigadir belgilashi, "Hammasi keldi", veb tabel,
 * ERP yuz skaneri, xodimning o'zi "Keldim"). Qoidalar:
 *   · faqat BUGUNGI kun uchun (o'tgan kunni tabelda to'g'rilash xabar bermaydi);
 *   · bir xodim / bir kun — bitta xabar (takror belgilash, "Ketdi" ni qo'yish yana yubormaydi);
 *   · xodimning o'ziga va belgilagan odamga yuborilmaydi.
 * Xabar javobdan keyin ketadi — belgilash natijasini kutib turmaydi.
 */

export const LATE_TYPE = "ATTENDANCE_LATE";

export type LateEvent = { employeeId: string; checkIn: string | null; lateMinutes: number | null | undefined; iso?: string };

/** Fon rejimida yuborish — chaqiruvchi kutmaydi, xato amalni buzmaydi. */
export function notifyLateAfter(actorUserId: string | null, events: LateEvent | LateEvent[]): void {
  const list = (Array.isArray(events) ? events : [events]).filter((e) => (e.lateMinutes ?? 0) > 0 && (e.iso ?? today()) === today());
  if (!list.length) return;
  notifyAfter(() => notifyLate(actorUserId, list));
}

export async function notifyLate(actorUserId: string | null, events: LateEvent[]): Promise<void> {
  const list = events.filter((e) => (e.lateMinutes ?? 0) > 0 && (e.iso ?? today()) === today());
  if (!list.length) return;
  const ids = [...new Set(list.map((e) => e.employeeId))];
  // Kun boshi (server vaqti — Asia/Tashkent): shu kuni shu xodim uchun xabar allaqachon ketganmi
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const [emps, sent, bosses] = await Promise.all([
    db.employee.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true, position: true, userId: true } }),
    db.notification.findMany({ where: { type: LATE_TYPE, createdAt: { gte: start } }, select: { link: true } }),
    db.user.findMany({ where: { role: { in: ["HR", "DIRECTOR"] }, isActive: true }, select: { id: true } }),
  ]);
  const done = new Set(sent.map((n) => (n.link as { id?: string } | null)?.id).filter(Boolean));
  const byId = new Map(emps.map((e) => [e.id, e]));
  for (const ev of list) {
    const e = byId.get(ev.employeeId);
    if (!e || done.has(e.id)) continue;
    done.add(e.id);
    const to = bosses.map((u) => u.id).filter((id) => id !== e.userId && id !== actorUserId);
    if (!to.length) continue;
    await notifyUsers(to, {
      type: LATE_TYPE,
      title: "Kechikish",
      body: `${e.fullName} ${ev.checkIn ?? ""} da keldi — ${lateText(ev.lateMinutes!)} kechikdi${e.position ? ` (${e.position})` : ""}`.replace("  ", " "),
      link: { key: "employees", id: e.id },
      channel: "oddiy",
    });
  }
}
