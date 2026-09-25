import { after } from "next/server";
import type { Prisma, Role } from "@/generated/prisma";
import { db } from "@/lib/db";
import { sendPush, type PushChannel } from "@/lib/push";

/**
 * Xodimga xabar berish — ilovadagi bildirishnoma + push.
 *
 * Bitta joy: hodisa qayerda bo'lishidan qat'i nazar (veb tugma, mobil ilova, ECO webhook'i)
 * xabar shu funksiyalar orqali ketadi. Shuning uchun yangi hodisa qo'shish bir qator:
 * `after(() => notifyRoles(["LOGISTICS"], {...}))`.
 *
 * Tartib muhim — avval bazaga yoziladi, keyin push. Push yetib bormasligi mumkin
 * (telefon o'chiq, ruxsat yo'q, Expo javob bermadi), ro'yxat esa qoladi va xodim
 * ilovani ochganda ko'radi.
 *
 * Chaqiruvchi kutmasligi kerak: bildirishnoma amalning natijasiga ta'sir qilmaydi.
 * Shuning uchun server action'larda `after(...)` ichida chaqiriladi — foydalanuvchi
 * Expo javobini kutib turmaydi.
 */

/**
 * Xabarni javobdan KEYIN yuborish.
 *
 * Bildirishnoma amalning natijasiga ta'sir qilmaydi: zayavka tasdiqlandimi — tasdiqlandi,
 * xabar ketmasa ham. Shuning uchun foydalanuvchi Expo javobini kutib turmaydi.
 *
 * `after()` faqat so'rov ichida ishlaydi; skriptdan chaqirilsa (ECO sinxroni, cron)
 * oddiy kutish bilan bajariladi — u yerda kutadigan foydalanuvchi yo'q.
 */
export function notifyAfter(fn: () => Promise<void>): void {
  const run = () => fn().catch((e) => console.error("[notify]", e));
  try { after(run); } catch { void run(); }
}

/** Bosilganda ochiladigan kartochka — ilovadagi `/erp/<key>/<id>` va vebdagi sahifa. */
export type NotifyLink = { key: string; id: string };

export type NotifyInput = {
  /** Guruhlash va ikonka uchun: TRIP_ASSIGNED, ORDER_BLOCKED… */
  type: string;
  title: string;
  body: string;
  link?: NotifyLink;
  /** "oddiy" — ovozsiz, ma'lumot uchun. Sukut bo'yicha "muhim". */
  channel?: PushChannel;
};

/** Xodimlarga (User id bo'yicha). */
export async function notifyUsers(userIds: (string | null | undefined)[], n: NotifyInput): Promise<void> {
  const ids = [...new Set(userIds.filter((x): x is string => !!x))];
  if (ids.length === 0) return;

  await db.notification.createMany({
    data: ids.map((userId) => ({
      userId, type: n.type, title: n.title, body: n.body,
      link: (n.link ?? undefined) as Prisma.InputJsonValue | undefined,
    })),
  });

  const devices = await db.mobileDevice.findMany({ where: { userId: { in: ids } }, select: { userId: true, expoPushToken: true } });
  if (devices.length === 0) return;

  // Ikonkadagi raqam har xodimda o'ziniki — o'qilmaganlar soni bitta so'rovda olinadi
  const unread = await db.notification.groupBy({ by: ["userId"], where: { userId: { in: ids }, readAt: null }, _count: { _all: true } });
  const badge = new Map(unread.map((u) => [u.userId, u._count._all]));

  const byUser = new Map<string, string[]>();
  for (const d of devices) byUser.set(d.userId, [...(byUser.get(d.userId) ?? []), d.expoPushToken]);

  await Promise.all([...byUser].map(([userId, tokens]) =>
    sendPush(tokens, {
      title: n.title,
      body: n.body,
      badge: badge.get(userId),
      channel: n.channel,
      data: { type: n.type, ...(n.link ?? {}) },
    })));
}

/**
 * Rol egalariga — masalan "yangi zayavka" logistikaning hammasiga.
 * `except` — hodisani boshlagan xodim: o'z ishi haqida o'ziga xabar kelishi keraksiz.
 */
export async function notifyRoles(roles: Role[], n: NotifyInput, opts?: { except?: string | null }): Promise<void> {
  if (roles.length === 0) return;
  const users = await db.user.findMany({
    where: { role: { in: roles }, isActive: true, ...(opts?.except ? { id: { not: opts.except } } : {}) },
    select: { id: true },
  });
  return notifyUsers(users.map((u) => u.id), n);
}

/**
 * Xodimlar kartochkasi bo'yicha (haydovchi, brigadir).
 * Xodimda login bo'lmasa xabar yo'q — ilovaga kira olmaydi, ro'yxat ham ko'rinmaydi.
 */
export async function notifyEmployees(employeeIds: (string | null | undefined)[], n: NotifyInput): Promise<void> {
  const ids = [...new Set(employeeIds.filter((x): x is string => !!x))];
  if (ids.length === 0) return;
  const emps = await db.employee.findMany({ where: { id: { in: ids }, isActive: true, userId: { not: null } }, select: { userId: true } });
  return notifyUsers(emps.map((e) => e.userId), n);
}

// ───────────────────────── Ro'yxat (ilova va veb uchun) ─────────────────────────

export type NotificationRow = { id: string; type: string; title: string; body: string; link: NotifyLink | null; readAt: Date | null; createdAt: Date };

export async function listNotifications(userId: string, take = 50): Promise<NotificationRow[]> {
  const rows = await db.notification.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take,
    // Aynan kerakli ustunlar: `userId` ilovaga qaytmaydi (u allaqachon kimligini biladi)
    select: { id: true, type: true, title: true, body: true, link: true, readAt: true, createdAt: true },
  });
  return rows.map((r) => ({ ...r, link: (r.link as NotifyLink | null) ?? null }));
}

export const unreadCount = (userId: string) => db.notification.count({ where: { userId, readAt: null } });

/** `ids` berilmasa — hammasi o'qilgan deb belgilanadi. */
export async function markNotificationsRead(userId: string, ids?: string[]): Promise<number> {
  const r = await db.notification.updateMany({
    where: { userId, readAt: null, ...(ids?.length ? { id: { in: ids } } : {}) },
    data: { readAt: new Date() },
  });
  return r.count;
}
