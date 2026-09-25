import { z } from "zod";
import { db } from "@/lib/db";
import { listNotifications, markNotificationsRead, unreadCount, type NotificationRow } from "@/lib/notify";
import type { MobileUser } from "./auth";
import { ListError } from "./list";

/**
 * Ilovadagi bildirishnomalar — ro'yxat, o'qilgan deb belgilash va qurilmani ro'yxatga olish.
 *
 * Qurilma alohida jadvalda (`MobileDevice`), chunki bitta xodim bir nechta telefondan
 * kirishi mumkin va Expo tokeni ilova qayta o'rnatilganda almashadi.
 */

const Device = z.object({
  deviceId: z.string().trim().min(1, "deviceId yo'q").max(128),
  expoPushToken: z.string().trim().min(10, "Token noto'g'ri").max(256),
  platform: z.enum(["ios", "android"]).optional(),
});

export type DeviceResult = { ok: true };

/** Ilova har ishga tushganda yuboradi: token almashgan bo'lsa yozuv yangilanadi. */
export async function registerDevice(user: MobileUser, body: unknown): Promise<DeviceResult> {
  const p = Device.safeParse(body);
  if (!p.success) throw new ListError("BAD_REQUEST", p.error.issues[0]?.message ?? "Ma'lumot noto'g'ri", 400);
  const { deviceId, expoPushToken, platform } = p.data;

  // Bitta token faqat bitta hisobda bo'lishi kerak: telefonda boshqa xodim kirsa,
  // eski egasiga yuborilgan xabar yangi egasining ekranida chiqib qolmasin.
  await db.mobileDevice.deleteMany({ where: { expoPushToken, NOT: { userId: user.id } } });
  await db.mobileDevice.upsert({
    where: { userId_deviceId: { userId: user.id, deviceId } },
    create: { userId: user.id, deviceId, expoPushToken, platform },
    update: { expoPushToken, platform },
  });
  return { ok: true };
}

/** Chiqishda chaqiriladi — telefon boshqa xodimga o'tsa xabar unga ketmasin. */
export async function forgetDevice(user: MobileUser, body: unknown): Promise<DeviceResult> {
  const deviceId = String((body as { deviceId?: unknown } | null)?.deviceId ?? "").trim();
  if (deviceId) await db.mobileDevice.deleteMany({ where: { userId: user.id, deviceId } });
  return { ok: true };
}

export type NotificationsResult = { unread: number; rows: NotificationRow[] };

export async function mobileNotifications(user: MobileUser): Promise<NotificationsResult> {
  const [unread, rows] = await Promise.all([unreadCount(user.id), listNotifications(user.id)]);
  return { unread, rows };
}

/** `ids` bo'sh bo'lsa — hammasi o'qilgan deb belgilanadi (ro'yxat ochilganda). */
export async function readNotifications(user: MobileUser, body: unknown): Promise<{ ok: true; unread: number }> {
  const ids = Array.isArray((body as { ids?: unknown } | null)?.ids)
    ? ((body as { ids: unknown[] }).ids.filter((x): x is string => typeof x === "string"))
    : undefined;
  await markNotificationsRead(user.id, ids);
  return { ok: true, unread: await unreadCount(user.id) };
}
