import { db } from "@/lib/db";

/**
 * Expo Push — xodimning mobil ilovasiga xabar yuborish.
 *
 * Expo bitta manzil bilan ikkala do'konni qamrab oladi (iOS → APNs, Android → FCM),
 * shuning uchun zavodda alohida sertifikat/kalit saqlash kerak emas: ilova qaysi
 * tokenni bergan bo'lsa, o'shanga yuboriladi.
 *
 * Bu modul faqat YUBORADI. Kimga va nima yuborilishi `lib/notify.ts` da,
 * chunki bildirishnoma avval bazaga yoziladi va keyin push ketadi.
 */

const EXPO_URL = "https://exp.host/--/api/v2/push/send";
/** Bir so'rovda nechta xabar — Expo cheki 100. */
const CHUNK = 100;

/**
 * Bildirishnoma ovozi — ilova to'plamidagi fayl nomi (`assets/bildirishnoma.wav`).
 *
 * iOS ovozni SHU nom bo'yicha topadi, Android esa kanalga bog'langan ovozni chaladi
 * (`channelId`). Ikkalasi bir xil faylni ishlatadi, shuning uchun telefon qaysi bo'lishidan
 * qat'i nazar xodim bitta tanish ovozni eshitadi.
 *
 * Diqqat: fayl ilovaning NATIVE to'plamiga kiradi. Ovoz o'zgarsa ilovani qayta chiqarish
 * kerak — OTA yangilanish yetarli emas.
 */
export const PUSH_SOUND = "bildirishnoma.wav";

/**
 * Android bildirishnoma kanallari — ilovada ham shu kalitlar bilan yaratiladi
 * (`core/push.ts`). Kanal ovozni va "ekran ustida chiqishini" belgilaydi, va uni
 * foydalanuvchi tizim sozlamalaridan o'zi boshqara oladi.
 */
export type PushChannel = "muhim" | "oddiy";

export type PushMessage = {
  title: string;
  body: string;
  data?: Record<string, unknown>;
  /** Ilova ikonkasidagi raqam — o'qilmaganlar soni. */
  badge?: number;
  channel?: PushChannel;
};

type ExpoTicket = { status: "ok" | "error"; details?: { error?: string } };

/**
 * Tokenlarga xabar yuborish.
 *
 * Xato bo'lsa oqim to'xtamaydi: bildirishnoma bazada allaqachon turadi va xodim
 * ilovani ochganda ko'radi. Faqat "bunday qurilma yo'q" javobi alohida ishlanadi —
 * ilova o'chirilgan telefonlarga abadiy urinib yurmaslik uchun token o'chiriladi.
 */
export async function sendPush(tokens: string[], msg: PushMessage): Promise<void> {
  const to = [...new Set(tokens.filter(Boolean))];
  if (to.length === 0) return;

  for (let i = 0; i < to.length; i += CHUNK) {
    const part = to.slice(i, i + CHUNK);
    const body = part.map((t) => ({
      to: t,
      title: msg.title,
      body: msg.body,
      data: msg.data,
      sound: PUSH_SOUND,
      channelId: msg.channel ?? "muhim",
      priority: "high",
      badge: msg.badge,
      // Telefon uzoq o'chiq tursa eski xabar ma'nosini yo'qotadi — bir kundan keyin kerak emas
      ttl: 86400,
    }));
    try {
      const res = await fetch(EXPO_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(process.env.EXPO_ACCESS_TOKEN ? { authorization: `Bearer ${process.env.EXPO_ACCESS_TOKEN}` } : {}),
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) { console.warn("[push] Expo", res.status); continue; }
      const j = (await res.json()) as { data?: ExpoTicket[] };
      const dead = (j.data ?? [])
        .map((t, k) => (t.status === "error" && t.details?.error === "DeviceNotRegistered" ? part[k] : null))
        .filter((t): t is string => !!t);
      if (dead.length) await db.mobileDevice.deleteMany({ where: { expoPushToken: { in: dead } } });
    } catch (e) {
      console.error("[push]", e);
    }
  }
}
